// routines/pace.js: whether a routine due now waits for the 5-hour reset, and
// what Shellby says about it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pace = require('../src/main/routines/pace');

const NOW = 1_790_000_000_000;
const MIN = 60 * 1000;
const RESET = NOW + 2 * 60 * MIN;
const reading = pct => ({ fiveHour: { pct, resetsAt: RESET } });
const guardOn = { on: true, reserve: 25, maxMinutes: 60 };
const guardOff = { on: false, reserve: 25, maxMinutes: 60 };
const clock = t => `at ${t}`;

test('a window well under the line lets a routine run', () => {
  assert.equal(pace.waitFor({}, { usage: reading(40), settings: guardOn, now: NOW }), null);
});

test('past the share you keep, it waits for the reset and says so', () => {
  const hold = pace.waitFor({}, { usage: reading(80), settings: guardOn, now: NOW });
  assert.deepEqual(hold, { reason: 'reserve', pct: 80, until: RESET, reserve: 25 });
  assert.equal(pace.message(hold, clock), 'Your 5-hour window is at 80%, and you asked to keep 25% for yourself.');
});

test('with the guard off, a window nearly full still waits from the named line', () => {
  assert.equal(pace.waitFor({}, { usage: reading(pace.NEAR_LIMIT_PCT - 1), settings: guardOff, now: NOW }), null);
  const hold = pace.waitFor({}, { usage: reading(pace.NEAR_LIMIT_PCT), settings: guardOff, now: NOW });
  assert.deepEqual(hold, { reason: 'near', pct: pace.NEAR_LIMIT_PCT, until: RESET });
  assert.match(pace.message(hold, clock), /at 85%, close to the limit/);
});

test('a forecast that fills the window before a run could finish waits too', () => {
  const soon = { pct: 60, hitAt: NOW + 20 * MIN, resetsAt: RESET };
  const hold = pace.waitFor({}, { usage: reading(60), outlook: soon, settings: guardOff, now: NOW, runMs: 30 * MIN });
  assert.deepEqual(hold, { reason: 'pace', pct: 60, until: RESET, hitAt: NOW + 20 * MIN });
  assert.equal(pace.message(hold, clock), `At this pace your 5-hour window fills around at ${NOW + 20 * MIN}, before a run could finish.`);
});

test('a forecast hit further off than the run, or about another window, is no reason to wait', () => {
  const later = { pct: 60, hitAt: NOW + 50 * MIN, resetsAt: RESET };
  assert.equal(pace.waitFor({}, { usage: reading(60), outlook: later, settings: guardOff, now: NOW, runMs: 30 * MIN }), null);
  const stale = { pct: 60, hitAt: NOW + 5 * MIN, resetsAt: RESET - 60 * MIN };
  assert.equal(pace.waitFor({}, { usage: reading(60), outlook: stale, settings: guardOff, now: NOW, runMs: 30 * MIN }), null);
  assert.equal(pace.waitFor({}, { usage: reading(60), outlook: null, settings: guardOff, now: NOW }), null);
});

test('"Run even near the limit" skips every reason to wait', () => {
  const r = { runNearLimit: true };
  const soon = { pct: 95, hitAt: NOW + MIN, resetsAt: RESET };
  assert.equal(pace.waitFor(r, { usage: reading(95), outlook: soon, settings: guardOn, now: NOW }), null);
});

test('no usable reading (none, or one about a window that has reset) means run', () => {
  assert.equal(pace.waitFor({}, { usage: null, settings: guardOn, now: NOW }), null);
  assert.equal(pace.waitFor({}, { usage: { fiveHour: { pct: 99, resetsAt: NOW - 1 } }, settings: guardOn, now: NOW }), null);
  assert.equal(pace.waitFor({}, { usage: { fiveHour: { pct: NaN, resetsAt: RESET } }, settings: guardOn, now: NOW }), null);
});

test('his line names the routine, when it runs, and why', () => {
  assert.equal(pace.line('Nightly', { reason: 'near', pct: 90, until: RESET }, '3:15 PM'), '"Nightly" waits for the reset at 3:15 PM: we\'re at 90%.');
  assert.equal(pace.line('Nightly', { reason: 'pace', pct: 60, until: RESET, hitAt: NOW }, '3:15 PM'), '"Nightly" waits for the reset at 3:15 PM: we\'d run dry partway.');
});
