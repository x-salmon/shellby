const { test } = require('node:test');
const assert = require('node:assert');
const { fitOf, numCtxOf, read, makeCopy, copyName } = require('../src/main/local/fit');

const GB = 1024 ** 3;
const URL_OK = 'http://127.0.0.1:11434';
const json = o => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(o), json: async () => o });

test('fitOf places a model by GPU memory and RAM', () => {
  assert.strictEqual(fitOf({ sizeBytes: 4 * GB, numCtx: 32768, vramGb: 12, ramGb: 32 }).place, 'gpu');
  assert.strictEqual(fitOf({ sizeBytes: 18 * GB, numCtx: 32768, vramGb: 12, ramGb: 32 }).place, 'ram');
  assert.strictEqual(fitOf({ sizeBytes: 40 * GB, numCtx: 32768, vramGb: 12, ramGb: 32 }).place, 'too-big');
  assert.strictEqual(fitOf({ sizeBytes: 4 * GB, numCtx: 32768, vramGb: null, ramGb: 32 }).place, 'unknown');
  assert.strictEqual(fitOf({ sizeBytes: 40 * GB, numCtx: 32768, vramGb: null, ramGb: 32 }).place, 'too-big');
});

test('a context under 32K, or none set, is short', () => {
  assert.strictEqual(fitOf({ sizeBytes: GB, numCtx: 8192, vramGb: 12, ramGb: 32 }).shortCtx, true);
  assert.strictEqual(fitOf({ sizeBytes: GB, numCtx: null, vramGb: 12, ramGb: 32 }).shortCtx, true);
  assert.strictEqual(fitOf({ sizeBytes: GB, numCtx: 65536, vramGb: 12, ramGb: 32 }).shortCtx, false);
});

test('numCtxOf reads Ollama parameters text', () => {
  assert.strictEqual(numCtxOf('stop "<|im_end|>"\nnum_ctx 32768'), 32768);
  assert.strictEqual(numCtxOf('temperature 0.7'), null);
  assert.strictEqual(numCtxOf(undefined), null);
});

test('read asks tags and show, and matches a :latest tag', async () => {
  const fetchFn = async (url, init) => {
    if (url.endsWith('/api/tags')) return json({ models: [{ name: 'devstral:latest', size: 14 * GB }, { name: 'qwen3:4b', size: 2.5 * GB }] });
    const { model } = JSON.parse(init.body);
    return json({ parameters: model === 'qwen3:4b' ? 'num_ctx 40960' : '' });
  };
  const fit = await read({ url: URL_OK, models: ['devstral', 'qwen3:4b', 'qwen3:4b', 'bad name'], hw: { vramGb: 12, ramGb: 32 }, fetchFn, env: {} });
  assert.deepStrictEqual(Object.keys(fit).sort(), ['devstral', 'qwen3:4b']);
  assert.strictEqual(fit.devstral.place, 'ram');
  assert.strictEqual(fit.devstral.shortCtx, true);
  assert.strictEqual(fit['qwen3:4b'].place, 'gpu');
  assert.strictEqual(fit['qwen3:4b'].shortCtx, false);
});

test('a model with no context of its own takes OLLAMA_CONTEXT_LENGTH, when set', async () => {
  const fetchFn = async url => json(url.endsWith('/api/tags') ? { models: [{ name: 'qwen3:4b', size: GB }] } : { parameters: '' });
  const hw = { vramGb: 12, ramGb: 32 };
  assert.strictEqual((await read({ url: URL_OK, models: ['qwen3:4b'], hw, fetchFn, env: { OLLAMA_CONTEXT_LENGTH: '65536' } }))['qwen3:4b'].shortCtx, false);
  assert.strictEqual((await read({ url: URL_OK, models: ['qwen3:4b'], hw, fetchFn, env: { OLLAMA_CONTEXT_LENGTH: '8192' } }))['qwen3:4b'].shortCtx, true);
  assert.strictEqual((await read({ url: URL_OK, models: ['qwen3:4b'], hw, fetchFn, env: {} }))['qwen3:4b'].shortCtx, true);
});

test('read never asks a server off this PC', async () => {
  let asked = false;
  const fit = await read({ url: 'http://example.com', models: ['x'], hw: { vramGb: 12, ramGb: 32 }, fetchFn: async () => { asked = true; return json({}); }, env: {} });
  assert.deepStrictEqual(fit, {});
  assert.strictEqual(asked, false);
});

test('makeCopy creates <model>-32k with num_ctx 32768', async () => {
  let sent;
  const fetchFn = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return json({ status: 'success' }); };
  assert.deepStrictEqual(await makeCopy({ url: URL_OK, model: 'qwen3:8b', env: {}, fetchFn }), { ok: true, model: 'qwen3:8b-32k' });
  assert.strictEqual(sent.url, `${URL_OK}/api/create`);
  assert.deepStrictEqual(sent.body, { model: 'qwen3:8b-32k', from: 'qwen3:8b', parameters: { num_ctx: 32768 }, stream: false });
  assert.strictEqual(copyName('qwen3:8b-32k'), 'qwen3:8b-32k');
  assert.strictEqual(copyName('a b'), '');
});
