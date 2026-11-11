// The local model's jobs (each one on or off, with a model of its own), the
// tally Settings shows, Try it and Detect.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const local = require('../src/main/local/model');
const tally = require('../src/main/local/tally');

const ON = { on: true, url: 'http://127.0.0.1:11434', model: 'qwen3:8b' };
const SCHEMA = { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] };
const ARGS = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--system-prompt', 'Be brief.', '--tools', '', '--no-session-persistence'];
const jsonRes = value => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });
const reply = content => jsonRes({ choices: [{ message: { content } }] });
const fakeFetch = (answer, calls = []) => async (url, init) => { calls.push({ url, body: init?.body ? JSON.parse(init.body) : null }); return typeof answer === 'function' ? answer(url) : answer; };
const fakeClaude = (calls = []) => async (args, timeoutMs, opts) => { calls.push({ args, opts }); return { ok: true, stdout: '{"structured_output":{"rule":"claude"}}', stderr: '' }; };

test('cleanJobs fills in defaults and keeps only known jobs', () => {
  assert.deepEqual(local.cleanJobs(null), local.JOB_DEFAULTS);
  assert.equal(local.cleanJobs({ quiz: true }).quiz, true);
  assert.equal(local.cleanJobs({ rules: false }).rules, false);
  assert.equal('evil' in local.cleanJobs({ evil: true }), false);
  assert.equal(local.cleanJobs({ rules: 'yes' }).rules, true, 'a non-boolean keeps the default');
});

test('cleanModels drops unknown jobs and names a server could not take', () => {
  assert.deepEqual(local.cleanModels({ rules: ' llama3.2 ', hooks: 'rm -rf', evil: 'x' }), { rules: 'llama3.2' });
  assert.deepEqual(local.cleanModels([]), {});
});

test('modelFor picks a job\'s own model, the main one, or none when the job is off', () => {
  const s = local.checkSettings({ ...ON, jobs: { hooks: false }, models: { rules: 'tiny:1b' } });
  assert.equal(local.modelFor(s, 'rules'), 'tiny:1b');
  assert.equal(local.modelFor(s, 'routines'), 'qwen3:8b');
  assert.equal(local.modelFor(s, 'hooks'), null);
  assert.equal(local.modelFor(s, 'quiz'), null, 'the quiz is off unless turned on');
  assert.equal(local.modelFor(s, 'other'), 'qwen3:8b', 'local: true callers use the main model');
});

test('withLocal sends a job to its own model and records the try', async () => {
  const fetches = [];
  const events = [];
  const run = local.withLocal(fakeClaude(), {
    settings: () => ({ ...ON, models: { rules: 'tiny:1b' } }),
    fetchFn: fakeFetch(reply('{"rule":"local"}'), fetches),
    record: e => events.push(e),
  });
  const res = await run(ARGS, 10000, { input: 'x', local: 'rules' });
  assert.equal(res.by, 'tiny:1b');
  assert.equal(fetches[0].body.model, 'tiny:1b');
  assert.equal(events.length, 1);
  assert.equal(events[0].job, 'rules');
  assert.equal(events[0].ok, true);
  assert.ok(events[0].chars > 0);
});

test('withLocal leaves a job that is turned off to Claude without asking the local model', async () => {
  const fetches = [];
  const claude = [];
  const run = local.withLocal(fakeClaude(claude), { settings: () => ({ ...ON, jobs: { hooks: false } }), fetchFn: fakeFetch(reply('{"rule":"x"}'), fetches) });
  await run(ARGS, 10000, { input: 'x', local: 'hooks' });
  assert.equal(fetches.length, 0);
  assert.equal(claude.length, 1);
});

test('withLocal hands a fallback to the caller\'s own runner when given one', async () => {
  const mine = [];
  const shared = [];
  const run = local.withLocal(fakeClaude(shared), { settings: () => ({ ...ON, jobs: { quiz: true } }), fetchFn: fakeFetch(reply('{}')) });
  await run(ARGS, 10000, { input: 'x', local: 'quiz', via: fakeClaude(mine) });
  assert.equal(mine.length, 1);
  assert.equal(shared.length, 0);
  assert.equal('via' in mine[0].opts, false, 'via is not passed on to the CLI');
});

test('state() reports the resting model and why; wake() ends the rest', async () => {
  let t = 0;
  const events = [];
  const run = local.withLocal(fakeClaude(), {
    settings: () => ON,
    fetchFn: async () => { t += 20000; throw Object.assign(new Error('slow'), { name: 'TimeoutError' }); },
    now: () => t,
    record: e => events.push(e),
  });
  await run(ARGS, 100000, { input: 'x', local: 'rules' });
  const st = run.state();
  assert.equal(st.resting.length, 1);
  assert.equal(st.resting[0].model, 'qwen3:8b');
  assert.equal(st.lastFail.why, 'timed out');
  await run(ARGS, 100000, { input: 'x', local: 'rules' });
  assert.equal(events[1].why, 'resting', 'a resting model is recorded as Claude stepping in');
  run.wake();
  assert.equal(run.state().resting.length, 0);
});

test('a job with its own model rests apart from the main one', async () => {
  let t = 0;
  const run = local.withLocal(fakeClaude(), {
    settings: () => ({ ...ON, models: { rules: 'broken:1b' } }),
    fetchFn: async (url, init) => {
      t += 20000;
      if (JSON.parse(init.body).model === 'broken:1b') throw Object.assign(new Error('slow'), { name: 'TimeoutError' });
      return reply('{"rule":"fine"}');
    },
    now: () => t,
  });
  await run(ARGS, 100000, { input: 'x', local: 'rules' });
  const res = await run(ARGS, 100000, { input: 'x', local: 'routines' });
  assert.equal(res.by, 'qwen3:8b');
});

test('tally.add counts local drafts and saved tokens, and Claude stepping in', () => {
  let t = tally.add(null, { job: 'rules', ok: true, ms: 1000, chars: 400 }, 5);
  t = tally.add(t, { job: 'rules', ok: true, ms: 3000, chars: 4 }, 9);
  t = tally.add(t, { job: 'hooks', ok: false, why: 'timed out' }, 9);
  assert.equal(t.since, 5);
  assert.deepEqual(t.jobs.rules, { local: 2, claude: 0, tokens: 101, ms: 4000 });
  assert.deepEqual(t.jobs.hooks, { local: 0, claude: 1, tokens: 0, ms: 0 });
  assert.deepEqual(tally.totals(t), { since: 5, local: 2, claude: 1, tokens: 101, avgMs: 2000 });
});

test('tally.clean drops bad entries from a hand-edited file', () => {
  const t = tally.clean({ since: 'x', jobs: { rules: { local: -3, claude: 'a', tokens: 2.7 }, 'Bad Job': { local: 1 }, ok: null } }, 7);
  assert.equal(t.since, 7);
  assert.deepEqual(t.jobs, { rules: { local: 0, claude: 0, tokens: 2, ms: 0 } });
});

test('tally.add files an unknown job under other', () => {
  assert.equal(tally.add(null, { job: '../x', ok: true, chars: 8 }).jobs.other.local, 1);
});

test('tryModel asks one plain question and times it', async () => {
  const calls = [];
  let t = 100;
  const r = await local.tryModel({ url: ON.url, model: ON.model, question: ' Hi? ' }, { fetchFn: fakeFetch(() => { t += 1500; return reply('Hello.'); }, calls), env: {}, now: () => t });
  assert.deepEqual(r, { ok: true, text: 'Hello.', ms: 1500, model: 'qwen3:8b' });
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(calls[0].body.messages[0].content, 'Hi?');
  assert.equal(calls[0].body.response_format, undefined);
});

test('tryModel uses a sample question, and refuses off-PC servers and bad models', async () => {
  const calls = [];
  await local.tryModel({ url: ON.url, model: ON.model }, { fetchFn: fakeFetch(reply('ok'), calls), env: {} });
  assert.ok(calls[0].body.messages[0].content.length > 0);
  assert.equal((await local.tryModel({ url: 'http://10.0.0.2:11434', model: 'm' }, { env: {} })).ok, false);
  assert.equal((await local.tryModel({ url: ON.url, model: 'rm -rf' }, { env: {} })).ok, false);
  assert.equal((await local.tryModel(ON, { env: { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://p' } })).ok, false);
});

test('tryModel says when nothing answers or the answer is empty', async () => {
  const down = await local.tryModel(ON, { fetchFn: async () => { throw new Error('ECONNREFUSED'); }, env: {} });
  assert.match(down.error, /Nothing answered/);
  const empty = await local.tryModel(ON, { fetchFn: fakeFetch(reply('  ')), env: {} });
  assert.match(empty.error, /no answer/);
});

test('detect lists the usual servers that answer with a model', async () => {
  const fetchFn = async url => (url.startsWith('http://127.0.0.1:1234')
    ? jsonRes({ data: [{ id: 'llama-3.2-3b' }] })
    : Promise.reject(new Error('ECONNREFUSED')));
  assert.deepEqual(await local.detect(fetchFn, {}), [{ name: 'LM Studio', url: 'http://127.0.0.1:1234', models: ['llama-3.2-3b'] }]);
  assert.deepEqual(await local.detect(fetchFn, { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: 'http://p' }), []);
});

test('tally keeps a real start date, not one capped like a count', () => {
  const now = Date.UTC(2026, 10, 11);
  assert.equal(tally.add(null, { job: 'rules', ok: true, chars: 4 }, now).since, now);
  assert.equal(tally.clean({ since: now + 1000 }, now).since, now, 'a date in the future is reset');
});
