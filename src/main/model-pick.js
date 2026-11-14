// A cheaper model for a small message, asked first. When what you sent looks
// small (a question, a lookup, a rename: effort-pick.js's own sizing), the
// panel shows a card before Claude starts: what the message usually takes of
// your 5-hour window on the tab's model and on Haiku, with the choice. Nothing
// here switches a model; it only says whether to ask and what to say. "Always
// for questions like this" is kept per class in config.modelAlways, and a
// later small message of that class goes to Haiku by itself, with a note on
// the turn. Pure: no I/O (test/model-pick.test.js).

const { pickEffort } = require('./effort-pick');
const { modelFamily, estimate, MIN_SAMPLES } = require('./usage/ledger');
const { CLASS_WORDS, modelName: familyName } = require('../renderer/panel/savers-logic'); // the panel names the kinds the same way

/** The model offered: Claude Code's alias, so it follows whatever Haiku is today. */
const CHEAPER = 'haiku';
/** Relative price per input token (spend.js RATES), for the saving when there's no Haiku history to go on. */
const RATES = { haiku: 1, sonnet: 3, opus: 5, fable: 5 };
/** A small turn on a top model, as % of the 5-hour window, when nothing like it has run here yet. */
const GUESS_PCT = 1;
/** Families already cheap enough: no card for a tab on one. */
const CHEAP = new Set(['sonnet', 'haiku']);

/** @typedef {'question' | 'lookup' | 'tweak'} SmallClass */

// What a small message opens with, by class. A plain "…?" is a question.
const TWEAK = /^(rename|bump|remind)\b/i;
const LOOKUP = /^(explain|show|list|tell|where|which)\b/i;

/** @type {Record<SmallClass, string>} */
const CLASS_SHAPE = { question: 'A question like this is a few reads at most', lookup: 'A lookup like this is a few reads and no edits', tweak: 'A change like this is a few reads and one edit' };

/**
 * Which kind of small message this is, or null for one that isn't small.
 * Small is what effort-pick.js would run at low effort: a short question or
 * a short, named change, with nothing attached.
 * @param {string} text
 * @param {number} [files]  attachments
 * @returns {SmallClass | null}
 */
function classOf(text, files = 0) {
  const t = String(text || '').trim();
  if (pickEffort(t, files) !== 'low') return null;
  if (TWEAK.test(t)) return 'tweak';
  if (t.endsWith('?')) return 'question';
  if (LOOKUP.test(t)) return 'lookup';
  return 'question';
}

/**
 * Whether to ask, send to Haiku by itself, or leave the message be.
 * -> { ask: true, cls } | { auto: 'haiku', cls } | { ask: false, why }
 * why: 'off' (the setting), 'command' (a /command or ! run), 'ultracode',
 * 'merged' (several messages as one turn), 'local' (a tab on a local model),
 * 'cheap' (already on Sonnet or Haiku), 'big' (not a small message).
 * model: what the tab runs on now ('' is Claude Code's default); defaultModel: Settings' pick for new ones.
 * @param {{ text?: string, files?: number, model?: string, defaultModel?: string, enabled?: boolean, always?: Record<string, string> | null, ultracode?: boolean, merged?: boolean, local?: boolean }} [o]
 * @returns {{ ask: true, cls: SmallClass } | { auto: string, cls: SmallClass, ask?: undefined } | { ask: false, why: string }}
 */
function suggest({ text = '', files = 0, model = '', defaultModel = '', enabled = true, always = {}, ultracode = false, merged = false, local = false } = {}) {
  if (!enabled) return { ask: false, why: 'off' };
  const t = String(text || '').trim();
  if (!t || /^[/!]/.test(t)) return { ask: false, why: 'command' };
  if (ultracode) return { ask: false, why: 'ultracode' };
  if (merged) return { ask: false, why: 'merged' };
  if (local) return { ask: false, why: 'local' };
  if (CHEAP.has(modelFamily(model || defaultModel))) return { ask: false, why: 'cheap' };
  const cls = classOf(t, files);
  if (!cls) return { ask: false, why: 'big' };
  const chosen = always && typeof always === 'object' ? always[cls] : null;
  if (typeof chosen === 'string' && chosen) return { auto: chosen, cls };
  return { ask: true, cls };
}

const round1 = n => Math.round(n * 10) / 10;

/**
 * What the message usually takes of the 5-hour window, on the tab's model and
 * on Haiku: { current, cheaper, ratio, basis, measured }. current comes from
 * the ledger (usage/ledger.js estimate) when enough turns of this kind have
 * run, else GUESS_PCT (basis 'guess'); cheaper is your own Haiku turns of the
 * kind when there are enough (measured), else current scaled by list price.
 * Every number is an estimate, and the panel says "about".
 */
function estimateSmall(ledger, { pk = null, category = 'question', model = '', now = Date.now() } = {}) {
  const family = modelFamily(model) || 'opus';
  const ratio = round1(RATES.haiku / (RATES[family] || RATES.opus));
  const here = estimate(ledger, { pk, category, model: family, now });
  const current = here.pct !== null && here.pct > 0 ? here.pct : GUESS_PCT;
  const rows = (Array.isArray(ledger) ? ledger : []).filter(r => modelFamily(r.model) === CHEAPER);
  const onHaiku = estimate(rows, { pk, category, model: CHEAPER, now });
  const measured = onHaiku.samples >= MIN_SAMPLES && onHaiku.pct !== null && onHaiku.pct > 0 && onHaiku.pct < current;
  return {
    current: round1(current), cheaper: measured ? round1(onHaiku.pct) : Math.max(0.1, round1(current * ratio)),
    ratio, basis: here.pct !== null && here.pct > 0 ? here.basis : 'guess', measured,
  };
}

/** "1/5" for 0.2, "1/3" for 0.3; "a fraction" when it doesn't read as one. */
function fraction(ratio) {
  const n = Math.round(1 / ratio);
  return Number.isFinite(n) && n > 1 && Math.abs(1 / n - ratio) < 0.06 ? `1/${n}` : 'a fraction of';
}

const pct = n => `${n}%`;

/**
 * The card's words: { title, body, current: { name, pct }, cheaper: { name, pct } }.
 * cls: the message's class; model: the tab's; est: estimateSmall's answer.
 */
function words({ cls = 'question', model = '', est }) {
  const name = familyName(model);
  const cheap = familyName(CHEAPER);
  const e = est || { current: GUESS_PCT, cheaper: GUESS_PCT * RATES.haiku / RATES.opus, ratio: RATES.haiku / RATES.opus, basis: 'guess', measured: false };
  const share = fraction(e.cheaper / e.current);
  const usual = e.basis === 'guess'
    ? `Nothing like it has run here yet, so a rough guess: on ${name} about ${pct(e.current)} of your 5-hour window; on ${cheap} about ${pct(e.cheaper)}, around ${share} the usage.`
    : `On ${name} it usually takes about ${pct(e.current)} of your 5-hour window; on ${cheap} about ${pct(e.cheaper)}${e.measured ? ' (from your own Haiku turns)' : ''}, around ${share} the usage.`;
  return {
    title: `Quick one. ${cheap} could take it.`,
    body: `${CLASS_SHAPE[cls] || CLASS_SHAPE.question}. ${usual} Nothing has gone out yet.`,
    current: { name, pct: e.current }, cheaper: { name: cheap, pct: e.cheaper },
    always: `Always for ${CLASS_WORDS[cls] || CLASS_WORDS.question}`,
  };
}

/** The modelAlways record after a choice: { ...always, [cls]: model }, or without cls when model is null. */
function withAlways(always, cls, model) {
  const base = always && typeof always === 'object' ? always : {};
  if (!CLASS_WORDS[/** @type {SmallClass} */ (cls)]) return { ...base };
  if (!model) { const { [cls]: _gone, ...rest } = base; return rest; }
  return { ...base, [cls]: model };
}

/** A clean modelAlways: only known classes, only model ids `isModel` accepts. */
function cleanAlways(raw, isModel) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const cls of Object.keys(CLASS_WORDS)) {
    const m = /** @type {Record<string, unknown>} */ (raw)[cls];
    if (typeof m === 'string' && m && isModel(m)) out[cls] = m;
  }
  return out;
}

module.exports = { classOf, suggest, estimateSmall, words, familyName, withAlways, cleanAlways, CHEAPER, CLASS_WORDS, GUESS_PCT, RATES };
