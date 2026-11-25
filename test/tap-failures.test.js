// scripts/lib/tap-failures.js: a red unit-test job on CI names its failed tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tapFailures, tapAnnotations } = require('../scripts/lib/tap-failures');

const TAP = [
  'TAP version 13',
  '# Subtest: passes',
  'ok 1 - passes',
  '  ---',
  '  duration_ms: 1',
  '  ...',
  '# Subtest: breaks, badly',
  'not ok 2 - breaks, badly',
  '  ---',
  '  duration_ms: 2',
  "  location: 'C:\\x\\a.test.js:5:1'",
  '  failureType: \'testCodeFailure\'',
  "  error: 'Expected 1 to be 2: 100%'",
  '  stack: |-',
  '    at somewhere',
  '  ...',
  '    not ok 1 - a nested one',
  '      ---',
  "      error: 'nested'",
  '      ...',
].join('\n');

test('each not ok is a failure, with its location and error but not its stack', () => {
  const f = tapFailures(TAP);
  assert.deepEqual(f.map(x => x.name), ['breaks, badly', 'a nested one']);
  assert.match(f[0].detail, /^location: .*a\.test\.js:5:1'\nfailureType: 'testCodeFailure'\nerror: 'Expected 1 to be 2: 100%'$/);
  assert.equal(f[1].detail, "error: 'nested'");
});

test('annotations are one escaped line each, nothing when all passed', () => {
  const [a] = tapAnnotations(TAP);
  assert.match(a, /^::error title=breaks {2}badly::location: /);
  assert.ok(a.includes('100%25') && !a.includes('\n'));
  assert.deepEqual(tapAnnotations('TAP version 13\nok 1 - fine\n'), []);
});
