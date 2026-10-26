// "You've done this before" (src/main/history/similar.js): which past
// conversation in a project is most like the ask being typed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankSimilar, termsOf, stem, asksOf } = require('../src/main/history/similar');

// A History entry and its messages, as search.js's index holds them.
const convo = (id, title, asks, { reply = 'Done.', done = false, updatedAt = 1000, cwd = 'C:\\code\\crab' } = {}) => ({
  entry: { id, title, cwd, updatedAt, ...(done ? { done } : {}) },
  docs: [
    ...asks.map(text => ({ kind: 'user', text })),
    ...(reply ? [{ kind: 'text', text: reply }] : []),
  ],
});

function index(list) {
  const docs = new Map(list.map(c => [c.entry.id, c.docs]));
  return { entries: list.map(c => c.entry), docsFor: id => docs.get(id) };
}

const PROJECT = [
  convo('login', 'Fix the flaky login test', ['The login test in test/auth.test.js fails about one run in five on CI. Find out why and fix it.'], { done: true }),
  convo('readme', 'Tidy the README', ['Tidy up the README: shorter install section, and a screenshot.']),
  convo('dark', 'Dark mode toggle', ['Add a dark mode toggle to the settings page that remembers the choice.']),
  convo('ci', 'Speed up CI', ['CI takes 14 minutes. Cache node_modules and split the e2e job.']),
];

test('the conversation about the same problem comes first, worded differently', () => {
  const { entries, docsFor } = index(PROJECT);
  const r = rankSimilar(entries, docsFor, 'the auth login test keeps failing randomly on CI, can you fix it');
  assert.equal(r[0]?.id, 'login');
  assert.equal(r[0].done, true);
  assert.ok(r[0].shared.includes('login'));
  assert.match(r[0].ask, /^The login test/);
});

test('nothing is offered for an ask with no real match', () => {
  const { entries, docsFor } = index(PROJECT);
  assert.deepEqual(rankSimilar(entries, docsFor, 'write a haiku about hermit crabs and the sea'), []);
});

test('one shared word is not enough, however rare', () => {
  const { entries, docsFor } = index(PROJECT);
  assert.deepEqual(rankSimilar(entries, docsFor, 'translate the readme into French and German'), []);
});

test('too few meaningful words says too little to match on', () => {
  const { entries, docsFor } = index(PROJECT);
  assert.deepEqual(rankSimilar(entries, docsFor, 'fix it please'), []);
  assert.deepEqual(rankSimilar(entries, docsFor, ''), []);
});

test('the conversation being typed in, other projects and unanswered ones are left out', () => {
  const list = [
    ...PROJECT,
    convo('other', 'Flaky login test', ['The login test is flaky, fix it'], { cwd: 'C:\\code\\elsewhere' }),
    convo('silent', 'Flaky login test again', ['The login test is flaky again, fix it'], { reply: null }),
  ];
  const { entries, docsFor } = index(list);
  const inProject = e => e.cwd === 'C:\\code\\crab';
  const ask = 'the flaky login test is failing again';
  // Each of the three would be offered on its own...
  assert.deepEqual(rankSimilar(entries, docsFor, ask).map(x => x.id).sort(), ['login', 'other']);
  // ...but not as the conversation itself, from another project, or with no reply.
  assert.deepEqual(rankSimilar(entries, docsFor, ask, { exclude: 'login', inProject }), []);
});

test('caching matches cache, and CI counts however it is typed', () => {
  const { entries, docsFor } = index(PROJECT);
  assert.equal(rankSimilar(entries, docsFor, 'make ci faster by caching node_modules')[0]?.id, 'ci');
});

test('words most conversations use count for less than rare ones', () => {
  const list = [
    convo('a', 'Fix the parser', ['Fix the parser bug in src/parse.js where tokens are dropped']),
    convo('b', 'Fix the cache', ['Fix the cache bug in src/cache.js where entries expire early']),
    convo('c', 'Fix the button', ['Fix the button bug in src/button.js where clicks are lost']),
  ];
  const { entries, docsFor } = index(list);
  const r = rankSimilar(entries, docsFor, 'fix the bug where cache entries expire too early');
  assert.equal(r[0]?.id, 'b');
});

test('a tie goes to the one you ticked off', () => {
  const list = [
    convo('open', 'Rotate the logs', ['Rotate the server logs daily and keep a week'], { updatedAt: 2000 }),
    convo('ticked', 'Rotate the logs', ['Rotate the server logs daily and keep a week'], { done: true, updatedAt: 1000 }),
  ];
  const { entries, docsFor } = index(list);
  const r = rankSimilar(entries, docsFor, 'rotate the server logs daily');
  assert.deepEqual(r.map(x => x.id), ['ticked', 'open']);
});

test('termsOf drops glue words, stems, and splits identifiers', () => {
  const t = termsOf('Can you please fix the failing flakyLoginTest in user_auth on CI? It is ok');
  for (const w of ['fix', 'fail', 'flaky', 'login', 'test', 'flakylogintest', 'user', 'auth', 'user_auth', 'ci']) assert.ok(t.includes(w), `${w} in ${t}`);
  for (const w of ['can', 'you', 'please', 'the', 'in', 'on', 'it', 'is', 'ok']) assert.ok(!t.includes(w), `${w} kept in ${t}`);
  assert.equal(stem('tests'), 'test');
  assert.equal(stem('testing'), 'test');
  assert.equal(stem('fixes'), 'fix');
  assert.equal(stem('class'), 'class');
  assert.equal(stem('entries'), 'entry');
  assert.equal(stem('caching'), stem('cache'));
  assert.equal(stem('removed'), stem('remove'));
});

test('asksOf reads the title and the first few of your messages, not Claude\'s', () => {
  const a = asksOf({ title: 'T' }, [
    { kind: 'user', text: 'one' }, { kind: 'text', text: 'claude said' }, { kind: 'user', text: 'two' },
    { kind: 'user', text: 'three' }, { kind: 'user', text: 'four' },
  ]);
  assert.equal(a.first, 'one');
  assert.equal(a.text, 'T\none\ntwo\nthree');
});
