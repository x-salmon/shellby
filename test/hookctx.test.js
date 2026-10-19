const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const hc = require('../src/main/usage/hookctx');
const hf = require('../src/main/usage/hotfiles');

// A hook run as Claude Code's transcript records it.
const ran = (hookEvent, command, stdout) => JSON.stringify({
  type: 'attachment', attachment: { type: 'hook_success', hookName: `${hookEvent}:startup`, hookEvent, command, stdout, stderr: '', exitCode: 0 },
});
const context = (event, text) => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

test('a hook is named by the script it runs, so runs of the same one add up', () => {
  assert.equal(hc.hookName('bash "${CLAUDE_PLUGIN_ROOT}/hooks-handlers/session-start.sh"'), 'session-start.sh');
  assert.equal(hc.hookName('node C:\\tools\\remind.js --quiet'), 'remind.js');
  assert.equal(hc.hookName('echo be brief'), 'echo', 'no script: just the program');
  assert.equal(hc.hookName('"C:\\bin\\curl.exe" -H "token: s3cret" https://x'), 'curl.exe', 'the rest of an inline command could hold a key');
  assert.equal(hc.hookName(''), null);
  assert.equal(hc.hookName(undefined), null);
});

test("what a hook adds: JSON's additionalContext, or plain text where Claude Code takes it", () => {
  assert.equal(hc.addedChars(context('SessionStart', 'abcd'), 'SessionStart'), 4);
  assert.equal(hc.addedChars(context('PostToolUse', 'abcdef'), 'PostToolUse'), 6);
  assert.equal(hc.addedChars('{"continue":true}', 'SessionStart'), 0, 'JSON without context adds nothing');
  assert.equal(hc.addedChars('  remember the tests  ', 'UserPromptSubmit'), 18, 'plain text goes in at the start and with a prompt');
  assert.equal(hc.addedChars('formatted 3 files', 'PostToolUse'), 0, "a tool hook's plain output isn't added");
  assert.equal(hc.addedChars('', 'SessionStart'), 0);
  assert.equal(hc.addedChars(null, 'SessionStart'), 0);
});

test('only hook runs that added something are read from a transcript line', () => {
  const r = hc.hookContextIn(ran('SessionStart', 'bash "/p/session-start.sh"', context('SessionStart', 'x'.repeat(800))));
  assert.deepEqual(r, { key: 'SessionStart:session-start.sh', event: 'SessionStart', name: 'session-start.sh', chars: 800 });
  assert.equal(hc.hookContextIn(ran('Stop', 'notify.sh', 'done')), null, 'a Stop hook adds nothing to the conversation');
  assert.equal(hc.hookContextIn(ran('PreToolUse', 'guard.js', '')), null);
  assert.equal(hc.hookContextIn('{"type":"user","message":{"content":"hook_success"}}'), null);
  assert.equal(hc.hookContextIn('not json "hook_success"'), null);
});

test('the heaviest hooks come first, by what they add to a conversation', () => {
  const start = { key: 'SessionStart:a.sh', event: 'SessionStart', name: 'a.sh', chars: 4000 };
  const prompt = { key: 'UserPromptSubmit:b.js', event: 'UserPromptSubmit', name: 'b.js', chars: 1200 };
  const tiny = { key: 'SessionStart:c.sh', event: 'SessionStart', name: 'c.sh', chars: 40 };
  const tally = [[start, prompt, prompt, prompt, prompt, tiny], [start, prompt, tiny]].reduce(hc.tallyHooks, new Map());
  const rows = hc.heaviestHooks(tally);
  assert.deepEqual(rows, [
    { event: 'UserPromptSubmit', name: 'b.js', runs: 5, sessions: 2, tokens: 300, perConversation: 750 },
    { event: 'SessionStart', name: 'a.sh', runs: 2, sessions: 2, tokens: 1000, perConversation: 1000 },
  ].sort((a, b) => b.perConversation - a.perConversation), 'one too small to mention is left out');
  assert.equal(hc.startTokens(tally), 1010, 'start hooks are part of the setup, even one too small for the list');
  assert.equal(hc.startTokens(null), 0);
});

test("the hot-files scan brings this project's hooks with it", async () => {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-hookctx-')));
  const cwd = path.join(home, 'shop');
  fs.mkdirSync(cwd, { recursive: true });
  const dir = path.join(home, 'config', 'projects', hf.folderOf(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const start = ran('SessionStart', 'bash "/p/session-start.sh"', context('SessionStart', 'y'.repeat(4 * 900)));
  fs.writeFileSync(path.join(dir, 'one.jsonl'), `${start}\n`);
  fs.writeFileSync(path.join(dir, 'two.jsonl'), `${start}\n${ran('Stop', 'x.sh', 'bye')}\n`);
  const r = await hf.scanHotFiles({ configDir: path.join(home, 'config'), cwd });
  assert.deepEqual(r.hooks, [{ event: 'SessionStart', name: 'session-start.sh', runs: 2, sessions: 2, tokens: 900, perConversation: 900 }]);
  assert.equal(r.hookStart, 900);
  assert.equal(r.sessions, 2, 'conversations with only hook runs count too');
  fs.rmSync(home, { recursive: true, force: true });
});
