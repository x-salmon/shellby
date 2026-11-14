// How the panel's queue becomes turns (src/renderer/panel/queue-turns.js):
// plain messages merged into one, commands and picks kept apart, and which
// messages may wait a moment for company when typed while idle.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../src/renderer/panel/queue-turns');

const m = (text, over = {}) => ({ id: `q-${text}`, text, attachments: [], ...over });

test('the merge window is short and named', () => {
  assert.equal(Q.MERGE_WINDOW_MS, 1500);
});

test('solo: commands, ! runs, a file picked, or one typed as a command need a turn of their own', () => {
  assert.equal(Q.solo(m('/compact')), true);
  assert.equal(Q.solo(m('!!git status')), true);
  assert.equal(Q.solo(m('fix it', { selected: 'src/app.js' })), true);
  assert.equal(Q.solo(m('the words /subtask stood for', { solo: true })), true);
  assert.equal(Q.solo(m('plain words')), false);
  assert.equal(Q.solo(m('', { attachments: ['a.png'] })), false);
});

test('nextTurn merges every plain message up to the first command into one, each its own paragraph', () => {
  const queue = [m('one'), m('two'), m('/review'), m('three')];
  const turn = Q.nextTurn(queue);
  assert.deepEqual(turn.items.map(x => x.id), ['q-one', 'q-two']);
  assert.equal(turn.text, 'one\n\ntwo');
  assert.deepEqual(turn.rest.map(x => x.id), ['q-/review', 'q-three']);
  assert.equal(turn.selected, undefined);
});

test('nextTurn sends a command at the head of the queue alone', () => {
  const turn = Q.nextTurn([m('/review'), m('one'), m('two')]);
  assert.deepEqual(turn.items.map(x => x.id), ['q-/review']);
  assert.equal(turn.text, '/review');
  assert.deepEqual(turn.rest.map(x => x.id), ['q-one', 'q-two']);
});

test('nextTurn takes the whole queue when nothing in it is solo', () => {
  const turn = Q.nextTurn([m('a'), m('b'), m('c')]);
  assert.equal(turn.text, 'a\n\nb\n\nc');
  assert.deepEqual(turn.rest, []);
});

test('nextTurn keeps every file, in order and each once, and skips wordless messages\' blank lines', () => {
  const turn = Q.nextTurn([m('look', { attachments: ['a.png'] }), m('', { attachments: ['b.txt', 'a.png'] }), m('and this')]);
  assert.equal(turn.text, 'look\n\nand this');
  assert.deepEqual(turn.attachments, ['a.png', 'b.txt']);
});

test('nextTurn carries the pick only for a turn of one message', () => {
  const picked = m('fix it', { selected: 'src/app.js' });
  assert.equal(Q.nextTurn([m('one'), picked]).selected, undefined);
  assert.equal(Q.nextTurn([picked, m('one')]).selected, 'src/app.js');
  assert.deepEqual(Q.nextTurn([picked, m('one')]).rest.map(x => x.id), ['q-one']);
});

test('nextTurn is null for an empty queue and leaves the queue it was given alone', () => {
  assert.equal(Q.nextTurn([]), null);
  const queue = [m('a'), m('b')];
  Q.nextTurn(queue);
  assert.equal(queue.length, 2);
});

test('canMerge: a plain message may wait, unless the setting is off, the queue is paused, or it is solo', () => {
  assert.equal(Q.canMerge(m('plain')), true);
  assert.equal(Q.canMerge(m('plain'), { on: false }), false);
  assert.equal(Q.canMerge(m('plain'), { paused: true }), false);
  assert.equal(Q.canMerge(m('/compact')), false);
  assert.equal(Q.canMerge(m('words', { solo: true })), false);
});
