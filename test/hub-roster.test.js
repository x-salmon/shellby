const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roster, rowOf, summaryOf, powerOf } = require('../src/main/hub/roster');
const { hostFacts, describeOs } = require('../src/main/hub/host');

const NOW = 1_700_000_000_000;
const view = (over = {}) => ({
  pc: 'desk',
  tabs: [{ id: 't1', title: 'Fix the flaky test', folder: 'shellby', standing: 'working', busy: true, pending: 0 },
    { id: 't2', title: 'Write the migration', folder: 'shellby', standing: 'asking', busy: true, pending: 1, harness: 'gemini' },
    { id: 't3', title: 'Old', folder: 'x', standing: 'quiet', busy: false }],
  prompts: [{ tabId: 't2' }],
  machine: { cpu: { load: 38, temp: 60 }, gpu: { load: 80, temp: 71 }, ram: 59, battery: null, hot: 'warn' },
  host: hostFacts({ platform: 'win32', release: '10.0.19045', version: '0.98.1', totalmem: 32 * 1024 ** 3, freemem: 13 * 1024 ** 3, diskFree: 4.1 * 1024 ** 3, agents: ['claude', 'gemini', 'evil'] }),
  projects: [{ key: 'C:\\code\\shellby', name: 'shellby' }],
  limits: { perHour: 30, atOnce: 10, open: 2 },
  ...over,
});

test('a reachable PC row has the columns the roster shows', () => {
  const r = rowOf({ id: 'p-1', name: 'Desk PC', kind: 'pc', state: 'online', seenAt: NOW - 1000, view: view() }, NOW);
  assert.equal(r.live, true);
  assert.equal(r.working, 2);
  assert.equal(r.waiting, 1);
  assert.equal(r.cpu, 38);
  assert.deepEqual(r.gpu, { load: 80, temp: 71 });
  assert.equal(r.hot, 'warn');
  assert.deepEqual(r.ram, { usedGb: 19, totalGb: 32 });
  assert.equal(r.diskFreeGb, 4.1);
  assert.equal(r.power, 'plugged in');
  assert.equal(r.os, 'Windows 10');
  assert.deepEqual(r.agents.map(a => a.id), ['claude', 'gemini'], 'only agents Shellby knows');
  assert.equal(r.tabs[1].agent, 'Gemini CLI');
});

test("an unreachable PC keeps what it could run, says why, and shows no made-up numbers", () => {
  const r = rowOf({ id: 'p-2', name: 'Living-room PC', kind: 'pc', state: 'offline', error: 'Not reachable: it may be asleep or offline.', seenAt: NOW - 3600e3, view: view() }, NOW);
  assert.equal(r.live, false);
  for (const k of ['working', 'waiting', 'cpu', 'gpu', 'ram', 'diskFreeGb', 'power']) assert.equal(r[k], null, k);
  assert.deepEqual(r.agents.map(a => a.id), ['claude', 'gemini']);
  assert.match(r.error, /asleep or offline/);
  const never = rowOf({ id: 'p-3', name: 'New PC', kind: 'pc', state: 'connecting' }, NOW);
  assert.deepEqual(never.agents, []);
  assert.equal(never.working, null);
});

test('this PC first, then the reachable ones, then the rest, by name', () => {
  const rows = roster([
    { id: 'p-z', name: 'Zed', kind: 'pc', state: 'offline', view: null },
    { id: 'p-b', name: 'Basement server', kind: 'pc', state: 'online', view: view() },
    { id: 'this', name: 'Desk PC', kind: 'this', state: 'online', view: view() },
    { id: 'p-a', name: 'Attic laptop', kind: 'pc', state: 'online', view: view() },
  ], NOW);
  assert.deepEqual(rows.map(r => r.id), ['this', 'p-a', 'p-b', 'p-z']);
  assert.equal(summaryOf(rows), '4 PCs, 3 reachable, 6 working, 3 waiting on you');
});

test('power reads as a person would say it', () => {
  assert.equal(powerOf({ battery: { level: 64, charging: false } }), 'battery 64%');
  assert.equal(powerOf({ battery: { level: 80, charging: true } }), 'charging, 80%');
  assert.equal(powerOf({ battery: null }), 'plugged in');
  assert.equal(powerOf(null), null, 'Health off there: not known');
});

test('host facts: Windows 10 or 11 by build, numbers rounded, junk dropped', () => {
  assert.equal(describeOs('win32', '10.0.22631'), 'Windows 11');
  assert.equal(describeOs('win32', '10.0.19045'), 'Windows 10');
  assert.equal(describeOs('linux', '6.8.0'), 'Linux');
  const h = hostFacts({ platform: 'win32', release: '10.0.22631', version: '1.2.3; rm -rf', totalmem: NaN, freemem: 1, diskFree: -5, agents: 'claude' });
  assert.deepEqual(h, { os: 'Windows 11', version: null, ram: null, diskFreeGb: null, agents: [] });
});

test("a PC sending junk gets a row that says so, and never stops the roster drawing", () => {
  const rows = roster([
    { id: 'this', name: 'Desk', kind: 'this', state: 'online', view: view() },
    { id: 'p-bad', name: 'Odd PC', kind: 'pc', state: 'online', view: { tabs: [null, 3, 'x', { busy: true }], projects: [null, { key: 'C:\\a', name: 'a' }], prompts: 'many', machine: { gpu: 7, hot: '<b>', ram: '9' }, host: { ram: { totalGb: 'lots' }, agents: ['claude', '__proto__', { x: 1 }] } } },
    { id: 'p-worse', name: 'Worse PC', kind: 'pc', state: 'online', view: { get tabs() { throw new Error('boom'); } } },
  ], NOW);
  assert.equal(rows.length, 3);
  const odd = rows.find(r => r.id === 'p-bad');
  assert.equal(odd.working, 1, 'only the real conversation counts');
  assert.deepEqual(odd.projects.map(p => p.name), ['a']);
  assert.equal(odd.waiting, 0);
  assert.equal(odd.gpu, null);
  assert.equal(odd.hot, null);
  assert.equal(odd.ram, null);
  assert.deepEqual(odd.agents.map(a => a.id), ['claude']);
  const worse = rows.find(r => r.id === 'p-worse');
  assert.equal(worse.live, false);
  assert.match(worse.error, /couldn't be read/);
});

test("what's waiting on you there comes with the row, rebuilt, and only while it's reachable", () => {
  const prompts = [
    { tabId: 't2', requestId: 'r1', title: 'Write the migration', toolName: 'Bash', label: 'Run a command', detail: 'npm test', always: 'Always allow Bash(npm test)', warnings: ['x'.repeat(500)], evil: '<script>' },
    { tabId: 't2', requestId: 'r2', toolName: 'AskUserQuestion', questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: '' }, null], multiSelect: 'yes' }, { question: 'No options', options: [] }] },
    { tabId: 't2', requestId: 'r3', toolName: 'ExitPlanMode', plan: 'A plan', planText: 'p'.repeat(30000), deskOnly: null },
    { tabId: 't2' }, null, 'x',
  ];
  const r = rowOf({ id: 'p-1', name: 'Desk', kind: 'pc', state: 'online', view: view({ prompts }) }, NOW);
  assert.equal(r.waiting, 6, 'the count is what the PC says');
  assert.deepEqual(r.prompts.map(p => p.requestId), ['r1', 'r2', 'r3'], 'only ones that can be answered');
  assert.equal(r.prompts[0].always, 'Always allow Bash(npm test)');
  assert.equal(r.prompts[0].warnings[0].length, 140);
  assert.ok(!('evil' in r.prompts[0]));
  assert.deepEqual(r.prompts[1].questions, [{ question: 'Which?', header: '', multiSelect: false, options: [{ label: 'A', description: '' }] }]);
  assert.equal(r.prompts[2].planText.length, 20000);
  const off = rowOf({ id: 'p-1', name: 'Desk', kind: 'pc', state: 'offline', view: view({ prompts }) }, NOW);
  assert.deepEqual(off.prompts, [], "a PC that isn't reachable can't be answered");
});

test("each conversation says the mode it's in and whether a reply can reach it", () => {
  const r = rowOf({ id: 'p-1', name: 'Desk', kind: 'pc', state: 'online', view: view({ tabs: [{ id: 'a', mode: 'acceptEdits', canReply: true }, { id: 'b', mode: 7, canReply: 'yes' }] }) }, NOW);
  assert.deepEqual(r.tabs.map(t => [t.mode, t.canReply]), [['acceptEdits', true], ['', false]]);
});
