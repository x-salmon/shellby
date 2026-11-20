// Engineer mode's gate (docs/ENGINEER.md, "The gate"): what Claude may do at
// each point, asked first by the work hook (PreToolUse) for every tool call,
// helpers' included. Pure: the conversation's side (wiring/engineer.js) hands
// it the state and where the conversation works.
//
//   no approved decision  only looking around, plus the project's own checks
//                         and the commands you allowed for the project
//   a spike running       anything local: every change is put back after, so
//                         nothing that leaves the folder (pushes, commits,
//                         other MCP servers, hand-offs)
//   approved              file edits only inside the scope (amendments too);
//                         shell commands run, and the diff check catches
//                         what they wrote outside it
//
// Also the diff check itself: which of the files the work touched were inside
// the scope (audit).
const path = require('path');
const { RECORD_DIR, line, scopeOf, pendingAmendment } = require('./engineer');
const { shellWords, SHELL_TOOLS } = require('./worktrees/looks');

const MAX_ALLOW = 12;
const MAX_COMMAND = 200;

// What Claude may still use with no decision approved: reading, searching,
// asking, planning. Bash and PowerShell go by what the command does
// (worktrees.startsWork). Anything else, an MCP server's included, waits.
const LOOKS = new Set([
  'Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'TodoWrite', 'TodoRead', 'Task', 'Agent',
  'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'ToolSearch', 'Skill', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
  'BashOutput', 'TaskOutput', 'TaskStop', 'KillShell', 'Monitor', 'Bash', 'PowerShell',
]);
const SHELLS = SHELL_TOOLS; // Bash, PowerShell and Monitor (worktrees/looks.js)
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const CRAB = 'mcp__shellby__';
// The crab's tools that change nothing in the project, Engineer mode's own included.
const CRAB_LOOKS = new Set([
  'decide', 'check_decision', 'amend_decision', 'spike', 'end_spike', 'say', 'celebrate', 'wear', 'status', 'note', 'suggest',
  'list_routines', 'list_tasks', 'wait_for_tasks', 'list_chats', 'read_chat', 'list_pages', 'read_page',
]);
// During a spike: what would outlive it. Its files are put back; a commit, a
// push, a publish or a request that changes something elsewhere wouldn't be.
// A guard against slips, not a sandbox: code the spike runs can still reach
// outside the project, which is why the permission modes still apply (and the
// card says so). Read word by word (spikeOutlives), with this pattern over the
// raw text as well, which also catches one inside a string (node -e "...").
const LEAVES_THE_FOLDER = new RegExp([
  String.raw`\bgit\s+(-C\s+\S+\s+)?(commit|push|pull|fetch|merge|rebase|reset|checkout|switch|stash|tag|branch|cherry-pick|revert|am|apply|worktree|clean|restore|remote|config|update-ref|gc|prune|filter-branch|replace|notes|submodule)\b`,
  String.raw`\b(npm|pnpm|yarn|bun)\s+(publish|unpublish|deprecate|login|logout|adduser|token|owner|dist-tag|access)\b`,
  String.raw`\b(gh|glab|az|aws|gcloud|vercel|netlify|fly|heroku|docker\s+push|kubectl)\b`,
  String.raw`\b(curl|wget)\b.*\s(-X\s*(POST|PUT|PATCH|DELETE)|--request\s+(POST|PUT|PATCH|DELETE)|-d\b|--data|-F\b|--form|-T\b|--upload-file)`,
  String.raw`\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b.*-(Method\s+(Post|Put|Patch|Delete)|Body|InFile)`,
].join('|'), 'i');
const GIT_OUTLIVES = new Set(['commit', 'push', 'pull', 'fetch', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'stash', 'tag', 'branch', 'cherry-pick', 'revert', 'am', 'apply', 'worktree', 'clean', 'restore', 'remote', 'config', 'update-ref', 'gc', 'prune', 'filter-branch', 'filter-repo', 'replace', 'notes', 'submodule', 'send-email', 'request-pull', 'daemon', 'svn', 'p4']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx', 'pip', 'pip3', 'cargo', 'gem', 'twine', 'poetry', 'dotnet', 'nuget', 'mvn', 'gradle']);
const PACKAGE_OUTLIVES = /^(publish|unpublish|deprecate|login|logout|adduser|token|owner|dist-tag|access|upload|push|yank)$/;
const REACHES_OUT = new Set(['gh', 'glab', 'az', 'aws', 'gcloud', 'vercel', 'netlify', 'fly', 'flyctl', 'heroku', 'kubectl', 'helm', 'terraform', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'git-lfs']);
// Interpreters that take code inline: that code is read the same way.
const INLINE = { node: ['-e', '--eval', '-p', '--print'], deno: ['eval'], python: ['-c'], python3: ['-c'], py: ['-c'], bash: ['-c'], sh: ['-c'], zsh: ['-c'], pwsh: ['-c', '-command'], powershell: ['-c', '-command'], cmd: ['/c', '/k'] };

function curlSends(words) {
  return words.some((w, i) => /^(-d|--data.*|-F|--form.*|-T|--upload-file|--json)$/i.test(w) || /^-[a-zA-Z]*[dFT]$/.test(w)
    || (/^(-X|--request)$/i.test(w) && /^(POST|PUT|PATCH|DELETE)$/i.test(words[i + 1] || '')) || /^-X(POST|PUT|PATCH|DELETE)$/i.test(w));
}

/** One command's words -> would what it does outlive the spike? */
function segmentOutlives(words, depth) {
  const name = path.basename(words[0]).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
  if (name === 'git') {
    let i = 1;
    while (words[i] === '-C') i += 2;
    // Any other global option (-c, --git-dir, --exec-path ...) could point git anywhere.
    if (!words[i] || words[i].startsWith('-')) return true;
    return GIT_OUTLIVES.has(words[i].toLowerCase());
  }
  if (PACKAGE_MANAGERS.has(name)) return words.slice(1).some(w => PACKAGE_OUTLIVES.test(w.toLowerCase()));
  if (REACHES_OUT.has(name)) return true;
  if (name === 'docker' || name === 'podman') return words.some(w => /^(push|login)$/i.test(w));
  if (name === 'curl' || name === 'wget') return curlSends(words);
  if (/^(invoke-webrequest|invoke-restmethod|iwr|irm)$/.test(name)) return words.some(w => /^-(method|body|infile)$/i.test(w));
  const inline = INLINE[name];
  if (!inline) return false;
  // PowerShell's encoded command can't be read at all.
  if ((name === 'pwsh' || name === 'powershell') && words.some(w => /^-(e|ec|enc|encodedcommand)$/i.test(w))) return true;
  const at = words.findIndex(w => inline.includes(w.toLowerCase()));
  return at > 0 && spikeOutlives(words.slice(at + 1).join(' '), depth + 1);
}

/** A shell command -> would it outlive the spike (a commit, a push, a publish, a request elsewhere)? Pure. */
function spikeOutlives(command, depth = 0) {
  const cmd = String(command || '');
  if (depth > 3 || LEAVES_THE_FOLDER.test(cmd)) return true;
  for (const part of cmd.split(/&&|\|\||[;|\n&]/)) {
    const words = shellWords(part);
    if (!words) return true;
    if (words.length && segmentOutlives(words, depth)) return true;
  }
  return false;
}

/** The hook output that holds a tool call back, saying why. */
const deny = why => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } });

/** What the hook answers when the gate itself failed: no, rather than a step nobody checked. */
const gateFailed = () => deny('Engineer mode could not check this step, so it was held back. Try it again; if it keeps happening, the user can turn Engineer mode off.');

/** Whether a tool call may run with no decision approved: it only looks around. */
function looks(toolName, toolInput, startsWork) {
  const tool = String(toolName || '');
  if (startsWork(tool, toolInput)) return false;
  if (tool.startsWith(CRAB)) return CRAB_LOOKS.has(tool.slice(CRAB.length));
  return LOOKS.has(tool);
}

// ------------------------------------------------------------------ scope

/**
 * A scope path -> a RegExp for root-relative paths (forward slashes, lower
 * case). "src/cache.js" is that file; "src/cache" or "src/cache/" the folder
 * and everything in it; * is any name, ** any depth, ? one character. Pure.
 */
function scopeRe(pattern) {
  const p = String(pattern).toLowerCase().replace(/\/+$/, '');
  if (p === '**' || p === '*' || p === '') return /^.+$/;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      i++;
      if (p[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A plain name may be a folder: everything under it counts.
  return new RegExp(`^${re}(?:/.*)?$`);
}

/** Is this root-relative path inside these scope paths? The decision record's folder always is. Pure. */
function inScope(patterns, rel) {
  const r = String(rel || '').replace(/\\/g, '/').toLowerCase();
  if (!r) return false;
  if (r.startsWith(`${RECORD_DIR}/`)) return true;
  return patterns.some(p => scopeRe(p).test(r));
}

/**
 * An absolute path -> relative to whichever root holds it (forward slashes,
 * lower case), or null when it's in none of them. Roots: the copy, the
 * checkout it came from, the folder at approval. Pure (path only).
 */
// A relative path that climbs out of its root (.. itself, or ..\ first), or
// another drive. A folder called ..foo doesn't.
const outsideOf = rel => rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

function relIn(roots, abs) {
  for (const root of roots) {
    if (typeof root !== 'string' || !root) continue;
    const rel = path.relative(path.resolve(root), path.resolve(abs));
    if (rel === '') return '';
    if (!outsideOf(rel)) return rel.split(path.sep).join('/').toLowerCase();
  }
  return null;
}

const under = (dirs, abs) => dirs.some(dir => {
  if (typeof dir !== 'string' || !dir) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(abs));
  return !outsideOf(rel);
});

/** The file a file tool writes, as an absolute path, or null. */
function fileOf(toolInput, cwd) {
  const p = toolInput?.file_path ?? toolInput?.notebook_path;
  if (typeof p !== 'string' || !p) return null;
  return path.resolve(cwd || '.', p);
}

/**
 * The commands you let Claude run before a decision in a project (Settings,
 * the note under the box): one line each, blanks squeezed, no repeats. Pure.
 */
function readAllow(v) {
  const out = (Array.isArray(v) ? v : []).map(c => (typeof c === 'string' && c.length <= MAX_COMMAND ? line(c, MAX_COMMAND) : '')).filter(Boolean);
  return [...new Set(out)].slice(0, MAX_ALLOW);
}

/** A command the project allows before a decision, as typed (blanks squeezed). Pure. */
function allowedBefore(before, command) {
  // A line break makes it two commands (deploy.sh, then --dry-run on its own): never a match.
  if (/[\r\n]/.test(String(command || ''))) return false;
  const c = String(command || '').trim().replace(/[ \t]+/g, ' ');
  if (!c) return false;
  const same = c === 'npm test' ? 'npm run test' : c;
  return (before || []).some(b => b === c || b === same);
}

// ------------------------------------------------------------------ the gate

/**
 * After approval: a file edit inside the scope goes through, one outside it
 * waits for an amendment. Paths outside the project are allowed only in the
 * places Claude keeps its own things (ctx.outside: temp, ~/.claude).
 */
function scopeGate(d, toolName, toolInput, ctx) {
  if (!FILE_TOOLS.has(toolName)) return null;
  const abs = fileOf(toolInput, ctx.cwd);
  if (!abs) return null;
  const rel = relIn(ctx.roots, abs);
  if (rel === null) {
    if (under(ctx.outside || [], abs)) return null;
    return deny(`Engineer mode: ${abs} is outside the project, and the approved decision covers only files inside it. Call mcp__shellby__amend_decision if the work truly needs it, and end your turn.`);
  }
  const scope = scopeOf(d);
  // .git and .claude can run code (hooks, settings): only a scope that names
  // them reaches them, never a ** on its own.
  if (/^\.(git|claude)(\/|$)/.test(rel) && !scope.some(p => !p.startsWith('*') && inScope([p], rel))) {
    return deny(`Engineer mode: ${rel} can change how git or Claude Code runs, so only a scope that names it covers it. Call mcp__shellby__amend_decision with it if the work truly needs it.`);
  }
  if (inScope(scope, rel)) return null;
  if (pendingAmendment(d)) return deny(`Engineer mode: ${rel} is outside the approved scope, and the amendment asking for more is still waiting on the user's card. End your turn and wait for their answer.`);
  return deny(`Engineer mode: ${rel} is outside the approved scope (${scope.join(', ')}). If the work needs it, call mcp__shellby__amend_decision with add_scope and why, then end your turn. Otherwise keep to the scope.`);
}

/** During a spike: anything local, nothing that would outlive the spike. */
function spikeGate(toolName, toolInput, ctx) {
  const tool = String(toolName || '');
  if (tool.startsWith(CRAB)) {
    return CRAB_LOOKS.has(tool.slice(CRAB.length)) ? null : deny('Engineer mode: during a spike, only changes that can be put back. This tool reaches outside the project.');
  }
  if (tool.startsWith('mcp__')) return deny('Engineer mode: during a spike, another MCP server\'s tools are held back: what they change can\'t be put back with the spike.');
  if (SHELLS.has(tool) && spikeOutlives(toolInput?.command)) {
    return deny('Engineer mode: during a spike, no commits, pushes, branch changes, publishing or requests that change things elsewhere: those would outlive the spike. Try it in the files only.');
  }
  if (FILE_TOOLS.has(tool)) {
    const abs = fileOf(toolInput, ctx.cwd);
    if (abs && relIn(ctx.roots, abs) === null && !under(ctx.outside || [], abs)) {
      return deny(`Engineer mode: ${abs} is outside the project, so the spike couldn't put it back. Keep the spike inside the project.`);
    }
  }
  return null;
}

/**
 * The work hook's answer while Engineer mode is on. state: { on, decision,
 * spike }. startsWork(tool, input): whether the call changes files
 * (worktrees.startsWork). ctx: { cwd, roots, outside, before } where the
 * conversation works, and the commands allowed before a decision.
 * -> hook output, or null to let it through.
 */
function gate(state, toolName, toolInput, startsWork, ctx = {}) {
  if (!state?.on) return null;
  const c = { cwd: ctx.cwd || null, roots: ctx.roots || [], outside: ctx.outside || [], before: ctx.before || [] };
  const spike = state.spike?.phase;
  if (spike === 'running' || spike === 'ending') return spikeGate(toolName, toolInput, c);
  const d = state.decision;
  if (d?.phase === 'approved') return scopeGate(d, String(toolName || ''), toolInput, c);
  if (looks(toolName, toolInput, startsWork)) return null;
  if (SHELLS.has(String(toolName)) && allowedBefore(c.before, toolInput?.command)) return null;
  if (spike === 'asked') return deny('Engineer mode: the spike is still waiting on the user\'s card. End your turn and wait for their answer before changing anything.');
  const why = d?.phase === 'proposed'
    ? 'Engineer mode: the decision is still waiting on the user\'s card. End your turn and wait for their answer before changing anything.'
    : 'Engineer mode: no approved decision covers this step. Call mcp__shellby__decide with your decision, end your turn, and wait for the user to approve it. (To find something out by trying it first, call mcp__shellby__spike.)';
  return deny(why);
}

// ------------------------------------------------------------------ the diff check

/**
 * The files the work really touched (root-relative, from each turn's diff)
 * against the scope as it stood. -> { files, unplanned }: how many, and the
 * ones outside it (the decision record's folder never counts). Pure.
 */
function audit(d, touched) {
  const scope = scopeOf(d);
  const files = [...new Set((touched || []).map(p => String(p).replace(/\\/g, '/')))];
  return { files: files.length, unplanned: files.filter(p => !inScope(scope, p)) };
}

module.exports = { LOOKS, CRAB_LOOKS, FILE_TOOLS, LEAVES_THE_FOLDER, MAX_ALLOW, spikeOutlives, deny, gateFailed, looks, scopeRe, inScope, relIn, readAllow, allowedBefore, gate, audit };
