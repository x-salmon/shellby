// What main says to the panel with conversations out in windows of their own
// (wiring/window-routes.js), and which window is asking (asking.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { askedBy, askingWindow, fromWindow } = require('../src/main/asking');
const { guardIpc, windowPolicy } = require('../src/main/ipc-guard');
const { routes, quiet, SHARED, TO_ASKER, OF_TAB } = require('../src/main/wiring/window-routes');

const panel = { name: 'panel' };
const a = { name: 'a' };
const b = { name: 'b' };
const at = (extra = {}) => ({ panel, others: [a, b], asker: null, tabWindow: id => (id === 'in-a' ? a : panel), ...extra });
const names = list => list.map(([w]) => w.name);
const live = () => ({ isDestroyed: () => false });

test('what every screen is drawn from reaches every window', () => {
  for (const channel of ['notes', 'pages:changed', 'toolbox', 'routines', 'settings', 'health', 'xp']) {
    assert.deepEqual(names(routes(channel, { x: 1 }, at())), ['panel', 'a', 'b'], channel);
  }
});

test('a celebration, a toast or a banner shows once, in the panel', () => {
  for (const channel of ['xp:levelup', 'recap', 'wardrobe:unlocked', 'limit', 'bugdex:caught', 'tab:returned', 'panel:calm']) {
    assert.deepEqual(names(routes(channel, {}, at({ asker: a }))), ['panel'], channel);
  }
});

test('somewhere to go opens in the window that asked, and in the panel when nobody did', () => {
  assert.deepEqual(names(routes('panel:view', 'settings', at({ asker: b }))), ['b']);
  assert.deepEqual(names(routes('panel:view', 'settings', at())), ['panel']);
});

test('what is about one conversation goes to the window it is in', () => {
  assert.deepEqual(names(routes('tab:opened', { tabId: 'in-a' }, at({ asker: b }))), ['a']);
  assert.deepEqual(names(routes('tab:opened', { tabId: 'elsewhere' }, at())), ['panel']);
});

test('the other windows get the view without the moment that came with it', () => {
  assert.deepEqual(quiet('rooms', { view: 1, opened: ['tank'] }), { view: 1, opened: [] });
  assert.deepEqual(quiet('quests', { view: 1, done: 'x' }), { view: 1 });
  assert.deepEqual(quiet('game', { what: 'molt', view: 1, event: { kind: 'ready' } }), { what: 'molt', view: 1 });
  assert.deepEqual(quiet('social', { swaps: [], notice: 'hi' }), { swaps: [], notice: null });
  const full = { view: 1, opened: ['tank'] };
  const sent = routes('rooms', full, at());
  assert.equal(sent[0][1], full, 'the panel marks it');
  assert.deepEqual(sent[1][1].opened, []);
  assert.deepEqual(names(routes('pages:changed', { kind: 'open', id: 'p1' }, at())), ['panel'], 'a notification opens its page once');
});

test('no channel is sent two ways', () => {
  for (const c of TO_ASKER) assert.ok(!SHARED.has(c) && !OF_TAB.has(c), c);
  for (const c of OF_TAB) assert.ok(!SHARED.has(c), c);
});

test('every channel named here is one the panel listens to', () => {
  const preload = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'preload', 'preload.js'), 'utf8');
  for (const c of [...SHARED, ...TO_ASKER, ...OF_TAB]) assert.ok(preload.includes(`on('${c}')`), c);
});

test('the window that asked is known until its handler settles, awaits included', async () => {
  const win = live();
  assert.equal(askingWindow(), null);
  let later;
  await askedBy(win, async () => {
    assert.equal(askingWindow(), win);
    await new Promise(r => setImmediate(r));
    assert.equal(fromWindow(panel), win);
    later = new Promise(r => setTimeout(() => r(askingWindow()), 5));
  });
  assert.equal(await later, null, 'what it leaves running is nobody\'s');
  assert.equal(fromWindow(panel), panel);
});

test('a handler that throws, or a window that has gone, leaves no one asking', () => {
  const win = live();
  assert.throws(() => askedBy(win, () => { throw new Error('no'); }), /no/);
  askedBy({ isDestroyed: () => true }, () => assert.equal(askingWindow(), null));
});

test('two windows asking at once are kept apart', async () => {
  const [one, two] = [live(), live()];
  const seen = win => askedBy(win, async () => { await new Promise(r => setImmediate(r)); return askingWindow(); });
  assert.deepEqual(await Promise.all([seen(one), seen(two)]), [one, two]);
});

test('the IPC guard says which window asked, and the panel asking is nobody in particular', async () => {
  const own = live();
  const senders = { panel: { id: 1 }, own: { id: 2 } };
  const handlers = new Map();
  const ipc = guardIpc({ handle: (c, fn) => handlers.set(c, fn), on: (c, fn) => handlers.set(c, fn) },
    windowPolicy(() => ({ panel: senders.panel, isPopout: wc => wc === senders.own })),
    { windowOf: wc => (wc === senders.own ? own : null) });
  ipc.handle('ask', async () => askingWindow());
  assert.equal(await handlers.get('ask')({ sender: senders.own }), own);
  assert.equal(await handlers.get('ask')({ sender: senders.panel }), null);
});
