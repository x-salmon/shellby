const { test } = require('node:test');
const assert = require('node:assert');
const tw = require('../src/main/turnwatch');

const big = 'x'.repeat(tw.BIG_READ * 4);

test('toolFacts: a whole read, a helper brief, a commit', () => {
  assert.deepStrictEqual(tw.toolFacts('Read', { file_path: 'a.js' }), { wholeRead: true });
  assert.deepStrictEqual(tw.toolFacts('Read', { file_path: 'a.js', offset: 10, limit: 50 }), {});
  assert.deepStrictEqual(tw.toolFacts('Agent', { prompt: 'abcd' }), { briefChars: 4 });
  assert.deepStrictEqual(tw.toolFacts('Bash', { command: 'git add -A && git commit -m "x"' }), { commits: true });
  assert.deepStrictEqual(tw.toolFacts('Bash', { command: 'git -C repo commit -m x' }), { commits: true });
  assert.deepStrictEqual(tw.toolFacts('Bash', { command: 'git log' }), {});
  assert.deepStrictEqual(tw.toolFacts('Edit', null), {});
});

test('seeItem: a whole read counts its result; ranged reads and helpers\' steps do not', () => {
  let w = tw.startTurn();
  w = tw.seeItem(w, { kind: 'tool', id: 'r1', name: 'Read', wholeRead: true });
  w = tw.seeItem(w, { kind: 'tool_result', id: 'r1', chars: big.length });
  assert.strictEqual(w.bigRead, tw.BIG_READ);
  assert.deepStrictEqual(w.reads, {});
  const sub = tw.seeItem(tw.startTurn(), { kind: 'tool', id: 'r2', name: 'Read', wholeRead: true, sub: { parent: 'a' } });
  assert.deepStrictEqual(sub.reads, {});
  const failed = tw.seeItem(tw.seeItem(tw.startTurn(), { kind: 'tool', id: 'r3', wholeRead: true }), { kind: 'tool_result', id: 'r3', isError: true, chars: big.length });
  assert.strictEqual(failed.bigRead, 0);
});

test('watchNotes: each note once, and only past its line', () => {
  let w = tw.startTurn();
  w = tw.seeItem(w, { kind: 'tool', id: 'r1', wholeRead: true });
  w = tw.seeItem(w, { kind: 'tool_result', id: 'r1', chars: big.length });
  w = tw.seeItem(w, { kind: 'tool', id: 'a1', briefChars: tw.LONG_BRIEF * 4 });
  w = tw.seeItem(w, { kind: 'tool', id: 'b1', commits: true });
  const cost = { tokens: 50000, contextPct: tw.COMPACT_PCT, effort: 'high', thinking: tw.HARD_THINKING };
  const notes = tw.watchNotes(w, { cost, category: 'tidy' });
  assert.deepStrictEqual(notes.map(n => n.kind), ['big-read', 'brief', 'compact', 'effort']);
  assert.strictEqual(notes.find(n => n.kind === 'compact').action, 'compact');
  const said = tw.markSaid({}, notes);
  assert.deepStrictEqual(tw.watchNotes(w, { cost, category: 'tidy', said }), []);
});

test('watchNotes: nothing for a quiet turn, a low context or a big job', () => {
  const w = tw.seeItem(tw.startTurn(), { kind: 'tool', id: 'b1', commits: true });
  assert.deepStrictEqual(tw.watchNotes(w, { cost: { contextPct: 10, effort: 'high', thinking: 90000 }, category: 'feature' }), []);
  assert.deepStrictEqual(tw.watchNotes(tw.startTurn(), { cost: { contextPct: 90 } }), []);
  assert.deepStrictEqual(tw.watchNotes(w, { cost: null }), []);
});
