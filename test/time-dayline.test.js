// Where things sit on a day's line in "how it was written" (src/renderer/shared/time-dayline.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/renderer/shared/time-dayline');

const at = (h, m = 0) => new Date(2026, 10, 12, h, m).getTime();
const line = (key, extra = {}) => ({ key, name: key, total: 3600, note: '', draft: null, commits: [], chats: [], slots: [], ...extra });

test('runs joins quarter hours that follow on, in order, once each', () => {
  assert.deepEqual(L.runs([37, 36, 36, 40, 38]), [{ start: 540, end: 585 }, { start: 600, end: 615 }]);
  assert.deepEqual(L.runs([]), []);
});

test('span covers everything in whole hours, at least eight of them, and keeps to the day', () => {
  assert.deepEqual(L.span({ lines: [] }), { from: 480, to: 1080 }, 'an empty day shows 8 to 6');
  assert.deepEqual(L.span({ lines: [line('a', { slots: [36], commits: [{ id: 'g', at: at(19, 10), subject: 's' }] })] }), { from: 540, to: 1200 });
  assert.deepEqual(L.span({ lines: [line('a', { slots: [94] })] }), { from: 960, to: 1440 }, 'late at night it grows backwards');
});

test('lanes places kept time, conversations and commits as percents of the span', () => {
  const v = { lines: [line('a', { slots: [32, 33], chats: [{ id: 'c:1', title: 'Badge', from: at(12), to: at(12) }], commits: [{ id: 'g:1', at: at(16), subject: 'feat' }] })] };
  const ln = L.lanes(v);
  assert.deepEqual(ln.span, { from: 480, to: 1020 });
  assert.equal(ln.hours[0].label, '8 am');
  assert.equal(ln.hours.at(-1).label, '5 pm');
  assert.deepEqual(ln.kept, [{ key: 'a', left: 0, width: 50 / 9 }]);
  assert.equal(ln.chats[0].left, 400 / 9);
  assert.ok(ln.chats[0].width >= 0.6, 'a moment still shows');
  assert.equal(ln.commits[0].left, 800 / 9);
});

test('sourcesOf finds what a sentence points at, in its order, and drops what is gone', () => {
  const v = { lines: [line('a', { commits: [{ id: 'g:1', at: 1, subject: 'feat' }] }), line('b', { chats: [{ id: 'c:9', title: 'T', from: 1, to: 2, asks: [] }] })] };
  assert.deepEqual(L.sourcesOf(v, ['c:9', 'nope', 'g:1', 'g:1']).map(s => [s.kind, s.id]), [['chat', 'c:9'], ['commit', 'g:1']]);
});

test('firstSentence picks the first draft on show, passing over one your own words replaced', () => {
  const draft = { sentences: [{ text: 'x', src: [] }] };
  assert.equal(L.firstSentence({ lines: [line('a'), line('b', { draft })] }), 'b|0');
  assert.equal(L.firstSentence({ lines: [line('a', { note: 'mine', draft }), line('b', { draft })] }), 'b|0');
  assert.equal(L.firstSentence({ lines: [line('a', { note: 'x', draft: { ...draft, kept: true } })] }), 'a|0', 'a kept draft is still on show');
  assert.equal(L.firstSentence({ lines: [line('a')] }), null);
});
