// What would clash bringing a copy home (main's worktrees/conflicts.js): read from
// git merge-tree alone, against a real repo, with the checkout left as it was.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../src/main/worktrees/conflicts');
const { git } = require('../src/main/worktrees');

function repo() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-conflicts-')));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 'T');
  g('config', 'core.autocrlf', 'false');
  const write = (f, s) => fs.writeFileSync(path.join(dir, f), s);
  write('a.js', 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  write('gone.js', 'x\n');
  g('add', '-A'); g('commit', '-qm', 'init');
  g('checkout', '-qb', 'copy');
  write('a.js', 'const a = 1;\nconst b = 20;\nconst c = 3;\n');
  write('gone.js', 'x changed\n');
  g('commit', '-qam', 'copy');
  g('checkout', '-q', 'main');
  write('a.js', 'const a = 1;\nconst b = 200;\nconst c = 3;\n');
  g('rm', '-q', 'gone.js');
  g('commit', '-qam', 'main');
  return { dir, g, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('parseConflicts reads each clash with both sides, and the base when git wrote it', () => {
  const text = 'x\n<<<<<<< main\nours 1\nours 2\n||||||| base\nold\n=======\ntheirs\n>>>>>>> copy\ny\n<<<<<<< main\n=======\nt\n>>>>>>> copy\n';
  const h = C.parseConflicts(text);
  assert.equal(h.length, 2);
  assert.deepEqual(h[0], { at: 2, ours: ['ours 1', 'ours 2'], base: ['old'], theirs: ['theirs'] });
  assert.deepEqual(h[1], { at: 11, ours: [], base: null, theirs: ['t'] });
});

test('clashOf lists the clashing files and their clashes, touching nothing', async () => {
  const r = repo();
  try {
    const before = r.g('status', '--porcelain');
    const head = r.g('rev-parse', 'HEAD');
    const c = await C.clashOf(git, r.dir, 'main', 'copy');
    assert.equal(c.ok, true);
    assert.equal(c.clean, false);
    const a = c.files.find(f => f.path === 'a.js');
    assert.deepEqual(a.hunks.map(h => [h.ours, h.theirs]), [[['const b = 200;'], ['const b = 20;']]]);
    assert.deepEqual(c.files.find(f => f.path === 'gone.js').hunks, [], 'changed here, deleted there: no lines to show');
    assert.equal(r.g('status', '--porcelain'), before, 'the checkout is untouched');
    assert.equal(r.g('rev-parse', 'HEAD'), head);
    assert.equal((await C.clashOf(git, r.dir, '--output=x', 'copy')).ok, false);
  } finally { r.done(); }
});

test('a copy that merges cleanly says so', async () => {
  const r = repo();
  try {
    r.g('checkout', '-qb', 'clean', 'main');
    fs.writeFileSync(path.join(r.dir, 'new.js'), 'n\n');
    r.g('add', '-A'); r.g('commit', '-qm', 'clean');
    r.g('checkout', '-q', 'main');
    const c = await C.clashOf(git, r.dir, 'main', 'clean');
    assert.deepEqual([c.ok, c.clean], [true, true]);
  } finally { r.done(); }
});

test('resolvePrompt quotes both sides as code, for one clash or all of them', () => {
  const files = [{ path: 'a.js', hunks: [{ at: 2, ours: ['const b = 200;'], theirs: ['const b = ```20```;'] }, { at: 9, ours: ['x'], theirs: ['y'] }] }, { path: 'gone.js', hunks: [] }];
  const one = C.resolvePrompt({ base: 'main', files, only: { path: 'a.js', index: 0 } });
  assert.match(one, /^Merge main into this branch \(git merge main\)/);
  assert.match(one, /a\.js, around line 2:\nIn main:\n```\nconst b = 200;\n```\nIn this branch:\n````\nconst b = ```20```;\n````/);
  assert.doesNotMatch(one, /around line 9/);
  assert.match(one, /then resolve the rest the same way/);
  const all = C.resolvePrompt({ base: 'main', files });
  assert.match(all, /around line 9/);
  assert.match(all, /gone\.js: changed on one side and deleted/);
  assert.match(all, /Don't merge into the base branch yourself/);
});
