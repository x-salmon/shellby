// Commands whose output fills Claude's context: a test run, a `git log` or a
// `cat` of a lockfile can put thousands of tokens into a conversation, and
// every call after it carries them again. Read from the same transcripts as the
// hot files (hotfiles.js reads them, line by line); this only says which lines
// are shell calls and their results, and adds them up. A command Claude runs
// in conversation after conversation with a loud result is often worth a
// quieter flag, a pipe through `tail`, or a line in CLAUDE.md saying how.
//
// Pure: no I/O (test/loud.test.js).

const LOUD_TOKENS = 2000;      // a run this big, on average, is worth a word
const MIN_SESSIONS = 2;        // in fewer conversations it isn't a habit yet
const TOP = 8;
const CHARS_PER_TOKEN = 4;
const KEY_CHARS = 80;
const SHELLS = new Set(['Bash', 'PowerShell']);
const SHELL_TOOL = /"name":"(?:Bash|PowerShell|mcp__)/;
const MCP_NAME = /^mcp__[\w.-]{1,120}$/;

// Programs whose first word after them says what ran ("git log", "cargo test").
const SUBCOMMANDS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'git', 'gh', 'glab', 'cargo', 'go', 'dotnet', 'docker', 'kubectl', 'pip', 'uv', 'poetry', 'make', 'deno', 'mvn', 'gradle']);
// Package runners: "npm run <script>" is the script.
const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
// Interpreters: the script they run says what it was.
const INTERPRETERS = new Set(['node', 'python', 'python3', 'py', 'pwsh', 'powershell', 'bash', 'sh', 'ruby', 'php']);
const INLINE = new Set(['-e', '-c', '-p', '--eval', '--print', '-command', '-encodedcommand']);

const LEADING = [
  /^set\s+-o\s+pipefail\s*;\s*/i,                            // the quiet-output hook's rewrite (hooks/recipes.js)
  /^cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/i,                  // cd somewhere && …
  /^(set-location|push-location|pushd)\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*/i,
  /^\$env:\w+\s*=\s*("[^"]*"|'[^']*'|\S+)\s*;\s*/i,            // $env:X='1'; …
  /^[A-Za-z_]\w*=("[^"]*"|'[^']*'|\S*)\s+/,                    // X=1 …
  /^&\s*/,                                                     // PowerShell's call operator
];

const bare = w => w.replace(/^["']|["']$/g, '');
const program = w => bare(w).split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
const isArg = w => !!w && !w.startsWith('-') && !/^[|&;<>]/.test(w);

/**
 * A short name for a shell command, so runs of the same thing add up:
 * 'cd app && npm run e2e:ci -- queue' -> 'npm run e2e:ci', 'git log -5' ->
 * 'git log', 'cat package-lock.json' -> 'cat'. null for nothing usable.
 */
function commandKey(command) {
  if (typeof command !== 'string') return null;
  let s = command.split('\n')[0].trim();
  for (let again = true; again;) {
    again = false;
    for (const re of LEADING) {
      const next = s.replace(re, '');
      if (next !== s) { s = next.trim(); again = true; }
    }
  }
  const segment = s.split(/\s*(?:&&|\|\||;|\|)\s*/)[0];
  const words = segment.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  if (!words.length) return null;
  const p = program(words[0]);
  let key = p;
  if (RUNNERS.has(p) && words[1] === 'run' && isArg(words[2])) key = `${p} run ${bare(words[2])}`;
  else if (SUBCOMMANDS.has(p) && isArg(words[1])) key = `${p} ${bare(words[1])}`;
  else if (INTERPRETERS.has(p) && !words.some(w => INLINE.has(w.toLowerCase()))) {
    // A script by name; inline code (`node -e "…"`) is just the interpreter.
    const script = words.slice(1).find(w => isArg(w) && !/^["']/.test(w));
    if (script) key = `${p} ${script}`;
  }
  key = key.slice(0, KEY_CHARS);
  return key && !/[\u0000-\u001f\u007f]/.test(key) ? key : null;
}

/** The shell and MCP calls in one transcript line: [{ id, key, mcp? }], or null. An MCP call's key is its tool's name. */
function shellCallsIn(line) {
  if (typeof line !== 'string' || !line.includes('"tool_use"') || !SHELL_TOOL.test(line)) return null;
  let ev;
  try { ev = JSON.parse(line); } catch { return null; }
  const content = ev?.message?.content;
  if (!Array.isArray(content)) return null;
  const out = [];
  for (const b of content) {
    if (b?.type !== 'tool_use' || typeof b.id !== 'string') continue;
    if (typeof b.name === 'string' && MCP_NAME.test(b.name)) { out.push({ id: b.id, key: b.name, mcp: true }); continue; }
    if (!SHELLS.has(b.name)) continue;
    const key = commandKey(b.input?.command);
    if (key) out.push({ id: b.id, key });
  }
  return out.length ? out : null;
}

/** Characters of text in a tool result's content (a string, or text blocks). */
function textChars(content) {
  if (typeof content === 'string') return content.length;
  if (!Array.isArray(content)) return 0;
  return content.reduce((n, c) => n + (c?.type === 'text' && typeof c.text === 'string' ? c.text.length : 0), 0);
}

/**
 * The results, in one transcript line, of shell calls still waiting for theirs:
 * [{ id, key, chars }], or null. pending: Map id -> key, from shellCallsIn.
 * Lines that name none of them aren't parsed.
 */
function resultsIn(line, pending) {
  if (typeof line !== 'string' || !pending?.size || !line.includes('"tool_result"')) return null;
  let named = false;
  for (const id of pending.keys()) if (line.includes(id)) { named = true; break; }
  if (!named) return null;
  let ev;
  try { ev = JSON.parse(line); } catch { return null; }
  const content = ev?.message?.content;
  if (!Array.isArray(content)) return null;
  const out = [];
  for (const b of content) {
    if (b?.type !== 'tool_result' || !pending.has(b.tool_use_id)) continue;
    out.push({ id: b.tool_use_id, key: pending.get(b.tool_use_id), chars: textChars(b.content) });
  }
  return out.length ? out : null;
}

// What the quiet-output hook (hooks/recipes.js) prints when it shortens a command.
const QUIETED = ['2>&1 | tail -n 60', 'git log --oneline -n 30'];

/**
 * Did the quiet-output hook shorten a command in this transcript line? Its
 * run is recorded between the call and its result, so the call still waiting
 * for its result is the one it shortened.
 */
function rewroteIn(line) {
  if (typeof line !== 'string' || !line.includes('"hook_success"') || !line.includes('updatedInput')) return false;
  let ev;
  try { ev = JSON.parse(line); } catch { return false; }
  const out = ev?.attachment?.stdout;
  return ev?.attachment?.hookEvent === 'PreToolUse' && typeof out === 'string' && out.includes('"updatedInput"') && QUIETED.some(q => out.includes(q));
}

const charsOf = chars => (Number.isFinite(chars) && chars > 0 ? chars : 0);

/**
 * Add one conversation's shell results to the tally (Map key -> { key, runs,
 * chars, sessions, quietRuns, quietChars }). A run the hook shortened
 * (quiet) counts apart, for what it saved. Returns a new tally.
 */
function tallyLoud(tally, outputs) {
  const next = new Map(tally);
  const seen = new Set();
  for (const { key, chars, quiet } of outputs) {
    const t = next.get(key) || { key, runs: 0, chars: 0, sessions: 0, quietRuns: 0, quietChars: 0 };
    next.set(key, quiet
      ? { ...t, quietRuns: (t.quietRuns || 0) + 1, quietChars: (t.quietChars || 0) + charsOf(chars) }
      : { ...t, runs: t.runs + 1, chars: t.chars + charsOf(chars), sessions: t.sessions + (seen.has(key) ? 0 : 1) });
    seen.add(key);
  }
  return next;
}

/**
 * What the quiet-output hook saved: { runs, tokens }, or null when it hasn't
 * run. A shortened run saved what that command's full runs put in, on average,
 * less what it did put in; a command never seen in full adds to runs only.
 * @param {Map<string, { runs: number, chars: number, quietRuns?: number, quietChars?: number }>} tally
 */
function quietSavings(tally) {
  let runs = 0, chars = 0;
  for (const t of tally.values()) {
    if (!t.quietRuns) continue;
    runs += t.quietRuns;
    if (t.runs) chars += t.quietRuns * Math.max(0, t.chars / t.runs - t.quietChars / t.quietRuns);
  }
  return runs ? { runs, tokens: Math.round(chars / CHARS_PER_TOKEN) } : null;
}

/**
 * The commands (or, with mcp, the MCP tools) worth a word: in MIN_SESSIONS
 * or more conversations, with LOUD_TOKENS or more a run on average, the most
 * output in all first. -> [{ key, runs, sessions, tokens (a run, on average), total }]
 * @param {Map<string, { key: string, runs: number, chars: number, sessions: number }>} tally
 * @param {{ mcp?: boolean }} [opts]
 */
function loudest(tally, { mcp = false } = {}) {
  return [...tally.values()]
    .filter(t => t.key.startsWith('mcp__') === mcp)
    .map(t => ({ ...t, tokens: Math.round(t.chars / Math.max(1, t.runs) / CHARS_PER_TOKEN), total: Math.round(t.chars / CHARS_PER_TOKEN) }))
    .filter(t => t.sessions >= MIN_SESSIONS && t.tokens >= LOUD_TOKENS)
    .sort((a, b) => (b.total - a.total) || a.key.localeCompare(b.key))
    .slice(0, TOP)
    .map(({ key, runs, sessions, tokens, total }) => ({ key, runs, sessions, tokens, total }));
}

module.exports = { commandKey, shellCallsIn, resultsIn, rewroteIn, textChars, tallyLoud, quietSavings, loudest, LOUD_TOKENS, MIN_SESSIONS };
