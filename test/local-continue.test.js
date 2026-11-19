const { test } = require('node:test');
const assert = require('node:assert');
const { continuePrompt } = require('../src/main/local/tab');

test('Continue on Claude points the new conversation at the local one\'s own record', () => {
  const p = continuePrompt({ model: 'qwen3-coder:30b', transcript: 'C:\\Users\\a\\.claude\\projects\\x\\abc.jsonl' });
  assert.match(p, /qwen3-coder:30b/);
  assert.ok(p.includes('C:\\Users\\a\\.claude\\projects\\x\\abc.jsonl'));
  assert.match(p, /before doing it/); // it reports first: spending more of the plan is the user's call
});
