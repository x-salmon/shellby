// routines/service.js: starting a routine's run, making room for it, holding
// it at the limit, and asking before Claude adds one, with fakes for the tabs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRoutines, ROUTINE_TABS_KEPT, ROUTINE_COOLDOWN_MS } = require('../src/main/routines/service');

const NOW = 1_790_000_000_000;
const H = 60 * 60 * 1000;

function fakeManager() {
  const tabs = new Map();
  const busy = new Set();
  return {
    tabs, busy,
    isBusy: id => busy.has(id),
    send: () => 'turn-1',
    close: id => tabs.delete(id),
  };
}

function setup(over = {}) {
  const data = { routines: over.routines || [], ...over.data };
  const calls = { opened: [], notify: [], held: [], saved: [], said: [], asked: 0, stats: [] };
  const manager = fakeManager();
  let ids = 0;
  const d = {
    config: { get: k => data[k], set: patch => Object.assign(data, patch) },
    panel: {},
    manager,
    history: { get: () => null, load: () => [], list: () => [] },
    claudeStatus: over.claudeStatus === undefined ? { loggedIn: true } : over.claudeStatus,
    remote: null,
    log: { info: () => {}, warn: () => {} },
    send: () => {},
    notify: (title, body) => calls.notify.push({ title, body }),
    showPanel: () => {},
    sayText: text => calls.said.push(text),
    wake: () => {},
    openTab: opts => { calls.opened.push(opts); manager.tabs.set(opts.tabId, { id: opts.tabId }); },
    currentCwd: () => 'C:\\code',
    stat: what => calls.stats.push(what),
    dialogLook: () => ({}),
    confirm: { ask: async () => { calls.asked++; return over.answer ?? 1; } },
    runClaudeOnce: async () => ({ stdout: '', stderr: '' }),
    knownProjects: () => [],
    isFolder: () => true,
    randomUUID: () => `tab-${++ids}`,
    limitWait: () => over.limit || null,
    guardSettings: () => over.guard || { on: true, reserve: 25, maxMinutes: 60 },
    forecastNow: () => over.outlook || null,
    clockTime: t => `at ${t}`,
    heldList: () => over.heldList || [],
    holdForReset: raw => { calls.held.push(raw); return { ok: true, added: calls.held.length === 1, atText: 'soon' }; },
    saveHeld: list => calls.saved.push(list),
    scheduleHeld: () => {},
    syncKeepAwake: () => {},
    queueTabs: new Map(),
  };
  return { svc: createRoutines(d), data, calls, manager };
}

const nightly = { id: 'r1', name: 'Nightly', prompt: 'tidy up', mode: 'ask', enabled: true, schedule: { kind: 'daily', time: '03:00' } };

test('a routine does not start while Claude Code is signed out', () => {
  const { svc, calls } = setup({ claudeStatus: { loggedIn: false } });

  const res = svc.runRoutine(nightly);

  assert.equal(res.skipped, true);
  assert.deepEqual(calls.opened, []);
});

test('a run opens its own tab, sends the prompt and notes when it ran', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { svc, data, calls } = setup({ routines: [nightly] });

  const res = svc.runRoutine(nightly);

  assert.equal(res.ok, true);
  assert.equal(calls.opened[0].routineId, 'r1');
  assert.equal(calls.opened[0].title, '⟳ Nightly');
  assert.equal(svc.routineTabs.get(res.tabId), 'r1');
  assert.equal(data.routines[0].lastRunAt, NOW);
  assert.deepEqual(calls.stats, ['routine-run']);
});

test('a routine still running from last time is skipped, not started twice', () => {
  const { svc, manager } = setup({ routines: [nightly] });
  const first = svc.runRoutine(nightly);
  manager.busy.add(first.tabId);

  const second = svc.runRoutine(nightly);

  assert.equal(second.skipped, true);
  assert.match(second.error, /still running/);
});

test('past the kept number of finished routine tabs, the oldest closes', () => {
  const { svc, manager } = setup({ routines: [nightly] });
  const opened = [];
  for (let i = 0; i < ROUTINE_TABS_KEPT; i++) opened.push(svc.runRoutine(nightly).tabId);

  svc.makeRoomForRoutine();

  assert.equal(manager.tabs.has(opened[0]), false);
  assert.equal(svc.routineTabs.has(opened[0]), false);
  assert.equal(manager.tabs.size, ROUTINE_TABS_KEPT - 1);
});

test('a routine due at the limit is held for the reset, and you are told once', () => {
  const limit = { window: 'fiveHour', resetsAt: NOW + H };
  const { svc, calls } = setup({ routines: [nightly], limit });

  const first = svc.runOrHoldRoutine(nightly, 'scheduled');
  const again = svc.runOrHoldRoutine(nightly, 'scheduled');

  assert.deepEqual(first, { ok: true, held: true });
  assert.deepEqual(again, { ok: true, held: true });
  assert.equal(calls.held[0].auto, true);
  assert.equal(calls.notify.length, 1);
  assert.deepEqual(calls.opened, []);
});

test('a routine due with the window nearly full waits for the reset, and he says so once', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const lastUsage = { fiveHour: { pct: 90, resetsAt: NOW + H }, at: NOW };
  const { svc, calls } = setup({ routines: [nightly], data: { lastUsage }, guard: { on: false, reserve: 25, maxMinutes: 60 } });

  const first = svc.runOrHoldRoutine(nightly, 'scheduled');
  const again = svc.runOrHoldRoutine(nightly, 'scheduled'); // the next slot, still waiting

  assert.deepEqual(first, { ok: true, held: true });
  assert.deepEqual(again, { ok: true, held: true });
  assert.deepEqual(calls.opened, [], 'it did not start');
  assert.equal(calls.held.length, 2, 'asked to hold both times (held.js keeps the first)');
  assert.equal(calls.held[0].why, 'near');
  assert.equal(calls.held[0].auto, true);
  assert.equal(calls.notify.length, 1, 'told once');
  assert.match(calls.notify[0].body, /at 90%, close to the limit/);
  assert.equal(calls.said.length, 1, 'the crab says it once');
  assert.match(calls.said[0], /"Nightly" waits for the reset at soon/);
});

test('the forecast alone can hold a routine: the window fills before a run could finish', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const lastUsage = { fiveHour: { pct: 60, resetsAt: NOW + 2 * H }, at: NOW };
  const outlook = { pct: 60, hitAt: NOW + 10 * 60 * 1000, resetsAt: NOW + 2 * H };
  const { svc, calls } = setup({ routines: [nightly], data: { lastUsage }, outlook, guard: { on: false, reserve: 25, maxMinutes: 60 } });

  const res = svc.runOrHoldRoutine(nightly, 'scheduled');

  assert.deepEqual(res, { ok: true, held: true });
  assert.equal(calls.held[0].why, 'pace');
  assert.match(calls.notify[0].body, /fills around at \d+, before a run could finish/);
});

test('"Run even near the limit" runs it anyway, and takes the run Shellby held off the list', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const lastUsage = { fiveHour: { pct: 90, resetsAt: NOW + H }, at: NOW };
  const heldList = [{ id: 'h1', kind: 'routine', routineId: 'r1', auto: true, at: NOW + H }, { id: 'h2', kind: 'routine', routineId: 'other', auto: true, at: NOW + H }];
  const brave = { ...nightly, runNearLimit: true };
  const { svc, calls } = setup({ routines: [brave], data: { lastUsage }, heldList });

  const res = svc.runOrHoldRoutine(brave, 'scheduled');

  assert.equal(res.ok, true);
  assert.equal(calls.opened.length, 1, 'it ran');
  assert.deepEqual(calls.held, [], 'nothing new held');
  assert.deepEqual(calls.saved[0].map(h => h.id), ['h2'], 'its own held run is gone; another routine\'s stays');
});

test('a run you held yourself stays when the routine runs on schedule', () => {
  const heldList = [{ id: 'h1', kind: 'routine', routineId: 'r1', auto: false, at: NOW + H }];
  const { svc, calls } = setup({ routines: [nightly], heldList });

  svc.runOrHoldRoutine(nightly, 'scheduled');

  assert.equal(calls.opened.length, 1);
  assert.deepEqual(calls.saved, [], 'your hold is yours');
});

test('after a routine is turned down, Claude must wait before proposing another', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { svc, calls } = setup({ answer: 1 });

  const first = await svc.proposeRoutine({ ...nightly, id: 'new' });
  const second = await svc.proposeRoutine({ ...nightly, id: 'new' });
  t.mock.timers.setTime(NOW + ROUTINE_COOLDOWN_MS + 1);
  await svc.proposeRoutine({ ...nightly, id: 'new' });

  assert.ok(first.text, 'the decline is reported back to Claude');
  assert.equal(second.status, 429);
  assert.equal(calls.asked, 2, 'asked again once the quiet spell is over');
});

test('a yes saves the proposed routine', async () => {
  const { svc, data } = setup({ answer: 0 });

  await svc.proposeRoutine({ ...nightly, id: 'new' });

  assert.equal(data.routines.length, 1);
  assert.equal(data.routines[0].name, 'Nightly');
});

test('changing a routine without naming a model or catch-up keeps the ones it had', async () => {
  const kept = { ...nightly, model: 'haiku', catchUp: false };
  const { svc, data } = setup({ answer: 0, routines: [kept] });

  await svc.proposeRoutine({ ...nightly, id: 'new', prompt: 'tidy more', model: '', catchUp: true }, { modelGiven: false, catchUpGiven: false });

  assert.equal(data.routines.length, 1);
  assert.equal(data.routines[0].prompt, 'tidy more');
  assert.equal(data.routines[0].model, 'haiku');
  assert.equal(data.routines[0].catchUp, false);
});

test('the scheduler starts once, and stopping it is safe either side of that', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'setImmediate', 'Date'], now: NOW });
  const { svc } = setup();

  svc.stop();
  assert.equal(svc.isScheduling(), false);
  svc.startScheduler();
  assert.equal(svc.isScheduling(), true);
  svc.stop();
});

test('routines due on the same tick go one after another, five seconds apart', t => {
  const start = new Date(2026, 9, 2, 8, 59, 0).getTime();
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'setImmediate', 'Date'], now: start });
  const at9 = (id, name) => ({ id, name, prompt: 'tidy up', mode: 'ask', enabled: true, catchUp: true, createdAt: start - 48 * H, schedule: { type: 'daily', time: '09:00' } });
  const { svc, calls } = setup({ routines: [at9('a', 'One'), at9('b', 'Two')] });
  try {
    svc.startScheduler();
    t.mock.timers.tick(1); // the first tick only sets where it counts from
    t.mock.timers.tick(60_000); // 09:00 passes
    assert.deepEqual(calls.opened.map(o => o.routineId), ['a']);
    t.mock.timers.tick(5_000);
    assert.deepEqual(calls.opened.map(o => o.routineId), ['a', 'b']);
  } finally { svc.stop(); }
});
