// Copies of a repository on another computer (worktrees/index.js createThere).
// The "other computer" is a temp folder here: a fake remote service maps each
// stand-in to its folder and runs git there, so every step create, bringHome
// and remove take goes through the remote path with real git. The scripts ssh
// would carry are run with sh, when there is one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const worktrees = require('../src/main/worktrees');
const ssh = require('../src/main/remote/ssh');

const slash = p => p.replace(/\\/g, '/');

function setup() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-wtr-')));
  const there = path.join(base, 'there'); // the other computer's disk
  const here = path.join(base, 'here'); // stand-ins on this PC
  const repo = path.join(there, 'app');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(here);
  const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
  g(repo, 'init', '-q', '-b', 'main');
  g(repo, 'config', 'user.email', 't@example.com');
  g(repo, 'config', 'user.name', 'T');
  g(repo, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.txt'), 'b\n');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-qm', 'init');

  let n = 0;
  /** @type {Array<{ host: string, dir: string, anchor: string, copy?: boolean }>} */
  const places = [];
  const stand = (dir, copy) => {
    const anchor = path.join(here, `a${n++}`);
    fs.mkdirSync(anchor);
    places.push({ host: 'box', dir: slash(dir), anchor, ...(copy ? { copy: true } : {}) });
    return anchor;
  };
  const folder = stand(repo, false);
  const remote = {
    placeOf: cwd => places.find(p => path.resolve(p.anchor) === path.resolve(cwd)) || null,
    git: (place, args, { env = {} } = {}) => worktrees.git(place.dir, args, { env }),
    copyHome: async (_host, id) => { const d = path.join(there, '.shellby', 'worktrees', id); fs.mkdirSync(d, { recursive: true }); return slash(d); },
    tidyCopyHome: async (_host, id) => { try { fs.rmdirSync(path.join(there, '.shellby', 'worktrees', id)); } catch { /* not empty */ } },
    addCopy: (_host, dir) => places.find(p => p.dir === slash(dir))?.anchor || stand(dir, true),
    dropCopy: anchor => { const i = places.findIndex(p => p.anchor === anchor); if (i >= 0) places.splice(i, 1); },
  };
  worktrees.setRemote(remote);
  return { base, repo, folder, places, g, done: () => { worktrees.setRemote(null); fs.rmSync(base, { recursive: true, force: true }); } };
}

test('a folder on another computer gets its copy over there, and it comes home there', async () => {
  const s = setup();
  try {
    const made = await worktrees.create(s.folder, { home: 'unused', title: 'Fix the thing' });
    assert.equal(made.ok, true, made.error);
    const w = made.worktree;
    // Every path the tab and History keep is a stand-in here; git sees the folders there.
    const copy = worktrees.placeOf(w.path);
    assert.equal(copy.copy, true);
    assert.match(copy.dir, /\/\.shellby\/worktrees\/[0-9a-f]{6}\/app$/);
    assert.equal(w.root, s.folder);
    assert.equal(w.base, 'main');
    assert.equal(w.host, 'box');
    assert.equal(worktrees.checkWorktree(w), null);
    assert.ok(fs.existsSync(path.join(copy.dir, 'a.txt')), 'the copy is checked out there');

    // A copy is never copied again.
    assert.equal(await worktrees.create(w.cwd, { home: 'unused', title: 'again' }), null);

    fs.writeFileSync(path.join(copy.dir, 'a.txt'), 'two\n');
    const st = await worktrees.status(w);
    assert.equal(st.uncommitted, 1);
    const home = await worktrees.bringHome(w, { message: 'fix: the thing' });
    assert.equal(home.ok, true, home.error);
    assert.equal(fs.readFileSync(path.join(s.repo, 'a.txt'), 'utf8'), 'two\n');

    const gone = await worktrees.remove(w);
    assert.equal(gone.ok, true, gone.error);
    assert.equal(fs.existsSync(copy.dir), false);
    assert.equal(worktrees.placeOf(w.path), null, "the copy's stand-in goes with it");
    assert.ok(worktrees.placeOf(s.folder), 'your folder stays');
    assert.equal(s.g(s.repo, 'branch', '--list', w.branch), '');
  } finally { s.done(); }
});

test('a subfolder on another computer works in the same subfolder of its copy', async () => {
  const s = setup();
  try {
    const sub = s.places.length;
    s.places.push({ host: 'box', dir: slash(path.join(s.repo, 'src')), anchor: path.join(s.base, 'here', 'sub') });
    fs.mkdirSync(s.places[sub].anchor);
    const made = await worktrees.create(s.places[sub].anchor, { home: 'unused', title: 'sub' });
    assert.equal(made.ok, true, made.error);
    assert.match(worktrees.placeOf(made.worktree.cwd).dir, /\/app\/src$/);
    assert.match(worktrees.placeOf(made.worktree.root).dir, /\/there\/app$/);
    assert.equal((await worktrees.remove(made.worktree, { force: true })).ok, true);
  } finally { s.done(); }
});

test('branching from a snapshot is refused on another computer', async () => {
  const s = setup();
  try {
    const r = await worktrees.createAt({ repoRoot: s.folder, base: 'main', head: 'a'.repeat(40), tree: 'b'.repeat(40), home: 'x', slug: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.error, /another computer/);
  } finally { s.done(); }
});

test('the remote copy scripts refuse what could reach a command line', () => {
  assert.throws(() => ssh.copyHomeScript('../x'));
  assert.throws(() => ssh.copyTidyScript('abc12'));
  assert.throws(() => ssh.carryScript({ sessionId: 'x; rm -rf ~', from: '~/a', to: '~/b' }));
  assert.throws(() => ssh.carryScript({ sessionId: 'abcdef123', from: '../a', to: '~/b' }));
  const script = ssh.gitScript('~/my app', ['log', "--format=it's $HOME"], { LC_ALL: 'C', BAD: '$(x)' });
  assert.match(script, /'--format=it'\\''s \$HOME'/);
  assert.match(script, /LC_ALL=C/);
  assert.doesNotMatch(script, /BAD=/);
  assert.match(ssh.gitScript('~', ['commit', '-m', 'a  b']), /'a {2}b'/, 'two spaces in an argument stay two');
  assert.doesNotMatch(ssh.gitScript('~', ['status'], { PATH: '/x', LD_PRELOAD: '/x.so' }), /PATH=\/x|LD_PRELOAD/);
});

test("removing a copy there refuses a record that points at the repository itself", async () => {
  const s = setup();
  try {
    const made = await worktrees.create(s.folder, { home: 'unused', title: 'x' });
    assert.equal(made.ok, true, made.error);
    const forged = { ...made.worktree, path: s.folder };
    const r = await worktrees.remove(forged, { force: true, there: worktrees.placeOf(s.folder).dir });
    assert.equal(r.ok, false);
    assert.ok(fs.existsSync(path.join(s.repo, 'a.txt')), 'the repository is untouched');
    assert.equal((await worktrees.remove(made.worktree, { force: true })).ok, true);
  } finally { s.done(); }
});

// The scripts themselves, under a real sh (Git for Windows has one; CI too).
const sh = spawnSync('sh', ['-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok';

test('gitScript, copyHomeScript and carryScript do their job under sh', { skip: !sh && 'no sh' }, () => {
  const s = setup();
  try {
    const home = slash(s.base);
    const run = script => spawnSync('sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '' } });
    const log = run(ssh.gitScript('~/there/app', ['log', '--format=%s']));
    assert.equal(log.status, 0, log.stderr);
    assert.equal(log.stdout.trim(), 'init');
    assert.equal(run(ssh.gitScript('~/nowhere', ['status'])).status, 97);

    const made = run(ssh.copyHomeScript('abc123'));
    assert.equal(made.status, 0, made.stderr);
    assert.match(made.stdout.trim(), /\.shellby\/worktrees\/abc123$/);
    const copyDir = made.stdout.trim();

    // Claude Code's folder for ~/there/app, named from its full path as pwd -P says it.
    const name = p => run(`cd ${ssh.shDir(p)} && pwd -P | sed 's/[^a-zA-Z0-9]/-/g'`).stdout.trim();
    const projects = path.join(s.base, '.claude', 'projects');
    fs.mkdirSync(path.join(projects, name('~/there/app'), 'sess-1234', 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(projects, name('~/there/app'), 'sess-1234.jsonl'), '{}\n');
    const carried = run(ssh.carryScript({ sessionId: 'sess-1234', from: '~/there/app', to: copyDir }));
    assert.equal(carried.status, 0, carried.stderr);
    assert.match(carried.stdout, /shellby-ok/);
    assert.ok(fs.existsSync(path.join(projects, name(copyDir), 'sess-1234.jsonl')));
    assert.ok(fs.existsSync(path.join(projects, name(copyDir), 'sess-1234', 'subagents')));
    assert.notEqual(run(ssh.carryScript({ sessionId: 'nope-12345', from: '~/there/app', to: copyDir })).status, 0);

    assert.equal(run(ssh.copyTidyScript('abc123')).status, 0);
    assert.equal(fs.existsSync(path.join(s.base, '.shellby', 'worktrees', 'abc123')), false);
  } finally { s.done(); }
});
