// "Continue in terminal" on a Mac: the same conversations, checks and words as
// handoff.js, opened in Terminal (or whichever app opens .command files for you).
//
// The script is a file of Shellby's own, readable by you alone, that deletes
// itself as it starts. Everything put in it is a checked id or path, or one of
// handoff.js's fixed arguments, and each goes in as a single-quoted shell word,
// which the shell never reads into. Pure but for launchMac.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const OPEN = '/usr/bin/open';

/** One single-quoted shell word: nothing in it is expanded or run. */
const shQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * The script the terminal runs. args: the CLI's arguments, already checked
 * (handoff.js decides them: --resume <id>, a fixed prompt, a cloud flag).
 * @param {{ exe: string, cwd: string, args: string[], scrub?: string[] }} what
 */
function terminalScript({ exe, cwd, args, scrub = [] }) {
  const drop = [...new Set(['SHELLBY_OWNED', ...scrub])].filter(v => ENV_NAME.test(v));
  return [
    '#!/bin/bash',
    '# Written by Shellby to carry a conversation on here. It deletes itself.',
    'rm -f -- "$0"',
    ...(drop.length ? [`unset ${drop.join(' ')}`] : []),
    `cd -- ${shQuote(cwd)} || exit 1`,
    `exec ${[exe, ...args].map(shQuote).join(' ')}`,
    '',
  ].join('\n');
}

/** The ssh line for a terminal on another computer (wiring/remote.js). @param {string} ssh @param {string[]} args */
function sshScript(ssh, args) {
  return ['#!/bin/bash', 'rm -f -- "$0"', `exec ${[ssh, ...args].map(shQuote).join(' ')}`, ''].join('\n');
}

/**
 * Write the script and open it. -> { ok: true, shell: 'terminal' } | { ok: false, error }
 * @param {string} script
 * @param {{ spawn: Function, dir?: string, fsm?: typeof fs }} io
 */
function launchMac(script, { spawn, dir = path.join(os.tmpdir(), 'shellby-terminal'), fsm = fs }) {
  try {
    fsm.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${crypto.randomBytes(8).toString('hex')}.command`);
    fsm.writeFileSync(file, script, { mode: 0o700, flag: 'wx' });
    const child = spawn(OPEN, [file], { detached: true, stdio: 'ignore' });
    child.on?.('error', () => { /* open itself is always there */ });
    child.unref?.();
    return Promise.resolve({ ok: true, shell: 'terminal' });
  } catch (e) {
    return Promise.resolve({ ok: false, error: `Couldn't open a terminal: ${e.message}` });
  }
}

module.exports = { shQuote, terminalScript, sshScript, launchMac };
