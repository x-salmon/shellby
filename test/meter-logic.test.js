// The usage meter's words (src/renderer/panel/meter-logic.js): the time beside the bars.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/renderer/panel/meter-logic');

const MIN = 60e3;
const H = 60 * MIN;
const NOW = 1_800_000_000_000;

test('a duration reads in minutes, hours and minutes, or days and hours', () => {
  assert.equal(M.duration(40 * 1e3), '1m');
  assert.equal(M.duration(42 * MIN), '42m');
  assert.equal(M.duration(59.5 * MIN), '59m');
  assert.equal(M.duration(60 * MIN), '1h 00m');
  assert.equal(M.duration(2 * H + 5 * MIN), '2h 05m');
  assert.equal(M.duration(3 * 24 * H + 4 * H + 20 * MIN), '3d 4h');
});

test('says when the tighter window resets', () => {
  const u = { fiveHour: { pct: 18, resetsAt: NOW + 2 * H + 10 * MIN }, sevenDay: { pct: 41, resetsAt: NOW + 3 * 24 * H } };
  assert.deepEqual(M.usageWhen(u, null, NOW), { kind: 'reset', window: 'sevenDay', text: 'resets in 3d 0h' });
  const busy = { ...u, fiveHour: { pct: 70, resetsAt: NOW + 2 * H + 10 * MIN } };
  assert.deepEqual(M.usageWhen(busy, null, NOW), { kind: 'reset', window: 'fiveHour', text: 'resets in 2h 10m' });
});

test('a forecast that warns says when it fills instead', () => {
  const u = { fiveHour: { pct: 62, resetsAt: NOW + 3 * H }, sevenDay: { pct: 48, resetsAt: NOW + 2 * 24 * H } };
  const pace = { warn: true, hitAt: NOW + H + 18 * MIN, resetsAt: NOW + 3 * H };
  assert.deepEqual(M.usageWhen(u, pace, NOW), { kind: 'full', window: 'fiveHour', text: 'full in 1h 18m' });
  // One that doesn't warn (too far off, or not before the reset) leaves the reset time.
  assert.equal(M.usageWhen(u, { ...pace, warn: false }, NOW).kind, 'reset');
});

test('says nothing without a reset time still ahead', () => {
  assert.equal(M.usageWhen(null, null, NOW), null);
  assert.equal(M.usageWhen({ fiveHour: { pct: 10, resetsAt: null } }, null, NOW), null);
  assert.equal(M.usageWhen({ fiveHour: { pct: 10, resetsAt: NOW - MIN } }, null, NOW), null);
  // A full window already past its reset gives way to one still ahead.
  const u = { fiveHour: { pct: 100, resetsAt: NOW - MIN }, sevenDay: { pct: 30, resetsAt: NOW + 24 * H } };
  assert.equal(M.usageWhen(u, null, NOW).window, 'sevenDay');
});
