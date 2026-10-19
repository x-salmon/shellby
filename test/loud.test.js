const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const loud = require('../src/main/usage/loud');
const hf = require('../src/main/usage/hotfiles');

const call = (cwd, id, command, name = 'Bash') => JSON.stringify({
  type: 'assistant', cwd, message: { content: [{ type: 'tool_use', id, name, input: { command } }] },
});
const result = (id, content) => JSON.stringify({
  type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
});

test('a command is named by what ran, so runs of the same thing add up', () => {
  assert.equal(loud.commandKey('npm run e2e:ci -- queue voice'), 'npm run e2e:ci');
  assert.equal(loud.commandKey('cd /c/work/app && npm test 2>&1 | tail -50'), 'npm test');
  assert.equal(loud.commandKey('git log --oneline -20'), 'git log');
  assert.equal(loud.commandKey('git --no-pager diff'), 'git', 'a flag first: just the program');
  assert.equal(loud.commandKey("$env:ELECTRON_SKIP_BINARY_DOWNLOAD='1'; npm ci"), 'npm ci');
  assert.equal(loud.commandKey('CI=1 pnpm run lint'), 'pnpm run lint');
  assert.equal(loud.commandKey('node scripts/e2e.js --only queue'), 'node scripts/e2e.js');
  assert.equal(loud.commandKey('& "C:\\Program Files\\nodejs\\npm.cmd" test'), 'npm test');
  assert.equal(loud.commandKey('cat package-lock.json'), 'cat');
  assert.equal(loud.commandKey('node -e "console.log(require(1))"'), 'node', 'inline code is not a name');
  assert.equal(loud.commandKey('python -c "print(1)"'), 'python');
  assert.equal(loud.commandKey('ls\nrm -rf x'), 'ls', 'only the first line');
  assert.equal(loud.commandKey('   '), null);
  assert.equal(loud.commandKey(42), null);
});

test('shell calls in a line are found, and other tools are not', () => {
  assert.deepEqual(loud.shellCallsIn(call('C:\\w', 't1', 'npm test')), [{ id: 't1', key: 'npm test' }]);
  assert.deepEqual(loud.shellCallsIn(call('C:\\w', 't2', 'Get-ChildItem', 'PowerShell')), [{ id: 't2', key: 'get-childitem' }]);
  assert.equal(loud.shellCallsIn(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a' } }] } })), null);
  assert.equal(loud.shellCallsIn('{"type":"tool_use","name":"Bash" broken'), null);
});

test("a result is matched to its call, whether it's a string or text blocks", () => {
  const pending = new Map([['t1', 'npm test'], ['t2', 'git log']]);
  assert.deepEqual(loud.resultsIn(result('t1', 'x'.repeat(40)), pending), [{ id: 't1', key: 'npm test', chars: 40 }]);
  assert.deepEqual(loud.resultsIn(result('t2', [{ type: 'text', text: 'abc' }, { type: 'image' }, { type: 'text', text: 'de' }]), pending), [{ id: 't2', key: 'git log', chars: 5 }]);
  assert.equal(loud.resultsIn(result('other', 'x'), pending), null, 'a result nobody is waiting for');
  assert.equal(loud.resultsIn(result('t1', 'x'), new Map()), null);
});

test('only commands that are loud on average, and a habit, make the list, most output first', () => {
  const big = 4 * 3000;   // 3000 tokens
  const huge = 4 * 7000;
  let tally = new Map();
  tally = loud.tallyLoud(tally, [{ key: 'npm test', chars: big }, { key: 'npm test', chars: big }, { key: 'ls', chars: 40 }]);
  tally = loud.tallyLoud(tally, [{ key: 'npm test', chars: big }, { key: 'ls', chars: 40 }, { key: 'git log', chars: huge }]);
  tally = loud.tallyLoud(tally, [{ key: 'git log', chars: huge }, { key: 'cat', chars: huge }]);
  assert.deepEqual(loud.loudest(tally), [
    { key: 'git log', runs: 2, sessions: 2, tokens: 7000, total: 14000 },
    { key: 'npm test', runs: 3, sessions: 2, tokens: 3000, total: 9000 },
  ], 'ls is quiet, and cat was only in one conversation');
});

test("the hot-files scan brings this project's loud commands with it", async () => {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-loud-')));
  const cwd = path.join(home, 'shop');
  fs.mkdirSync(cwd, { recursive: true });
  const dir = path.join(home, 'config', 'projects', hf.folderOf(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const out = 'y'.repeat(4 * 2500);
  fs.writeFileSync(path.join(dir, 'one.jsonl'), [call(cwd, 'a', 'npm test'), result('a', out), call(cwd, 'b', 'ls'), result('b', 'x')].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'two.jsonl'), [call(cwd, 'c', 'npm test -- --watch=false'), result('c', [{ type: 'text', text: out }])].join('\n') + '\n');
  const r = await hf.scanHotFiles({ configDir: path.join(home, 'config'), cwd });
  assert.deepEqual(r.loud, [{ key: 'npm test', runs: 2, sessions: 2, tokens: 2500, total: 5000 }]);
  assert.equal(r.sessions, 2, 'conversations with only shell calls count too');
  fs.rmSync(home, { recursive: true, force: true });
});

test('rewroteIn: the quiet-output hook shortening a command', () => {
  const hook = stdout => JSON.stringify({ type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'PreToolUse', command: "bash -c 'x'", stdout } });
  assert.equal(loud.rewroteIn(hook('{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"set -o pipefail; npm test 2>&1 | tail -n 60"}}}')), true);
  assert.equal(loud.rewroteIn(hook('{"hookSpecificOutput":{"updatedInput":{"command":"something else"}}}')), false);
  assert.equal(loud.rewroteIn('not json "hook_success" updatedInput'), false);
});

test('commandKey sees through the hook\'s pipefail', () => {
  assert.equal(loud.commandKey('set -o pipefail; npm test 2>&1 | tail -n 60'), 'npm test');
});

test('quietSavings: shortened runs against the same command run in full', () => {
  let t = loud.tallyLoud(new Map(), [{ key: 'npm test', chars: 40000 }, { key: 'npm test', chars: 40000, quiet: true }]);
  t = loud.tallyLoud(t, [{ key: 'npm test', chars: 4000, quiet: true }, { key: 'pytest', chars: 100, quiet: true }]);
  // npm test: full 40000 a run; shortened 22000 on average, two runs -> 36000 chars saved.
  assert.deepEqual(loud.quietSavings(t), { runs: 3, tokens: 9000 });
  assert.equal(loud.quietSavings(loud.tallyLoud(new Map(), [{ key: 'git log', chars: 9 }])), null);
  assert.equal(t.get('npm test').runs, 1, 'shortened runs stay out of the loud list');
});

test('MCP calls tally by tool name, in a list of their own', () => {
  const call = JSON.stringify({ message: { content: [{ type: 'tool_use', id: 'm1', name: 'mcp__github__list_issues', input: { repo: 'x' } }] } });
  assert.deepEqual(loud.shellCallsIn(call), [{ id: 'm1', key: 'mcp__github__list_issues', mcp: true }]);
  const big = { chars: loud.LOUD_TOKENS * 4 * 2 };
  let t = loud.tallyLoud(new Map(), [{ key: 'mcp__github__list_issues', ...big }, { key: 'npm test', ...big }]);
  t = loud.tallyLoud(t, [{ key: 'mcp__github__list_issues', ...big }, { key: 'npm test', ...big }]);
  assert.deepEqual(loud.loudest(t).map(r => r.key), ['npm test']);
  assert.deepEqual(loud.loudest(t, { mcp: true }).map(r => r.key), ['mcp__github__list_issues']);
});
