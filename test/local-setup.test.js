const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { status, newEnough, findOllama } = require('../src/main/local/setup');
const { recommend, RECOMMEND_CHECKED, SIZES } = require('../src/main/local/presets');

const hw = { vramGb: 12, ramGb: 32, freeGb: 500 };
const noOllamaEnv = () => ({ LOCALAPPDATA: fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-setup-'))), PATH: '' });
// A fetch that answers only the given URLs with JSON.
const fakeFetch = answers => async url => {
  const hit = Object.entries(answers).find(([k]) => url === k);
  if (!hit) throw new Error('ECONNREFUSED');
  return { ok: true, status: 200, text: async () => JSON.stringify(hit[1]), json: async () => hit[1] };
};

test('recommend sizes the pick to this PC', () => {
  assert.strictEqual(recommend(hw).main, 'qwen3-coder:30b');
  assert.strictEqual(recommend({ vramGb: 8, ramGb: 16, freeGb: 500 }).main, 'qwen2.5-coder:7b');
  assert.strictEqual(recommend({ vramGb: 8, ramGb: 32, freeGb: 500 }).main, 'qwen3-coder:30b');
  assert.strictEqual(recommend({ vramGb: null, ramGb: 32, freeGb: 500 }).main, 'qwen3:30b-a3b');
  assert.strictEqual(recommend({ vramGb: null, ramGb: 8, freeGb: 500 }).main, '');
  assert.strictEqual(recommend({ vramGb: null, ramGb: 8, freeGb: 500 }).quick, 'qwen3:4b');
});

test('a short drive gets a smaller pick, and says why', () => {
  const r = recommend({ ...hw, freeGb: 20 });
  assert.strictEqual(r.main, 'qwen2.5-coder:7b');
  assert.match(r.note, /space/);
  assert.strictEqual(recommend({ ...hw, freeGb: 5 }).main, '');
});

test('every recommended model can be fetched from Settings', () => {
  for (const v of [null, 4, 8, 12, 24]) for (const ram of [8, 16, 32]) {
    const r = recommend({ vramGb: v, ramGb: ram, freeGb: 500 });
    for (const m of [r.main, r.quick].filter(Boolean)) assert.ok(SIZES[m], m);
  }
});

test('the recommendation table has been looked at in the last six months', () => {
  const age = Date.now() - Date.parse(RECOMMEND_CHECKED);
  assert.ok(age < 183 * 24 * 3600 * 1000, `RECOMMEND_CHECKED is ${RECOMMEND_CHECKED}: check presets.js against Ollama's library`);
});

test('newEnough wants Ollama 0.14 or later', () => {
  assert.strictEqual(newEnough('0.13.9'), false);
  assert.strictEqual(newEnough('0.14.0'), true);
  assert.strictEqual(newEnough('1.0.0'), true);
  assert.strictEqual(newEnough('weird'), true);
});

test('status: nothing installed', async () => {
  const s = await status({ hw, env: noOllamaEnv(), fetchFn: fakeFetch({}) });
  assert.strictEqual(s.state, 'none');
  assert.strictEqual(s.rec.main, 'qwen3-coder:30b');
});

test('status: installed but not running', async () => {
  const env = noOllamaEnv();
  const dir = path.join(env.LOCALAPPDATA, 'Programs', 'Ollama');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ollama app.exe'), '');
  fs.writeFileSync(path.join(dir, 'ollama.exe'), '');
  assert.ok(findOllama(env).app);
  assert.strictEqual((await status({ hw, env, fetchFn: fakeFetch({}) })).state, 'stopped');
});

test('status: too old, empty, ready, and LM Studio', async () => {
  const env = noOllamaEnv();
  const V = 'http://127.0.0.1:11434/api/version';
  const M = 'http://127.0.0.1:11434/v1/models';
  assert.strictEqual((await status({ hw, env, fetchFn: fakeFetch({ [V]: { version: '0.12.0' } }) })).state, 'old');
  assert.strictEqual((await status({ hw, env, fetchFn: fakeFetch({ [V]: { version: '0.14.1' }, [M]: { data: [] } }) })).state, 'empty');
  const ready = await status({ hw, env, fetchFn: fakeFetch({ [V]: { version: '0.14.1' }, [M]: { data: [{ id: 'qwen3:4b' }] } }) });
  assert.strictEqual(ready.state, 'ready');
  assert.deepStrictEqual(ready.models, ['qwen3:4b']);
  assert.strictEqual((await status({ hw, env, fetchFn: fakeFetch({ 'http://127.0.0.1:1234/v1/models': { data: [] } }) })).state, 'lmstudio');
});

test('on Apple silicon two thirds of the shared memory counts as the GPU, so a 32 GB Mac gets a coder', async () => {
  const { hardware } = require('../src/main/local/setup');
  const GB = 1024 ** 3;
  const h = { ...await hardware(noOllamaEnv(), { platform: 'darwin', arch: 'arm64', totalmem: 32 * GB }), freeGb: null }; // whatever this disk has free
  assert.strictEqual(h.ramGb, 32);
  assert.strictEqual(h.vramGb, 21);
  assert.strictEqual(recommend(h).main, 'qwen3-coder:30b');
  const small = await hardware(noOllamaEnv(), { platform: 'darwin', arch: 'arm64', totalmem: 8 * GB });
  assert.strictEqual(recommend(small).main, '', 'an 8 GB Mac is for small drafts');
});

const env0 = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-nogpu-')));

test('an Intel Mac has no shared GPU memory to count', async () => {
  const { hardware } = require('../src/main/local/setup');
  const env = { ...noOllamaEnv(), SystemRoot: env0(), ProgramFiles: env0() }; // no nvidia-smi to find
  const h = await hardware(env, { platform: 'darwin', arch: 'x64', totalmem: 16 * 1024 ** 3 });
  assert.strictEqual(h.vramGb, null);
});

test('SHELLBY_FAKE_HARDWARE stands in for the machine, and is ignored when malformed', async () => {
  const { hardware } = require('../src/main/local/setup');
  const env = { ...noOllamaEnv(), SHELLBY_FAKE_HARDWARE: '{"ramGb":16,"vramGb":null}' };
  assert.deepStrictEqual(await hardware(env), { ramGb: 16, vramGb: null, freeGb: null });
  for (const bad of ['nope', '{"vramGb":8}', '{"ramGb":-1}']) {
    const h = await hardware({ ...noOllamaEnv(), SHELLBY_FAKE_HARDWARE: bad }, { platform: 'linux', arch: 'x64', totalmem: 8 * 1024 ** 3 });
    assert.strictEqual(h.ramGb, 8, bad);
  }
});
