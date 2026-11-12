// Asking the local model when Claude didn't answer: the setting, the question
// sent (and nothing else), the stream's refusal signals and the guess at a
// refusal in Claude's own words.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const local = require('../src/main/local/model');
const { parseLine } = require('../src/main/stream');
const F = require('../src/renderer/panel/feed-logic');

const URL_ = 'http://127.0.0.1:11434';
const jsonRes = value => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });
const reply = content => jsonRes({ choices: [{ message: { content } }] });
const fakeFetch = (answer, calls = []) => async (url, init) => { calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null }); return typeof answer === 'function' ? answer(url) : answer; };
const saved = answers => ({ on: false, url: URL_, model: 'qwen3:8b', answers });

test('cleanAnswers is off unless turned on, and drops a model name a server could not take', () => {
  assert.deepEqual(local.cleanAnswers(null), { on: false, model: '' });
  assert.deepEqual(local.cleanAnswers({ on: 'yes', model: 'rm -rf /' }), { on: false, model: '' });
  assert.deepEqual(local.cleanAnswers({ on: true, model: ' dolphin3:8b ' }), { on: true, model: 'dolphin3:8b' });
});

test('cleanSettings keeps the answers setting', () => {
  const s = local.cleanSettings({ ...saved({ on: true, model: 'dolphin3:8b' }) });
  assert.deepEqual(s.answers, { on: true, model: 'dolphin3:8b' });
});

test('answerSettings uses its own model, else the drafts\' one, and works with drafts off', () => {
  assert.deepEqual(local.answerSettings(saved({ on: true, model: 'dolphin3:8b' }), {}), { url: URL_, model: 'dolphin3:8b' });
  assert.deepEqual(local.answerSettings(saved({ on: true }), {}), { url: URL_, model: 'qwen3:8b' });
  assert.equal(local.answerSettings(saved({ on: false, model: 'dolphin3:8b' }), {}), null);
  assert.equal(local.answerSettings({ ...saved({ on: true }), url: 'http://10.0.0.5:11434' }, {}), null, 'never off this PC');
  assert.equal(local.answerSettings(saved({ on: true }), { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: 'http://proxy' }), null, 'never through a proxy');
});

test('answerInstead sends only the question, with no system prompt or history, and refuses redirects', async () => {
  const calls = [];
  let t = 0;
  const r = await local.answerInstead('  How do lock picks work?  ', {
    settings: () => saved({ on: true, model: 'dolphin3:8b' }),
    fetchFn: fakeFetch(() => { t += 2500; return reply(' An answer. '); }, calls), env: {}, now: () => t,
  });
  assert.deepEqual(r, { ok: true, text: 'An answer.', ms: 2500, model: 'dolphin3:8b' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${URL_}/v1/chat/completions`);
  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'How do lock picks work?' }]);
  assert.equal(calls[0].init.redirect, 'error');
});

test('answerInstead says why when it is off, empty or the server is down', async () => {
  const off = await local.answerInstead('Q', { settings: () => saved({ on: false }), fetchFn: fakeFetch(reply('x')), env: {} });
  assert.equal(off.ok, false);
  assert.match(off.error, /Settings/);
  const empty = await local.answerInstead('   ', { settings: () => saved({ on: true }), fetchFn: fakeFetch(reply('x')), env: {} });
  assert.equal(empty.ok, false);
  const down = await local.answerInstead('Q', { settings: () => saved({ on: true }), fetchFn: async () => { throw new Error('ECONNREFUSED'); }, env: {} });
  assert.equal(down.ok, false);
  assert.match(down.error, /Nothing answered/);
  const blank = await local.answerInstead('Q', { settings: () => saved({ on: true }), fetchFn: fakeFetch(reply('  ')), env: {} });
  assert.match(blank.error, /no answer/);
});

test('a reasoning model\'s thinking is left out of the answer', async () => {
  const r = await local.answerInstead('Q', { settings: () => saved({ on: true }), fetchFn: fakeFetch(reply('<think>\nhmm, let me see\n</think>\n\nThe answer.')), env: {} });
  assert.equal(r.text, 'The answer.');
  const only = await local.answerInstead('Q', { settings: () => saved({ on: true }), fetchFn: fakeFetch(reply('<think>ran out of tokens</think>')), env: {} });
  assert.equal(only.ok, false, 'thinking and nothing after it is no answer');
});

test('the stream turns Claude Code\'s refusal signals into items', () => {
  const ev = { type: 'system', subtype: 'model_refusal_no_fallback', original_model: 'claude-opus-5-5', request_id: null, api_refusal_category: 'cyber', content: '', uuid: 'u', session_id: 's' };
  assert.deepEqual(parseLine(JSON.stringify(ev)).items, [{ kind: 'refusal', category: 'cyber' }]);
  const refused = parseLine(JSON.stringify({ type: 'result', is_error: false, stop_reason: 'refusal' })).items.at(-1);
  assert.equal(refused.refused, true);
  const done = parseLine(JSON.stringify({ type: 'result', is_error: false, stop_reason: 'end_turn' })).items.at(-1);
  assert.equal('refused' in done, false);
});

test('refusalLike catches Claude declining, not Claude unable to find something', () => {
  for (const t of [
    "I can't help with that.",
    "I won't provide instructions for that.",
    'I’m sorry, but I can’t assist with this request.',
    "Sorry, I can't do that.",
    '**I need to decline** this one.',
    "I'm not able to help write that.",
    'I cannot provide that information.',
    "I'm sorry, but I won't walk you through that.",
  ]) assert.equal(F.refusalLike(t), true, t);
  for (const t of [
    "I can't find a file called config.json.",
    "I can't run that command without permission.",
    "I can't write files in plan mode, but here's the plan.",
    "I can't give you a definite answer without seeing the code.",
    "I can't explain why it fails until I see the logs.",
    "I can't help but notice the test is flaky.",
    "Sorry, I can't tell which file you mean.",
    "I'm sorry, I can't help with that without access to the repo.",
    'Here is how it works: …',
    'The test fails because the mock is wrong. I can help fix it.',
    '',
    `I can't help with that. ${'x'.repeat(2000)}`, // a long reply that only opens with it is an answer
  ]) assert.equal(F.refusalLike(t), false, t);
});

test('refusalOf: the API stop always, words only when no step was taken, and never without a question', () => {
  assert.equal(F.refusalOf({ ask: 'Q', reply: 'Done.', tools: 3, refused: true }), 'api');
  assert.equal(F.refusalOf({ ask: 'Q', reply: "I can't help with that.", tools: 0, refused: false }), 'words');
  assert.equal(F.refusalOf({ ask: 'Q', reply: "I can't help with that.", tools: 2, refused: false }), null);
  assert.equal(F.refusalOf({ ask: '', reply: "I can't help with that.", tools: 0, refused: true }), null);
  assert.equal(F.refusalOf(null), null);
});
