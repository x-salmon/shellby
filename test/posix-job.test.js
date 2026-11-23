const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const { parsePs, grow, treeOf, isYours, createJobs, listSync } = require('../src/main/posix-job');
const { killTree } = require('../src/main/proc-tree');
const { shellPlan, typedPlan, userShell } = require('../src/main/shells');
const { candidatePaths } = require('../src/main/claude/cli');
const { installCommand, INSTALLER_SH_URL } = require('../src/main/claude/install');
const { commandLine } = require('../src/main/devservers/runner');

const SELF = 50;
const T = 'Sun Nov 22 10:00:00 2026';
const LATER = 'Sun Nov 22 11:00:00 2026';
const row = (pid, ppid, pgid = pid, started = T, comm = '/usr/bin/node') => [pid, { pid, ppid, pgid, started, comm }];
const rows = (...list) => new Map(list);
const pids = m => [...m.keys()].sort((a, b) => a - b);

test('parsePs reads ids, the start time and a program path with spaces', () => {
  const m = parsePs('  100    50   100 Sun Nov  2 10:00:00 2026     /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\nnonsense\n');
  assert.deepEqual(m.get(100), { pid: 100, ppid: 50, pgid: 100, started: 'Sun Nov 2 10:00:00 2026', comm: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  assert.equal(m.size, 1);
  assert.equal(parsePs(undefined).size, 0);
});

test('a job is its root and everything under it, never Shellby or what is beside it', () => {
  const all = rows(row(SELF, 1), row(100, SELF), row(101, 100), row(102, 101), row(200, SELF, SELF));
  assert.deepEqual(pids(grow(new Map(), 100, all, SELF)), [100, 101, 102]);
});

test('a process whose parent has exited is still known', () => {
  const seen = grow(new Map(), 100, rows(row(SELF, 1), row(100, SELF), row(101, 100), row(102, 101)), SELF);
  assert.deepEqual(pids(grow(seen, 100, rows(row(SELF, 1), row(102, 1)), SELF)), [102]);
});

test('what started since the last look is found by its group, its parent gone or not', () => {
  const seen = new Map([[100, T]]);
  assert.deepEqual(pids(grow(seen, 100, rows(row(SELF, 1), row(103, 1, 100)), SELF)), [103]);
});

test('a reused pid is never taken for the process that had it', () => {
  const seen = new Map([[100, T], [101, T]]);
  const now = rows(row(SELF, 1), row(101, 1, 101, LATER), row(102, 101, 101, LATER));
  assert.deepEqual(pids(grow(seen, 100, now, SELF)), []);
});

test('Shellby is never swept, even sharing a group with a child', () => {
  const all = rows(row(SELF, 1), row(100, SELF, SELF), row(300, 1, SELF));
  assert.deepEqual(pids(grow(new Map(), 100, all, SELF)), [100]);
});

test('sweep ends the job, keeps your own apps, and does nothing the second time', () => {
  const killed = [];
  const all = rows(row(SELF, 1), row(100, SELF), row(101, 100, 101, T, '/Applications/Safari.app/Contents/MacOS/Safari'), row(102, 100));
  const jobs = createJobs({ list: () => all, listLater: cb => cb(all), kill: p => { killed.push(p); return true; }, self: SELF });
  const job = jobs.adopt(100);
  assert.deepEqual(jobs.namedMembers(job).map(m => m.name), ['node', 'Safari', 'node']);
  assert.deepEqual([...jobs.ownedPids()], [100, 101, 102]);
  assert.deepEqual(jobs.sweep(job), { ended: ['node', 'node'], kept: ['Safari'] });
  assert.deepEqual(killed, [100, 102]);
  assert.equal(jobs.sweep(job), null);
});

test('sweepAll leaves a dev server meant to outlive Shellby', () => {
  const killed = [];
  const all = rows(row(SELF, 1), row(100, SELF), row(200, SELF));
  const jobs = createJobs({ list: () => all, listLater: cb => cb(all), kill: p => { killed.push(p); return true; }, self: SELF });
  const server = jobs.adopt(200, { outlives: true });
  jobs.adopt(100);
  jobs.sweepAll();
  assert.deepEqual(killed, [100]);
  jobs.sweep(server);
  assert.equal(jobs.adopt(0), null);
  assert.equal(jobs.adopt(SELF), null);
});

test('treeOf survives a loop and never goes near launchd', () => {
  assert.deepEqual(treeOf(100, rows(row(100, 101), row(101, 100)), SELF), [100, 101]);
  assert.deepEqual(treeOf(1, rows(row(1, 0), row(100, 1)), SELF), []);
  assert.equal(isYours('/Applications/iTerm.app/Contents/MacOS/iTerm2'), true);
  assert.equal(isYours('/usr/local/bin/node'), false);
});

test('killTree ends the tree on macOS and asks taskkill on Windows', async () => {
  const killed = [];
  await killTree(100, { platform: 'darwin', list: () => rows(row(100, 1), row(101, 100)), kill: p => { killed.push(p); return true; } });
  assert.deepEqual(killed, [100, 101]);
  const ran = [];
  await killTree(100, { platform: 'win32', execFileImpl: (_f, args, _o, cb) => { ran.push(args); cb(); } });
  assert.deepEqual(ran, [['/PID', '100', '/T', '/F']]);
  await killTree(undefined);
});

test('shells: plain for Shellby, yours for what you typed, by full path', () => {
  assert.deepEqual(shellPlan('npm test', 'darwin'), { file: '/bin/sh', args: ['-c', 'npm test'], verbatim: false });
  assert.equal(shellPlan('npm test', 'win32').verbatim, true);
  assert.equal(userShell({ SHELL: '/bin/bash' }, () => true), '/bin/bash');
  assert.equal(userShell({ SHELL: '/opt/homebrew/bin/fish' }, () => true), '/bin/zsh');
  assert.equal(userShell({ SHELL: './zsh' }, () => false), '/bin/sh');
  assert.deepEqual(typedPlan('ls', { platform: 'darwin', env: { SHELL: '/nope' } }).args, ['-c', 'ls']);
});

test('Claude Code is looked for where a Mac has it, and only in absolute folders', () => {
  const list = candidatePaths({ HOME: '/Users/crab', PATH: '/usr/bin:relative::/opt/x' }, '/mine/claude', 'darwin');
  assert.deepEqual(list, ['/mine/claude', '/Users/crab/.local/bin/claude', '/Users/crab/.claude/local/claude', '/usr/bin/claude', '/opt/x/claude', '/opt/homebrew/bin/claude', '/usr/local/bin/claude']);
});

test('the Mac installer is fetched whole before it runs', () => {
  const c = installCommand('darwin');
  assert.equal(c.exe, '/bin/bash');
  assert.match(c.args[1], /^set -e; script="\$\(curl/);
  assert.ok(c.args[1].includes(INSTALLER_SH_URL));
});

test('a dev server on macOS writes its exit marker whatever its command does', () => {
  assert.equal(commandLine('npm run dev', '', 'darwin'), '( npm run dev\n); printf \'\\n[shellby-exit %s]\\n\' "$?"');
});

// The real thing, where there is one (CI's Mac).
test('a swept job really ends a grandchild that lost its parent', { skip: process.platform === 'win32' }, async () => {
  const jobs = createJobs();
  // sh starts a long sleep in the background, then exits: the sleep loses its parent.
  const child = spawn('/bin/sh', ['-c', 'sleep 60 & echo $!; sleep 0.5'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const job = jobs.adopt(child.pid);
  const orphan = Number(await new Promise(r => child.stdout.once('data', d => r(String(d).trim()))));
  await new Promise(r => child.once('exit', r));
  assert.ok(listSync().has(orphan), 'the orphan runs on');
  jobs.sweep(job);
  await new Promise(r => setTimeout(r, 300));
  assert.ok(!listSync().has(orphan), 'and the sweep ends it');
});

test('a dead root\'s number, now someone else\'s, is never swept, nor is that one\'s group', () => {
  const ever = new Map([[100, T], [101, T]]);
  const seen = new Map([[101, T]]);
  const now = rows(row(SELF, 1), row(101, 1, 100), row(100, 1, 100, LATER, '/Applications/Other.app/x'), row(300, 100, 100, LATER));
  assert.deepEqual(pids(grow(seen, 100, now, SELF, ever)), [101]);
  // And the same at the first look after it died: never re-adopted.
  assert.deepEqual(pids(grow(new Map(), 100, rows(row(SELF, 1), row(100, 1, 100, LATER)), SELF, ever)), []);
});
