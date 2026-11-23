// usage/service.js: the limit nap, the spend ledger's writes, and the spending
// guard, driven with fakes for everything main hands it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUsage, SPEND_SAVE_MS, OUTLOOK_TICK_MS } = require('../src/main/usage/service');

const NOW = 1_790_000_000_000;
const H = 60 * 60 * 1000;

function fakeConfig(data = {}) {
  const writes = [];
  return {
    data,
    writes,
    get: k => data[k],
    set: patch => { writes.push(patch); Object.assign(data, patch); },
  };
}

function fakePanel() {
  return { isDestroyed: () => false, isVisible: () => false, isFocused: () => false };
}

function setup(over = {}) {
  const calls = { send: [], notify: [], tell: [], active: 0, every: [], interrupted: [], info: [] };
  const config = fakeConfig(over.data);
  const d = {
    config, panel: fakePanel(), manager: over.manager || null, workflows: null, recapLog: [],
    log: { info: (...a) => calls.info.push(a), warn: () => {} },
    send: (_win, channel, payload) => calls.send.push({ channel, payload }),
    notify: (title, body) => calls.notify.push({ title, body }),
    showPanel: () => {},
    refreshCritter: () => {},
    flashState: () => {},
    tellChannel: m => calls.tell.push(m),
    sayText: () => {},
    markActive: () => { calls.active++; },
    routines: () => over.routines || [],
    heldViews: () => [],
    every: (fn, ms) => { calls.every.push(ms); return { unref() {} }; },
    powerMonitor: { getSystemIdleState: () => 'active', getSystemIdleTime: () => 0 },
    ...over.d,
  };
  return { usage: createUsage(d), config, calls };
}

test('a burst of spend is written to settings once, after it settles', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const { usage, config } = setup();
  const tab = { id: 't1', title: 'Fix it', session: { cwd: 'C:\\code\\app' } };

  usage.onSpend({ weight: 1 }, tab);
  usage.onSpend({ weight: 2 }, tab);
  usage.onSpend({ weight: 3 }, tab);
  assert.equal(config.writes.length, 0, 'nothing written mid-burst');
  t.mock.timers.tick(SPEND_SAVE_MS);

  assert.equal(config.writes.length, 1);
  assert.ok(config.writes[0].spendLedger);
});

test('saveSpend with nothing spent writes nothing', () => {
  const { usage, config } = setup();

  usage.saveSpend();

  assert.equal(config.writes.length, 0);
});

test('a routine tab is counted under its routine, by the routine name', () => {
  const { usage } = setup({ routines: [{ id: 'r1', name: 'Morning briefing' }] });

  const s = usage.spendSource({ id: 't1', routineId: 'r1', title: '⟳ old name', session: { cwd: require('path').join(require('path').sep, 'code', 'app') } });

  assert.equal(s.key, 'r:r1');
  assert.equal(s.kind, 'routine');
  assert.equal(s.label, 'Morning briefing');
  assert.equal(s.project, 'app');
});

test('reaching the limit saves the wait, says so, and taps you when it resets', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const { usage, config, calls } = setup();

  usage.onUsage({ fiveHour: { pct: 100, resetsAt: NOW + H } });

  assert.deepEqual(config.data.limitWait, { window: 'fiveHour', resetsAt: NOW + H });
  assert.equal(calls.send.find(s => s.channel === 'limit').payload.phase, 'hit');
  assert.match(calls.notify[0].title, /limit is reached/);
  assert.ok(usage.limitWait());

  t.mock.timers.tick(H + 2000);

  assert.equal(config.data.limitWait, null);
  assert.equal(calls.send.filter(s => s.channel === 'limit').at(-1).payload.phase, 'reset');
  assert.equal(calls.active, 1, 'the reset counts as him being busy');
  assert.deepEqual(calls.tell, [{ kind: 'limit' }]);
});

test('the same limit reported twice is only announced once', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const { usage, calls } = setup();
  const reading = { fiveHour: { pct: 100, resetsAt: NOW + H } };

  usage.onUsage(reading);
  usage.onUsage(reading);

  assert.equal(calls.notify.length, 1);
});

test('stop cancels the pending reset tap', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: NOW });
  const { usage, calls } = setup();
  usage.onUsage({ fiveHour: { pct: 100, resetsAt: NOW + H } });

  usage.stop();
  t.mock.timers.tick(H + 2000);

  assert.equal(calls.send.filter(s => s.channel === 'limit').length, 1, 'only the "hit"');
});

test('the outlook watch goes through main\'s every(), so quitting clears it', () => {
  const { usage, calls } = setup();

  usage.watchOutlook();

  assert.deepEqual(calls.every, [OUTLOOK_TICK_MS]);
});

test('the outlook goes to every window, so a popped-out conversation can offer "Send after the reset"', () => {
  const everywhere = [];
  let tick = null;
  const { usage, config, calls } = setup({ d: {
    sendEveryWindow: (channel, payload) => everywhere.push({ channel, payload }),
    every: fn => { tick = fn; return { unref() {} }; }, // main's every(), stepped by hand
  } });

  usage.sendOutlook();
  assert.equal(everywhere.filter(s => s.channel === 'outlook').length, 1);
  assert.equal(calls.send.filter(s => s.channel === 'outlook').length, 0, 'not the panel alone');

  // The watch noticing it has changed (here, keep-awake turned off) goes everywhere too.
  usage.watchOutlook();
  config.set({ queueKeepAwake: false });
  tick();
  assert.equal(everywhere.filter(s => s.channel === 'outlook').length, 2);
});

test('resetTarget is the limit you are held at, else the 5-hour window\'s next reset', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const { usage, config } = setup({ data: { lastUsage: { fiveHour: { pct: 40, resetsAt: NOW + 2 * H } } } });

  assert.equal(usage.resetTarget(), NOW + 2 * H);
  config.data.limitWait = { window: 'sevenDay', resetsAt: NOW + 30 * H };
  assert.equal(usage.resetTarget(), NOW + 30 * H);
});

test('the spending guard stops a routine that has run past its time cap', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const tab = { id: 't1', title: '⟳ Nightly', turnFrom: { routine: { reason: 'scheduled' } }, session: { mode: 'ask' } };
  const manager = { tabs: new Map([['t1', tab]]), isBusy: () => true, interrupt: id => calls.interrupted.push(id) };
  const { usage, calls } = setup({ manager, data: { spendMaxMinutes: 15 } });

  usage.armGuard(tab);
  t.mock.timers.setTime(NOW + 16 * 60 * 1000);
  usage.checkGuards();

  assert.deepEqual(calls.interrupted, ['t1']);
  assert.equal(tab.guardRun.stopped.reason, 'time');
  assert.equal(calls.notify.length, 1);
});

test('the spending guard leaves a run you typed yourself alone', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const tab = { id: 't1', title: 'Fix it', turnFrom: null, session: { mode: 'ask' } };
  const manager = { tabs: new Map([['t1', tab]]), isBusy: () => true, interrupt: id => calls.interrupted.push(id) };
  const { usage, calls } = setup({ manager, data: { lastUsage: { fiveHour: { pct: 99, resetsAt: NOW + H } } } });

  usage.armGuard(tab);
  usage.checkGuards();

  assert.deepEqual(calls.interrupted, []);
});

test("a folder on another account's computer has that plan's limit and reset, not this PC's", t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const account = { host: 'devbox', email: 'work@corp.com', plan: 'max' };
  const { usage, config } = setup({
    d: { accountOfCwd: cwd => (cwd === 'C:\\anchors\\devbox' ? account : null) },
    data: {
      // No 5-hour window running here, as when all your work is over there.
      lastUsage: { fiveHour: null, sevenDay: { pct: 51, resetsAt: NOW + 70 * H } },
      usageByHost: { devbox: { ...account, status: 'rejected', fiveHour: { pct: 100, resetsAt: NOW + 4 * H }, sevenDay: { pct: 58, resetsAt: NOW + 18 * H }, at: NOW } },
    },
  });

  assert.equal(usage.resetTarget('C:\\anchors\\devbox'), NOW + 4 * H);
  assert.deepEqual(usage.limitWait('C:\\anchors\\devbox'), { window: 'fiveHour', resetsAt: NOW + 4 * H });
  assert.equal(usage.resetTarget('C:\\code'), null);
  assert.equal(usage.limitWait('C:\\code'), null);
  assert.equal(usage.limitWait(), null);

  config.data.limitWait = { window: 'sevenDay', resetsAt: NOW + 70 * H };
  assert.equal(usage.resetTarget('C:\\anchors\\devbox'), NOW + 4 * H, "this PC's limit doesn't move it");
  assert.equal(usage.resetTarget('C:\\code'), NOW + 70 * H);
});

test("the spending guard judges a run by the plan it spends", t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const account = { host: 'devbox', email: 'work@corp.com', plan: 'max' };
  const run = (id, cwd) => ({ id, title: id, turnFrom: { routine: { reason: 'scheduled' } }, session: { mode: 'ask', cwd } });
  const tabs = new Map([['here', run('here', 'C:\\code')], ['there', run('there', 'C:\\anchors\\devbox')]]);
  const manager = { tabs, isBusy: () => true, interrupt: id => calls.interrupted.push(id) };
  const { usage, calls } = setup({
    manager,
    d: { accountOfCwd: cwd => (cwd === 'C:\\anchors\\devbox' ? account : null) },
    data: {
      lastUsage: { fiveHour: { pct: 95, resetsAt: NOW + H } },
      usageByHost: { devbox: { ...account, status: 'allowed', fiveHour: { pct: 5, resetsAt: NOW + H }, sevenDay: null, at: NOW } },
    },
  });

  for (const tab of tabs.values()) usage.armGuard(tab);
  usage.checkGuards();

  assert.deepEqual(calls.interrupted, ['here']);
});
