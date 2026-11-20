// When a conversation moves into its copy (worktrees/index.js).
//
// A conversation starts in your checkout, and only moves into a copy the first
// time it goes to change something. Asking a question makes no branch, and by
// the time one is needed Claude knows enough about the work to name it. Pure.
const path = require('path');

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
// Commands that only look. Anything not on this list counts as work, so a
// command Shellby doesn't recognise moves the conversation into its copy
// rather than running in your checkout.
const LOOKS = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'find', 'fd', 'pwd', 'echo', 'printf',
  'wc', 'which', 'where', 'tree', 'file', 'stat', 'du', 'df', 'sort', 'cut', 'tr', 'jq', 'diff', 'cd', 'true', 'printenv', 'whoami', 'hostname', 'basename', 'dirname', 'realpath', 'readlink', 'sed',
  'get-childitem', 'gci', 'get-content', 'gc', 'select-string', 'sls', 'get-location', 'set-location', 'test-path', 'resolve-path',
  'get-item', 'measure-object', 'select-object', 'where-object', 'sort-object', 'format-table', 'format-list', 'write-output', 'out-string',
]);
const GIT_LOOKS = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'describe', 'shortlog', 'reflog', 'grep',
  'cat-file', 'merge-base', 'name-rev', 'for-each-ref', 'rev-list', 'whatchanged', 'count-objects',
]);
// Redirects that throw output away rather than writing a file.
const HARMLESS_REDIRECT = /\d?>\s*&\s*\d|\d?>\s*(\/dev\/null|\$null|nul)\b/gi;

function gitLooks(words) {
  let i = 1;
  while (words[i] === '--no-pager' || words[i] === '-C' || /^-c$/.test(words[i])) i += words[i] === '--no-pager' ? 1 : 2;
  const sub = words[i];
  const rest = words.slice(i + 1);
  if (GIT_LOOKS.has(sub)) return true;
  // `git branch foo` and `git tag v1` make one; listing them doesn't.
  if (sub === 'branch') return rest.every(w => /^(-a|-r|-v|-vv|-l|--list|--all|--remotes|--show-current)$/.test(w));
  if (sub === 'tag') return rest.length === 0 || rest.some(w => /^(-l|--list)$/.test(w));
  if (sub === 'remote') return rest.length === 0 || /^(-v|show|get-url)$/.test(rest[0]);
  if (sub === 'config') return rest.some(w => /^(--get|--get-all|--list|-l)$/.test(w));
  if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show';
  return false;
}

/** True when a shell command only reads. Conservative: unsure means no. Pure. */
function onlyLooks(command) {
  const cmd = String(command || '').replace(HARMLESS_REDIRECT, ' ');
  if (!cmd.trim() || /[>`]|\$\(|<\(/.test(cmd)) return false;
  return cmd.split(/&&|\|\||[;|\n]/).every(part => {
    const words = part.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const name = path.basename(words[0].replace(/^["']|["']$/g, '')).toLowerCase().replace(/\.exe$/, '');
    if (name === 'git') return gitLooks(words);
    if (name === 'sed') return !words.some(w => /^-[a-z]*i|^--in-place/.test(w));
    if (name === 'sort') return !words.some(w => /^-[a-z]*o|^--output/.test(w));
    if (name === 'find' || name === 'fd') return !words.some(w => /^-(delete|exec|execdir|ok|fprint)|^--exec/.test(w));
    if (/^(node|npm|python|python3|py|java|go|cargo|dotnet)$/.test(name)) return words.length === 2 && /^(-v|--version|version)$/.test(words[1]);
    return LOOKS.has(name);
  });
}

/** Would this tool call change files? (PreToolUse hook input). Pure. */
function startsWork(toolName, input) {
  if (EDIT_TOOLS.has(toolName)) return true;
  if (SHELL_TOOLS.has(toolName)) return !onlyLooks(input?.command);
  return false;
}

module.exports = { startsWork, onlyLooks };
