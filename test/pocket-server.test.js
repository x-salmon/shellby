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
