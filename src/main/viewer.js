// The file viewer's side of main (renderer/panel/viewer.js): which folders and
// branches the panel may read, what changed in them, and nothing else.
//
// The panel never names a path or a git ref to read. It opens a handle on a
// conversation's folder (or a worktree the Project page listed), and every read
// after that is confined to the handle's root, resolved with links followed
// and 8.3 names expanded, so a junction can't lead out of it. Diffs are served
// only for files on the handle's own changes list, as changeRef does for a turn.
// A branch handle (picked from the header's menu by a key main issued) reads a
// branch nothing has checked out from git alone: no checkout, no index, no hook.
//
// This file holds the handles. viewer-read.js is what may be read and where (git,
// paths confined to a root, a file inside a folder, the repo lookups), viewer-places.js
// the header's menu, viewer-status.js the file tree's marks and viewer-review.js
// the Viewed ticks, blame and pictures. Each is re-exported here for its callers.
//
// execFile with fixed arguments, timeouts, and never throws to the caller.
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const changes = require('./changes');
const fileIndex = require('./fileindex');
const { okDir } = require('./leaving');
const { readStatus } = require('./viewer-status');
const { IMAGE_TYPES, parseRaw, parseBlame, signFiles, blameLine } = require('./viewer-review');
const {
  git, longPath, isUnder, sameDir, tooWide, plainRel, NOT_HERE, readInside, mainBranchFor, tipOf, treesOf, commonDirOf,
  branchOf, locate, selectedNote, writeWatch, HEADS, HEAD_REF, MAX_BYTES, SNIFF_BYTES, MAX_PICKED, PICK_UNSAFE,
} = require('./viewer-read');
const { createPlaces, countStatus, checkoutBranch, limiter, MAX_PLACE_TREES, MAX_PLACE_BRANCHES, PLACES_MS } = require('./viewer-places');

const { TREE } = changes;

const MAX_HANDLES = 8;               // folders open at once; the oldest goes first
const REFRESH_MS = 2000;             // a look again sooner than this is answered from the last one
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // what a repo with no commits is compared with
const TREE_MAX = 30000;              // All files on a branch, at most (fileindex.js lists a folder to the same)

// changes.patchFor's own answers (checkRef's, a moved root, objects tidied away, a diff with no
// stderr). Any other error is git's stderr, which never reaches the panel.
const PATCH_SAID = new Set([
  'Not a project folder.', 'Not a snapshot.', 'Not a file in this change.', 'That project has moved.',
  'Those changes have been tidied away by git since.', "Couldn't read the diff.",
]);

/** opts.home: the home folder, never browsed (tests give their own). */
function createViewer({ home = os.homedir() } = {}) {
  // id -> { id, kind, root, git, common, branch, base, tabId, origin, gen, shown, slots, pending, last, places, placing }.
  // common: the repo's git common dir (commonDirOf), so a folder to fall back on is known to be of it (liveRoot).
  // kind 'folder' reads its folder; kind 'branch' reads git alone and adds { ref, commit, trees, tree }
  // (tree = { commit, p }: the one ls-tree for that commit, running or done, failed or not).
  // slots, pending and last are each by mode ('base' | 'head'; a branch has only 'base'):
  // slots[mode] = { files: Map(path key -> file), ref } (what a diff is cut from), pending[mode] = a
  // look running, last[mode] = { at, result }; shown = the mode of the list the panel was last handed;
  // gen counts nudges. origin = { tabId, root, base }: the conversation the first handle was opened
  // from, carried through the header menu's picks; places = that menu's list (placesOf), placing = its
  // build while one runs. statusHead, statusCached, statusLine: the file tree's status reads (viewer-status.js).
  const handles = new Map();
  let line = Promise.resolve(); // viewer snapshots take turns: eight handles never hash a big repo at once

  function add(fields) {
    const id = crypto.randomBytes(8).toString('hex');
    if (handles.size >= MAX_HANDLES) handles.delete(handles.keys().next().value);
    const h = { id, gen: 0, shown: null, slots: {}, pending: {}, last: {}, places: null, placing: null, ...fields };
    handles.set(id, h);
    return h;
  }

  // origin: given when a pick from the header's menu opens it. The handle belongs to the conversation
  // (keepTabs) only while it shows that conversation's own folder, and then compares with its base.
  /** @typedef {{ tabId: string | null, root: string, base: string | null } | null} Origin */
  /** @param {{ dir?: string, base?: string | null, tabId?: string | null, origin?: Origin }} [opts] */
  async function open({ dir, base = null, tabId = null, origin = null } = {}) {
    // A local folder only: a network share would make Windows log in to it (leaving.js okDir).
    if (!okDir(dir)) return { ok: false, error: 'Open what?' };
    const top = await changes.rootOf(dir);
    const root = longPath(top || dir);
    if (!root) return { ok: false, gone: true, error: 'This folder is gone.' };
    const wide = tooWide(dir, home) || tooWide(root, home);
    if (wide) return { ok: false, error: wide };
    const given = typeof base === 'string' && base ? base : null;
    const from = tabId ? { tabId, root, base: given } : origin;
    const own = !!from && sameDir(from.root, root);
    const [branch, common] = top ? await Promise.all([branchOf(root, { home }), commonDirOf(root)]) : [null, null];
    const against = top ? given || (own ? from.base : null) || await mainBranchFor(root) : null;
    const h = add({ kind: 'folder', root, git: !!top, common, branch, base: against, tabId: own ? from.tabId : null, origin: from });
    return { ok: true, id: h.id, root, name: path.basename(root), branch, base: against, git: !!top, kind: 'folder' };
  }

  // A branch nothing has checked out (switchTo opens these): its commits since it left base, their
  // diffs, its tree and its files, all read from git. root: the folder of the handle it was picked from.
  /** @param {{ root?: string, ref?: string, base?: string | null, origin?: Origin }} [opts] */
  async function openBranch({ root, ref, base = null, origin = null } = {}) {
    if (!okDir(root) || typeof ref !== 'string' || !HEAD_REF.test(ref)) return { ok: false, error: 'Open what?' };
    const top = longPath(root);
    if (!top) return { ok: false, gone: true, error: 'This folder is gone.' };
    const wide = tooWide(top, home);
    if (wide) return { ok: false, error: wide };
    const commit = await tipOf(top, ref);
    if (!commit) return { ok: false, gone: true, error: 'That worktree or branch is gone.' };
    const branch = ref.slice(HEADS.length);
    const against = typeof base === 'string' && base ? base : null;
    const [trees, common] = await Promise.all([treesOf(top, home), commonDirOf(top)]);
    const h = add({ kind: 'branch', root: top, git: true, common, ref, commit, branch, base: against, tabId: null, origin, trees, tree: null });
    return { ok: true, id: h.id, root: top, name: path.basename(top), branch, base: against, git: true, kind: 'branch' };
  }

  // Where git runs for a handle: its own folder while it is there. Once that is gone (a worktree
  // removed), a branch is still all in the repo, and a menu can still switch away: then another live
  // folder of the same repo (same git common dir), one of a branch's worktrees or the folder the first
  // handle was opened on, never one too wide to browse or of another repo. -> a resolved folder | null
  async function liveRoot(h) {
    if (longPath(h.root)) return h.root;
    if (!h.common) return null;
    for (const dir of [...(h.trees || []), h.origin?.root]) {
      const at = okDir(dir) ? longPath(dir) : null;
      if (at && !tooWide(at, home) && await commonDirOf(at) === h.common) return at;
    }
    return null;
  }

  async function computeFolder(h, key) {
    const uncommittedOnly = key === 'head';
    if (!longPath(h.root)) return { ok: false, gone: true, error: 'This folder is gone.' };
    const info = /** @type {any} */ ({});
    const snap = await changes.snapshot(h.root, info, { hooks: false, noFetch: true });
    if (!snap) return info.skipped ? { ok: false, tooManyNew: true, error: 'Too many new files to compare.' } : { ok: false, error: "Couldn't read changes." };
    // The base by its full name: a main checkout on a branch called "--fork-point" would otherwise
    // reach merge-base as that option. One that doesn't resolve (a 'HEAD' base, a deleted branch)
    // compares with HEAD, as a base git can't find always has.
    const mb = !uncommittedOnly && h.base ? (await git(h.root, ['merge-base', `${HEADS}${h.base}`, 'HEAD']))?.trim() : null;
    const fork = mb && TREE.test(mb) ? mb : null;
    const before = fork || snap.head || EMPTY_TREE;
    const diff = /** @type {any} */ ({});
    const sum = await changes.summarize({ root: snap.root, tree: before }, snap, { noFetch: true, info: diff });
    if (diff.failed) return { ok: false, error: "Couldn't read changes." }; // not "Nothing has changed here."
    const files = sum?.files || [];
    // In a snapshot an untracked file is just another added one: git status says which.
    if (files.some(f => f.status === 'A')) {
      const out = await git(h.root, ['status', '--porcelain', '-z', '--untracked-files=all']);
      const fresh = new Set(String(out || '').split('\0').filter(s => s.startsWith('?? ')).map(s => s.slice(3).toLowerCase()));
      for (const f of files) if (f.status === 'A' && fresh.has(f.path.toLowerCase())) f.status = '?';
    }
    await signFiles(git, snap.root, before, snap.tree, files);
    h.slots[key] = { ref: { root: snap.root, before, after: snap.tree }, files: new Map(files.map(f => [f.path.toLowerCase(), f])) };
    return { ok: true, files, more: sum?.more || 0, against: fork ? h.base : 'HEAD' };
  }

  // A branch's changes: its own commits since it left base, or all of it (from the empty tree) when
  // they share no history. The tip is read again each time, so new commits show.
  async function computeBranch(h) {
    const at = await liveRoot(h);
    if (!at) return { ok: false, gone: true, error: 'This folder is gone.' };
    const commit = await tipOf(at, h.ref);
    if (!commit) {
      // rev-parse answers null for a missing ref and for a git that didn't run: ask git something else.
      const alive = await git(at, ['rev-parse', '--git-dir']);
      return alive === null ? { ok: false, error: "Couldn't read changes." } : { ok: false, branchGone: true, error: 'This branch is gone.' };
    }
    h.commit = commit;
    h.trees = await treesOf(at, home);
    // merge-base exits 1 when the two share no history: then all of the branch is new, from the empty
    // tree. Any other failure (a timeout, a base that no longer resolves) is said, with Retry, rather
    // than shown as the whole branch added "(from main)".
    let before = EMPTY_TREE;
    if (h.base) {
      const mb = await git(at, ['merge-base', `${HEADS}${h.base}`, commit], { exit: true });
      const fork = mb.code === 0 ? mb.out.trim() : '';
      if (TREE.test(fork)) before = fork;
      else if (mb.code !== 1) return { ok: false, error: "Couldn't read changes." };
    }
    const diff = /** @type {any} */ ({});
    const sum = await changes.summarize({ root: at, tree: before }, { root: at, tree: commit }, { noFetch: true, info: diff });
    if (diff.failed) return { ok: false, error: "Couldn't read changes." }; // a missing object, a timeout: not "nothing changed"
    const files = sum?.files || [];
    await signFiles(git, at, before, commit, files);
    // Git's own spelling: a branch can hold A.txt and a.txt, and nothing on disk folds them.
    h.slots.base = { ref: { root: at, before, after: commit }, files: new Map(files.map(f => [f.path, f])) };
    return { ok: true, files, more: sum?.more || 0, against: h.base };
  }

  function changesOf(id, { uncommittedOnly = false } = {}) {
    const h = handles.get(id);
    if (!h) return Promise.resolve({ ok: false, expired: true });
    if (!h.git) return Promise.resolve({ ok: true, noGit: true, files: [], more: 0, against: null });
    // A branch is all commits: Just uncommitted doesn't apply to it.
    const key = h.kind === 'folder' && uncommittedOnly ? 'head' : 'base';
    // The list handed out is the one a diff is cut from.
    const shown = result => { if (result.ok) h.shown = key; return result; };
    // Asked twice while the first is still hashing the folder, or again within 2 s: one snapshot answers both.
    if (h.pending[key]) return h.pending[key].then(shown);
    const last = h.last[key];
    if (last && Date.now() - last.at < REFRESH_MS) return Promise.resolve(shown(last.result));
    const gen = h.gen;
    // A branch is a few quick git reads: it never waits behind a folder's snapshot.
    const look = h.kind === 'branch' ? computeBranch(h) : line.then(() => computeFolder(h, key));
    const p = look.then(result => {
      // A nudge while it ran: this look may predate the write, so it answers no later call.
      if (result.ok && h.gen === gen) h.last[key] = { at: Date.now(), result };
      return result;
    }).finally(() => { if (h.pending[key] === p) delete h.pending[key]; });
    if (h.kind !== 'branch') line = p.catch(() => {});
    h.pending[key] = p;
    return p.then(shown);
  }

  // A file on the list the panel was last handed, by its path there. -> { h, slot, f } | an answer to give
  function onList(id, rel) {
    const h = handles.get(id);
    if (!h) return { answer: { ok: false, expired: true } };
    const slot = h.slots[h.shown];
    const f = typeof rel === 'string' ? slot?.files.get(h.kind === 'branch' ? rel : rel.toLowerCase()) : null;
    if (!f) return { answer: { ok: false, error: 'Not a file in these changes.' } };
    return { h, slot, f };
  }

  // opts.ignoreSpace: git diff -w, so a reformatted file shows only what really changed.
  async function diffOf(id, rel, { ignoreSpace = false } = {}) {
    const { answer, h, slot, f } = onList(id, rel);
    if (answer) return answer;
    // A branch's diff is commit to commit: any live folder of the repo makes it, not only the one the
    // list was taken in, which may have gone since.
    const root = h.kind === 'branch' ? await liveRoot(h) : slot.ref.root;
    if (!root) return { ok: false, gone: true, error: 'This folder is gone.' };
    const r = await changes.patchFor({ ...slot.ref, root, file: f.path }, { noFetch: true, ignoreSpace: !!ignoreSpace });
    // patchFor's own words stand; anything else is git's stderr (a blob it lacks: "fatal: unable to read ...").
    if (r.error) return { ok: false, error: PATCH_SAID.has(r.error) ? r.error : "Couldn't read that." };
    return { ok: true, patch: r.patch, truncated: r.truncated, binary: f.binary, sig: f.sig || null };
  }

  /**
   * Take one hunk of a changed file back, in a conversation's own folder only (never a branch, which
   * has no files on disk, and never a folder the Project page opened). changes.undoHunk checks the
   * hunk is still the one shown and the file hasn't changed since the list was taken, and refuses
   * rather than half-applies. busy(tabId): the conversation is mid-turn, when files are still moving.
   * @param {string} id
   * @param {string} rel
   * @param {{ hunk?: number, header?: string }} part
   * @param {(tabId: string) => boolean} [busy]
   */
  async function undoHunk(id, rel, { hunk, header } = {}, busy = () => false) {
    const { answer, h, slot, f } = onList(id, rel);
    if (answer) return answer;
    if (h.kind !== 'folder' || !h.tabId) return { ok: false, error: 'Only a conversation\'s own folder can be changed from here.' };
    if (busy(h.tabId)) return { ok: false, error: 'Let him finish first: this conversation is working.' };
    if (f.status !== 'M') return { ok: false, error: 'Only a changed file can be taken back a part at a time.' };
    const r = await changes.undoHunk({ ...slot.ref, file: f.path }, { hunk, header });
    if (!r.ok) return { ok: false, error: r.error || "Couldn't take that part back." };
    h.gen++; h.last = {}; h.pending = {}; // the list and the diff it answered are out of date now
    return { ok: true };
  }

  /**
   * Who last changed one line of a file (git blame -L n,n), and whether Claude Code made that commit
   * (its trailer in the message). A folder's file as it is on disk, so a line not committed yet says
   * so; a branch's at its tip. Only a file inside the handle, as read() checks.
   */
  async function blameOf(id, rel, line) {
    const h = handles.get(id);
    if (!h) return { ok: false, expired: true };
    if (!h.git) return { ok: false, error: 'Not a git repository.' };
    if (!Number.isInteger(line) || line < 1 || line > 10_000_000) return { ok: false, error: 'Which line?' };
    const at = h.kind === 'branch' ? await liveRoot(h) : longPath(h.root);
    if (!at) return { ok: false, gone: true };
    /** @type {string | null} */
    let name = null;
    if (h.kind === 'branch') {
      const t = typeof rel === 'string' && rel ? await pathsAt(h, h.commit, at) : null;
      if (t && t.set.has(rel)) name = rel;
    } else if (plainRel(rel)) {
      const abs = path.resolve(at, rel);
      const file = isUnder(at, abs) ? longPath(abs) : null;
      if (file && isUnder(at, file)) name = path.relative(at, file).split(path.sep).join('/');
    }
    if (!name) return { ...NOT_HERE };
    return blameLine(git, at, name, line, h.kind === 'branch' ? h.commit : null);
  }

  // The paths in a branch's tree at a commit: one ls-tree per commit, shared by every ask while it runs,
  // and a failure (a timeout, a listing over 32 MB, a tree git can't read) kept for that commit rather
  // than run again on each read. at: a live folder of the repo (liveRoot). -> Promise<{ commit, list, set } | null>
  function pathsAt(h, commit, at) {
    if (h.tree?.commit !== commit) {
      const p = git(at, ['ls-tree', '-r', '-z', '--name-only', commit], { maxBuffer: 32 * 1024 * 1024 }).then(out => {
        if (out === null) return null;
        // All files lists at most TREE_MAX; Whole file reads any path the tree has.
        const all = out.split('\0').filter(Boolean);
        return { commit, list: all.slice(0, TREE_MAX), set: new Set(all) };
      });
      h.tree = { commit, p };
    }
    return h.tree.p;
  }

  // A file of a branch, from its newest commit read. Only a path its own tree lists (git's spelling, case
  // and all): cat-file would answer for a folder or another revision too. Size first, so a huge blob is never read.
  async function readBlob(h, rel, { raw = false } = {}) {
    if (typeof rel !== 'string' || !rel) return { ...NOT_HERE };
    const root = await liveRoot(h);
    if (!root) return { ok: false, gone: true };
    const t = await pathsAt(h, h.commit, root);
    if (!t) return { ok: false, error: "Couldn't read that." };
    if (!t.set.has(rel)) return { ...NOT_HERE };
    const at = `${t.commit}:${rel}`;
    const size = Number((await git(root, ['cat-file', '-s', at]))?.trim());
    if (!Number.isFinite(size)) return { ok: false, error: "Couldn't read that." };
    if (size > MAX_BYTES) return { ok: false, tooBig: true, size };
    // cat-file blob runs no clean or smudge filter: the bytes as committed.
    const buf = await git(root, ['cat-file', 'blob', at], { buffer: true, env: { GIT_LITERAL_PATHSPECS: '1' }, maxBuffer: MAX_BYTES + 1024 });
    if (!buf) return { ok: false, error: "Couldn't read that." };
    if (raw) return { ok: true, buf, size };
    if (buf.subarray(0, SNIFF_BYTES).includes(0)) return { ok: false, binary: true, size };
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { ok: true, text, size };
  }

  async function read(id, rel) {
    const h = handles.get(id);
    if (!h) return { ok: false, expired: true };
    return h.kind === 'branch' ? readBlob(h, rel) : readInside(h.root, rel);
  }

  /**
   * A picture for the viewer's preview, as a data: URL the panel puts in an <img> (which runs
   * nothing, an SVG's scripts included). Only by its name's extension (IMAGE_TYPES), never sniffed,
   * and within MAX_BYTES, read as read() reads: inside the folder, or from the branch's own tree.
   */
  async function imageOf(id, rel) {
    const h = handles.get(id);
    if (!h) return { ok: false, expired: true };
    const type = typeof rel === 'string' ? IMAGE_TYPES[path.extname(rel).slice(1).toLowerCase()] : null;
    if (!type) return { ok: false, error: 'Not a picture Shellby can show.' };
    const r = h.kind === 'branch' ? await readBlob(h, rel, { raw: true }) : await readInside(h.root, rel, { raw: true });
    if (!r.ok) return r;
    return { ok: true, url: `data:${type};base64,${r.buf.toString('base64')}`, size: r.size };
  }

  /** All files: fileindex.js's list for a folder (fresh: not the cached one); a branch's own tree, with its folders. */
  async function treeOf(id, { fresh = false } = {}) {
    const h = handles.get(id);
    if (!h) return { ok: false, expired: true };
    if (h.kind !== 'branch') return { ok: true, entries: await fileIndex.list(h.root, { fresh }) };
    // The tip as it is now, not where the last changes look left it: Refresh asks for both at once, and
    // computeBranch moves h.commit only after its own rev-parse. A branch gone since keeps its last tree.
    const at = await liveRoot(h);
    if (!at) return { ok: true, entries: [] }; // as a folder gone answers: Changes says it is gone
    const tip = await tipOf(at, h.ref);
    if (tip) h.commit = tip;
    const t = await pathsAt(h, h.commit, at);
    return { ok: true, entries: t ? fileIndex.withFolders(t.list) : [] };
  }

  // The file tree's marks (viewer-status.js), for a folder handle only. One read at a time per
  // handle, in order, so each one's commit check compares with the one before. Asked again within
  // REFRESH_MS with no nudge between, the last answer stands, without its commits and staged files
  // (they lit once). staleFor's h.last = {} and h.pending = {} drop the reuse and the share, as
  // they do for a changes look.
  function statusOf(id) {
    const h = handles.get(id);
    if (!h) return Promise.resolve({ ok: false, expired: true });
    if (h.kind !== 'folder') return Promise.resolve({ ok: false, error: 'Only a folder has a status.' });
    if (!longPath(h.root)) return Promise.resolve({ ok: false, gone: true, error: 'This folder is gone.' });
    if (h.pending.status) return h.pending.status;
    const last = h.last.status;
    if (last && Date.now() - last.at < REFRESH_MS) return Promise.resolve(last.result);
    const gen = h.gen;
    const p = (h.statusLine || Promise.resolve()).then(() => readStatus(h, git)).then(result => {
      if (result.ok && h.gen === gen) h.last.status = { at: Date.now(), result: { ...result, committed: [], staged: [] } };
      return result;
    }).finally(() => { if (h.pending.status === p) delete h.pending.status; });
    h.statusLine = p.catch(() => {});
    h.pending.status = p;
    return p;
  }

  // The header's menu (viewer-places.js): the repo's worktrees and branches, and a pick from them.
  const { placesOf, switchTo } = createPlaces({ handles, home, liveRoot, open, openBranch });

  // The handles a changed folder belongs to. Their last look no longer answers a repeat, and a look
  // still running no longer answers one either (it may have hashed the folder before the write):
  // the 2 s reuse only absorbs asking twice, never a real change.
  //   A folder handle on dir, on a folder dir is in, or on one inside dir (an agent's worktree under
  //   the conversation's folder), except inside a folder too wide to browse: a conversation left in ~
  //   would otherwise nudge every viewer on every write.
  //   A branch handle only with { commits: true } (turn ends, step undo, ! commands: where commits
  //   land), when dir is in one of its repo's worktrees; never for each tool's result, and never from a
  //   folder too wide to browse either (treesOf leaves those out as well).
  function staleFor(dir, { commits = false } = {}) {
    if (typeof dir !== 'string' || !path.isAbsolute(dir)) return [];
    const at = longPath(dir) || path.resolve(dir);
    const wide = !!tooWide(at, home);
    const within = root => path.relative(root, at) === '' || isUnder(root, at);
    const hit = [...handles.values()].filter(h => (h.kind === 'branch'
      ? commits && !wide && h.trees.some(within)
      : within(h.root) || (!wide && isUnder(at, h.root))));
    for (const h of hit) { h.gen++; h.last = {}; h.pending = {}; }
    return hit.map(h => h.id);
  }

  // A conversation closed: the handles opened from it go too (the Project page's belong to no tab).
  function keepTabs(open) {
    for (const [id, h] of handles) if (h.tabId && !open.has(h.tabId)) handles.delete(id);
  }

  return {
    open, openBranch, get: id => handles.get(id) || null, changesOf, diffOf, undoHunk, blameOf, read, imageOf, treeOf, statusOf,
    placesOf, switchTo, close: id => { handles.delete(id); }, staleFor, keepTabs,
  };
}

module.exports = {
  readInside, sameDir, isUnder, longPath, tooWide, createViewer, locate, selectedNote, branchOf, writeWatch, countStatus, checkoutBranch, limiter, parseRaw, parseBlame,
  MAX_BYTES, SNIFF_BYTES, MAX_HANDLES, REFRESH_MS, EMPTY_TREE, TREE_MAX, HEAD_REF, MAX_PLACE_TREES, MAX_PLACE_BRANCHES, PLACES_MS,
  PICK_UNSAFE, MAX_PICKED, IMAGE_TYPES,
};
