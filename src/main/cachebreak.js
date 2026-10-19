// Cache breaks: a call that sent a conversation again at full price while its
// prompt cache should still have held it. A cold cache is expected (Keep warm
// and idle compaction are about that); a warm one that misses means the start
// of the request no longer matched what was cached. Shellby can't see the
// request, only what each call says it read and wrote, so it says what came
// just before:
//
//   - 'resume': this was the first call since the conversation's process
//     started again (a quiet tab sheds it after a while; a crash ends it), so
//     Claude Code built its start afresh: a CLAUDE.md, plugin or MCP server
//     that changed meanwhile, or its own start differing, misses the cache.
//   - 'model': the call ran on a different model than the one before (a
//     fallback model, say), and each model has a cache of its own.
//   - 'other': neither of those. A running conversation's model only changes
//     to a fallback (Shellby's model setting is for new ones), so 'model' is
//     never a switch you made.
//
// Kept per day like the cache ledger (efficiency.js), for the Lean tab. And
// before a cold cache is paid for: a short message into a big conversation
// whose cache has gone cold sends all of it again (coldResend), when a new tab
// might have done. And before a /model switch throws a warm cache away (modelSwitch).
// Pure: callers pass `now` (test/cachebreak.test.js).

const BREAK_MIN = 20000;   // tokens: a smaller re-send isn't worth a word
const READ_SHARE = 0.5;    // read back less than this share of what the conversation held
const KEEP_DAYS = 21;
const CAUSES = ['resume', 'model', 'other'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const num = v => (Number.isFinite(v) && v > 0 ? v : 0);
const dayKey = t => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysBack = (now, n) => { const d = new Date(now); return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n).getTime()); };

/**
 * Did this call break a warm cache? -> { tokens, cause } or null.
 * call: efficiency.js callFrom's { main, input, write, read } for a call's first
 * event; cache: the conversation's { at, ttlMs } before it; before: the tokens
 * the conversation held (its context) before it; resumed: the first call since
 * its process started again; modelChanged: on another model than the last call.
 */
function cacheBreak({ call, cache, before, now, resumed = false, modelChanged = false }) {
  if (!call?.main || !cache || !Number.isFinite(cache.at) || num(before) < BREAK_MIN) return null;
  if (now - cache.at >= num(cache.ttlMs)) return null; // gone cold: expected, not a break
  const fresh = num(call.input) + num(call.write);
  if (fresh < BREAK_MIN || num(call.read) >= before * READ_SHARE) return null;
  return { tokens: fresh, cause: modelChanged ? 'model' : resumed ? 'resume' : 'other' };
}

/** Tolerate anything read from disk: { 'YYYY-MM-DD': { count, tokens, resume, model, other } }. */
function normalizeBreaks(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of Object.keys(src).filter(k => DAY_RE.test(k)).sort().slice(-KEEP_DAYS)) {
    const d = src[k] || {};
    const day = { count: Math.floor(num(d.count)), tokens: Math.round(num(d.tokens)), ...Object.fromEntries(CAUSES.map(c => [c, Math.floor(num(d[c]))])) };
    if (day.count) out[k] = day;
  }
  return out;
}

/** One break added to its day. Returns a new ledger. */
function recordBreak(days, brk, now) {
  if (!brk || !num(brk.tokens)) return days;
  const cause = CAUSES.includes(brk.cause) ? brk.cause : 'other';
  const k = dayKey(now);
  const d = days[k] || { count: 0, tokens: 0, resume: 0, model: 0, other: 0 };
  return normalizeBreaks({ ...days, [k]: { ...d, count: d.count + 1, tokens: d.tokens + Math.round(brk.tokens), [cause]: d[cause] + 1 } });
}

/** The last seven days: { count, tokens, resume, model, other }, or null with none. */
function breakSummary(days, now) {
  const s = { count: 0, tokens: 0, resume: 0, model: 0, other: 0 };
  for (let i = 0; i < 7; i++) {
    const d = days?.[daysBack(now, i)];
    if (d) for (const f of Object.keys(s)) s[f] += d[f] || 0;
  }
  return s.count ? s : null;
}

const COLD_MIN = 50000;    // tokens: a conversation smaller than this is cheap to send again
const SHORT_CHARS = 200;   // a message this short is a quick follow-up, not a new task

/**
 * Would this message send a big conversation again at full price because its
 * cache has gone cold? -> { tokens, coldSince } or null. cache: { at, ttlMs };
 * tokens: what the conversation holds; text: the message.
 */
function coldResend({ cache, tokens, text, now }) {
  if (!cache || !Number.isFinite(cache.at) || num(tokens) < COLD_MIN) return null;
  const until = cache.at + num(cache.ttlMs);
  if (now < until || String(text || '').trim().length >= SHORT_CHARS) return null;
  return { tokens: Math.round(tokens), coldSince: until };
}

const MODEL_COMMAND = /^\/model\s+\S/i;

/**
 * Would this message switch a big conversation's model while its cache is
 * still warm? Each model has a cache of its own, so the next message sends
 * everything again at full price. -> { tokens } or null.
 */
function modelSwitch({ cache, tokens, text, now }) {
  if (!MODEL_COMMAND.test(String(text || '').trim()) || num(tokens) < BREAK_MIN) return null;
  if (!cache || !Number.isFinite(cache.at) || now >= cache.at + num(cache.ttlMs)) return null; // cold already: nothing to lose
  return { tokens: Math.round(tokens) };
}

/** What a turn's break says beside its cost: one sentence, by cause. */
function breakText(brk) {
  const n = Math.round(num(brk?.tokens) / 1000);
  const sent = `This turn sent ${n ? `~${n}k` : 'the conversation'} tokens at full price while the cache should still have held them.`;
  if (brk?.cause === 'resume') return `${sent} Its process had started again (after sitting quiet, or stopping), and the start Claude Code built no longer matched the cached one, usually because CLAUDE.md, a plugin or an MCP server changed meanwhile.`;
  if (brk?.cause === 'model') return `${sent} It ran on a different model than the call before (a fallback model, say), and each model has a cache of its own.`;
  return `${sent} Less came back from the cache than the conversation holds; Shellby can't see why.`;
}

module.exports = { cacheBreak, coldResend, modelSwitch, COLD_MIN, normalizeBreaks, recordBreak, breakSummary, breakText, BREAK_MIN, READ_SHARE, CAUSES };
