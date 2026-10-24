// Switching the branch of a conversation's own checkout, from the branch chip's
// menu (tab-git.js). New copies start from whatever branch your checkout is on
// (worktrees/index.js create), so this is how you point them back at main.
// Never with uncommitted work in the way, and never onto a branch another copy holds.
const { execFile } = require('child_process');
const leaving = require('./leaving');

const GIT_TIMEOUT_MS = 20000;
const REF = /^(?!-)(?!.*\.\.)[\w./-]{1,200}$/;

function run(cwd, args) {
  return new Promise(resolve => {
    execFile('git', ['-c', 'core.fsmonitor=false', '-C', cwd, ...args],
      { windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '').trim() }));
  });
}

/** -> { ok, current, branches: [{ name, elsewhere }] } | { ok: false, error } */
async function listBranches(cwd) {
  const cur = await run(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const refs = await run(cwd, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads']);
  if (!refs.ok) return { ok: false, error: "This folder isn't a git repository." };
  const held = new Map(leaving.parseWorktrees((await run(cwd, ['worktree', 'list', '--porcelain'])).out)
    .filter(w => w.branch).map(w => [w.branch, w.path]));
  const current = cur.ok ? cur.out.trim() : null;
  const branches = refs.out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(name => name !== current)
    .map(name => ({ name, elsewhere: held.get(name) || null }));
  return { ok: true, current, branches };
}

/** -> { ok: true, branch } | { ok: false, error, detail? } */
async function switchBranch(cwd, branch) {
  if (typeof branch !== 'string' || !REF.test(branch)) return { ok: false, error: 'There is no such branch.' };
  const status = await run(cwd, ['status', '--porcelain', '--untracked-files=no']);
  if (!status.ok) return { ok: false, error: "Couldn't read this folder's git status." };
  if (status.out.trim()) return { ok: false, error: 'There are uncommitted changes here. Commit them first, then switch.' };
  const list = await listBranches(cwd);
  const target = list.ok && list.branches.find(b => b.name === branch);
  if (!target) return { ok: false, error: 'There is no such branch.' };
  if (target.elsewhere) return { ok: false, error: `${branch} is already open in another copy (${target.elsewhere}).` };
  const r = await run(cwd, ['switch', branch]);
  return r.ok ? { ok: true, branch } : { ok: false, error: `Couldn't switch to ${branch}.`, detail: r.err };
}

module.exports = { listBranches, switchBranch };
