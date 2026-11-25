const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { run, contextFor } = require('../src/main/shellcmd');

test('contextFor: what you ran goes to Claude in the terminal shell mode tags', () => {
  const text = contextFor([{ command: 'git status', output: 'clean', code: 0 }, { command: 'npm test', output: 'boom', code: 1 }]);
  assert.match(text, /<bash-input>git status<\/bash-input>\n<bash-stdout>clean<\/bash-stdout>\n<bash-stderr><\/bash-stderr>/);
  assert.match(text, /<bash-input>npm test<\/bash-input>[\s\S]*\(exit code 1\)/);
  assert.ok(text.endsWith('\n\n'), 'separated from your message');
  assert.equal(contextFor([]), '');
  assert.equal(contextFor(undefined), '');
});

test('run: output and exit code come back', { skip: process.platform !== 'win32' }, async () => {
  const ok = await run(os.tmpdir(), 'Write-Output "hello from shellby"');
  assert.equal(ok.code, 0);
  assert.equal(ok.output, 'hello from shellby');
  const bad = await run(os.tmpdir(), 'Write-Output nope; exit 3');
  assert.equal(bad.code, 3);
  assert.equal(bad.output, 'nope');
});

test('run: a command that runs over is stopped and says so', { skip: process.platform !== 'win32' }, async () => {
  const r = await run(os.tmpdir(), 'Start-Sleep -Seconds 20', { timeoutMs: 1500 });
  assert.equal(r.timedOut, true);
  assert.match(r.output, /stopped after/);
  assert.ok(r.ms < 15000);
});

// A workflow's run step on a Mac (posix: true) gets dash, not your own zsh or bash:
// its values arrive as variables, and dash has no subscripts whose arithmetic runs code.
test('run posix: a Mac workflow step runs in dash, where a value is never code', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
  const fs = require('fs');
  const path = require('path');
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-posix-')));
  try {
    const shell = await run(dir, 'echo "$0"', { posix: true });
    assert.equal(shell.output, fs.existsSync('/bin/dash') ? '/bin/dash' : '/bin/sh');
    // In bash, printf -v with this name would run the subscript's $( ).
    const r = await run(dir, 'echo "$SHELLBY_VALUE_1" && n=$(( 0 )) && echo "$n"', { posix: true, env: { SHELLBY_VALUE_1: 'a[$(touch pwned)]' } });
    assert.equal(r.output.split('\n')[0], 'a[$(touch pwned)]');
    assert.ok(!fs.existsSync(path.join(dir, 'pwned')), 'nothing in the value ran');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
