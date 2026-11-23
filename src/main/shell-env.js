// An app opened from Finder or the Dock on a Mac starts with launchd's PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), not the one your terminal has. Claude Code,
// and the git, node and npm it runs, live in Homebrew's or nvm's folders, so
// Shellby asks your login shell for its PATH once, as he starts, and adds
// what's missing. Windows apps get the user's PATH already: nothing to do.
//
// mergePath and pick are pure (test/shell-env.test.js).
'use strict';

const { spawnSync } = require('child_process');
const { userShell } = require('./shells');

const TIMEOUT_MS = 4000;
const START = '__SHELLBY_PATH_START__';
const END = '__SHELLBY_PATH_END__';
// Where a Mac keeps command-line tools even when a profile doesn't say so.
const USUAL = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin'];

/** The PATH between the markers in a shell's output (profiles may print their own lines). */
function pick(output) {
  const text = String(output || '');
  const a = text.indexOf(START), b = text.indexOf(END);
  return a !== -1 && b > a ? text.slice(a + START.length, b).trim() : '';
}

/**
 * Ours first, as it was, then the shell's folders and the usual ones that
 * weren't on it. Only absolute folders, each once.
 */
function mergePath(current, fromShell, usual = USUAL) {
  const seen = new Set();
  const out = [];
  for (const dir of [...String(current || '').split(':'), ...String(fromShell || '').split(':'), ...usual]) {
    if (!dir.startsWith('/') || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(':');
}

/**
 * Fill in process.env.PATH from your login shell. Never throws, and never
 * waits longer than TIMEOUT_MS: a slow or broken profile leaves the usual folders added.
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, run?: typeof spawnSync }} [opts]
 */
function adoptShellPath({ env = process.env, platform = process.platform, run = spawnSync } = {}) {
  if (platform !== 'darwin') return false;
  let fromShell = '';
  try {
    const r = run(userShell(env), ['-ilc', `printf '%s%s%s' '${START}' "$PATH" '${END}'`], {
      encoding: 'utf8', timeout: TIMEOUT_MS, env: { ...env, SHELLBY_PATH_PROBE: '1' }, stdio: ['ignore', 'pipe', 'ignore'],
    });
    fromShell = pick(r.stdout);
  } catch { /* the usual folders still go on */ }
  env.PATH = mergePath(env.PATH, fromShell);
  return !!fromShell;
}

module.exports = { adoptShellPath, mergePath, pick, USUAL };
