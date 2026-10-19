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
    history: { load: id => items[id] || [], update: note('history.update') },
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

test('Allow and Deny from the phone, never Always allow, and nothing the card would flag', async () => {
  const t = tabOf('t1');
  t.session.pending.set('r1', { requestId: 'r1', toolName: 'Bash', input: { command: 'npm test' } });
  t.session.pending.set('r2', { requestId: 'r2', toolName: 'ExitPlanMode', input: {} });
  const w = await paired({ tabs: [t] });
  try {
    const act = body => w.d.pocket.onAction(w.device, 'answer', body);
    assert.equal((await act({ tabId: 't1', requestId: 'r1', decision: 'always' })).ok, false);
    assert.equal((await act({ tabId: 't1', requestId: 'r2', decision: 'allow' })).ok, false);
    assert.equal((await act({ tabId: 't1', requestId: 'nope', decision: 'allow' })).ok, false);
    assert.equal((await act({ tabId: 't1', requestId: 'r1', decision: 'allow' })).ok, true);
    assert.deepEqual(w.of('answerPermission'), [['t1', 'r1', 'allow', { via: 'pocket' }]]);
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
  } finally { stop(w); }
});

test('a task sent twice with the same key starts once, and Telegram’s phone tasks count towards three at once', async () => {
  const busy = id => tabOf(id, { fromPhone: true, session: { pending: new Map(), mode: 'ask', cwd: PROJECT, busy: true } });
  const w = await paired({ tabs: [busy('p1'), busy('p2')] });
  try {
    const body = { project: PROJECT, text: 'once only', key: 'abcdefgh12' };
    const [a, b] = await Promise.all([w.d.pocket.onAction(w.device, 'task', body), w.d.pocket.onAction(w.device, 'task', body)]);
    assert.deepEqual(a, b);
    assert.equal(w.of('startTaskInCopy').length, 1);
    // p1, p2 and the new one: the fourth waits.
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

test('replies go to any conversation, not mid-turn, and a desk one is switched to ask first', async () => {
  const modes = [];
  const desk = tabOf('desk', { session: { pending: new Map(), mode: 'bypass', cwd: PROJECT, busy: false, setMode(m) { this.mode = m; modes.push(m); } } });
  const mine = tabOf('mine', { fromPocket: true });
  const w = await paired({ tabs: [desk, mine] });
  try {
    const act = body => w.d.pocket.onAction(w.device, 'reply', body);
    assert.equal((await act({ tabId: 'desk', text: 'hi' })).ok, true);
    assert.deepEqual(modes, ['ask']);
    assert.equal(desk.pinnedMode, true, 'the desk mode no longer lifts it');
    mine.session.busy = true;
    assert.match((await act({ tabId: 'mine', text: 'hi' })).error, /still on it/);
    mine.session.busy = false;
    assert.equal((await act({ tabId: 'mine', text: 'carry on' })).ok, true);
    assert.deepEqual(w.of('sendToTab'), [['desk', 'hi'], ['mine', 'carry on']]);
    // The desk's panel hears about a message it didn't send.
    assert.ok(w.of('send').some(([, channel]) => channel === 'tab:sent'));
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
    assert.deepEqual(w.of('bringTabHome'), [['t1', { force: false }]]);
    assert.equal((await w.d.pocket.onAction(w.device, 'reviewed', { tabId: 't1', after: 'a1' })).ok, true);
    assert.equal((await w.d.pocket.onAction(w.device, 'cancel-held', { id: 'h1' })).ok, true);
    assert.equal((await w.d.pocket.onAction(w.device, 'cancel-held', { id: 'h2' })).ok, false);
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

    // A quick task isn't news, unless the phone started it.
    assert.equal(w.d.pocketNotify({ kind: 'done', project: 'Tab t2', seconds: 4, tabId: 't2' }), false);
    assert.equal(w.d.pocketNotify({ kind: 'done', project: 'Tab t1', seconds: 4, tabId: 't1' }), true);
    // Turned off in Settings: nothing.
    await w.d.setPocket({ notify: { events: { asking: false } } });
    assert.equal(w.d.pocketNotify({ kind: 'asking', project: 'Tab t2', tabId: 't2' }), false);
  } finally { globalThis.fetch = before; stop(w); }
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
