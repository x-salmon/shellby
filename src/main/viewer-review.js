// The file viewer's review reads (viewer.js): each changed file's fingerprint for
// the panel's Viewed tick, who last changed a line, and which pictures it previews.
// git is viewer.js's own runner (fixed arguments, a timeout, never throws), handed in.

// Pictures the viewer previews (viewer.js imageOf), by extension.
const IMAGE_TYPES = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', svg: 'image/svg+xml',
});

const ZERO = /^0+$/;
// Said in a commit's message by Claude Code (its Co-Authored-By trailer, or the line it ends a PR with).
const BY_CLAUDE = /(?:^co-authored-by:\s*claude\b)|(?:generated with \[?claude code)/im;

/**
 * `git diff --raw -z --no-abbrev` -> Map(path -> the blob the file ends at, or the one it was for a
 * deleted file). The panel's Viewed tick is kept against it: a file that changes again ends at
 * another blob, and loses its tick.
 */
function parseRaw(out) {
  const blobs = new Map();
  const recs = String(out || '').split('\0');
  for (let i = 0; i + 1 < recs.length; i++) {
    const m = /^:\d+ \d+ ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])/.exec(recs[i]);
    if (!m) continue;
    blobs.set(recs[i + 1], m[3] === 'D' ? m[1] : m[2]);
    i++;
  }
  return blobs;
}

/**
 * Each changed file's sig, set on it: how it was changed and the blob it ends at. A look git
 * couldn't list blobs for leaves sig off, and the panel then keeps no tick for it.
 * @param {(cwd: string, args: string[], opts?: any) => Promise<any>} git
 */
async function signFiles(git, root, before, after, files) {
  if (!files.length) return;
  const out = await git(root, ['diff', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-ext-diff', before, after], { maxBuffer: 16 * 1024 * 1024 });
  const blobs = parseRaw(out);
  for (const f of files) {
    const b = blobs.get(f.path);
    if (b) f.sig = `${f.status === '?' ? 'A' : f.status}:${b.slice(0, 16)}`;
  }
}

/**
 * One line of `git blame --porcelain` -> who last changed it: { uncommitted, commit, author, when,
 * summary } (when in ms, commit short), or null when git said nothing usable. No e-mail address:
 * the panel shows a name.
 */
function parseBlame(out) {
  const lines = String(out || '').replace(/\r/g, '').split('\n');
  const head = /^([0-9a-f]{40,64}) \d+ \d+/.exec(lines[0] || '');
  if (!head) return null;
  const field = name => { const l = lines.find(x => x.startsWith(`${name} `)); return l ? l.slice(name.length + 1) : ''; };
  const uncommitted = ZERO.test(head[1]);
  return {
    uncommitted,
    commit: uncommitted ? null : head[1].slice(0, 10),
    author: uncommitted ? null : field('author').slice(0, 200) || null,
    when: uncommitted ? null : (Number(field('author-time')) * 1000 || null),
    summary: uncommitted ? null : field('summary').slice(0, 300) || null,
  };
}

/**
 * Who last changed line `line` of `name` (a path git names, already checked to be the handle's), at
 * `commit` or, with none, as the file is on disk now; and whether Claude Code made that commit.
 * No textconv: a repo's diff driver never runs. -> { ok, ...parseBlame, claude } | { ok: false, error }
 * @param {(cwd: string, args: string[], opts?: any) => Promise<any>} git
 * @param {string} at
 * @param {string} name
 * @param {number} line
 * @param {string | null} commit
 */
async function blameLine(git, at, name, line, commit) {
  const out = await git(at, ['blame', '--porcelain', '--no-textconv', '-L', `${line},${line}`, ...(commit ? [commit] : []), '--', name]);
  const who = parseBlame(out);
  if (!who) return { ok: false, error: "Git couldn't say who wrote that line." };
  let claude = false;
  if (who.commit) {
    const msg = await git(at, ['log', '-1', '--no-show-signature', '--format=%B', `${who.commit}^{commit}`]);
    claude = BY_CLAUDE.test(String(msg || ''));
  }
  return { ok: true, ...who, claude };
}

module.exports = { IMAGE_TYPES, BY_CLAUDE, parseRaw, parseBlame, signFiles, blameLine };
