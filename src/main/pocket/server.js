// Shellby on your phone: the server the phone app talks to.
//
// It listens on 127.0.0.1 only, like the plugin listener, the overlay and the
// Stream Deck keys next door. Tailscale's `serve` is what puts it on your
// tailnet (pocket/tailscale.js); nothing on your Wi-Fi can reach it directly.
//
// It serves two things:
//   - the app itself: a fixed table of files built at startup (as obs.js does),
//     so no part of a request ever becomes part of a path;
//   - /pocket/v1: a stream of what Shellby is doing (server-sent events over a
//     plain fetch, so the token rides in a header, never in a URL), and a few
//     POSTs for what you can do from the phone.
//
// Who gets in, checked on every request (refuse):
//   - Host is ours: 127.0.0.1 or localhost on our port, or this PC's .ts.net
//     name. Anything else is DNS rebinding or a request that took a wrong turn.
//   - Through Tailscale, the Tailscale-User-Login header (which Tailscale sets
//     and strips from what the phone sends) must be the login you turned this
//     on with. Funnel requests (from the open internet) are refused outright.
//   - An Origin, when a browser sends one, must be this server's own.
//   - Every /pocket/v1 call but pairing carries a device token (pocket/pairing.js).
//
// What a call may do is decided in wiring/pocket.js: Allow, Deny, and Always
// allow where the desk card offers it; questions and plans through their own
// sheets; never Allow on anything appDeskOnlyReason keeps for the desk; and by
// the phone's own rights level (pocket/rights.js), set at the desk.
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULT_PORT = 47916;          // next door to the Stream Deck keys
const API = '/pocket/v1';
const MAX_CLIENTS = 24;              // a few phones, each with a stale stream or two while iOS reconnects
const MAX_PER_DEVICE = 4;
const MAX_BODY = 16 * 1024;          // a task is 4,000 characters at most
const KEEPALIVE_MS = 15000;          // phones and proxies drop a quiet stream sooner than desktops do
const PAIR_PER_HOUR = 30;            // the code takes five tries; this keeps a flood out of the log
const ACTIONS_PER_MINUTE = 120;

const ACTIONS = [
  'answer', 'task', 'reply', 'stop', 'undo', 'home', 'reviewed', 'cancel-held', 'push', 'forget',
  // pocket/extras.js
  'focus', 'routines', 'routine-run', 'routine-toggle', 'workflow-run', 'notes', 'note-add', 'note-tick',
  'wardrobe', 'wear', 'pet', 'files', 'file',
  // pocket/review.js
  'find', 'project-history', 'past', 'away', 'checks', 'checks-fix', 'branch',
  // pocket/quiet.js
  'quiet',
  // pocket/talk.js
  'rename', 'effort', 'close', 'history', 'resume',
  // wiring/pocket.js lookOver, pocket/extras.js progress
  'look-over', 'progress',
];
const MAX_UPLOAD = 6 * 1024 * 1024; // a photo for a task, made smaller on the phone first
const UPLOAD_TYPES = ['image/jpeg', 'image/png'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// The page may run its own scripts and styles, talk to this server, and
// nothing else: no inline script, no other host, no framing.
const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'", "img-src 'self' data: blob:",
  "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

/** Every file the app needs, by URL. Anything not in here 404s. */
function routeTable(srcDir, assetsDir) {
  const app = f => path.join(srcDir, 'renderer', 'pocket', f);
  const r = {
    '/': app('index.html'),
    '/index.html': app('index.html'),
    '/pocket.css': app('pocket.css'),
    '/pocket.js': app('pocket.js'),
    '/pocket-logic.js': app('pocket-logic.js'),
    '/pocket-stream.js': app('pocket-stream.js'),
    '/pocket-draw.js': app('pocket-draw.js'),
    '/pocket-tab.js': app('pocket-tab.js'),
    '/pocket-more.js': app('pocket-more.js'),
    '/pocket-bits.js': app('pocket-bits.js'),
    '/pocket-find.js': app('pocket-find.js'),
    '/pocket-phone.js': app('pocket-phone.js'),
    '/pocket-new.js': app('pocket-new.js'),
    '/sw.js': app('sw.js'),
    '/manifest.webmanifest': app('manifest.webmanifest'),
    // He's on the pairing screen before the PC has said which skin he wears.
    '/skin.json': path.join(srcDir, 'skins', 'classic.json'),
    '/shared/sprite.js': path.join(srcDir, 'renderer', 'shared', 'sprite.js'),
    '/shared/fonts.css': path.join(srcDir, 'renderer', 'shared', 'fonts.css'),
    '/shared/tokens.css': path.join(srcDir, 'renderer', 'shared', 'tokens.css'),
  };
  for (const icon of ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'badge-96.png']) {
    r[`/icons/${icon}`] = path.join(assetsDir, 'pocket', icon);
  }
  for (const font of ['PixelifySans.ttf', 'AtkinsonHyperlegible-Regular.ttf', 'AtkinsonHyperlegible-Bold.ttf', 'MartianMono.ttf']) {
    r[`/assets/fonts/${font}`] = path.join(assetsDir, 'fonts', font);
  }
  return r;
}

const lower = s => String(s || '').toLowerCase();

/** Fixed-window counter: at most `max` per `ms`. */
function limiter(max, ms) {
  let start = 0, n = 0;
  return now => {
    if (now - start >= ms) { start = now; n = 0; }
    n++;
    return n <= max;
  };
}

class PocketServer extends EventEmitter {
  /**
   * srcDir/assetsDir: where the app and its fonts live.
   * getPlace():        { dnsName, httpsPort } this PC is served at on the tailnet, or nulls
   * ownerLogin():      the Tailscale login it was turned on with ('' refuses every tailnet request)
   * findDevice(token): the paired device, or null
   * onPair({ code, name, login }) -> { ok, token, deviceId } | { ok: false, error }
   * onOpen(device, { tab }) -> { view, items? }: the first thing a stream is sent
   * onAction(device, action, body) -> Promise<{ ok, ... }>
   * onDiff(device, { tab, after, file }) -> Promise<{ ok, patch } | { ok: false, error }>
   * onUpload(device, bytes) -> { ok, id } | { ok: false, error }: a photo for a new task
   */
  constructor({ srcDir, assetsDir, port = DEFAULT_PORT, getPlace, ownerLogin, findDevice, onPair, onOpen, onAction, onDiff, onUpload, now = Date.now }) {
    super();
    this.routes = routeTable(srcDir, assetsDir);
    this.port = port;
    this.getPlace = getPlace;
    this.ownerLogin = ownerLogin;
    this.findDevice = findDevice;
    this.onPair = onPair;
    this.onOpen = onOpen;
    this.onAction = onAction;
    this.onDiff = onDiff;
    this.onUpload = onUpload;
    this.now = now;
    this.server = null;
    this.clients = new Set();      // { res, device, tab }
    this.status = 'off';           // 'off' | 'listening' | 'busy' | 'error'
    /** @type {NodeJS.Timeout | null} */
    this.keepalive = null;
    this.pairs = limiter(PAIR_PER_HOUR, 60 * 60 * 1000);
    this.actionLimits = new Map(); // device id -> limiter
  }

  get connected() { return new Set([...this.clients].map(c => c.device.id)).size; }

  view() {
    return { status: this.status, port: this.port, connected: this.connected, streams: this.clients.size };
  }

  start() {
    if (this.server) return;
    const server = http.createServer((req, res) => this.handle(req, res));
    server.headersTimeout = 5000;
    server.requestTimeout = 15000;
    server.on('error', err => {
      clearInterval(this.keepalive ?? undefined);
      this.keepalive = null;
      this.server = null;
      this.status = /** @type {NodeJS.ErrnoException} */ (err).code === 'EADDRINUSE' ? 'busy' : 'error';
      this.emit('status', this.view());
    });
    server.listen(this.port, '127.0.0.1', () => {
      this.port = /** @type {import('net').AddressInfo} */ (server.address()).port;
      this.status = 'listening';
      this.keepalive = setInterval(() => this.write(() => true, ': ping\n\n'), KEEPALIVE_MS);
      this.emit('status', this.view());
    });
    this.server = server;
  }

  stop() {
    clearInterval(this.keepalive ?? undefined);
    this.keepalive = null;
    for (const c of this.clients) { try { c.res.end(); } catch { /* gone */ } }
    this.clients.clear();
    this.server?.close();
    this.server?.closeAllConnections?.();
    this.server = null;
    this.status = 'off';
    this.emit('status', this.view());
  }

  // ---------------------------------------------------------------- streams

  /**
   * The whole view, to every phone. forDevice(view, device), when given, is each phone's own copy (its rights).
   * @param {any} view
   * @param {((view: any, device: any) => any) | null} [forDevice]
   */
  broadcast(view, forDevice = null) {
    if (!forDevice) { this.write(() => true, `event: view\ndata: ${JSON.stringify(view)}\n\n`); return; }
    for (const c of [...this.clients]) {
      try { c.res.write(`event: view\ndata: ${JSON.stringify(forDevice(view, c.device))}\n\n`); } catch { this.drop(c); }
    }
  }

  /** One transcript item, to the phones that have that conversation open. */
  item(tabId, item) {
    this.write(c => c.tab === tabId, `event: item\ndata: ${JSON.stringify({ tabId, item })}\n\n`);
  }

  /** A phone that was forgotten: its streams end now, with the reason. */
  dropDevice(deviceId, reason = 'forgotten') {
    for (const c of [...this.clients]) {
      if (c.device.id !== deviceId) continue;
      try { c.res.end(`event: bye\ndata: ${JSON.stringify({ reason })}\n\n`); } catch { /* gone */ }
      this.clients.delete(c);
    }
    this.emit('status', this.view());
  }

  /** Watching tabs: which conversations some phone has open right now. */
  watched() {
    return new Set([...this.clients].map(c => c.tab).filter(Boolean));
  }

  write(which, chunk) {
    for (const c of [...this.clients]) {
      if (!which(c)) continue;
      try { c.res.write(chunk); } catch { this.drop(c); }
    }
  }

  drop(c) {
    if (!this.clients.delete(c)) return;
    try { c.res.end(); } catch { /* already gone */ }
    this.emit('status', this.view());
  }

  // ---------------------------------------------------------------- the door

  /**
   * Who may ask at all. -> { no: status } to refuse, or { place } where
   * place says how it arrived: { tailnet, origin } (origin: the one a browser
   * here would send).
   * @returns {{ no: number, place?: undefined } | { no?: undefined, place: { tailnet: boolean, origin: string, login: string } }}
   */
  check(req) {
    const host = lower(req.headers.host);
    const place = this.getPlace?.() || {};
    const dns = lower(place.dnsName);
    const httpsPort = Number(place.httpsPort) || 443;
    const tsHost = dns && (host === dns || host === `${dns}:${httpsPort}`);
    const loop = host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
    if (!tsHost && !loop) return { no: 421 };
    // From the open internet through Funnel: never.
    if (req.headers['tailscale-funnel-request'] != null) return { no: 403 };
    const login = req.headers['tailscale-user-login'];
    // A proxied request is a tailnet one, whatever Host it claims: Tailscale's
    // serve keeps the phone's Host as sent and adds the X-Forwarded headers, and
    // a tagged device gets no login header at all. Only a request straight from
    // this PC has none of them.
    const proxied = Object.keys(req.headers).some(h => h.startsWith('x-forwarded-') || h.startsWith('tailscale-') || h === 'forwarded' || h === 'via');
    const tailnet = tsHost || proxied;
    if (tailnet) {
      const owner = lower(this.ownerLogin?.());
      if (!owner || lower(login) !== owner) return { no: 403 };
    }
    const origin = tsHost ? `https://${dns}${httpsPort === 443 ? '' : `:${httpsPort}`}` : `http://${host}`;
    const said = req.headers.origin;
    if (said != null && lower(said) !== origin) return { no: 403 };
    return { place: { tailnet, origin, login: typeof login === 'string' ? login.slice(0, 200) : '' } };
  }

  tokenOf(req) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(String(req.headers.authorization || ''));
    return m ? m[1] : null;
  }

  handle(req, res) {
    const gate = this.check(req);
    if (!gate.place) { plain(res, gate.no, gate.no === 421 ? 'Wrong address.' : 'No.'); return; }
    let url;
    try { url = new URL(String(req.url || '/'), 'http://x'); } catch { plain(res, 400, 'Bad address.'); return; }
    const route = url.pathname;
    // Shared from another app before the service worker took over (it keeps
    // what was shared, sw.js): the app opens on a new task all the same.
    // Its body is never read: the connection closes behind the answer.
    if (route === '/share' && req.method === 'POST') { res.writeHead(303, { Location: '/#/share', 'Cache-Control': 'no-store', Connection: 'close' }).end(() => req.destroy()); return; }
    if (!route.startsWith(`${API}/`)) { this.file(req, res, route); return; }

    const name = route.slice(API.length + 1);
    if (name === 'pair' && req.method === 'POST') { this.pair(req, res, gate.place); return; }
    const device = this.findDevice?.(this.tokenOf(req)) || null;
    if (name === 'hello' && req.method === 'GET') { json(res, 200, { ok: true, paired: !!device }); return; }
    if (!device) { json(res, 401, { ok: false, error: 'unpaired' }); return; }
    // A device paired by one Tailscale login is only ever used by it.
    if (gate.place.tailnet && device.login && lower(device.login) !== lower(gate.place.login)) { json(res, 403, { ok: false, error: 'login' }); return; }
    this.emit('seen', device);

    if (name === 'events' && req.method === 'GET') { this.subscribe(req, res, device, url.searchParams.get('tab')); return; }
    if (name === 'diff' && req.method === 'GET') { this.diff(res, device, url.searchParams); return; }
    if (name === 'upload' && req.method === 'POST') { this.upload(req, res, device); return; }
    if (ACTIONS.includes(name) && req.method === 'POST') { this.action(req, res, device, name); return; }
    json(res, 404, { ok: false, error: 'unknown' });
  }

  file(req, res, route) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    if (route === '/favicon.ico') { res.writeHead(204).end(); return; }
    const file = Object.prototype.hasOwnProperty.call(this.routes, route) ? this.routes[route] : null;
    if (!file) { plain(res, 404, 'Not here.'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { plain(res, 404, 'Not here.'); return; }
      const etag = `"${crypto.createHash('sha1').update(data).digest('base64url')}"`;
      const headers = {
        'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
        // Asked again every time, answered "same as before" when it is: an
        // update to Shellby reaches the phone the next time it opens.
        'Cache-Control': 'no-cache',
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
      };
      if (file.endsWith('.html')) Object.assign(headers, { 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY' });
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers).end(); return; }
      res.writeHead(200, { ...headers, 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  subscribe(req, res, device, tab) {
    const mine = [...this.clients].filter(c => c.device.id === device.id);
    // A phone coming back from sleep opens a new stream before the old one is
    // noticed gone: the old one makes way, rather than the phone being turned away.
    while (mine.length >= MAX_PER_DEVICE) this.drop(mine.shift());
    if (this.clients.size >= MAX_CLIENTS) { json(res, 503, { ok: false, error: 'busy' }); return; }
    const tabId = typeof tab === 'string' && /^[\w-]{1,100}$/.test(tab) ? tab : null;
    let first;
    try { first = this.onOpen?.(device, { tab: tabId }); } catch { first = null; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    const c = { res, device, tab: tabId };
    this.clients.add(c);
    req.on('close', () => this.drop(c));
    res.on('error', () => this.drop(c));
    res.write(`retry: 2000\n\nevent: view\ndata: ${JSON.stringify(first?.view ?? null)}\n\n`);
    if (tabId && first?.items) res.write(`event: items\ndata: ${JSON.stringify({ tabId, items: first.items })}\n\n`);
    this.emit('status', this.view());
  }

  async diff(res, device, q) {
    const tab = q.get('tab'), after = q.get('after'), file = q.get('file');
    if (!/^[\w-]{1,100}$/.test(tab || '') || !/^[\w-]{1,100}$/.test(after || '')) { json(res, 400, { ok: false, error: 'bad' }); return; }
    if (!this.allowed(device)) { json(res, 429, { ok: false, error: 'slow down' }); return; }
    let r;
    try { r = await this.onDiff?.(device, { tab, after, file: typeof file === 'string' ? file.slice(0, 500) : null }); } catch { r = { ok: false, error: 'failed' }; }
    json(res, 200, r && typeof r === 'object' ? r : { ok: false });
  }

  allowed(device) {
    if (!this.actionLimits.has(device.id)) this.actionLimits.set(device.id, limiter(ACTIONS_PER_MINUTE, 60 * 1000));
    return this.actionLimits.get(device.id)(this.now());
  }

  pair(req, res, place) {
    if (!this.pairs(this.now())) { json(res, 429, { ok: false, error: 'slow down' }); return; }
    readJson(req, res, async msg => {
      if (typeof msg?.code !== 'string') { json(res, 400, { ok: false, error: 'bad' }); return; }
      let r;
      try {
        r = await this.onPair?.({
          code: msg.code.slice(0, 32),
          name: typeof msg.name === 'string' ? msg.name.slice(0, 80) : '',
          agent: String(req.headers['user-agent'] || '').slice(0, 300),
          login: place.login,
        });
      } catch { r = { ok: false, error: 'failed' }; }
      json(res, r?.ok ? 200 : 403, r && typeof r === 'object' ? r : { ok: false });
    });
  }

  /** A picture, as its own bytes (not JSON), capped: the phone shrinks it to a JPEG first. */
  upload(req, res, device) {
    if (!this.allowed(device)) { json(res, 429, { ok: false, error: 'slow down' }); return; }
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!UPLOAD_TYPES.includes(type)) { json(res, 415, { ok: false, error: 'Send a JPEG or PNG.' }); return; }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', chunk => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_UPLOAD) { over = true; json(res, 413, { ok: false, error: 'That picture is too big.' }); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) return;
      let r;
      try { r = this.onUpload?.(device, Buffer.concat(chunks)); } catch { r = { ok: false, error: 'failed' }; }
      json(res, 200, r && typeof r === 'object' ? r : { ok: false });
    });
  }

  action(req, res, device, name) {
    if (!this.allowed(device)) { json(res, 429, { ok: false, error: 'slow down' }); return; }
    readJson(req, res, async msg => {
      let r;
      try { r = await this.onAction?.(device, name, msg && typeof msg === 'object' ? msg : {}); } catch { r = { ok: false, error: 'failed' }; }
      json(res, 200, r && typeof r === 'object' ? r : { ok: !!r });
    });
  }
}

function plain(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' }).end(text);
}

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(body));
}

/** A JSON body, capped; answers 415, 413 or 400 itself. */
function readJson(req, res, then) {
  if (!/^application\/json\b/.test(String(req.headers['content-type'] || ''))) { json(res, 415, { ok: false, error: 'json' }); return; }
  let body = '';
  let over = false;
  req.setEncoding('utf8');
  req.on('data', chunk => {
    if (over) return;
    body += chunk;
    if (body.length > MAX_BODY) { over = true; json(res, 413, { ok: false, error: 'too big' }); req.destroy(); }
  });
  req.on('end', () => {
    if (over) return;
    let msg;
    try { msg = JSON.parse(body || '{}'); } catch { json(res, 400, { ok: false, error: 'json' }); return; }
    then(msg);
  });
}

module.exports = { ACTIONS, API, CSP, DEFAULT_PORT, MAX_BODY, MAX_UPLOAD, MAX_CLIENTS, MAX_PER_DEVICE, PocketServer, TYPES, routeTable };
