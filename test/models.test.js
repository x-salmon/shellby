const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MODELS, isModel, helperEnv } = require('../src/main/models');

test('the picker offers the aliases and pinned releases of every family', () => {
  for (const id of ['opus', 'sonnet', 'haiku', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']) assert.ok(isModel(id), id);
});

test('Claude Code default is always allowed; anything not listed is refused', () => {
  assert.ok(isModel(''));
  for (const bad of ['claude-mythos-5-1', 'claude-3-opus-20240229', 'gpt-4', '--dangerously-skip-permissions', undefined, null, 5]) assert.ok(!isModel(bad), String(bad));
});

test('model ids are unique and every entry has a group and a label', () => {
  assert.equal(new Set(MODELS.map(m => m.id)).size, MODELS.length);
  for (const m of MODELS) assert.ok(m.group && m.label && /^[a-z0-9-]+$/.test(m.id), m.id);
});

test("helpers' model goes to Claude Code as its variable, unless this PC already sets one", () => {
  assert.deepEqual(helperEnv('sonnet', {}), { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
  assert.deepEqual(helperEnv('', {}), {}, 'same as the conversation: nothing set');
  assert.deepEqual(helperEnv('gpt-4', {}), {}, 'not a model Shellby offers');
  assert.deepEqual(helperEnv('sonnet', { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' }), {}, 'yours wins');
});
