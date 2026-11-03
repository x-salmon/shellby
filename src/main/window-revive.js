// A window's renderer dying used to leave a blank panel, or no crab, until a
// restart. Conversations live in the main process, so loading the page again
// brings everything back. A page that crashes as it loads would loop forever, so
// a window gets a few tries a minute, and then the user is told.
const MAX_REVIVES = 3;
const WINDOW_MS = 60_000;

/**
 * @param {{ onGaveUp: () => void, log: { warn: (what: string, detail?: unknown) => void }, now?: () => number }} d
 * @returns {(contents: any, details: { reason: string }) => boolean} whether it reloaded
 */
function makeRevive({ onGaveUp, log, now = Date.now }) {
  /** @type {WeakMap<object, number[]>} */
  const crashes = new WeakMap();

  return (contents, details) => {
    if (details.reason === 'clean-exit' || contents.isDestroyed()) return false;
    const at = now();
    const recent = (crashes.get(contents) || []).filter(t => at - t < WINDOW_MS);
    crashes.set(contents, [...recent, at]);
    if (recent.length >= MAX_REVIVES) {
      // Told once per run of crashes: the next tries stay refused until the minute clears.
      if (recent.length === MAX_REVIVES) onGaveUp();
      return false;
    }
    log.warn('reloading a window that died', details.reason);
    contents.reload();
    return true;
  };
}

module.exports = { makeRevive, MAX_REVIVES, WINDOW_MS };
