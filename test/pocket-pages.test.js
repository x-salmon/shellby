// Pages on your phone (pocket/pages.js), over the real pages wiring: the shelf,
// a capability for a page's files (bound to the phone and the page, expiring,
// gone with the phone or the page), every file answered with the page CSP and
// the guard first, nothing served for a desk-only, off, unagreed or draft page,
// the bridge decided by pages/rights.js, a read-only phone kept to reading,
// Ask Claude and Change with Claude as phone tasks, and changes forwarded.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installFakeElectron } = require('./helpers/fake-ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-pages-'));
installFakeElectron({ userData });
const { wirePages } = require('../src/main/wiring/pages');
const { createPocketPages, CAP_TTL_MS, CAPS_PER_DEVICE } = require('../src/main/pocket/pages');
const { READ_ONLY_SAYS } = require('../src/main/pocket/rights');
const format = require('../src/main/pages/format');

const FULL = { id: 'phone-full-0000001', name: 'iPhone', rights: 'full' };
const LOOKER = { id: 'phone-look-0000002', name: 'Tablet', rights: 'readonly' };
const INDEX = '<!doctype html><html><head><script src="shellby.js"></script><script src="app.js"></script><link rel="stylesheet" href="style.css"></head><body>hi</body></html>';
const FILES = { 'index.html': INDEX, 'app.js': 'shellby.data.get()', 'style.css': 'body{}' };

function fakeConfig(initial = {}) {
  const store = { ...initial };
  return { get: k => store[k], set: patch => Object.assign(store, patch) };
}

/** The pages wiring on a fresh store, a fake PC around it, and the phone's pages module over both. */
function rig({ devices = [FULL, LOOKER], gate = { ok: true } } = {}) {
  const rec = [];
  const note = name => (...args) => { rec.push([name, ...args]); };
  let clock = 1_700_000_000_000;
  const now = () => clock;
  const d = {
    config: fakeConfig(), panel: {}, log: { info() {}, warn() {} },
    send: note('send'), notify: note('notify'), showPanel: note('showPanel'), sayText: note('sayText'),
    currentCwd: () => 'C:\\code\\shellby',
    startTask: (prompt, title, opts) => { rec.push(['startTask', prompt, title, opts]); return { ok: true, tabId: `tab-${rec.length}` }; },
    manager: { modeToStart: note('modeToStart') },
  };
  Object.assign(d, wirePages(d));
  const sent = new Map();
  const once = (kind, body, start) => { const k = body?.key ? `${kind}-${body.key}` : null; if (k && sent.has(k)) return sent.get(k); const r = start(body); if (k) sent.set(k, r); return r; };
  const server = { pageEvent: note('pageEvent'), pagesEvent: note('pagesEvent') };
  const pp = createPocketPages(d, {
    devices: () => devices, claimStart: () => gate, adopt: note('adopt'), pushView: note('pushView'), once, notifyPage: note('notifyPage'), server: () => server, now,
  });
  const s = d.pages.store();
  const make = (name, over = {}, { agree = true, enabled = true } = {}) => {
    const m = format.manifestOf({ name, phone: true, access: { ask: true, notify: true }, ...over }).manifest;
    const r = s.create(m, FILES, { who: { kind: 'you' } });
    if (agree) s.agree(r.id, 1);
    if (!enabled) s.setMeta(r.id, { enabled: false });
    return r.id;
  };
  return { d, s, pp, rec, make, of: name => rec.filter(r => r[0] === name).map(r => r.slice(1)), tick: ms => { clock += ms; }, now, devices };
}

const act = (pp, name, body, device = FULL) => pp.actions[name](body, device);

before(() => {});
after(() => { try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* held */ } });

test('the shelf lists every page, pinned first, saying which open on a phone', async () => {
  const r = rig();
  const phone = r.make('Print queue');
  const desk = r.make('Drive space', { phone: false });
  const off = r.make('Gym log', {}, { enabled: false });
  const waiting = r.make('Release radar', {}, { agree: false });
  r.s.setMeta(off, { pinned: true });
  const v = await act(r.pp, 'pages', {});
  assert.equal(v.ok, true);
  assert.equal(v.on, true);
  assert.deepEqual(v.pages.map(p => p.id)[0], off, 'pinned first');
  const by = Object.fromEntries(v.pages.map(p => [p.id, p]));
  assert.deepEqual([by[phone].ready, by[phone].phone], [true, true]);
  assert.deepEqual([by[desk].ready, by[desk].phone], [false, false]);
  assert.deepEqual([by[off].ready, by[off].enabled], [false, false]);
  assert.deepEqual([by[waiting].ready, by[waiting].needsOk], [false, true]);
  assert.equal(by[phone].thumb, null);
  assert.ok(!JSON.stringify(v).includes('C:\\'), 'no paths');
  // Pages off at the desk: an empty shelf, and nothing opens.
  r.d.config.set({ pagesOff: true });
  assert.deepEqual(await act(r.pp, 'pages', {}), { ok: true, on: false, pages: [] });
  assert.equal((await act(r.pp, 'page-open', { id: phone })).ok, false);
});

test('page-open hands out a capability for a phone-ready page only, with its data', async () => {
  const r = rig();
  const phone = r.make('Print queue');
  const desk = r.make('Drive space', { phone: false });
  const off = r.make('Gym log', {}, { enabled: false });
  const waiting = r.make('Release radar', {}, { agree: false });
  r.s.write(phone, { set: { rows: [1, 2] } }, { kind: 'you' });
  const o = await act(r.pp, 'page-open', { id: phone });
  assert.equal(o.ok, true);
  assert.match(o.url, /^\/pages\/[A-Za-z0-9_-]{43}\/index\.html$/);
  assert.equal(o.expiresAt, 1_700_000_000_000 + CAP_TTL_MS);
  assert.deepEqual(o.values, { rows: [1, 2] });
  assert.equal(o.page.id, phone);
  const d = await act(r.pp, 'page-open', { id: desk });
  assert.deepEqual([d.ok, d.desk, d.page.id], [false, true, desk]);
  assert.match(d.error, /Built|wide screen/i);
  assert.match((await act(r.pp, 'page-open', { id: off })).error, /off, or waiting/);
  assert.match((await act(r.pp, 'page-open', { id: waiting })).error, /off, or waiting/);
  assert.match((await act(r.pp, 'page-open', { id: 'nope' })).error, /No such page/);
  assert.match((await act(r.pp, 'page-open', { id: 'draft-abcdef12' })).error, /No such page/);
  assert.match((await act(r.pp, 'page-open', { id: '../x' })).error, /No such page/);
  assert.equal(r.pp.caps(), 1, 'only the one that opened');
});

const capOf = o => /^\/pages\/([^/]+)\//.exec(o.url)[1];

test('a page’s files come by their capability, every one with the page CSP, the guard first, and nothing outside the page', async () => {
  const r = rig();
  const phone = r.make('Print queue');
  const o = await act(r.pp, 'page-open', { id: phone });
  const cap = capOf(o);
  const get = file => r.pp.serve(`/pages/${cap}/${file}`);
  const html = get('index.html');
  assert.equal(html.status, 200);
  assert.equal(html.type, 'text/html');
  assert.ok(String(html.body).startsWith('<!doctype html><script src="guard.js" crossorigin="anonymous"></script>'), 'guard.js first');
  for (const part of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", 'sandbox allow-scripts', "frame-ancestors 'self'"]) assert.ok(html.headers['Content-Security-Policy'].includes(part), part);
  assert.equal(html.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(html.headers['Cache-Control'], 'no-store');
  assert.equal(html.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(html.headers['Access-Control-Allow-Origin'], 'null', 'its own scripts load in CORS mode from an opaque origin');
  assert.equal(html.headers['X-Frame-Options'], undefined, 'the app may frame it');
  assert.equal(get('').status, 200, 'no file means index.html');
  const js = get('app.js');
  assert.equal(js.type, 'text/javascript');
  assert.ok(js.headers['Content-Security-Policy'].includes('sandbox allow-scripts'));
  const css = get('style.css');
  assert.equal(css.type, 'text/css');
  assert.ok(css.headers['Content-Security-Policy'].endsWith("sandbox; frame-ancestors 'self'"), 'script-free for anything that is not HTML or JS');
  assert.ok(String(get('shellby.js').body).includes('postMessage'), 'the bridge');
  assert.ok(String(get('guard.js').body).includes('RTC'), 'the guard');
  // data.json and state.json sit beside the versions, never in one: not a page's file.
  for (const bad of ['../state.json', '..%2Fstate.json', 'v/1/index.html', 'missing.js', 'data.json', 'state.json', 'activity.json']) assert.equal(get(bad).status, 404, bad);
  assert.equal(get('%E0%A4%A').status, 400, 'a bad escape answers, not throws');
  assert.equal(r.pp.serve(`/pages/${cap}`).status, 200, 'the cap alone is the index too');
  assert.equal(r.pp.serve('/pages/').status, 404);
  assert.equal(r.pp.serve(`/pages/${'x'.repeat(43)}/index.html`).status, 404, 'a cap that was never issued');
  assert.equal(r.pp.serve(`/pages/${cap.slice(0, 42)}/index.html`).status, 404, 'a cap of the wrong shape');
});

test('a capability expires, dies with the phone that asked, and with the page going off or desk-only', async () => {
  const r = rig();
  const phone = r.make('Print queue');
  const other = r.make('Gym log');
  const first = capOf(await act(r.pp, 'page-open', { id: phone }));
  r.tick(CAP_TTL_MS - 1);
  assert.equal(r.pp.serve(`/pages/${first}/index.html`).status, 200, 'still good just before');
  r.tick(2);
  assert.equal(r.pp.serve(`/pages/${first}/index.html`).status, 404, 'expired');
  // Bound to the page: the cap for one page serves no other.
  const mine = capOf(await act(r.pp, 'page-open', { id: phone }));
  assert.equal(r.pp.serve(`/pages/${mine}/index.html`).status, 200);
  assert.equal(String(r.pp.serve(`/pages/${mine}/app.js`).body), FILES['app.js']);
  // The page turned off at the desk: its cap is spent.
  r.s.setMeta(phone, { enabled: false });
  assert.equal(r.pp.serve(`/pages/${mine}/index.html`).status, 404);
  r.s.setMeta(phone, { enabled: true });
  assert.equal(r.pp.serve(`/pages/${mine}/index.html`).status, 404, 'and not back: a cap is spent for good');
  // Bound to the phone: forgotten, its caps go.
  const theirs = capOf(await act(r.pp, 'page-open', { id: other }, LOOKER));
  r.devices.splice(r.devices.indexOf(LOOKER), 1);
  assert.equal(r.pp.serve(`/pages/${theirs}/index.html`).status, 404);
  // A phone holds a few at once, not a hoard: the oldest make way.
  const caps = [];
  for (let i = 0; i < CAPS_PER_DEVICE + 2; i++) caps.push(capOf(await act(r.pp, 'page-open', { id: other })));
  assert.equal(r.pp.serve(`/pages/${caps[0]}/index.html`).status, 404);
  assert.equal(r.pp.serve(`/pages/${caps.at(-1)}/index.html`).status, 200);
  assert.ok(r.pp.caps() <= CAPS_PER_DEVICE);
});

test('the bridge goes through pages/rights.js: its data, a read it was not given, an ask that only comes back as a sheet', async () => {
  const r = rig();
  const phone = r.make('Print queue');
  const desk = r.make('Drive space', { phone: false });
  const call = (id, method, args, device) => act(r.pp, 'page-call', { id, method, args }, device);
  assert.deepEqual(await call(phone, 'data.set', [{ rows: ['Benchy'] }]), { ok: true, value: { changed: ['rows'] } });
  assert.deepEqual(r.s.read(phone).values, { rows: ['Benchy'] });
  assert.equal(r.s.read(phone).by.rows.who.kind, 'page', 'signed as the page');
  assert.deepEqual(await call(phone, 'data.get', ['rows']), { ok: true, value: ['Benchy'] });
  assert.match((await call(phone, 'read', ['usage'])).error, /wasn't given "usage"/);
  assert.match((await call(phone, 'fetch', ['https://api.example.com/x'])).error, /didn't ask for/);
  assert.match((await call(phone, 'eval', ['x'])).error, /shellby has no "eval"/);
  assert.match((await call(phone, 'data.set', ['not an object'])).error, /takes an object/);
  // ask: nothing starts; the phone gets the prompt and the mode for its own sheet, with Autonomous never on offer.
  const a = await call(phone, 'ask', ['Summarise the failed prints', { mode: 'autonomous' }]);
  assert.deepEqual(a, { ok: true, value: { shown: true }, ask: { prompt: 'Summarise the failed prints', mode: 'ask' } });
  assert.deepEqual((await call(phone, 'ask', ['Plan it', { mode: 'plan' }])).ask, { prompt: 'Plan it', mode: 'plan' });
  assert.equal(r.of('startTask').length, 0);
  assert.ok(!r.of('send').some(([, ch, ev]) => ch === 'pages:changed' && ev.kind === 'ask'), 'no card at the desk for a phone’s ask');
  // notify: the desk's toast, and a push to the phones.
  assert.deepEqual(await call(phone, 'notify', ['Print done', 'Benchy finished']), { ok: true, value: { shown: true } });
  assert.equal(r.of('notify').length, 1);
  assert.deepEqual(r.of('notifyPage')[0][0], { id: phone, name: 'Print queue', title: 'Print done', body: 'Benchy finished' });
  // A desk-only page has no bridge from a phone, nor does one that is off or unknown.
  assert.match((await call(desk, 'data.get', [])).error, /isn't open on a phone/);
  r.s.setMeta(phone, { enabled: false });
  assert.match((await call(phone, 'data.get', [])).error, /isn't open on a phone/);
  assert.match((await call('nope', 'data.get', [])).error, /isn't open on a phone/);
});

test('a read-only phone’s page may read, and nothing else', async () => {
  const r = rig();
  const phone = r.make('Print queue');
  r.s.write(phone, { set: { rows: [1] } }, { kind: 'you' });
  const call = (method, args) => act(r.pp, 'page-call', { id: phone, method, args }, LOOKER);
  assert.deepEqual(await call('data.get', ['rows']), { ok: true, value: [1] });
  assert.match((await call('read', ['usage'])).error, /wasn't given/, 'read goes through, and rights.js still decides');
  for (const [m, a] of [['data.set', [{ rows: [] }]], ['data.append', ['rows', 2]], ['data.remove', ['rows']], ['ask', ['x']], ['notify', ['x']], ['fetch', ['https://a.example.com/']], ['say', ['hi']]]) {
    assert.equal((await call(m, a)).error, READ_ONLY_SAYS, m);
  }
  assert.deepEqual(r.s.read(phone).values, { rows: [1] }, 'nothing changed');
  assert.equal((await act(r.pp, 'page-open', { id: phone }, LOOKER)).ok, true, 'looking is fine');
  assert.equal((await act(r.pp, 'page-info', { id: phone }, LOOKER)).ok, true);
  assert.equal((await act(r.pp, 'page-ask', { id: phone, prompt: 'x', mode: 'ask' }, LOOKER)).error, READ_ONLY_SAYS);
  assert.equal((await act(r.pp, 'page-change', { id: phone }, LOOKER)).error, READ_ONLY_SAYS);
  assert.equal(r.of('startTask').length, 0);
});

test('Ask Claude from the phone’s sheet is a phone task: the page’s access, Ask first or Plan, the hourly gate, marked as the phone’s, no panel pulled up', async () => {
  const r = rig();
  const phone = r.make('Print queue');
  const quiet = r.make('Reading list', { access: {} });
  const a = await act(r.pp, 'page-ask', { id: phone, prompt: 'Why do these fail?', mode: 'smart', key: 'k1' });
  assert.equal(a.ok, true);
  const [[prompt, title, opts]] = r.of('startTask');
  assert.match(prompt, /^\[Shellby: the page "Print queue" asks, and the user said yes\] Why do these fail\?$/);
  assert.match(title, /^Print queue: Why do these fail/);
  assert.deepEqual(opts, { cwd: 'C:\\code\\shellby', mode: 'ask' }, 'smart is not a mode a page may ask for');
  assert.deepEqual(r.of('adopt'), [[a.tabId]]);
  assert.equal(r.of('showPanel').length, 0);
  assert.equal(r.of('pushView').length, 1);
  // Asked again with the same key (a slow answer): the same task.
  assert.deepEqual(await act(r.pp, 'page-ask', { id: phone, prompt: 'Why do these fail?', mode: 'smart', key: 'k1' }), a);
  assert.equal(r.of('startTask').length, 1);
  assert.equal((await act(r.pp, 'page-ask', { id: phone, prompt: 'Plan a fix', mode: 'plan' })).ok, true);
  assert.equal(r.of('startTask').at(-1)[2].mode, 'plan');
  assert.match((await act(r.pp, 'page-ask', { id: quiet, prompt: 'x', mode: 'ask' })).error, /wasn't given ask/);
  assert.match((await act(r.pp, 'page-ask', { id: phone, prompt: '   ', mode: 'ask' })).error, /takes what to ask/);
  assert.match((await act(r.pp, 'page-ask', { id: 'nope', prompt: 'x' })).error, /isn't open on a phone/);
  assert.equal(r.of('startTask').length, 2);
  // At the phone's limit: refused with the gate's words, nothing started.
  const full = rig({ gate: { ok: false, reply: 'That is 30 this hour.' } });
  const p2 = full.make('Print queue');
  assert.match((await act(full.pp, 'page-ask', { id: p2, prompt: 'x', mode: 'ask' })).error, /30 this hour/);
  assert.equal(full.of('startTask').length, 0);
});

test('Change with Claude from the phone starts a task in Ask first, for a desk-only page too', async () => {
  const r = rig();
  const desk = r.make('Drive space', { phone: false });
  const c = await act(r.pp, 'page-change', { id: desk, key: 'c1' });
  assert.equal(c.ok, true);
  const [[prompt, title, opts]] = r.of('startTask');
  assert.match(title, /^Change: Drive space/);
  assert.equal(opts.mode, 'ask');
  assert.match(prompt, /Drive space/);
  assert.deepEqual(r.of('adopt'), [[c.tabId]]);
  assert.equal(r.of('showPanel').length, 0);
  assert.match((await act(r.pp, 'page-change', { id: 'nope' })).error, /No such page/);
  assert.match((await act(r.pp, 'page-change', { id: 'draft-abcdef12' })).error, /No such page/);
});

test('its data and History, to look at', async () => {
  const r = rig();
  const phone = r.make('Print queue');
  r.s.write(phone, { set: { rows: [1] } }, { kind: 'agent', name: 'Fix the printer' });
  r.s.update(phone, r.s.manifest(phone), FILES, { who: { kind: 'you' }, why: 'Bigger buttons' });
  const i = await act(r.pp, 'page-info', { id: phone });
  assert.equal(i.ok, true);
  assert.deepEqual(i.values, { rows: [1] });
  assert.equal(i.by.rows.who.name, 'Fix the printer');
  assert.deepEqual(i.versions.map(v => [v.n, v.why, v.current]), [[2, 'Bigger buttons', true], [1, 'First version', false]]);
  assert.ok(i.words.some(w => /Ask Claude/.test(w)));
  assert.equal(i.activity[0].text, 'changed rows');
  assert.match((await act(r.pp, 'page-info', { id: 'nope' })).error, /No such page/);
});

test('what changes on the PC reaches the phones: data to the page’s watchers, a nudge for the shelf, a push once a minute for notify, never a draft', async () => {
  const r = rig();
  // The pages wiring keeps its own rates on the clock: both run on the rig's.
  const realNow = Date.now;
  Date.now = r.now;
  try {
    const phone = r.make('Print queue');
    r.d.pages.writeYou(phone, { set: { rows: [1] } });
    const [[id, ev]] = r.of('pageEvent');
    assert.equal(id, phone);
    assert.equal(ev.kind, 'data');
    assert.deepEqual(ev.change.keys, ['rows']);
    assert.deepEqual(ev.change.values, { rows: [1] });
    assert.ok(r.of('pagesEvent').some(([p]) => p.id === phone && p.kind === 'data'));
    r.d.pages.setMeta(phone, { pinned: true });
    assert.ok(r.of('pagesEvent').some(([p]) => p.kind === 'meta'));
    // A page's notify: one push a minute, named after the page.
    await r.d.pages.call(phone, 'notify', ['Print done', 'Benchy finished']);
    assert.deepEqual(r.of('notifyPage')[0][0], { id: phone, name: 'Print queue', title: 'Print done', body: 'Benchy finished' });
    // An agent's write to a page with notify on would be a push too (the desk's toast): within the minute it's held.
    const routine = { id: 't1', title: 'Morning routine', routineId: 'r1' };
    r.tick(30_000);
    await r.d.pages.tool(routine, 'write_page', { id: phone, append: { rows: [2] } });
    assert.equal(r.of('notify').length, 2, 'the desk toasts it');
    assert.equal(r.of('notifyPage').length, 1, 'held: one a minute per page, whichever way it came');
    r.tick(61_000);
    await r.d.pages.tool(routine, 'write_page', { id: phone, append: { rows: [3] } });
    assert.equal(r.of('notifyPage').length, 2);
    assert.equal(r.of('notifyPage').at(-1)[0].title, 'Morning routine added 1 to rows');
    // A draft never reaches a phone.
    const before = r.of('pageEvent').length;
    const draft = r.s.create(format.manifestOf({ name: 'Draft' }).manifest, FILES, { draft: true, tab: 't1' });
    r.d.pages.writeYou(draft.id, { set: { x: 1 } });
    assert.equal(r.of('pageEvent').length, before);
  } finally { Date.now = realNow; }
});
