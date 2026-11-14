const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PeerLink, parseEvents, pair, MIN_RETRY_MS, MAX_RETRY_MS } = require('../src/main/hub/link');

const enc = new TextEncoder();
const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A response whose body yields these chunks (strings), then ends, or never ends when hold is set. */
function streamRes(chunks, { status = 200, hold = false } = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    body: (async function* gen() {
      for (const c of chunks) yield enc.encode(c);
      if (hold) await new Promise(() => {});
    })(),
    json: async () => ({}),
  };
}

function fakeTimers() {
  const timers = [];
  return {
    timers,
    // A timer due at once runs at once, as a real one would; the rest wait to be fired by the test.
    setTimer: (fn, ms) => { const t = { fn, ms }; if (ms === 0) setImmediate(fn); else timers.push(t); return t; },
    clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  };
}

test('events are split on blank lines, keeping an unfinished one for the next chunk', () => {
  const a = parseEvents('retry: 2000\n\nevent: view\ndata: {"a":1}\n\nevent: view\ndata: {"a"');
  assert.deepEqual(a.events, [{ event: 'view', data: '{"a":1}' }]);
  const b = parseEvents(`${a.rest}:2}\n\n: a comment\n\n`);
  assert.deepEqual(b.events, [{ event: 'view', data: '{"a":2}' }]);
  assert.equal(b.rest, '');
  assert.deepEqual(parseEvents('data: x\r\ndata: y\r\n\r\n').events, [{ event: 'message', data: 'x\ny' }]);
});

test('a view from the PC makes it online, with the token in a header and never in the URL', async () => {
  const calls = [];
  const t = fakeTimers();
  const link = new PeerLink({
    origin: 'https://desk.t.ts.net', token: () => 'tok_abcdefghijklmnopqrstuvwxyz', ...t,
    fetch: async (url, init) => { calls.push({ url, init }); return streamRes([sse('view', { pc: 'Desk', tabs: [] })], { hold: true }); },
  });
  const got = new Promise(r => link.once('view', r));
  link.start();
  const view = await got;
  assert.equal(view.pc, 'Desk');
  assert.equal(link.state, 'online');
  assert.equal(calls[0].url, 'https://desk.t.ts.net/pocket/v1/events');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok_abcdefghijklmnopqrstuvwxyz');
  assert.ok(!calls[0].url.includes('tok_'));
  link.stop();
});

test("an unreachable PC is offline and tried again later, waiting longer each time", async () => {
  const t = fakeTimers();
  let n = 0;
  const link = new PeerLink({ origin: 'https://x.t.ts.net', token: () => 't'.repeat(30), ...t, fetch: async () => { n++; throw new TypeError('fetch failed'); } });
  await link.connect();
  assert.equal(link.state, 'offline');
  assert.match(link.error, /asleep or offline/);
  const retry = t.timers.find(x => x.ms === MIN_RETRY_MS);
  assert.ok(retry, 'a retry is set');
  retry.fn();
  await new Promise(r => setImmediate(r));
  assert.ok(t.timers.some(x => x.ms === MIN_RETRY_MS * 2), 'the next wait is longer');
  assert.equal(n, 2);
  for (let i = 0; i < 10; i++) { link.timer = null; link.later(); }
  assert.equal(link.retryMs, MAX_RETRY_MS, 'it never waits longer than a minute');
  link.stop();
});

test('a PC that forgot the hub says to pair again, and stops trying', async () => {
  const t = fakeTimers();
  const link = new PeerLink({ origin: 'https://x.t.ts.net', token: () => 't'.repeat(30), ...t, fetch: async () => streamRes([], { status: 401 }) });
  await link.connect();
  assert.equal(link.state, 'unpaired');
  assert.equal(t.timers.filter(x => x.ms >= MIN_RETRY_MS).length, 0);
});

test('actions POST to that PC and come back as its answer, or a plain error', async () => {
  const seen = [];
  const link = new PeerLink({
    origin: 'https://x.t.ts.net', token: () => 't'.repeat(30), ...fakeTimers(),
    fetch: async (url, init) => { seen.push({ url, init }); return { status: 200, ok: true, json: async () => ({ ok: true, tabId: 'abc' }) }; },
  });
  const r = await link.act('task', { project: 'C:\\repo', text: 'Run the tests' });
  assert.deepEqual(r, { ok: true, tabId: 'abc' });
  assert.equal(seen[0].url, 'https://x.t.ts.net/pocket/v1/task');
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(JSON.parse(seen[0].init.body).text, 'Run the tests');
  assert.deepEqual(await link.act('../evil'), { ok: false, error: 'Unknown action.' });
  const down = new PeerLink({ origin: 'https://x.t.ts.net', token: () => 't'.repeat(30), ...fakeTimers(), fetch: async () => { throw new Error('ECONNRESET'); } });
  assert.match((await down.act('task', {})).error, /Couldn't reach that PC/);
});

test('pairing sends the code and keeps only a well-formed token', async () => {
  let sent;
  const ok = await pair({ origin: 'https://x.t.ts.net', code: 'abcd-efgh', name: 'Desk PC (hub)', fetch: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { status: 200, ok: true, json: async () => ({ ok: true, token: 'A'.repeat(43) }) }; } });
  assert.deepEqual(ok, { ok: true, token: 'A'.repeat(43) });
  assert.equal(sent.url, 'https://x.t.ts.net/pocket/v1/pair');
  assert.equal(sent.body.code, 'ABCDEFGH');
  const wrong = await pair({ origin: 'https://x.t.ts.net', code: 'ABCDEFGH', name: 'x', fetch: async () => ({ status: 403, ok: false, json: async () => ({ ok: false, error: "That's not the code." }) }) });
  assert.match(wrong.error, /not the code/);
  const weird = await pair({ origin: 'https://x.t.ts.net', code: 'ABCDEFGH', name: 'x', fetch: async () => ({ status: 200, ok: true, json: async () => ({ ok: true, token: 'x y' }) }) });
  assert.equal(weird.ok, false);
  assert.match((await pair({ origin: 'https://x.t.ts.net', code: '12', name: 'x' })).error, /Type the code/);
});

// ---- what the security review found

test('no request ever follows a redirect: a PC can\'t send the hub, or what it carries, anywhere else', async () => {
  const inits = [];
  const f = async (url, init) => { inits.push(init); return url.endsWith('/pair') ? { status: 200, ok: true, json: async () => ({ ok: true, token: 'A'.repeat(43) }) } : streamRes([], { status: 500 }); };
  const link = new PeerLink({ origin: 'https://x.t.ts.net', token: () => 't'.repeat(30), ...fakeTimers(), fetch: f });
  await link.connect();
  await link.act('task', { text: 'secret plan' });
  await pair({ origin: 'https://x.t.ts.net', code: 'ABCDEFGH', name: 'x', fetch: f });
  assert.equal(inits.length, 3);
  for (const init of inits) assert.equal(init.redirect, 'error');
  link.stop();
});

test("a view too big to be one is dropped, and a flood of them is read once a second, newest first", async () => {
  const t = fakeTimers();
  const big = sse('view', { pc: 'x'.repeat(600 * 1024) });
  const flood = Array.from({ length: 50 }, (_, i) => sse('view', { pc: `v${i}` })).join('');
  const link = new PeerLink({ origin: 'https://x.t.ts.net', token: () => 't'.repeat(30), ...t, fetch: async () => streamRes([big, flood], { hold: true }) });
  const seen = [];
  link.on('view', v => seen.push(v.pc));
  link.start();
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(seen, ['v49'], 'only the newest of the burst, and never the oversized one');
  link.stop();
});

test('a line that goes quiet for a minute is ended, not trusted as online', async () => {
  const t = fakeTimers();
  const link = new PeerLink({ origin: 'https://x.t.ts.net', token: () => 't'.repeat(30), ...t, fetch: async (url, init) => ({
    status: 200, ok: true,
    body: (async function* gen() {
      yield enc.encode(sse('view', { pc: 'x' }));
      await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    })(),
  }) });
  link.start();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(link.state, 'online');
  const idle = t.timers.find(x => x.ms === 60 * 1000);
  assert.ok(idle, 'a minute of nothing is watched for');
  idle.fn();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(link.state, 'offline');
  link.stop();
});
