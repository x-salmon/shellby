const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HOUR, STAGES, dueAt, rolloutPercent } = require('../src/main/rollout-stages');

const RELEASED = Date.parse('2026-11-04T05:42:19.770Z');
const at = hours => RELEASED + hours * HOUR;
const info = (stagingPercentage, releaseDate = new Date(RELEASED).toISOString()) => ({ version: '1.0.0', stagingPercentage, releaseDate });

test('the schedule starts with some and ends with everyone', () => {
  assert.equal(STAGES[0].after, 0);
  assert.equal(STAGES.at(-1).percent, 100);
  assert.equal(dueAt(0), STAGES[0].percent);
  assert.equal(dueAt(1e6), 100);
});

test('a release moves through the stages by its age, without waiting for a Rollout run', () => {
  assert.equal(rolloutPercent(info(10), at(0)), 10);
  assert.equal(rolloutPercent(info(10), at(5.9)), 10);
  assert.equal(rolloutPercent(info(10), at(6)), 50, 'the 6-hour stage, though the file still says 10');
  assert.equal(rolloutPercent(info(10), at(23.9)), 50);
  assert.equal(rolloutPercent(info(10), at(24)), 100);
});

test('the file still decides who is out entirely, and is a floor otherwise', () => {
  assert.equal(rolloutPercent({ version: '1.0.0' }, at(0)), null, 'no field: everyone');
  assert.equal(rolloutPercent(info(0), at(100)), 0, 'halted stays halted, however old');
  assert.equal(rolloutPercent(info('0'), at(100)), 0, 'as YAML may hand it over');
  assert.equal(rolloutPercent(info(70), at(1)), 70, 'set higher by hand: never lowered');
  assert.equal(rolloutPercent(info(250), at(1)), 100);
});

test('a release date that cannot be read, or one ahead of this clock, leaves the file\'s number', () => {
  assert.equal(rolloutPercent(info(10, 'soon'), at(48)), 10);
  assert.equal(rolloutPercent(info(10, null), at(48)), 10, 'no date at all');
  assert.equal(rolloutPercent(info(10), at(-5)), 10, 'a PC clock behind the release');
  assert.equal(rolloutPercent(info('lots'), at(0)), null, 'garbled: everyone, as electron-updater reads it');
});
