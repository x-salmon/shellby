// The nudge under a repeated big read (src/main/read-nudge.js): when it shows,
// once a week per file, "never" kept for good, and its words.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const rn = require('../src/main/read-nudge');

const PROJECT = 'C:\\work\\shop';
const now = Date.now();
const ask = (over = {}) => rn.shouldNudge({ rel: 'package-lock.json', tokens: rn.BIG_READ_TOKENS, sessions: rn.MIN_SESSIONS, store: rn.emptyStore(), project: PROJECT, now, ...over });

test('shouldNudge: a big read in enough conversations this week, once', () => {
  assert.deepEqual(ask(), { ok: true });
  assert.equal(ask({ tokens: rn.BIG_READ_TOKENS - 1 }).why, 'small');
  assert.equal(ask({ tokens: null }).why, 'small');
  assert.equal(ask({ sessions: rn.MIN_SESSIONS - 1 }).why, 'rare');
  assert.equal(ask({ rel: '' }).why, 'outside');
  assert.equal(ask({ project: null }).why, 'outside');
});

test('a file nudged this week rests; one nudged last week is fair again; never is never', () => {
  const seen = rn.markSeen(rn.emptyStore(), PROJECT, 'package-lock.json', now - 1000);
  assert.equal(ask({ store: seen }).why, 'rested');
  assert.equal(ask({ store: seen, rel: 'PACKAGE-LOCK.JSON' }).why, 'rested', 'keys are case-blind, as Windows paths are');
  assert.equal(ask({ store: seen, rel: 'dist/panel.html' }).ok, true, 'another file is its own');
  assert.equal(ask({ store: seen, project: 'C:\\work\\other' }).ok, true, 'another project is its own');
  const old = rn.markSeen(rn.emptyStore(), PROJECT, 'package-lock.json', now - rn.WEEK_MS - 1);
  assert.equal(ask({ store: old }).ok, true);
  const never = rn.markNever(seen, PROJECT, 'package-lock.json');
  assert.equal(ask({ store: never, now: now + 10 * rn.WEEK_MS }).why, 'never');
  assert.deepEqual(rn.markNever(never, PROJECT, 'package-lock.json').never, never.never, 'listed once');
});

test('markSeen drops entries past the week and keeps the newest MAX_SEEN', () => {
  let store = rn.markSeen(rn.emptyStore(), PROJECT, 'old.js', now - rn.WEEK_MS - 5);
  for (let i = 0; i < rn.MAX_SEEN + 5; i++) store = rn.markSeen(store, PROJECT, `f${i}.js`, now - 1000 + i);
  const keys = Object.keys(store.seen);
  assert.equal(keys.length, rn.MAX_SEEN);
  assert.ok(!keys.includes(rn.keyOf(PROJECT, 'old.js')), 'the week-old one went');
  assert.ok(keys.includes(rn.keyOf(PROJECT, `f${rn.MAX_SEEN + 4}.js`)), 'the newest stays');
  assert.ok(!keys.includes(rn.keyOf(PROJECT, 'f0.js')), 'the oldest of the fresh ones went first');
});

test('cleanStore shapes whatever config holds', () => {
  assert.deepEqual(rn.cleanStore(null), { seen: {}, never: [] });
  assert.deepEqual(rn.cleanStore({ seen: { a: 1, b: 'x' }, never: ['k', 3, ''] }), { seen: { a: 1 }, never: ['k'] });
  assert.deepEqual(rn.cleanStore([]), { seen: {}, never: [] });
});

test('words: the mark counts the conversations, the fix is explained by kind, and generated files are known', () => {
  const compact = n => `${Math.round(n / 1000)}k`;
  const deny = rn.words({ rel: 'package-lock.json', sessions: 4, tokens: 38200, fix: { kind: 'deny-read' }, compact });
  assert.equal(deny.mark, "That's the 4th conversation this week in which Claude read package-lock.json: about 38k tokens each time, and it has never changed it.");
  assert.equal(`${deny.lead}${deny.nth}${deny.mid}package-lock.json${deny.tail}`, deny.mark, 'the parts make the whole');
  assert.equal(deny.nth, '4th conversation this week');
  assert.match(deny.what, /^A deny rule keeps it out of every conversation in this project/);
  assert.match(deny.what, /ask the package manager/);
  assert.equal(deny.generated, true);
  assert.equal(deny.saves, 'Saves about 38k a conversation.');
  assert.match(deny.undo, /adds a rule/);
  const line = rn.words({ rel: 'src/app.js', sessions: 3, tokens: 12000, edits: 2, fix: { kind: 'claude-line' }, compact });
  assert.equal(line.mark, "That's the 3rd conversation this week in which Claude read src/app.js: about 12k tokens each time.");
  assert.match(line.what, /^A line in CLAUDE\.md says what the file holds/);
  assert.equal(line.generated, false);
  assert.match(line.undo, /writes a line/);
  assert.match(rn.words({ rel: 'a.js', sessions: 11, fix: null }).mark, /11th conversation/);
  assert.match(rn.words({ rel: 'a.js', sessions: 22, fix: null }).mark, /22nd conversation/);
});
