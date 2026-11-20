// A copy of the project for each tab (opt-in).
//
// Two tabs in the same repo used to share one working folder: one tab's edits
// landed under the other's feet, and a diff for "this turn" could include the
// neighbour's work. With this on, a tab's first message in a git project gives
// it its own git worktree: a second checkout of the same repository, on its
// own branch, in Shellby's folder. The tab works there; your checkout is left
// exactly as it was.
//
// "Bring it home" commits whatever the tab left uncommitted, merges its branch
// into the branch it started from, and tidies the copy away. A conflict is
// backed out (git merge --abort) so your checkout is never left half-merged,
// and the tab can be asked to sort it out on its own branch instead.
//
// None of that leaves your machine. pushBase (push.js) is the step that does:
// it takes in what the remote has first, then pushes your checkout's branch.
//
// This file makes, brings home and removes copies. git.js runs git for them
// (and over ssh for a folder on another computer), names.js says what a copy
// and its commits are called, looks.js when a conversation moves into
// one, and remote.js makes one on another computer. All are re-exported here.
//
// execFile with fixed arguments, short timeouts, nothing thrown to the caller.
const fs = require('fs');
const path = require('path');
const { git, setRemote, remoteService, placeOf, longPath, firstLine, lastLines, NO_HOOKS, NO_GIT, REF } = require('./git');
const { branchName, suggestedName, workMessage } = require('./names');
const { startsWork, onlyLooks } = require('./looks');
const { remoteStatus, pushBase, tipOf, upstreamOf } = require('./push');
const { projectDirName, carryTranscript, copySession, findSession } = require('./claude-session');
const { createRemoteCopies } = require('./remote');

const BRANCH = /^shellby\/[a-z0-9-]{1,40}-[0-9a-f]{6}$/;

/**
 * Give a folder in a git repo its own worktree.
 *   dir:  where the tab would have worked (may be a subfolder of the repo)
 *   home: the folder worktrees live under (%APPDATA%/Shellby/worktrees)
 *   start: the commit to start from (default HEAD), e.g. origin/main for work that becomes a pull request
 *   named: `title` is a name Claude gave the work, so commits may use it (never the start of your prompt)
 * -> { ok: true, worktree: { path, cwd, branch, base, root, originalCwd, named }, left, stuck } | { ok: false, error } | null (not a repo)
 *   left: { from, to } when your checkout was switched off a finished branch; stuck: why it wasn't, when it should have been
 * @returns {Promise<{ ok: true, worktree: Worktree, left: { from: string, to: string } | null, stuck: string | null } | { ok: false, error: string, detail?: string } | null>}
 */
async function create(dir, { home, title, named = false, start = 'HEAD' }) {
  const place = placeOf(dir);
  if (place) return createThere(dir, place, { title, named, start });
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !fs.existsSync(dir)) return null;
  // Where the folder sits inside the repo, in git's own words: comparing paths
  // here would trip over 8.3 short names (C:\Users\RUNNER~1\...) that git
  // has already expanded.
  const top = await git(dir, ['rev-parse', '--show-toplevel', '--show-prefix'], { timeout: 5000 });
  // No git at all reads the same as "not a repository" unless it's told apart.
  if (!top.ok && NO_GIT.test(top.error)) return { ok: false, error: "Couldn't make a copy: git isn't installed, or isn't on PATH.", detail: top.error };
  const [topLine, prefix = ''] = top.ok ? top.out.split(/\r?\n/) : [];
  if (!topLine?.trim()) return null;
  const root = path.resolve(topLine.trim());
  // A tab that already works inside a worktree of ours gets no copy of a copy.
  if ((longPath(root) + path.sep).toLowerCase().startsWith(longPath(home).toLowerCase() + path.sep)) return null;
  const head = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { timeout: 5000 });
  if (!head.ok) return { ok: false, error: 'That repository has no commits yet, so there is nothing to copy.' };
  const on = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 5000 });
  if (!on.ok || !on.out.trim()) return { ok: false, error: 'Your checkout is not on a branch (detached HEAD), so there would be nowhere to bring it home to.' };
  // A copy starts from your checkout's branch and comes home to it: one left
  // on a branch that's already all in main would start every copy from there.
  const left = start === 'HEAD' ? await leaveFinishedBranch(root, on.out.trim()) : null;
  const base = left?.to || on.out.trim();

  if (start !== 'HEAD' && !REF.test(start)) return { ok: false, error: 'There is no such commit to start from.' };
  const branch = branchName(title);
  // <home>/<suffix>/<repo name>: the folder keeps the project's own name, so
  // streaks, XP and the status line still say "shellby", not "shellby-1a2b3c".
  const wt = path.join(home, branch.slice(-6), path.basename(root));
  // Shellby's folder of copies can be unwritable, full, or too deep for Windows:
  // said as a sentence like git's own refusals, never thrown at the caller.
  try {
    fs.mkdirSync(path.dirname(wt), { recursive: true });
  } catch (err) {
    const known = COPY_REFUSALS.find(([re]) => re.test(err.message));
    return { ok: false, error: `Couldn't make a copy: ${known ? known[1] : "Shellby's folder of copies couldn't be made"}.`, detail: err.message };
  }
  // No hooks: post-checkout runs on add, and the start may be a fork's pull request.
  const add = await git(root, [...NO_HOOKS, 'worktree', 'add', '--no-track', '-b', branch, wt, start], { timeout: 120000 });
  if (!add.ok) return { ok: false, error: copyRefusal(add.error), detail: lastLines(add.error) || undefined };
  const rel = prefix.trim().replace(/\/$/, '');
  const cwd = rel ? path.join(wt, ...rel.split('/')) : wt;
  return {
    ok: true, worktree: { path: wt, cwd: fs.existsSync(cwd) ? cwd : wt, branch, base, root, originalCwd: path.resolve(dir), named: !!named },
    left: left?.to ? { from: left.from, to: left.to } : null, stuck: left?.stuck || null,
  };
}

/** The repository's main branch, as a local branch: what origin/HEAD names, else main, else master. */
async function mainBranchOf(root) {
  const head = await git(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { timeout: 5000 });
  const named = head.ok ? head.out.trim().replace(/^origin\//, '') : '';
  const wanted = named && REF.test(named) ? [`refs/heads/${named}`] : ['refs/heads/main', 'refs/heads/master'];
  const refs = await git(root, ['for-each-ref', '--format=%(refname:short)', ...wanted], { timeout: 5000 });
  return refs.ok ? refs.out.split(/\r?\n/).map(s => s.trim()).find(Boolean) || null : null;
}

/**
 * Your checkout is on a branch that's finished: everything on it is in the
 * main branch, which has moved on since. Switch the checkout to main (the old
 * branch stays), so a new copy starts from main and comes home there.
 * Only with nothing uncommitted to carry across: otherwise it says why it stayed.
 *   -> { from, to } switched | { from, stuck: sentence } couldn't | null (nothing to do)
 * @returns {Promise<{ from: string, to?: string, stuck?: string } | null>}
 */
async function leaveFinishedBranch(root, current) {
  const main = await mainBranchOf(root);
  if (!main || main === current) return null;
  const [ahead, behind] = await Promise.all([
    git(root, ['rev-list', '--count', `${main}..${current}`], { timeout: 15000 }),
    git(root, ['rev-list', '--count', `${current}..${main}`], { timeout: 15000 }),
  ]);
  // Work of its own, or a branch made off main a moment ago: it's in use.
  if (!ahead.ok || !behind.ok || Number(ahead.out.trim()) !== 0 || !(Number(behind.out.trim()) > 0)) return null;
  const stuck = why => ({ from: current, stuck: `${current} is already in ${main}, but ${why}` });
  const dirty = await git(root, ['status', '--porcelain', '--untracked-files=no'], { timeout: 15000 });
  if (!dirty.ok) return null;
  if (dirty.out.trim()) return stuck(`your checkout has uncommitted changes, so it stays on ${current}`);
  const sw = await git(root, [...NO_HOOKS, 'switch', '--quiet', '--no-guess', main], { timeout: 30000, env: { LC_ALL: 'C' } });
  if (sw.ok) return { from: current, to: main };
  const elsewhere = /already (?:checked out|used by worktree) at '([^']+)'/i.exec(sw.error);
  if (elsewhere) return stuck(`${main} is open in another copy (${path.resolve(elsewhere[1])}), so your checkout can't switch to it`);
  return stuck(`git couldn't switch your checkout to it: ${firstLine(sw.error) || 'it refused'}`);
}

/**
 * @typedef {{ path: string, cwd: string, branch: string, base: string, root: string, originalCwd: string, named: boolean }} Worktree
 */

const OBJECT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/**
 * A copy of the repository as it was at one moment of a conversation, for a
 * branch (branch.js). Checked out at `head` (the commit that was checked out
 * then), with the files made exactly `tree` (a snapshot from changes.js:
 * uncommitted and untracked work included). What differs from `head` shows as
 * uncommitted, just as it was, so "Bring it home" works the same as for any copy.
 *   repoRoot: the repository itself (never one of our copies: git worktrees share it)
 *   base: the branch to bring it home to. prefix: the tab's folder inside the repo.
 *   named: `slug` is a name Claude gave the work (see create()).
 * -> { ok: true, worktree } | { ok: false, error, gone? }
 */
async function createAt({ repoRoot, base, head, tree, prefix = '', home, slug, named = false, originalCwd }) {
  // Snapshots are only taken of folders on this PC (wiring/sessions.js).
  if (placeOf(repoRoot)) return { ok: false, error: 'That repository is on another computer, where Shellby keeps no snapshots to branch from.' };
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot) || !fs.existsSync(repoRoot)) return { ok: false, error: 'That repository has moved.' };
  if (!OBJECT.test(tree || '') || !OBJECT.test(head || '')) return { ok: false, error: "That point in the conversation has no snapshot to start from." };
  if (typeof base !== 'string' || !REF.test(base)) return { ok: false, error: 'There is no branch to bring it home to.' };
  const rel = String(prefix || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (rel.split('/').includes('..')) return { ok: false, error: 'That folder is outside the repository.' };
  // Snapshots aren't referenced by any branch, so git tidies them away in time.
  const [hasTree, hasHead] = await Promise.all([
    git(repoRoot, ['cat-file', '-e', `${tree}^{tree}`], { timeout: 5000 }),
    git(repoRoot, ['cat-file', '-e', `${head}^{commit}`], { timeout: 5000 }),
  ]);
  if (!hasTree.ok || !hasHead.ok) return { ok: false, gone: true, error: 'git has tidied away the files from that point since.' };

  const branch = branchName(slug);
  const wt = path.join(home, branch.slice(-6), path.basename(repoRoot));
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  const add = await git(repoRoot, [...NO_HOOKS, 'worktree', 'add', '-b', branch, wt, head], { timeout: 120000 });
  if (!add.ok) return { ok: false, error: copyRefusal(add.error), detail: lastLines(add.error) || undefined };
  // The files as the snapshot has them (deletions too), then the index back
  // on `head`: the difference is uncommitted work, as it was at the time.
  const files = await git(wt, [...NO_HOOKS, 'read-tree', '-u', '--reset', tree], { timeout: 120000 });
  const index = files.ok && await git(wt, [...NO_HOOKS, 'reset', '-q'], { timeout: 60000 });
  if (!index?.ok) {
    await remove({ path: wt, root: repoRoot, branch, base }, { force: true });
    return { ok: false, error: `Couldn't put the files back as they were: ${firstLine((index || files).error)}` };
  }
  // The tab's folder inside the copy, unless a link would lead it out of it.
  const sub = rel ? path.join(wt, ...rel.split('/')) : wt;
  const real = longPath(sub);
  const cwd = fs.existsSync(sub) && (real + path.sep).toLowerCase().startsWith(longPath(wt).toLowerCase() + path.sep) ? sub : wt;
  return {
    ok: true,
    worktree: { path: wt, cwd, branch, base, root: path.resolve(repoRoot), originalCwd: path.resolve(originalCwd || repoRoot), named: !!named },
  };
}

/**
 * Where a copy should start when the snapshot didn't say which commit was
 * checked out (transcripts from before it did): where the original's own copy
 * started, or what your checkout has now. -> sha | null
 */
async function startingPoint({ repoRoot, worktree }) {
  const r = worktree && !checkWorktree(worktree)
    ? await git(repoRoot, ['merge-base', worktree.base, worktree.branch], { timeout: 10000 })
    : await git(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD'], { timeout: 5000 });
  const sha = r.ok ? r.out.trim() : '';
  return OBJECT.test(sha) ? sha : null;
}

/** The branch a checkout is on, or null (detached, or not a repo). */
async function branchOf(root) {
  const r = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 5000 });
  const b = r.ok ? r.out.trim() : '';
  return REF.test(b) ? b : null;
}

/** Checks a worktree record that came back from history or the renderer. -> error | null */
function checkWorktree(w) {
  if (!w || typeof w !== 'object') return 'That conversation has no copy of its own.';
  if (!BRANCH.test(w.branch || '')) return 'That is not one of Shellby\'s branches.';
  for (const k of ['path', 'root']) if (typeof w[k] !== 'string' || !path.isAbsolute(w[k])) return 'That copy has gone missing.';
  if (typeof w.base !== 'string' || !w.base || /^-|\.\.|[\s~^:?*[\\]/.test(w.base)) return 'That copy has no branch to go home to.';
  return null;
}

/** How far the copy has got: uncommitted files, and commits the base doesn't have. */
async function status(w) {
  const bad = checkWorktree(w);
  if (bad) return { ok: false, error: bad };
  if (!fs.existsSync(w.path)) return { ok: false, gone: true, error: 'The copy is gone (deleted outside Shellby).' };
  const [dirty, ahead] = await Promise.all([
    git(w.path, ['status', '--porcelain', '-z', '--ignored=matching'], { timeout: 15000 }),
    git(w.root, ['rev-list', '--count', `${w.base}..${w.branch}`], { timeout: 15000 }),
  ]);
  const entries = dirty.ok ? dirty.out.split('\0').filter(Boolean) : [];
  return {
    ok: true,
    uncommitted: entries.filter(e => !e.startsWith('!! ')).length,
    // Ignored files (node_modules, .env.local, build output) aren't committed,
    // so they go when the copy does.
    ignored: entries.filter(e => e.startsWith('!! ')).map(e => e.slice(3)).slice(0, 5),
    ahead: ahead.ok ? Number(ahead.out.trim()) || 0 : 0,
  };
}

/**
 * Commit what's left in the copy and merge its branch into the base in your
 * checkout. Removing the copy is a separate step (remove()), because the tab's
 * Claude process has to be gone first: Windows won't delete a folder a
 * running process is working in.
 *   message: the subject for both commits, or null to name them with workMessage()
 *   -> { ok: true, merged, commits } | { ok: false, error, conflict? }
 */
// Shellby's own commits may carry a "Shipped-with:" trailer (crab-line.js), if you turned it on.
const trailerLine = trailer => (typeof trailer === 'string' && /^[A-Za-z-]+: [^\n]{1,120}$/.test(trailer) ? `\n\n${trailer}` : '');

/**
 * Commit whatever the copy has left uncommitted (Bring it home and Ship it).
 * @param {any} w
 * @param {{ message?: string | null, trailer?: string | null }} [opts]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function commitCopy(w, { message = null, trailer = null } = {}) {
  const tail = trailerLine(trailer);
  const bad = checkWorktree(w);
  if (bad) return { ok: false, error: bad };
  if (!fs.existsSync(w.path)) return { ok: false, error: 'The copy is gone (deleted outside Shellby).' };

  const given = message ? String(message).slice(0, 400) : '';
  const names = out => out.split('\0').filter(Boolean);
  const dirty = await git(w.path, ['status', '--porcelain'], { timeout: 15000 });
  if (dirty.ok && dirty.out.trim()) {
    const add = await git(w.path, ['add', '-A']);
    const staged = add.ok && await git(w.path, ['diff', '--cached', '--name-only', '-z'], { timeout: 15000 });
    const said = given || workMessage(w, staged?.ok ? names(staged.out) : []);
    const commit = add.ok && await git(w.path, [...NO_HOOKS, 'commit', '-q', '--no-verify', '-m', `${said}${tail}`]);
    if (!commit?.ok) return { ok: false, error: `Couldn't commit the copy's changes: ${firstLine(commit?.error || add.error)}` };
  }
  return { ok: true };
}

/**
 * @param {any} w
 * @param {{ message?: string | null, trailer?: string | null }} [opts]
 */
async function bringHome(w, { message = null, trailer = null } = {}) {
  const committed = await commitCopy(w, { message, trailer });
  if (!committed.ok) return { ok: false, error: committed.error };
  // The merge is named and signed the way the commit was.
  const tail = trailerLine(trailer);
  const given = message ? String(message).slice(0, 400) : '';
  const names = out => out.split('\0').filter(Boolean);

  const ahead = await git(w.root, ['rev-list', '--count', `${w.base}..${w.branch}`], { timeout: 15000 });
  const commits = ahead.ok ? Number(ahead.out.trim()) || 0 : 0;
  if (commits) {
    const on = await git(w.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 5000 });
    if (!on.ok || on.out.trim() !== w.base) {
      // elsewhere: the branch it's on, so the panel can offer to bring it there instead (moveBase).
      const now = on.ok ? on.out.trim() : '';
      return { ok: false, elsewhere: now || undefined, error: now ? `Your checkout is on ${now} now, and this copy started from ${w.base}.` : `Your checkout is on no branch now. Switch back to ${w.base} to bring this home.` };
    }
    // Titled with what the work is, so `git log --first-parent` reads as a list
    // of changes (release drafts skip merges, so it isn't counted twice).
    // One commit lends the merge its subject; more are summed up by what they
    // changed. The branch is only named when Claude named it.
    // In English whatever git's language, so its refusals can be read below.
    let said = given;
    if (!said && commits === 1) said = (await git(w.root, ['log', '-1', '--format=%s', w.branch], { timeout: 5000 })).out?.trim();
    if (!said) said = workMessage(w, names((await git(w.root, ['diff', '--name-only', '-z', `${w.base}...${w.branch}`], { timeout: 15000 })).out || ''));
    const from = w.named ? `\n\nBrought home from ${w.branch}` : '';
    const title = `${said.split('\n')[0]}${from}${tail}`;
    const merge = await git(w.root, [...NO_HOOKS, 'merge', '--no-verify', '--no-edit', '-m', title, w.branch], { timeout: 60000, env: { LC_ALL: 'C' } });
    if (!merge.ok) {
      const conflict = /CONFLICT|Automatic merge failed/i.test(merge.out + merge.error);
      if (conflict) await git(w.root, ['merge', '--abort'], { timeout: 15000 });
      if (conflict) return { ok: false, conflict, error: `${w.base} has changed in ways that clash with this copy. Nothing was merged.` };
      // Anything else (files in your checkout in the way, a lock, a broken
      // index): git's own words go along, so Claude can be asked to find out why.
      // (A timeout has no words from git, only Node's "Command failed: git …".)
      const said = /^Command failed:/.test(merge.error) ? merge.out : merge.error || merge.out;
      return { ok: false, conflict, fixable: true, root: w.root, error: refusal(w.base, merge), detail: lastLines(said) || undefined };
    }
  }
  return { ok: true, merged: commits > 0, commits };
}

/**
 * Your checkout moved to another branch since the copy started: carry only the
 * copy's own commits (base..branch) over onto that branch, so it comes home
 * there without dragging the old base's work along. Nothing changes on a clash.
 *   -> { ok: true, worktree } (the same copy, with onto as its base) | { ok: false, error, conflict? }
 * @param {any} w
 * @param {string} onto
 */
async function moveBase(w, onto) {
  const bad = checkWorktree(w);
  if (bad) return { ok: false, error: bad };
  if (typeof onto !== 'string' || !REF.test(onto)) return { ok: false, error: 'There is no such branch.' };
  if (onto === w.base) return { ok: true, worktree: w };
  const on = await git(w.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 5000 });
  if (!on.ok || on.out.trim() !== onto) return { ok: false, error: `Your checkout isn't on ${onto} any more.` };
  const dirty = await git(w.path, ['status', '--porcelain'], { timeout: 15000 });
  if (!dirty.ok || dirty.out.trim()) return { ok: false, error: 'The copy has uncommitted changes. Bring it home once to commit them, then try again.' };
  const moved = await git(w.path, [...NO_HOOKS, 'rebase', '--no-verify', '--onto', onto, w.base, w.branch], { timeout: 120000, env: { LC_ALL: 'C' } });
  if (!moved.ok) {
    await git(w.path, ['rebase', '--abort'], { timeout: 15000 });
    const conflict = /CONFLICT|could not apply/i.test(moved.out + moved.error);
    return { ok: false, conflict, error: conflict ? `This copy's work clashes with ${onto}. Nothing was changed.` : `Couldn't move the copy onto ${onto}: ${firstLine(moved.error || moved.out)}` };
  }
  return { ok: true, worktree: { ...w, base: onto } };
}

// Why `git worktree add` said no, in a sentence (git's own words go in `detail`).
/** @type {Array<[RegExp, string]>} */
const COPY_REFUSALS = [
  [/already (checked out|used by worktree)|is already registered/i, 'that branch is already open in another copy'],
  [/filename too long|path too long|name too long/i, 'the path would be too long for Windows (turn on git\'s core.longpaths to allow it)'],
  [/permission denied|access is denied|operation not permitted/i, "Windows didn't let git write to Shellby's folder of copies"],
  [/no space left|not enough space|disk full/i, 'the disk is full'],
  [/invalid reference|not a valid object|unknown revision/i, 'there is no such commit to start from'],
  [/index\.lock|another git process/i, 'another git command is busy in this repository; try again in a moment'],
];
function copyRefusal(said) {
  const known = COPY_REFUSALS.find(([re]) => re.test(String(said || '')));
  if (known) return `Couldn't make a copy: ${known[1]}.`;
  const line = firstLine(said).replace(/^(fatal|error):\s*/i, '');
  return line ? `Couldn't make a copy: git said "${line.slice(0, 160)}".` : "git couldn't make the copy.";
}

// What git's refusal to merge means, in a sentence. The usual one: your
// checkout has uncommitted (or untracked) files the copy also changed.
function refusal(base, merge) {
  const said = `${merge.error}\n${merge.out}`;
  if (!/would be overwritten by merge/i.test(said)) return `Couldn't merge into ${base}: ${firstLine(merge.error) || "git refused."} Nothing was merged.`;
  const files = said.split('\n').filter(l => /^\t/.test(l)).map(l => l.trim()).filter(Boolean);
  const which = files.length ? ` (${files.slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''})` : '';
  const kind = /untracked working tree files/i.test(said) ? 'Untracked' : 'Uncommitted';
  return `${kind} files in your checkout are in the way${which}: this copy changes them too. Nothing was merged.`;
}

/**
 * Remove the copy and its branch. force: also when it has work that was never
 * brought home (Throw away). Without force, an unmerged branch is kept.
 */
/**
 * @param {any} w
 * @param {{ force?: boolean, there?: string | null }} [opts]
 */
async function remove(w, { force = false, there = null } = {}) {
  const bad = checkWorktree(w);
  if (bad) return { ok: false, error: bad };
  const place = placeOf(w.root);
  if (place) return removeThere(w, place, { force, there });
  // --force here only means "even with untracked files" (node_modules and the
  // like); everything worth keeping was committed by bringHome first.
  if (fs.existsSync(w.path)) {
    const r = await git(w.root, ['worktree', 'remove', '--force', w.path], { timeout: 60000 });
    if (!r.ok) return { ok: false, error: firstLine(r.error) || "git couldn't remove the copy." };
  }
  await git(w.root, ['worktree', 'prune'], { timeout: 15000 });
  await git(w.root, ['branch', force ? '-D' : '-d', w.branch], { timeout: 15000 });
  try { fs.rmdirSync(path.dirname(w.path)); } catch { /* not empty, or already gone */ }
  return { ok: true };
}

/**
 * Bring several copies home, one after another, into the branch your checkout
 * is on. A copy that clashes is backed out and passed over, so the rest still
 * land (its clash is sorted out afterwards, in turn: worktrees/home-line.js). Anything
 * else git refuses stops the sweep; the ones before it stay merged. Copies
 * started from another branch are skipped, not merged somewhere else.
 *   -> { ok, results: [{ branch, ok, merged, commits, error?, conflict?, skipped? }], clashed: [branch], stopped? }
 */
/**
 * @param {any[]} list
 * @param {{ messageFor?: (w: any) => string | null, trailer?: string | null }} [opts]
 */
async function bringAllHome(list, { messageFor = () => null, trailer = null } = {}) {
  const results = [];
  const clashed = [];
  for (const w of list) {
    const bad = checkWorktree(w);
    if (bad) { results.push({ branch: w?.branch, ok: false, skipped: true, error: bad }); continue; }
    const on = await git(w.root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { timeout: 5000 });
    if (!on.ok || on.out.trim() !== w.base) {
      results.push({ branch: w.branch, ok: false, skipped: true, error: `started from ${w.base}` });
      continue;
    }
    const r = await bringHome(w, { message: messageFor(w), trailer });
    results.push({ branch: w.branch, ...r });
    if (r.conflict) { clashed.push(w.branch); continue; }
    if (!r.ok && !/gone/.test(r.error || '')) return { ok: false, results, clashed, stopped: w.branch };
  }
  return { ok: true, results, clashed };
}

/**
 * Has the copy taken in everything its base has now, with no merge left half
 * done? A clash sorted out in the copy is ready to come home cleanly then.
 */
async function caughtUp(w) {
  if (checkWorktree(w) || !fs.existsSync(w.path)) return false;
  const [has, mid] = await Promise.all([
    git(w.root, ['merge-base', '--is-ancestor', w.base, w.branch], { timeout: 15000 }),
    git(w.path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { timeout: 5000 }),
  ]);
  return has.ok && !mid.ok;
}

// Copies on another computer (worktrees/remote.js), with this module's own steps.
const { createThere, removeThere } = createRemoteCopies({
  git, remote: remoteService, placeOf, branchName, leaveFinishedBranch, copyRefusal, remove, lastLines, firstLine, REF, NO_HOOKS,
});

module.exports = {
  git, setRemote, placeOf, create, createAt, startingPoint, branchOf, status, commitCopy, bringHome, moveBase, remove, branchName, workMessage, checkWorktree, BRANCH,
  remoteStatus, pushBase, tipOf, bringAllHome, caughtUp, upstreamOf, copyRefusal,
  startsWork, onlyLooks, suggestedName, projectDirName, carryTranscript, copySession, findSession,
};
