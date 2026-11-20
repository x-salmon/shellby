// When a conversation's tool call changes files (worktrees/index.js moves it
// into its own copy then; Engineer mode's gate holds it back until a decision
// is approved, engineer-gate.js). Pure.
//
// Conservative on purpose: a command Shellby doesn't recognise counts as work.
// Each word is read the way the shell hands it to the program (shellWords),
// and anything that could read differently to the shell than to this check
// (script blocks, subexpressions, odd quoting, git's own config) counts too.

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Tools that run a shell command: Monitor runs one too, and watches its output.
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Monitor']);
// Commands that only look. Anything not on this list counts as work, so a
// command Shellby doesn't recognise moves the conversation into its copy
// rather than running in your checkout. Not here: pagers (less +!cmd, more)
// and ag (--pager) can run a command; sed is read below, script by script.
const LOOKS = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'fd', 'pwd', 'echo', 'printf',
  'wc', 'which', 'where', 'tree', 'file', 'stat', 'du', 'df', 'sort', 'cut', 'tr', 'jq', 'diff', 'cd', 'true', 'printenv', 'whoami', 'hostname', 'basename', 'dirname', 'realpath', 'readlink',
  'get-childitem', 'gci', 'get-content', 'gc', 'select-string', 'sls', 'get-location', 'set-location', 'test-path', 'resolve-path',
  'get-item', 'measure-object', 'select-object', 'where-object', 'sort-object', 'format-table', 'format-list', 'write-output', 'out-string',
]);
const GIT_LOOKS = new Set([
  'status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'blame', 'describe', 'shortlog', 'grep',
  'cat-file', 'merge-base', 'name-rev', 'for-each-ref', 'rev-list', 'whatchanged', 'count-objects',
]);
// Redirects that throw output away rather than writing a file: 2>&1, >/dev/null,
// > nul, each ending there (>&1.txt and > nul-x are files).
const HARMLESS_REDIRECT = /\d?>\s*&\s*\d+(?=\s|$|[;&|])|\d?>\s*(\/dev\/null|\$null|nul)(?=\s|$|[;&|])/gi;

const GIT_RUNS = ['--output', '--open-files-in-pager', '--ext-diff', '--textconv'];
function gitRuns(word) {
  if (/^-[a-zA-Z]*O/.test(word)) return true;
  const long = word.split('=')[0];
  return long.length > 2 && long.startsWith('--') && GIT_RUNS.some(opt => opt.startsWith(long) || long.startsWith(opt));
}

/**
 * One command's words the way a shell splits them: quoted text (with its
 * spaces) stays one word, quotes and backslash escapes are taken out. null
 * when a quote is never closed: unsure means no. Pure.
 */
function shellWords(text) {
  const words = [];
  let word = '';
  let has = false;
  let quote = '';
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"' && i + 1 < s.length) word += s[++i];
      else word += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; }
    else if (c === '\\' && i + 1 < s.length) { word += s[++i]; has = true; }
    else if (/\s/.test(c)) { if (has || word) words.push(word); word = ''; has = false; }
    else { word += c; has = true; }
  }
  if (quote) return null;
  if (has || word) words.push(word);
  return words;
}

function gitLooks(words) {
  // Config from the command line, anywhere, can name the program git runs.
  if (words.some(w => w === '-c' || /^--(config-env|exec-path)/.test(w))) return false;
  let i = 1;
  // Only --no-pager and -C <dir> before the subcommand: `-c core.pager=…`,
  // --config-env and --exec-path can each have git run any program.
  while (words[i] === '--no-pager' || words[i] === '-C') i += words[i] === '--no-pager' ? 1 : 2;
  const sub = words[i];
  if (typeof sub !== 'string' || sub.startsWith('-')) return false;
  const rest = words.slice(i + 1);
  // `git diff --output=f` writes a file; `git grep -O<cmd>` runs a command; an
  // external diff or a textconv filter runs one too. git takes any unambiguous
  // start of a long option (--outp, --ext-d), and -O inside a cluster (-iO).
  if (GIT_LOOKS.has(sub)) return !rest.some(gitRuns);
  // `git reflog expire` and `delete` change it; showing it doesn't.
  if (sub === 'reflog') return !rest.some(w => /^(expire|delete)$/.test(w)) && !rest.some(gitRuns);
  // `git branch foo` and `git tag v1` make one; listing them doesn't.
  if (sub === 'branch') return rest.every(w => /^(-a|-r|-v|-vv|-l|--list|--all|--remotes|--show-current)$/.test(w));
  if (sub === 'tag') return rest.length === 0 || rest.some(w => /^(-l|--list)$/.test(w));
  // `git remote -v add n url` adds one: only -v alone, or show / get-url.
  if (sub === 'remote') return rest.every(w => /^(-v|--verbose)$/.test(w)) || /^(show|get-url)$/.test(rest[0]);
  if (sub === 'config') return rest.some(w => /^(--get|--get-all|--list|-l)$/.test(w));
  if (sub === 'stash') return rest[0] === 'list' || rest[0] === 'show';
  return false;
}

// sed only prints lines here: -n and an address with p (1,20p, $p, /re/p).
// Any other script can write a file or run a command (w, e, s///w, s,,,e).
const SED_PRINT = /^((\d+|\$)(,(\d+|\$))?|\/[^/]*\/)p$/;
function sedPrints(args) {
  const flags = args.filter(w => w.startsWith('-'));
  const rest = args.filter(w => !w.startsWith('-'));
  return flags.every(f => f === '-n') && rest.length > 0 && SED_PRINT.test(rest[0]);
}

/** One command's words -> does it only read? */
function wordsLook(words) {
  // A bare name only: ./git or .\ls.exe is whatever file the repo ships by that name.
  if (/[\\/]/.test(words[0])) return false;
  const name = words[0].toLowerCase().replace(/\.exe$/, '');
  if (name === 'git') return gitLooks(words);
  if (name === 'sed') return sedPrints(words.slice(1));
  // GNU tools take any unambiguous start of a long option (--out for --output).
  if (name === 'sort') return !words.some(w => /^-[a-zA-Z]*o|^--(o|c)/.test(w));
  if (name === 'find') return !words.some(w => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)\b/.test(w));
  // fd -x / -X (alone or in a cluster like -Hx) and --exec(-batch) run a command per match.
  if (name === 'fd') return !words.some(w => /^-[a-zA-Z]*[xX]|^--exec/.test(w));
  // rg --pre runs a command on each file, -z its decompressors, --hostname-bin a program.
  if (name === 'rg') return !words.some(w => /^--pre|^-[a-zA-Z]*z|^--search-zip|^--hostname-bin/.test(w));
  if (name === 'tree') return !words.some(w => /^-[a-zA-Z]*o|^--o/.test(w));
  // file -C compiles a magic file: it writes one.
  if (name === 'file') return !words.some(w => /^-[a-zA-Z]*C|^--comp/.test(w));
  if (/^(node|npm|python|python3|py|java|go|cargo|dotnet)$/.test(name)) return words.length === 2 && /^(-v|--version|version)$/.test(words[1]);
  return LOOKS.has(name);
}

/** True when a shell command only reads. Conservative: unsure means no. Pure. */
function onlyLooks(command) {
  const cmd = String(command || '').replace(HARMLESS_REDIRECT, ' ');
  if (!cmd.trim() || /[>`]|\$\(|<\(/.test(cmd)) return false;
  // Outside quotes, a script block ({ }), a subexpression or array (( ), @( ))
  // or a splat can run anything: `Where-Object { Remove-Item $_ }` is a delete.
  // Single-quoted text is literal in both shells; double-quoted text only
  // expands $( ), refused above. Anything that could make a quote mean
  // something else to the shell than to this check is refused first:
  // PowerShell's curly quotes, a backslash before a quote, a comment, and
  // bash's $'...' and $"...", which decode escapes ($'\x2d-ext-diff').
  if (/[\u2018-\u201f#]|\\['"]|\$['"]/.test(cmd)) return false;
  if (/[{}()@]/.test(cmd.replace(/'[^']*'|"[^"]*"/g, ''))) return false;
  // A network path (\\host\share, //host/share): opening one sends this PC's sign-in to that host.
  if (/(^|[\s'"=,])(\\\\|\/\/)/.test(cmd)) return false;
  // A lone & runs what follows too: `ls & touch x` is two commands.
  return cmd.split(/&&|\|\||[;|\n&]/).every(part => {
    // Each word as the program gets it: quoted text with its spaces is one word,
    // and the quotes and backslash escapes are gone ("--ext-diff" is --ext-diff).
    const words = shellWords(part);
    if (!words) return false;
    return !words.length || wordsLook(words);
  });
}

/** Would this tool call change files? (PreToolUse hook input). Pure. */
function startsWork(toolName, input) {
  if (EDIT_TOOLS.has(toolName)) return true;
  if (SHELL_TOOLS.has(toolName)) return !onlyLooks(input?.command);
  return false;
}

module.exports = { SHELL_TOOLS, startsWork, onlyLooks, shellWords };
