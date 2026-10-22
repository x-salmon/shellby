// A task Shellby starts on a model of its own (wiring/timetrack.js startTask,
// opts.model): the model is set before the first message goes, the only time
// a conversation can still change it (sessions.js setTabModel).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeElectron } = require('./helpers/fake-ipc');

installFakeElectron();
const { wireTimetrack } = require('../src/main/wiring/timetrack');

function setup() {
  const order = [];
  const d = {
    config: { get: () => undefined },
    claudeStatus: { installed: true, loggedIn: true },
    currentCwd: () => 'C:\\code\\app',
    randomUUID: () => 'tab-1',
    manager: {
      open: () => ({ id: 'tab-1' }),
      setTabModel: (tabId, model) => { order.push(['model', tabId, model]); return { ok: true }; },
      send: tabId => { order.push(['send', tabId]); return 'turn-1'; },
    },
    history: { get: () => null, load: () => [] },
    send() {}, wake() {}, panel: {},
  };
  return { start: wireTimetrack(d).startTask, order };
}

test('a model of its own is set before the first message', () => {
  const { start, order } = setup();
  assert.deepEqual(start('Look it over', 'Look over app', { mode: 'ask', model: 'sonnet' }), { ok: true, tabId: 'tab-1' });
  assert.deepEqual(order, [['model', 'tab-1', 'sonnet'], ['send', 'tab-1']]);
});

test('no model leaves the desk’s own', () => {
  const { start, order } = setup();
  start('Fix it', 'Fix');
  assert.deepEqual(order, [['send', 'tab-1']]);
});
