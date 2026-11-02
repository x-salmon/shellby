const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { STAGES, percentOf, withPercent, dueAt, nextPercent, parsePercent, replaceSafely } = require('../scripts/rollout');

const LATEST = [
  'version: 1.2.3',
  'files:',
  '  - url: Shellby-Setup-1.2.3.exe',
  '    sha512: abc',
  '    size: 100',
  'path: Shellby-Setup-1.2.3.exe',
  'sha512: abc',
  "releaseDate: '2026-11-02T00:00:00.000Z'",
  '',
].join('\n');

test('a latest.yml with no field means everyone', () => {
  assert.equal(percentOf(LATEST), null);
});

test('a percent is written once and read back, whatever was there', () => {
  const ten = withPercent(LATEST, 10);
  assert.equal(percentOf(ten), 10);
  const fifty = withPercent(ten, 50);
  assert.equal(percentOf(fifty), 50);
  assert.equal(fifty.match(/stagingPercentage/g).length, 1);
});

test('the rest of latest.yml is left exactly as it was', () => {
  assert.equal(withPercent(withPercent(LATEST, 10), 100), LATEST);
});

test('0 is a real percent, not a missing one', () => {
  assert.equal(percentOf(withPercent(LATEST, 0)), 0);
});

test('a percent out of range or a file that is no latest.yml is refused', () => {
  assert.throws(() => withPercent(LATEST, 101), /0 to 100/);
  assert.throws(() => withPercent(LATEST, -1), /0 to 100/);
  assert.throws(() => withPercent(LATEST, Number('ten')), /0 to 100/);
  assert.throws(() => withPercent('', 10), /no version/);
});

test('a new release starts at the first stage and ends with everyone', () => {
  assert.equal(dueAt(0), STAGES[0].percent);
  assert.equal(STAGES.at(-1).percent, 100);
  assert.deepEqual(STAGES.map(s => s.percent), [...STAGES.map(s => s.percent)].sort((a, b) => a - b));
});

test('a rollout climbs only when the next stage is due', () => {
  const [first, second, third] = STAGES;
  assert.equal(nextPercent(first.percent, second.after - 1), null);
  assert.equal(nextPercent(first.percent, second.after), second.percent);
  assert.equal(nextPercent(second.percent, third.after), third.percent);
});

test('a slow runner jumps straight to the stage that is due', () => {
  assert.equal(nextPercent(STAGES[0].percent, STAGES.at(-1).after + 1), 100);
});

test('a halted rollout stays halted however old it gets', () => {
  assert.equal(nextPercent(0, 1000), null);
});

test('a finished rollout is left alone', () => {
  assert.equal(nextPercent(null, 1000), null);
});

test('a percent set by hand above the schedule is never lowered', () => {
  assert.equal(nextPercent(75, 0), null);
  assert.equal(nextPercent(75, STAGES[1].after), null);
});

test('a percent as typed must be digits: a stray space never halts a release', () => {
  assert.equal(parsePercent('0'), 0);
  assert.equal(parsePercent('100'), 100);
  for (const bad of [' ', '', '1e1', '0x10', '-1', 'ten', '50%']) assert.throws(() => parsePercent(bad), /0 to 100/);
});

function fakeRelease(failures) {
  let stored = 'old';
  let left = failures;
  return {
    get: () => stored,
    put: text => {
      stored = null; // --clobber: the old file is gone before the new one lands
      if (left-- > 0) throw new Error('network dropped');
      stored = text;
    },
  };
}

test('a replaced latest.yml lands first time', () => {
  const io = fakeRelease(0);
  replaceSafely(io, 'new', 'old');
  assert.equal(io.get(), 'new');
});

test('a dropped upload is tried again', () => {
  const io = fakeRelease(2);
  replaceSafely(io, 'new', 'old', 3);
  assert.equal(io.get(), 'new');
});

test('when every try fails, the old latest.yml goes back and the run fails', () => {
  const io = fakeRelease(3);
  assert.throws(() => replaceSafely(io, 'new', 'old', 3), /put back as it was.*network dropped/);
  assert.equal(io.get(), 'old');
});

test('an upload that says it worked but left something else is not believed', () => {
  let stored = 'old';
  const io = { get: () => (stored === 'new' ? 'mangled' : stored), put: t => { stored = t; } };
  assert.throws(() => replaceSafely(io, 'new', 'old', 2), /isn't what was uploaded/);
  assert.equal(stored, 'old');
});

test('the release starts the rollout before the draft is checked and published', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');
  const rollout = yml.indexOf('rollout.js start dist/latest.yml');
  assert.ok(rollout > 0, 'release.yml starts the rollout');
  assert.ok(rollout > yml.indexOf('Upload the signed files'), 'after SignPath rewrites latest.yml');
  assert.ok(rollout < yml.indexOf('release-guard.js verify'), 'before the guard reads the draft');
});
