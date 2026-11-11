// The models the installed Claude Code knows, read straight out of its program
// file. Claude Code updates itself, so a model released after this Shellby was
// built shows up in the picker without a Shellby release. The file is a few
// hundred MB, so it's streamed, and the answer is kept against its size and
// date: it's read again only when Claude Code changes.
const fs = require('fs');

// A quoted model id: "claude-opus-5-5", "claude-fable-5", "claude-sonnet-4-5-20250929".
const ID = /"(claude-[a-z]+-\d[a-z0-9-]*)"/g;
// The longest id worth matching, so one split across two chunks is still seen.
const OVERLAP = 64;

/**
 * Every quoted claude-* id in the file, deduplicated.
 * @param {string} exe
 * @returns {Promise<string[]>}
 */
function readIds(exe) {
  return new Promise((resolve, reject) => {
    const found = new Set();
    let tail = '';
    fs.createReadStream(exe, { encoding: 'latin1', highWaterMark: 4 * 1024 * 1024 })
      .on('data', chunk => {
        const text = tail + chunk;
        for (const m of text.matchAll(ID)) found.add(m[1]);
        tail = text.slice(-OVERLAP);
      })
      .on('error', reject)
      .on('end', () => resolve([...found]));
  });
}

/**
 * The ids in `exe`, from `cache` when the file hasn't changed since.
 * @param {string | null} exe
 * @param {{ exe: string, size: number, mtimeMs: number, ids: string[] } | null} cache
 * @returns {Promise<{ exe: string, size: number, mtimeMs: number, ids: string[] } | null>} null: no CLI
 */
async function scanModels(exe, cache = null, { read = readIds, stat = fs.promises.stat } = {}) {
  if (typeof exe !== 'string' || !exe) return null;
  const { size, mtimeMs } = await stat(exe);
  if (cache && cache.exe === exe && cache.size === size && cache.mtimeMs === mtimeMs && Array.isArray(cache.ids)) return cache;
  return { exe, size, mtimeMs, ids: await read(exe) };
}

module.exports = { scanModels, readIds };
