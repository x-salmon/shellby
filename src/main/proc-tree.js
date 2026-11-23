// Ending a process and everything it started, on Windows and on macOS.
// What has lost its parent isn't found this way: that's what process-job.js is for.
const { execFile, spawn } = require('child_process');
const { TASKKILL } = require('./system32');
const posix = require('./posix-job');

const KILL_TIMEOUT_MS = 10000;

/**
 * End `pid` and everything under it. Resolves once it's done, or couldn't be.
 * On macOS it's done before this returns, so it holds while Shellby quits.
 * detached: on Windows, don't wait, and don't let it be cut off by quitting.
 * @param {number | null | undefined} pid
 * @param {{ execFileImpl?: Function, spawnImpl?: Function, detached?: boolean, platform?: string, list?: typeof posix.listSync, kill?: (pid: number) => boolean }} [opts]
 * @returns {Promise<void>}
 */
function killTree(pid, { execFileImpl = execFile, spawnImpl = spawn, detached = false, platform = process.platform, list = posix.listSync, kill = posix.killPid } = {}) {
  return new Promise(resolve => {
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return resolve();
    try {
      if (platform !== 'win32') {
        for (const p of posix.treeOf(pid, list())) kill(p);
        return resolve();
      }
      const args = ['/PID', String(pid), '/T', '/F'];
      if (detached) {
        spawnImpl(TASKKILL, args, { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
        return resolve();
      }
      execFileImpl(TASKKILL, args, { windowsHide: true, timeout: KILL_TIMEOUT_MS }, () => resolve());
    } catch {
      resolve(); // gone already, or not ours to end
    }
  });
}

/**
 * Spawn options that put a child at the head of its own process group on macOS,
 * so what it starts can be found by group after it exits (posix-job.js). Nothing
 * on Windows, where `detached` would open a console.
 */
const OWN_GROUP = process.platform === 'win32' ? {} : { detached: true };

module.exports = { killTree, OWN_GROUP };
