// A temp folder of a run's own. Tests and e2e checks make thousands of
// shellby-* folders and files, and not every one cleans up after itself (a
// crash, a timeout, a spawned app that writes its own). Pointing TEMP, TMP and
// TMPDIR at one folder per run, removed when the run ends, leaves nothing in
// the user's temp folder whatever the run did.
const fs = require('fs');
const os = require('os');
const path = require('path');

/** @param {string} prefix */
function scratchTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    env: { TEMP: dir, TMP: dir, TMPDIR: dir },
    // Retries: an Electron that just exited can hold a file for a moment.
    remove() {
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { console.warn(`Couldn't remove ${dir}: ${e.message}`); }
    },
  };
}

module.exports = { scratchTmp };
