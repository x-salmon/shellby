const { test } = require('node:test');
const assert = require('node:assert/strict');
const { signalsOf, anySignal, STUCK_MS } = require('../src/main/work-signs');
const workmode = require('../src/main/workmode');

const NOW = 10 * STUCK_MS;

test('nothing running and nothing red means no signals', () => {
  const s = signalsOf({}, NOW);
  assert.deepEqual(s, { stuck: 0, red: 0, near: null, recheckIn: null });
  assert.equal(anySignal(s), false);
});

test('a helper out past STUCK_MS counts as stuck; a newer one sets when to look again', () => {
  const s = signalsOf({ crew: [{ startedAt: NOW - STUCK_MS - 1 }, { startedAt: NOW - 60000 }] }, NOW);
  assert.equal(s.stuck, 1);
  assert.equal(s.recheckIn, STUCK_MS - 60000);
  assert.equal(anySignal(s), true);
});

test('a helper with no start time is never stuck', () => {
  assert.equal(signalsOf({ crew: [{}, { startedAt: 'soon' }, null] }, NOW).stuck, 0);
});

test('red conversations are counted as given, never negative', () => {
  assert.equal(signalsOf({ red: 2 }, NOW).red, 2);
  assert.equal(signalsOf({ red: -3 }, NOW).red, 0);
});

test('the window shows as running low only when the forecast warns', () => {
  assert.equal(signalsOf({ outlook: { pct: 81.6, warn: true } }, NOW).near, 82);
  assert.equal(signalsOf({ outlook: { pct: 81.6, warn: false } }, NOW).near, null);
  assert.equal(signalsOf({ outlook: { pct: 140, warn: true } }, NOW).near, 100);
});

test('Work mode keeps him quiet: his signs carry what needs you', () => {
  assert.equal(workmode.effective({ workMode: true, chatter: 'chatty' }).chatter, 'quiet');
});
