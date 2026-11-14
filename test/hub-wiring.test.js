// The hub wired up (wiring/hub.js): pairing a PC keeps only a sealed token,
// its live view becomes a roster row, a task goes to that PC, and removing it
// asks it to forget the hub first. Another PC is a fake fetch here.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { installFakeElectron } = require('./helpers/fake-ipc');

installFakeElectron();
const electron = require('electron');
// Windows' own sealing, faked: reversible here, and plainly not the token.
electron.safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: s => Buffer.from(`sealed:${[...s].reverse().join('')}`),
  decryptString: b => [...b.toString().replace(/^sealed:/, '')].reverse().join(''),
};
const { wireHub } = require('../src/main/wiring/hub');

const TOKEN = 'T'.repeat(43);
const ORIGIN = 'https://laptop.tail3f2c.ts.net';
const enc = new TextEncoder();
let calls;

function fakeFetch(view) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/pocket/v1/pair')) {
      const code = JSON.parse(init.body).code;
      return { status: code === 'GOODCODE' ? 200 : 403, ok: code === 'GOODCODE', json: async () => (code === 'GOODCODE' ? { ok: true, token: TOKEN } : { ok: false, error: "That's not the code." }) };
    }
    if (url.endsWith('/pocket/v1/events')) {
      return { status: 200, ok: true, body: (async function* gen() { yield enc.encode(`event: view\ndata: ${JSON.stringify(view)}\n\n`); await new Promise(() => {}); })() };
    }
    return { status: 200, ok: true, json: async () => ({ ok: true, tabId: 'remote-tab' }) };
  };
}

function setup() {
  const conf = {};
  const sent = [];
  const d = {
    config: { get: k => conf[k], set: o => Object.assign(conf, o) },
    send: (_w, ch) => sent.push(ch),
    log: { info: () => {}, warn: () => {} },
    pocketCurrentView: () => ({ pc: 'desk', tabs: [], prompts: [], host: { os: 'Windows 10', agents: ['claude'] }, projects: [], usage: { pct: 42 } }),
  };
  const { hub } = wireHub(d);
  return { hub, conf, sent };
}

beforeEach(() => { calls = []; });

test('a PC pairs with the code it shows, and only a sealed token is kept', async () => {
  globalThis.fetch = fakeFetch({ pc: 'laptop', tabs: [{ id: 'a', busy: true }], prompts: [], host: { os: 'Windows 11', agents: ['claude', 'opencode'] }, projects: [{ key: 'C:\\code\\shellby', name: 'shellby' }] });
  const { hub, conf } = setup();
  const r = await hub.addPc({ address: 'laptop.tail3f2c.ts.net', code: 'goodcode', name: 'Travel laptop' });
  assert.equal(r.ok, true, r.error);
  assert.equal(conf.hubPeers.length, 1);
  assert.ok(!JSON.stringify(conf.hubPeers).includes(TOKEN), 'the token is never saved as it is');
  assert.match(JSON.parse(calls[0].init.body).name, /\(Shellby hub\)$/);
  await new Promise(r => setTimeout(r, 30));
  const v = hub.hubView();
  assert.deepEqual(v.rows.map(r => [r.name, r.state]), [[require('os').hostname(), 'online'], ['Travel laptop', 'online']]);
  assert.equal(v.rows[1].working, 1);
  assert.equal(v.rows[1].os, 'Windows 11');
  assert.deepEqual(v.usage, { pct: 42 });
  const events = calls.find(c => c.url === `${ORIGIN}/pocket/v1/events`);
  assert.equal(events.init.headers.Authorization, `Bearer ${TOKEN}`, 'unsealed only to make the request');
  hub.stopHub();
});

test('a wrong code or a non-Tailscale address adds nothing', async () => {
  globalThis.fetch = fakeFetch({});
  const { hub, conf } = setup();
  assert.match((await hub.addPc({ address: 'laptop.tail3f2c.ts.net', code: 'WRONGONE' })).error, /not the code/);
  assert.match((await hub.addPc({ address: 'evil.example.com', code: 'GOODCODE' })).error, /Tailscale address/);
  assert.equal(calls.filter(c => c.url.includes('evil')).length, 0, 'nothing is sent to an address that isn\'t a PC of yours');
  assert.equal(conf.hubPeers, undefined);
});

test('a task goes to that PC through its own task rules; removing it asks it to forget the hub first', async () => {
  globalThis.fetch = fakeFetch({ pc: 'laptop', tabs: [], prompts: [], projects: [] });
  const { hub, conf } = setup();
  const { id } = await hub.addPc({ address: ORIGIN, code: 'GOODCODE', name: 'Laptop' });
  await new Promise(r => setTimeout(r, 30));
  const r = await hub.startOn(id, { project: 'C:\\code\\shellby', text: 'Run the tests', mode: 'ask' });
  assert.deepEqual(r, { ok: true, tabId: 'remote-tab' });
  const task = calls.find(c => c.url === `${ORIGIN}/pocket/v1/task`);
  assert.deepEqual(JSON.parse(task.init.body), { project: 'C:\\code\\shellby', text: 'Run the tests', mode: 'ask', when: 'now' });
  const gone = await hub.removePc(id);
  assert.equal(gone.forgotThere, true);
  assert.ok(calls.some(c => c.url === `${ORIGIN}/pocket/v1/forget`));
  assert.deepEqual(conf.hubPeers, []);
  assert.equal((await hub.startOn(id, { project: 'x', text: 'y' })).ok, false);
});

test("this PC's own name can be changed, and an empty name changes nothing", () => {
  const { hub, conf } = setup();
  hub.renamePc('this', '  Desk PC ');
  assert.equal(conf.hubName, 'Desk PC');
  hub.renamePc('this', '   ');
  assert.equal(conf.hubName, 'Desk PC');
});

// ---- what the security review found

test("what a PC says about itself is kept cut down, and a bad saved snapshot is dropped, not trusted", async () => {
  globalThis.fetch = fakeFetch({ pc: 'laptop', tabs: [], prompts: [], host: { os: 'Windows 11', agents: ['claude'], junk: 'x'.repeat(100000) }, projects: [null, { key: 'C:\\code\\a', name: 'a', extra: 'y'.repeat(100000) }] });
  const { hub, conf } = setup();
  const { id } = await hub.addPc({ address: ORIGIN, code: 'GOODCODE', name: 'Laptop' });
  await new Promise(r => setTimeout(r, 1100)); // views are read at most once a second
  const saved = conf.hubSeen[id];
  assert.ok(saved, 'its snapshot is kept');
  assert.ok(JSON.stringify(saved).length < 2000, `small, whatever it sent (${JSON.stringify(saved).length} chars)`);
  assert.deepEqual(saved.projects, [{ key: 'C:\\code\\a', name: 'a' }]);
  hub.stopHub();
  conf.hubSeen[id] = { seenAt: 'yesterday', host: 'evil', projects: [null, 7], pc: { x: 1 } };
  const v = hub.hubView();
  assert.equal(v.rows.length, 2, 'the roster still draws');
  hub.stopHub();
});

test('a full hub refuses before pairing, so no token is left working on the other PC', async () => {
  globalThis.fetch = fakeFetch({});
  const { hub, conf } = setup();
  const sealedFor = o => Buffer.from(`sealed:${o}`).toString('base64');
  conf.hubPeers = Array.from({ length: 16 }, (_, i) => ({ id: `p-${String(i).padStart(12, '0')}`, origin: `https://pc${i}.t.ts.net`, name: `PC ${i}`, token: sealedFor(i), pairedAt: 1 }));
  const r = await hub.addPc({ address: ORIGIN, code: 'GOODCODE' });
  assert.match(r.error, /up to 16/);
  assert.equal(calls.filter(c => c.url.endsWith('/pair')).length, 0, 'nothing was sent to it');
});

test("the panel's settings never carry the PCs' sealed tokens", () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main', 'wiring', 'settings.js'), 'utf8');
  assert.match(src, /hubPeers: _hp, hubSeen: _hs/);
});

// ---- acting on another PC's conversations

async function pairedWith(view) {
  globalThis.fetch = fakeFetch(view);
  const s = setup();
  const { id } = await s.hub.addPc({ address: ORIGIN, code: 'GOODCODE', name: 'Laptop' });
  await new Promise(r => setTimeout(r, 30));
  return { ...s, id };
}

test('an answer goes to that PC as its phone would send it', async () => {
  const { hub, id } = await pairedWith({ pc: 'laptop', tabs: [], prompts: [], projects: [] });
  const r = await hub.answerOn(id, { tabId: 'a', requestId: 'r1', decision: 'always' });
  assert.equal(r.ok, true);
  const sent = calls.find(c => c.url === `${ORIGIN}/pocket/v1/answer`);
  assert.deepEqual(JSON.parse(sent.init.body), { tabId: 'a', requestId: 'r1', decision: 'always' });
  await hub.answerOn(id, { tabId: 'a', requestId: 'r2', decision: 'allow', read: true, answers: { 'Which?': 'A' } });
  assert.deepEqual(JSON.parse(calls.filter(c => c.url.endsWith('/answer'))[1].init.body), { tabId: 'a', requestId: 'r2', decision: 'allow', answers: { 'Which?': 'A' }, read: true });
  hub.stopHub();
});

test("a reply keeps the conversation's mode; one on Autonomous, or that didn't say, is replied to at that PC", async () => {
  const { hub, id } = await pairedWith({ pc: 'laptop', tabs: [{ id: 'a', mode: 'acceptEdits' }, { id: 'b', mode: 'autonomous' }, { id: 'c' }], prompts: [], projects: [] });
  await hub.replyOn(id, { tabId: 'a', text: 'Also the docs' });
  assert.match((await hub.replyOn(id, { tabId: 'b', text: 'Carry on' })).error, /Autonomous.*Reply at that PC/);
  assert.match((await hub.replyOn(id, { tabId: 'c', text: 'Carry on' })).error, /didn't say/);
  const bodies = calls.filter(c => c.url === `${ORIGIN}/pocket/v1/reply`).map(c => JSON.parse(c.init.body));
  assert.deepEqual(bodies, [{ tabId: 'a', text: 'Also the docs', mode: 'acceptEdits' }], 'nothing else was sent, so its mode there is untouched');
  assert.match((await hub.replyOn(id, { tabId: 'gone', text: 'x' })).error, /closed/);
  hub.stopHub();
});

test("an unreachable PC can't be answered or replied to, and says why", async () => {
  const { hub } = setup();
  assert.match((await hub.answerOn('p-000000000000', { tabId: 'a', requestId: 'r', decision: 'allow' })).error, /gone/);
  assert.match((await hub.replyOn('p-000000000000', { tabId: 'a', text: 'x' })).error, /gone/);
});

test("one conversation there opens live, and opening another closes the first", async () => {
  const { hub, id } = await pairedWith({ pc: 'laptop', tabs: [{ id: 'a' }], prompts: [], projects: [] });
  assert.equal(hub.openConvo(id, 'a').ok, true);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(calls.some(c => c.url === `${ORIGIN}/pocket/v1/events?tab=a`));
  assert.equal(hub.convoView().tabId, 'a');
  assert.equal(hub.convoView().pcId, id);
  hub.openConvo(id, 'b');
  assert.equal(hub.convoView().tabId, 'b');
  assert.equal(hub.openConvo(id, 'x&y').ok, false);
  hub.closeConvo();
  assert.equal(hub.convoView(), null);
  hub.stopHub();
});

test('the open conversation comes again only when it has changed', async () => {
  const { hub, id } = await pairedWith({ pc: 'laptop', tabs: [{ id: 'a' }], prompts: [], projects: [] });
  hub.openConvo(id, 'a');
  const first = hub.convoView();
  assert.ok(Number.isInteger(first.version));
  assert.deepEqual(hub.convoView(first.version), { pcId: id, tabId: 'a', version: first.version, same: true });
  assert.ok(Array.isArray(hub.convoView(first.version - 1).items), 'an older version gets the whole snapshot');
  hub.stopHub();
});

test("a plan's whole text goes only with the PC on screen", async () => {
  const plan = { tabId: 'a', requestId: 'r1', toolName: 'ExitPlanMode', plan: 'A plan', planText: 'Step 1' };
  const { hub, id } = await pairedWith({ pc: 'laptop', tabs: [{ id: 'a' }], prompts: [plan], projects: [] });
  await new Promise(r => setTimeout(r, 1100));
  const row = v => v.rows.find(r => r.id === id);
  assert.equal(row(hub.hubView(id)).prompts[0].planText, 'Step 1');
  assert.equal(row(hub.hubView('this')).prompts[0].planText, '');
  assert.equal(row(hub.hubView('this')).prompts[0].plan, 'A plan', 'it still says there is one');
  hub.stopHub();
});
