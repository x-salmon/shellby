const test = require('node:test');
const assert = require('node:assert/strict');
const chatlink = require('../src/main/chatlink');

const NOW = 1_800_000_000_000;

test('lists other conversations with their state and branch, marked as information', () => {
  const out = chatlink.describeList([
    { id: 't1', title: 'Fix login', busy: true, branch: 'shellby/fix-login', activeAt: NOW - 120_000 },
    { id: 't2', title: '', busy: false, inTerminal: true },
  ], NOW);
  assert.match(out, /^\(Written by another conversation/);
  assert.match(out, /t1: "Fix login" · working · branch shellby\/fix-login · active 2m ago/);
  assert.match(out, /t2: "Untitled" · in a terminal/);
});

test('says so when no other conversation is open', () => {
  assert.equal(chatlink.describeList([], NOW), 'No other conversations are open in this project.');
});

test('a transcript keeps only what was said, the last few turns, clipped', () => {
  const items = [
    { kind: 'user', text: 'first' },
    { kind: 'tool', text: 'ignored' },
    { kind: 'text', text: 'reply one' },
    { kind: 'user', text: 'x'.repeat(5000) },
    { kind: 'text', text: '  ' },
  ];
  const out = chatlink.describeTranscript(items, { title: 'Chat', turns: 2 });
  assert.doesNotMatch(out, /first|ignored/);
  assert.match(out, /Claude: reply one/);
  assert.match(out, /User: x+…/);
  assert.ok(out.length < 2000);
});

test('turns is capped and defaults when not a positive integer', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ kind: 'user', text: `m${i}` }));
  assert.match(chatlink.describeTranscript(items, { turns: 999 }), new RegExp(`last ${chatlink.MAX_TURNS} messages`));
  assert.match(chatlink.describeTranscript(items, { turns: -1 }), new RegExp(`last ${chatlink.DEFAULT_TURNS} messages`));
  assert.match(chatlink.describeTranscript([], { title: 'Empty' }), /nothing said/);
});

test('checkHandOff refuses a missing target, an empty brief and a long one', () => {
  assert.equal(chatlink.checkHandOff({ brief: 'x' }).ok, false);
  assert.equal(chatlink.checkHandOff({ to: 'new', brief: '  ' }).ok, false);
  assert.equal(chatlink.checkHandOff({ to: 'new', brief: 'x'.repeat(chatlink.MAX_BRIEF + 1) }).ok, false);
  assert.equal(chatlink.checkHandOff(null).ok, false);
});

test('checkHandOff makes a one-line title from the brief when none is given', () => {
  const r = chatlink.checkHandOff({ to: 'new', brief: 'Write the tests\nfor the parser' });
  assert.deepEqual(r, { ok: true, to: 'new', brief: 'Write the tests\nfor the parser', title: 'Write the tests for the parser' });
});

test('the worktree note names branch and commit, and warns about uncommitted changes', () => {
  const note = chatlink.worktreeNote({ branch: 'feat/x', commit: 'abc1234', dirty: 3 });
  assert.match(note, /own copy, on the branch feat\/x at commit abc1234/);
  assert.match(note, /3 uncommitted changes/);
  assert.match(chatlink.worktreeNote({ branch: '', commit: 'abc1234', dirty: 0 }, { sameCopy: true }), /same folder, on a detached HEAD/);
  assert.equal(chatlink.worktreeNote(null), '');
});

test('the receiver is told the brief came through Shellby', () => {
  const p = chatlink.briefPrompt({ fromTitle: 'Planner', brief: 'Do the thing', note: 'Branch x.', approved: true });
  assert.match(p, /^\[Shellby: handed off from "Planner".*The user approved it\.\]/);
  assert.match(chatlink.briefPrompt({ fromTitle: 'P', brief: 'b' }), /The user has not reviewed it\.\]/);
  assert.match(p, /Do the thing\n\n\[Shellby: Branch x\.\]$/);
  assert.doesNotMatch(chatlink.briefPrompt({ fromTitle: '', brief: 'b', note: '' }), /\n\n\[Shellby: \]/);
});

test('the sender hears where it went and what it left uncommitted', () => {
  assert.equal(chatlink.sentReply({ toTitle: 'A', isNew: false, dirty: 0 }), 'Sent to "A".');
  assert.match(chatlink.sentReply({ toTitle: 'B', isNew: true, branch: 'shellby/b', dirty: 1 }), /new conversation, "B", started on it on the branch shellby\/b\. You have 1 uncommitted change/);
});

test('a hand-off to a chat that may do more without asking escalates', () => {
  assert.equal(chatlink.escalates('ask', 'autonomous'), true);
  assert.equal(chatlink.escalates('plan', 'ask'), true);
  assert.equal(chatlink.escalates('smart', 'smart'), false);
  assert.equal(chatlink.escalates('autonomous', 'ask'), false);
  assert.equal(chatlink.escalates('ask', 'someNewMode'), true);
  assert.equal(chatlink.modeName('acceptEdits'), 'Accept edits');
});
