// git for the copies (worktrees/index.js, push.js, remote.js): fixed arguments,
// short timeouts, nothing thrown to the caller, and a folder on another computer
// (remote/service.js) run over there. Also how git's words are read back: the
// first line of a refusal, the last few lines of a hook's.
const { execFileTree: execFile } = require('../exec-tree'); // a timeout ends git's whole tree
const fs = require('fs');
const path = require('path');

// For the commits Shellby makes of Claude's work, and the merge that brings
// them home: no hooks. Claude can edit a tracked hook (.husky/pre-commit) in
// Auto-edit without a prompt, and git would then run it with your rights when
// you click. A push stays yours: its hooks run as from a terminal.
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null'];
// What execFile says when there's no git to run.
const NO_GIT = /\bENOENT\b|not recognized as an internal or external command/i;
// Branch and remote names as git would print them; nothing that reads as an option.
const REF = /^(?!-)(?!.*\.\.)[\w./-]{1,200}$/;

// Folders on another computer (remote/service.js): their stand-ins on this PC
// are what a tab and a copy record hold, and git for them runs over there.
//   { placeOf(cwd), git(place, args, opts), copyHome(host, id), tidyCopyHome(host, id), addCopy(host, dir), dropCopy(anchor) }
/** @type {any} */
let remote = null;
/** Hands this module the remote service (wiring/remote.js). null: none. */
function setRemote(r) { remote = r || null; }
/** The remote service as it is now (remote.js reads it when used, never at load). */
const remoteService = () => remote;
const placeOf = dir => (remote && typeof dir === 'string' ? remote.placeOf(dir) : null);

// fsmonitor off: a repository's own config could name a program to run on
// every status (one Shellby never asked for).
function git(cwd, args, { timeout = 30000, env = {} } = {}) {
  const place = placeOf(cwd);
  if (place) return remote.git(place, args, { timeout, env });
  return new Promise(resolve => {
    execFile('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
      windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8',
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' },
    }, (err, stdout, stderr) => resolve(err
      ? { ok: false, out: String(stdout || ''), error: String(stderr || err.message).trim() }
      : { ok: true, out: String(stdout) }));
  });
}

// The full spelling of a path that exists (8.3 short names expanded), or the
// path as given if it doesn't yet.
const longPath = p => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };

const firstLine = s => String(s || '').trim().split('\n').filter(Boolean).pop() || '';
const lastLines = (s, n = 15) => String(s || '').trim().split('\n').filter(Boolean).slice(-n).join('\n');

module.exports = { git, setRemote, remoteService, placeOf, longPath, firstLine, lastLines, NO_HOOKS, NO_GIT, REF };
