// Which shell runs a command line, on Windows and on macOS, always by full path:
// Shellby works in project folders, and one could hold a program of that name.
const fs = require('fs');
const { CMD, POWERSHELL } = require('./system32');

// The shells that take `-l -c`. Anything else set as a login shell (fish, nu) has
// a syntax of its own, or other flags, so the Mac's default runs the command.
const POSIX_SHELL = /^\/(?:[\w.-]+\/)*(zsh|bash)$/;
const DEFAULT_SHELL = '/bin/zsh';
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** Your own shell on macOS, if it's one that can be given a command. @param {NodeJS.ProcessEnv} [env] @param {(p: string) => boolean} [exists] */
function userShell(env = process.env, exists = isFile) {
  const s = env.SHELL || '';
  if (POSIX_SHELL.test(s) && exists(s)) return s;
  return exists(DEFAULT_SHELL) ? DEFAULT_SHELL : '/bin/sh';
}

/**
 * A command line Shellby itself put together, in the plain shell, with no profile.
 * /d: no AutoRun; /s /c "...": the command exactly as given.
 * @param {string} command @param {string} [platform]
 */
function shellPlan(command, platform = process.platform) {
  if (platform !== 'win32') return { file: '/bin/sh', args: ['-c', command], verbatim: false };
  return { file: CMD, args: ['/d', '/s', '/c', `"${command}"`], verbatim: true };
}

/**
 * A command you typed, in the shell you'd expect: PowerShell on Windows (its
 * output in UTF-8, so names come back intact), your own on macOS.
 * @param {string} command @param {{ platform?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
function typedPlan(command, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { file: userShell(env), args: ['-c', command] };
  return {
    file: POWERSHELL,
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ${command}`],
  };
}

module.exports = { userShell, shellPlan, typedPlan };
