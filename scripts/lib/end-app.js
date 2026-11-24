// Ending an app a check launched, and everything it started, before the check
// exits. Synchronous, so a `process.exit` right after doesn't cut it short.
// taskkill on Windows; on macOS the same process-tree walk Shellby uses itself.
const { spawnSync } = require('child_process');
const posix = require('../../src/main/posix-job');

const KILL_TIMEOUT_MS = 10000;

/** End `pid` and its tree. Never throws: what's gone is gone. @param {number | undefined} pid */
function endApp(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: KILL_TIMEOUT_MS });
      return;
    }
    for (const p of posix.treeOf(pid, posix.listSync())) posix.killPid(p);
  } catch { /* gone already */ }
}

module.exports = { endApp };
