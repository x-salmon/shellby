// What the file viewer may read, and where (viewer.js): its git runner, a path
// resolved with links followed and 8.3 names expanded and confined to a root, a
// file inside a folder, the repo lookups a handle is opened with, and the checks
// on a file link and on the file picked in the tree. Nothing here holds a handle.
//
// execFile with fixed arguments, timeouts, and never throws to the caller.
const { execFileTree: execFile } = require('./exec-tree'); // a timeout ends git's whole tree
const fs = require('fs');
const os = require('os');
const path = require('path');
const changes = require('./changes');
const { parseTarget } = require('./filelinks');
const { parseWorktrees, okDir } = require('./leaving');

const { TREE } = changes;
const HEADS = 'refs/heads/';
const HEAD_REF = /^refs\/heads\/[^\0\n\r]+$/; // a local branch by its full name, which git never reads as an option

const MAX_BYTES = 2 * 1024 * 1024;   // past this, "Open in editor" instead
const SNIFF_BYTES = 8 * 1024;        // a NUL in here: not text
const GIT_TIMEOUT_MS = 8000;
const MAX_PICKED = 300;                                      // the picked file's path, at most (selectedNote)
const PICK_UNSAFE = /[\0-\x1f\x7f-\x9f\p{Cf}\p{Zl}\p{Zp}]/u; // control, format (bidi) and separator characters

// buffer: the output as bytes (a blob, sniffed for NUL before it's decoded). env: added to git's own.
// exit: answer { code, out } (code: git's exit code, null when it didn't run or timed out) rather than
// the output or null, for a caller that tells one failure from another.
// Nothing is ever fetched (changes.js NO_FETCH_ARGS says why): lazy fetch off, and no transport at all,
// so a repo that says it is a partial clone can't make git run the program its config names.
/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ buffer?: boolean, env?: Record<string, string> | null, maxBuffer?: number, exit?: boolean }} [opts]
 * @returns {Promise<any>}
 */
function git(cwd, args, { buffer = false, env = null, maxBuffer = 8 * 1024 * 1024, exit = false } = {}) {
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, '-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never', ...args], {
      windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer, encoding: buffer ? 'buffer' : 'utf8',
      env: { ...process.env, ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
    }, (err, out) => {
      const said = err ? null : buffer ? out : String(out);
      resolve(!exit ? said : { code: !err ? 0 : Number.isInteger(err.code) ? err.code : null, out: said ?? '' });
    });
  });
}

// A path with links followed and 8.3 names expanded, or null when it isn't there.
const longPath = p => { try { return fs.realpathSync.native(p); } catch { return null; } };
// Strictly inside root (root itself isn't). Both already resolved; win32 compares without case.
const isUnder = (root, abs) => {
  const rel = path.relative(root, abs);
  return !!rel && rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel);
};
const sameDir = (a, b) => {
  const x = typeof a === 'string' ? longPath(a) : null;
  const y = typeof b === 'string' ? longPath(b) : null;
  return !!x && !!y && path.relative(x, y) === '';
};

// Too wide to browse: the home folder, a folder above it, or a whole drive. A conversation started
// in ~ (where Shellby starts one by default), or in a folder of a dotfiles repo at ~, would otherwise
// hand the panel .ssh, .aws and .claude. Anything at or above a too-wide folder is too wide as well,
// so a repo's root is checked along with the folder asked about. -> the reason, or null
function tooWide(dir, home = os.homedir()) {
  if (typeof dir !== 'string' || !dir) return 'Open what?';
  const key = p => (process.platform === 'win32' ? p.toLowerCase() : p);
  const at = key(longPath(dir) || path.resolve(dir));
  if (path.parse(at).root === at) return "Shellby doesn't browse a whole drive.";
  const h = typeof home === 'string' && home ? key(longPath(home) || path.resolve(home)) : null;
  return h && (path.relative(at, h) === '' || isUnder(at, h)) ? "Shellby doesn't browse your whole home folder." : null;
}

// A relative path made only of plain names: no drive (C:x), no stream (a.txt:s), no
// UNC or rooted start, no '..'. Checked before anything touches the disk, so a
// network path never makes Windows log in to a host (as filelinks.js refuses too).
const plainRel = rel => typeof rel === 'string' && !!rel && rel.length <= 1000 && !/[\0:]/.test(rel)
  && !/^[\\/]/.test(rel) && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes('..');

// Outside the folder and not there at all answer alike: the panel learns nothing about other files.
const NOT_HERE = { ok: false, missing: true };

/**
 * A file under root, as text. rel: as git names it (forward slashes) or the OS does.
 * opts.raw: its bytes ({ ok, buf, size }) instead, NUL or not (a picture, for its preview).
 */
async function readInside(root, rel, { raw = false } = {}) {
  const top = typeof root === 'string' ? longPath(root) : null;
  if (!top) return { ok: false, gone: true };
  if (!plainRel(rel)) return { ...NOT_HERE };
  const abs = path.resolve(top, rel);
  if (!isUnder(top, abs)) return { ...NOT_HERE };
  const file = longPath(abs); // links followed: a junction out of the folder ends outside it
  if (!file || !isUnder(top, file)) return { ...NOT_HERE };
  let fh;
  try { fh = await fs.promises.open(file, 'r'); } catch { return { ...NOT_HERE }; }
  try {
    // Swapped for a link between the check and the open: the file opened must still be the one inside.
    const st = await fh.stat({ bigint: true });
    const again = longPath(abs);
    if (!again || !isUnder(top, again)) return { ...NOT_HERE };
    const now = await fs.promises.stat(again, { bigint: true });
    if (now.ino !== st.ino || now.dev !== st.dev) return { ...NOT_HERE };
    if (!st.isFile()) return { ok: false, error: 'Not a file.' };
    const size = Number(st.size);
    if (size > MAX_BYTES) return { ok: false, tooBig: true, size };
    const buf = await fh.readFile();
    if (raw) return { ok: true, buf, size };
    if (buf.subarray(0, SNIFF_BYTES).includes(0)) return { ok: false, binary: true, size };
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return { ok: true, text, size };
  } catch {
    return { ...NOT_HERE };
  } finally {
    await fh.close().catch(() => {});
  }
}

// A worktree that isn't the main checkout is compared with the branch the main
// checkout is on; the main checkout itself has no base (HEAD, then).
async function mainBranchFor(root) {
  const [main] = parseWorktrees(await git(root, ['worktree', 'list', '--porcelain']));
  return main && !sameDir(main.path, root) ? main.branch || null : null;
}

// A branch's tip commit, or null (gone, or git couldn't say). The ref is always a full refs/heads/
// name, which never starts with '-': a branch called "-x" can't reach git as an option.
async function tipOf(root, ref) {
  const out = (await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]))?.trim();
  return out && TREE.test(out) ? out : null;
}

// The repo's worktree folders, resolved: where a branch's next commit is made. Local ones only, and
// none too wide to browse: a record in .git/worktrees can name any folder, the home folder included,
// and a turn ending anywhere under it would then nudge every viewer on the repo's branches.
async function treesOf(root, home) {
  const listed = parseWorktrees(await git(root, ['worktree', 'list', '--porcelain']))
    .filter(w => okDir(w.path) && !tooWide(w.path, home)).map(w => longPath(w.path)).filter(Boolean);
  return listed.length ? listed : [root];
}

// The repo a folder belongs to, as its git common dir resolved and lower-cased (as changes.sameRepo
// compares them), or null. A checkout and its worktrees share one; a folder of another repo doesn't.
async function commonDirOf(dir) {
  const out = (await git(dir, ['rev-parse', '--git-common-dir']))?.trim();
  return out ? path.resolve(dir, out).toLowerCase() : null;
}

/** The branch a folder's repo is on, or null (not a repo, detached, or a folder too wide to browse). */
async function branchOf(dir, { home = os.homedir() } = {}) {
  const top = await changes.rootOf(dir);
  if (top && (tooWide(dir, home) || tooWide(top, home))) return null;
  const head = top ? (await git(top, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() : null;
  return head && head !== 'HEAD' ? head : null;
}

/** A file link from a reply: inside the conversation's repo (a file there), or not. Never in a folder too wide to browse. */
async function locate(cwd, target, { home = os.homedir() } = {}) {
  const t = parseTarget(target, cwd);
  if (!t) return { inside: false };
  const root = longPath((await changes.rootOf(cwd)) || cwd);
  if (!root || tooWide(cwd, home) || tooWide(root, home)) return { inside: false };
  const file = longPath(t.file);
  if (!file || !isUnder(root, file)) return { inside: false };
  try { if (!fs.statSync(file).isFile()) return { inside: false }; } catch { return { inside: false }; }
  // root: the folder a viewer handle on this conversation opens (open() resolves it the same way), so a
  // comment made from a link (a review's finding) lands on the viewer's own diff of that file.
  return { inside: true, rel: path.relative(root, file).split(path.sep).join('/'), line: t.line, root };
}

/**
 * The line a prompt carries for the file picked in the file tree (panel/files-select.js): only a
 * file still there, inside the conversation's repo (or its folder, outside git), never in a folder
 * too wide to browse. Nothing is read from the file. rel: its path in the tree (relative to the
 * repo's root), so a conversation moved into its own worktree keeps its pick: the same file there.
 * The name comes from the repo, and the line is one Claude takes as Shellby's own words: a name
 * with a control, format or separator character, or longer than MAX_PICKED, is refused, and the
 * rest goes in quotes, which a Windows name can't hold. -> the line, or null
 */
async function selectedNote(cwd, rel, { home = os.homedir() } = {}) {
  if (!okDir(cwd) || !plainRel(rel) || rel.length > MAX_PICKED || PICK_UNSAFE.test(rel)) return null;
  const root = longPath((await changes.rootOf(cwd)) || cwd);
  if (!root || tooWide(cwd, home) || tooWide(root, home)) return null;
  const abs = path.resolve(root, rel);
  if (!isUnder(root, abs)) return null; // by name first: nothing outside the folder is touched
  const file = longPath(abs);           // then links followed: a junction out of it ends outside
  if (!file || !isUnder(root, file)) return null;
  try { if (!fs.statSync(file).isFile()) return null; } catch { return null; }
  const shown = path.relative(root, file).split(path.sep).join('/');
  if (shown.length > MAX_PICKED || PICK_UNSAFE.test(shown)) return null; // a link inside can name another file
  return `[Shellby: the user has the file ${JSON.stringify(shown)} selected in the file tree; "this" or "it" may mean it.]`;
}

/** Tool calls that could write, until their results come in; then nudge(cwd) once for each. */
function writeWatch(nudge) {
  const writing = new Set();
  return (item, cwd) => {
    if (changes.mayWrite(item) && item.id) {
      writing.add(item.id);
      if (writing.size > 200) writing.delete(writing.values().next().value);
    } else if (item?.kind === 'tool_result' && writing.delete(item.id) && typeof cwd === 'string') {
      nudge(cwd);
    }
  };
}

module.exports = {
  git, longPath, isUnder, sameDir, tooWide, plainRel, NOT_HERE, readInside,
  mainBranchFor, tipOf, treesOf, commonDirOf, branchOf, locate, selectedNote, writeWatch,
  HEADS, HEAD_REF, MAX_BYTES, SNIFF_BYTES, GIT_TIMEOUT_MS, MAX_PICKED, PICK_UNSAFE,
};
