// One turn on a cheaper model (the card offering Haiku, model-pick.js): the tab
// must always go back to its own model, however the turn ends — a result, a
// send that throws before Claude has it, or a process that ends with no result —
// and messages queued while it runs wait for the next turn rather than ride along.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { SessionManager } = require('../src/main/sessions');
const { History } = require('../src/main/history');
const { models } = require('../src/main/models');

const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const CHEAP = (models().find(m => /haiku/i.test(m.id)) || models()[0]).id;
const managers = [];
after(() => { for (const m of managers) m.closeAll({ kill: true }); });

function manager() {
  const history = new History(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-turnmodel-')));
  const mgr = new SessionManager({ getExe: () => process.execPath, argsPrefix: [FAKE], history, getMode: () => 'ask', getModel: () => '' });
  managers.push(mgr);
  return mgr;
}

function result(mgr, tabId, ms = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no result')), ms);
    mgr.on('item', function h(id, item) {
      if (id === tabId && item.kind === 'result') { clearTimeout(t); mgr.off('item', h); resolve(item); }
    });
  });
}

test('a turn sent on a cheaper model runs on it, then the tab is back on its own', async () => {
  const mgr = manager();
  mgr.open({ tabId: 't-ok', cwd: os.tmpdir() });
  const tab = mgr.tabs.get('t-ok');
  const done = result(mgr, 't-ok');
  mgr.send('t-ok', 'rename a thing', { kind: 'user', text: 'rename a thing' }, { model: CHEAP });
  assert.equal(tab.session.model, CHEAP, 'this turn runs on the model picked on the card');
  await done;
  assert.equal(tab.session.model || '', '', "and afterwards the tab's own model is back");
  assert.equal(tab.turnModel, null);
});

test('a send that throws before Claude has the message puts the model back', () => {
  const mgr = manager();
  mgr.open({ tabId: 't-throw', cwd: os.tmpdir() });
  const tab = mgr.tabs.get('t-throw');
  tab.session.send = () => { throw new Error('busy'); };
  assert.throws(() => mgr.send('t-throw', 'x', { kind: 'user', text: 'x' }, { model: CHEAP }), /busy/);
  assert.equal(tab.session.model || '', '', 'the next turn is not quietly on the cheaper model');
  assert.equal(tab.turnModel, null);
});

test('a process that ends with no result puts the model back, and nothing queued rides along meanwhile', () => {
  const mgr = manager();
  mgr.open({ tabId: 't-exit', cwd: os.tmpdir() });
  const tab = mgr.tabs.get('t-exit');
  tab.session.send = () => {}; // taken, never answered
  mgr.send('t-exit', 'x', { kind: 'user', text: 'x' }, { model: CHEAP });
  tab.steers = [{ id: 'q1', text: 'a longer follow-up', attachments: [] }];
  assert.deepEqual(mgr.takeSteers(tab), [], 'queued messages wait for a turn on your own model');
  tab.session.emit('exit', 1);
  assert.equal(tab.session.model || '', '');
  assert.equal(tab.turnModel, null);
});
