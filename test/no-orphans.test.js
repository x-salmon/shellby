// Nothing a conversation starts outlives it. The fake CLI leaves processes with
// no parent behind (the way uvx leaves serena's python), through the real
// SessionManager and ClaudeSession paths: closing a tab, quitting (kill), the
// CLI crashing mid-turn, and the quit-time sweep of every job still open.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { SessionManager } = require('../src/main/sessions');
const { History } = require('../src/main/history');
const { run: runCli } = require('../src/main/claude/cli');
const processJob = require('../src/main/process-job');

const skip = !processJob.available() && 'job objects need Windows and koffi';
const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const ORPHANS = 2;

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// Pids a test started and hasn't yet seen end, for the safety net in after().
// One seen ending is dropped at once: Windows hands pids out again, and by the
// end of the file a stale one can be another test file's process (they run in
// parallel), which after() would then kill.
const seenPids = new Set();
async function allEnd(pids, ms) {
  const ended = await until(() => !pids.some(alive), ms);
  for (const pid of pids) if (!alive(pid)) seenPids.delete(pid);
  return ended;
}
after(() => {
  for (const pid of seenPids) if (alive(pid)) try { process.kill(pid); } catch { /* gone */ }
  // Where the fake CLI's orphans say they've started (fixtures/fake-claude.js).
  fs.rmSync(path.join(os.tmpdir(), 'shellby-fake-orphans'), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function until(cond, ms = 10000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  return true;
}

function makeManager() {
  const history = new History(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-orphans-')));
  const mgr = new SessionManager({ getExe: () => process.execPath, argsPrefix: [FAKE], history, getMode: () => 'ask', getModel: () => '' });
  const seen = [];
  mgr.on('item', (tabId, item) => seen.push(item));
  return { mgr, seen };
}

// The node orphans in a tab's job, once they've all started. By name: the cmd.exe
// that starts each one exits at once and conhosts come and go, so two of any
// process isn't two orphans (counting those made "they outlive the turn" flaky
// under load, when the cmds were in the job before the orphans were).
async function orphansOf(session) {
  let pids = [];
  const nodes = () => processJob.namedMembers(session.job).filter(m => m.name === 'node.exe' && m.pid !== session.proc?.pid).map(m => m.pid);
  assert.ok(await until(() => (pids = nodes()).length >= ORPHANS), `the orphans start (${pids.length})`);
  for (const pid of pids) seenPids.add(pid);
  return pids;
}

async function tabWithOrphans(prompt = `orphans ${ORPHANS}`) {
  const { mgr, seen } = makeManager();
  const tab = mgr.open({ tabId: 't1', cwd: os.tmpdir() });
  mgr.send('t1', prompt, { kind: 'user', text: prompt });
  const pids = await orphansOf(tab.session);
  return { mgr, seen, tab, pids };
}

test('closing a tab ends what its conversation left running', { skip }, async () => {
  const { mgr, seen, pids } = await tabWithOrphans();
  assert.ok(await until(() => seen.some(i => i.kind === 'result')), 'the turn ends');
  assert.ok(pids.filter(alive).length >= ORPHANS, 'they outlive the turn');
  mgr.close('t1');
  assert.ok(await allEnd(pids), 'nothing is left running');
});

test('quitting (closeAll with kill) ends every tab\'s processes at once', { skip }, async () => {
  const { mgr, pids } = await tabWithOrphans();
  mgr.closeAll({ kill: true });
  assert.ok(await allEnd(pids, 3000), 'nothing is left running');
});

test('a CLI that crashes mid-turn takes what it started with it', { skip }, async () => {
  const { mgr, pids } = await tabWithOrphans(`orphans-crash ${ORPHANS}`);
  try {
    assert.ok(await allEnd(pids), 'nothing is left running');
  } finally { mgr.closeAll({ kill: true }); }
});

test('the quit-time sweep ends a one-off run nobody ended', { skip }, async () => {
  // A one-off `claude` run (claude/cli.js) still going when Shellby quits.
  const running = runCli(process.execPath, ['-e', 'setInterval(function () {}, 1000)'], 60000);
  let pids = [];
  assert.ok(await until(() => (pids = [...processJob.ownedPids()]).length > 0), 'the run is in a job');
  for (const pid of pids) seenPids.add(pid);
  const ended = processJob.sweepAll();
  assert.ok(ended.includes('node.exe'), `it is ended (${ended})`);
  assert.ok(await allEnd(pids), 'nothing is left running');
  assert.deepEqual([...processJob.ownedPids()], [], 'no job is left open');
  await running;
});

test('an install in a new copy that runs too long is ended, tree and all', { skip }, async () => {
  const { runNpm } = require('../src/main/worktrees/copy-deps');
  // A stand-in for npm: starts a child that would outlive it, then hangs.
  const script = 'require("child_process").spawn(process.execPath, ["-e", "setInterval(function () {}, 1000)"], { stdio: "ignore", windowsHide: true }); setInterval(() => {}, 1000);';
  const before = new Set(processJob.ownedPids());
  const done = runNpm({ file: process.execPath, pre: ['-e', script] }, os.tmpdir(), { ms: 1500, args: [] });
  let pids = [];
  assert.ok(await until(() => (pids = [...processJob.ownedPids()].filter(p => !before.has(p))).length >= 2), `npm and its child run in a job (${pids.length})`);
  for (const pid of pids) seenPids.add(pid);
  assert.deepEqual(await done, { ok: false, error: 'npm took too long' });
  assert.ok(await allEnd(pids), 'nothing is left running');
});
