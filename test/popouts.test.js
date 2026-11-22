const { test } = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/fake-ipc').installFakeElectron();
const { cleanCarry } = require('../src/main/wiring/popouts');

test('what was typed travels between windows, with the ids steering knows queued messages by', () => {
  const c = cleanCarry({
    draft: 'half a thought', attachments: ['C:\\a.png'], turnId: 't1',
    queue: [{ id: 'qab-1', text: 'also add tests', attachments: [], taken: true }, { id: 'qab-2', text: 'then push', attachments: ['C:\\b.txt'] }],
  });
  assert.deepEqual(c, {
    draft: 'half a thought', attachments: ['C:\\a.png'], turnId: 't1',
    queue: [{ id: 'qab-1', text: 'also add tests', attachments: [], taken: true }, { id: 'qab-2', text: 'then push', attachments: ['C:\\b.txt'] }],
  });
});

test('anything else a window sends is dropped, and nothing is nothing', () => {
  assert.equal(cleanCarry(null), null);
  assert.equal(cleanCarry('words'), null);
  const c = cleanCarry({
    draft: 42, attachments: ['', 7, 'C:\\ok'], turnId: 'x'.repeat(65), extra: 'no',
    queue: [{ text: 'no id' }, { id: 'q1' }, { id: 'q2', text: 'kept', attachments: 'not a list', taken: 'yes' }, null],
  });
  assert.deepEqual(c, { draft: '', attachments: ['C:\\ok'], turnId: null, queue: [{ id: 'q2', text: 'kept', attachments: [] }] });
});

test('long text is cut to what the box can send, and the queue to twenty', () => {
  const c = cleanCarry({ draft: 'x'.repeat(30), queue: Array.from({ length: 25 }, (_, i) => ({ id: `q${i}`, text: 'y'.repeat(30) })) }, { maxText: 10 });
  assert.equal(c.draft.length, 10);
  assert.equal(c.queue.length, 20);
  assert.equal(c.queue[0].text.length, 10);
});

// A wirePopouts with just enough of main around it to open a window.
function wired(config = {}) {
  const { FakeBrowserWindow, fakeConfig } = require('./helpers/fake-ipc');
  const { wirePopouts } = require('../src/main/wiring/popouts');
  const panel = new FakeBrowserWindow({ width: 460, height: 700 });
  panel.getPosition = () => [100, 100];
  const sent = [];
  const d = {
    panel, config: fakeConfig(config), RENDERER: 'C:\r', ICON: null, webPreferences: {},
    manager: { tabs: new Map([['t1', { title: 'one' }], ['t2', { title: 'two' }]]), summary: [] },
    workAreas: () => [{ x: 0, y: 0, width: 1920, height: 1040 }], secureWindow: () => {},
    send: (win, channel, payload) => sent.push({ win, channel, payload }),
  };
  const p = wirePopouts(d);
  // The fake's pages can't zoom: each new one gets a factor of its own to set.
  const popOut = p.popOut;
  p.popOut = (...a) => {
    const r = popOut(...a);
    for (const w of FakeBrowserWindow.all) w.webContents.setZoomFactor ||= z => { w.webContents.zoom = z; };
    return r;
  };
  return { d, panel, sent, p, FakeBrowserWindow };
}

test('a popped-out conversation opens at the zoom the panel is saved at', async () => {
  const { p, FakeBrowserWindow } = wired({ panelZoom: 1.25 });
  p.popOut('t1');
  const win = FakeBrowserWindow.all.at(-1);
  await new Promise(r => setImmediate(r)); // did-finish-load
  assert.equal(win.webContents.zoom, 1.25);
});

test('what is not one tab\'s (the usage meter, the outlook) reaches the panel and every popped-out window', () => {
  const { p, panel, sent } = wired();
  p.popOut('t1');
  p.popOut('t2');
  assert.equal(p.everyWindow().length, 3);
  p.sendEveryWindow('usage', { pct: 80 });
  const got = sent.filter(s => s.channel === 'usage');
  assert.equal(got.length, 3);
  assert.equal(got[0].win, panel);
  assert.deepEqual(new Set(got.map(s => s.win)).size, 3, 'each window once');
  // A window that has gone is skipped.
  p.tabWindow('t2').destroyed = true;
  sent.length = 0;
  p.sendEveryWindow('outlook', {});
  assert.equal(sent.length, 2);
});

test('a notification for a popped-out conversation brings its window up from behind or minimized', () => {
  const { p } = wired();
  p.popOut('t1');
  const win = p.tabWindow('t1');
  win.minimized = true;
  p.showPopout('t1');
  assert.equal(win.minimized, false);
  assert.equal(win.visible, true);
  assert.equal(win.onTop, true, 'focus() alone leaves it behind on Windows');
  assert.equal(win.focused, true);
});

// ---- a window of its own with more than one conversation

// wired(), with conversations main keeps a list of, opened from whichever window.
function wiredTabs(ids = ['t1', 't2', 't3']) {
  const w = wired();
  const { d } = w;
  d.manager.tabs = new Map(ids.map(id => [id, { title: id }]));
  Object.defineProperty(d.manager, 'summary', { get: () => [...d.manager.tabs.keys()].map(id => ({ id, title: id })) });
  d.history = { load: id => [`items of ${id}`] };
  d.PANEL_MAX_TEXT = 50000;
  d.isStr = s => typeof s === 'string' && s.length > 0;
  d.shown = [];
  d.showPanel = o => d.shown.push(o);
  const { askedBy } = require('../src/main/asking');
  // As wiring/timetrack.js openTab does it.
  const openIn = (win, id) => askedBy(win, () => {
    const placed = w.p.placeNewTab(id);
    d.manager.tabs.set(id, { title: id });
    w.p.sendTabs();
    return placed;
  });
  const lastTabs = win => w.sent.filter(s => s.win === win && s.channel === 'tabs').at(-1).payload;
  return { ...w, askedBy, openIn, lastTabs };
}

test('a conversation opened in a popped-out window is that window\'s, and the panel leaves it out', () => {
  const { p, panel, openIn, lastTabs } = wiredTabs();
  p.popOut('t1');
  const win = p.tabWindow('t1');
  assert.equal(openIn(win, 'new'), true);
  assert.equal(p.tabWindow('new'), win);
  assert.deepEqual(p.popoutTabs(win.webContents), ['t1', 'new']);
  assert.deepEqual(lastTabs(win).filter(t => t.win === 't1').map(t => t.id), ['t1', 'new'], 'its page keeps the ones with its own id');
  assert.deepEqual(lastTabs(panel).filter(t => !t.popped).map(t => t.id), ['t2', 't3']);
});

test('one the panel opens, or one already open, is never taken by another window', () => {
  const { p, openIn } = wiredTabs();
  p.popOut('t1');
  assert.equal(openIn(null, 'new'), false);
  assert.equal(p.isPoppedOut('new'), false);
  assert.equal(openIn(p.tabWindow('t1'), 't2'), false);
  assert.equal(p.isPoppedOut('t2'), false);
});

test('closing one of its conversations leaves the window; closing the last takes it too', () => {
  const { d, p, openIn } = wiredTabs();
  p.popOut('t1');
  const win = p.tabWindow('t1');
  openIn(win, 'new');
  p.closePopout('t1');
  d.manager.tabs.delete('t1');
  assert.equal(win.destroyed, false);
  p.closePopout('new');
  assert.equal(win.destroyed, true);
  assert.equal(p.isPopout(win.webContents), false);
});

test('its × hands every conversation back, each with what was typed, and the panel shows the one that was up', () => {
  const { d, p, panel, sent, openIn } = wiredTabs();
  p.popOut('t1');
  const win = p.tabWindow('t1');
  openIn(win, 'new');
  p.setCarry('t1', { draft: 'half a thought', attachments: [], queue: [] });
  p.closeHome(win.webContents, 'new');
  const back = sent.filter(s => s.channel === 'tab:returned');
  assert.deepEqual(back.map(s => [s.win === panel, s.payload.summary.id, s.payload.carry?.draft]), [[true, 't1', 'half a thought'], [true, 'new', undefined]]);
  assert.deepEqual(d.shown, [{ tabId: 'new' }]);
  assert.equal(p.isPoppedOut('t1') || p.isPoppedOut('new'), false);
});

test('one conversation can go back alone; the window keeps the rest, and the last takes it along', () => {
  const { d, p, sent, openIn } = wiredTabs();
  p.popOut('t1');
  const win = p.tabWindow('t1');
  openIn(win, 'new');
  p.popIn('t1');
  assert.deepEqual(sent.filter(s => s.channel === 'tab:returned').map(s => s.payload.summary.id), ['t1']);
  assert.equal(win.destroyed, false);
  assert.deepEqual(p.popoutTabs(win.webContents), ['new']);
  p.popIn('new');
  assert.equal(win.destroyed, true);
  assert.deepEqual(d.shown, [{ tabId: 't1' }, { tabId: 'new' }]);
});

test('popped out of a popped-out window, it gets a window of its own; alone in one, that one comes forward', () => {
  const { p, openIn } = wiredTabs();
  p.popOut('t1');
  const first = p.tabWindow('t1');
  openIn(first, 'new');
  p.popOut('new');
  const second = p.tabWindow('new');
  assert.notEqual(second, first);
  p.popOut('new');
  assert.equal(p.tabWindow('new'), second, 'alone already');
  assert.equal(p.everyWindow().length, 3);
});

test('two windows are never known by the same id', () => {
  const { p, openIn, lastTabs, panel } = wiredTabs();
  p.popOut('t1');
  openIn(p.tabWindow('t1'), 'new');
  p.popIn('t1'); // the window it named lives on
  p.popOut('t1');
  p.sendTabs();
  const of = id => lastTabs(panel).find(t => t.id === id).win;
  assert.notEqual(of('t1'), of('new'));
});

test('closed from the taskbar, its page is asked for what was typed before it goes', () => {
  const { p, sent } = wiredTabs();
  p.popOut('t1');
  const win = p.tabWindow('t1');
  let held = 0;
  win.emit('close', { preventDefault: () => { held++; } });
  assert.equal(held, 1);
  assert.ok(sent.some(s => s.win === win && s.channel === 'popout:closing'));
  win.emit('close', { preventDefault: () => { held++; } });
  assert.equal(held, 2, 'closed again meanwhile, it still waits for what was typed');
  assert.equal(sent.filter(s => s.channel === 'popout:closing').length, 1, 'and is asked once');
  p.closeHome(win.webContents, 't1'); // its answer
  assert.equal(win.destroyed, true);
});

test('History opening one that is up in another window brings that one forward instead', () => {
  const { d, p, askedBy } = wiredTabs();
  p.popOut('t1');
  const win = p.tabWindow('t1');
  assert.equal(p.showElsewhere('t1'), true, 'asked in the panel');
  assert.equal(win.focused, true);
  assert.equal(askedBy(win, () => p.showElsewhere('t1')), false, 'asked in its own window');
  assert.equal(askedBy(win, () => p.showElsewhere('t2')), true, 'the panel has it');
  assert.deepEqual(d.shown, [{ tabId: 't2' }]);
  assert.equal(p.showElsewhere('t3'), false);
  assert.equal(p.showElsewhere('not open'), false);
});

test('what main says to the panel goes through routes(), and stays the panel\'s with no windows out', () => {
  const { p, panel } = wiredTabs();
  assert.deepEqual(p.routes(panel, 'notes', 1), [[panel, 1]]);
  p.popOut('t1');
  const win = p.tabWindow('t1');
  assert.deepEqual(p.routes(panel, 'notes', 1), [[panel, 1], [win, 1]]);
  assert.deepEqual(p.routes(win, 'notes', 1), [[win, 1]], 'sent to one window, it stays there');
  assert.deepEqual(p.routes(null, 'notes', 1), [[null, 1]]);
});
