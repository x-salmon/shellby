// A nudge under a repeated big read. When Claude reads a file whole that is
// big (BIG_READ_TOKENS or more) and that it has read in MIN_SESSIONS or more
// conversations this week (usage/hotfiles.js), and the file is generated
// (leanfix.js isGenerated) or simply one it keeps coming back to, a card lands
// under that Read step mid-turn with the same one-tap fix the Lean tab drafts
// (lean-fixes.js): a deny rule or a CLAUDE.md line, diff and all. At most once
// per file per week, and "Never for this file" is kept for good. Pure: no I/O
// (test/read-nudge.test.js); wiring/read-nudge.js watches the turns.

const { isGenerated } = require('./leanfix');
const { MIN_SESSIONS } = require('./usage/hotfiles');

const BIG_READ_TOKENS = 10000;             // a whole-file read this big is worth a word
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;   // how far back the reads count, and how long a nudge rests
const MAX_SEEN = 300;                      // files remembered as nudged: the oldest go first
const MAX_NEVER = 500;

/** The record kept in config.readNudges: { seen: { key: when }, never: [key] }. */
const emptyStore = () => ({ seen: {}, never: [] });

const str = v => (typeof v === 'string' ? v : '');
const norm = p => str(p).replace(/\\/g, '/').toLowerCase();

/** One file in one project, as the record keys it. */
const keyOf = (project, rel) => `${norm(project)}::${norm(rel)}`;

/** A store as read from config: shaped, whatever was there. */
function cleanStore(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {any} */ (raw) : {};
  /** @type {Record<string, number>} */
  const seen = {};
  if (s.seen && typeof s.seen === 'object' && !Array.isArray(s.seen)) {
    for (const [k, v] of Object.entries(s.seen)) if (typeof k === 'string' && Number.isFinite(v)) seen[k] = /** @type {number} */ (v);
  }
  const never = Array.isArray(s.never) ? s.never.filter(k => typeof k === 'string' && k).slice(-MAX_NEVER) : [];
  return { seen, never };
}

/**
 * Should a card go under this read? -> { ok: true } | { ok: false, why }.
 * why: 'small' (under BIG_READ_TOKENS), 'rare' (fewer than MIN_SESSIONS
 * conversations this week), 'never' (you said so), 'rested' (nudged this
 * week already), 'outside' (not a project file).
 * sessions: conversations this week that read it, from the week's scan.
 */
function shouldNudge({ rel, tokens, sessions, store, project, now = Date.now() }) {
  if (!str(rel) || !str(project)) return { ok: false, why: 'outside' };
  if (!(Number.isFinite(tokens) && tokens >= BIG_READ_TOKENS)) return { ok: false, why: 'small' };
  if (!(Number.isFinite(sessions) && sessions >= MIN_SESSIONS)) return { ok: false, why: 'rare' };
  const s = cleanStore(store);
  const key = keyOf(project, rel);
  if (s.never.includes(key)) return { ok: false, why: 'never' };
  const last = s.seen[key];
  if (Number.isFinite(last) && now - last < WEEK_MS) return { ok: false, why: 'rested' };
  return { ok: true };
}

/** The store with this file nudged now: old entries past the week are dropped, the newest MAX_SEEN kept. */
function markSeen(store, project, rel, now = Date.now()) {
  const s = cleanStore(store);
  const kept = Object.entries(s.seen).filter(([, at]) => now - at < WEEK_MS).sort((a, b) => a[1] - b[1]).slice(-(MAX_SEEN - 1));
  return { ...s, seen: Object.fromEntries([...kept, [keyOf(project, rel), now]]) };
}

/** The store with this file never nudged again. */
function markNever(store, project, rel) {
  const s = cleanStore(store);
  const key = keyOf(project, rel);
  return { ...s, never: s.never.includes(key) ? s.never : [...s.never, key].slice(-MAX_NEVER) };
}

const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

/**
 * The card's words. fix: the drafted fix (leanfix.js), by kind; sessions: the
 * conversations this week; tokens: this read's; edits: whether any of them changed it.
 * The mark comes whole and in parts (lead, nth, mid, the path, tail), so the
 * panel can set the count and the path apart.
 * -> { mark, lead, nth, mid, tail, what, keeps, undo, saves, generated }
 */
function words({ rel, sessions, tokens, edits = 0, fix, compact = n => String(n) }) {
  const generated = isGenerated(rel);
  const deny = fix?.kind === 'deny-read';
  const never = edits ? '' : ', and it has never changed it';
  const each = Number.isFinite(tokens) && tokens > 0 ? `: about ${compact(tokens)} tokens each time${never}` : never ? `${never.slice(1)}` : '';
  const lead = "That's the ";
  const nth = `${ordinal(sessions)} conversation this week`;
  const mid = ' in which Claude read ';
  const tail = `${each}.`;
  return {
    generated, lead, nth, mid, tail,
    mark: `${lead}${nth}${mid}${rel}${tail}`,
    what: deny
      ? `A deny rule keeps it out of every conversation in this project. Claude is told the file is off limits, and it can still search inside it${generated ? ' or ask the package manager' : ''}.`
      : `A line in CLAUDE.md says what the file holds, so Claude needn't open it to find out. It can still read it when a task really needs it.`,
    keeps: 'This conversation keeps the read it already did. The change starts with the next message.',
    undo: `One click to undo, here or on the Lean tab. Shellby never ${deny ? 'adds a rule' : 'writes a line'} by itself.`,
    saves: Number.isFinite(tokens) && tokens > 0 ? `Saves about ${compact(tokens)} a conversation.` : '',
  };
}

module.exports = { shouldNudge, markSeen, markNever, keyOf, cleanStore, emptyStore, words, BIG_READ_TOKENS, WEEK_MS, MIN_SESSIONS, MAX_SEEN };
