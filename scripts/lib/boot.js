// When the app is ready to be driven, for the e2e scripts. They used to sleep a
// fixed 3 s after connecting, but the panel only boots once main answers its
// bootstrap (src/renderer/panel/boot.js), and on a busy PC (the whole suite at
// once, or a game) that takes well past 3 s: the first steps then ran against a
// panel with no settings, no tab and no folder. These wait for the real signal.

// boot.js sets this as it opens the first tab and picks the view to show.
const PANEL_BOOTED = 'window.SB?.starting === false';
// critter.js marks his first frame on screen.
const CRAB_PAINTED = "performance.getEntriesByName('shellby:crab-painted').length > 0";
const BOOT_TIMEOUT_MS = 30000;
const POLL_MS = 200;

const wait = ms => new Promise(r => setTimeout(r, ms));

/** Poll `ev(expr)` (the script's own Runtime.evaluate) until it's truthy. Throws `failure` after `ms`. */
async function ready(ev, expr, failure, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await Promise.resolve(ev(expr)).catch(() => false)) return;
    await wait(POLL_MS);
  }
  throw new Error(`${failure} in ${ms / 1000} s`);
}

/** Resolves once the panel has booted: settings in, first tab open, view chosen. */
const panelBooted = (ev, ms = BOOT_TIMEOUT_MS) => ready(ev, PANEL_BOOTED, 'the panel never finished booting', ms);

/** Resolves once the crab has painted his first frame. */
const crabPainted = (ev, ms = BOOT_TIMEOUT_MS) => ready(ev, CRAB_PAINTED, 'the crab never painted', ms);

module.exports = { panelBooted, crabPainted, PANEL_BOOTED, CRAB_PAINTED };
