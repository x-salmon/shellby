// Claude Code's own telemetry: with CLAUDE_CODE_ENABLE_TELEMETRY on, it sends
// OpenTelemetry metrics over OTLP, and Shellby can be the place they go. They
// say what no stream event does: lines Claude added and removed, edits you
// accepted or turned down, commits and pull requests it made, its own reckoning
// of what a session cost, and how long you and it were each busy.
//
// Only metrics, never logs (those can carry prompts), and only to Shellby on
// this PC. Someone who set up telemetry of their own keeps it: their settings
// or environment name an OTEL_ variable, and Shellby stays out.
//
// Pure: no Electron, no I/O, callers pass `now` (test/telemetry.test.js).
// telemetry-service.js receives them and keeps the ledger.

const KEEP_DAYS = 21;               // this week, last week and a spare, like the cache ledger
const EXPORT_INTERVAL_MS = 15000;   // Claude Code's default is a minute; a short turn should still show
const MAX_POINTS = 2000;            // data points read from one request
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// The metrics Shellby keeps, and the field each one adds to.
const FIELDS = ['added', 'removed', 'accepted', 'rejected', 'commits', 'prs', 'sessions', 'cost', 'userSecs', 'cliSecs'];
// The most one data point can add: an export covers EXPORT_INTERVAL_MS of one process.
const MAX_POINT = { added: 1e6, removed: 1e6, accepted: 1e4, rejected: 1e4, commits: 1e3, prs: 1e3, sessions: 1e3, cost: 1e4, userSecs: 1e5, cliSecs: 1e5 };

const num = v => (Number.isFinite(v) && v > 0 ? v : 0);
const dayKey = t => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysBack = (now, n) => { const d = new Date(now); return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n).getTime()); };

/** OTLP JSON attributes ([{ key, value: { stringValue | intValue | ... } }]) -> { key: value }. */
// Object.fromEntries defines each key as its own, so a "__proto__" from the
// wire is just another key rather than swapping the object's prototype.
function attrsOf(list) {
  return Object.fromEntries((Array.isArray(list) ? list : [])
    .filter(a => typeof a?.key === 'string' && a.value && typeof a.value === 'object')
    .map(({ key, value: v }) => [key, v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? null]));
}

// OTLP JSON writes 64-bit integers as strings.
function pointValue(p) {
  const v = p?.asDouble ?? p?.asInt;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * The data points in one OTLP/HTTP JSON metrics request: [{ name, value, attrs }].
 * Only sums are read: every metric Claude Code sends is a counter.
 */
function pointsFrom(body) {
  const out = [];
  for (const rm of Array.isArray(body?.resourceMetrics) ? body.resourceMetrics : []) {
    for (const sm of Array.isArray(rm?.scopeMetrics) ? rm.scopeMetrics : []) {
      for (const m of Array.isArray(sm?.metrics) ? sm.metrics : []) {
        if (typeof m?.name !== 'string' || !Array.isArray(m.sum?.dataPoints)) continue;
        for (const p of m.sum.dataPoints) {
          if (out.length >= MAX_POINTS) return out;
          const value = pointValue(p);
          if (value !== null) out.push({ name: m.name, value, attrs: attrsOf(p.attributes) });
        }
      }
    }
  }
  return out;
}

/** The ledger field a data point adds to, or null for one Shellby doesn't keep. */
function fieldOf({ name, attrs }) {
  switch (name) {
    case 'claude_code.lines_of_code.count': return attrs.type === 'added' ? 'added' : attrs.type === 'removed' ? 'removed' : null;
    case 'claude_code.code_edit_tool.decision': return attrs.decision === 'accept' ? 'accepted' : attrs.decision === 'reject' ? 'rejected' : null;
    case 'claude_code.commit.count': return 'commits';
    case 'claude_code.pull_request.count': return 'prs';
    case 'claude_code.session.count': return 'sessions';
    case 'claude_code.cost.usage': return 'cost';
    case 'claude_code.active_time.total': return attrs.type === 'user' ? 'userSecs' : attrs.type === 'cli' ? 'cliSecs' : null;
    default: return null;
  }
}

const emptyDay = () => Object.fromEntries(FIELDS.map(f => [f, 0]));

/** Tolerate anything read from disk: { 'YYYY-MM-DD': { added, removed, ... } }, the last few weeks. */
function normalizeDays(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of Object.keys(src).filter(k => DAY_RE.test(k)).sort().slice(-KEEP_DAYS)) {
    const day = Object.fromEntries(FIELDS.map(f => [f, num(src[k]?.[f])]));
    if (FIELDS.some(f => day[f])) out[k] = day;
  }
  return out;
}

/**
 * Add a request's points to today. Points are deltas: Shellby asks for delta
 * temporality (telemetryEnv), so each one is what happened since the last
 * export. Returns a new ledger (the same one when nothing counted).
 */
function recordPoints(days, points, now) {
  const add = emptyDay();
  let any = false;
  for (const p of Array.isArray(points) ? points : []) {
    const f = fieldOf(p);
    // More than any real export holds is someone else's number: left out.
    if (f && num(p.value) && p.value <= MAX_POINT[f]) { add[f] += p.value; any = true; }
  }
  if (!any) return days;
  const k = dayKey(now);
  const d = days[k] || emptyDay();
  const next = { ...days, [k]: Object.fromEntries(FIELDS.map(f => [f, (d[f] || 0) + add[f]])) };
  const keys = Object.keys(next).sort();
  return keys.length > KEEP_DAYS ? Object.fromEntries(keys.slice(-KEEP_DAYS).map(x => [x, next[x]])) : next;
}

function sumDays(days, keys) {
  const s = emptyDay();
  for (const k of keys) for (const f of FIELDS) s[f] += days[k]?.[f] || 0;
  const decided = s.accepted + s.rejected;
  return { ...s, cost: Math.round(s.cost * 100) / 100, acceptRate: decided ? s.accepted / decided : null };
}

/** The last seven days and the seven before, for the Lean tab. null before anything arrived. */
function telemetrySummary(days, now) {
  if (!Object.keys(days || {}).length) return null;
  const span = (from, n) => Array.from({ length: n }, (_, i) => daysBack(now, from + i));
  return { week: sumDays(days, span(0, 7)), lastWeek: sumDays(days, span(7, 7)) };
}

/** True when the user set up telemetry of their own, in the environment or Claude Code's settings. */
function ownTelemetry(...envs) {
  return envs.some(env => env && typeof env === 'object'
    && Object.keys(env).some(k => /^OTEL_/i.test(k) || /^CLAUDE_CODE_ENABLE_TELEMETRY$/i.test(k)));
}

/** What a Claude Code process needs to send its metrics to Shellby at `port`. */
function telemetryEnv({ port, token }) {
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    OTEL_METRICS_EXPORTER: 'otlp',
    OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'http/json',
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `http://127.0.0.1:${port}/v1/metrics`,
    OTEL_EXPORTER_OTLP_METRICS_HEADERS: `authorization=Bearer ${token}`,
    OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta',
    OTEL_METRIC_EXPORT_INTERVAL: String(EXPORT_INTERVAL_MS),
  };
}

module.exports = { pointsFrom, fieldOf, normalizeDays, recordPoints, telemetrySummary, ownTelemetry, telemetryEnv, FIELDS };
