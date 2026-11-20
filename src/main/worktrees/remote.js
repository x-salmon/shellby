// Copies of a repository on another computer (worktrees/index.js create and
// remove, for a folder whose stand-in remote/service.js knows). The copy is
// made over there by git run over ssh; it and its repository get stand-ins
// here like any remote folder, so tabs, History and every git call in
// index.js treat them as they do local ones.
const path = require('path');

/**
 * deps: from index.js, read when used (it requires this file, so not at load).
 * @param {{ git: Function, remote: () => any, placeOf: (dir: string) => any, branchName: Function,
 *   leaveFinishedBranch: Function, copyRefusal: Function, remove: Function, lastLines: Function, firstLine: Function, REF: RegExp, NO_HOOKS: string[] }} deps
 */
function createRemoteCopies(deps) {
  const { git, placeOf, branchName, leaveFinishedBranch, copyRefusal, remove, lastLines, firstLine, REF, NO_HOOKS } = deps;
  const r = () => deps.remote();

  // Where copies live on another computer (remote/ssh.js copyHomeScript).
  const COPY_THERE = /\/\.shellby\/worktrees\/[0-9a-f]{6}(\/|$)/;

  /**
   * create() for a folder on another computer: the copy is made over there, in
   * ~/.shellby/worktrees/<id>/<repo>, and it and its repository each get a
   * stand-in here. Same answers as create().
   * @param {string} dir
   * @param {{ host: string, dir: string, copy?: boolean }} place
   * @param {{ title: string, named: boolean, start: string }} opts
   * @returns {Promise<any>}
   */
  async function createThere(dir, place, { title, named, start }) {
    if (place.copy && COPY_THERE.test(place.dir)) return null; // already one of our copies
    const top = await git(dir, ['rev-parse', '--show-toplevel', '--show-prefix'], { timeout: 15000 });
    const [topLine, prefix = ''] = top.ok ? top.out.split(/\r?\n/) : [];
    if (!topLine?.trim()) return /isn't installed/.test(top.error || '') ? { ok: false, error: `Couldn't make a copy: ${top.error}` } : null;
    const rootDir = topLine.trim();
    const root = rootDir === place.dir ? dir : r().addCopy(place.host, rootDir);
    if (!root) return { ok: false, error: "Couldn't make a copy: Shellby couldn't keep track of that repository." };
    const head = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { timeout: 15000 });
    if (!head.ok) return { ok: false, error: 'That repository has no commits yet, so there is nothing to copy.' };
    const on = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 15000 });
    if (!on.ok || !on.out.trim()) return { ok: false, error: 'That checkout is not on a branch (detached HEAD), so there would be nowhere to bring it home to.' };
    const left = start === 'HEAD' ? await leaveFinishedBranch(root, on.out.trim()) : null;
    const base = left?.to || on.out.trim();
    if (start !== 'HEAD' && !REF.test(start)) return { ok: false, error: 'There is no such commit to start from.' };
    const branch = branchName(title);
    const home = await r().copyHome(place.host, branch.slice(-6));
    if (!home) return { ok: false, error: `Couldn't make a copy: Shellby couldn't make a folder for it on ${place.host}.` };
    const wtDir = path.posix.join(home, path.posix.basename(rootDir));
    // No hooks: a post-checkout hook in the repository would run unasked as the copy is made.
    const add = await git(root, [...NO_HOOKS, 'worktree', 'add', '--no-track', '-b', branch, wtDir, start], { timeout: 180000 });
    if (!add.ok) return { ok: false, error: copyRefusal(add.error), detail: lastLines(add.error) || undefined };
    const wt = r().addCopy(place.host, wtDir);
    const rel = prefix.trim().replace(/\/$/, '');
    let cwd = wt;
    if (wt && rel) {
      const sub = r().addCopy(place.host, path.posix.join(wtDir, rel));
      if (sub && (await git(sub, ['rev-parse', '--git-dir'], { timeout: 15000 })).ok) cwd = sub;
      else if (sub) r().dropCopy(sub);
    }
    const worktree = { path: wt, cwd, branch, base, root, originalCwd: dir, named: !!named, host: place.host };
    if (!wt) {
      await remove({ ...worktree, path: root }, { force: true, there: wtDir });
      return { ok: false, error: "Couldn't make a copy: Shellby couldn't keep track of it." };
    }
    return { ok: true, worktree, left: left?.to ? { from: left.from, to: left.to } : null, stuck: left?.stuck || null };
  }

  // remove() for a copy on another computer: git takes it away over there, then
  // its stand-ins here go. there: the copy's folder there, when it has no stand-in.
  async function removeThere(w, place, { force, there }) {
    const copy = placeOf(w.path);
    const dir = there || (copy?.copy ? copy.dir : null);
    // Only ever one of Shellby's own copies there: never the repository itself,
    // whatever a stale record says.
    if (dir && (!COPY_THERE.test(dir) || dir === place.dir)) return { ok: false, error: "That isn't one of Shellby's copies, so it was left alone." };
    if (dir) {
      const r = await git(w.root, ['worktree', 'remove', '--force', dir], { timeout: 120000 });
      if (!r.ok && !/is not a working tree|No such file/i.test(r.error || '')) return { ok: false, error: firstLine(r.error) || "git couldn't remove the copy." };
    }
    await git(w.root, ['worktree', 'prune'], { timeout: 30000 });
    await git(w.root, ['branch', force ? '-D' : '-d', w.branch], { timeout: 30000 });
    await r().tidyCopyHome(place.host, w.branch.slice(-6));
    for (const a of [w.cwd, w.path]) if (a && placeOf(a)?.copy && !samePlace(a, w.root)) r().dropCopy(a);
    return { ok: true };
  }
  const samePlace = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

  return { createThere, removeThere };
}

module.exports = { createRemoteCopies };
