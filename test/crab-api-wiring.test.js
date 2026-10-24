// The crab's routine tools in Shellby's own conversations (wiring/crab-api.js):
// they reach the confirm window without the plugin's token file, while the
// open port still turns away anything that doesn't show it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installFakeElectron } = require('./helpers/fake-ipc');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-crabapi-'));
installFakeElectron({ userData });
const { wireCrabApi } = require('../src/main/wiring/crab-api');

function setup() {
  const proposed = [];
  const d = {
    external: {},
    log: { warn: () => {} },
    config: { get: () => false },
    routineService: { proposeRoutine: async routine => { proposed.push(routine); return { text: 'Asked the user.' }; } },
    routinesView: () => [],
  };
  const api = wireCrabApi(d);
  api.createCrabApi();
  return { d, api, proposed };
}

test.after(() => fs.rmSync(userData, { recursive: true, force: true }));

test('add_routine from a Shellby conversation puts up the confirm, with no token from the plugin', async () => {
  const { api, proposed } = setup();
  const r = await api.crabTool({}, 'add_routine', { name: 'Parity check', prompt: 'Compare features.', schedule: 'weekly mon 9:00' });
  assert.equal(r.isError, undefined, r.text);
  assert.equal(r.text, 'Asked the user.');
  assert.equal(proposed.length, 1);
  assert.deepEqual(proposed[0].schedule, { type: 'weekly', time: '09:00', days: [1] });
});

test('a schedule it cannot read is sent back with the forms it takes, and nothing is asked', async () => {
  const { api, proposed } = setup();
  const r = await api.crabTool({}, 'add_routine', { name: 'x', prompt: 'y', schedule: 'whenever' });
  assert.equal(r.isError, true);
  assert.match(r.text, /daily 08:30/);
  assert.equal(proposed.length, 0);
});

test('list_routines from a Shellby conversation answers', async () => {
  const { api } = setup();
  assert.deepEqual(await api.crabTool({}, 'list_routines', {}), { text: 'The user has no routines yet.' });
});

test('the port still refuses routines to a caller without the token', async () => {
  const { d, proposed } = setup();
  const r = await d.external.onCrab({ action: 'add_routine', args: { name: 'x', prompt: 'y', schedule: { type: 'daily', time: '09:00' } } }, { token: '' });
  assert.equal(r.status, 401);
  assert.equal(proposed.length, 0);
});
