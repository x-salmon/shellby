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
