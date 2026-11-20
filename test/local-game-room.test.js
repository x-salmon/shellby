const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameRoom, ourModels, sameModel } = require('../src/main/local/game-room');

const URL = 'http://127.0.0.1:11434';
const SETTINGS = { url: URL, model: 'qwen3:4b', agent: { on: true, model: 'qwen3-coder:30b', helpers: '', quick: 'qwen3:4b' }, answers: { on: false, model: '' }, models: {} };

// A fake Ollama: what /api/ps says is loaded, and every keep_alive asked of /api/generate.
function fakeOllama({ loaded = [], ps = 200 } = {}) {
  const asked = [];
  const fetchFn = async (url, init = {}) => {
    if (url === `${URL}/api/ps`) return { ok: ps === 200, json: async () => ({ models: loaded }) };
    if (url === `${URL}/api/generate`) {
      const body = JSON.parse(init.body);
      asked.push([body.model, body.keep_alive]);
      return { ok: true, json: async () => ({}) };
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetchFn, asked };
}

function room({ settings = SETTINGS, targets = [], busy = () => false, ollama, rooms = [] } = {}) {
  return createGameRoom({ settings: () => settings, targets: () => targets, busy, fetchFn: ollama.fetchFn, now: () => 1000, onRoom: r => rooms.push(r) });
}

test('a game coming up unloads the idle models Shellby uses, and says how much memory that freed', async () => {
  const ollama = fakeOllama({ loaded: [{ name: 'qwen3-coder:30b', size_vram: 18e9 }, { name: 'qwen3:4b', size_vram: 3e9 }] });
  const rooms = [];
  const r = room({ ollama, rooms });
  await r.update(true);
  assert.deepEqual(ollama.asked, [['qwen3-coder:30b', 0], ['qwen3:4b', 0]]);
  assert.deepEqual(rooms, [{ at: 1000, models: ['qwen3-coder:30b', 'qwen3:4b'], bytes: 21e9 }]);
  assert.deepEqual(r.view(), rooms[0]);
});

test('a model Shellby does not use is left loaded: it is yours', async () => {
  const ollama = fakeOllama({ loaded: [{ name: 'llama3.1:70b', size_vram: 40e9 }, { name: 'qwen3:8b', size_vram: 6e9 }] });
  await room({ ollama }).update(true);
  assert.deepEqual(ollama.asked, [], 'another size of the same model is a different model');
  const named = fakeOllama({ loaded: [{ name: 'qwen3:latest', size_vram: 5e9 }] });
  await room({ ollama: named, settings: { ...SETTINGS, model: 'qwen3' } }).update(true);
  assert.deepEqual(named.asked, [['qwen3:latest', 0]], 'a bare name matches its :latest');
});

test('nothing is unloaded mid-turn; the next poll tries again', async () => {
  const ollama = fakeOllama({ loaded: [{ name: 'qwen3:4b', size_vram: 3e9 }] });
  let busy = true;
  const r = room({ ollama, busy: () => busy });
  await r.update(true);
  assert.deepEqual(ollama.asked, []);
  busy = false;
  await r.update(true);
  assert.deepEqual(ollama.asked, [['qwen3:4b', 0]]);
  await r.update(true);
  assert.equal(ollama.asked.length, 1, 'once per game');
});

test('when the game has gone, an open local conversation gets its models back', async () => {
  const ollama = fakeOllama({ loaded: [{ name: 'qwen3-coder:30b', size_vram: 18e9 }] });
  const targets = [{ url: URL, model: 'qwen3-coder:30b', quick: 'qwen3:4b' }, { url: 'http://127.0.0.1:1234', model: 'other' }];
  const r = room({ ollama, targets });
  await r.update(true);
  await r.update(false);
  assert.deepEqual(ollama.asked, [['qwen3-coder:30b', 0], ['qwen3-coder:30b', '30m'], ['qwen3:4b', '30m']], 'only the server it freed');
  await r.update(false);
  assert.equal(ollama.asked.length, 3, 'loaded back once');
});

test('nothing freed, nothing loaded back', async () => {
  const ollama = fakeOllama({ loaded: [] });
  const r = room({ ollama, targets: [{ url: URL, model: 'qwen3:4b' }] });
  await r.update(true);
  await r.update(false);
  assert.deepEqual(ollama.asked, []);
  assert.equal(r.view(), null);
});

test('turned off in Settings, or on LM Studio, it leaves the models alone', async () => {
  const off = fakeOllama({ loaded: [{ name: 'qwen3:4b', size_vram: 3e9 }] });
  await room({ ollama: off, settings: { ...SETTINGS, makeRoom: false } }).update(true);
  assert.deepEqual(off.asked, []);
  const lmStudio = fakeOllama({ ps: 404 });
  await room({ ollama: lmStudio }).update(true);
  assert.deepEqual(lmStudio.asked, []);
});

test('polls during a slow unload do not stack up', async () => {
  let release;
  const asked = [];
  const fetchFn = async (url, init = {}) => {
    if (url.endsWith('/api/ps')) return { ok: true, json: async () => ({ models: [{ name: 'qwen3:4b', size_vram: 1 }] }) };
    asked.push(JSON.parse(init.body).model);
    await new Promise(r => { release = r; });
    return { ok: true };
  };
  const r = createGameRoom({ settings: () => SETTINGS, targets: () => [], busy: () => false, fetchFn });
  const first = r.update(true);
  await new Promise(res => setImmediate(res));
  await r.update(true);
  release();
  await first;
  assert.deepEqual(asked, ['qwen3:4b']);
});

test('ourModels gathers every model the local settings name', () => {
  assert.deepEqual([...ourModels({ model: 'a', answers: { model: 'b' }, agent: { model: 'c', helpers: 'd', quick: 'e' }, models: { quiz: 'f' } })].sort(), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual([...ourModels(null)], []);
  assert.equal(sameModel('m:latest', 'm'), true);
  assert.equal(sameModel('m:7b', 'm'), false);
});
