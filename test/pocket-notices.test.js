// Shellby on your phone, its notifications (pocket/notices.js): a permission
// prompt the phone could answer with Allow and Deny carries those two buttons
// (Android shows them), and only to a phone with full rights. A question, a
// plan or anything that waits for the desk never does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const push = require('../src/main/pocket/push');
const { answerable, createPocketNotices } = require('../src/main/pocket/notices');

const asking = { kind: 'asking', tabId: 't1', requestId: 'r1', label: 'Run a command', detail: 'npm test' };
const bash = { toolName: 'Bash', input: { command: 'npm test' } };

test('a plain prompt can be answered from its notification, a question or a plan cannot', () => {
  assert.deepEqual(answerable(asking, bash), { tabId: 't1', requestId: 'r1' });
  assert.equal(answerable(asking, { toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which?', options: [] }] } }), null);
  assert.equal(answerable(asking, { toolName: 'ExitPlanMode', input: { plan: 'Do it' } }), null);
  assert.equal(answerable(asking, { ...bash, runsCreated: ['script.ps1'] }), null, 'one for the desk');
  assert.equal(answerable(asking, null), null, 'already answered');
  assert.equal(answerable({ ...asking, kind: 'done' }, bash), null);
  assert.equal(answerable({ ...asking, requestId: '../x' }, bash), null);
});

function notices(devices, { allow = { notifyAnswers: true } } = {}) {
  const sent = [];
  const realBuild = push.buildPushRequest;
  const realSend = push.sendPush;
  push.buildPushRequest = (sub, payload) => { sent.push({ to: sub.endpoint, payload }); return { url: sub.endpoint }; };
  push.sendPush = async () => ({ ok: true });
  const tab = { session: { pending: new Map([['r1', bash]]) } };
  const d = { config: { get: () => undefined }, manager: { tabs: new Map([['t1', tab]]) }, log: { info() {} } };
  const n = createPocketNotices(d, {
    settings: () => ({ enabled: true, allow, notify: { enabled: true, events: { asking: true }, minSeconds: 0, whileFocused: true }, quiet: { on: false } }),
    devices: () => devices,
    saveDevices() {},
    vapidKeys: () => ({ publicKey: 'p', privateKey: 'k' }),
    waitingPrompts: () => [{ ...bash, tabId: 't1' }],
    changed() {},
  });
  const restore = () => { push.buildPushRequest = realBuild; push.sendPush = realSend; };
  return { n, sent, restore };
}

test('no buttons until Settings allows them: they can work from a locked phone', () => {
  const { n, sent, restore } = notices([{ id: 'a', rights: 'full', push: { endpoint: 'https://fcm.googleapis.com/a' } }], { allow: {} });
  try {
    assert.equal(n.notify(asking), true);
    assert.equal(sent[0].payload.answer, undefined);
  } finally { restore(); }
});

test('Allow and Deny ride only to a phone that may answer', () => {
  const { n, sent, restore } = notices([
    { id: 'a', rights: 'full', push: { endpoint: 'https://fcm.googleapis.com/a' } },
    { id: 'b', rights: 'readonly', push: { endpoint: 'https://fcm.googleapis.com/b' } },
  ]);
  try {
    assert.equal(n.notify(asking), true);
    const to = id => sent.find(s => s.to.endsWith(`/${id}`)).payload;
    assert.deepEqual(to('a').answer, { tabId: 't1', requestId: 'r1' });
    assert.equal(to('b').answer, undefined);
    assert.equal(to('a').url, '/#/prompt/t1/r1');
    assert.equal(to('b').url, '/#/prompt/t1/r1', 'a tap still opens the prompt');
  } finally { restore(); }
});
