// Installing Claude Code from onboarding (src/main/claude/install.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const I = require('../src/main/claude/install');
const { POWERSHELL } = require('../src/main/system32');

test('runs Anthropic’s own installer through PowerShell by its full path', () => {
  const { exe, args } = I.installCommand();
  assert.equal(exe, POWERSHELL);
  assert.ok(path.isAbsolute(exe), 'never a bare name a project folder could shadow');
  assert.ok(args.includes('-NoProfile') && args.includes('-NonInteractive'));
  assert.equal(args.at(-1), `irm ${I.INSTALLER_URL} | iex`);
  assert.equal(I.INSTALLER_URL, 'https://claude.ai/install.ps1');
});

test('says the installer timed out when it ran too long', () => {
  assert.match(I.installFailure({ code: null, timedOut: true, stderr: '' }), /10 minutes/);
});

test('says the network is the problem when claude.ai can’t be reached', () => {
  assert.match(I.installFailure({ code: 1, stderr: 'The remote name could not be resolved: claude.ai' }), /couldn't reach claude\.ai/);
});

test('otherwise passes on the last lines the installer printed', () => {
  const msg = I.installFailure({ code: 1, stderr: 'one\r\ntwo\r\nthree\r\nfour\r\n' });
  assert.equal(msg, 'The installer stopped (exit 1): two three four');
  assert.equal(I.installFailure({ code: 2, stderr: '' }), 'The installer stopped (exit 2).');
});
