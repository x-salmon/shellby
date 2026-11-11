// What the local model has done, for Settings: per job, how many drafts it
// wrote, how many Claude wrote after it, and roughly how many tokens of the
// plan that saved. Kept in config as `localModelTally`; pure, so main hands
// each try from withLocal() to add() and saves what comes back.

const CHARS_PER_TOKEN = 4; // a rough rule for English text and JSON
const JOB_NAME = /^[a-z]{1,20}$/;
const MAX_COUNT = 1e9;

/** @typedef {{ local: number, claude: number, tokens: number, ms: number }} JobTally */
/** @typedef {{ since: number, jobs: Record<string, JobTally> }} Tally */

const count = v => (Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), MAX_COUNT) : 0);

/**
 * A saved tally, checked (it's read from a file anyone could edit).
 * @param {unknown} raw
 * @param {number} [now]
 * @returns {Tally}
 */
function clean(raw, now = Date.now()) {
  const src = /** @type {any} */ (raw && typeof raw === 'object' ? raw : {});
  const since = Number.isSafeInteger(src.since) && src.since > 0 && src.since <= now ? src.since : now; // a date, not a count: no cap
  const jobs = /** @type {Record<string, JobTally>} */ ({});
  for (const [job, t] of Object.entries(src.jobs && typeof src.jobs === 'object' ? src.jobs : {})) {
    if (!JOB_NAME.test(job) || !t || typeof t !== 'object') continue;
    jobs[job] = { local: count(t.local), claude: count(t.claude), tokens: count(t.tokens), ms: count(t.ms) };
  }
  return { since, jobs };
}

/**
 * The tally with one try added. A local answer counts its tokens as saved;
 * a fallback counts as one Claude wrote.
 * @param {unknown} tally
 * @param {{ job: string, ok: boolean, ms?: number, chars?: number }} e
 * @param {number} [now]
 * @returns {Tally}
 */
function add(tally, e, now = Date.now()) {
  const t = clean(tally, now);
  const job = JOB_NAME.test(String(e?.job)) ? e.job : 'other';
  const was = t.jobs[job] || { local: 0, claude: 0, tokens: 0, ms: 0 };
  const next = e?.ok
    ? { ...was, local: was.local + 1, tokens: count(was.tokens + Math.ceil(count(e.chars) / CHARS_PER_TOKEN)), ms: count(was.ms + count(e.ms)) }
    : { ...was, claude: was.claude + 1 };
  return { since: t.since, jobs: { ...t.jobs, [job]: next } };
}

/**
 * Totals across jobs, for the line under the setting.
 * @param {unknown} tally
 */
function totals(tally) {
  const t = clean(tally);
  const all = Object.values(t.jobs);
  const local = all.reduce((n, j) => n + j.local, 0);
  const ms = all.reduce((n, j) => n + j.ms, 0);
  return {
    since: t.since,
    local,
    claude: all.reduce((n, j) => n + j.claude, 0),
    tokens: all.reduce((n, j) => n + j.tokens, 0),
    avgMs: local ? Math.round(ms / local) : 0,
  };
}

module.exports = { clean, add, totals, CHARS_PER_TOKEN };
