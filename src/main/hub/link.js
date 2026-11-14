// The hub's live line to one of your other PCs (docs/HUB.md).
//
// That PC serves Shellby on your phone on your tailnet (pocket/server.js), and
// the hub reads it the way the phone app does: GET /pocket/v1/events, a stream
// of server-sent events whose `view` is everything that PC is doing
// (pocket/view.js phoneView), and POST /pocket/v1/<action> to do things there
// (start a task, answer a prompt), each under that PC's own rules and limits.
// The device token rides in a header, never in a URL.
//
// A PC that's asleep, offline or turned off just isn't reachable: the link
// says so and tries again, waiting longer each time (up to MAX_RETRY_MS), and
// at once when asked (retryNow, e.g. when you open the hub).
//
// parseEvents is pure; PeerLink takes fetch and timers injected, so
// test/hub-link.test.js runs it against a fake server.
const { EventEmitter } = require('events');

const API = '/pocket/v1';
const MIN_RETRY_MS = 2000;
const MAX_RETRY_MS = 60 * 1000;
const MAX_EVENT = 512 * 1024;        // one view (a busy PC's is well under 100 KB); anything past this is dropped, not parsed
const IDLE_MS = 60 * 1000;           // the PC sends a keepalive every 15 s: this long with nothing is a dead line
const VIEW_EVERY_MS = 1000;          // views are read at most this often; one arriving meanwhile replaces the one waiting
const CONNECT_TIMEOUT_MS = 15 * 1000;
const ACTION_TIMEOUT_MS = 30 * 1000;
const MAX_BODY = 64 * 1024;

/**
 * Feed text in, get whole events out. Returns { events: [{ event, data }], rest }:
 * rest is the unfinished tail to prepend to the next chunk.
 */
function parseEvents(buffer) {
  const events = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest: rest.length > MAX_EVENT ? '' : rest };
}

class PeerLink extends EventEmitter {
  /**
   * @param {{ origin: string, token: () => string | null, fetch?: typeof fetch,
   *   setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout, now?: () => number }} o
   */
  constructor({ origin, token, fetch: f = globalThis.fetch, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
    super();
    this.origin = origin;
    this.token = token;
    this.fetch = f;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.view = null;        // the PC's last phoneView
    this.state = 'connecting'; // 'connecting' | 'online' | 'offline' | 'unpaired'
    /** @type {string | null} */
    this.error = null;
    /** @type {number | null} when the PC last said anything */
    this.seenAt = null;
    this.retryMs = MIN_RETRY_MS;
    this.timer = null;
    this.abort = null;
    this.closed = false;
    /** @type {string | null} the newest view not read yet */
    this.waiting = null;
    /** @type {any} */
    this.viewTimer = null;
    /** @type {any} a quiet line's end, cleared on stop too: a stream that never ends never reaches read()'s finally */
    this.idle = null;
    this.viewAt = 0;
  }

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (this.viewTimer) this.clearTimer(this.viewTimer);
    this.viewTimer = null;
    if (this.idle) this.clearTimer(this.idle);
    this.idle = null;
    this.abort?.abort();
    this.abort = null;
  }

  /** Try again now rather than at the next retry: you opened the hub, say. */
  retryNow() {
    if (this.closed || this.state === 'online' || this.state === 'unpaired') return;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.retryMs = MIN_RETRY_MS;
    this.connect();
  }

  /**
   * @param {string} state
   * @param {string | null} [error]
   */
  setState(state, error = null) {
    if (this.state === state && this.error === error) return;
    this.state = state;
    this.error = error;
    this.emit('change');
  }

  headers(extra = {}) {
    const token = this.token();
    return { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra };
  }

  async connect() {
    if (this.closed) return;
    if (!this.token()) { this.setState('unpaired', 'This PC needs pairing again.'); return; }
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const connectTimer = this.setTimer(() => abort.abort(), CONNECT_TIMEOUT_MS);
    try {
      const res = await this.fetch(`${this.origin}${API}/events`, { headers: this.headers({ Accept: 'text/event-stream' }), signal: abort.signal, redirect: 'error' });
      this.clearTimer(connectTimer);
      if (!res.ok) res.body?.cancel?.().catch(() => {}); // nothing in it is read: let the socket go
      if (res.status === 401) { this.setState('unpaired', 'That PC forgot this hub. Pair it again.'); return; }
      if (res.status === 403) { this.setState('offline', "That PC turned the hub away: it's signed in to Tailscale as someone else."); this.later(); return; }
      if (!res.ok || !res.body) { this.setState('offline', `That PC answered ${res.status}.`); this.later(); return; }
      this.retryMs = MIN_RETRY_MS;
      await this.read(res.body, abort);
    } catch (err) {
      this.clearTimer(connectTimer);
      if (this.closed || (abort.signal.aborted && this.abort !== abort)) return; // replaced or stopped
      this.setState('offline', err?.name === 'AbortError' ? 'No answer: it may be asleep or offline.' : 'Not reachable: it may be asleep or offline.');
    }
    if (!this.closed && this.abort === abort) this.later();
  }

  async read(body, abort) {
    const decoder = new TextDecoder();
    let buffer = '';
    // A line that goes quiet (a half-open connection, a PC that froze) is ended, not trusted as online.
    /** @type {any} this line's own timer: a line that replaced it has its own */
    let mine = null;
    const quiet = () => {
      if (this.idle) this.clearTimer(this.idle);
      this.idle = mine = this.closed ? null : this.setTimer(() => abort.abort(), IDLE_MS);
    };
    quiet();
    try {
      for await (const chunk of body) {
        if (abort.signal.aborted) return;
        quiet();
        buffer += decoder.decode(chunk, { stream: true });
        const { events, rest } = parseEvents(buffer);
        buffer = rest;
        // Only the newest view matters: the ones before it in the same burst are never parsed.
        const view = events.filter(e => e.event === 'view' && e.data.length <= MAX_EVENT).at(-1);
        if (view) this.queueView(view.data);
      }
    } finally {
      if (mine && this.idle === mine) { this.clearTimer(mine); this.idle = null; }
    }
    if (!this.closed) this.setState('offline', 'The connection closed.');
  }

  /** At most one view read a second: a PC sending a flood of them can't keep the hub's main thread busy. */
  queueView(data) {
    this.waiting = data;
    if (this.viewTimer) return;
    const due = Math.max(0, (this.viewAt || 0) + VIEW_EVERY_MS - this.now());
    this.viewTimer = this.setTimer(() => {
      this.viewTimer = null;
      const next = this.waiting;
      this.waiting = null;
      this.viewAt = this.now();
      if (next != null && !this.closed) this.onEvent({ event: 'view', data: next });
    }, due);
  }

  onEvent({ event, data }) {
    if (event !== 'view') return;
    let view;
    try { view = JSON.parse(data); } catch { return; }
    if (!view || typeof view !== 'object') return;
    this.view = view;
    this.seenAt = this.now();
    this.setState('online');
    this.emit('view', view);
  }

  later() {
    if (this.closed || this.timer) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
    this.timer = this.setTimer(() => { this.timer = null; this.connect(); }, wait);
  }

  /** Do something on that PC: POST /pocket/v1/<action>. -> its answer, or { ok: false, error }. */
  async act(action, body = {}) {
    if (!/^[a-z-]{1,30}$/.test(action)) return { ok: false, error: 'Unknown action.' };
    if (!this.token()) return { ok: false, error: 'This PC needs pairing again.' };
    const abort = new AbortController();
    const timer = this.setTimer(() => abort.abort(), ACTION_TIMEOUT_MS);
    try {
      const text = JSON.stringify(body);
      if (text.length > MAX_BODY) return { ok: false, error: 'That is too much to send.' };
      const res = await this.fetch(`${this.origin}${API}/${action}`, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: text, signal: abort.signal, redirect: 'error' });
      if (res.status === 401) { this.setState('unpaired', 'That PC forgot this hub. Pair it again.'); return { ok: false, error: 'That PC forgot this hub. Pair it again.' }; }
      const r = await res.json().catch(() => null);
      return r && typeof r === 'object' ? r : { ok: false, error: `That PC answered ${res.status}.` };
    } catch {
      return { ok: false, error: "Couldn't reach that PC. It may be asleep or offline." };
    } finally {
      this.clearTimer(timer);
    }
  }
}

/**
 * Pair with a PC: POST /pocket/v1/pair with the code it shows. -> { ok, token } or { ok: false, error }.
 * @param {{ origin: string, code: string, name: string, fetch?: typeof fetch }} o
 */
async function pair({ origin, code, name, fetch: f = globalThis.fetch }) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  if (clean.length < 6) return { ok: false, error: 'Type the code that PC shows (Settings, Alerts, On your phone, Pair a phone).' };
  let res;
  try {
    res = await f(`${origin}${API}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ code: clean, name: String(name || '').slice(0, 80) }), signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS), redirect: 'error' });
  } catch {
    return { ok: false, error: "Couldn't reach that PC. Check it's on, and that Shellby on your phone is turned on there." };
  }
  const r = await res.json().catch(() => null);
  if (res.ok && r?.ok && typeof r.token === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(r.token)) return { ok: true, token: r.token };
  if (res.status === 403 && r?.error) return { ok: false, error: String(r.error).slice(0, 200) };
  if (res.status === 403) return { ok: false, error: "That PC turned the hub away: it's signed in to Tailscale as someone else." };
  return { ok: false, error: r?.error ? String(r.error).slice(0, 200) : `That PC answered ${res.status}.` };
}

module.exports = { PeerLink, parseEvents, pair, API, MIN_RETRY_MS, MAX_RETRY_MS };
