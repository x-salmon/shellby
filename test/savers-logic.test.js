// The inline savers' arbitration (src/renderer/panel/savers-logic.js): one
// card at a time, the divider over the model card, the model card backing off
// after two keeps, and the lines unanswered cards fold into.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/renderer/panel/savers-logic');

test('pick: the fresh-tab divider wins over the model card; nothing while a card is up', () => {
  assert.equal(S.pick({ handoff: true, model: true }), 'handoff');
  assert.equal(S.pick({ handoff: false, model: true }), 'model');
  assert.equal(S.pick({ model: true }), 'model');
  assert.equal(S.pick({}), null);
  assert.equal(S.pick(null), null);
  assert.equal(S.pick({ handoff: true, model: true }, 'nudge'), null, 'a nudge card is up: wait');
  assert.equal(S.pick({ model: true }, 'model'), null);
  assert.deepEqual(S.ORDER, ['handoff', 'model']);
});

test('keepsAfter counts keeps and timeouts in a row, and any other pick starts over', () => {
  assert.equal(S.keepsAfter(0, 'keep'), 1);
  assert.equal(S.keepsAfter(1, 'timeout'), 2);
  assert.equal(S.keepsAfter(undefined, 'keep'), 1);
  assert.equal(S.keepsAfter(5, 'cheaper'), 0);
  assert.equal(S.keepsAfter(5, 'always'), 0);
});

test('quiet after KEEP_LIMIT keeps, not before', () => {
  assert.equal(S.KEEP_LIMIT, 2);
  assert.equal(S.quiet(S.KEEP_LIMIT - 1), false);
  assert.equal(S.quiet(S.KEEP_LIMIT), true);
  assert.equal(S.quiet(undefined), false);
});

test('countdownText rounds up to the second and never goes below zero', () => {
  assert.equal(S.countdownText('Opus', 6000), 'Opus in 6 s if you don\'t pick');
  assert.equal(S.countdownText('Opus', 5200), 'Opus in 6 s if you don\'t pick');
  assert.equal(S.countdownText('Opus', -10), 'Opus in 0 s if you don\'t pick');
  assert.ok(S.COUNTDOWN_MS >= 5000 && S.COUNTDOWN_MS <= 15000, 'a short wait, long enough to read the card');
});

test('foldLine says what happened in one line', () => {
  assert.match(S.foldLine('model', { modelName: 'Opus' }), /^Kept Opus: nothing was picked in time\./);
  assert.equal(S.foldLine('nudge', { rel: 'package-lock.json', tokens: '38k' }), 'Claude read package-lock.json again (about 38k tokens). The Lean tab has a one-tap fix for it.');
  assert.match(S.foldLine('nudge', {}), /^Claude read that file again\./);
  assert.match(S.foldLine('handoff'), /context chip/);
  assert.equal(S.foldLine('other'), '');
});
