// One conversation on another PC, open on the hub (docs/HUB.md).
//
// That PC's phone feed sends a conversation's transcript to whoever opens it:
// GET /pocket/v1/events?tab=<id> starts with its tail (`items`, pocket/view.js
// phoneItems) and then each new step (`item`), with Claude's reply as it's
// typed (`partial`, the whole text so far). The hub reads it the way the phone
// app does, one conversation at a time: the one open in Your PCs.
//
// Everything in it is untrusted: each item is rebuilt from the few fields the
// hub draws, strings cut short, and anything else dropped (cleanItem).
//
// fetch and timers are injected, so test/hub-convo.test.js runs it against a fake PC.
const { EventEmitter } = require('events');
const { parseEvents, API } = require('./link');

const MAX_ITEMS = 300;               // as many as the PC sends when it's opened
const MAX_EVENT = 512 * 1024;
const IDLE_MS = 60 * 1000;           // the PC sends a keepalive every 15 s
const CONNECT_TIMEOUT_MS = 15 * 1000;
const RETRY_MS = 3000;
const MAX_RETRY_MS = 30 * 1000;
const TAB_RE = /^[\w-]{1,100}$/;

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = v => (Number.isFinite(v) ? v : null);

/** One transcript step as the hub draws it, rebuilt from what the PC sent, or null. */
function cleanItem(i) {
  if (!i || typeof i !== 'object' || Array.isArray(i)) return null;
  const sub = i.sub === true;
  switch (i.k) {
    case 'user': return { k: 'user', text: str(i.text, 4000) };
    case 'text': return { k: 'text', text: str(i.text, 8000), sub };
    case 'partial': return { k: 'partial', text: str(i.text, 8000) };
    case 'tool': return { k: 'tool', name: str(i.name, 60), label: str(i.label, 80), detail: str(i.detail, 300), sub, agent: i.agent && typeof i.agent === 'object' ? str(i.agent.description, 160) || str(i.agent.type, 60) : '' };
    case 'done': return i.error ? { k: 'done', error: true, text: str(i.text, 300), sub } : null;
    case 'asked': return { k: 'asked', label: str(i.label, 80), detail: str(i.detail, 300) };
    case 'decision': return { k: 'decision', decision: str(i.decision, 20), via: str(i.via, 20) };
    case 'end': return { k: 'end', ok: !!i.ok, interrupted: !!i.interrupted, error: str(i.error, 300), seconds: num(i.seconds) };
    case 'note': return { k: 'note', text: str(i.text, 300) };
    case 'changes': return { k: 'changes', added: num(i.added) || 0, removed: num(i.removed) || 0, files: Array.isArray(i.files) ? Math.min(i.files.length, 999) + (num(i.more) || 0) : 0 };
    case 'checks': return { k: 'checks', status: str(i.status, 20), summary: str(i.summary, 200) };
    case 'task': return { k: 'task', description: str(i.description, 160), status: str(i.status, 30), phase: str(i.phase, 20) };
    default: return null;
  }
}

class ConvoLink extends EventEmitter {
  /**
   * @param {{ origin: string, tabId: string, token: () => string | null, fetch?: typeof fetch,
   *   setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} o
   */
  constructor({ origin, tabId, token, fetch: f = globalThis.fetch, setTimer = setTimeout, clearTimer = clearTimeout }) {
    super();
    if (!TAB_RE.test(tabId)) throw new Error('bad conversation id');
    this.origin = origin;
    this.tabId = tabId;
    this.token = token;
    this.fetch = f;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    /** @type {any[]} */
    this.items = [];
    this.typing = '';            // Claude's reply as it's typed, until the whole text arrives
    this.state = 'connecting';   // 'connecting' | 'online' | 'offline' | 'unpaired'
    /** @type {string | null} */
    this.error = null;
    this.loaded = false;         // its tail has arrived at least once
    this.retryMs = RETRY_MS;
    /** @type {any} */ this.timer = null;
    /** @type {AbortController | null} */ this.abort = null;
    /** @type {any} a quiet line's end, cleared on stop too: a stream that never ends never reaches read()'s finally */
    this.idle = null;
    this.closed = false;
    // Bumped on every change, and itemsAt on each change to the steps (not the reply being typed):
    // the panel asks with the one it has and gets the snapshot only when there's something new.
    this.version = 0;
    this.itemsAt = 0;
  }

  start() { this.closed = false; this.connect(); }

  stop() {
    this.closed = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    if (this.idle) this.clearTimer(this.idle);
    this.idle = null;
    this.abort?.abort();
    this.abort = null;
  }

  /**
   * @param {string} state
   * @param {string | null} [error]
   */
  setState(state, error = null) {
    if (this.state === state && this.error === error) return;
    this.state = state;
    this.error = error;
    this.changed();
  }

  changed() {
    this.version++;
    this.emit('change');
  }

  async connect() {
    if (this.closed) return;
    const token = this.token();
    if (!token) { this.setState('unpaired', 'That PC needs pairing again.'); return; }
    const abort = new AbortController();
    this.abort = abort;
    const connectTimer = this.setTimer(() => abort.abort(), CONNECT_TIMEOUT_MS);
    try {
      const url = `${this.origin}${API}/events?tab=${encodeURIComponent(this.tabId)}`;
      const res = await this.fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: abort.signal, redirect: 'error' });
      this.clearTimer(connectTimer);
      if (res.status === 401) { res.body?.cancel?.().catch(() => {}); this.setState('unpaired', 'That PC forgot this hub. Pair it again.'); return; }
      if (!res.ok || !res.body) { res.body?.cancel?.().catch(() => {}); this.setState('offline', `That PC answered ${res.status}.`); this.later(); return; }
      this.retryMs = RETRY_MS;
      await this.read(res.body, abort);
    } catch {
      this.clearTimer(connectTimer);
      if (this.closed || this.abort !== abort) return;
      this.setState('offline', 'Lost the line to that PC. Trying again.');
    }
    if (!this.closed && this.abort === abort) this.later();
  }

  async read(body, abort) {
    const decoder = new TextDecoder();
    let buffer = '';
    /** @type {any} this line's own timer: a line that replaced it has its own */
    let mine = null;
    const quiet = () => { if (this.idle) this.clearTimer(this.idle); this.idle = mine = this.closed ? null : this.setTimer(() => abort.abort(), IDLE_MS); };
    quiet();
    try {
      for await (const chunk of body) {
        if (abort.signal.aborted) return;
        quiet();
        buffer += decoder.decode(chunk, { stream: true });
        const { events, rest } = parseEvents(buffer);
        buffer = rest;
        let changed = false;
        for (const e of events) if (e.data.length <= MAX_EVENT && this.onEvent(e)) changed = true;
        if (changed) this.changed();
      }
    } finally {
      if (mine && this.idle === mine) { this.clearTimer(mine); this.idle = null; }
    }
    if (!this.closed) this.setState('offline', 'The connection closed. Trying again.');
  }

  /** -> whether what's shown changed. Only events about this conversation count. */
  onEvent({ event, data }) {
    if (event === 'view') { this.setState('online'); return false; }
    if (event !== 'items' && event !== 'item') return false;
    let msg;
    try { msg = JSON.parse(data); } catch { return false; }
    if (!msg || typeof msg !== 'object' || msg.tabId !== this.tabId) return false;
    if (event === 'items') {
      this.items = (Array.isArray(msg.items) ? msg.items.slice(-MAX_ITEMS) : []).map(cleanItem).filter(i => i && i.k !== 'partial');
      this.typing = '';
      this.loaded = true;
      this.itemsAt++;
      this.setState('online');
      return true;
    }
    const item = cleanItem(msg.item);
    if (!item) return false;
    if (item.k === 'partial') { this.typing = item.text || ''; return true; }
    if ((item.k === 'text' && !item.sub) || item.k === 'end') this.typing = '';
    this.items.push(item);
    this.itemsAt++;
    if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
    return true;
  }

  later() {
    if (this.closed || this.timer) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
    this.timer = this.setTimer(() => { this.timer = null; this.connect(); }, wait);
  }

  snapshot() {
    return { tabId: this.tabId, version: this.version, itemsAt: this.itemsAt, state: this.state, error: this.error, loaded: this.loaded, items: this.items, typing: this.typing };
  }
}

module.exports = { ConvoLink, cleanItem, MAX_ITEMS, TAB_RE };
