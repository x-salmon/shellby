const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { createLean } = require('../src/main/lean');

const PLUGINS = ['a@m', 'b@m', 'c@m', 'd@m', 'e@m', 'f@m'].map(id => ({ id, name: id.split('@')[0], version: '1', installed: true, enabled: true, scope: 'user', dir: null }));

function fakeConfig() {
  const store = {};
  const sets = [];
  return { store, sets, get: k => store[k], set: o => { sets.push(Object.keys(o)); Object.assign(store, o); } };
}

function leanWith({ shop, config = fakeConfig(), reportMs } = {}) {
  return createLean({
    config, shop: () => shop, shopBlocked: () => null, askOnce: async () => 1, toolbox: () => null,
    setupWhere: () => ({ home: os.tmpdir(), cwd: os.tmpdir() }), memory: () => [],
    configDir: () => path.join(os.tmpdir(), 'shellby-lean-test-no-such-dir'),
    projectOf: () => null, currentProject: () => null, awardXp() {}, log: { info() {} }, reportMs,
  });
}

test('report: lists plugins from the cached list, without waiting for a refresh', async () => {
  const asked = [];
  const shop = { list: async o => { asked.push(o); return { ok: true, plugins: PLUGINS }; }, details: async () => ({ alwaysOnTokens: 100, hooks: 0, lsp: 0 }) };
  const r = await leanWith({ shop }).report();
  assert.equal(r.ok, true);
  assert.equal(r.plugins.length, PLUGINS.length);
  assert.deepEqual(asked[0], { stale: true });
});

test('report: "Check again" asks for a fresh list', async () => {
  const asked = [];
  const shop = { list: async o => { asked.push(o); return { ok: true, plugins: [] }; }, details: async () => null };
  await leanWith({ shop }).report({ refresh: true });
  assert.deepEqual(asked[0], { stale: false });
});

test('report: answers with an error when Claude Code never does, and the next try starts over', async () => {
  let lists = 0;
  const shop = { list: () => { lists++; return lists === 1 ? new Promise(() => {}) : Promise.resolve({ ok: true, plugins: [] }); }, details: async () => null };
  const lean = leanWith({ shop, reportMs: 50 });
  const r = await lean.report();
  assert.equal(r.ok, false);
  assert.match(r.error, /taking too long/);
  const again = await lean.report();
  assert.equal(again.ok, true, "the hung report doesn't hold up the next one");
});

test('report: what every turn carries, with its one-line summary, and the fixes drafted for the folder', async () => {
  const shop = { list: async () => ({ ok: true, plugins: PLUGINS.slice(0, 1) }), details: async () => ({ alwaysOnTokens: 1200, hooks: 0, lsp: 0 }) };
  const config = fakeConfig();
  config.store.outputStyle = 'Explanatory';
  config.store.setupWeights = { 'c:\\x': { name: 'x', tokens: 20000, at: Date.now() } };
  const r = await leanWith({ shop, config }).report();
  assert.equal(r.ok, true);
  assert.equal(r.fixed.total, 20000, 'the measured setup is the total');
  assert.equal(r.fixed.line, 'setup ~20k/turn');
  assert.deepEqual(r.fixed.items.map(i => i.kind), ['plugin', 'style']);
  assert.equal(r.fixed.items[0].tokens, 1200, "Claude Code's own estimate");
  assert.equal(r.fixed.suggestions[0].id, 'style-off');
  assert.deepEqual(r.fixes, [], 'the home folder is no project, so nothing to fix there');
});

test('report: plugin estimates are kept batch by batch, not only at the end', async () => {
  const config = fakeConfig();
  const shop = { list: async () => ({ ok: true, plugins: PLUGINS }), details: async () => ({ alwaysOnTokens: 10, hooks: 0, lsp: 0 }) };
  await leanWith({ shop, config }).report();
  const saves = config.sets.filter(keys => keys.includes('pluginCosts')).length;
  assert.ok(saves >= 2, `saved ${saves} times for ${PLUGINS.length} plugins`);
  assert.equal(Object.keys(config.store.pluginCosts).length, PLUGINS.length);
});
