// What a run is likely to cost before it starts: an Ultracode run (Claude
// Code's Workflow tool, many agents at once), one of Shellby's own workflows,
// or a turn that asks for several helpers. Drawn from Shellby's own history:
// the per-turn ledger (ledger.js) keeps each turn's share of the 5-hour
// window, an Ultracode run leaves a row of its own when it ends (kind
// 'ultracode'), and a workflow's Claude steps carry their run's id. The median
// of past runs of the same kind is the guess, the middle half its range, and
// with nothing to go by a rough default, said as one.
//
// Pure: callers pass `now` (test/usage-runcost.test.js).

const { KEEP_MS, pctOf, quantile } = require('./ledger');

const KINDS = ['ultracode', 'workflow', 'fanout'];
// With no runs to go by: a rough share of the 5-hour window, low to high.
const DEFAULTS = { ultracode: [15, 40], workflow: [2, 10], fanout: [5, 15] };
const RECENT = 20;         // the newest runs are the ones that count
const FEW = 3;             // fewer runs than this and the range is widened: too few to trust
const FEW_SLACK = 0.3;     // by this much either side
const FANOUT_HELPERS = 2;  // a turn that sent this many helpers or more fanned out

// A message that asks for several helpers at once. Only how it reads: Claude
// decides what it does, so this is a hint, never a block.
const COUNT = '(?:\\d+|two|three|four|five|six|seven|eight|nine|ten|several|multiple|many|a few|some|parallel)';
const CREW = '(?:sub-?agents?|agents|helpers|workers|crabs)';
const FANOUT_RE = new RegExp([
  `\\b${COUNT}\\s+${CREW}\\b`,
  `\\b${CREW}\\s+(?:in parallel|at once|at the same time|concurrently)\\b`,
  '\\bin parallel\\b',
  '\\bfan(?:s|ned)?[ -]?out\\b',
  '\\bparalleli[sz]e\\b',
  `\\b(?:spawn|launch|send out|start|use|run)\\s+(?:${COUNT}\\s+)?${CREW}\\b`,
].join('|'), 'i');

const num = v => (Number.isFinite(v) && v > 0 ? v : 0);
const round1 = n => Math.round(n * 10) / 10;

/** Does a message read like it will fan out to several helpers? */
const fanout = text => typeof text === 'string' && text.length > 0 && FANOUT_RE.test(text.slice(0, 4000));

/**
 * Past runs of one kind as a share of the 5-hour window each, oldest first.
 * rows: the per-turn ledger; key: the workflow's id for kind 'workflow';
 * ratio: ledger.js ratioOf, so rows with only a weight can be turned into percent.
 * @param {any[]} rows
 * @param {{ kind: string, key?: string | null, ratio?: number | null, now?: number }} q
 * @returns {number[]}
 */
function runsOf(rows, { kind, key = null, ratio = null, now = Date.now() }) {
  const fresh = (Array.isArray(rows) ? rows : []).filter(r => r && now - r.at < KEEP_MS);
  const pcts = list => list.map(r => pctOf(r, ratio)).filter(p => p !== null);
  if (kind === 'ultracode') return pcts(fresh.filter(r => r.kind === 'ultracode'));
  if (kind === 'fanout') return pcts(fresh.filter(r => r.kind === 'tab' && r.ok !== false && num(r.helpers) >= FANOUT_HELPERS));
  if (kind !== 'workflow') return [];
  // A workflow run is several turns (its Claude steps): their shares add up per run.
  const byRun = new Map();
  for (const r of fresh) {
    if (r.kind !== 'workflow' || !r.run || (key && r.wf !== key)) continue;
    const p = pctOf(r, ratio);
    const cur = byRun.get(r.run) || { pct: 0, at: r.at, known: false };
    byRun.set(r.run, { pct: cur.pct + (p ?? 0), at: Math.max(cur.at, r.at), known: cur.known || p !== null });
  }
  return [...byRun.values()].filter(x => x.known).sort((a, b) => a.at - b.at).map(x => x.pct);
}

/**
 * What a run like this usually costs: { kind, pct, low, high, samples, basis }
 * with pct the median share of the 5-hour window and low/high the middle half
 * (widened when there are only a couple of runs). basis is 'history' or, with
 * no runs to go by, 'default': the rough guess in DEFAULTS. Null for a kind
 * that isn't one.
 * @param {any[]} rows
 * @param {{ kind: string, key?: string | null, ratio?: number | null, now?: number }} q
 */
function estimateRun(rows, q) {
  if (!KINDS.includes(q?.kind)) return null;
  const runs = runsOf(rows, q).slice(-RECENT);
  if (!runs.length) {
    const [low, high] = DEFAULTS[q.kind];
    return { kind: q.kind, pct: (low + high) / 2, low, high, samples: 0, basis: 'default' };
  }
  const sorted = [...runs].sort((a, b) => a - b);
  const pct = quantile(sorted, 0.5);
  const few = sorted.length < FEW;
  const low = few ? sorted[0] * (1 - FEW_SLACK) : quantile(sorted, 0.25);
  const high = few ? sorted[sorted.length - 1] * (1 + FEW_SLACK) : quantile(sorted, 0.75);
  return { kind: q.kind, pct: round1(pct), low: round1(low), high: round1(high), samples: sorted.length, basis: 'history' };
}

/**
 * Where the window would stand after it. advice: ledger.js advise() for the
 * estimate ({ over, line, now, left, resetsAt }). -> { nowPct, endPct, endLow,
 * endHigh }, each null without a current reading.
 */
function ending(est, advice) {
  const now = Number.isFinite(advice?.now) ? advice.now : null;
  if (now === null || !est) return { nowPct: null, endPct: null, endLow: null, endHigh: null };
  const end = v => Math.round(now + v);
  return { nowPct: now, endPct: end(est.pct), endLow: end(est.low), endHigh: end(est.high) };
}

const pctWord = n => (n < 1 ? '<1%' : `${Math.round(n)}%`);
/** "about 15%" when the ends meet, else "12 to 18%". */
const rangeWord = (low, high) => (Math.round(low) === Math.round(high) ? `about ${pctWord(low)}` : `${pctWord(low).replace('%', '')} to ${pctWord(high)}`);
const runsWord = n => (n === 1 ? 'your 1 past run' : `your last ${n} runs`);

/** What the run is called in the sentence: "An Ultracode run", "“Nightly tidy”", "A turn with several helpers". */
function nameOf(kind, name) {
  if (kind === 'workflow') return name ? `“${name}”` : 'This workflow';
  return kind === 'ultracode' ? 'An Ultracode run' : 'A turn with several helpers';
}

/**
 * The estimate in words, for the banner before the run.
 * view: estimateRun's plus ending()'s, advice's over/line, and { name,
 * resetText (the reset as a clock time, or null), guardOn }.
 */
function words(view) {
  const who = nameOf(view.kind, view.name);
  const share = rangeWord(view.low, view.high);
  const lead = view.basis === 'history'
    ? `${who} usually takes ${share} of your 5-hour window (from ${runsWord(view.samples)}).`
    : `${who} hasn't run here yet; a rough guess is ${share} of your 5-hour window.`;
  const parts = [lead];
  if (Number.isFinite(view.endPct)) {
    const end = view.endLow === view.endHigh ? `near ${pctWord(view.endPct)}` : `near ${view.endLow} to ${pctWord(view.endHigh)}`;
    const reset = view.resetText ? `; it resets at ${view.resetText}` : '';
    parts.push(`You'd end ${end}${reset}.`);
  }
  if (view.over) {
    parts.push(view.guardOn && view.line < 100
      ? `That likely runs past the share you keep for yourself (${100 - view.line}%).`
      : 'That likely runs past your 5-hour limit before it finishes.');
  }
  return parts.join(' ');
}

/**
 * Everything the panel shows: the estimate, the ending, the verdict and the words.
 * @param {ReturnType<typeof estimateRun>} est
 * @param {{ over: boolean, line: number, now: number | null, left: number | null, resetsAt: number | null }} advice
 * @param {{ name?: string | null, resetText?: string | null, guardOn?: boolean }} [extra]
 */
function view(est, advice, { name = null, resetText = null, guardOn = false } = {}) {
  if (!est) return null;
  const v = {
    ...est, ...ending(est, advice),
    over: !!advice?.over, line: Number.isFinite(advice?.line) ? advice.line : 100, left: Number.isFinite(advice?.left) ? advice.left : null,
    resetsAt: Number.isFinite(advice?.resetsAt) ? advice.resetsAt : null, resetText, name, guardOn: !!guardOn,
  };
  return { ...v, text: words(v) };
}

module.exports = { fanout, runsOf, estimateRun, ending, words, view, nameOf, KINDS, DEFAULTS, RECENT, FEW, FEW_SLACK, FANOUT_HELPERS };
