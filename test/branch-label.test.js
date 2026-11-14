// A copy's branch, as a pane's header reads it (src/renderer/shared/branch-label.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { branchLabel } = require('../src/renderer/shared/branch-label');

test("drops Shellby's prefix and id, and reads the kind apart from the words", () => {
  assert.deepEqual(branchLabel('shellby/feat-notifications-bell-47f58c'),
    { full: 'shellby/feat-notifications-bell-47f58c', kind: 'feat', colour: 'feat', words: 'notifications bell' });
});

test('colours the four main kinds and leaves the rest as other', () => {
  assert.equal(branchLabel('shellby/fix-login-redirect-a1b2c3').colour, 'fix');
  assert.equal(branchLabel('shellby/refactor-split-pane-9e01d2').colour, 'refactor');
  const docs = branchLabel('shellby/docs-readme-badges-000aaa');
  assert.equal(docs.kind, 'docs');
  assert.equal(docs.colour, 'other');
});

test('a name without a kind keeps every word', () => {
  const b = branchLabel('shellby/the-login-bug-1a2b3c');
  assert.equal(b.kind, '');
  assert.equal(b.colour, 'other');
  assert.equal(b.words, 'the login bug');
});

test("keeps an id-like end on branches Shellby didn't name", () => {
  assert.equal(branchLabel('feature/cache-47f58c').words, 'feature cache 47f58c');
  assert.equal(branchLabel('fix/login').kind, 'fix');
});

test('a kind alone is a word, not a kind', () => {
  assert.deepEqual(branchLabel('shellby/fix-123456'), { full: 'shellby/fix-123456', kind: '', colour: 'other', words: 'fix' });
});

test('takes anything without throwing', () => {
  assert.equal(branchLabel('').words, '');
  assert.equal(branchLabel(undefined).full, '');
  assert.equal(branchLabel(null).kind, '');
});
