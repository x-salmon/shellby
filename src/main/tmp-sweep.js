// Shellby's own leftovers in the temp folder, removed at launch. Each of these
// is deleted after use, but a crash or a killed run leaves it behind, and over
// months they pile up. Only names Shellby makes, and only old ones: a file a
// running copy (a second instance, a dev run) is using right now is minutes old.
const fs = require('fs');
const os = require('os');
const path = require('path');

const STALE_MS = 24 * 60 * 60 * 1000;
const LEFTOVERS = [
  /^shellby-index-[0-9a-f]{12}(\.lock)?$/,                                    // changes.js: a snapshot's git index
  /^shellby-no-hooks-[A-Za-z0-9]{6}$/,                                        // changes.js: a crashed run's
  /^shellby-mcp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/, // a session's MCP config
  /^shellby-pins-[A-Za-z0-9]{6}$/,                                            // depwatch
  /^shellby-pack-[A-Za-z0-9]{6}$/,                                            // packs
];

/**
 * @param {{ dir?: string, now?: number }} [opts]
 * @returns {Promise<number>} how many were removed
 */
async function sweepTmp({ dir = os.tmpdir(), now = Date.now() } = {}) {
  let names;
  try { names = await fs.promises.readdir(dir); } catch { return 0; }
  let removed = 0;
  for (const name of names.filter(n => LEFTOVERS.some(re => re.test(n)))) {
    const file = path.join(dir, name);
    try {
      const st = await fs.promises.lstat(file);
      if (now - st.mtimeMs < STALE_MS) continue;
      await fs.promises.rm(file, { recursive: true, force: true });
      removed++;
    } catch { /* in use or gone: next launch tries again */ }
  }
  return removed;
}

module.exports = { sweepTmp, LEFTOVERS, STALE_MS };
