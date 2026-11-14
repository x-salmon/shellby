const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveShim, findCommand } = require('../src/main/harness/launch');

const NPM = 'C:\\Users\\me\\AppData\\Roaming\\npm';

const EXE_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.exe"   %*`;

const SCRIPT_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@google\\gemini-cli\\bundle\\gemini.js" %*`;

test('a shim that runs an .exe names that .exe', () => {
  assert.deepEqual(resolveShim(EXE_SHIM, NPM), { kind: 'exe', file: path.join(NPM, 'node_modules\\@openai\\codex\\bin\\codex.exe') });
});

test('a shim that runs a script names the script, not node.exe', () => {
  assert.deepEqual(resolveShim(SCRIPT_SHIM, NPM), { kind: 'script', file: path.join(NPM, 'node_modules\\@google\\gemini-cli\\bundle\\gemini.js') });
});

test("a shim can't point outside its own folder, and anything else isn't a shim", () => {
  assert.equal(resolveShim('"%dp0%\\..\\..\\Windows\\evil.exe" %*', NPM), null);
  assert.equal(resolveShim('echo hello', NPM), null);
  assert.equal(resolveShim('', NPM), null);
});

function fakeFs(files) {
  const set = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));
  return { exists: p => set.has(p.toLowerCase()), read: p => set.get(p.toLowerCase()) };
}

test('finds a script CLI through its shim and runs it with node from PATH', () => {
  const fs = fakeFs({
    [path.join(NPM, 'gemini.cmd')]: SCRIPT_SHIM,
    [path.join(NPM, 'node_modules\\@google\\gemini-cli\\bundle\\gemini.js')]: '',
    'C:\\Program Files\\nodejs\\node.exe': '',
  });
  const r = findCommand('gemini', { env: { PATH: 'C:\\Program Files\\nodejs', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, ...fs });
  assert.deepEqual(r, { file: 'C:\\Program Files\\nodejs\\node.exe', prefix: [path.join(NPM, 'node_modules\\@google\\gemini-cli\\bundle\\gemini.js')] });
});

test('a plain .exe on PATH wins, and nothing is found for a missing CLI or an odd name', () => {
  const fs = fakeFs({ 'C:\\Users\\me\\.local\\bin\\aider.exe': '' });
  const env = { PATH: 'C:\\Users\\me\\.local\\bin' };
  assert.deepEqual(findCommand('aider', { env, ...fs }), { file: 'C:\\Users\\me\\.local\\bin\\aider.exe', prefix: [] });
  assert.equal(findCommand('opencode', { env, ...fs }), null);
  assert.equal(findCommand('..\\x', { env, ...fs }), null);
  assert.equal(findCommand('a & calc', { env, ...fs }), null);
});

test("a script shim whose target is gone, or with no node anywhere, isn't found", () => {
  const env = { PATH: '', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' };
  assert.equal(findCommand('gemini', { env, ...fakeFs({ [path.join(NPM, 'gemini.cmd')]: SCRIPT_SHIM }) }), null);
  assert.equal(findCommand('gemini', { env, ...fakeFs({ [path.join(NPM, 'gemini.cmd')]: SCRIPT_SHIM, [path.join(NPM, 'node_modules\\@google\\gemini-cli\\bundle\\gemini.js')]: '' }) }), null);
});
