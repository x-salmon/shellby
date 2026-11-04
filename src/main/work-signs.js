// What he shows without saying a word: the state of the work that needs you.
// In Work mode he keeps quiet (workmode.js), so these are how he tells you a
// helper has been out a long while, tests went red in one of your
// conversations, or the 5-hour window is heading for empty. He holds up a sign
// for the most urgent (src/renderer/critter/signs.js), as he already does for
// red CI and a crashed dev server; asking and the limit itself have their own
// moods. Pure: no I/O. See test/work-signs.test.js.

// A helper out longer than this is worth a look: most finish in a few minutes.
const STUCK_MS = 15 * 60 * 1000;

const count = n => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * The signals right now.
 *   crew: running helpers, each with startedAt (sessions.js aggregate)
 *   red: how many conversations' tests are red
 *   outlook: usage/service.js outlookView().pace, or null
 * -> { stuck, red, near, recheckIn }: near is the window's % used when the
 * forecast warns, else null; recheckIn is how long until the next helper
 * passes STUCK_MS (null when none will), so main can look again then.
 * @param {{ crew?: any[], red?: number, outlook?: { pct?: number, warn?: boolean } | null }} [input]
 * @param {number} [now]
 */
function signalsOf({ crew = [], red = 0, outlook = null } = {}, now = 0) {
  let stuck = 0;
  /** @type {number | null} */
  let soonest = null;
  for (const c of Array.isArray(crew) ? crew : []) {
    const at = Number(c?.startedAt);
    if (!Number.isFinite(at) || at <= 0) continue;
    const left = at + STUCK_MS - now;
    if (left <= 0) stuck++;
    else if (soonest == null || left < soonest) soonest = left;
  }
  const pct = Number(outlook?.pct);
  const near = outlook?.warn && Number.isFinite(pct) ? Math.max(0, Math.min(100, Math.round(pct))) : null;
  return { stuck, red: count(red), near, recheckIn: soonest };
}

/** Whether there's anything to show. */
const anySignal = s => !!s && (s.stuck > 0 || s.red > 0 || s.near != null);

module.exports = { signalsOf, anySignal, STUCK_MS };
