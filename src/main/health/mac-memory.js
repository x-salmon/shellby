// A Mac's memory in use, the way Activity Monitor counts it: app memory
// (anonymous pages less purgeable ones) + wired + compressed. os.freemem()
// counts only pages nobody has touched, and macOS keeps spare memory full of
// cache it drops on demand, so on a Mac it reads 85-95% "used" nearly always.
const { execFile, spawnSync } = require('child_process');

const VM_STAT = '/usr/bin/vm_stat';
const VM_STAT_TIMEOUT_MS = 2000;

/** vm_stat's text -> bytes in use, or null when it can't be read. Pure. */
function usedFromVmStat(text) {
  const s = String(text || '');
  const pageSize = Number(/page size of (\d+) bytes/.exec(s)?.[1]);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
  /** @param {string} label */
  const pages = label => {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.?$`, 'm').exec(s);
    return m ? Number(m[1]) : null;
  };
  const anonymous = pages('Anonymous pages');
  const purgeable = pages('Pages purgeable') ?? 0;
  const wired = pages('Pages wired down');
  const compressed = pages('Pages occupied by compressor') ?? 0;
  if (anonymous == null || wired == null) return null;
  return (Math.max(0, anonymous - purgeable) + wired + compressed) * pageSize;
}

/**
 * A reader that never blocks after its first answer: each read returns the
 * last count and asks vm_stat again in the background.
 * @param {{ run?: typeof execFile, runSync?: typeof spawnSync }} [impl]
 */
function createMacMemory({ run = execFile, runSync = spawnSync } = {}) {
  /** @type {number | null} */
  let last = null;
  let asking = false;
  const refresh = () => {
    if (asking) return;
    asking = true;
    run(VM_STAT, [], { timeout: VM_STAT_TIMEOUT_MS }, (err, out) => {
      asking = false;
      const used = err ? null : usedFromVmStat(String(out));
      if (used != null) last = used;
    });
  };
  /** -> bytes in use, or null (then the caller falls back to os.freemem). */
  return function usedBytes() {
    if (last == null) {
      const r = runSync(VM_STAT, [], { encoding: 'utf8', timeout: VM_STAT_TIMEOUT_MS });
      last = usedFromVmStat(r.stdout);
    } else {
      refresh();
    }
    return last;
  };
}

module.exports = { usedFromVmStat, createMacMemory };
