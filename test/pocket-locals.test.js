const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocals, namesFrom, REFRESH_MS } = require('../src/main/pocket/locals');

const URL = 'http://127.0.0.1:11434';
const flush = () => new Promise(r => setImmediate(r));

test('offers the agent’s model, Settings’ model, then what the server has, once each', () => {
  const saved = { url: URL, model: 'qwen3:8b', agent: { on: true, model: 'qwen3-coder:30b' } };
  assert.deepEqual(namesFrom(saved, ['qwen3:8b', 'llama3.2:3b'], {}), ['qwen3-coder:30b', 'qwen3:8b', 'llama3.2:3b']);
});

test('offers nothing without a local server, off this PC, or behind a proxy', () => {
  assert.deepEqual(namesFrom(null, [], {}), []);
  assert.deepEqual(namesFrom({ url: 'http://example.com:11434', model: 'qwen3:8b' }, [], {}), []);
  assert.deepEqual(namesFrom({ url: URL, model: 'qwen3:8b' }, [], { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://p' }), []);
});

test('drops names a server would never take', () => {
  assert.deepEqual(namesFrom({ url: URL, model: 'bad name; rm' }, ['ok:1b'], {}), ['ok:1b']);
});

test('asks the server at most once a minute, and says when its list changed', async () => {
  let t = 0;
  let asked = 0;
  let changes = 0;
  const locals = createLocals({
    settings: () => ({ url: URL, model: 'qwen3:8b' }),
    list: async () => { asked++; return { ok: true, models: ['qwen3:8b', 'llama3.2:3b'] }; },
    onChange: () => { changes++; },
    now: () => t, env: {},
  });
  assert.deepEqual(locals.names(), ['qwen3:8b'], 'Settings’ name while the server is asked');
  await flush();
  assert.deepEqual(locals.names(), ['qwen3:8b', 'llama3.2:3b']);
  assert.equal(asked, 1);
  assert.equal(changes, 1);
  t += REFRESH_MS;
  locals.names();
  await flush();
  assert.equal(asked, 2);
  assert.equal(changes, 1, 'the same list is no change');
  assert.equal(locals.has('llama3.2:3b'), true);
  assert.equal(locals.has('gpt-9'), false);
  assert.equal(locals.has(''), false);
});
