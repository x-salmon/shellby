const { test, describe } = require('node:test');
const assert = require('node:assert');
const { agentEnv, agentTarget, cleanAgent, cleanTarget, ALIAS_VARS } = require('../src/main/local/agent');
const { cleanSettings } = require('../src/main/local/model');

const base = { on: false, url: 'http://127.0.0.1:11434', model: 'qwen3-coder:30b' };

test('agent is off unless turned on', () => {
  assert.deepStrictEqual(agentEnv(base), {});
  assert.deepStrictEqual(agentEnv({ ...base, agent: { on: 'yes' } }), {});
  assert.strictEqual(agentTarget(null), null);
});

test('agent sends Claude Code to the local server with every model name mapped', () => {
  const env = agentEnv({ ...base, agent: { on: true, model: '' } });
  assert.strictEqual(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:11434');
  assert.strictEqual(env.ANTHROPIC_API_KEY, '');
  assert.ok(env.ANTHROPIC_AUTH_TOKEN);
  for (const k of ALIAS_VARS) assert.strictEqual(env[k], 'qwen3-coder:30b');
  assert.strictEqual(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
});

test('agent prefers its own model over the drafts one', () => {
  assert.strictEqual(agentTarget({ ...base, agent: { on: true, model: 'devstral' } }).model, 'devstral');
});

test('agent never points at a server off this PC', () => {
  assert.deepStrictEqual(agentEnv({ ...base, url: 'http://example.com', agent: { on: true } }), {});
});

test('agent stays off without any model', () => {
  assert.strictEqual(agentTarget({ ...base, model: '', agent: { on: true, model: '' } }), null);
});

test('cleanAgent drops bad model names', () => {
  assert.deepStrictEqual(cleanAgent({ on: true, model: 'a b; rm' }), { on: true, model: '' });
});

test('saved settings keep the agent', () => {
  assert.deepStrictEqual(cleanSettings({ ...base, agent: { on: true, model: 'devstral' } }).agent, { on: true, model: 'devstral' });
  assert.deepStrictEqual(cleanSettings(base).agent, { on: false, model: '' });
});

test('cleanTarget only takes a server on this PC and a real model name', () => {
  assert.deepStrictEqual(cleanTarget({ url: 'http://127.0.0.1:11434', model: 'devstral' }), { url: 'http://127.0.0.1:11434', model: 'devstral' });
  assert.strictEqual(cleanTarget({ url: 'http://example.com', model: 'devstral' }), null);
  assert.strictEqual(cleanTarget({ url: 'http://127.0.0.1:11434', model: '' }), null);
  assert.strictEqual(cleanTarget('nope'), null);
});

describe('a conversation keeps local or Claude for good', () => {
  const { SessionManager } = require('../src/main/sessions');
  const os = require('os');
  const target = { url: 'http://127.0.0.1:11434', model: 'devstral' };
  // settingNow: what Settings would give a new conversation at this moment.
  const make = settingNow => new SessionManager({
    getExe: () => 'claude', history: { load: () => null }, getMode: () => 'ask', getModel: () => 'opus',
    getFallbackModel: () => 'sonnet', getLocalTarget: () => settingNow.value,
  });

  test('a new conversation takes Settings\' local model, with no Claude model on its line', () => {
    const tab = make({ value: target }).open({ tabId: 'new1', cwd: os.tmpdir() });
    assert.deepStrictEqual(tab.localTarget, target);
    assert.strictEqual(tab.session.model, null);
    assert.strictEqual(tab.session.fallbackModel, '');
    assert.strictEqual(tab.session.extraEnv().ANTHROPIC_BASE_URL, target.url);
  });

  test('turning the setting off never moves an open local conversation to Claude', () => {
    const now = { value: target };
    const tab = make(now).open({ tabId: 'open1', cwd: os.tmpdir() });
    now.value = null;
    assert.strictEqual(tab.session.extraEnv().ANTHROPIC_BASE_URL, target.url, 'a restart still goes local');
  });

  test('a saved local conversation reopens local with the setting off, its Claude model dropped', () => {
    const entry = { cwd: os.tmpdir(), model: 'claude-opus-5-5', local: target };
    const tab = make({ value: null }).open({ tabId: 'saved1', historyEntry: entry });
    assert.deepStrictEqual(tab.localTarget, target);
    assert.strictEqual(tab.session.model, null);
    assert.strictEqual(tab.session.extraEnv().ANTHROPIC_BASE_URL, target.url);
  });

  test('a saved Claude conversation stays on Claude with the setting on', () => {
    const entry = { cwd: os.tmpdir(), model: 'claude-opus-5-5' };
    const tab = make({ value: target }).open({ tabId: 'saved2', historyEntry: entry });
    assert.strictEqual(tab.localTarget, null);
    assert.strictEqual(tab.session.model, 'claude-opus-5-5');
    assert.strictEqual(tab.session.extraEnv().ANTHROPIC_BASE_URL, undefined);
  });
});
