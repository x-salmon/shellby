// Sending your checkout to GitHub (worktrees/index.js pushBase).
//
// Bringing a copy home only ever touches your checkout. Pushing is the
// separate, deliberate step that publishes it: fetch, merge in whatever the
// remote has that you don't (a merge, never a rebase, so the "Bring home"
// merges stay as they were), then a plain push. Never a force push, and a
// clash is backed out exactly like bringHome's.
const path = require('path');
const { git, firstLine, lastLines, REF } = require('./git');

/**
 * @typedef {{ ok: boolean, error?: string, branch?: string, remote?: string | null, dest?: string, upstream?: string,
 *   tracked?: boolean, ahead?: number, behind?: number, fetched?: boolean }} RemoteStatus
 * @typedef {{ ok: boolean, error?: string, branch?: string, remote?: string | null, upstream?: string, conflict?: boolean,
 *   detail?: string, pushed?: number, pulled?: number, others?: { count: number, subjects: string[] } }} PushResult
 */

/** Where a branch pushes to: its upstream, or origin (or the only remote) under the same name. -> { remote, dest, upstream, tracked } | null */
async function upstreamOf(root, branch) {
  const [remote, merge] = await Promise.all([
    git(root, ['config', '--get', `branch.${branch}.remote`], { timeout: 5000 }),
    git(root, ['config', '--get', `branch.${branch}.merge`], { timeout: 5000 }),
  ]);
  const r = remote.ok ? remote.out.trim() : '';
  const m = merge.ok ? merge.out.trim().replace(/^refs\/heads\//, '') : '';
  if (r && r !== '.' && m && REF.test(r) && REF.test(m)) return { remote: r, dest: m, upstream: `${r}/${m}`, tracked: true };
  const list = await git(root, ['remote'], { timeout: 5000 });
  const remotes = list.ok ? list.out.split(/\r?\n/).map(s => s.trim()).filter(s => REF.test(s)) : [];
  const pick = remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : null;
  return pick ? { remote: pick, dest: branch, upstream: `${pick}/${branch}`, tracked: false } : null;
}

/** -> { ahead, behind } of branch against upstream (behind 0 when the remote has no such branch yet). */
async function aheadBehind(root, branch, upstream) {
  const has = await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/${upstream}`], { timeout: 5000 });
  if (!has.ok) {
    const all = await git(root, ['rev-list', '--count', branch], { timeout: 15000 });
    return { ahead: all.ok ? Number(all.out.trim()) || 0 : 0, behind: 0 };
  }
  const r = await git(root, ['rev-list', '--left-right', '--count', `${branch}...refs/remotes/${upstream}`], { timeout: 15000 });
  const [ahead, behind] = r.ok ? r.out.trim().split(/\s+/).map(n => Number(n) || 0) : [0, 0];
  return { ahead, behind };
}

/**
 * How your checkout stands against its remote. fetch: ask the remote first
 * (slow, needs the network); otherwise it's as of the last fetch.
 *   -> { ok: true, branch, remote, upstream, ahead, behind, fetched } | { ok: true, branch, remote: null } | { ok: false, error }
 * @returns {Promise<RemoteStatus>}
 */
async function remoteStatus(root, { fetch = false } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) return { ok: false, error: 'That is not a repository.' };
  const on = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 5000 });
  const branch = on.ok ? on.out.trim() : '';
  if (!REF.test(branch)) return { ok: false, error: 'Your checkout is not on a branch (detached HEAD), so there is nothing to push.' };
  const up = await upstreamOf(root, branch);
  if (!up) return { ok: true, branch, remote: null };
  let fetched = false;
  if (fetch) {
    const f = await git(root, ['fetch', '--quiet', up.remote], { timeout: 90000 });
    if (!f.ok) return { ok: false, error: `Couldn't reach ${up.remote}: ${firstLine(f.error)}` };
    fetched = true;
  }
  return { ok: true, branch, ...up, ...await aheadBehind(root, branch, up.upstream), fetched };
}

const SHA = /^[0-9a-f]{40,64}$/;
const SHOWN_OTHERS = 5;

/** The commit a ref is at, or null. Taken before a copy comes home, for pushBase's before. */
async function tipOf(root, ref) {
  if (!REF.test(ref)) return null;
  const r = await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { timeout: 5000 });
  const sha = r.ok ? r.out.trim() : '';
  return SHA.test(sha) ? sha : null;
}

/** Commits reachable from before that no branch of remote has. -> { count, subjects: [up to SHOWN_OTHERS] } */
async function unpublished(root, before, remote) {
  const range = [before, '--not', `--remotes=${remote}`];
  const [n, log] = await Promise.all([
    git(root, ['rev-list', '--count', ...range], { timeout: 15000 }),
    git(root, ['log', '--no-merges', '--format=%s', '-n', String(SHOWN_OTHERS), ...range], { timeout: 15000 }),
  ]);
  return { count: n.ok ? Number(n.out.trim()) || 0 : 0, subjects: log.ok ? log.out.split(/\r?\n/).filter(Boolean) : [] };
}

/**
 * Push your checkout's branch. base: refuse unless the checkout is on it (a
 * copy brought home lands on its base, and that's what should go out).
 * before: where the branch was before a copy came home. Commits it already
 * had that the remote doesn't (copies brought home without a push, your own
 * work) aren't sent along unasked: they come back as others, unless others
 * is true.
 *   -> { ok: true, branch, remote, pushed, pulled }
 *    | { ok: false, error, conflict?, detail?, others?: { count, subjects } }
 * @param {string} root
 * @param {{ base?: string, before?: string | null, others?: boolean }} [opts]
 * @returns {Promise<PushResult>}
 */
async function pushBase(root, { base, before = null, others = false } = {}) {
  const s = await remoteStatus(root, { fetch: true });
  if (!s.ok) return s;
  if (base && s.branch !== base) return { ok: false, error: `Your checkout is on ${s.branch} now. Switch back to ${base} to push it.` };
  if (!s.remote) return { ok: false, error: `${s.branch} has nowhere to go: this repository has no remote.` };
  if (before && SHA.test(before) && !others) {
    const extra = await unpublished(root, before, s.remote);
    if (extra.count) {
      return {
        ok: false, others: extra, branch: s.branch, remote: s.remote,
        error: `Nothing went to ${s.remote}: ${s.branch} also has ${extra.count} commit${extra.count === 1 ? '' : 's'} from before that ${extra.count === 1 ? "isn't" : "aren't"} on ${s.remote} yet.`,
      };
    }
  }

  let pulled = 0;
  if (s.behind) {
    const merge = await git(root, ['merge', '--no-edit', '-m', `Merge ${s.upstream} into ${s.branch}`, `refs/remotes/${s.upstream}`], { timeout: 60000 });
    if (!merge.ok) {
      const conflict = /CONFLICT|Automatic merge failed/i.test(merge.out + merge.error);
      if (conflict) await git(root, ['merge', '--abort'], { timeout: 15000 });
      return {
        ok: false, conflict, upstream: s.upstream,
        error: conflict
          ? `${s.upstream} has ${s.behind} commit${s.behind === 1 ? '' : 's'} that clash with yours. Nothing was merged or pushed.`
          : `Couldn't take in ${s.upstream} first: ${firstLine(merge.error) || 'git refused the merge.'}`,
      };
    }
    pulled = s.behind;
  }

  const { ahead } = pulled ? await aheadBehind(root, s.branch, s.upstream) : s;
  if (!ahead) return { ok: true, branch: s.branch, remote: s.remote, pushed: 0, pulled };
  // Long timeout: a pre-push hook may run the whole test suite.
  const push = await git(root, ['push', ...(s.tracked ? [] : ['-u']), s.remote, `refs/heads/${s.branch}:refs/heads/${s.dest}`], { timeout: 10 * 60000 });
  if (!push.ok) {
    const rejected = /\[rejected\]|non-fast-forward|fetch first/i.test(push.error);
    return {
      ok: false,
      error: rejected
        ? `${s.remote} moved on while pushing. Try again.`
        // "failed to push some refs" is git's last word for a hook's refusal
        // too; the reason is in the detail.
        : /failed to push some refs/i.test(push.error)
          ? `${s.remote} didn't take the push. Nothing went.`
          : `The push didn't go through: ${firstLine(push.error) || 'git refused it.'}`,
      // A pre-push hook's own words are what explain a refusal.
      detail: lastLines(push.error) || undefined,
      pulled,
    };
  }
  return { ok: true, branch: s.branch, remote: s.remote, pushed: ahead, pulled };
}

module.exports = { remoteStatus, pushBase, tipOf, upstreamOf, aheadBehind, unpublished, SHA, SHOWN_OTHERS };
