// process-job.js's job on macOS (and Linux), which have no job objects.
//
// A job remembers every process seen under the one it adopted, by pid and start
// time, from a `ps` every few seconds while any job is open. So a server whose
// parent has since exited (uvx quits, its python lives on) is still known, and a
// pid someone else has now is never taken for it. A process is also the job's
// when its group is one a member leads, which catches what started since the
// last look in a process spawned at the head of its own group (OWN_GROUP).
//
// The rules are pure (parsePs, grow, treeOf); createJobs runs them.
const { execFile, spawnSync } = require('child_process');
const path = require('path');

const PS = '/bin/ps';
// lstart: to the second, and what tells a reused pid from the one we knew.
const PS_ARGS = ['-axo', 'pid=,ppid=,pgid=,lstart=,comm='];
/** @type {{ encoding: 'utf8', maxBuffer: number, timeout: number, env: NodeJS.ProcessEnv }} */
const PS_OPTS = { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 5000, env: { LC_ALL: 'C', TZ: 'UTC' } };
const POLL_MS = 3000;
const MAX_EVER = 5000;   // start times kept per job: plenty for any real task
const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/;

// Apps that are yours even when Claude was the first to open them (process-job.js KEEP).
const KEEP_APPS = new Set([
  'google chrome', 'microsoft edge', 'firefox', 'brave browser', 'opera', 'vivaldi', 'arc', 'safari',
  'finder', 'visual studio code', 'cursor', 'terminal', 'iterm', 'ghostty', 'warp',
]);

/** @typedef {{ pid: number, ppid: number, pgid: number, started: string, comm: string }} Row */
/** @typedef {{ handle: number }} Handle
 * What process-job.js hands around; the rest is this file's.
 */
/** @typedef {{ handle: number, seen: Map<number, string>, ever: Map<number, string>, names: Map<number, string>, outlives: boolean }} Job */

/** `ps` output -> Map pid -> Row. @returns {Map<number, Row>} */
function parsePs(text) {
  const rows = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = ROW.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    rows.set(pid, { pid, ppid: Number(m[2]), pgid: Number(m[3]), started: m[4].replace(/\s+/g, ' '), comm: m[5].trim() });
  }
  return rows;
}

/** The app bundle a program belongs to, in lower case ('' when none): /Applications/Arc.app/... -> arc. */
const appOf = comm => (/\/([^/]+)\.app\//i.exec(comm)?.[1] || '').toLowerCase();
const isYours = comm => KEEP_APPS.has(appOf(comm));

/**
 * The members of a job now. seen: pid -> start time, as of the last look; root:
 * the pid adopted. -> a new seen, holding what's still running. Never `self`.
 * ever: every member's start time since the job began, dead ones too (seen is
 * only the living), so a number someone else has now is never taken for ours.
 * @param {Map<number, string>} seen @param {number} root @param {Map<number, Row>} rows @param {number} [self]
 * @param {Map<number, string>} [ever]
 * @returns {Map<number, string>}
 */
function grow(seen, root, rows, self = process.pid, ever = seen) {
  const out = new Map();
  // A group outlives its leader, and its number isn't given out while it does.
  const groups = new Set([root, ...seen.keys()]);
  groups.delete(self);
  for (const [pid, started] of seen) if (rows.get(pid)?.started === started) out.set(pid, started);
  const top = rows.get(root);
  if (top && !ever.has(root) && !seen.has(root) && root !== self) out.set(root, top.started); // the first look
  // Someone else's process at a number one of ours had: not ours, and nor is its group.
  const reusedAt = pid => { const r = rows.get(pid); const known = ever.get(pid) ?? seen.get(pid); return !!r && known !== undefined && known !== r.started; };
  for (let added = true; added;) {
    added = false;
    for (const r of rows.values()) {
      if (out.has(r.pid) || r.pid === self || r.pid <= 1) continue;
      const child = out.has(r.ppid);
      if (!child && (reusedAt(r.pid) || reusedAt(r.pgid) || !groups.has(r.pgid))) continue;
      out.set(r.pid, r.started);
      groups.add(r.pid);
      added = true;
    }
  }
  return out;
}

/** `pid` and every process under it, parents first. @param {number} pid @param {Map<number, Row>} rows @param {number} [self] @returns {number[]} */
function treeOf(pid, rows, self = process.pid) {
  /** @type {Set<number>} */
  const out = new Set();
  const walk = p => {
    if (out.has(p) || p === self || p <= 1) return;
    out.add(p);
    for (const r of rows.values()) if (r.ppid === p) walk(r.pid);
  };
  walk(pid);
  return [...out];
}

/** What's running, waiting for the answer. Empty when ps can't say. */
function listSync() {
  return parsePs(spawnSync(PS, PS_ARGS, PS_OPTS).stdout);
}

/** The same without waiting. @param {(rows: Map<number, Row>) => void} cb */
function listAsync(cb) {
  execFile(PS, PS_ARGS, PS_OPTS, (_err, stdout) => cb(parsePs(stdout)));
}

/** @param {number} pid */
function killPid(pid) {
  try { process.kill(pid, 'SIGKILL'); return true; } catch { return false; } // gone already
}

/**
 * process-job.js's functions over those rules.
 * @param {{ list?: typeof listSync, listLater?: typeof listAsync, kill?: (pid: number) => boolean, pollMs?: number, self?: number }} [impl]
 */
function createJobs({ list = listSync, listLater = listAsync, kill = killPid, pollMs = POLL_MS, self = process.pid } = {}) {
  /** @type {Set<Job>} */
  const open = new Set();
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  let looking = false;

  function look() {
    if (looking) return;
    looking = true;
    listLater(rows => {
      looking = false;
      if (!rows.size) return; // ps failed: what was known stands
      for (const job of open) {
        job.seen = grow(job.seen, job.handle, rows, self, job.ever);
        // The living and the root always (its number is always one of the job's groups); other dead ones up to MAX_EVER.
        for (const [pid, started] of job.seen) job.ever.set(pid, started);
        if (job.ever.size > MAX_EVER) for (const pid of job.ever.keys()) { if (job.ever.size <= MAX_EVER) break; if (!job.seen.has(pid) && pid !== job.handle) job.ever.delete(pid); }
        job.names = new Map([...job.seen.keys()].map(pid => [pid, path.posix.basename(rows.get(pid)?.comm || '')]));
      }
    });
  }

  function watch() {
    if (open.size && !timer) {
      timer = setInterval(look, pollMs);
      timer.unref?.();
    } else if (!open.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** @param {number | undefined} pid @param {{ outlives?: boolean }} [opts] @returns {Job | null} */
  function adopt(pid, { outlives = false } = {}) {
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1 || pid === self) return null;
    const job = { handle: pid, seen: new Map(), ever: new Map(), names: new Map(), outlives };
    open.add(job);
    watch();
    look();
    return job;
  }

  /** @param {Job | null | undefined} job @param {Map<number, Row>} [rows] */
  function sweep(job, rows) {
    if (!job?.handle) return null;
    const now = rows || list();
    /** @type {string[]} */ const ended = [];
    /** @type {string[]} */ const kept = [];
    for (const pid of grow(job.seen, job.handle, now, self, job.ever).keys()) {
      const comm = now.get(pid)?.comm || '';
      const name = path.posix.basename(comm) || String(pid);
      if (isYours(comm)) kept.push(name);
      else if (kill(pid)) ended.push(name);
    }
    job.handle = 0;
    open.delete(job);
    watch();
    return { ended, kept };
  }

  function sweepAll() {
    const jobs = [...open].filter(j => !j.outlives);
    if (!jobs.length) return [];
    const rows = list();
    return jobs.flatMap(j => sweep(j, rows)?.ended || []);
  }

  /** @param {Job | null | undefined} job @returns {number[]} */
  const members = job => (job?.handle ? [...job.seen.keys()] : []);
  const namedMembers = job => members(job).map(pid => ({ pid, name: job.names.get(pid) || '' }));
  const ownedPids = () => new Set([...open].filter(j => !j.outlives).flatMap(members));

  return { adopt, sweep, sweepAll, members, namedMembers, ownedPids };
}

module.exports = { parsePs, grow, treeOf, appOf, isYours, createJobs, listSync, listAsync, killPid, KEEP_APPS };
