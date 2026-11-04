// What you do with him, recorded in main (wiring/feature-acts.js): the stats
// that mean an action count it, featureAct counts the rest, and the count is
// saved under featureUse beside the renderer's visits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const featureUse = require('../src/main/feature-use');
const { wireFeatureActs, STAT_ACTIONS } = require('../src/main/wiring/feature-acts');

function setup(settings = {}) {
  let store = { ...settings };
  let sets = 0;
  const stats = [];
  const d = {
    config: { get: k => store[k], set: o => { sets++; store = { ...store, ...o }; } },
    onStat: fn => { stats.push(fn); },
  };
  const w = wireFeatureActs(d);
  return { d, w, store: () => store, sets: () => sets, stat: (event, payload) => stats.forEach(fn => fn(event, payload)) };
}

test('a stat that is an action counts it under featureUse.uses', () => {
  const { w, store, stat } = setup();
  stat('find-made', { id: 'pearl' });
  stat('bug-caught', { species: 'x' });
  stat('bug-caught', { species: 'y' });
  assert.equal(store().featureUse.uses['find-made'].n, 1);
  assert.equal(store().featureUse.uses['bug-caught'].n, 2);
  assert.ok(typeof w.featureAct === 'function');
});

test('every stat on the map is an action feature-use.js lists, and one listener is registered', () => {
  const stats = [];
  wireFeatureActs({ config: { get: () => null, set: () => {} }, onStat: fn => stats.push(fn) });
  assert.equal(stats.length, 1);
  const ids = new Set(featureUse.ACTIONS.map(a => a.id));
  for (const id of Object.values(STAT_ACTIONS)) assert.ok(ids.has(id), id);
});

test('a stat that is not an action saves nothing', () => {
  const { store, sets, stat } = setup();
  stat('petted');
  stat('tank-pieces', { n: 4 });
  assert.equal(sets(), 0);
  assert.equal(store().featureUse, undefined);
});

test('featureAct counts an action and ignores an unknown or odd id', () => {
  const { w, store, sets } = setup();
  w.featureAct('outfit');
  w.featureAct('reward-opened');
  w.featureAct('outfit');
  assert.equal(store().featureUse.uses.outfit.n, 2);
  assert.equal(store().featureUse.uses['reward-opened'].n, 1);
  const n = sets();
  w.featureAct('nope');
  w.featureAct(null);
  w.featureAct({ id: 'outfit' });
  assert.equal(sets(), n, 'nothing to save');
});

test('the visits the renderer saved stay, read fresh each time', () => {
  const visits = featureUse.record(null, 'chat', 1000);
  const { d, w, store } = setup({ featureUse: visits });
  w.featureAct('tank');
  assert.deepEqual(store().featureUse.views, visits.views);
  assert.equal(store().featureUse.since, 1000, 'the clock started with the first visit');
  // Another visit lands between two actions (the renderer writes the same key).
  d.config.set({ featureUse: featureUse.record(store().featureUse, 'tank', 2000) });
  w.featureAct('tank');
  assert.equal(store().featureUse.views.tank.n, 1);
  assert.equal(store().featureUse.uses.tank.n, 2);
});

test('wiring without a stat bus still records', () => {
  let store = {};
  const w = wireFeatureActs({ config: { get: k => store[k], set: o => { store = { ...store, ...o }; } } });
  w.featureAct('battle');
  assert.equal(store.featureUse.uses.battle.n, 1);
});
