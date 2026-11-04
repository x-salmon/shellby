// A local model for Shellby's small drafts: which calls it may take, what it
// sends, how its answer is dressed as `claude -p` output, and falling back to
// Claude whenever it can't answer.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const local = require('../src/main/local/model');
const routineDraft = require('../src/main/routines/draft');
const correctionDraft = require('../src/main/correction-draft');
const draft = require('../src/main/workflows/draft');

const ON = { on: true, url: 'http://localhost:11434', model: 'qwen3:8b' };
const SCHEMA = { type: 'object', properties: { rule: { type: 'string' } }, required: ['rule'] };
const ARGS = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--system-prompt', 'Be brief.', '--model', 'haiku', '--tools', '', '--strict-mcp-config', '--no-session-persistence'];

const reply = content => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) });
const fakeFetch = (answer, calls = []) => async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return typeof answer === 'function' ? answer() : answer; };
const fakeClaude = (calls = []) => async (args, timeoutMs, opts) => { calls.push({ args, timeoutMs, opts }); return { ok: true, stdout: JSON.stringify({ is_error: false, structured_output: { rule: 'from Claude' } }), stderr: '', timedOut: false }; };

test('settings are used only when on, with a model, at an address on this PC', () => {
  assert.deepEqual(local.checkSettings(ON), { url: 'http://localhost:11434', model: 'qwen3:8b' });
  assert.equal(local.checkSettings({ ...ON, on: false }), null);
  assert.equal(local.checkSettings({ ...ON, model: '' }), null);
  assert.equal(local.checkSettings({ ...ON, model: 'a b' }), null);
  assert.equal(local.checkSettings({ ...ON, url: 'http://example.com:11434' }), null);
  assert.equal(local.checkSettings({ ...ON, url: 'http://user:pw@localhost:1234' }), null);
  assert.equal(local.checkSettings({ ...ON, url: 'file:///C:/x' }), null);
  assert.equal(local.checkSettings(null), null);
});

test('server addresses lose a trailing slash or /v1', () => {
  assert.equal(local.baseUrl('http://127.0.0.1:1234/v1/'), 'http://127.0.0.1:1234');
  assert.equal(local.baseUrl('http://[::1]:11434'), 'http://[::1]:11434');
  assert.equal(local.baseUrl('not a url'), null);
});

test('only tool-less schema calls with no session can go local', () => {
  const req = local.requestFrom(ARGS, 'Word this rule.');
  assert.deepEqual(req, { system: 'Be brief.', prompt: 'Word this rule.', schema: SCHEMA });
  assert.equal(local.requestFrom(ARGS.filter(a => a !== '--tools' && a !== ''), 'x'), null, 'tools allowed');
  assert.equal(local.requestFrom([...ARGS, '--mcp-config', 'f.json'], 'x'), null, 'MCP servers');
  assert.equal(local.requestFrom([...ARGS, '--resume', 'abc'], 'x'), null, 'a session to resume');
  assert.equal(local.requestFrom(ARGS.filter((a, i) => a !== '--json-schema' && ARGS[i - 1] !== '--json-schema'), 'x'), null, 'no schema');
  assert.equal(local.requestFrom(ARGS, ''), null, 'nothing asked');
});

test('a prompt after -p is read, and the routine draft fits', () => {
  const req = local.requestFrom(routineDraft.draftArgs('check my PRs every morning', { home: 'C:\\Users\\x' }));
  assert.ok(req);
  assert.match(req.prompt, /^Describe this as a routine: check my PRs every morning$/);
  assert.equal(req.schema.type, 'object');
  assert.ok(req.system.length > 0);
});

test('the request asks for JSON matching the schema, at temperature 0', () => {
  const b = local.body({ system: 'S', prompt: 'P', schema: SCHEMA }, 'm');
  assert.equal(b.model, 'm');
  assert.equal(b.temperature, 0);
  assert.equal(b.stream, false);
  assert.deepEqual(b.messages.map(m => m.role), ['system', 'user']);
  assert.match(b.messages[0].content, /^S\n\n.*JSON object/);
  assert.deepEqual(b.response_format.json_schema.schema, SCHEMA);
});

test('an answer is dressed as claude -p output that the drafts parse unchanged', () => {
  const r = local.replyFrom({ choices: [{ message: { content: '```json\n{"rule":"Run the tests first."}\n```' } }] });
  assert.ok(r.stdout);
  assert.deepEqual(draft.envelope(r.stdout), { ok: true, out: { rule: 'Run the tests first.' } });
  assert.deepEqual(correctionDraft.parse(r.stdout), { ok: true, rule: 'Run the tests first.' });
});

test('answers that are not one JSON object are refused', () => {
  assert.equal(local.replyFrom({ choices: [{ message: { content: 'Sure! Here you go' } }] }).error, 'reply was not JSON');
  assert.equal(local.replyFrom({ choices: [{ message: { content: '[1,2]' } }] }).error, 'reply was not a JSON object');
  assert.equal(local.replyFrom({}).error, 'no reply');
});

test('a call that asks for local is answered locally and never reaches Claude', async () => {
  const fetches = [];
  const claude = [];
  const run = local.withLocal(fakeClaude(claude), { settings: () => ON, fetchFn: fakeFetch(reply('{"rule":"local"}'), fetches) });
  const res = await run(ARGS, 150000, { input: 'Word it.', lean: true, local: true });
  assert.equal(res.ok, true);
  assert.equal(JSON.parse(res.stdout).structured_output.rule, 'local');
  assert.equal(claude.length, 0);
  assert.equal(fetches[0].url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(fetches[0].body.messages[1].content, 'Word it.');
});

test('calls that did not ask, or with local off, go straight to Claude without the flag', async () => {
  const fetches = [];
  const claude = [];
  const run = local.withLocal(fakeClaude(claude), { settings: () => ON, fetchFn: fakeFetch(reply('{}'), fetches) });
  await run(ARGS, 1000, { input: 'x', lean: true });
  const off = local.withLocal(fakeClaude(claude), { settings: () => ({ ...ON, on: false }), fetchFn: fakeFetch(reply('{}'), fetches) });
  await off(ARGS, 1000, { input: 'x', local: true });
  assert.equal(fetches.length, 0);
  assert.equal(claude.length, 2);
  assert.deepEqual(claude[0].opts, { input: 'x', lean: true });
  assert.ok(!('local' in claude[1].opts));
});

test('a local failure falls back to Claude with what is left of the budget', async () => {
  for (const answer of [
    () => { throw new Error('ECONNREFUSED'); },
    { ok: false, status: 404, json: async () => ({}) },
    reply('not json'),
  ]) {
    const claude = [];
    const logs = [];
    let t = 0;
    const run = local.withLocal(fakeClaude(claude), {
      settings: () => ON,
      fetchFn: async () => { t += 10000; return typeof answer === 'function' ? answer() : answer; },
      log: { info: m => logs.push(m) },
      now: () => t,
    });
    const res = await run(ARGS, 150000, { input: 'x', lean: true, local: true });
    assert.equal(JSON.parse(res.stdout).structured_output.rule, 'from Claude');
    assert.equal(claude.length, 1);
    assert.equal(claude[0].timeoutMs, 140000);
    assert.deepEqual(claude[0].opts, { input: 'x', lean: true });
    assert.match(logs[0], /asking Claude instead/);
  }
});

test('a local try gets at most half the budget, capped, and Claude keeps at least the other half', async () => {
  const timeouts = [];
  const origTimeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => { timeouts.push(ms); return origTimeout.call(AbortSignal, ms); };
  try {
    const claude = [];
    let t = 0;
    const run = local.withLocal(fakeClaude(claude), { settings: () => ON, fetchFn: async () => { t += 90000; throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, now: () => t });
    await run(ARGS, 150000, { input: 'x', local: true });
    await run(ARGS, 20000, { input: 'x', local: true });
    assert.deepEqual(timeouts, [local.LOCAL_MAX_MS, 10000]);
    assert.equal(claude[0].timeoutMs, 75000);
  } finally { AbortSignal.timeout = origTimeout; }
});

test('a reply missing a required field, or of the wrong type, does not fit the schema', () => {
  const schema = { type: 'object', properties: { rule: { type: 'string' }, n: { type: 'integer' }, ok: { type: 'boolean' } }, required: ['rule'] };
  assert.equal(local.fitsSchema({ rule: 'x', n: 2, ok: true }, schema), true);
  assert.equal(local.fitsSchema({}, schema), false);
  assert.equal(local.fitsSchema({ rule: 5 }, schema), false);
  assert.equal(local.fitsSchema({ rule: 'x', n: 1.5 }, schema), false);
  assert.equal(local.replyFrom({ choices: [{ message: { content: '{}' } }] }, schema).error, 'reply did not fit the schema');
  assert.ok(!('result' in JSON.parse(local.replyFrom({ choices: [{ message: { content: '{"rule":"x"}' } }] }, schema).stdout)), 'raw text is not handed on');
});

test('a reply of the wrong shape goes to Claude instead', async () => {
  const claude = [];
  const run = local.withLocal(fakeClaude(claude), { settings: () => ON, fetchFn: fakeFetch(reply('{}')) });
  const res = await run(ARGS, 150000, { input: 'x', local: true });
  assert.equal(claude.length, 1);
  assert.equal(JSON.parse(res.stdout).structured_output.rule, 'from Claude');
});

test('redirects are refused, and a body that is not JSON falls back', async () => {
  const seen = [];
  const res = await local.ask({ system: '', prompt: 'p', schema: SCHEMA }, local.checkSettings(ON), 1000, async (url, init) => { seen.push(init.redirect); return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }; });
  assert.deepEqual(seen, ['error']);
  assert.equal(res.ok, false);
  assert.match(res.stderr, /not JSON/);
});

test('settings that throw, or are missing, leave the call to Claude', async () => {
  const claude = [];
  const logs = [];
  const run = local.withLocal(fakeClaude(claude), { settings: () => { throw new Error('no config'); }, fetchFn: fakeFetch(reply('{"rule":"x"}')), log: { warn: m => logs.push(m) } });
  await run(ARGS, 1000, { input: 'x', local: true });
  await local.withLocal(fakeClaude(claude), { settings: () => undefined, fetchFn: fakeFetch(reply('{"rule":"x"}')) })(ARGS, 1000, { input: 'x', local: true });
  assert.equal(claude.length, 2);
  assert.match(logs[0], /no config/);
});

test('Settings can save an address on this PC and a model; it only stays on with a model', () => {
  assert.deepEqual(local.cleanSettings({ on: true, url: 'http://127.0.0.1:1234/v1', model: ' llama3.2 ' }), { on: true, url: 'http://127.0.0.1:1234', model: 'llama3.2' });
  assert.deepEqual(local.cleanSettings({ on: true, url: 'http://localhost:11434', model: '' }), { on: false, url: 'http://localhost:11434', model: '' });
  assert.equal(local.cleanSettings({ on: true, url: 'http://192.168.1.5:11434', model: 'm' }), null);
  assert.equal(local.cleanSettings({ on: true, url: 'http://localhost:11434', model: 'rm -rf' }), null);
  assert.equal(local.cleanSettings('on'), null);
  assert.equal(local.cleanSettings({ on: 'yes', url: 'http://localhost:11434', model: 'm' }).on, false);
});

test('Find models lists what the server has, and says plainly when it cannot', async () => {
  const urls = [];
  const ok = await local.listModels('http://localhost:11434/', async (url, init) => {
    urls.push([url, init.redirect]);
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'qwen3:8b' }, { id: 'qwen3:8b' }, { id: 'bad name' }, { id: 7 }, { id: 'lmstudio-community/gemma-3' }] }) };
  });
  assert.deepEqual(ok, { ok: true, models: ['qwen3:8b', 'lmstudio-community/gemma-3'] });
  assert.deepEqual(urls, [['http://localhost:11434/v1/models', 'error']]);

  assert.match((await local.listModels('http://example.com', async () => { throw new Error('never'); })).error, /on this PC/);
  assert.match((await local.listModels('http://localhost:1', async () => { throw new Error('ECONNREFUSED'); })).error, /Is Ollama or LM Studio running/);
  assert.match((await local.listModels('http://localhost:1', async () => ({ ok: false, status: 404 }))).error, /answered 404/);
  assert.match((await local.listModels('http://localhost:1', async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }))).error, /no models yet/);
});
