'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { accounting } = require('../src/main/session/accounting');

const reply = tokens => ({ type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: tokens } } });

function session(extra = {}) {
  return Object.assign({ context: null, windows: null, model: '', lastModel: null, emit() {} }, accounting, extra);
}

test('a new chat keeps its first reading as the fixed-setup base', () => {
  const s = session();
  s.measure(reply(28000));
  s.measure(reply(31000));
  assert.strictEqual(s.contextBase, 28000);
  assert.strictEqual(s.context.tokens, 31000);
});

test('a resumed chat has no base, so its whole context counts', () => {
  const s = session({ resumeId: 'abc' });
  s.measure(reply(90000));
  assert.strictEqual(s.contextBase, undefined);
});

test('a compact keeps the base from the chat start', () => {
  const s = session();
  s.measure(reply(25000));
  s.measure({ type: 'system', subtype: 'compact_boundary' });
  s.measure(reply(12000));
  assert.strictEqual(s.contextBase, 25000);
});
