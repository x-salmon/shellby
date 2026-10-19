// Quiet hours for Shellby on your phone (pocket/quiet.js): a window in the
// PC's local time, crossing midnight when it must, checked at the door.
const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../src/main/pocket/quiet');

// A timestamp at hh:mm today, local time.
const at = (hh, mm = 0) => { const d = new Date(2026, 0, 15, hh, mm); return d.getTime(); };

test('times are hours and minutes', () => {
  assert.equal(q.minutesOf('22:00'), 22 * 60);
  assert.equal(q.minutesOf('07:30'), 7 * 60 + 30);
  for (const bad of ['24:00', '7:30', '22:60', '', null, 22, '22:00:00']) assert.equal(q.minutesOf(bad), null, String(bad));
});

test('the schedule from settings.json falls back to the defaults when it is malformed', () => {
  assert.deepEqual(q.normalizeQuiet(undefined), { enabled: false, from: '22:00', to: '07:00' });
  assert.deepEqual(q.normalizeQuiet({ enabled: true, from: '23:30', to: '06:15' }), { enabled: true, from: '23:30', to: '06:15' });
  assert.deepEqual(q.normalizeQuiet({ enabled: 'yes', from: 'late', to: '06:15' }), { enabled: false, from: '22:00', to: '06:15' });
  // Two equal times is no window at all.
  assert.equal(q.normalizeQuiet({ enabled: true, from: '09:00', to: '09:00' }).enabled, false);
});

test('what Settings or the phone sends is checked, a field at a time', () => {
  const current = { enabled: false, from: '22:00', to: '07:00' };
  assert.deepEqual(q.checkQuiet({ enabled: true }, current), { quiet: { enabled: true, from: '22:00', to: '07:00' } });
  assert.deepEqual(q.checkQuiet({ from: '21:15' }, current), { quiet: { enabled: false, from: '21:15', to: '07:00' } });
  assert.match(q.checkQuiet({ from: '9pm' }, current).error, /hours and minutes/);
  assert.match(q.checkQuiet({ to: '22:00' }, current).error, /different/);
  assert.match(q.checkQuiet({ from: '22:00:00' }, current).error, /hours and minutes/);
  assert.equal(q.checkQuiet('nope', current).quiet.enabled, false);
});

test('a window crossing midnight holds the evening and the early morning, and nothing in between', () => {
  const night = { enabled: true, from: '22:00', to: '07:00' };
  assert.equal(q.inQuietHours(night, at(22, 0)), true, 'the first minute');
  assert.equal(q.inQuietHours(night, at(23, 59)), true);
  assert.equal(q.inQuietHours(night, at(0, 0)), true, 'midnight');
  assert.equal(q.inQuietHours(night, at(6, 59)), true);
  assert.equal(q.inQuietHours(night, at(7, 0)), false, 'the end is not in it');
  assert.equal(q.inQuietHours(night, at(12, 0)), false);
  assert.equal(q.inQuietHours(night, at(21, 59)), false);
});

test('a window inside one day, and an off switch', () => {
  const lunch = { enabled: true, from: '12:00', to: '13:30' };
  assert.equal(q.inQuietHours(lunch, at(12, 0)), true);
  assert.equal(q.inQuietHours(lunch, at(13, 29)), true);
  assert.equal(q.inQuietHours(lunch, at(13, 30)), false);
  assert.equal(q.inQuietHours(lunch, at(11, 59)), false);
  assert.equal(q.inQuietHours({ ...lunch, enabled: false }, at(12, 30)), false);
  assert.equal(q.inQuietHours(null, at(12, 30)), false);
});
