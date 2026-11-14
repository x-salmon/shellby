const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/renderer/panel/tank-gauges-more');

const world = { w: 160, h: 64, sandTop: 52 };

test('the staff has a band per tenth, stacked without gaps from the sand to the top', () => {
  const s = M.staffOf(world, 60);
  assert.equal(s.bands.length, M.STAFF.bands);
  assert.equal(s.bands[0].y + s.bands[0].h, s.bottom, 'the first band sits on the sand');
  for (let i = 1; i < s.bands.length; i++) assert.equal(s.bands[i].y + s.bands[i].h, s.bands[i - 1].y);
  assert.equal(s.bands.at(-1).y, M.STAFF.top);
  assert.ok(s.bands.every(b => b.h > 0));
  assert.deepEqual(s.bands.map(b => b.red), [true, false, true, false, true, false, true, false, true, false]);
});

test('the bands under the level are wet, one per tenth left', () => {
  const wet = left => M.staffOf(world, left).bands.filter(b => b.wet).length;
  assert.equal(wet(100), 10);
  assert.equal(wet(60), 6);
  assert.equal(wet(10), 1);
  assert.equal(wet(0), 0);
});

test('the level runs from the top of the staff when full to the sand when empty', () => {
  assert.equal(M.staffOf(world, 100).level, M.STAFF.top);
  assert.equal(M.staffOf(world, 0).level, M.staffOf(world, 0).bottom);
  assert.ok(M.staffOf(world, 30).level > M.staffOf(world, 70).level);
});

test('it runs low at a fifth or less', () => {
  assert.equal(M.staffOf(world, 30).low, false);
  assert.equal(M.staffOf(world, 20).low, true);
  assert.equal(M.staffOf(world, 0).low, true);
});

test('a reading out of range or not a number is held to the staff', () => {
  assert.equal(M.staffOf(world, 140).level, M.staffOf(world, 100).level);
  assert.equal(M.staffOf(world, -5).level, M.staffOf(world, 0).level);
  assert.equal(M.staffOf(world, 'x').level, M.staffOf(world, 0).level);
});

test('a taller tank gives a taller staff, still a band per tenth', () => {
  const tall = M.staffOf({ w: 240, h: 80, sandTop: 68 }, 50);
  assert.ok(tall.span > M.staffOf(world, 50).span);
  assert.equal(tall.bands.filter(b => b.wet).length, 5);
});
