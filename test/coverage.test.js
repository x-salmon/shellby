const test = require('node:test');
const assert = require('node:assert/strict');
const { belowFloor, summarize } = require('../scripts/coverage');

test('summarize adds up the lines of every file in the report', () => {
  const lcov = 'SF:a.js\nLF:10\nLH:5\nend_of_record\nSF:b.js\nLF:30\nLH:30\nend_of_record\n';
  assert.deepEqual(summarize(lcov), { found: 40, hit: 35, percent: 87.5 });
});

test('summarize reads branch and function counts as neither', () => {
  assert.deepEqual(summarize('BRF:9\nBRH:9\nFNF:4\nFNH:4\n'), { found: 0, hit: 0, percent: 0 });
});

test('an empty report is 0%, not a crash', () => {
  assert.equal(summarize('').percent, 0);
  assert.equal(summarize(null).percent, 0);
});

test('the floor forgives a small wobble and nothing more', () => {
  assert.equal(belowFloor(70, 70), false);
  assert.equal(belowFloor(69.6, 70), false);
  assert.equal(belowFloor(69, 70), true);
});
