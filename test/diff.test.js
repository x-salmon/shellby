const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/renderer/shared/diff');

const kinds = rows => rows.map(r => (r.t === '…' ? `…${r.n}` : `${r.t}${r.s}`));

test('editsOf reads each write tool, and nothing else', () => {
  assert.deepEqual(D.editsOf('Edit', { file_path: 'a', old_string: 'x', new_string: 'y' }), [{ old: 'x', new: 'y' }]);
  assert.deepEqual(D.editsOf('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, null, { old_string: 'c' }, { old_string: 'd', new_string: '' }] }),
    [{ old: 'a', new: 'b' }, { old: 'd', new: '' }]);
  assert.deepEqual(D.editsOf('Write', { content: 'hi' }), [{ old: null, new: 'hi' }]);
  assert.deepEqual(D.editsOf('NotebookEdit', { new_source: 'x = 1', edit_mode: 'insert' }), [{ old: '', new: 'x = 1' }]);
  assert.deepEqual(D.editsOf('Bash', { command: 'ls' }), []);
  assert.deepEqual(D.editsOf('Edit', null), []);
  assert.equal(D.editsOf('Write', { content: 'x'.repeat(D.MAX_TEXT + 5) })[0].new.length, D.MAX_TEXT);
});

test('diffLines keeps common lines and puts removals before additions', () => {
  assert.deepEqual(kinds(D.diffLines('a\nb\nc', 'a\nB\nc')), [' a', '-b', '+B', ' c']);
  assert.deepEqual(kinds(D.diffLines('', 'new')), ['+new']);
  assert.deepEqual(kinds(D.diffLines('gone', '')), ['-gone']);
  assert.deepEqual(kinds(D.diffLines('a\r\nb\r\n', 'a\nb\nc\n')), [' a', ' b', '+c']);
  // An insertion in the middle is one added line, not a rewrite of the rest.
  assert.deepEqual(kinds(D.diffLines('1\n2\n3\n4', '1\n2\nnew\n3\n4')), [' 1', ' 2', '+new', ' 3', ' 4']);
});

test('rows numbers lines from where the edit sits, and folds long unchanged runs', () => {
  const old = ['x', ...Array.from({ length: 10 }, (_, i) => `same ${i}`), 'y'].join('\n');
  const now = ['X', ...Array.from({ length: 10 }, (_, i) => `same ${i}`), 'Y'].join('\n');
  const rows = D.rows({ old, new: now }, { line: 40, context: 2 });
  assert.deepEqual(kinds(rows), ['-x', '+X', ' same 0', ' same 1', '…6', ' same 8', ' same 9', '-y', '+Y']);
  assert.deepEqual([rows[0].a, rows[0].b], [40, undefined]);
  assert.deepEqual([rows[1].a, rows[1].b], [undefined, 40]);
  assert.deepEqual([rows[2].a, rows[2].b], [41, 41]);
  assert.deepEqual([rows.at(-1).a, rows.at(-1).b], [undefined, 51]);
  // Without a starting line there are no numbers at all.
  assert.equal(D.rows({ old: 'a', new: 'b' })[0].a, undefined);
  // A new file is all additions.
  assert.deepEqual(kinds(D.rows({ old: null, new: 'one\ntwo\n' })), ['+one', '+two']);
});

test('stats counts added and removed lines across edits', () => {
  assert.deepEqual(D.stats([{ old: 'a\nb', new: 'a\nc\nd' }, { old: null, new: '1\n2\n3' }]), { added: 5, removed: 1 });
  assert.deepEqual(D.stats([]), { added: 0, removed: 0 });
});

test('lineOf finds where a snippet starts', () => {
  assert.equal(D.lineOf('one\ntwo\nthree', 'two\nthree'), 2);
  assert.equal(D.lineOf('one\ntwo', 'one'), 1);
  assert.equal(D.lineOf('one', 'nope'), null);
  assert.equal(D.lineOf('one', ''), null);
});

test('a huge rewrite falls back to "all removed, all added" instead of a huge table', () => {
  const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n');
  const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n');
  const t = Date.now();
  const rows = D.diffLines(a, b);
  assert.ok(Date.now() - t < 2000);
  assert.equal(rows.length, 6000);
  assert.equal(rows[0].t, '-');
  assert.equal(rows.at(-1).t, '+');
});

test('wordDiff marks just the argument that changed', () => {
  const a = 'call(foo, 1, bar)';
  const b = 'call(foo, 2, bar)';
  const d = D.wordDiff(a, b);
  assert.deepEqual(d.a.map(([s, e]) => a.slice(s, e)), ['1']);
  assert.deepEqual(d.b.map(([s, e]) => b.slice(s, e)), ['2']);
});

test('wordDiff joins two changed words across the space between them', () => {
  const a = 'const total = price * count;';
  const b = 'const total = netPrice + tax;';
  const d = D.wordDiff(a, b);
  assert.deepEqual(d.b.map(([s, e]) => b.slice(s, e)), ['netPrice + tax']);
});

test('wordDiff marks an insertion on one side only', () => {
  const d = D.wordDiff('let x = 1;', 'let x = 1 + y;');
  assert.deepEqual(d.a, []);
  assert.equal(d.b.length, 1);
});

test('wordDiff gives up on lines with little in common, or none at all', () => {
  assert.equal(D.wordDiff('return render(view);', 'import fs from "fs";'), null);
  assert.equal(D.wordDiff('same line', 'same line'), null);
  assert.equal(D.wordDiff('', 'x'), null);
  assert.equal(D.wordDiff('a '.repeat(300), 'b '.repeat(300)), null, 'too long to compare');
});

test('wordMarks pairs each run of removed lines with the added run after it', () => {
  const rows = [
    { kind: 'ctx', text: 'a' },
    { kind: 'del', text: 'x = f(1)' },
    { kind: 'del', text: 'y = g(2)' },
    { kind: 'add', text: 'x = f(3)' },
    { kind: 'hunk', text: '@@' },
    { kind: 'add', text: 'z = 1' },
  ];
  const m = D.wordMarks(rows);
  assert.deepEqual([...m.keys()].sort(), [1, 3]);
  assert.deepEqual(m.get(3).map(([s, e]) => rows[3].text.slice(s, e)), ['3']);
});
