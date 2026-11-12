const test = require('node:test');
const assert = require('node:assert');
const { agentEnv, agentTarget, cleanAgent, ALIAS_VARS } = require('../src/main/local/agent');
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

test('a saved conversation reopened on a local model drops its Claude model', () => {
  const { SessionManager } = require('../src/main/sessions');
  const os = require('os');
  const make = local => new SessionManager({ getExe: () => 'claude', history: { load: () => null }, getMode: () => 'ask', getModel: () => '', onLocalModel: () => local });
  const entry = { cwd: os.tmpdir(), model: 'claude-opus-5-5' };
  assert.strictEqual(make(true).open({ tabId: 'local1', historyEntry: entry }).session.model, null);
  assert.strictEqual(make(false).open({ tabId: 'claude1', historyEntry: entry }).session.model, 'claude-opus-5-5');
});
