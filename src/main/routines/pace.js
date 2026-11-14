// Pacing routines around the 5-hour limit. A routine due while the window is
// nearly full would run into the limit partway (and fail, or be stopped at the
// spending guard's ceiling): it waits for the reset instead, and runs then,
// once. Three things say "nearly full": the share you keep for yourself
// (guard.js), a fixed line close to the top, and the forecast (forecast.js)
// saying the window fills before a run could finish. "Run even near the limit"
// on the routine skips all three; the limit itself still holds it.
//
// Pure: callers pass `now` (test/routine-pace.test.js).
const guard = require('../guard');

const NEAR_LIMIT_PCT = 85;          // from here on, a run waits for the reset
const MIN = 60 * 1000;
const RUN_MS = 30 * MIN;            // how long a run is taken to need when the caller doesn't say
const SAME_RESET_MS = 10 * MIN;     // a forecast about a reset this close is about this window

/**
 * @typedef {{ reason: 'reserve' | 'near' | 'pace', pct: number, until: number, reserve?: number, hitAt?: number }} Hold
 */

/**
 * Should a routine due now wait for the reset? Null to run now, else why it
 * waits and until when (the window's reset).
 * @param {{ runNearLimit?: boolean } | null | undefined} routine
 * @param {{ usage: any, outlook?: { pct: number, hitAt: number, resetsAt: number } | null, settings?: { on: boolean, reserve: number } | null, now: number, runMs?: number }} ctx
 *   usage: the last reading ({ fiveHour: { pct, resetsAt } }); outlook: forecast.outlook(), or null;
 *   settings: guard.settingsOf(); runMs: how long this run is expected to take.
 * @returns {Hold | null}
 */
function waitFor(routine, { usage, outlook = null, settings = null, now, runMs = RUN_MS }) {
  if (routine?.runNearLimit === true) return null;
  const w = usage?.fiveHour;
  if (!w || !Number.isFinite(w.pct) || !Number.isFinite(w.resetsAt) || w.resetsAt <= now) return null;
  const until = w.resetsAt;
  if (settings && guard.holdBeforeStart(settings, usage, now)) return { reason: 'reserve', pct: w.pct, until, reserve: settings.reserve };
  if (w.pct >= NEAR_LIMIT_PCT) return { reason: 'near', pct: w.pct, until };
  // The forecast is about this same window, and says it fills before this run could end.
  const sameWindow = !!outlook && Number.isFinite(outlook.hitAt) && Math.abs(outlook.resetsAt - until) < SAME_RESET_MS;
  if (sameWindow && outlook.hitAt - now <= runMs) return { reason: 'pace', pct: outlook.pct, until, hitAt: outlook.hitAt };
  return null;
}

/**
 * Why it waits, for the notification. clock(t) -> "3:40 PM".
 * @param {Hold} hold @param {(t: number) => string} clock
 */
function message(hold, clock) {
  if (hold.reason === 'reserve') return `Your 5-hour window is at ${hold.pct}%, and you asked to keep ${hold.reserve}% for yourself.`;
  if (hold.reason === 'near') return `Your 5-hour window is at ${hold.pct}%, close to the limit.`;
  return `At this pace your 5-hour window fills around ${clock(hold.hitAt ?? hold.until)}, before a run could finish.`;
}

/**
 * His line about it, for the bubble.
 * @param {string} name @param {Hold} hold @param {string} atText when it runs
 */
function line(name, hold, atText) {
  const why = hold.reason === 'pace' ? 'we\'d run dry partway' : `we're at ${hold.pct}%`;
  return `"${name}" waits for the reset at ${atText}: ${why}.`;
}

module.exports = { waitFor, message, line, NEAR_LIMIT_PCT, RUN_MS };
