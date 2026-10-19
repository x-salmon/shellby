// Pictures piling up in a conversation (src/main/sessions.js, turncost.js
// pictureNote): counted from what the main thread sees, said once under a
// turn's cost, and forgotten when the conversation starts over.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { SessionManager } = require('../src/main/sessions');
const { History } = require('../src/main/history');
const { PILED_PICTURES } = require('../src/main/turncost');

function makeTab() {
  const history = new History(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-pictures-')));
  const mgr = new SessionManager({ getExe: () => process.execPath, history, getMode: () => 'ask', getModel: () => '' });
  const seen = [];
  mgr.on('item', (_tabId, item) => seen.push(item));
  return { mgr, seen, tab: mgr.open({ tabId: 't1', cwd: os.tmpdir() }) };
}
const shot = { type: 'base64', media_type: 'image/png', data: 'AA==' };
const picture = (mgr, tab, sub = false) => mgr.onItem(tab, { kind: 'tool_result', id: 'x', text: '', images: [shot], ...(sub ? { sub: true, parent: 'p' } : {}) });
const turn = (mgr, tab, seen) => {
  mgr.onItem(tab, { kind: 'result', ok: true, cost: { tokens: 1000, weight: 1 } });
  return seen.filter(i => i.kind === 'result').at(-1).cost.notes || [];
};

test('pictures in the conversation get a note once, and a fresh start forgets them', () => {
  const { mgr, seen, tab } = makeTab();
  for (let i = 1; i < PILED_PICTURES; i += 1) picture(mgr, tab);
  picture(mgr, tab, true);
  assert.deepEqual(turn(mgr, tab, seen), [], "a helper's picture stays in its own context");
  picture(mgr, tab);
  assert.deepEqual(turn(mgr, tab, seen).map(n => n.kind), ['pictures']);
  picture(mgr, tab);
  assert.deepEqual(turn(mgr, tab, seen), [], 'said once a conversation');
  mgr.note('t1', { kind: 'fresh' });
  assert.equal(tab.pictures, 0);
  for (let i = 0; i < PILED_PICTURES; i += 1) picture(mgr, tab);
  assert.deepEqual(turn(mgr, tab, seen).map(n => n.kind), ['pictures'], 'the new conversation can be told again');
});
