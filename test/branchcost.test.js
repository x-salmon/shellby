// What each branch cost (usage/ledger.js byBranch), and the branch a folder is on (gitinfo.js headBranch).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ledger = require('../src/main/usage/ledger');
const { headBranch } = require('../src/main/gitinfo');

const NOW = Date.UTC(2026, 9, 19, 12);
const row = (branch, weight, extra = {}) => ledger.normalizeRow({ at: NOW - 1000, pk: 'c:\\proj', weight, branch, pctRise: null, ...extra });

test('byBranch: the project\'s branches this week, costliest first, with their share', () => {
  const rows = [row('main', 100), row('feat/a', 300, { pctRise: 2 }), row('feat/a', 100, { pctRise: 1 }), row(null, 500),
    row('feat/old', 900, { at: NOW - 8 * 24 * 3600 * 1000 }), ledger.normalizeRow({ at: NOW, pk: 'c:\\other', weight: 999, branch: 'main' })];
  const got = ledger.byBranch(rows, { pk: 'C:\\proj', now: NOW });
  assert.deepEqual(got.map(b => [b.branch, b.weight, b.turns, b.pctRise]), [['feat/a', 400, 2, 3], ['main', 100, 1, null]]);
  assert.equal(got[0].share, 400 / 1000);
  assert.deepEqual(ledger.byBranch(rows, { pk: '', now: NOW }), []);
});

test('normalizeRow keeps a branch, and none when there was none', () => {
  assert.equal(row('feat/x', 1).branch, 'feat/x');
  assert.equal(row(undefined, 1).branch, null);
});

test('headBranch: from .git/HEAD, a worktree\'s .git file, or null', () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-head-')));
  try {
    fs.mkdirSync(path.join(dir, 'repo', '.git'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'repo', 'src'));
    fs.writeFileSync(path.join(dir, 'repo', '.git', 'HEAD'), 'ref: refs/heads/feat/thing\n');
    assert.equal(headBranch(path.join(dir, 'repo', 'src')), 'feat/thing');
    fs.mkdirSync(path.join(dir, 'gitdirs', 'wt'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'gitdirs', 'wt', 'HEAD'), 'ref: refs/heads/copy\n');
    fs.mkdirSync(path.join(dir, 'wt'));
    fs.writeFileSync(path.join(dir, 'wt', '.git'), `gitdir: ${path.join(dir, 'gitdirs', 'wt')}\n`);
    assert.equal(headBranch(path.join(dir, 'wt')), 'copy');
    fs.writeFileSync(path.join(dir, 'repo', '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    assert.equal(headBranch(path.join(dir, 'repo')), null, 'detached');
    assert.equal(headBranch('relative/path'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
