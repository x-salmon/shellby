// How he takes a finished turn (src/main/flourish.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { pick, NAMES, BIG_TURN_MS, COMEBACK_AFTER } = require('../src/main/flourish');

test('only a finished turn gets a flourish', () => {
  for (const s of ['idle', 'working', 'learned', 'levelup', undefined]) assert.equal(pick(s, { rand: () => 0.5 }), null, String(s));
});

test('a comeback beats a long turn, and both beat his temperament', () => {
  assert.equal(pick('success', { missesBefore: COMEBACK_AFTER, durationMs: BIG_TURN_MS, temperament: 'fussy' }), 'phew');
  assert.equal(pick('success', { missesBefore: COMEBACK_AFTER - 1, durationMs: BIG_TURN_MS }), 'big');
  assert.notEqual(pick('error', { missesBefore: 5, durationMs: BIG_TURN_MS, rand: () => 0 }), 'phew', 'a miss is never a comeback');
  assert.notEqual(pick('error', { durationMs: BIG_TURN_MS, rand: () => 0 }), 'big');
});

test('his temperament picks from what suits him, and his old move still comes round', () => {
  for (const temperament of ['chipper', 'fussy', 'cocky', 'sleepy', 'nobody', null]) {
    for (const state of ['success', 'error']) {
      const seen = new Set();
      for (let i = 0; i < 20; i++) seen.add(pick(state, { temperament, rand: () => i / 20 }));
      for (const f of seen) assert.ok(f === null || NAMES.includes(f), `${temperament} ${state}: ${f}`);
      assert.ok(seen.size > 1, `${temperament} ${state}: more than one move`);
    }
  }
  assert.ok([0, 0.3, 0.6, 0.99].some(r => pick('success', { temperament: 'chipper', rand: () => r }) === null), 'the double jump is still his');
  assert.equal(pick('error', { temperament: 'sleepy', rand: () => 0 }), 'slump');
  assert.notEqual(pick('success', { rand: () => 1 }), undefined, 'a rand of 1 still lands on a move');
});

test('every flourish has its moves in critter.css', () => {
  const css = fs.readFileSync(require.resolve('../src/renderer/critter/critter.css'), 'utf8');
  for (const f of NAMES) assert.ok(css.includes(`.flourish-${f} #sprite`), `critter.css draws ${f}`);
});
