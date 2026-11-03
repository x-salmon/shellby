// The one door to the user's browser. shell.openExternal hands a URL to Windows,
// and the scheme decides what runs: file: and custom handlers can start programs.
// Plugin listings, server output and CLI replies all reach it, so nothing passes
// here but https pages, http on this PC (dev servers), and any scheme the caller
// names because it built the URL itself (editor links). eslint keeps it the only
// caller of shell.openExternal in src/main.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Whether a URL may be opened. @param {unknown} url @param {string[]} [schemes] extra schemes, like 'vscode:' */
function isSafeUrl(url, schemes = []) {
  if (typeof url !== 'string') return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.username || u.password) return false;
  if (u.protocol === 'https:' || schemes.includes(u.protocol)) return true;
  return u.protocol === 'http:' && LOOPBACK.has(u.hostname);
}

/**
 * An opener over any shell-like function, for tests.
 * @param {(url: string) => Promise<void>} open
 * @param {(what: string, detail?: unknown) => void} warn
 */
function makeOpenSafe(open, warn) {
  /** @param {unknown} url @param {{ schemes?: string[] }} [options] */
  return (url, { schemes } = {}) => {
    if (!isSafeUrl(url, schemes)) { warn('refused to open a link', String(url).slice(0, 200)); return false; }
    Promise.resolve(open(/** @type {string} */ (url))).catch(e => warn("couldn't open a link", e?.message));
    return true;
  };
}

/** @type {{ warn: (what: string, detail?: unknown) => void } | null} */
let logger = null;
/** Hands over the app's log, once it exists. @param {{ warn: (what: string, detail?: unknown) => void }} log */
const setOpenLog = log => { logger = log; };

/** Opens a link in the user's default handler. -> whether it was allowed. */
const openSafe = makeOpenSafe(
  url => require('electron').shell.openExternal(url),
  (what, detail) => logger?.warn(what, detail),
);

module.exports = { isSafeUrl, makeOpenSafe, openSafe, setOpenLog };
