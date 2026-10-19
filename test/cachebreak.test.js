const { test } = require('node:test');
const assert = require('node:assert/strict');
const cb = require('../src/main/cachebreak');

const NOW = new Date(2026, 9, 18, 15, 0).getTime();
const MIN = 60 * 1000;
const warm = { at: NOW - 10 * MIN, ttlMs: 60 * MIN };
const call = (read, write, input = 3) => ({ main: true, input, write, read });

test('a warm cache that read back little of a big conversation is a break', () => {
  assert.deepEqual(cb.cacheBreak({ call: call(4000, 140000), cache: warm, before: 140000, now: NOW }), { tokens: 140003, cause: 'other' });
});

test('says what came before: a model change first, then a process started again', () => {
  const base = { call: call(4000, 140000), cache: warm, before: 140000, now: NOW };
  assert.equal(cb.cacheBreak({ ...base, resumed: true }).cause, 'resume');
  assert.equal(cb.cacheBreak({ ...base, resumed: true, modelChanged: true }).cause, 'model');
});

test('a cold cache, a small conversation, a good read or a helper is no break', () => {
  assert.equal(cb.cacheBreak({ call: call(4000, 140000), cache: { at: NOW - 61 * MIN, ttlMs: 60 * MIN }, before: 140000, now: NOW }), null, 'cold: expected');
  assert.equal(cb.cacheBreak({ call: call(100, 15000), cache: warm, before: 15000, now: NOW }), null, 'too small to mention');
  assert.equal(cb.cacheBreak({ call: call(138000, 2500), cache: warm, before: 140000, now: NOW }), null, 'the cache held');
  assert.equal(cb.cacheBreak({ call: { ...call(0, 140000), main: false }, cache: warm, before: 140000, now: NOW }), null, "a helper's own cache");
  assert.equal(cb.cacheBreak({ call: call(0, 140000), cache: null, before: 140000, now: NOW }), null, 'nothing cached yet');
  assert.equal(cb.cacheBreak({ call: call(0, 140000), cache: warm, before: 0, now: NOW }), null, 'after a compaction or rewind');
});

test('the ledger adds breaks to their day by cause, and the week sums them', () => {
  let days = cb.recordBreak({}, { tokens: 100000, cause: 'resume' }, NOW);
  days = cb.recordBreak(days, { tokens: 50000, cause: 'resume' }, NOW);
  days = cb.recordBreak(days, { tokens: 30000, cause: 'nonsense' }, NOW - 2 * 24 * 60 * MIN);
  days = cb.recordBreak(days, { tokens: 99000, cause: 'model' }, NOW - 9 * 24 * 60 * MIN);
  assert.deepEqual(cb.breakSummary(days, NOW), { count: 3, tokens: 180000, resume: 2, model: 0, other: 1 }, 'last week left out, an unknown cause is other');
  assert.equal(cb.breakSummary({}, NOW), null);
  assert.equal(cb.recordBreak(days, null, NOW), days);
});

test('whatever was saved is cleaned on the way in', () => {
  assert.deepEqual(cb.normalizeBreaks({ '2026-10-18': { count: 2, tokens: 5.6, resume: -1, model: 'x' }, nope: { count: 1 }, '2026-10-17': { count: 0 } }),
    { '2026-10-18': { count: 2, tokens: 6, resume: 0, model: 0, other: 0 } });
  assert.deepEqual(cb.normalizeBreaks(null), {});
});

test("each cause has its own sentence, and the size reads in thousands", () => {
  assert.match(cb.breakText({ tokens: 140000, cause: 'resume' }), /~140k tokens at full price.*process had started again/);
  assert.match(cb.breakText({ tokens: 140000, cause: 'model' }), /different model.*fallback/);
  assert.match(cb.breakText({ tokens: 140000, cause: 'other' }), /can't see why/);
});

test('a short message into a big conversation gone cold would send it all again', () => {
  const cold = { at: NOW - 70 * MIN, ttlMs: 60 * MIN };
  assert.deepEqual(cb.coldResend({ cache: cold, tokens: 140000, text: 'and the other file?', now: NOW }), { tokens: 140000, coldSince: NOW - 10 * MIN });
  assert.equal(cb.coldResend({ cache: warm, tokens: 140000, text: 'and the other file?', now: NOW }), null, 'still warm');
  assert.equal(cb.coldResend({ cache: cold, tokens: 30000, text: 'and the other file?', now: NOW }), null, 'cheap to send again');
  assert.equal(cb.coldResend({ cache: cold, tokens: 140000, text: 'x'.repeat(300), now: NOW }), null, 'a real new task, not a quick follow-up');
  assert.equal(cb.coldResend({ cache: null, tokens: 140000, text: 'hi', now: NOW }), null);
});

test('modelSwitch: a /model switch into a big conversation with a warm cache', () => {
  const now = 1_000_000;
  const cache = { at: now - 1000, ttlMs: 300000 };
  assert.deepStrictEqual(cb.modelSwitch({ cache, tokens: 80000, text: '/model sonnet', now }), { tokens: 80000 });
  assert.strictEqual(cb.modelSwitch({ cache, tokens: 80000, text: 'use the model', now }), null);
  assert.strictEqual(cb.modelSwitch({ cache, tokens: 1000, text: '/model sonnet', now }), null);
  assert.strictEqual(cb.modelSwitch({ cache: { at: now - 400000, ttlMs: 300000 }, tokens: 80000, text: '/model sonnet', now }), null);
  assert.strictEqual(cb.modelSwitch({ cache: null, tokens: 80000, text: '/model opus', now }), null);
});
