// What would clash if a copy came home: the files, and in each one the parts
// where your branch and the copy's both changed the same lines. Read with
// `git merge-tree --write-tree`, which merges in git's object store alone: no
// checkout, no index and no working file is touched, so looking is always safe.
//
// The panel shows each clash with both sides (feed-conflicts.js), and a clash can
// go to Claude to resolve in the copy, where Bring it home's merge belongs.
//
// git is worktrees' runner (fixed arguments, a timeout, never throws), handed in.

const MAX_FILES = 20;
const MAX_HUNKS = 30;      // per file
const MAX_SIDE = 200;      // lines of one side of one clash
const MAX_BLOB = 2 * 1024 * 1024;
const REF = /^(?!-)(?!.*\.\.)[\w./-]{1,200}$/;
const OID = /^[0-9a-f]{40,64}$/;

/**
 * `git merge-tree --write-tree --name-only -z` -> { tree, files }: the merged tree (conflict markers
 * and all) and the conflicted paths, once each. null when the output isn't that.
 */
function parseMergeTree(out) {
  const parts = String(out || '').split('\0');
  const tree = (parts[0] || '').trim();
  if (!OID.test(tree)) return null;
  const files = [];
  for (const p of parts.slice(1)) {
    if (!p) break; // an empty field ends the list; git's messages follow
    if (!files.includes(p)) files.push(p);
  }
  return { tree, files };
}

/**
 * A merged file's text -> its clashes: [{ at, ours, base, theirs }] (at: the line the first marker
 * is on, base: the common ancestor's lines when git wrote them, else null). Each side capped.
 */
function parseConflicts(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  /** @type {{ at: number, ours: string[], base: string[] | null, theirs: string[] }[]} */
  const hunks = [];
  /** @type {{ at: number, ours: string[], base: string[] | null, theirs: string[] } | null} */
  let cur = null;
  /** @type {'ours' | 'base' | 'theirs' | null} */
  let part = null;
  lines.forEach((l, i) => {
    if (!cur && l.startsWith('<<<<<<<')) { cur = { at: i + 1, ours: [], base: null, theirs: [] }; part = 'ours'; return; }
    if (!cur) return;
    if (l.startsWith('|||||||') && part === 'ours') { cur.base = []; part = 'base'; return; }
    if (l.startsWith('=======') && part !== 'theirs') { part = 'theirs'; return; }
    if (l.startsWith('>>>>>>>') && part === 'theirs') { hunks.push(cur); cur = null; part = null; return; }
    const side = part ? cur[part] : null;
    if (side && side.length < MAX_SIDE) side.push(l);
  });
  return hunks.slice(0, MAX_HUNKS);
}

/**
 * What would clash bringing `branch` home into `base`, in the repo at root. Only full branch names
 * that can't reach git as an option.
 *   -> { ok: true, clean } | { ok: true, files: [{ path, hunks: [...] }] (hunks [] when it isn't a
 *      clash of lines: a file changed on one side and deleted on the other), more } | { ok: false, error }
 */
async function clashOf(git, root, base, branch) {
  if (!REF.test(String(base)) || !REF.test(String(branch))) return { ok: false, error: 'Which branches?' };
  const m = await git(root, ['merge-tree', '--write-tree', '--name-only', '-z', `refs/heads/${base}`, `refs/heads/${branch}`], { timeout: 30000 });
  const parsed = parseMergeTree(m.out);
  if (!parsed) return { ok: false, error: "Git couldn't work out the merge. It needs git 2.38 or newer." };
  if (m.ok && !parsed.files.length) return { ok: true, clean: true, files: [] };
  const files = [];
  for (const p of parsed.files.slice(0, MAX_FILES)) {
    const at = `${parsed.tree}:${p}`;
    const size = Number((await git(root, ['cat-file', '-s', at], { timeout: 10000 })).out.trim());
    let hunks = [];
    if (Number.isFinite(size) && size <= MAX_BLOB) {
      const blob = await git(root, ['cat-file', 'blob', at], { timeout: 15000 });
      if (blob.ok && !blob.out.slice(0, 8000).includes('\0')) hunks = parseConflicts(blob.out);
    }
    files.push({ path: p, hunks });
  }
  return { ok: true, clean: false, files, more: Math.max(0, parsed.files.length - MAX_FILES) };
}

// A fence longer than any run of backticks in the lines it holds.
const fence = lines => '`'.repeat(Math.max(3, ...lines.map(l => Math.max(0, ...(l.match(/`+/g) || []).map(r => r.length + 1)))));
const block = lines => { const f = fence(lines); return [f, ...lines, f]; };

/**
 * The follow-up that asks Claude to resolve clashes in the copy: hunk (a file's clash) or the whole
 * list. Both sides quoted, as code.
 * @param {{ base: string, files: { path: string, hunks: any[] }[], only?: { path: string, index: number } | null }} c
 */
function resolvePrompt({ base, files, only = null }) {
  const lines = [`Merge ${base} into this branch (git merge ${base}), and resolve the conflicts so both sides' intent survives.`];
  const pick = only ? files.filter(f => f.path === only.path) : files;
  for (const f of pick) {
    const hunks = only ? f.hunks.filter((_h, i) => i === only.index) : f.hunks;
    if (!hunks.length) { lines.push('', `${f.path}: changed on one side and deleted or renamed on the other. Decide which way it should go.`); continue; }
    for (const h of hunks) {
      lines.push('', `${f.path}, around line ${h.at}:`, `In ${base}:`, ...block(h.ours), 'In this branch:', ...block(h.theirs));
    }
  }
  if (only) lines.push('', `Start with that one${files.length > 1 || files[0]?.hunks.length > 1 ? ', then resolve the rest the same way' : ''}.`);
  lines.push('', "Run the tests if there are any, and commit. Then tell me it's ready to bring home. Don't merge into the base branch yourself.");
  return lines.join('\n');
}

module.exports = { parseMergeTree, parseConflicts, clashOf, resolvePrompt, MAX_FILES, MAX_HUNKS, MAX_SIDE };
