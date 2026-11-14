// The usage meter's words (tab-meters.js draws them): beside the 5-hour and
// weekly bars, how long until the one nearer its limit resets, or, when the
// forecast warns (src/main/forecast.js), how long until the 5-hour one fills.
// Pure, no DOM. Works in the browser and in Node (for tests).
(function (root) {
  const MIN = 60e3;
  const HOUR_MINS = 60;
  const DAY_MINS = 24 * HOUR_MINS;

  // "42m", "2h 05m", "3d 4h": the days make a weekly reset plain without naming it.
  // Whole minutes down, so it never says "60m" or runs ahead of the real time.
  function duration(ms) {
    const mins = Math.max(1, Math.floor(ms / MIN));
    if (mins < HOUR_MINS) return `${mins}m`;
    if (mins < DAY_MINS) return `${Math.floor(mins / HOUR_MINS)}h ${String(mins % HOUR_MINS).padStart(2, '0')}m`;
    return `${Math.floor(mins / DAY_MINS)}d ${Math.floor((mins % DAY_MINS) / HOUR_MINS)}h`;
  }

  // -> { kind: 'full' | 'reset', window, text } or null when there's nothing ahead to time.
  function usageWhen(u, pace, now) {
    if (pace?.warn && Number.isFinite(pace.hitAt) && pace.hitAt > now) {
      return { kind: 'full', window: 'fiveHour', text: `full in ${duration(pace.hitAt - now)}` };
    }
    const ahead = ['fiveHour', 'sevenDay']
      .filter(k => Number.isFinite(u?.[k]?.pct) && Number.isFinite(u[k].resetsAt) && u[k].resetsAt > now);
    if (!ahead.length) return null;
    const window = ahead.reduce((a, b) => (u[b].pct > u[a].pct ? b : a));
    return { kind: 'reset', window, text: `resets in ${duration(u[window].resetsAt - now)}` };
  }

  const api = { duration, usageWhen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbyMeterLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
