// The files Claude keeps coming back to in a project: read from Claude Code's
// own transcripts for that folder (and its worktrees), so the terminal counts
// too. A file read in conversation after conversation is often worth a line in
// CLAUDE.md (what's in it, where things live) or a split, so Claude reads less
// to find the same thing. Read-only, async, line by line; only lines with a
// file tool's call in them are parsed, and nothing is kept on disk.
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 256 * 1024 * 1024;   // per scan, newest transcripts first
const MAX_FILES = 3000;
const MAX_DEPTH = 3;                   // <folder>/<session>/subagents/*.jsonl
const TOP = 10;
const MIN_SESSIONS = 3;                // fewer and it isn't a habit yet
const CHARS_PER_TOKEN = 4;
const READS = new Set(['Read']);
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const FILE_TOOL = /"name":"(?:Read|Edit|MultiEdit|Write|NotebookEdit)"/;

/** Claude Code's folder name for a working directory under <config>/projects. */
const folderOf = cwd => String(cwd).replace(/[^A-Za-z0-9]/g, '-');

/**
 * Does a projects/ folder hold this project's transcripts? Its own, Claude
 * Code's worktrees inside it, and Shellby's copies of the same repository.
 */
function isProjectFolder(name, cwd) {
  const own = folderOf(cwd).toLowerCase();
  const base = folderOf(path.basename(cwd)).toLowerCase();
  const n = String(name).toLowerCase();
  return n === own || n.startsWith(`${own}--claude-worktrees-`)
    || new RegExp(`-shellby-worktrees-[a-z0-9]+-${base.replace(/[^a-z0-9-]/g, '')}$`).test(n);
}

/**
 * A path as it reads inside its project ('src/a.js'), or null when it's
 * outside it or has control characters in it (it ends up in a prompt).
 */
function relativeTo(file, root) {
  if (typeof file !== 'string' || typeof root !== 'string' || !file || !root || /[\u0000-\u001f\u007f]/.test(file)) return null;
  const rel = path.relative(root, path.resolve(root, file));
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * Where a session started, from a transcript line, or null. Claude Code names
 * a projects/ folder after it, and it stays put when Claude runs `cd` (a
 * line's own cwd doesn't), so paths are made relative to it.
 */
function rootIn(line) {
  if (typeof line !== 'string' || !line.includes('"cwd"')) return null;
  try {
    const cwd = JSON.parse(line)?.cwd;
    return typeof cwd === 'string' && cwd ? cwd : null;
  } catch { return null; }
}

/**
 * The project files one transcript line read or changed: [{ rel, kind }], or
 * null. Paths are relative to the session's root, so a worktree's copy of a
 * file counts with the original.
 */
function touchesIn(line, root) {
  if (typeof line !== 'string' || !line.includes('"tool_use"') || !FILE_TOOL.test(line)) return null;
  let ev;
  try { ev = JSON.parse(line); } catch { return null; }
  const content = ev?.message?.content;
  const base = root || ev?.cwd;
  if (!Array.isArray(content) || typeof base !== 'string') return null;
  const out = [];
  for (const b of content) {
    if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
    const kind = READS.has(b.name) ? 'read' : EDITS.has(b.name) ? 'edit' : null;
    const rel = kind && relativeTo(b.input?.file_path ?? b.input?.notebook_path, base);
    if (rel) out.push({ rel, kind });
  }
  return out.length ? out : null;
}

/** The conversation a transcript belongs to: a subagent's counts with the session that ran it. */
function sessionOf(file) {
  const dir = path.dirname(file);
  return path.basename(dir).toLowerCase() === 'subagents' ? path.dirname(dir) : file.replace(/\.jsonl$/i, '');
}

/**
 * Add one conversation's touches to the tally (Map rel -> { rel, reads, edits, sessions }).
 * Returns a new tally.
 */
function tallyTranscript(tally, touches) {
  const next = new Map(tally);
  const seen = new Set();
  for (const { rel, kind } of touches) {
    const key = process.platform === 'win32' ? rel.toLowerCase() : rel;
    const t = next.get(key) || { rel, reads: 0, edits: 0, sessions: 0 };
    next.set(key, { ...t, reads: t.reads + (kind === 'read' ? 1 : 0), edits: t.edits + (kind === 'edit' ? 1 : 0), sessions: t.sessions + (seen.has(key) ? 0 : 1) });
    seen.add(key);
  }
  return next;
}

/**
 * The files worth a word: in MIN_SESSIONS or more conversations, most first.
 * @param {Map<string, { rel: string, reads: number, edits: number, sessions: number }>} tally
 * @param {(rel: string) => number | null} [sizeOf]
 */
function hottest(tally, sizeOf = () => null) {
  return [...tally.values()]
    .filter(t => t.sessions >= MIN_SESSIONS)
    .sort((a, b) => (b.sessions - a.sessions) || ((b.reads + b.edits) - (a.reads + a.edits)) || a.rel.localeCompare(b.rel))
    .slice(0, TOP)
    .map(t => {
      const size = sizeOf(t.rel);
      return { ...t, tokens: typeof size === 'number' && Number.isFinite(size) ? Math.round(size / CHARS_PER_TOKEN) : null };
    });
}

async function listJsonl(dir, since, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listJsonl(full, since, depth + 1, out);
    else if (e.isFile() && /\.jsonl$/i.test(e.name)) {
      try {
        const st = await fs.promises.stat(full);
        if (st.mtimeMs >= since) out.push({ file: full, mtimeMs: st.mtimeMs, size: st.size });
      } catch { /* gone since the listing */ }
    }
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

async function touchesOf(file) {
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  const out = [];
  /** @type {string | null} */
  let root = null;
  for await (const line of lines) {
    root ??= rootIn(line);
    const hit = touchesIn(line, root);
    if (hit) out.push(...hit);
  }
  return out;
}

/**
 * The hottest files in the project at cwd over the last LOOKBACK_MS:
 * { files: [{ rel, reads, edits, sessions, tokens }], sessions, days }.
 * A subagent's transcript counts with the conversation that ran it.
 */
async function scanHotFiles({ configDir, cwd, now = Date.now(), maxBytes = MAX_BYTES }) {
  const root = path.join(configDir, 'projects');
  let folders = [];
  try { folders = (await fs.promises.readdir(root, { withFileTypes: true })).filter(e => e.isDirectory() && isProjectFolder(e.name, cwd)); } catch { /* no history yet */ }
  const since = now - LOOKBACK_MS;
  const files = [];
  for (const f of folders) await listJsonl(path.join(root, f.name), since, 0, files);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const bySession = new Map();
  let bytes = 0;
  for (const f of files) {
    if (bytes + f.size > maxBytes) break;
    bytes += f.size;
    try {
      const touches = await touchesOf(f.file);
      if (touches.length) bySession.set(sessionOf(f.file), [...(bySession.get(sessionOf(f.file)) || []), ...touches]);
    } catch { /* unreadable: leave it out */ }
  }
  const tally = [...bySession.values()].reduce(tallyTranscript, new Map());
  const sizeOf = rel => {
    const full = path.resolve(cwd, rel);
    if (relativeTo(full, cwd) === null) return null;
    try { return fs.statSync(full).size; } catch { return null; }
  };
  return { files: hottest(tally, sizeOf), sessions: bySession.size, days: Math.round(LOOKBACK_MS / (24 * 60 * 60 * 1000)) };
}

module.exports = { scanHotFiles, folderOf, isProjectFolder, relativeTo, rootIn, touchesIn, sessionOf, tallyTranscript, hottest, MIN_SESSIONS };
