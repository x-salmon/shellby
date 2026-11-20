// The file viewer's header menu: the repo's worktrees and the branches still in flight, and switching a
// handle to one (viewer.js createViewer).
const crypto = require('crypto');
const path = require('path');
const changes = require('./changes');
const { parseWorktrees, okDir } = require('./leaving');
const { HEADS, HEAD_REF, MAX_PLACE_TREES, MAX_PLACE_BRANCHES, PLACES_MS, AT_ONCE, git, longPath, isUnder, sameDir, tooWide, countStatus, checkoutBranch, limiter, commonDirOf } = require('./viewer-git');

/**
 * @param {{ handles: Map<string, any>, home: string, liveRoot: (h: any) => Promise<string | null>,
 *   open: (opts: any) => Promise<any>, openBranch: (opts: any) => Promise<any> }} deps
 */
function createPlaces({ handles, home, liveRoot, open, openBranch }) {
  // ---- the header's menu (panel/viewer.js): the repo's worktrees, and its branches still in flight.
  // Built once per repo (its git common dir) and reused for 10 s by every handle on it, however many
  // ask at once. Each handle then keeps its own copy under random keys; a pick names a key, never a
  // path or a ref.
  const lists = new Map();       // git common dir -> { at: when built (null while building), p: Promise<built | null> }
  const slot = limiter(AT_ONCE); // the menu's git status, rev-list and rev-parse runs, across every handle and build

  // The repo's rows, without keys or a current mark (those are each handle's own). -> { base, rows } | null
  async function buildPlaces(root, common) {
    const out = await git(root, ['worktree', 'list', '--porcelain']);
    if (out === null) return null;
    // Local folders only, never the home folder or above (open() would refuse them anyway), and only
    // folders of this repo: a record in .git/worktrees can name any folder, and git status there would
    // run that repo's own filters.
    const all = parseWorktrees(out).filter(w => okDir(w.path));
    const listed = all.filter(w => !tooWide(w.path, home)).slice(0, MAX_PLACE_TREES);
    const ours = await Promise.all(listed.map(w => slot(() => commonDirOf(w.path))));
    const trees = listed.filter((_w, i) => ours[i] === common);
    // Another worktree inside this one (an agent's, under .claude/worktrees) is a place of its own, not
    // an untracked folder of this one, whether or not the repo ignores it.
    const folders = /** @type {string[]} */ (all.map(w => longPath(w.path)).filter(Boolean));
    const inside = dir => {
      const at = longPath(dir);
      return at ? folders.filter(f => isUnder(at, f)).map(f => path.relative(at, f).split(path.sep).join('/')) : [];
    };
    // A count that timed out (8 s) is left off rather than guessed.
    const changed = await Promise.all(trees.map(w => slot(async () => {
      const st = await git(w.path, ['status', '--porcelain', '-z', '--untracked-files=all']);
      return st === null ? null : countStatus(st, inside(w.path));
    })));
    /** @type {{ kind: string, label: string, branch: string, path?: string, changed?: number, ahead?: number, when?: number, ref?: string }[]} */
    const rows = trees.map((w, i) => ({
      kind: 'worktree', label: path.basename(w.path), branch: w.branch || 'detached',
      ...(changed[i] === null ? {} : { changed: changed[i] }), path: w.path,
    }));
    // Branches with commits the main checkout's branch lacks. One out in a listed worktree shows
    // there instead. Full refs/heads/ names throughout, so none reaches git as an option.
    const base = checkoutBranch(out);
    if (base) {
      const taken = new Set(trees.filter(w => w.branch).map(w => `${HEADS}${w.branch}`));
      const refs = await git(root, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%00%(committerdate:unix)', 'refs/heads']);
      const newest = String(refs || '').split('\n').map(l => l.replace(/\r$/, '').split('\0'))
        .filter(([ref]) => HEAD_REF.test(ref || '') && !taken.has(ref)).slice(0, MAX_PLACE_BRANCHES);
      const ahead = await Promise.all(newest.map(([ref]) => slot(async () =>
        Number((await git(root, ['rev-list', '--count', `${HEADS}${base}..${ref}`]))?.trim()) || 0)));
      newest.forEach(([ref, at], i) => {
        if (ahead[i] <= 0) return;
        const name = ref.slice(HEADS.length);
        rows.push({ kind: 'branch', label: name, branch: name, ahead: ahead[i], when: Number(at) * 1000 || 0, ref });
      });
    }
    return { base, rows };
  }

  // The repo's rows, shared: one build at a time per repo, reused for 10 s from when it finished.
  // A failed build isn't kept, so the next ask tries again. -> Promise<{ at, base, rows } | null>
  function listFor(root, common) {
    const now = Date.now();
    for (const [k, e] of lists) if (e.at !== null && now - e.at >= PLACES_MS) lists.delete(k);
    const had = lists.get(common);
    if (had) return had.p;
    /** @type {{ at: number | null, p: Promise<any> | null }} */
    const e = { at: null, p: null };
    e.p = buildPlaces(root, common).catch(() => null).then(built => {
      if (!built) { if (lists.get(common) === e) lists.delete(common); return null; }
      e.at = Date.now();
      return { ...built, at: e.at };
    });
    lists.set(common, e);
    return e.p;
  }

  /** The menu's list for a handle's repo, under this handle's own keys; built when asked, reused for 10 s. */
  async function placesOf(id) {
    const h = handles.get(id);
    if (!h) return { ok: false, expired: true };
    if (!h.git) return { ok: false, error: "Couldn't list worktrees." };
    if (!h.places || Date.now() - h.places.at >= PLACES_MS) {
      // Two asks at once on one handle wait for the same list, so neither's keys go stale under the other.
      h.placing ||= (async () => {
        // A handle whose folder went (a worktree removed) lists from a live one of the same repo, so
        // its gone screen can still switch away.
        const from = await liveRoot(h);
        const common = from ? await commonDirOf(from) : null;
        const built = common ? await listFor(from, common) : null;
        if (!built) return false;
        const current = r => (r.kind === 'worktree' ? h.kind === 'folder' && sameDir(r.path, h.root) : h.kind === 'branch' && h.ref === r.ref);
        h.places = {
          at: built.at, base: built.base, common,
          list: built.rows.map(r => ({ key: crypto.randomBytes(8).toString('hex'), ...r, current: current(r) })),
        };
        return true;
      })().finally(() => { h.placing = null; });
      if (!(await h.placing)) return { ok: false, error: "Couldn't list worktrees." };
    }
    return { ok: true, places: h.places.list.map(({ path: _path, ref: _ref, ...shown }) => shown) };
  }

  const GONE = { ok: false, gone: true, error: 'That worktree or branch is gone.' };

  // A pick that went stale: the list it came from is dropped, here and for the repo, so the menu's
  // next open builds it again rather than offering the same dead entry for the rest of the 10 s.
  function stale(h) {
    if (h.places) lists.delete(h.places.common);
    h.places = null;
    return { ...GONE };
  }

  /**
   * A pick from that handle's own list, checked again before it opens: a worktree must still be
   * listed, local, not too wide and of the same repo; a branch must still resolve. -> open()'s or
   * openBranch()'s answer, or GONE for one that went stale since the list was made.
   */
  async function switchTo(id, key) {
    const h = handles.get(id);
    if (!h) return { ok: false, expired: true };
    const e = typeof key === 'string' ? h.places?.list.find(x => x.key === key) : null;
    if (!e) return { ok: false, error: "That isn't on this list. Open the menu again." };
    const from = await liveRoot(h); // as placesOf listed from
    if (!from) return stale(h);
    if (e.kind === 'worktree') {
      if (!okDir(e.path) || tooWide(e.path, home)) return stale(h);
      const listed = parseWorktrees(await git(from, ['worktree', 'list', '--porcelain']));
      if (!listed.some(w => okDir(w.path) && sameDir(w.path, e.path))) return stale(h);
      if (!(await changes.sameRepo(from, e.path))) return stale(h);
      const r = await open({ dir: e.path, origin: h.origin });
      return r.ok || !r.gone ? r : stale(h);
    }
    const r = await openBranch({ root: from, ref: e.ref, base: h.places.base, origin: h.origin });
    return r.ok || !r.gone ? r : stale(h);
  }

  return { placesOf, switchTo };
}

module.exports = { createPlaces };
