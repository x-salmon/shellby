// Claude Code's own record of a conversation, carried into a copy so the
// same conversation resumes there (worktrees/index.js moves the conversation).
const fs = require('fs');
const path = require('path');

/**
 * Claude Code keeps a conversation under <config>/projects/<folder, every
 * character but letters and digits as "-">/<session id>.jsonl, and only
 * resumes it from that folder. Copying it across lets the same conversation
 * carry on in the copy. Async, since the folder of subagent transcripts beside
 * it can be large, and this runs as a conversation moves. -> Promise<true | false>
 */
const projectDirName = dir => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');
const SESSION_ID = /^[\w-]{8,64}$/;
async function carryTranscript({ configDir, sessionId, from, to }) {
  if (!SESSION_ID.test(sessionId || '')) return false;
  const where = sessionPaths({ configDir, file: path.join(configDir, 'projects', projectDirName(from), `${sessionId}.jsonl`), to });
  if (!where) return false;
  const { id, file, src, dst } = where;
  const there = p => fs.promises.access(p).then(() => true, () => false);
  try {
    if (!await there(file)) return false;
    if (path.resolve(src).toLowerCase() === path.resolve(dst).toLowerCase()) return true;
    await fs.promises.mkdir(dst, { recursive: true });
    await fs.promises.copyFile(file, path.join(dst, `${id}.jsonl`));
    if (await there(path.join(src, id))) await fs.promises.cp(path.join(src, id), path.join(dst, id), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// The file's id, and the folders it's copied from and to; null for a file that isn't a conversation.
function sessionPaths({ configDir, file, to }) {
  const id = path.basename(String(file || ''), '.jsonl');
  if (!SESSION_ID.test(id) || !String(file).endsWith('.jsonl')) return null;
  return { id, file, src: path.dirname(file), dst: path.join(configDir, 'projects', projectDirName(to)) };
}

/**
 * Copy one of Claude Code's conversation files (and the folder of subagent
 * transcripts and large tool results beside it) to where Claude Code looks
 * for conversations in `to`. Leaves one that's already there alone. -> true | false
 * Synchronous, for the callers that aren't async (wiring/handoff.js, branching.js);
 * moving a conversation into a copy uses carryTranscript.
 */
function copySession({ configDir, file, to }) {
  const where = sessionPaths({ configDir, file, to });
  if (!where) return false;
  const { id, src, dst } = where;
  try {
    if (!fs.existsSync(file)) return false;
    if (path.resolve(src).toLowerCase() === path.resolve(dst).toLowerCase()) return true;
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(file, path.join(dst, `${id}.jsonl`));
    if (fs.existsSync(path.join(src, id))) fs.cpSync(path.join(src, id), path.join(dst, id), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Where Claude Code keeps a conversation: under the folder it was in when it
 * was written, which may not be where its tab is now (it moved into a copy,
 * or the copy was brought home since). `prefer`: folders to look in first.
 * Otherwise the newest copy anywhere. -> path | null
 */
function findSession({ configDir, sessionId, prefer = [] }) {
  if (!SESSION_ID.test(sessionId || '')) return null;
  const projects = path.join(configDir, 'projects');
  for (const dir of prefer) {
    if (typeof dir !== 'string' || !dir) continue;
    const f = path.join(projects, projectDirName(dir), `${sessionId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  /** @type {{ f: string, at: number } | null} */
  let best = null;
  let names;
  try { names = fs.readdirSync(projects); } catch { return null; }
  for (const name of names) {
    const f = path.join(projects, name, `${sessionId}.jsonl`);
    try {
      const at = fs.statSync(f).mtimeMs;
      if (!best || at > best.at) best = { f, at };
    } catch { /* not in this one */ }
  }
  return best?.f || null;
}

module.exports = { projectDirName, carryTranscript, sessionPaths, copySession, findSession };
