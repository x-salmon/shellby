const { test } = require('node:test');
const assert = require('node:assert');
const tw = require('../src/main/turnwatch');

const big = 'x'.repeat(tw.BIG_READ * 4);

test('toolFacts: a whole read, a helper brief, a commit', () => {
  assert.deepStrictEqual(tw.toolFacts('Read', { file_path: 'a.js' }), { wholeRead: true, readPath: 'a.js' });
  assert.deepStrictEqual(tw.toolFacts('Edit', { file_path: 'a.js' }), { editPath: 'a.js' });
  assert.deepStrictEqual(tw.toolFacts('Bash', { command: 'git checkout main' }), { changesFiles: true });
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

const read = (w, id, path, chars) => tw.seeItem(tw.seeItem(w, { kind: 'tool', id, wholeRead: true, readPath: path }), { kind: 'tool_result', id, chars });
const size = tw.REREAD_TOKENS * 4;

test('a whole file read again with nothing changing it, across turns', () => {
  let w = read(tw.startTurn(), 'r1', 'C:/p/src/a.js', size);
  assert.equal(w.reread, null, 'the first read is no repeat');
  w = read(tw.startTurn(w), 'r2', 'c:/p/SRC/a.js', size);
  assert.deepStrictEqual(w.reread, { path: 'c:/p/SRC/a.js', tokens: tw.REREAD_TOKENS });
  const notes = tw.watchNotes(w, { cost: { contextPct: 5 } });
  assert.deepStrictEqual(notes.map(n => n.kind), ['reread']);
  assert.match(notes[0].text, /SRC\/a\.js again/);
  assert.deepStrictEqual(tw.watchNotes(w, { cost: { contextPct: 5 }, said: tw.markSaid({}, notes) }), []);
});

test('no repeat after an edit, a shell command that changes files, a small re-read or a fresh start', () => {
  const first = read(tw.startTurn(), 'r1', '/p/a.js', size);
  const edited = tw.seeItem(first, { kind: 'tool', id: 'e1', editPath: '/p/a.js' });
  assert.equal(read(edited, 'r2', '/p/a.js', size).reread, null);
  const checkedOut = tw.seeItem(first, { kind: 'tool', id: 'b1', changesFiles: true });
  assert.equal(read(checkedOut, 'r2', '/p/a.js', size).reread, null);
  assert.equal(read(first, 'r2', '/p/a.js', 40).reread, null, "Claude Code's short 'unchanged' answer");
  assert.equal(read(tw.startTurn(), 'r2', '/p/a.js', size).reread, null);
});
