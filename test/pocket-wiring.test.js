// Shellby on your phone, wired up (wiring/pocket.js): turning it on goes
// through Tailscale and the confirmation window, a code pairs a phone, and
// each thing the phone can do keeps the phone's rules: Allow and Deny only,
// tasks in Ask first, replies only where the phone started, a turn named by
// its changes and never by a path, and notifications that follow the settings.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const path = require('path');
const { installFakeElectron } = require('./helpers/fake-ipc');

const electron = installFakeElectron();
electron.safeStorage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(`enc:${s}`), decryptString: b => String(b).replace(/^enc:/, '') };
const confirm = require('../src/main/confirm');
const push = require('../src/main/pocket/push');
const { wirePocket } = require('../src/main/wiring/pocket');

const ROOT = path.join(__dirname, '..');
const DNS = 'desk-pc.tail4e2b.ts.net';
const LOGIN = 'me@example.com';
const PROJECT = 'C:\\code\\shellby';

process.env.SHELLBY_POCKET_PORT = '0';

function fakeConfig(initial = {}) {
  const store = { ...initial };
  return { get: k => store[k], set: patch => Object.assign(store, patch), store };
}

function fakeTailscale(over = {}) {
  const calls = [];
  let served = 0;
  const t = {
    calls,
    state: { installed: true, state: 'running', dnsName: DNS, login: LOGIN, https: true, tailnet: LOGIN, ...over.status },
    funnel: false,
    async status() { calls.push(['status']); return { ...t.state }; },
    async serveStatus() { calls.push(['serveStatus']); return served ? { httpsPort: served, url: `https://${DNS}/`, funnel: t.funnel, taken: [] } : { httpsPort: 0, url: '', funnel: false, taken: [] }; },
    async serveOn({ port, httpsPort }) { calls.push(['serveOn', port, httpsPort]); if (over.serveFails) return { ok: false, error: 'Serve is not enabled on your tailnet.', link: 'https://login.tailscale.com/f/serve?node=x' }; served = httpsPort; return { ok: true }; },
    async serveOff({ httpsPort }) { calls.push(['serveOff', httpsPort]); served = 0; return { ok: true }; },
  };
  return t;
}

let answer = 0; // what the confirmation window says: 0 yes, 1 cancel
let asked = [];
const realAsk = confirm.ask;
beforeEach(() => { answer = 0; asked = []; confirm.ask = async (_parent, spec) => { asked.push(spec); return answer; }; });
afterEach(() => { confirm.ask = realAsk; });

function tabOf(id, over = {}) {
  return {
    id, title: `Tab ${id}`, turnId: null, fromPocket: false, fromPhone: false, inTerminal: false,
    session: { pending: new Map(), mode: 'ask', cwd: PROJECT, busy: false },
    ...over,
  };
}

function wired({ tailscale = fakeTailscale(), tabs = [], items = {} } = {}) {
  const rec = [];
  const note = name => (...args) => { rec.push([name, ...args]); };
  const manager = Object.assign(new EventEmitter(), {
    tabs: new Map(tabs.map(t => [t.id, t])),
    get summary() { return [...this.tabs.values()].map(t => ({ id: t.id, title: t.title, cwd: t.session.cwd, busy: t.session.busy, pending: t.session.pending.size, crew: 0, worktree: null, ready: null })); },
    get aggregate() { return { state: 'idle', crew: [] }; },
    isBusy: id => !!manager.tabs.get(id)?.session.busy,
    interrupt: note('interrupt'),
    note: note('note'),
    setReviewed: (...a) => { rec.push(['setReviewed', ...a]); return true; },
  });
  const d = {
    ROOT, config: fakeConfig(), manager, panel: {}, tailscaleCli: tailscale,
    log: { info() {}, warn() {} },
    history: { load: id => items[id] || [], update: note('history.update'), list: () => [], get: () => null, file: id => path.join(__dirname, 'nowhere', `${id}.jsonl`) },
    send: note('send'), notify: note('notify'), wake() {}, dialogLook: () => ({}), showPanel() {},
    isFolder: () => true, knownProjects: () => [{ key: PROJECT, name: 'shellby' }],
    answerPermission: (...a) => { rec.push(['answerPermission', ...a]); return true; },
    startTaskInCopy: async (...a) => { rec.push(['startTaskInCopy', ...a]); manager.tabs.set('new1', tabOf('new1')); return { ok: true, tabId: 'new1' }; },
    startTask: note('startTask'),
    holdForReset: (...a) => { rec.push(['holdForReset', ...a]); return { ok: true, atText: '14:20' }; },
    usageService: { limitWait: () => null },
    sendOutlook() {},
    sendToTab: (tabId, text) => { rec.push(['sendToTab', tabId, text]); return { ok: true, tabId, turnId: 'u9', item: { kind: 'user', text, turnId: 'u9' } }; },
    undoChanges: async ref => { rec.push(['undoChanges', ref]); return { ok: true, restored: 2 }; },
    diffChanges: async ref => { rec.push(['diffChanges', ref]); return { patch: 'diff --git a/x b/x\n' }; },
    bringTabHome: async (...a) => { rec.push(['bringTabHome', ...a]); return { ok: true, merged: true, commits: 2, base: 'main' }; },
    cancelHeld: id => { rec.push(['cancelHeld', id]); return { ok: id === 'h1' }; },
    lastStatus: { state: 'idle' }, activeSkin: () => null,
  };
  Object.assign(d, wirePocket(d));
  d.createPocket();
  return { d, rec, tailscale, of: name => rec.filter(r => r[0] === name).map(r => r.slice(1)) };
}

const listening = d => new Promise(resolve => {
  if (d.pocket.status === 'listening') return resolve();
  d.pocket.once('status', () => resolve());
});

async function turnedOn(opts) {
  const w = wired(opts);
  const v = await w.d.setPocket({ enabled: true });
  await listening(w.d);
  return { ...w, v };
}

const stop = w => w.d.pocket.stop();

test('turning it on asks first, serves the port on the tailnet, and keeps who said yes', async () => {
  const w = await turnedOn();
  try {
    assert.equal(asked.length, 1);
    assert.equal(asked[0].danger, true);
    assert.match(asked[0].message, new RegExp(LOGIN));
    assert.deepEqual(w.tailscale.calls.find(c => c[0] === 'serveOn'), ['serveOn', w.d.pocket.port, 443]);
    assert.equal(w.d.config.get('pocket').enabled, true);
    assert.equal(w.d.config.get('pocket').login, LOGIN);
    assert.equal(w.d.config.get('pocket').servedPort, 443);
    const v = w.d.pocketViewNow();
    assert.equal(v.url, `https://${DNS}/`);
    assert.ok(Array.isArray(v.qr) && v.qr.length > 10);
    assert.equal(v.problem, null);
  } finally { stop(w); }
});

test('a no in the confirmation window leaves it off, with nothing served', async () => {
  answer = 1;
  const w = wired();
  const v = await w.d.setPocket({ enabled: true });
  assert.equal(v.cancelled, true);
  assert.equal(w.d.config.get('pocket')?.enabled, undefined);
  assert.ok(!w.tailscale.calls.some(c => c[0] === 'serveOn'));
  assert.equal(w.d.pocket.status, 'off');
});

test('what is missing in Tailscale is said, and nothing is asked until it is there', async () => {
  for (const [status, step] of [[{ installed: false }, 'install'], [{ state: 'needs-login' }, 'sign-in'], [{ https: false }, 'https']]) {
    const w = wired({ tailscale: fakeTailscale({ status }) });
    const v = await w.d.setPocket({ enabled: true });
    assert.ok(v.error, step);
    assert.equal(v.setup.step, step);
    assert.equal(asked.length, 0);
  }
});

test('when Tailscale turns Serve down, Settings says so with the page that turns it on', async () => {
  const w = await turnedOn({ tailscale: fakeTailscale({ serveFails: true }) });
  try {
    const v = w.d.pocketViewNow();
    assert.match(v.problem.text, /Serve is not enabled/);
    assert.equal(v.problem.link, 'https://login.tailscale.com/f/serve?node=x');
  } finally { stop(w); }
});

test('Funnel on our address stops it at once', async () => {
  const w = await turnedOn();
  try {
    w.tailscale.funnel = true;
    await w.d.pocketView();
    assert.equal(w.d.pocket.status, 'off');
    assert.match(w.d.pocketViewNow().problem.text, /Funnel/);
  } finally { stop(w); }
});

test('turned off while Tailscale is down, the serve is taken back when it can be', async () => {
  const w = await turnedOn();
  w.tailscale.state.state = 'stopped';
  await w.d.setPocket({ enabled: false });
  assert.equal(w.tailscale.calls.filter(c => c[0] === 'serveOff').length, 0);
  assert.equal(w.d.config.get('pocket').servedPort, 443, 'kept, to take back later');
});

test('a conversation sent to a terminal takes no reply from the phone', async () => {
  const w = await paired({ tabs: [tabOf('t', { fromPocket: true, inTerminal: true })] });
  try {
    assert.match((await w.d.pocket.onAction(w.device, 'reply', { tabId: 't', text: 'hi' })).error, /terminal/);
  } finally { stop(w); }
});

test('turning it off stops the server and takes back only the serve it made', async () => {
  const w = await turnedOn();
  await w.d.setPocket({ enabled: false });
  assert.equal(w.d.pocket.status, 'off');
  assert.deepEqual(w.tailscale.calls.filter(c => c[0] === 'serveOff'), [['serveOff', 443]]);
  assert.equal(w.d.config.get('pocket').servedPort, 0);
});

async function paired(opts) {
  const w = await turnedOn(opts);
  const v = w.d.newPocketCode();
  const code = v.code.text;
  const r = await w.d.pocket.onPair({ code, name: '', agent: 'Mozilla/5.0 (iPhone)', login: LOGIN });
  assert.equal(r.ok, true);
  const device = w.d.pocket.findDevice(r.token);
  return { ...w, token: r.token, device };
}

test('a code from Settings pairs one phone, once, and only its hash is kept', async () => {
  const w = await turnedOn();
  try {
    assert.equal(w.d.pocket.findDevice('x'.repeat(43)), null);
    const { code } = w.d.newPocketCode();
    const wrong = await w.d.pocket.onPair({ code: 'AAAAAAAA', agent: '', login: LOGIN });
    assert.equal(wrong.ok, false);
    const r = await w.d.pocket.onPair({ code: code.text, agent: 'Mozilla/5.0 (iPhone)', login: LOGIN });
    assert.equal(r.ok, true);
    assert.equal(r.name, 'iPhone');
    const saved = JSON.stringify(w.d.config.get('pocketDevices'));
    assert.ok(!saved.includes(r.token));
    assert.ok(saved.includes(crypto.createHash('sha256').update(r.token).digest('hex')));
    assert.equal(w.d.pocket.findDevice(r.token).name, 'iPhone');
    // The code is spent.
    assert.equal((await w.d.pocket.onPair({ code: code.text, agent: '', login: LOGIN })).ok, false);
    assert.ok(w.of('notify').length >= 1);
  } finally { stop(w); }
});

test('no code without it on, and a forgotten phone is gone from the list and its streams', async () => {
  const off = wired();
  assert.ok(off.d.newPocketCode().error);
  const w = await paired();
  try {
    const v = w.d.forgetPocketDevice(w.device.id);
    assert.equal(v.devices.length, 0);
    assert.equal(w.d.pocket.findDevice(w.token), null);
  } finally { stop(w); }
});

test('Allow, Deny and Always allow (when Claude Code offers one) from the phone, and nothing the card would flag', async () => {
  const t = tabOf('t1');
  t.session.pending.set('r1', { requestId: 'r1', toolName: 'Bash', input: { command: 'npm test' } });
  t.session.pending.set('r3', { requestId: 'r3', toolName: 'Edit', input: {}, suggestions: [{ type: 'setMode', mode: 'acceptEdits' }] });
  t.session.pending.set('r2', { requestId: 'r2', toolName: 'ExitPlanMode', input: {} });
  const w = await paired({ tabs: [t] });
  try {
    const act = body => w.d.pocket.onAction(w.device, 'answer', body);
    assert.equal((await act({ tabId: 't1', requestId: 'r1', decision: 'always' })).ok, false);
    assert.equal((await act({ tabId: 't1', requestId: 'r2', decision: 'allow' })).ok, false);
    assert.equal((await act({ tabId: 't1', requestId: 'nope', decision: 'allow' })).ok, false);
    assert.equal((await act({ tabId: 't1', requestId: 'r1', decision: 'allow' })).ok, true);
    assert.equal((await act({ tabId: 't1', requestId: 'r3', decision: 'always' })).ok, true);
    assert.deepEqual(w.of('answerPermission'), [['t1', 'r1', 'allow', { via: 'pocket' }], ['t1', 'r3', 'always', { via: 'pocket' }]]);
  } finally { stop(w); }
});

test('a question is answered from the phone with an answer to each question, or skipped', async () => {
  const t = tabOf('t1', { fromPocket: true });
  const desk = tabOf('desk', { inTerminal: true });
  const questions = [{ question: 'Which DB?', options: [{ label: 'Postgres' }] }, { question: 'Tests?', options: [] }];
  t.session.pending.set('q1', { requestId: 'q1', toolName: 'AskUserQuestion', input: { questions } });
  t.session.pending.set('q2', { requestId: 'q2', toolName: 'AskUserQuestion', input: { questions } });
  desk.session.pending.set('q3', { requestId: 'q3', toolName: 'AskUserQuestion', input: { questions } });
  const w = await paired({ tabs: [t, desk] });
  try {
    const act = body => w.d.pocket.onAction(w.device, 'answer', body);
    // One in a terminal takes only the options offered: typed words are a reply, and replies go there.
    assert.match((await act({ tabId: 'desk', requestId: 'q3', decision: 'allow', answers: { 'Which DB?': 'Postgres', 'Tests?': 'yes' } })).error, /Pick from the options/);
    assert.match((await act({ tabId: 't1', requestId: 'q1', decision: 'allow', answers: { 'Which DB?': 'Postgres' } })).error, /each question/);
    assert.equal((await act({ tabId: 't1', requestId: 'q1', decision: 'allow', answers: { 'Which DB?': 'Postgres', 'Tests?': ' yes ', 'Other?': 'x' } })).ok, true);
    assert.equal((await act({ tabId: 't1', requestId: 'q2', decision: 'deny' })).ok, true);
    const [first, second] = w.of('answerPermission');
    assert.deepEqual(first, ['t1', 'q1', 'allow', { via: 'pocket', answers: { 'Which DB?': 'Postgres', 'Tests?': 'yes' } }]);
    assert.match(second[3].message, /skipped/);
  } finally { stop(w); }
});

test('a plan is approved from the phone only once it was read, and a no carries the notes', async () => {
  const t = tabOf('t1');
  t.session.pending.set('p1', { requestId: 'p1', toolName: 'ExitPlanMode', plan: '1. Do it', input: { plan: '1. Do it' } });
  t.session.pending.set('p2', { requestId: 'p2', toolName: 'ExitPlanMode', plan: '1. Do it', input: { plan: '1. Do it' } });
  t.session.pending.set('p3', { requestId: 'p3', toolName: 'ExitPlanMode', input: {} });
  t.fromPocket = true;
  const desk = tabOf('desk', { inTerminal: true });
  desk.session.pending.set('p4', { requestId: 'p4', toolName: 'ExitPlanMode', plan: '1. Do it' });
  const w = await paired({ tabs: [t, desk] });
  try {
    const act = body => w.d.pocket.onAction(w.device, 'answer', body);
    assert.match((await act({ tabId: 'desk', requestId: 'p4', decision: 'deny', notes: 'Hmm' })).error, /from the desk/);
    assert.match((await act({ tabId: 't1', requestId: 'p1', decision: 'allow' })).error, /to the end/);
    assert.equal((await act({ tabId: 't1', requestId: 'p1', decision: 'allow', read: true })).ok, true);
    assert.equal((await act({ tabId: 't1', requestId: 'p2', decision: 'deny', notes: 'Smaller steps' })).ok, true);
    assert.match((await act({ tabId: 't1', requestId: 'p3', decision: 'allow', read: true })).error, /at the desk/);
    const calls = w.of('answerPermission');
    assert.deepEqual(calls[0], ['t1', 'p1', 'allow', { via: 'pocket' }]);
    assert.match(calls[1][3].message, /Smaller steps/);
  } finally { stop(w); }
});

test('a desk-only prompt can be turned down from the phone, never allowed', async () => {
  const t = tabOf('t1');
  t.session.pending.set('r1', { requestId: 'r1', toolName: 'Bash', input: { command: 'node build.js' }, runsCreated: ['build.js'] });
  t.session.pending.set('r2', { requestId: 'r2', toolName: 'Bash', input: { command: 'node build.js' }, runsCreated: ['build.js'] });
  const w = await paired({ tabs: [t] });
  try {
    const act = body => w.d.pocket.onAction(w.device, 'answer', body);
    assert.match((await act({ tabId: 't1', requestId: 'r1', decision: 'allow' })).error, /at the desk/);
    assert.match((await act({ tabId: 't1', requestId: 'r2', decision: 'always' })).error, /always-allow|at the desk/);
    assert.equal((await act({ tabId: 't1', requestId: 'r1', decision: 'deny' })).ok, true);
    assert.deepEqual(w.of('answerPermission'), [['t1', 'r1', 'deny', { via: 'pocket' }]]);
  } finally { stop(w); }
});

test('home and push from the phone waits for Settings to allow pushing', async () => {
  const w = await paired({ tabs: [tabOf('t1')] });
  try {
    const act = body => w.d.pocket.onAction(w.device, 'home', body);
    assert.match((await act({ tabId: 't1', push: true })).error, /Pushing from your phone is off/);
    assert.equal(w.of('bringTabHome').length, 0);
    await w.d.setPocket({ allow: { push: true } });
    assert.equal((await act({ tabId: 't1', push: true })).ok, true);
    assert.deepEqual(w.of('bringTabHome')[0], ['t1', { force: false, finish: true, push: true }]);
  } finally { stop(w); }
});

test('a home that clashes with its branch says so, so the phone can offer to have him sort it out', async () => {
  const w = await paired({ tabs: [tabOf('t1')] });
  try {
    w.d.bringTabHome = async () => ({ ok: false, conflict: true, error: 'main has changed in ways that clash with this copy. Nothing was merged.' });
    assert.deepEqual(await w.d.pocket.onAction(w.device, 'home', { tabId: 't1' }),
      { ok: false, conflict: true, error: 'main has changed in ways that clash with this copy. Nothing was merged.' });
  } finally { stop(w); }
});

test('a task names only photos the phone sent, each used once', async () => {
  const w = await paired();
  try {
    const r = await w.d.pocket.onAction(w.device, 'task', { project: PROJECT, text: 'Fix this', photos: ['made-up'] });
    assert.equal(r.ok, true);
    const [, , , opts] = w.of('startTaskInCopy')[0];
    assert.equal(opts.attachments, undefined);
  } finally { stop(w); }
});

test('a task from the phone runs in Ask first, in its own copy, in a project Shellby knows', async () => {
  const w = await paired();
  try {
    const act = body => w.d.pocket.onAction(w.device, 'task', body);
    assert.match((await act({ project: 'C:\\elsewhere', text: 'do it' })).error, /isn't one Shellby knows/);
    assert.match((await act({ project: PROJECT, text: '/clear' })).error, /only run at the desk/);
    assert.match((await act({ project: PROJECT, text: '!rm -rf /' })).error, /only run at the desk/);
    assert.match((await act({ project: PROJECT, text: '   ' })).error, /Say what/);
    const r = await act({ project: PROJECT, text: 'Fix the flaky upload test' });
    assert.deepEqual(r, { ok: true, tabId: 'new1' });
    const [[dir, title, promptFor, opts]] = w.of('startTaskInCopy');
    assert.equal(dir, PROJECT);
    assert.match(title, /^📱 /);
    assert.equal(promptFor(), 'Fix the flaky upload test');
    assert.deepEqual(opts, { mode: 'ask' });
    assert.equal(w.d.manager.tabs.get('new1').fromPocket, true);
    assert.deepEqual(w.of('note')[0], ['new1', { kind: 'phone' }]);
    assert.match((await act({ project: PROJECT, text: 'On its own', mode: 'autonomous' })).error, /Turn on Autonomous/);
    w.d.config.set({ autonomousAcknowledged: true });
    await act({ project: PROJECT, text: 'Again, on its own', mode: 'autonomous' });
    await act({ project: PROJECT, text: 'And a made-up mode', mode: 'sudo' });
    assert.deepEqual(w.of('startTaskInCopy').map(c => c[3]), [{ mode: 'ask' }, { mode: 'autonomous' }, { mode: 'ask' }]);
  } finally { stop(w); }
});

test('a task sent twice with the same key starts once, and Telegram’s phone tasks count towards the app’s ten at once', async () => {
  const busy = id => tabOf(id, { fromPhone: true, session: { pending: new Map(), mode: 'ask', cwd: PROJECT, busy: true } });
  const w = await paired({ tabs: Array.from({ length: 9 }, (_, i) => busy(`p${i + 1}`)) });
  try {
    const body = { project: PROJECT, text: 'once only', key: 'abcdefgh12' };
    const [a, b] = await Promise.all([w.d.pocket.onAction(w.device, 'task', body), w.d.pocket.onAction(w.device, 'task', body)]);
    assert.deepEqual(a, b);
    assert.equal(w.of('startTaskInCopy').length, 1);
    // p1..p9 and the new one: the eleventh waits.
    w.d.manager.tabs.get('new1').session.busy = true;
    const r = await w.d.pocket.onAction(w.device, 'task', { project: PROJECT, text: 'one more' });
    assert.equal(r.ok, false);
  } finally { stop(w); }
});

test('at the usage limit a phone task waits for the reset', async () => {
  const w = await paired();
  try {
    w.d.usageService.limitWait = () => ({ resetsAt: Date.now() + 1000 });
    const r = await w.d.pocket.onAction(w.device, 'task', { project: PROJECT, text: 'later please' });
    assert.deepEqual(r, { ok: true, held: true, atText: '14:20' });
    assert.equal(w.of('holdForReset')[0][0].mode, 'ask');
    assert.equal(w.of('startTaskInCopy').length, 0);
  } finally { stop(w); }
});

test('replies go to any conversation, in the mode the phone picked (Ask if none), and queue mid-turn', async () => {
  const modes = [];
  const desk = tabOf('desk', { session: { pending: new Map(), mode: 'bypass', cwd: PROJECT, busy: false, setMode(m) { this.mode = m; modes.push(m); } } });
  const mine = tabOf('mine', { fromPocket: true });
  const w = await paired({ tabs: [desk, mine] });
  try {
    const act = body => w.d.pocket.onAction(w.device, 'reply', body);
    assert.equal((await act({ tabId: 'desk', text: 'hi' })).ok, true);
    assert.deepEqual(modes, ['ask']);
    assert.equal(desk.pinnedMode, true, 'the desk mode no longer lifts it');
    assert.equal((await act({ tabId: 'desk', text: 'go on', mode: 'acceptEdits' })).ok, true);
    assert.deepEqual(modes, ['ask', 'acceptEdits']);
    assert.match((await act({ tabId: 'desk', text: 'all yours', mode: 'autonomous' })).error, /Turn on Autonomous/);
    assert.deepEqual(modes, ['ask', 'acceptEdits'], 'not until Autonomous is on at the desk');
    // Mid-turn it joins the desk's queue, and the running turn keeps its mode.
    desk.session.busy = true;
    assert.deepEqual(await act({ tabId: 'desk', text: 'and the docs', mode: 'plan' }), { ok: true, queued: true });
    assert.deepEqual(modes, ['ask', 'acceptEdits'], 'no mode change reaches the running turn');
    assert.deepEqual(w.of('send').filter(([, channel]) => channel === 'tab:queue').map(([, , p]) => p), [{ tabId: 'desk', text: 'and the docs' }]);
    assert.match((await act({ tabId: 'desk', text: '/compact' })).error, /desk/, 'commands still only at the desk');
    desk.session.busy = false;
    mine.session.busy = true;
    assert.equal((await act({ tabId: 'mine', text: 'hi' })).queued, true);
    mine.session.busy = false;
    assert.equal((await act({ tabId: 'mine', text: 'carry on' })).ok, true);
    assert.deepEqual(w.of('sendToTab'), [['desk', 'hi'], ['desk', 'go on'], ['mine', 'carry on']], 'queued ones never start a turn of their own');
    // The desk's panel hears about a message it didn't send.
    assert.ok(w.of('send').some(([, channel]) => channel === 'tab:sent'));
  } finally { stop(w); }
});

test('slash commands: a few safe ones from the phone, the rest and ! at the desk', async () => {
  const w = await paired({ tabs: [tabOf('t1', { session: { pending: new Map(), mode: 'ask', cwd: PROJECT, busy: false, setMode() {} } })] });
  try {
    const act = text => w.d.pocket.onAction(w.device, 'reply', { tabId: 't1', text });
    assert.equal((await act('/compact')).ok, true);
    assert.match((await act('/clear')).error, /run at the desk/);
    assert.match((await act('!dir')).error, /only run at the desk/);
  } finally { stop(w); }
});

test('rename, effort, close and History from the phone', async () => {
  const efforts = [];
  const w = await paired({ tabs: [tabOf('t1')] });
  try {
    const act = (name, body) => w.d.pocket.onAction(w.device, name, body);
    w.d.manager.rename = (id, t) => { w.d.manager.tabs.get(id).title = t; return true; };
    w.d.manager.setTabEffort = (id, e) => efforts.push([id, e]);
    assert.equal((await act('rename', { tabId: 't1', title: '  New name ' })).ok, true);
    assert.equal(w.d.manager.tabs.get('t1').title, 'New name');
    assert.equal((await act('effort', { tabId: 't1', effort: 'high' })).ok, true);
    assert.equal((await act('effort', { tabId: 't1', effort: 'ludicrous' })).ok, false);
    assert.deepEqual(efforts, [['t1', 'high']]);
    w.d.history.list = () => [{ id: 'old', title: 'Old one', cwd: PROJECT, updatedAt: 5 }, { id: 't1', title: 'open', updatedAt: 9 }];
    w.d.history.get = id => (id === 'old' ? { id } : null);
    const opened = [];
    w.d.openTab = o => { opened.push(o); w.d.manager.tabs.set(o.tabId, tabOf(o.tabId)); return { id: o.tabId }; };
    const h = await act('history', {});
    assert.deepEqual(h.list.map(e => e.id), ['old'], 'open ones are not offered');
    assert.deepEqual(await act('resume', { id: 'old' }), { ok: true, tabId: 'old' });
    assert.equal(opened[0].historyEntry.id, 'old');
    assert.equal((await act('resume', { id: 'gone' })).ok, false);
  } finally { stop(w); }
});

test('undo and the diff name a turn by its changes; main finds the rest', async () => {
  const change = { kind: 'changes', root: 'C:\\code\\shellby', before: 'b0', after: 'a1', files: [{ path: 'src/a.js' }] };
  const w = await paired({ tabs: [tabOf('t1')], items: { t1: [change] } });
  try {
    const undo = await w.d.pocket.onAction(w.device, 'undo', { tabId: 't1', after: 'a1' });
    assert.equal(undo.ok, true);
    assert.deepEqual(w.of('undoChanges')[0][0], { tabId: 't1', root: 'C:\\code\\shellby', before: 'b0', after: 'a1' });
    assert.equal((await w.d.pocket.onAction(w.device, 'undo', { tabId: 't1', after: 'zz' })).ok, false);
    const diff = await w.d.pocket.onDiff(w.device, { tab: 't1', after: 'a1', file: 'src/a.js' });
    assert.equal(diff.ok, true);
    assert.equal(w.of('diffChanges')[0][0].file, 'src/a.js');
    assert.equal((await w.d.pocket.onDiff(w.device, { tab: 't1', after: 'a1', file: '../../secrets.txt' })).ok, false);
  } finally { stop(w); }
});

test('bring it home, stop, reviewed and the queue go through the desk’s own code', async () => {
  const t = tabOf('t1');
  t.session.busy = true;
  const w = await paired({ tabs: [t] });
  try {
    assert.equal((await w.d.pocket.onAction(w.device, 'stop', { tabId: 't1' })).ok, true);
    assert.deepEqual(w.of('interrupt'), [['t1']]);
    t.session.busy = false;
    assert.equal((await w.d.pocket.onAction(w.device, 'stop', { tabId: 't1' })).ok, false);
    assert.deepEqual(await w.d.pocket.onAction(w.device, 'home', { tabId: 't1' }), { ok: true, merged: true, commits: 2, base: 'main' });
    // The phone finishes it, as the desk's "Bring it home and finish" does: it moves to Done.
    assert.deepEqual(w.of('bringTabHome'), [['t1', { force: false, finish: true }]]);
    assert.equal((await w.d.pocket.onAction(w.device, 'reviewed', { tabId: 't1', after: 'a1' })).ok, true);
    assert.equal((await w.d.pocket.onAction(w.device, 'cancel-held', { id: 'h1' })).ok, true);
    assert.equal((await w.d.pocket.onAction(w.device, 'cancel-held', { id: 'h2' })).ok, false);
  } finally { stop(w); }
});

test('looking back from the phone goes through pocket/review.js, and Fix it keeps the reply’s rules', async () => {
  const modes = [];
  const t = tabOf('t1', { session: { pending: new Map(), mode: 'ask', cwd: PROJECT, busy: false, setMode(m) { this.mode = m; modes.push(m); } } });
  const term = tabOf('term', { inTerminal: true });
  const red = { kind: 'checks', status: 'fail', after: 'a1', commands: [{ cmd: 'npm test', ok: false, failed: ['x'], tail: 'boom' }] };
  const w = await paired({ tabs: [t, term], items: { t1: [red], term: [red] } });
  try {
    const act = (name, body) => w.d.pocket.onAction(w.device, name, body);
    assert.equal((await act('project-history', {})).ok, true);
    assert.equal((await act('checks', { tabId: 't1' })).status, 'fail');
    assert.match((await act('checks-fix', { tabId: 'term' })).error, /terminal/);
    const r = await act('checks-fix', { tabId: 't1', mode: 'smart' });
    assert.equal(r.ok, true);
    assert.deepEqual(modes, ['smart']);
    const [[tabId, text]] = w.of('sendToTab');
    assert.equal(tabId, 't1');
    assert.match(text, /`npm test` failed: x/);
    // The checks' state rides the view.
    w.d.checksRunning = id => (id === 't1' ? { after: 'a1' } : null);
    assert.deepEqual(w.d.pocket.onOpen(w.device, { tab: null }).view.tabs.find(x => x.id === 't1').checks, { status: 'running', after: 'a1' });
  } finally { stop(w); }
});

function fakeSubscription() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    sub: { endpoint: 'https://web.push.apple.com/QGuQyavXutnMH', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } },
    ecdh,
  };
}

test('a phone that turned notifications on gets them, encrypted, by the settings', async () => {
  const t = tabOf('t1', { fromPocket: true });
  const w = await paired({ tabs: [t, tabOf('t2')] });
  const sent = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { sent.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  try {
    const { sub, ecdh } = fakeSubscription();
    assert.equal((await w.d.pocket.onAction(w.device, 'push', { subscription: sub })).ok, true);
    assert.equal((await w.d.pocket.onAction(w.device, 'push', { subscription: { ...sub, endpoint: 'https://evil.example.com/x' } })).ok, false);

    assert.equal(w.d.pocketNotify({ kind: 'asking', project: 'Tab t2', message: 'Run npm test', tabId: 't2' }), true);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, sub.endpoint);
    assert.equal(sent[0].opts.headers.Urgency, 'high');
    const plain = JSON.parse(push.decrypt({ body: sent[0].opts.body, p256dhPrivate: ecdh.getPrivateKey(), auth: sub.keys.auth }).toString());
    assert.equal(plain.url, '/#/tab/t2');
    assert.equal(plain.tag, 'ask-t2');
    assert.match(plain.title, /needs you/);
    assert.equal(plain.silent, undefined);
    // A prompt with its request named opens straight onto it; no token rides along.
    assert.equal(w.d.pocketNotify({ kind: 'asking', project: 'Tab t2', message: 'Run npm test', tabId: 't2', requestId: 'r-7' }), true);
    await new Promise(r => setTimeout(r, 20));
    const deep = JSON.parse(push.decrypt({ body: sent[1].opts.body, p256dhPrivate: ecdh.getPrivateKey(), auth: sub.keys.auth }).toString());
    assert.equal(deep.url, '/#/prompt/t2/r-7');
    assert.ok(!JSON.stringify(deep).includes(w.token));

    // A quick task isn't news, unless the phone started it.
    assert.equal(w.d.pocketNotify({ kind: 'done', project: 'Tab t2', seconds: 4, tabId: 't2' }), false);
    assert.equal(w.d.pocketNotify({ kind: 'done', project: 'Tab t1', seconds: 4, tabId: 't1' }), true);
    // Turned off in Settings: nothing.
    await w.d.setPocket({ notify: { events: { asking: false } } });
    assert.equal(w.d.pocketNotify({ kind: 'asking', project: 'Tab t2', tabId: 't2' }), false);
  } finally { globalThis.fetch = before; stop(w); }
});

test('quiet hours hold every push but a permission prompt, which comes quietly', async () => {
  const w = await paired({ tabs: [tabOf('t1', { fromPocket: true }), tabOf('t2')] });
  const sent = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { sent.push({ url, opts }); return { ok: true, status: 201, text: async () => '' }; };
  try {
    const { sub, ecdh } = fakeSubscription();
    await w.d.pocket.onAction(w.device, 'push', { subscription: sub });
    // A window that holds right now, whatever the clock says: from an hour ago to an hour from now.
    const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const from = hhmm(new Date(Date.now() - 60 * 60 * 1000)), to = hhmm(new Date(Date.now() + 60 * 60 * 1000));
    assert.match((await w.d.setPocket({ quiet: { from: 'late' } })).error, /hours and minutes/);
    const v = await w.d.setPocket({ quiet: { enabled: true, from, to } });
    assert.deepEqual(v.quiet, { enabled: true, from, to });
    assert.equal(w.d.pocketNotify({ kind: 'done', project: 'Tab t2', seconds: 500, tabId: 't2' }), false, 'held');
    assert.equal(w.d.pocketNotify({ kind: 'done', project: 'Tab t1', seconds: 4, tabId: 't1' }), false, 'held, though the phone started it');
    assert.equal(w.d.pocketNotify({ kind: 'limit' }), false);
    assert.equal(w.d.pocketNotify({ kind: 'asking', project: 'Tab t2', message: 'Run npm test', tabId: 't2' }), true);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(sent.length, 1);
    const plain = JSON.parse(push.decrypt({ body: sent[0].opts.body, p256dhPrivate: ecdh.getPrivateKey(), auth: sub.keys.auth }).toString());
    assert.equal(plain.silent, true);
    assert.equal(plain.badge, 0);
    // The phone sees the schedule, and can turn it off itself.
    assert.deepEqual(w.d.pocket.onOpen(w.device, { tab: null }).view.quiet, { enabled: true, from, to });
    assert.equal((await w.d.pocket.onAction(w.device, 'quiet', { enabled: false })).ok, true);
    assert.equal((await w.d.pocket.onAction(w.device, 'quiet', { to: from })).error, 'Pick two different times.');
    assert.equal(w.d.pocketNotify({ kind: 'limit' }), true);
  } finally { globalThis.fetch = before; stop(w); }
});

test('a phone set to read-only at the desk may look, and nothing else', async () => {
  const t = tabOf('t1');
  t.session.pending.set('r1', { requestId: 'r1', toolName: 'Bash', input: { command: 'npm test' } });
  t.session.busy = true;
  const w = await paired({ tabs: [t], items: { t1: [{ kind: 'changes', root: PROJECT, before: 'b0', after: 'a1', files: [{ path: 'src/a.js' }] }] } });
  try {
    assert.equal(w.d.pocketViewNow().devices[0].rights, 'full');
    assert.equal(w.d.pocket.onOpen(w.device, { tab: null }).view.rights, 'full');
    assert.match((await w.d.setPocket({ device: { id: 'nobody', rights: 'readonly' } })).error, /already gone/);
    assert.match((await w.d.setPocket({ device: { id: w.device.id, rights: 'root' } })).error, /already gone/);
    const v = await w.d.setPocket({ device: { id: w.device.id, rights: 'readonly' } });
    assert.equal(v.devices[0].rights, 'readonly');
    assert.equal(w.d.config.get('pocketDevices')[0].rights, 'readonly');
    // The stream opened before the change still gets the view with the new level on it.
    assert.equal(w.d.pocket.onOpen(w.device, { tab: null }).view.rights, 'readonly');
    const act = (name, body) => w.d.pocket.onAction(w.device, name, body);
    for (const [name, body] of [['answer', { tabId: 't1', requestId: 'r1', decision: 'allow' }], ['task', { project: PROJECT, text: 'do it' }], ['reply', { tabId: 't1', text: 'hi' }], ['stop', { tabId: 't1' }], ['undo', { tabId: 't1', after: 'a1' }], ['home', { tabId: 't1' }], ['focus', { minutes: 25 }], ['quiet', { enabled: true }]]) {
      assert.match((await act(name, body)).error, /only look/, name);
    }
    assert.equal(w.of('answerPermission').length, 0);
    assert.equal(w.of('interrupt').length, 0);
    assert.equal(w.of('startTaskInCopy').length, 0);
    assert.match(w.d.pocket.onUpload(w.device, Buffer.alloc(10)).error, /only look/);
    // Looking is fine: the diff, and the lists past the beach.
    assert.equal((await w.d.pocket.onDiff(w.device, { tab: 't1', after: 'a1', file: 'src/a.js' })).ok, true);
    assert.equal((await act('routines', {})).ok, true);
    // Its own notifications, and leaving.
    assert.equal((await act('push', { subscription: null })).ok, true);
    assert.equal((await act('forget', {})).ok, true);
    assert.equal(w.d.pocketViewNow().devices.length, 0);
  } finally { stop(w); }
});

test('a subscription the push service says is gone is forgotten', async () => {
  const w = await paired();
  const before = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 410, text: async () => 'gone' });
  try {
    const { sub } = fakeSubscription();
    await w.d.pocket.onAction(w.device, 'push', { subscription: sub });
    w.d.pocketNotify({ kind: 'limit' });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(w.d.config.get('pocketDevices')[0].push, null);
  } finally { globalThis.fetch = before; stop(w); }
});

test('the view the phone gets has the prompts, the projects and the push key, never a path', async () => {
  const t = tabOf('t1');
  t.session.pending.set('r1', { requestId: 'r1', toolName: 'Bash', input: { command: 'npm test' } });
  const w = await paired({ tabs: [t] });
  try {
    const { view } = w.d.pocket.onOpen(w.device, { tab: null });
    assert.equal(view.prompts.length, 1);
    assert.equal(view.prompts[0].deskOnly, null);
    assert.deepEqual(view.projects, [{ key: PROJECT, name: 'shellby' }]);
    assert.match(view.pushKey, /^[A-Za-z0-9_-]{87}$/);
    assert.equal(view.pc, 'desk-pc');
  } finally { stop(w); }
});

test('a task from the phone starts on the model picked, or the desk’s own, and never on one Shellby doesn’t know', async () => {
  const w = await paired();
  try {
    const act = body => w.d.pocket.onAction(w.device, 'task', body);
    assert.match((await act({ project: PROJECT, text: 'Fix it', model: 'gpt-9' })).error, /doesn't know that model/);
    assert.equal(w.of('startTaskInCopy').length, 0);
    await act({ project: PROJECT, text: 'Fix it', model: 'sonnet' });
    await act({ project: PROJECT, text: 'Fix it again', model: '' });
    assert.deepEqual(w.of('startTaskInCopy').map(c => c[3]), [{ mode: 'ask', model: 'sonnet' }, { mode: 'ask' }]);
    // At the limit it waits for the reset, and keeps its model for then.
    w.d.usageService.limitWait = () => ({ at: Date.now() + 60000 });
    await act({ project: PROJECT, text: 'Later', model: 'haiku' });
    assert.equal(w.of('holdForReset')[0][0].model, 'haiku');
    const view = w.d.pocket.onOpen(w.device, { tab: null }).view;
    assert.ok(view.models.some(m => m.id === 'sonnet' && m.label));
  } finally { stop(w); }
});

test('Look over my changes from the phone reviews a repo in Ask first, and a read-only phone can’t ask for it', async () => {
  // This checkout is a git repository: a conversation working in it can be looked over.
  const w = await paired({ tabs: [tabOf('t1', { session: { pending: new Map(), mode: 'acceptEdits', cwd: ROOT, busy: false } })] });
  try {
    const started = [];
    w.d.startTask = (prompt, title, opts) => { started.push({ prompt, title, opts }); w.d.manager.tabs.set('rev1', tabOf('rev1')); return { ok: true, tabId: 'rev1' }; };
    const act = body => w.d.pocket.onAction(w.device, 'look-over', body);
    assert.match((await act({ tabId: 'gone' })).error, /has closed/);
    assert.match((await act({ project: 'C:\\elsewhere' })).error, /isn't one Shellby knows/);
    assert.match((await act({ project: PROJECT })).error, /isn't a git repository/);
    assert.equal(started.length, 0);
    assert.deepEqual(await act({ tabId: 't1' }), { ok: true, tabId: 'rev1' });
    assert.equal(started[0].opts.mode, 'ask', 'whatever the conversation’s own mode');
    assert.match(started[0].prompt, /Read only: don't edit/);
    assert.match(started[0].title, /^Look over /);
    assert.equal(w.d.manager.tabs.get('rev1').fromPocket, true);
    await w.d.setPocket({ device: { id: w.device.id, rights: 'readonly' } });
    assert.match((await act({ tabId: 't1' })).error, /can only look/);
    assert.equal(started.length, 1);
  } finally { stop(w); }
});

test('a task for later goes into the queue, after the reset or tonight, and never with pictures', async () => {
  const w = await paired();
  try {
    const r = await w.d.pocket.onAction(w.device, 'task', { project: PROJECT, text: 'refactor overnight', when: 'tonight', mode: 'acceptEdits' });
    assert.deepEqual(r, { ok: true, held: true, atText: '14:20', when: 'tonight' });
    const held = w.of('holdForReset')[0][0];
    assert.equal(held.when, 'tonight');
    assert.equal(held.mode, 'acceptEdits');
    assert.equal(held.fromPhone, true);
    assert.equal(w.of('startTaskInCopy').length, 0);
    assert.match((await w.d.pocket.onAction(w.device, 'task', { project: PROJECT, text: 'with a photo', when: 'reset', photos: ['p1'] })).error, /Pictures/);
    // Anything else is now.
    await w.d.pocket.onAction(w.device, 'task', { project: PROJECT, text: 'right away', when: 'someday' });
    assert.equal(w.of('startTaskInCopy').length, 1);
    // Unattended Autonomous is the desk's to queue.
    w.d.config.set({ autonomousAcknowledged: true });
    assert.match((await w.d.pocket.onAction(w.device, 'task', { project: PROJECT, text: 'all night', when: 'tonight', mode: 'autonomous' })).error, /queued at your PC/);
  } finally { stop(w); }
});

test('a reply sent again with the same key (the outbox, after the PC woke) goes once', async () => {
  const t = tabOf('t1', { session: { pending: new Map(), mode: 'ask', cwd: PROJECT, busy: false, setMode(m) { this.mode = m; } } });
  const w = await paired({ tabs: [t] });
  try {
    const body = { tabId: 't1', text: 'from the train', key: 'outbox1234' };
    const a = await w.d.pocket.onAction(w.device, 'reply', body);
    const b = await w.d.pocket.onAction(w.device, 'reply', body);
    assert.deepEqual(a, b);
    assert.deepEqual(w.of('sendToTab'), [['t1', 'from the train']]);
  } finally { stop(w); }
});

test('Run again runs the checks on the conversation’s last change, and says why when it can’t', async () => {
  const change = { kind: 'changes', root: PROJECT, before: 'b0', after: 'a1', files: [{ path: 'src/a.js' }] };
  const w = await paired({ tabs: [tabOf('t1'), tabOf('t2')], items: { t1: [change] } });
  try {
    w.d.changeRef = r => ({ ...r, ref: true });
    w.d.runChecksFor = async ref => { w.rec.push(['runChecksFor', ref]); return { ok: true, status: 'pass' }; };
    assert.deepEqual(await w.d.pocket.onAction(w.device, 'checks-run', { tabId: 't1' }), { ok: true, status: 'pass' });
    assert.equal(w.of('runChecksFor')[0][0].after, 'a1');
    assert.match((await w.d.pocket.onAction(w.device, 'checks-run', { tabId: 't2' })).error, /Nothing has changed/);
    // A long run answers at once and is reported by the view.
    w.d.runChecksFor = () => new Promise(() => {});
    assert.deepEqual(await w.d.pocket.onAction(w.device, 'checks-run', { tabId: 't1' }), { ok: true, started: true });
    w.d.runChecksFor = async () => ({ ok: false, declined: true });
    assert.match((await w.d.pocket.onAction(w.device, 'checks-run', { tabId: 't1' })).error, /Say yes there/);
  } finally { stop(w); }
});

test('a queued task is reworded or moved through the desk’s queue', async () => {
  const w = await paired();
  try {
    w.d.heldList = () => [{ id: 'h1', kind: 'task', fromPhone: true }, { id: 'h2', kind: 'task', fromPhone: false }];
    assert.match((await w.d.pocket.onAction(w.device, 'held-edit', { id: 'h2', prompt: 'x' })).error, /queued at your PC/);
    assert.match((await w.d.pocket.onAction(w.device, 'held-edit', { id: 'h1', prompt: '!rm -rf .' })).error, /only run at the desk/);
    w.d.heldService = {
      rewordHeld: (id, prompt) => { w.rec.push(['reword', id, prompt]); return { ok: true }; },
      moveHeld: (id, dir) => { w.rec.push(['move', id, dir]); return id === 'h1' ? { ok: true } : { ok: false, error: "That isn't a queued task any more." }; },
    };
    assert.equal((await w.d.pocket.onAction(w.device, 'held-edit', { id: 'h1', prompt: 'new words' })).ok, true);
    assert.equal((await w.d.pocket.onAction(w.device, 'held-move', { id: 'h1', dir: 'up' })).ok, true);
    assert.match((await w.d.pocket.onAction(w.device, 'held-move', { id: 'h9', dir: 'down' })).error, /queued task/);
    assert.deepEqual(w.of('reword'), [['h1', 'new words']]);
    assert.deepEqual(w.of('move'), [['h1', -1], ['h9', 1]]);
  } finally { stop(w); }
});

test('Try again and Branch from here go through branching.js, and the new conversation is the phone’s', async () => {
  const w = await paired({ tabs: [tabOf('t1')] });
  try {
    w.d.branchRun = async args => { w.rec.push(['branchRun', args]); w.d.manager.tabs.set('b1', tabOf('b1')); return { ok: true, tabId: 'b1' }; };
    assert.deepEqual(await w.d.pocket.onAction(w.device, 'branch-from', { tabId: 't1', turnId: 'u1', at: 'before' }), { ok: true, tabId: 'b1' });
    await w.d.pocket.onAction(w.device, 'branch-from', { tabId: 't1', turnId: 'u1', at: 'after' });
    assert.deepEqual(w.of('branchRun').map(([a]) => [a.at, a.send]), [['before', true], ['after', false]]);
    assert.equal(w.d.manager.tabs.get('b1').fromPocket, true);
    assert.match((await w.d.pocket.onAction(w.device, 'branch-from', { tabId: 'gone', turnId: 'u1' })).error, /closed/);
  } finally { stop(w); }
});

test('a read-only phone can’t run checks, change the queue or branch', async () => {
  const w = await paired({ tabs: [tabOf('t1')] });
  try {
    await w.d.setPocket({ device: { id: w.device.id, rights: 'readonly' } });
    for (const name of ['checks-run', 'held-edit', 'held-move', 'branch-from']) {
      assert.match((await w.d.pocket.onAction(w.device, name, { tabId: 't1', id: 'h1', turnId: 'u1' })).error, /only look/, name);
    }
  } finally { stop(w); }
});

test('every action pocket/later.js answers is one the server lets through', () => {
  const { ACTIONS } = require('../src/main/pocket/server');
  const { createPocketLater } = require('../src/main/pocket/later');
  for (const name of Object.keys(createPocketLater({}, { adopt() {}, pushView() {}, claimStart: () => ({ ok: true }), once: (_k, b, start) => start(b) }).actions)) assert.ok(ACTIONS.includes(name), name);
});

test('a reply turned down is not remembered under its key, so the outbox can send it again later', async () => {
  const t = tabOf('t1', { session: { pending: new Map(), mode: 'ask', cwd: PROJECT, busy: true, setMode(m) { this.mode = m; } } });
  const w = await paired({ tabs: [t] });
  try {
    const body = { tabId: 't1', text: '/compact', key: 'outbox5678' };
    assert.match((await w.d.pocket.onAction(w.device, 'reply', body)).error, /on a turn/);
    t.session.busy = false;
    assert.equal((await w.d.pocket.onAction(w.device, 'reply', body)).ok, true);
  } finally { stop(w); }
});

test('tasks for later count in the phone’s hour, and an Autonomous one or one in Autonomous is the desk’s to reword', async () => {
  const w = await paired();
  try {
    for (let i = 0; i < 30; i++) await w.d.pocket.onAction(w.device, 'task', { project: PROJECT, text: `later ${i}`, when: 'reset' });
    assert.equal(w.of('holdForReset').length, 30);
    assert.equal((await w.d.pocket.onAction(w.device, 'task', { project: PROJECT, text: 'one too many', when: 'reset' })).ok, false);
    w.d.heldList = () => [{ id: 'h1', kind: 'task', fromPhone: true, mode: 'autonomous' }];
    assert.match((await w.d.pocket.onAction(w.device, 'held-edit', { id: 'h1', prompt: 'other words' })).error, /queued at your PC/);
  } finally { stop(w); }
});
