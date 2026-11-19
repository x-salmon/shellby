const { test } = require('node:test');
const assert = require('node:assert');
const { pull, canPull, parseLine, cancel, pulling } = require('../src/main/local/pull');

const URL_OK = 'http://127.0.0.1:11434';
const GB = 1024 ** 3;
const lines = (...objs) => objs.map(o => JSON.stringify(o) + '\n');
// A fetch that streams the given chunks, optionally waiting for an abort.
function fakeFetch(chunks, { hang = false, seen = [] } = {}) {
  return async (url, opts) => {
    seen.push({ url, opts });
    const enc = new TextEncoder();
    async function* body() {
      for (const c of chunks) yield enc.encode(c);
      if (hang) await new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted'))));
    }
    return { ok: true, status: 200, body: body() };
  };
}

test('only preset models can be fetched', () => {
  assert.strictEqual(canPull('evil/model:latest', 1e15).ok, false);
  assert.strictEqual(canPull('qwen3:4b', 1e15).ok, true);
});

test('too little disk space refuses before downloading', () => {
  const r = canPull('qwen3-coder:30b', 20 * GB);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /20 GB free/);
});

test('parseLine reads progress and errors, and ignores junk', () => {
  assert.deepStrictEqual(parseLine('{"status":"pulling","completed":5,"total":10}'), { status: 'pulling', completed: 5, total: 10 });
  assert.deepStrictEqual(parseLine('{"error":"nope"}'), { error: 'nope' });
  assert.strictEqual(parseLine('not json'), null);
});

test('a pull streams progress and succeeds on "success"', async () => {
  const seen = [];
  const got = [];
  const r = await pull({ url: URL_OK, model: 'qwen3:4b', free: null, env: {}, onProgress: p => got.push(p),
    fetchFn: fakeFetch([...lines({ status: 'pulling', completed: 1, total: 2 }), '{"status":"succ', 'ess"}\n'], { seen }) });
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(seen[0].url, `${URL_OK}/api/pull`);
  assert.deepStrictEqual(JSON.parse(seen[0].opts.body), { model: 'qwen3:4b', stream: true });
  assert.strictEqual(got.at(-1).status, 'success');
  assert.strictEqual(pulling(), null);
});

test('a stream that ends early is not a success', async () => {
  const r = await pull({ url: URL_OK, model: 'qwen3:4b', free: null, env: {}, fetchFn: fakeFetch(lines({ status: 'pulling' })) });
  assert.strictEqual(r.ok, false);
});

test('an Ollama error line is reported', async () => {
  const r = await pull({ url: URL_OK, model: 'qwen3:4b', free: null, env: {}, fetchFn: fakeFetch(lines({ error: 'manifest unknown' })) });
  assert.match(r.error, /manifest unknown/);
});

test('never a server off this PC', async () => {
  const r = await pull({ url: 'http://example.com', model: 'qwen3:4b', free: null, env: {}, fetchFn: fakeFetch([]) });
  assert.strictEqual(r.ok, false);
});

test('cancel stops it, and only one runs at a time', async () => {
  const run = pull({ url: URL_OK, model: 'qwen3:4b', free: null, env: {}, fetchFn: fakeFetch(lines({ status: 'pulling' }), { hang: true }) });
  await new Promise(r => setImmediate(r));
  assert.strictEqual(pulling(), 'qwen3:4b');
  assert.strictEqual(canPull('qwen3:8b', null).ok, false);
  assert.strictEqual(cancel(), true);
  const r = await run;
  assert.strictEqual(r.cancelled, true);
  assert.strictEqual(cancel(), false);
});
