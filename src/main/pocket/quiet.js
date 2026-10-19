// Shellby on your phone: quiet hours (docs/PHONE.md).
//
// A schedule in this PC's local time, set from the phone's Phone screen or
// from Settings → On your phone, during which the push notifications are held
// back as Guard my focus holds them: a permission prompt still arrives, but
// quietly, so the app icon's badge counts it; the rest doesn't come. The
// window may cross midnight (22:00 to 07:00).
//
// Pure: wiring/pocket.js keeps the schedule in the config, and pocket/notices.js
// asks inQuietHours before each push.
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const QUIET_DEFAULTS = { enabled: false, from: '22:00', to: '07:00' };

/** "22:00" -> minutes since midnight, or null for anything else. */
function minutesOf(hhmm) {
  const m = TIME_RE.exec(String(hhmm ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The schedule from settings.json, with anything malformed back at the defaults. */
function normalizeQuiet(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const from = minutesOf(r.from) != null ? r.from : QUIET_DEFAULTS.from;
  const to = minutesOf(r.to) != null ? r.to : QUIET_DEFAULTS.to;
  return { enabled: r.enabled === true && from !== to, from, to };
}

/**
 * What Settings or the phone sent, checked at the door: -> { quiet } or { error }.
 * Each field is optional; the rest comes from `current`.
 */
function checkQuiet(patch, current = QUIET_DEFAULTS) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const base = normalizeQuiet(current);
  const next = { enabled: 'enabled' in p ? p.enabled === true : base.enabled, from: 'from' in p ? p.from : base.from, to: 'to' in p ? p.to : base.to };
  if (minutesOf(next.from) == null || minutesOf(next.to) == null) return { error: 'Times are hours and minutes, like 22:00.' };
  if (next.from === next.to) return { error: 'Pick two different times.' };
  return { quiet: next };
}

/** Whether `now` (a timestamp, read in local time) falls in the window. */
function inQuietHours(quiet, now = Date.now()) {
  const q = normalizeQuiet(quiet);
  if (!q.enabled) return false;
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes();
  const from = minutesOf(q.from) ?? 0, to = minutesOf(q.to) ?? 0; // normalized: both are times
  // Crossing midnight: from the evening to the end of the day, and from the start of the day to the morning.
  return from < to ? m >= from && m < to : m >= from || m < to;
}

module.exports = { QUIET_DEFAULTS, TIME_RE, checkQuiet, inQuietHours, minutesOf, normalizeQuiet };
