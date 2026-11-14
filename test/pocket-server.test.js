const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { PocketServer, routeTable, API, MAX_PER_DEVICE } = require('../src/main/pocket/server');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ASSETS = path.join(ROOT, 'assets');
const TOKEN = 'a'.repeat(43);
const DEVICE = { id: '0123456789abcdef', name: 'iPhone', login: 'me@example.com' };
const DNS = 'desk-pc.tail4e2b.ts.net';

function boot(over = {}) {
  const calls = { actions: [], pairs: [], opens: [], diffs: [] };
  const server = new PocketServer({
    srcDir: SRC, assetsDir: ASSETS, port: 0,
    getPlace: () => ({ dnsName: DNS, httpsPort: 443 }),
    ownerLogin: () => 'me@example.com',
    findDevice: t => (t === TOKEN ? DEVICE : null),
    onPair: async p => { calls.pairs.push(p); return p.code === 'GOODCODE' ? { ok: true, token: TOKEN, deviceId: DEVICE.id } : { ok: false, error: 'wrong' }; },
    onOpen: (device, { tab }) => { calls.opens.push(tab); return { view: { v: 1, tabs: [] }, items: tab ? [{ k: 'text', text: 'hi' }] : undefined }; },
    onAction: async (device, name, body) => { calls.actions.push({ name, body }); return { ok: true, name }; },
    onDiff: async (device, q) => { calls.diffs.push(q); return { ok: true, patch: '+x' }; },
    ...over,
  });
  return new Promise(resolve => {
    server.once('status', () => resolve({ server, calls, port: server.port }));
    server.start();
  });
}

function request(port, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, method, path: url, agent: false,
      headers: { Host: `127.0.0.1:${port}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const auth = { Authorization: `Bearer ${TOKEN}` };

test('every file in the route table is there', () => {
  for (const [url, file] of Object.entries(routeTable(SRC, ASSETS))) assert.ok(fs.existsSync(file), `${url} -> ${file}`);
});

test('the app is served with its own CSP, and nothing outside the table is', async () => {
  const { server, port } = await boot();
  try {
    const page = await request(port, { url: '/' });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /script-src 'self'/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(page.headers['x-frame-options'], 'DENY');
    const again = await request(port, { url: '/', headers: { 'If-None-Match': page.headers.etag } });
    assert.equal(again.status, 304);
    assert.equal((await request(port, { url: '/manifest.webmanifest' })).headers['content-type'], 'application/manifest+json; charset=utf-8');
    for (const bad of ['/../package.json', '/%2e%2e/package.json', '/src/main/main.js', '/shared/../../main/main.js', '/icons/../../package.json']) {
      assert.equal((await request(port, { url: bad })).status, 404, bad);
    }
    assert.equal((await request(port, { method: 'POST', url: '/' })).status, 405);
  } finally { server.stop(); }
});

test('a Host that is not ours is turned away: DNS rebinding', async () => {
  const { server, port } = await boot();
  try {
    assert.equal((await request(port, { headers: { Host: 'evil.example.com' } })).status, 421);
    assert.equal((await request(port, { headers: { Host: `127.0.0.1:${port + 1}` } })).status, 421);
    assert.equal((await request(port, { headers: { Host: `${DNS}.evil.com` } })).status, 421);
  } finally { server.stop(); }
});

test('through Tailscale, only the login it was turned on with gets in, and Funnel never does', async () => {
  const { server, port } = await boot();
  try {
    const ts = extra => request(port, { headers: { Host: DNS, ...extra } });
    assert.equal((await ts({ 'Tailscale-User-Login': 'me@example.com' })).status, 200);
    assert.equal((await ts({ 'Tailscale-User-Login': 'ME@example.com' })).status, 200);
    assert.equal((await ts({ 'Tailscale-User-Login': 'someone@else.com' })).status, 403);
    assert.equal((await ts({})).status, 403);
    assert.equal((await ts({ 'Tailscale-User-Login': 'me@example.com', 'Tailscale-Funnel-Request': '?1' })).status, 403);
    // The login header on a loopback Host still has to be the owner's.
    assert.equal((await request(port, { headers: { 'Tailscale-User-Login': 'someone@else.com' } })).status, 403);
  } finally { server.stop(); }
});

test('a proxied request is a tailnet one, whatever Host it claims', async () => {
  const { server, port } = await boot();
  try {
    // A tagged device through serve: the phone's own Host kept, no login, the proxy's headers added.
    assert.equal((await request(port, { headers: { 'X-Forwarded-For': '100.64.0.9' } })).status, 403);
    assert.equal((await request(port, { headers: { 'X-Forwarded-Proto': 'https' } })).status, 403);
    assert.equal((await request(port, { headers: { 'X-Forwarded-For': '100.64.0.9', 'Tailscale-User-Login': 'me@example.com' } })).status, 200);
  } finally { server.stop(); }
});

test('with no owner yet, nothing comes in through Tailscale', async () => {
  const { server, port } = await boot({ ownerLogin: () => '' });
  try {
    assert.equal((await request(port, { headers: { Host: DNS, 'Tailscale-User-Login': 'me@example.com' } })).status, 403);
  } finally { server.stop(); }
});

test('an Origin must be the server’s own', async () => {
  const { server, port } = await boot();
  try {
    assert.equal((await request(port, { headers: { Origin: 'https://evil.example.com' } })).status, 403);
    assert.equal((await request(port, { headers: { Origin: `http://127.0.0.1:${port}` } })).status, 200);
    const ts = { Host: DNS, 'Tailscale-User-Login': 'me@example.com' };
    assert.equal((await request(port, { headers: { ...ts, Origin: `https://${DNS}` } })).status, 200);
    assert.equal((await request(port, { headers: { ...ts, Origin: `http://${DNS}` } })).status, 403);
  } finally { server.stop(); }
});

test('the API needs a device token, except to pair', async () => {
  const { server, port, calls } = await boot();
  try {
    assert.equal((await request(port, { url: `${API}/events` })).status, 401);
    assert.equal((await request(port, { url: `${API}/events`, headers: { Authorization: 'Bearer wrong-token-wrong-token' } })).status, 401);
    assert.equal((await request(port, { method: 'POST', url: `${API}/stop`, body: { tabId: 'x' } })).status, 401);
    assert.deepEqual((await request(port, { url: `${API}/hello` })).json, { ok: true, paired: false });
    assert.deepEqual((await request(port, { url: `${API}/hello`, headers: auth })).json, { ok: true, paired: true });

    const bad = await request(port, { method: 'POST', url: `${API}/pair`, body: { code: 'NOPE' } });
    assert.equal(bad.status, 403);
    const good = await request(port, { method: 'POST', url: `${API}/pair`, body: { code: 'GOODCODE', name: 'Mine' }, headers: { 'User-Agent': 'iPhone' } });
    assert.equal(good.status, 200);
    assert.equal(good.json.token, TOKEN);
    assert.equal(calls.pairs[1].agent, 'iPhone');
  } finally { server.stop(); }
});

test('a device paired by one Tailscale login is not used by another', async () => {
  const { server, port } = await boot({ ownerLogin: () => 'other@example.com' });
  try {
    const r = await request(port, { url: `${API}/hello`, headers: { ...auth, Host: DNS, 'Tailscale-User-Login': 'other@example.com' } });
    assert.equal(r.status, 200);
    const e = await request(port, { url: `${API}/events`, headers: { ...auth, Host: DNS, 'Tailscale-User-Login': 'other@example.com' } });
    assert.equal(e.status, 403);
  } finally { server.stop(); }
});

test('actions are JSON, small, and only the known ones', async () => {
  const { server, port, calls } = await boot();
  try {
    const ok = await request(port, { method: 'POST', url: `${API}/answer`, headers: auth, body: { tabId: 't', requestId: 'r', decision: 'allow' } });
    assert.deepEqual(ok.json, { ok: true, name: 'answer' });
    assert.deepEqual(calls.actions[0], { name: 'answer', body: { tabId: 't', requestId: 'r', decision: 'allow' } });
    assert.equal((await request(port, { method: 'POST', url: `${API}/answer`, headers: { ...auth, 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
    assert.equal((await request(port, { method: 'POST', url: `${API}/answer`, headers: auth, body: '{nope' })).status, 400);
    assert.equal((await request(port, { method: 'POST', url: `${API}/answer`, headers: auth, body: { text: 'x'.repeat(20000) } }).catch(() => ({ status: 413 }))).status, 413);
    assert.equal((await request(port, { method: 'POST', url: `${API}/settings`, headers: auth, body: {} })).status, 404);
    assert.equal((await request(port, { method: 'GET', url: `${API}/answer`, headers: auth })).status, 404);
  } finally { server.stop(); }
});

test('a photo upload is a JPEG or PNG, paired, and handed over as bytes', async () => {
  const got = [];
  const { server, port } = await boot({ onUpload: (device, bytes) => { got.push(bytes.length); return { ok: true, id: 'p1' }; } });
  try {
    const jpeg = { ...auth, 'Content-Type': 'image/jpeg' };
    assert.deepEqual((await request(port, { method: 'POST', url: `${API}/upload`, headers: jpeg, body: 'abcd' })).json, { ok: true, id: 'p1' });
    assert.deepEqual(got, [4]);
    assert.equal((await request(port, { method: 'POST', url: `${API}/upload`, headers: { ...auth, 'Content-Type': 'image/gif' }, body: 'abcd' })).status, 415);
    assert.equal((await request(port, { method: 'POST', url: `${API}/upload`, headers: { 'Content-Type': 'image/jpeg' }, body: 'abcd' })).status, 401);
  } finally { server.stop(); }
});

test('a diff names a conversation and a turn, nothing else', async () => {
  const { server, port, calls } = await boot();
  try {
    const r = await request(port, { url: `${API}/diff?tab=t1&after=abc123`, headers: auth });
    assert.deepEqual(r.json, { ok: true, patch: '+x' });
    assert.deepEqual(calls.diffs[0], { tab: 't1', after: 'abc123', file: null });
    assert.equal((await request(port, { url: `${API}/diff?tab=../x&after=abc`, headers: auth })).status, 400);
    assert.equal((await request(port, { url: `${API}/diff?tab=t1`, headers: auth })).status, 400);
  } finally { server.stop(); }
});

test('a picture is asked for by a step’s id or a message’s turn and place, never by a path', async () => {
  const asks = [];
  const { server, port } = await boot({ onPicture: async (device, q) => { asks.push(q); return { ok: true, url: 'data:image/png;base64,AA' }; } });
  try {
    const r = await request(port, { url: `${API}/picture?tab=t1&pic=toolu_1-0.png`, headers: auth });
    assert.deepEqual(r.json, { ok: true, url: 'data:image/png;base64,AA' });
    await request(port, { url: `${API}/picture?tab=t1&turn=u1&i=1`, headers: auth });
    assert.deepEqual(asks, [{ tab: 't1', pic: 'toolu_1-0.png' }, { tab: 't1', turn: 'u1', i: 1 }]);
    for (const q of ['tab=t1&pic=..%2F..%2Fx.png', 'tab=t1&pic=C%3A%5Cx.png', 'tab=t1&turn=u1&i=12', 'tab=t1&turn=u1', 'tab=..&pic=a-0.png', 'tab=t1']) {
      assert.equal((await request(port, { url: `${API}/picture?${q}`, headers: auth })).status, 400, q);
    }
    assert.equal(asks.length, 2);
    assert.equal((await request(port, { url: `${API}/picture?tab=t1&pic=a-0.png` })).status, 401);
  } finally { server.stop(); }
});

function openStream(port, url) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, headers: { Host: `127.0.0.1:${port}`, ...auth } }, res => {
      let text = '';
      const waiters = [];
      res.setEncoding('utf8');
      res.on('data', c => { text += c; for (const w of [...waiters]) if (w.re.test(text)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(text); } });
      resolve({
        res, req, status: res.statusCode, headers: res.headers,
        until: re => (re.test(text) ? Promise.resolve(text) : new Promise(r => waiters.push({ re, resolve: r }))),
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('the stream starts with the whole view and a conversation’s transcript, then goes live', async () => {
  const { server, port, calls } = await boot();
  try {
    const s = await openStream(port, `${API}/events?tab=t1`);
    assert.equal(s.status, 200);
    assert.equal(s.headers['content-type'], 'text/event-stream');
    await s.until(/event: items\ndata: \{"tabId":"t1"/);
    assert.deepEqual(calls.opens, ['t1']);
    assert.deepEqual([...server.watched()], ['t1']);
    server.item('t1', { k: 'text', text: 'live' });
    server.item('t2', { k: 'text', text: 'not for this one' });
    server.broadcast({ v: 1, tabs: [{ id: 't1' }] });
    const text = await s.until(/"tabs":\[\{"id":"t1"\}\]/);
    assert.match(text, /"text":"live"/);
    assert.doesNotMatch(text, /not for this one/);
    s.close();
  } finally { server.stop(); }
});

test('a forgotten phone’s streams end at once, and an old stream makes way for a new one', async () => {
  const { server, port } = await boot();
  try {
    const streams = [];
    for (let i = 0; i < MAX_PER_DEVICE + 1; i++) {
      streams.push(await openStream(port, `${API}/events`));
      await streams[i].until(/event: view/);
    }
    assert.equal(server.view().streams, MAX_PER_DEVICE);
    const last = streams.at(-1);
    const ended = new Promise(r => last.res.on('end', r));
    server.dropDevice(DEVICE.id);
    await last.until(/event: bye/);
    await ended;
    assert.equal(server.view().streams, 0);
  } finally { server.stop(); }
});

test('a port already in use says busy', async () => {
  const { server, port } = await boot();
  const second = new PocketServer({ srcDir: SRC, assetsDir: ASSETS, port });
  try {
    await new Promise(resolve => { second.once('status', resolve); second.start(); });
    assert.equal(second.status, 'busy');
  } finally { server.stop(); second.stop(); }
});

test('the app’s CSP lets it frame a page from here, and nothing frames the app', async () => {
  const { server, port } = await boot();
  try {
    const csp = (await request(port, { url: '/' })).headers['content-security-policy'];
    assert.match(csp, /frame-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    const html = fs.readFileSync(path.join(SRC, 'renderer', 'pocket', 'index.html'), 'utf8');
    assert.match(html, /frame-src 'self'/, 'the meta tag says so too, or the header alone would be undone');
  } finally { server.stop(); }
});

test('a page’s file comes by its capability, with the headers pocket/pages.js gives it, and no token', async () => {
  const CAP = 'c'.repeat(43);
  const served = [];
  const { server, port } = await boot({
    onPage: route => {
      served.push(route);
      if (!route.startsWith(`/pages/${CAP}/`)) return null;
      return { status: 200, type: 'text/html', body: '<p>hi</p>', headers: { 'Content-Security-Policy': "default-src 'none'; sandbox allow-scripts; frame-ancestors 'self'", 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } };
    },
  });
  try {
    const r = await request(port, { url: `/pages/${CAP}/index.html` });
    assert.equal(r.status, 200);
    assert.equal(r.text, '<p>hi</p>');
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(r.headers['content-security-policy'], /sandbox allow-scripts/);
    assert.equal(r.headers['x-frame-options'], undefined);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.deepEqual(served, [`/pages/${CAP}/index.html`]);
    assert.equal((await request(port, { url: `/pages/${'x'.repeat(43)}/index.html` })).status, 404);
    assert.equal((await request(port, { method: 'POST', url: `/pages/${CAP}/index.html`, body: {} })).status, 405);
    assert.equal((await request(port, { method: 'HEAD', url: `/pages/${CAP}/index.html` })).status, 200);
    // A dodge through .. is just the app's own file table (the URL is normalised first), and never reaches the pages route.
    const before = served.length;
    assert.equal((await request(port, { url: `/pages/${CAP}/../../pocket.js` })).headers['content-type'], 'text/javascript; charset=utf-8');
    assert.equal((await request(port, { url: `/pages/${CAP}/%2e%2e/%2e%2e/package.json` })).status, 404);
    assert.equal(served.length, before);
    assert.equal((await request(port, { url: '/pages/' })).status, 404);
    assert.equal((await request(port, { url: '/pages' })).status, 404, 'the app has no such file');
  } finally { server.stop(); }
});

test('a sandboxed frame’s Origin "null" gets a page’s file and nothing else; every other Origin is still turned away', async () => {
  const CAP = 'c'.repeat(43);
  const { server, port } = await boot({ onPage: () => ({ status: 200, type: 'text/javascript', body: 'x()', headers: {} }) });
  try {
    assert.equal((await request(port, { url: `/pages/${CAP}/app.js`, headers: { Origin: 'null' } })).status, 200);
    assert.equal((await request(port, { url: `/pages/${CAP}/app.js`, headers: { Origin: 'https://evil.example.com' } })).status, 403);
    assert.equal((await request(port, { url: '/pocket.js', headers: { Origin: 'null' } })).status, 403, 'the app’s own files: not from an opaque origin');
    assert.equal((await request(port, { url: `${API}/hello`, headers: { Origin: 'null' } })).status, 403, 'nor the API');
    assert.equal((await request(port, { method: 'POST', url: `${API}/page-call`, headers: { ...auth, Origin: 'null' }, body: { id: 'p' } })).status, 403, 'a page can’t call the bridge itself: the app does, with its token');
  } finally { server.stop(); }
});

test('a bridge call may carry what the desk’s bridge would; other actions stay small', async () => {
  const { MAX_PAGE_BODY, MAX_BODY } = require('../src/main/pocket/server');
  const { server, port, calls } = await boot();
  try {
    const big = { id: 'print-queue', method: 'data.set', args: [{ rows: 'x'.repeat(MAX_BODY * 2) }] };
    assert.deepEqual((await request(port, { method: 'POST', url: `${API}/page-call`, headers: auth, body: big })).json, { ok: true, name: 'page-call' });
    assert.equal(calls.actions.at(-1).body.args[0].rows.length, MAX_BODY * 2);
    assert.equal((await request(port, { method: 'POST', url: `${API}/page-call`, headers: auth, body: { ...big, args: [{ rows: 'x'.repeat(MAX_PAGE_BODY) }] } }).catch(() => ({ status: 413 }))).status, 413);
    assert.equal((await request(port, { method: 'POST', url: `${API}/page-ask`, headers: auth, body: { prompt: 'x'.repeat(MAX_BODY * 2) } }).catch(() => ({ status: 413 }))).status, 413);
    for (const name of ['pages', 'page-open', 'page-call', 'page-info', 'page-ask', 'page-change']) assert.equal((await request(port, { method: 'POST', url: `${API}/${name}`, body: {} })).status, 401, `${name} needs the token`);
  } finally { server.stop(); }
});

test('a phone watching a page gets its events, and every phone a nudge when the shelf changes', async () => {
  const { server, port } = await boot();
  try {
    const watching = await openStream(port, `${API}/events?page=print-queue`);
    const other = await openStream(port, `${API}/events`);
    await Promise.all([watching.until(/event: view/), other.until(/event: view/)]);
    server.pageEvent('print-queue', { id: 'print-queue', kind: 'data', change: { keys: ['rows'] } });
    server.pageEvent('other-page', { id: 'other-page', kind: 'data' });
    server.pagesEvent({ id: 'print-queue', kind: 'meta' });
    const text = await watching.until(/event: pages/);
    assert.match(text, /event: page\ndata: \{"id":"print-queue","kind":"data"/);
    assert.doesNotMatch(text, /other-page/);
    const seen = await other.until(/event: pages/);
    assert.doesNotMatch(seen, /event: page\n/, 'a phone not watching a page hears nothing of it');
    assert.equal((await openStream(port, `${API}/events?page=../x`)).status, 200, 'a bad page name is simply not watched');
    watching.close(); other.close();
  } finally { server.stop(); }
});

test('a share that arrives before the service worker opens the app on a new task', async () => {
  const { server, port } = await boot();
  try {
    const r = await request(port, { method: 'POST', url: '/share', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: '--x--' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/#/share');
    assert.equal((await request(port, { method: 'POST', url: '/share/../pocket.js' })).status, 405);
  } finally { server.stop(); }
});

test("a page's bridge calls have their own allowance: a busy page can't use up the phone's Allow and Deny", () => {
  const SRC = path.join(__dirname, '..', 'src');
  const server = new PocketServer({ srcDir: SRC, assetsDir: path.join(__dirname, '..', 'assets'), now: () => 1000 });
  const device = { id: 'phone-1' };
  let pageCalls = 0;
  while (server.pageAllowed(device)) pageCalls++;
  assert.ok(pageCalls > 0 && pageCalls < 1000, `a page's calls stop at a limit (${pageCalls})`);
  assert.equal(server.allowed(device), true, "and the phone's own actions still go");
});
