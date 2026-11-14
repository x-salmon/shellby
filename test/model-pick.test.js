// A cheaper model for a small message (src/main/model-pick.js): which messages
// are small and of what class, when the card asks, goes by itself or stays
// away, the estimate on each model, and the words.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mp = require('../src/main/model-pick');

test('classOf: a short question, a lookup and a named change are small; a build or a long brief is not', () => {
  assert.equal(mp.classOf('why does the queue drop the second of two sends?'), 'question');
  assert.equal(mp.classOf('Is the lock per tab or global'), 'question');
  assert.equal(mp.classOf('explain how the forecast is cached'), 'lookup');
  assert.equal(mp.classOf('where is the merge window set'), 'lookup');
  assert.equal(mp.classOf('rename footAct to roomOffer in feed-foot.js'), 'tweak');
  assert.equal(mp.classOf('bump electron to 44.1'), 'tweak');
  assert.equal(mp.classOf('refactor the queue so each tab has its own lock'), null);
  assert.equal(mp.classOf('tidy up the feed'), null, 'a plain imperative is medium, not small');
  assert.equal(mp.classOf('what is this?', 1), null, 'a picture attached is more than a quick one');
  assert.equal(mp.classOf(`why ${'does it '.repeat(30)}fail?`), null, 'long questions are not small');
  assert.equal(mp.classOf('/compact'), null);
  assert.equal(mp.classOf(''), null);
});

test('suggest asks for a small message on a top model, and only then', () => {
  assert.deepEqual(mp.suggest({ text: 'which model is this?', model: 'opus' }), { ask: true, cls: 'question' });
  assert.deepEqual(mp.suggest({ text: 'which model is this?', model: '' }), { ask: true, cls: 'question' }, "Claude Code's default reads as the top model");
  assert.deepEqual(mp.suggest({ text: 'which model is this?', model: 'fake-model' }), { ask: true, cls: 'question' }, 'and so does one Shellby cannot place');
  assert.deepEqual(mp.suggest({ text: 'which model is this?', model: 'claude-fable-5-1' }), { ask: true, cls: 'question' });
  assert.equal(mp.suggest({ text: 'which model is this?', model: 'sonnet' }).why, 'cheap');
  assert.equal(mp.suggest({ text: 'which model is this?', model: 'claude-haiku-5-5' }).why, 'cheap');
  assert.equal(mp.suggest({ text: 'which model is this?', model: '', defaultModel: 'sonnet' }).why, 'cheap', 'the default in Settings counts when the tab has none');
  assert.equal(mp.suggest({ text: 'which model is this?', enabled: false }).why, 'off');
  assert.equal(mp.suggest({ text: '/model', model: 'opus' }).why, 'command');
  assert.equal(mp.suggest({ text: '!dir', model: 'opus' }).why, 'command');
  assert.equal(mp.suggest({ text: 'which model is this?', ultracode: true }).why, 'ultracode');
  assert.equal(mp.suggest({ text: 'which model is this?', merged: true }).why, 'merged');
  assert.equal(mp.suggest({ text: 'which model is this?', local: true }).why, 'local');
  assert.equal(mp.suggest({ text: 'build me a scheduler from scratch', model: 'opus' }).why, 'big');
});

test('suggest sends a class to the model you chose for it, by itself', () => {
  assert.deepEqual(mp.suggest({ text: 'which model is this?', model: 'opus', always: { question: 'haiku' } }), { auto: 'haiku', cls: 'question' });
  assert.deepEqual(mp.suggest({ text: 'rename a to b', model: 'opus', always: { question: 'haiku' } }), { ask: true, cls: 'tweak' }, 'another class still asks');
  assert.equal(mp.suggest({ text: 'which model is this?', model: 'opus', always: null }).ask, true);
});

const row = (model, category, pctRise, at = Date.now()) => ({ at, pk: 'p', project: 'p', model, category, size: 's', kind: 'tab', rid: null, wf: null, run: null, helpers: 0, branch: null, weight: 1000, pctRise, durationMs: 1000, turns: 1, tokens: null, ok: true });

test('estimateSmall: a rough guess with no history, the ledger when there is some, and your own Haiku turns when there are enough', () => {
  const none = mp.estimateSmall([], { pk: 'p', category: 'question', model: 'opus' });
  assert.deepEqual(none, { current: mp.GUESS_PCT, cheaper: 0.2, ratio: 0.2, basis: 'guess', measured: false });
  const opus = [row('claude-opus-5-5', 'question', 1.4), row('claude-opus-5-5', 'question', 1.6), row('claude-opus-5-5', 'question', 1.5)];
  const some = mp.estimateSmall(opus, { pk: 'p', category: 'question', model: 'opus' });
  assert.equal(some.current, 1.5);
  assert.equal(some.cheaper, 0.3, 'scaled by list price');
  assert.equal(some.basis, 'project+kind');
  assert.equal(some.measured, false);
  const haiku = [row('claude-haiku-5-5', 'question', 0.2), row('claude-haiku-5-5', 'question', 0.2), row('claude-haiku-5-5', 'question', 0.1)];
  const both = mp.estimateSmall([...opus, ...haiku], { pk: 'p', category: 'question', model: 'opus' });
  assert.equal(both.cheaper, 0.2);
  assert.equal(both.measured, true);
  assert.equal(mp.estimateSmall(opus, { pk: 'p', category: 'question', model: 'claude-fable-5-1' }).ratio, 0.2, 'Fable is priced as Opus');
  assert.ok(mp.estimateSmall([row('opus', 'question', 0.05), row('opus', 'question', 0.05), row('opus', 'question', 0.05)], { pk: 'p', category: 'question', model: 'opus' }).cheaper >= 0.1, 'never rounds the saving to nothing');
});

test('words name both models, say "about", and give the always button its class', () => {
  const w = mp.words({ cls: 'tweak', model: 'claude-opus-5-5', est: { current: 1.5, cheaper: 0.3, ratio: 0.2, basis: 'project+kind', measured: false } });
  assert.equal(w.title, 'Quick one. Haiku could take it.');
  assert.match(w.body, /^A change like this is a few reads and one edit\. On Opus it usually takes about 1\.5% of your 5-hour window; on Haiku about 0\.3%, around 1\/5 the usage\. Nothing has gone out yet\.$/);
  assert.deepEqual(w.current, { name: 'Opus', pct: 1.5 });
  assert.deepEqual(w.cheaper, { name: 'Haiku', pct: 0.3 });
  assert.equal(w.always, 'Always for small changes like this');
  const guess = mp.words({ cls: 'question', model: '', est: { current: 1, cheaper: 0.2, ratio: 0.2, basis: 'guess', measured: false } });
  assert.match(guess.body, /rough guess: on Opus about 1%/);
  assert.equal(guess.always, 'Always for questions like this');
  assert.match(mp.words({ cls: 'lookup', model: 'opus' }).body, /^A lookup like this/, 'no estimate still reads');
});

test('withAlways adds and removes a class; cleanAlways keeps only known classes and models', () => {
  assert.deepEqual(mp.withAlways({}, 'question', 'haiku'), { question: 'haiku' });
  assert.deepEqual(mp.withAlways({ question: 'haiku', tweak: 'haiku' }, 'question', null), { tweak: 'haiku' });
  assert.deepEqual(mp.withAlways(null, 'nonsense', 'haiku'), {});
  const isModel = id => ['haiku', 'sonnet'].includes(id);
  assert.deepEqual(mp.cleanAlways({ question: 'haiku', tweak: 'mythos', other: 'haiku', lookup: 7 }, isModel), { question: 'haiku' });
  assert.deepEqual(mp.cleanAlways('haiku', isModel), {});
});
