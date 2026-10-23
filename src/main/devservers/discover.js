// Servers Shellby didn't start: a dev server running in a terminal, found by
// the port it listens on and matched to a project by the folder on its
// command line. Pure: the reader's JSON in, { pid, port, program, root,
// script } out (discover-io.js does the reading, test/devservers-discover.test.js
// runs this). See docs/plans/projects.md, "Discovery".
//
// Command lines are read, matched and dropped: nothing from them is kept but
// a script name that passed scripts.js's regex, and nothing from them is
// ever run.
const { SCRIPT_RE } = require('./scripts');

// Programs a dev server runs under. Anything else listening (a browser, a
// database, Windows itself) is never a dev server Shellby would show or stop.
const DEV_PROGRAMS = new Set(['node.exe', 'bun.exe', 'deno.exe', 'python.exe', 'python3.exe', 'dotnet.exe', 'php.exe', 'ruby.exe', 'java.exe']);
// Where a dev server answers: this PC only. A port open to the network is
// often a game or a service, not a project.
const LOCAL_ADDRESS = /^(?:0\.0\.0\.0|127\.0\.0\.1|::|::1|\[::\]|\[::1\])$/;
const MIN_PORT = 1024;
const MAX_FOUND = 20;
const MAX_ANCESTORS = 6;

const int = v => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
const asList = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
// Folders compared the way Windows sees them: case-insensitive, either slash.
const folderKey = p => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

/**
 * The reader's JSON ({ listen: [{ LocalAddress, LocalPort, OwningProcess }],
 * procs: [{ ProcessId, ParentProcessId, Name, CommandLine }] }) ->
 * { listeners: [{ pid, port, address }], procs: Map(pid -> { pid, parent, name, commandLine }) }.
 * Garbage in, nothing out.
 */
function parseListing(text) {
  let data;
  try { data = JSON.parse(String(text || '').trim() || '{}'); } catch { return { listeners: [], procs: new Map() }; }
  const listeners = [];
  for (const l of asList(data?.listen)) {
    const pid = int(l?.OwningProcess);
    const port = int(l?.LocalPort);
    if (!pid || !port || port > 65535) continue;
    listeners.push({ pid, port, address: String(l?.LocalAddress || '') });
  }
  const procs = new Map();
  for (const p of asList(data?.procs)) {
    const pid = int(p?.ProcessId);
    if (!pid) continue;
    procs.set(pid, {
      pid,
      parent: int(p?.ParentProcessId),
      name: String(p?.Name || '').toLowerCase(),
      commandLine: typeof p?.CommandLine === 'string' ? p.CommandLine.slice(0, 4000) : '',
    });
  }
  return { listeners, procs };
}

/** A process and its ancestors, nearest first, up to MAX_ANCESTORS (a loop or a missing parent ends it). */
function chainOf(procs, pid) {
  const out = [];
  const seen = new Set();
  for (let p = procs.get(pid); p && !seen.has(p.pid) && out.length <= MAX_ANCESTORS; p = procs.get(p.parent)) {
    seen.add(p.pid);
    out.push(p);
  }
  return out;
}

// "npm run dev", "npm-cli.js run-script dev", "pnpm dev", "yarn dev", "bun run dev":
// the script a package manager somewhere up the tree was asked for.
const RUN_SCRIPT = /\b(?:run|run-script)\s+(?:--\S+\s+)*([A-Za-z0-9:._-]{1,64})(?=\s|"|$)/;
const BARE_SCRIPT = /\b(?:pnpm|yarn|bun)(?:\.cmd|\.exe|\.js|\.cjs|\.mjs)?"?\s+(dev|start|serve|preview|watch)\b/i;

/** The script the server was started with, from its chain's command lines, or null. Only a name scripts.js would run. */
function scriptOf(chain) {
  for (const p of chain) {
    const m = RUN_SCRIPT.exec(p.commandLine) || BARE_SCRIPT.exec(p.commandLine);
    const name = m?.[1];
    if (name && SCRIPT_RE.test(name) && !/^(?:install|ci|test|build|lint)$/.test(name)) return name;
  }
  return null;
}

/** Which of `roots` a chain's command lines name (the deepest match wins), or null. roots: [{ root, key }] with key = folderKey(root). */
function rootOf(chain, roots) {
  let best = null;
  for (const p of chain) {
    const line = folderKey(p.commandLine);
    for (const r of roots) {
      if (line.includes(r.key) && (!best || r.key.length > best.key.length)) best = r;
    }
    if (best) return best;
  }
  return null;
}

/**
 * The servers running in your projects that Shellby didn't start.
 * listing: parseListing's answer. roots: [{ root, project }] (every listed
 * clone, realpath'd by the caller). ownPids: Shellby's own processes and the
 * cmd pids of the servers it runs, which, with anything under them, are left
 * out. -> [{ pid, port, program, script, root, project, ...the rest of the
 * root's entry }], one per process, its lowest port, at most MAX_FOUND.
 */
function found(listing, { roots = [], ownPids = new Set() } = {}) {
  const want = roots.filter(r => typeof r.root === 'string' && r.root.length > 3).map(r => ({ ...r, key: folderKey(r.root) }));
  if (!want.length) return [];
  const byPid = new Map();
  for (const l of listing.listeners) {
    if (l.port < MIN_PORT || !LOCAL_ADDRESS.test(l.address)) continue;
    const have = byPid.get(l.pid);
    if (have) { have.port = Math.min(have.port, l.port); continue; }
    const chain = chainOf(listing.procs, l.pid);
    const self = chain[0];
    if (!self || !DEV_PROGRAMS.has(self.name)) continue;
    if (chain.some(p => ownPids.has(p.pid))) continue;
    const r = rootOf(chain, want);
    if (!r) continue;
    const { key: _key, ...where } = r; // root, project, and whatever else the caller knows about the clone
    byPid.set(l.pid, { pid: l.pid, port: l.port, program: self.name.replace(/\.exe$/, ''), script: scriptOf(chain), ...where });
  }
  return [...byPid.values()].sort((a, b) => a.port - b.port || a.pid - b.pid).slice(0, MAX_FOUND);
}

module.exports = { parseListing, found, scriptOf, chainOf, folderKey, DEV_PROGRAMS, MAX_FOUND };
