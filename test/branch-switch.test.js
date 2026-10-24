const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { listBranches, switchBranch } = require('../src/main/branch-switch');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

function repo() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-switch-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init');
  git(dir, 'branch', 'feat/x');
  return dir;
}

test('lists the other branches and switches to one', async () => {
  const dir = repo();
  git(dir, 'switch', '-q', 'feat/x');
  const list = await listBranches(dir);
  assert.strictEqual(list.current, 'feat/x');
  assert.deepStrictEqual(list.branches.map(b => b.name), ['main']);
  const r = await switchBranch(dir, 'main');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(git(dir, 'branch', '--show-current'), 'main');
});

test('refuses with uncommitted changes, and leaves the branch alone', async () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  const r = await switchBranch(dir, 'feat/x');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /uncommitted/);
  assert.strictEqual(git(dir, 'branch', '--show-current'), 'main');
});

test('refuses a branch another worktree holds, and an unknown or option-like name', async () => {
  const dir = repo();
  const wt = path.join(dir, '..', `${path.basename(dir)}-wt`);
  git(dir, 'worktree', 'add', '-q', wt, 'feat/x');
  const list = await listBranches(dir);
  assert.ok(list.branches.find(b => b.name === 'feat/x').elsewhere);
  assert.match((await switchBranch(dir, 'feat/x')).error, /another copy/);
  assert.strictEqual((await switchBranch(dir, 'nope')).ok, false);
  assert.strictEqual((await switchBranch(dir, '--orphan')).ok, false);
});
