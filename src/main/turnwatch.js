// What a turn did that's worth a word under its cost: a whole file read that
// put a lot into the conversation, a helper sent off with a long brief, a
// file read again with nothing changing it since, a
// commit with the conversation well filled (a good moment to compact, since
// the work is saved), and a tidy-up that thought hard on a high effort.
// sessions.js feeds it the turn's items as they come; turncost.js turnNotes
// words the notes. Each is said once a conversation (the compact one once
// until it's compacted).
//
// Pure: no I/O (test/turnwatch.test.js).

const CHARS_PER_TOKEN = 4;
const BIG_READ = 8000;          // tokens: a whole-file read this big is worth a word
const LONG_BRIEF = 2000;        // tokens: a helper's brief this long
const COMPACT_PCT = 40;         // context: a commit past this is a good moment to compact
const HARD_THINKING = 5000;     // tokens of thinking on a small job
const HIGH_EFFORTS = new Set(['high', 'xhigh', 'max']);
const SMALL_JOBS = new Set(['tidy', 'docs']);
const HELPERS = new Set(['Agent', 'Task']);
const SHELLS = new Set(['Bash', 'PowerShell']);
const REREAD_TOKENS = 2000;     // a re-read this big is worth a word (Claude Code's own "unchanged" stub is far smaller)
const PATH_CHARS = 500;
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
// Shell commands that can change files under Claude's feet: after one, no earlier read is known to be current.
const CHANGES_FILES = /\bgit\s+(?:checkout|switch|reset|stash|pull|merge|rebase|apply|restore|cherry-pick)\b|\bsed\s+-i|--fix\b|--write\b|\b(?:mv|cp|rm)\s/;
const COMMAND_CHARS = 2000;     // enough to find a commit in, short enough to split cheaply
const GIT = new Set(['git', 'git.exe']);

/** Does a shell command run `git … commit`? Split into words, not a regex, so a long command can't backtrack. */
function commits(command) {
  const words = command.slice(0, COMMAND_CHARS).split(/[\s;&|()"']+/);
  for (let i = 0; i < words.length; i++) {
    if (!GIT.has(words[i].split(/[\\/]/).pop().toLowerCase())) continue;
    // Past git's own options to its subcommand: -C and -c take a value.
    let j = i + 1;
    while (j < words.length && words[j].startsWith('-')) j += /^-[Cc]$/.test(words[j]) ? 2 : 1;
    if (words[j] === 'commit') return true;
  }
  return false;
}

const tokensOf = chars => Math.round((Number.isFinite(chars) && chars > 0 ? chars : 0) / CHARS_PER_TOKEN);

/**
 * A new turn's watch: nothing seen yet, but the files read whole earlier in
 * the conversation and not changed since (files) carry over from prev.
 */
function startTurn(prev) {
  return { reads: {}, bigRead: 0, brief: 0, committed: false, reread: null, files: prev?.files || {} };
}

const pathKey = p => String(p).replace(/\\/g, '/').toLowerCase();

/**
 * What a tool call's input says, kept on its item (stream.js toolItem):
 * { wholeRead } for a Read with no range, { briefChars } for a helper,
 * { commits } for a shell command that commits. {} for the rest.
 */
function toolFacts(name, input) {
  const i = input && typeof input === 'object' ? input : {};
  if (name === 'Read') return i.offset == null && i.limit == null && i.pages == null && typeof i.file_path === 'string' ? { wholeRead: true, readPath: i.file_path.slice(0, PATH_CHARS) } : {};
  if (EDITS.has(name) && typeof (i.file_path ?? i.notebook_path) === 'string') return { editPath: String(i.file_path ?? i.notebook_path).slice(0, PATH_CHARS) };
  if (HELPERS.has(name) && typeof i.prompt === 'string') return { briefChars: i.prompt.length };
  if (SHELLS.has(name) && typeof i.command === 'string') {
    const facts = { ...(commits(i.command) ? { commits: true } : {}), ...(CHANGES_FILES.test(i.command.slice(0, COMMAND_CHARS)) ? { changesFiles: true } : {}) };
    return facts;
  }
  return {};
}

/**
 * One item of the turn: returns the watch after it. A helper's own steps
 * (item.sub) stay in its context, so they don't count.
 */
function seeItem(watch, item) {
  const w = watch || startTurn();
  if (!item || item.sub) return w;
  if (item.kind === 'tool') {
    if (item.wholeRead && typeof item.id === 'string') return { ...w, reads: { ...w.reads, [item.id]: { path: typeof item.readPath === 'string' ? item.readPath : null } } };
    if (Number.isFinite(item.briefChars)) return { ...w, brief: Math.max(w.brief, tokensOf(item.briefChars)) };
    if (typeof item.editPath === 'string') {
      const { [pathKey(item.editPath)]: _, ...files } = w.files || {};
      return { ...w, files };
    }
    if (item.commits || item.changesFiles) return { ...w, committed: w.committed || !!item.commits, files: item.changesFiles ? {} : w.files };
    return w;
  }
  if (item.kind === 'tool_result' && w.reads[item.id]) {
    const { [item.id]: read, ...reads } = w.reads;
    if (item.isError) return { ...w, reads };
    const tokens = tokensOf(item.chars);
    const key = read.path ? pathKey(read.path) : null;
    // Read whole before, and nothing has changed it since: the same text again.
    const again = key && w.files?.[key] && tokens >= REREAD_TOKENS && tokens > (w.reread?.tokens || 0) ? { path: read.path, tokens } : w.reread;
    return { ...w, reads, bigRead: Math.max(w.bigRead, tokens), reread: again, files: key ? { ...w.files, [key]: true } : w.files };
  }
  return w;
}

/**
 * The notes this turn's watch earns: [{ kind, text, action? }].
 * said: { bigRead, brief, compact, effort } for the ones already said in this
 * conversation; cost: the turn's (turncost.js turnCost); category: what kind
 * of ask it was (usage/ledger.js classify).
 */
function watchNotes(watch, { cost, category = '', said = {}, compact = n => String(n) } = {}) {
  if (!watch || !cost) return [];
  const pct = cost.contextPct;
  return [
    !said.bigRead && watch.bigRead >= BIG_READ
      ? { kind: 'big-read', text: `Claude read a whole file of about ${compact(watch.bigRead)} tokens this turn, and it's sent again with every message after it. Naming the part you need (a function, a section, a line range) reads less.` } : null,
    !said.reread && watch.reread
      ? { kind: 'reread', text: `Claude read ${shortPath(watch.reread.path)} again, about ${compact(watch.reread.tokens)} tokens, with nothing changing it since it last read it. The earlier copy is still in the conversation, so naming the part to look at again, or saying it's unchanged, reads less.` } : null,
    !said.brief && watch.brief >= LONG_BRIEF
      ? { kind: 'brief', text: `A helper went off with a brief of about ${compact(watch.brief)} tokens. It reads the code for itself, so a brief that says what to look at and what to bring back, without pasting what it can read, costs less.` } : null,
    !said.compact && watch.committed && Number.isFinite(pct) && pct >= COMPACT_PCT
      ? { kind: 'compact', text: `That's committed, with the conversation ${pct}% full. A good moment to compact: the work is saved, so a summary loses little and every message after it sends less.`, action: 'compact' } : null,
    !said.effort && HIGH_EFFORTS.has(cost.effort) && SMALL_JOBS.has(category) && Number.isFinite(cost.thinking) && cost.thinking >= HARD_THINKING
      ? { kind: 'effort', text: `Claude thought for ${compact(cost.thinking)} tokens on a small job at ${cost.effort} effort. Medium or low on the effort chip usually does a tidy-up just as well.` } : null,
  ].filter(n => n !== null);
}

const shortPath = p => String(p || 'a file').split(/[\\/]/).slice(-2).join('/');

/** The said-flags after some notes went out. */
function markSaid(said, notes) {
  const kinds = { 'big-read': 'bigRead', reread: 'reread', brief: 'brief', compact: 'compact', effort: 'effort' };
  return (notes || []).reduce((s, n) => (kinds[n.kind] ? { ...s, [kinds[n.kind]]: true } : s), { ...(said || {}) });
}

module.exports = { startTurn, toolFacts, seeItem, watchNotes, markSaid, REREAD_TOKENS, BIG_READ, LONG_BRIEF, COMPACT_PCT, HARD_THINKING };
