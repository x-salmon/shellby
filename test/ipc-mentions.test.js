// @ mentions' IPC (src/main/ipc/mentions.js): "You've asked this before" is
// looked up only for a tab that hasn't started, and only with it on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeElectron, createFakeIpc, fakeConfig } = require('./helpers/fake-ipc');

installFakeElectron();
const { registerMentionsIpc } = require('../src/main/ipc/mentions');

function setup({ settings = {}, tabs = { fresh: { saved: false }, started: { saved: true } } } = {}) {
  const ipc = createFakeIpc();
  const asked = [];
  registerMentionsIpc(ipc.ipcMain, {
    config: fakeConfig(settings),
    manager: { tabs: new Map(Object.entries(tabs)) },
    mentionContext: { similar: async (tabId, text) => { asked.push([tabId, text]); return [{ id: 'old' }]; } },
  });
  return { ipc, asked };
}

const ASK = 'fix the flaky login test on CI';

test('context:similar answers for a tab that has not started', async () => {
  const { ipc, asked } = setup();
  assert.deepEqual(await ipc.invoke('context:similar', { tabId: 'fresh', text: ASK }), [{ id: 'old' }]);
  assert.deepEqual(asked, [['fresh', ASK]]);
});

test('context:similar stays quiet once a tab has started, when it is off, or for junk', async () => {
  const { ipc, asked } = setup();
  assert.deepEqual(await ipc.invoke('context:similar', { tabId: 'started', text: ASK }), []);
  assert.deepEqual(await ipc.invoke('context:similar', { tabId: 'gone', text: ASK }), []);
  assert.deepEqual(await ipc.invoke('context:similar', { tabId: 'fresh', text: '' }), []);
  assert.deepEqual(await ipc.invoke('context:similar', { tabId: 'fresh', text: 'x'.repeat(20001) }), []);
  assert.deepEqual(await ipc.invoke('context:similar', {}), []);
  assert.deepEqual(asked, []);
  const off = setup({ settings: { askedBefore: false } });
  assert.deepEqual(await off.ipc.invoke('context:similar', { tabId: 'fresh', text: ASK }), []);
});
