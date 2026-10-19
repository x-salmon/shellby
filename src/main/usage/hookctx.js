// Hooks that add to the conversation: a SessionStart hook's additionalContext
// (or what it prints) goes in before your first word, a UserPromptSubmit one's
// with each message you send, and a PostToolUse one's after a tool. Claude
// Code's transcripts record each run with the hook's command and what it printed
// (an attachment of type hook_success), so the same read as the hot files
// (hotfiles.js) adds them up. Nothing else in the Lean tab can see this part:
// it lands in "Claude Code's own prompt" on the setup bar.
//
// Pure: no I/O (test/hookctx.test.js).

const CHARS_PER_TOKEN = 4;
const MIN_TOKENS = 200;       // a run this big, on average, is worth a word
const TOP = 8;
const NAME_CHARS = 60;
// Plain text a hook prints is added for these; for the rest only JSON's additionalContext is.
const PLAIN_ADDS = new Set(['SessionStart', 'UserPromptSubmit']);
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SubagentStart']);

/**
 * A short name for a hook's command, so runs of the same one add up:
 * 'bash "${CLAUDE_PLUGIN_ROOT}/hooks-handlers/session-start.sh"' -> 'session-start.sh',
 * 'node C:\\x\\remind.js --quiet' -> 'remind.js', 'curl -H "token: …" x' -> 'curl'.
 * Only the program for an inline command: the rest could hold a key, and the
 * name goes into the Lean tab's prompt for Claude.
 */
function hookName(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const scripts = command.match(/[\w.-]+\.(?:sh|js|cjs|mjs|ts|py|ps1|cmd|bat|rb)\b/g);
  const name = scripts ? scripts[scripts.length - 1] : command.trim().split(/\s+/)[0].replace(/^["']|["']$/g, '').split(/[\\/]/).pop() || '';
  const short = name.slice(0, NAME_CHARS);
  return /[\u0000-\u001f\u007f]/.test(short) ? null : short;
}

/** What a hook's output adds to the conversation, in characters. */
function addedChars(stdout, event) {
  if (typeof stdout !== 'string') return 0;
  const t = stdout.trim();
  if (!t) return 0;
  if (t.startsWith('{')) {
    let out;
    try { out = JSON.parse(t); } catch { return PLAIN_ADDS.has(event) ? t.length : 0; }
    const ctx = out?.hookSpecificOutput?.additionalContext;
    return typeof ctx === 'string' ? ctx.length : 0;
  }
  return PLAIN_ADDS.has(event) ? t.length : 0;
}

/**
 * The hook run in one transcript line that added to the conversation:
 * { key, event, chars }, or null. Only lines naming hook_success are parsed.
 */
function hookContextIn(line) {
  if (typeof line !== 'string' || !line.includes('"hook_success"')) return null;
  let ev;
  try { ev = JSON.parse(line); } catch { return null; }
  const a = ev?.attachment;
  if (a?.type !== 'hook_success' || !EVENTS.has(a.hookEvent)) return null;
  const chars = addedChars(a.stdout, a.hookEvent);
  const name = chars ? hookName(a.command) : null;
  return name ? { key: `${a.hookEvent}:${name}`, event: a.hookEvent, name, chars } : null;
}

/**
 * Add one conversation's hook runs to the tally (Map key -> { key, event,
 * name, runs, chars, sessions }). Returns a new tally.
 */
function tallyHooks(tally, runs) {
  const next = new Map(tally);
  const seen = new Set();
  for (const { key, event, name, chars } of runs) {
    const t = next.get(key) || { key, event, name, runs: 0, chars: 0, sessions: 0 };
    next.set(key, { ...t, runs: t.runs + 1, chars: t.chars + chars, sessions: t.sessions + (seen.has(key) ? 0 : 1) });
    seen.add(key);
  }
  return next;
}

/**
 * The hooks worth a word: MIN_TOKENS or more a run on average, the most in a
 * conversation first. -> [{ event, name, runs, sessions, tokens (a run),
 * perConversation }]
 * @param {Map<string, { key: string, event: string, name: string, runs: number, chars: number, sessions: number }>} tally
 */
function heaviestHooks(tally) {
  return [...tally.values()]
    .map(t => ({ ...t, tokens: Math.round(t.chars / Math.max(1, t.runs) / CHARS_PER_TOKEN), perConversation: Math.round(t.chars / Math.max(1, t.sessions) / CHARS_PER_TOKEN) }))
    .filter(t => t.tokens >= MIN_TOKENS)
    .sort((a, b) => (b.perConversation - a.perConversation) || a.key.localeCompare(b.key))
    .slice(0, TOP)
    .map(({ event, name, runs, sessions, tokens, perConversation }) => ({ event, name, runs, sessions, tokens, perConversation }));
}

/**
 * What the start hooks add before your first word, on average: the setup
 * bar's part. Every one counts here, even those too small for the list.
 * @param {Map<string, { event: string, runs: number, chars: number }>} tally
 */
function startTokens(tally) {
  const starts = [...(tally instanceof Map ? tally.values() : [])].filter(t => t.event === 'SessionStart');
  return Math.round(starts.reduce((n, t) => n + t.chars / Math.max(1, t.runs), 0) / CHARS_PER_TOKEN);
}

module.exports = { hookName, addedChars, hookContextIn, tallyHooks, heaviestHooks, startTokens, MIN_TOKENS };
