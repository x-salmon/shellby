// Notes, the pure part (src/renderer/panel/notes-logic.js): where a note
// stands, how the list groups and filters, its story so far, and the buttons
// the open note offers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/renderer/panel/notes-logic');

const note = (id, extra = {}) => ({ id, text: id, createdAt: 1, done: false, pinned: false, from: 'you', runs: [], ...extra });
const ask = (extra = {}) => ({ kind: 'ask', at: 5, tabId: 'tA', ...extra });

test('a note is new until run, answered once Claude replies, under way once planned or built', () => {
  assert.equal(L.stageOf(note('a')), 'new');
  assert.equal(L.stageOf(note('a', { runs: [ask()] })), 'started', 'asked, still waiting on the answer');
  assert.equal(L.stageOf(note('a', { runs: [ask({ verdict: 'do' })] })), 'answered', 'an older store kept only the verdict');
  assert.equal(L.stageOf(note('a', { runs: [ask({ answer: 'hmm' })] })), 'answered');
  assert.equal(L.stageOf(note('a', { runs: [{ kind: 'plan', at: 6 }, ask({ verdict: 'do' })] })), 'started');
});

test('the open list groups pinned, answered, under way and new, keeping order inside each', () => {
  const list = [
    note('new1'), note('ans', { runs: [ask({ answer: 'x' })] }), note('pin', { pinned: true, runs: [ask({ answer: 'x' })] }),
    note('built', { runs: [{ kind: 'build', at: 9 }] }), note('new2'), note('gone', { done: true }),
  ];
  assert.deepEqual(L.grouped(list).map(g => [g.key, g.notes.map(n => n.id)]), [
    ['pinned', ['pin']], ['answered', ['ans']], ['started', ['built']], ['new', ['new1', 'new2']],
  ]);
  assert.deepEqual(L.grouped([note('a'), note('b')]).map(g => g.key), ['new'], 'empty groups drop out');
});

test('the chips count open notes; Open always shows, the rest only when they have any', () => {
  const list = [note('a'), note('b', { from: 'claude' }), note('c', { runs: [ask({ verdict: 'skip' })] }), note('d', { done: true })];
  assert.deepEqual(L.chips(list).map(c => [c.key, c.count]), [['open', 3], ['answered', 1], ['new', 2], ['claude', 1]]);
  assert.deepEqual(L.chips([note('a')]).map(c => c.key), ['open', 'new']);
  assert.deepEqual(L.shown(list, 'claude').map(n => n.id), ['b']);
  assert.deepEqual(L.shown(list, 'nonsense').map(n => n.id), ['a', 'b', 'c'], 'an unknown chip reads as Open');
});

test('the story so far runs oldest first, from when it was noted', () => {
  const n = note('a', { from: 'claude', createdAt: 1, runs: [{ kind: 'plan', at: 9, tabId: 'tP' }, ask({ verdict: 'differently', at: 5 })] });
  assert.deepEqual(L.story(n).map(s => [s.label, s.at]), [['Claude noted it', 1], ['Asked Claude: Do it differently', 5], ['Planned', 9]]);
  assert.equal(L.story(n)[2].tabId, 'tP');
  assert.deepEqual(L.story(note('b')).map(s => s.label), ['Noted']);
});

test("Claude's version leads once Claude said do it differently, and the next step is primary", () => {
  const diff = note('a', { runs: [ask({ verdict: 'differently', answer: 'Do it differently\n- cap at 50' })] });
  assert.deepEqual(L.actions(diff).map(a => [a.id, a.label, !!a.primary]), [
    ['plan-claude', "Plan Claude's version", true], ['plan', 'Plan mine as written', false], ['build', 'Build', false], ['ask', 'Ask again', false],
  ]);
  assert.deepEqual(L.actions(note('n')).map(a => [a.id, a.label, !!a.primary]), [['plan', 'Plan', false], ['build', 'Build', false], ['ask', 'Ask', true]]);
  // Claude said do it: plan it. Planned: build it. Built: tick it off.
  assert.equal(L.actions(note('d', { runs: [ask({ verdict: 'do', answer: 'Do it' })] })).find(a => a.primary).id, 'plan');
  assert.equal(L.actions(note('p', { runs: [{ kind: 'plan', at: 7 }] })).find(a => a.primary).id, 'build');
  assert.equal(L.actions(note('b', { runs: [{ kind: 'build', at: 7 }] })).find(a => a.primary).id, 'done');
  assert.equal(L.actions(note('s', { runs: [ask({ verdict: 'skip', answer: 'Skip it' })] })).find(a => a.primary).id, 'done');
  // Waiting on an answer, or already done: nothing pushed.
  assert.equal(L.actions(note('w', { runs: [ask()] })).some(a => a.primary), false);
  assert.equal(L.actions(note('x', { done: true })).some(a => a.primary), false);
  // An old verdict with no answer kept can't be planned "Claude's way".
  assert.equal(L.actions(note('o', { runs: [ask({ verdict: 'differently' })] })).some(a => a.id === 'plan-claude'), false);
});

test('the neighbour is the next note down, else the one above', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(L.neighbour(ids, 'b'), 'c');
  assert.equal(L.neighbour(ids, 'c'), 'b');
  assert.equal(L.neighbour(['a'], 'a'), null);
  assert.equal(L.neighbour(ids, 'zz'), 'a');
});

test("the answer under its verdict heading drops the verdict line it led with, and only that", () => {
  assert.equal(L.answerBody('**Do it differently**\n\n- cap at 50', 'differently'), '- cap at 50');
  assert.equal(L.answerBody('## Verdict: Skip it.\nExists already.', 'skip'), 'Exists already.');
  assert.equal(L.answerBody('Do it differently: cap at 50 instead.\n- why', 'differently'), 'Do it differently: cap at 50 instead.\n- why', 'a first line with more in it stays');
  assert.equal(L.answerBody('Hmm.\nNot sure.', null), 'Hmm.\nNot sure.');
  assert.equal(L.answerBody('Do it', 'do'), '');
  assert.equal(L.answerBody(undefined, 'do'), '');
});
