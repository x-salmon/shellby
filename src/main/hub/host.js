// What a PC says about itself for the hub's roster (docs/HUB.md): which
// Windows, which Shellby, its memory and the system drive's free space, and
// which agents it can run. Read cheaply from the OS, not from Health (which may
// be off): it rides along in the view every PC already serves to phones
// (pocket/view.js phoneHost), so the hub needs no server of its own.
//
// describeOs and hostFacts are pure; readHost takes os and fs injected.
// test/hub-host.test.js.
const path = require('path');

const AGENT_IDS = ['claude', 'gemini', 'opencode', 'codex'];
const GB = 1024 ** 3;

/** "Windows 11" from os.release() (10.0.22631: build 22000 and up is 11), else the platform's own name. */
function describeOs(platform, release) {
  if (platform === 'win32') {
    const build = Number(String(release || '').split('.')[2]);
    return Number.isFinite(build) && build >= 22000 ? 'Windows 11' : 'Windows 10';
  }
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return String(platform || 'Unknown').slice(0, 20);
}

const gb = bytes => (Number.isFinite(bytes) && bytes >= 0 ? Math.round((bytes / GB) * 10) / 10 : null);

/**
 * The facts, cleaned: every number a number or null, agents from the known list only.
 * @param {{ platform?: string, release?: string, version?: string, totalmem?: number, freemem?: number, diskFree?: number | null, agents?: string[] }} raw
 */
function hostFacts(raw = {}) {
  const total = gb(raw.totalmem);
  const free = gb(raw.freemem);
  return {
    os: describeOs(raw.platform, raw.release),
    version: /^\d+\.\d+\.\d+$/.test(String(raw.version || '')) ? raw.version : null,
    ram: total ? { usedGb: free == null ? null : Math.max(0, Math.round((total - free) * 10) / 10), totalGb: total } : null,
    diskFreeGb: gb(raw.diskFree),
    // A list of ids, never a string: 'claude'.includes('claude') would let one through.
    agents: Array.isArray(raw.agents) ? AGENT_IDS.filter(id => /** @type {string[]} */ (raw.agents).includes(id)) : [],
  };
}

/**
 * This PC's facts, now. agents(): the ids installed here (Claude Code's own
 * status, harness/registry.js for the rest).
 * @param {{ os: typeof import('os'), fs: typeof import('fs'), version: string, agents: () => string[], env?: Record<string, string | undefined> }} o
 */
function readHost({ os, fs, version, agents, env = process.env }) {
  /** @type {number | null} */
  let diskFree = null;
  try {
    const drive = os.platform() === 'win32' ? `${(env.SystemDrive || 'C:').replace(/[\\/]+$/, '')}${path.win32.sep}` : '/';
    const s = fs.statfsSync(drive);
    diskFree = s.bavail * s.bsize;
  } catch { /* an unusual setup: the roster shows no figure */ }
  return hostFacts({ platform: os.platform(), release: os.release(), version, totalmem: os.totalmem(), freemem: os.freemem(), diskFree, agents: agents() });
}

const HOST_EVERY_MS = 60 * 1000; // the facts barely change: read again at most once a minute

/**
 * This PC's facts, read at most once a minute: for the view it serves its
 * phones and the hub (wiring/pocket.js). claudeInstalled(): Claude Code's own
 * status; the other agents are found by harness/registry.js.
 * @param {{ claudeInstalled: () => boolean, now?: () => number }} o
 */
function hostReader({ claudeInstalled, now = Date.now }) {
  /** @type {{ at: number, facts: ReturnType<typeof hostFacts> } | null} */
  let cache = null;
  return () => {
    const t = now();
    if (cache && t - cache.at < HOST_EVERY_MS) return cache.facts;
    const { listHarnesses } = require('../harness/registry');
    const facts = readHost({
      os: require('os'), fs: require('fs'), version: require('electron').app.getVersion?.() || '',
      agents: () => [...(claudeInstalled() ? ['claude'] : []), ...listHarnesses().filter(h => h.installed).map(h => h.id)],
    });
    cache = { at: t, facts };
    return facts;
  };
}

module.exports = { AGENT_IDS, describeOs, hostFacts, readHost, hostReader };
