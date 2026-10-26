// "You've done this before": the past conversation in this project whose ask
// is most like the one being typed, so its answer can be read or brought in
// before Claude works it all out again.
//
// History search (search.js) wants every word; a new task is worded afresh, so
// this weighs the words instead. Each conversation is read as what you asked
// in it (its title and first few messages), the words common to most of a
// project's conversations count for little, and the rare ones shared with what
// you're typing count for a lot (a cosine over idf weights). Only a strong
// match is offered: enough words in what's typed, at least two of them shared,
// and a score over MIN_SCORE.
//
// Pure: it's handed History's index and each conversation's messages (the
// search index already has them in memory). See test/history-similar.test.js.

const MIN_TERMS = 3;       // fewer meaningful words than this says too little to match on
const MIN_SHARED = 2;
const MIN_SCORE = 0.3;
const ASKS_READ = 3;       // your first few messages say what a conversation was for
const MAX_ASK_CHARS = 2000;
const MAX_RESULTS = 3;
const MAX_TERMS = 60;
const ASK_SHOWN = 160;

// Words that say nothing about what a task is: English glue, and the way asks
// are phrased ("can you please make…").
const STOP = new Set(`
a about above after again all also am an and any are aren as at be because been before being below between both but by
can cannot could did do does doing done don down during each few for from further get got had has have having he her here
hers him his how i if in into is it its itself just let lets like me might more most must my myself no nor not now of off on
once only or other ought our ours out over own same she should so some such than that the their theirs them then there these
they this those through to too under until up us very was we were what when where which while who whom why will with would
you your yours yourself
please thanks thank ok okay hey hi want need needs make makes making use using used way ways thing things something stuff
bit little quick quickly just really also still lets help able sure try trying look looking see going go one two new
claude shellby
`.split(/\s+/).filter(Boolean));

const ACRONYMS = new Set(['ci', 'cd', 'ui', 'ux', 'pr', 'db', 'js', 'ts', 'qa', 'ai', 'vm']);

/**
 * A word's plain stem: "tests" and "testing" match "test", "caching" matches
 * "cache". Deliberately crude: both sides go through it, so it only has to agree with itself.
 */
function stem(w) {
  let s = w;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && (s.endsWith('ied') || s.endsWith('ies'))) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && /(ss|x|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  // "cache" and "cach(ing)", "remove" and "remov(ed)": the silent e goes either way.
  return s.length > 4 && s.endsWith('e') ? s.slice(0, -1) : s;
}

/**
 * The meaningful words of some text, stemmed, each once. Identifiers count as
 * themselves and as their parts: "flakyLoginTest" is also flaky, login, test.
 * @param {string} text
 * @returns {string[]}
 */
function termsOf(text) {
  const out = new Set();
  const add = w => {
    const low = w.toLowerCase();
    // Two letters only for an acronym: written as one (CI, PR), or a usual one however it's typed.
    if ((low.length < 3 && !(low.length === 2 && (/^\p{Lu}{2}$/u.test(w) || ACRONYMS.has(low)))) || STOP.has(low)) return;
    const s = stem(low);
    if (!STOP.has(s)) out.add(s);
  };
  for (const m of String(text || '').slice(0, 20000).matchAll(/[\p{L}\p{N}_]+/gu)) {
    const word = m[0];
    const parts = word.split(/_+|(?<=[\p{Ll}\p{N}])(?=\p{Lu})/u).filter(Boolean);
    if (parts.length > 1) for (const p of parts) add(p);
    add(word);
    if (out.size >= MAX_TERMS) break;
  }
  return [...out];
}

/**
 * What a conversation was for, as words: its title and your first few messages.
 * @param {{ title?: string }} entry
 * @param {{ kind: string, text: string }[] | undefined} docs  search.js docsOf's
 */
function asksOf(entry, docs) {
  const asks = (docs || []).filter(d => d.kind === 'user').slice(0, ASKS_READ).map(d => d.text.slice(0, MAX_ASK_CHARS));
  return { first: asks[0] || '', text: [entry.title || '', ...asks].join('\n') };
}

/** Did Claude answer anything in it? A conversation that never got a reply has nothing to bring in. */
const answered = docs => (docs || []).some(d => d.kind === 'text' || d.kind === 'result');

const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * The past conversations most like what's being typed, best first.
 * @param {any[]} entries  History's index (list())
 * @param {(id: string) => ({ kind: string, text: string }[] | undefined)} docsFor
 * @param {string} text  what's in the box
 * @param {{ exclude?: string | null, inProject?: (entry: any) => boolean, limit?: number }} [opts]
 * @returns {{ id: string, title: string, updatedAt: number, done: boolean, score: number, shared: string[], ask: string }[]}
 */
function rankSimilar(entries, docsFor, text, { exclude = null, inProject = () => true, limit = MAX_RESULTS } = {}) {
  const query = termsOf(text);
  if (query.length < MIN_TERMS) return [];
  const pool = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || e.id === exclude || !inProject(e)) continue;
    const docs = docsFor(e.id);
    if (!answered(docs)) continue;
    const asks = asksOf(e, docs);
    const terms = new Set(termsOf(asks.text));
    if (terms.size) pool.push({ e, asks, terms });
  }
  if (!pool.length) return [];
  // How many of this project's conversations use each word: the rarer, the more it says.
  const df = new Map();
  for (const p of pool) for (const t of p.terms) df.set(t, (df.get(t) || 0) + 1);
  const idf = t => Math.log((pool.length + 1) / ((df.get(t) || 0) + 0.5));
  const norm = terms => Math.sqrt([...terms].reduce((n, t) => n + idf(t) ** 2, 0));
  const qNorm = norm(query);
  if (!qNorm) return [];
  const out = [];
  for (const p of pool) {
    const shared = query.filter(t => p.terms.has(t));
    if (shared.length < MIN_SHARED) continue;
    const dNorm = norm(p.terms);
    if (!dNorm) continue;
    const score = shared.reduce((n, t) => n + idf(t) ** 2, 0) / (qNorm * dNorm);
    if (score < MIN_SCORE) continue;
    out.push({
      id: p.e.id, title: oneLine(p.e.title) || 'Untitled', updatedAt: p.e.updatedAt || p.e.createdAt || 0,
      done: !!p.e.done, score: Math.round(score * 1000) / 1000,
      shared: shared.sort((a, b) => idf(b) - idf(a)).slice(0, 5),
      ask: clip(oneLine(p.asks.first), ASK_SHOWN),
    });
  }
  // Best first; a tie goes to one you ticked off, then the newer.
  return out.sort((a, b) => b.score - a.score || Number(b.done) - Number(a.done) || b.updatedAt - a.updatedAt).slice(0, limit);
}

module.exports = { rankSimilar, termsOf, stem, asksOf, MIN_TERMS, MIN_SHARED, MIN_SCORE };
