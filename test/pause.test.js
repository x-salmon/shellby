// Pause: Claude stops at the end of the step he's on and waits, until Continue
// (src/main/session/pause.js), and the panel's words for it.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { ClaudeSession, initHooks } = require('../src/main/session');
const { STEER_TIMEOUT_S, STEER_HOOK } = require('../src/main/session/args');
const { PARK_TEXT, PARK_BEFORE_TIMEOUT_MS, testParkAfter } = require('../src/main/session/pause');
const { LEAD_MS } = require('../src/main/keepwarm');
const { SessionManager } = require('../src/main/sessions');
const { History } = require('../src/main/history');
const L = require('../src/renderer/panel/tab-logic');
const F = require('../src/renderer/panel/feed-logic');

const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const HOUR = 60 * 60 * 1000;
const live = new Set();
after(() => { for (const s of live) s.close(); });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await wait(20);
  }
  return false;
}

function makeSession() {
  const s = new ClaudeSession({ exe: process.execPath, argsPrefix: [FAKE], cwd: os.tmpdir(), mode: 'ask' });
  live.add(s);
  const items = [];
  s.on('item', i => items.push(i));
  return { s, items };
}
const resultOf = s => new Promise(resolve => s.on('item', function onItem(i) { if (i.kind === 'result') { s.off('item', onItem); resolve(i); } }));
const texts = items => items.filter(i => i.kind === 'text').map(i => i.text);
const steerOf = (id, text) => ({ content: text, item: { kind: 'user', text, attachments: [], steerId: id } });

// A session with nothing behind it: what it writes is kept, as if to a running CLI.
function bareSession() {
  const s = new ClaudeSession({ exe: process.execPath, cwd: os.tmpdir(), mode: 'ask' });
  const written = [];
  s.write = obj => written.push(obj);
  s.proc = { stdin: { writable: true } };
  s.busy = true;
  const items = [];
  s.on('item', i => items.push(i));
  return { s, written, items, answered: () => written.filter(w => w.type === 'control_response').map(w => w.response.request_id) };
}
// A helper running under the main thread's Agent call `callId`, reported as task `taskId`.
function helper(s, taskId, callId) {
  s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: callId, name: 'Agent' }] } });
  s.tasks.set(taskId, { taskId, toolUseId: callId, status: 'running', startedAt: Date.now() });
}

// ------------------------------------------------------------------ the hook

test('the steer hook waits up to three hours, so a pause outlasts Claude Code\'s 10-minute default', () => {
  const hooks = initHooks();
  for (const at of [hooks.PostToolUse, hooks.PostToolUseFailure]) {
    assert.deepEqual(at.map(m => [m.hookCallbackIds[0], m.timeout]), [[STEER_HOOK, STEER_TIMEOUT_S]]);
  }
  assert.ok(STEER_TIMEOUT_S * 1000 > 10 * 60 * 1000);
});

// ------------------------------------------------------- against the fake CLI

test('a paused turn holds at the end of its step and goes on, in the same turn, on Continue', async () => {
  const { s, items } = makeSession();
  const done = resultOf(s);
  s.send('steps 3 150');
  assert.ok(await until(() => s.openTools.size === 1), 'the first step is running');
  assert.deepEqual(s.requestPause(), { ok: true });
  assert.equal(s.pauseView().phase, 'pausing');
  assert.ok(await until(() => s.pause?.phase === 'paused'), 'held once the step is done');
  const shown = items.filter(i => i.kind === 'tool_result').length;
  await wait(500); // unpaused, the next two steps would have run by now
  assert.equal(items.filter(i => i.kind === 'tool_result').length, shown, 'nothing more ran');
  assert.equal(s.busy, true, 'still the same turn');
  assert.deepEqual(s.resumePause(), { ok: true });
  const res = await done;
  assert.equal(res.ok, true);
  assert.ok(!res.parked && !res.pauseMissed);
  assert.deepEqual(texts(items), ['steps done']);
  assert.equal(s.pause, null);
  s.close();
});

test('what you queue while paused goes in when you continue', async () => {
  const { s, items } = makeSession();
  let steers = [steerOf('q1', 'also add tests')];
  s.takeSteers = () => { const out = steers; steers = []; return out; };
  const done = resultOf(s);
  s.send('steps 3 150');
  assert.ok(await until(() => s.openTools.size === 1));
  s.requestPause();
  assert.ok(await until(() => s.pause?.phase === 'paused'));
  assert.equal(items.filter(i => i.kind === 'user').length, 0, 'not read while paused');
  s.resumePause();
  await done;
  assert.deepEqual(texts(items), ['steered: also add tests']);
  s.close();
});

test('Stop while paused ends the turn and the pause', async () => {
  const { s } = makeSession();
  const done = resultOf(s);
  s.send('steps 3 150');
  assert.ok(await until(() => s.openTools.size === 1));
  s.requestPause();
  assert.ok(await until(() => s.pause?.phase === 'paused'));
  s.interrupt();
  const res = await done;
  assert.equal(res.interrupted, true);
  assert.ok(!res.parked);
  assert.equal(s.pause, null);
  s.close();
});

test('parking: Claude reads his step, says he is paused (unseen), and the turn ends parked', async () => {
  const { s, items } = makeSession();
  let offered = 0;
  s.takeSteers = () => { offered++; return []; };
  const done = resultOf(s);
  s.send('steps 3 150');
  assert.ok(await until(() => s.openTools.size === 1));
  s.requestPause();
  assert.ok(await until(() => s.pause?.phase === 'paused'));
  const asked = offered;
  assert.equal(s.park(), true);
  const res = await done;
  assert.equal(res.parked, true);
  assert.equal(offered, asked, 'what you queued waits for Continue');
  assert.deepEqual(texts(items), [], 'his one-word reply is not shown');
  assert.equal(s.busy, false);
  assert.equal(s.pauseView().phase, 'parked');
  s.clearParked();
  assert.equal(s.pause, null);
  s.close();
});

test('Stop on a parked pause ends it, and sends nothing to the CLI', async () => {
  const { s } = makeSession();
  const done = resultOf(s);
  s.send('steps 3 150');
  assert.ok(await until(() => s.openTools.size === 1));
  s.requestPause();
  assert.ok(await until(() => s.pause?.phase === 'paused'));
  s.park();
  await done;
  const writes = [];
  const write = s.write.bind(s);
  s.write = m => { writes.push(m); write(m); };
  s.interrupt();
  assert.equal(s.pause, null);
  assert.equal(s.busy, false);
  assert.deepEqual(writes, [], 'no interrupt for a turn that has already ended');
  s.close();
});

test("interrupting a Keep warm ping on a parked pause (its fuse) leaves the pause parked", async () => {
  const { s } = makeSession();
  let done = resultOf(s);
  s.send('steps 3 150');
  assert.ok(await until(() => s.openTools.size === 1));
  s.requestPause();
  assert.ok(await until(() => s.pause?.phase === 'paused'));
  s.park();
  await done;
  done = resultOf(s);
  s.send('wait 2000 ping'); // stands in for the ping: a turn on the parked conversation
  assert.ok(await until(() => s.busy && !s.waiting));
  s.interrupt();
  await done;
  assert.equal(s.pause?.phase, 'parked');
  s.close();
});

test('a dev/e2e run can bring parking forward (SHELLBY_PARK_AFTER_MS)', () => {
  const { s } = bareSession();
  s.cache = { at: Date.now(), ttlMs: HOUR };
  testParkAfter('3000');
  try {
    s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } });
    s.requestPause();
    const before = Date.now();
    s.steer('r1', { tool_use_id: 't1' });
    assert.ok(s.pause.parkAt >= before + 3000 && s.pause.parkAt <= Date.now() + 3000);
    s.releasePause();
  } finally { testParkAfter(undefined); }
  s.requestPause();
  s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash' }] } });
  s.steer('r2', { tool_use_id: 't2' });
  assert.equal(s.pause.parkAt, s.cache.at + HOUR - LEAD_MS, 'unset, it parks as usual');
  s.releasePause();
});

// ------------------------------------------------------------ the rules

test("only a running turn can pause, and not once it's stopping", () => {
  const { s } = bareSession();
  s.busy = false;
  assert.equal(s.requestPause().ok, false);
  s.busy = true;
  s.interrupting = true;
  assert.equal(s.requestPause().ok, false);
  s.interrupting = false;
  assert.equal(s.requestPause().ok, true);
  s.pause = null;
  // Sent, and still waiting to start: it pauses at its first step. Stop then ends both.
  s.proc = null;
  s.waiting = { afterStop: false };
  assert.equal(s.requestPause().ok, true);
  s.interrupt();
  assert.equal(s.pause, null);
  s.proc = { stdin: { writable: true } };
  s.busy = true;
  assert.equal(s.requestPause().ok, true, 'asked twice is still one pause');
});

test('nothing is held before Pause, and a step Stop cut short never is', () => {
  const { s, answered } = bareSession();
  s.steer('r1', { tool_use_id: 't1' });
  assert.deepEqual(answered(), ['r1']);
  s.requestPause();
  s.steer('r2', { tool_use_id: 't2', is_interrupt: true });
  assert.deepEqual(answered(), ['r1', 'r2']);
});

test('pausing waits for every step of the main thread, then holds them all', () => {
  const { s, answered } = bareSession();
  s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }, { type: 'tool_use', id: 't2', name: 'Read' }] } });
  s.requestPause();
  assert.equal(s.pauseView().waitingOn, 'Read', 'the step still running');
  s.steer('r1', { tool_use_id: 't1' });
  assert.equal(s.pause.phase, 'pausing', 't2 is still running');
  s.steer('r2', { tool_use_id: 't2' });
  assert.equal(s.pause.phase, 'paused');
  assert.deepEqual(answered(), [], 'both held');
  s.resumePause();
  assert.deepEqual(answered(), ['r1', 'r2']);
});

test('with nothing running, pausing waits for his reply to reach a step', () => {
  const { s } = bareSession();
  s.requestPause();
  assert.equal(s.pauseView().waitingOn, 'his reply');
  assert.equal(s.pause.phase, 'pausing');
});

test('helpers pause too: paused once each one the turn waits on is held', () => {
  const { s, answered } = bareSession();
  helper(s, 'ag1', 'call-1');
  helper(s, 'ag2', 'call-2');
  s.requestPause();
  assert.equal(s.pauseView().waitingOn, '2 of 2 helpers');
  s.steer('h1', { tool_use_id: 'sub-1', agent_id: 'ag1' });
  assert.equal(s.pause.phase, 'pausing');
  assert.equal(s.pauseView().waitingOn, '1 of 2 helpers');
  s.steer('h2', { tool_use_id: 'sub-2', agent_id: 'ag2' });
  assert.equal(s.pause.phase, 'paused');
  assert.equal(s.pauseView().helpers, 2);
  assert.deepEqual(answered(), []);
  // Continue: the helpers go on first, then the main thread.
  s.resumePause();
  assert.deepEqual(answered(), ['h1', 'h2']);
});

test("a helper that finishes while pausing hands back to the main thread, which then holds", () => {
  const { s } = bareSession();
  helper(s, 'ag1', 'call-1');
  s.requestPause();
  s.trackTask({ taskId: 'ag1', phase: 'done', status: 'completed' });
  assert.equal(s.pause.phase, 'pausing', 'its Agent call is still open');
  s.steer('m1', { tool_use_id: 'call-1', tool_name: 'Agent' });
  assert.equal(s.pause.phase, 'paused');
});

test('a pause only the main thread holds parks before its one-hour cache goes cold', () => {
  const { s } = bareSession();
  const at = Date.now();
  s.cache = { at, ttlMs: HOUR };
  s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } });
  s.requestPause();
  s.steer('r1', { tool_use_id: 't1' });
  assert.equal(s.pause.phase, 'paused');
  assert.equal(s.pause.parkAt, at + HOUR - LEAD_MS);
  assert.equal(s.pauseView().coolsAt, null, 'parking keeps it warm');
  s.releasePause();
});

test('a five-minute cache cools while paused, and the pause parks before Claude Code would give up', () => {
  const { s } = bareSession();
  s.cache = { at: Date.now(), ttlMs: 5 * 60 * 1000 };
  s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } });
  s.requestPause();
  s.steer('r1', { tool_use_id: 't1' });
  assert.equal(s.pause.parkAt, s.pause.since + STEER_TIMEOUT_S * 1000 - PARK_BEFORE_TIMEOUT_MS);
  assert.equal(s.pauseView().coolsAt, s.cache.at + s.cache.ttlMs);
  s.releasePause();
});

test("a pause a helper holds is never parked (that would end the helper's work)", () => {
  const { s, written } = bareSession();
  s.cache = { at: Date.now(), ttlMs: HOUR };
  helper(s, 'ag1', 'call-1');
  s.requestPause();
  s.steer('h1', { tool_use_id: 'sub-1', agent_id: 'ag1' });
  assert.equal(s.pause.phase, 'paused');
  assert.equal(s.pause.parkAt, null);
  assert.equal(s.pauseView().coolsAt, s.cache.at + HOUR);
  assert.equal(s.park(), false);
  assert.equal(written.length, 0);
  s.releasePause();
});

test('a background helper held after the pause settled stops it parking, and its line says when the cache cools', () => {
  const { s, written } = bareSession();
  s.cache = { at: Date.now(), ttlMs: HOUR };
  s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } });
  s.tasks.set('bg1', { taskId: 'bg1', toolUseId: 'call-bg', status: 'running', background: true });
  s.requestPause();
  s.steer('r1', { tool_use_id: 't1' });
  assert.ok(s.pause.parkAt, 'armed while only the main thread holds it');
  s.steer('b1', { tool_use_id: 'sub-1', agent_id: 'bg1' });
  assert.equal(s.pause.parkAt, null);
  assert.equal(s.pauseView().coolsAt, s.cache.at + HOUR);
  assert.equal(s.park(), false);
  assert.equal(written.length, 0, 'nothing answered, nothing written');
  s.releasePause();
});

test("a background helper's held step doesn't count for a helper the turn still waits on", () => {
  const { s } = bareSession();
  helper(s, 'ag1', 'call-1');
  s.tasks.set('bg1', { taskId: 'bg1', toolUseId: 'call-bg', status: 'running', background: true });
  s.requestPause();
  s.steer('b1', { tool_use_id: 'sub-9', agent_id: 'bg1' });
  assert.equal(s.pause.phase, 'pausing', 'ag1 is still working');
  s.steer('h1', { tool_use_id: 'sub-1', agent_id: 'ag1' });
  assert.equal(s.pause.phase, 'paused');
});

test("should Claude Code's task ids not be agent ids, enough held helpers will do", () => {
  const { s } = bareSession();
  helper(s, 'task-1', 'call-1');
  s.requestPause();
  s.steer('h1', { tool_use_id: 'sub-1', agent_id: 'agent-x' });
  assert.equal(s.pause.phase, 'paused');
});

test('the echo of the park note is not taken for a steer being read', () => {
  const { s, items } = bareSession();
  s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } });
  s.requestPause();
  s.steer('r1', { tool_use_id: 't1' });
  s.steered = [{ kind: 'user', text: 'mine', steerId: 'q1' }];
  s.park();
  s.trackSteps({ type: 'user', isReplay: true, message: { content: PARK_TEXT } });
  assert.equal(items.filter(i => i.kind === 'user').length, 0);
  assert.equal(s.steered.length, 1);
});

test("parking writes its note ahead of the held step's answer, and lets nothing you queued in", () => {
  const { s, written } = bareSession();
  s.takeSteers = () => [steerOf('q1', 'later')];
  s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] } });
  s.requestPause();
  s.steer('r1', { tool_use_id: 't1' });
  assert.equal(s.park(), true);
  assert.deepEqual(written.map(w => w.type), ['user', 'control_response']);
  assert.equal(written[0].message.content, PARK_TEXT);
  assert.equal(s.pause.phase, 'parking');
  // A tool he reaches for anyway stops the turn, which still ends parked.
  s.trackSteps({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash' }] } });
  assert.equal(written.at(-1).request.subtype, 'interrupt');
  // That interrupt can leave the result failed: parked, it's a pause, not a failure.
  const res = { kind: 'result', ok: false, error: 'interrupted' };
  s.pauseAtResult(res);
  assert.deepEqual([res.parked, res.ok, res.error], [true, true, null]);
  assert.equal(s.pause.phase, 'parked');
  // A Keep warm ping's turn since leaves it parked.
  const ping = { kind: 'result', ok: true };
  s.pauseAtResult(ping);
  assert.ok(!ping.parked && !ping.pauseMissed);
  assert.equal(s.pause.phase, 'parked');
});

test('a turn that ends before reaching a step says the pause missed', () => {
  const { s } = bareSession();
  s.requestPause();
  const res = { kind: 'result', ok: true };
  s.pauseAtResult(res);
  assert.equal(res.pauseMissed, true);
  assert.equal(s.pause, null);
});

test('when Claude Code stops waiting on a held step, the rest go on and the feed says so', () => {
  const { s, answered, items } = bareSession();
  helper(s, 'ag1', 'call-1');
  s.requestPause();
  s.steer('h1', { tool_use_id: 'sub-1', agent_id: 'ag1' });
  s.steer('h2', { tool_use_id: 'sub-2', agent_id: 'ag2' });
  s.cancelledRequest('h1');
  assert.deepEqual(answered(), ['h2'], 'the one it gave up on needs no answer');
  assert.equal(s.pause, null);
  assert.deepEqual(items.filter(i => i.kind === 'paused').map(i => i.what), ['ran-out']);
  s.cancelledRequest('other'); // not a held step: nothing happens
  assert.equal(items.filter(i => i.kind === 'paused').length, 1);
});

test('a process that goes ends a held pause, but a parked one stays for the next message', () => {
  const { s } = bareSession();
  s.requestPause();
  s.pauseEnded();
  assert.equal(s.pause, null);
  s.pause = { phase: 'parked', since: 1, pausedAt: 2, holds: new Map(), timer: null, parkAt: null };
  s.pauseEnded();
  assert.equal(s.pause.phase, 'parked');
  assert.equal(s.resumePause().ok, false, 'a parked pause carries on with a message');
});

// ------------------------------------------------------------- the manager

test('the manager pauses Claude Code conversations only, and its summary says how it stands', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-pause-'));
  const mgr = new SessionManager({ getExe: () => process.execPath, argsPrefix: [FAKE], history: new History(dir), getMode: () => 'ask', getModel: () => '' });
  try {
    assert.equal(mgr.pause('nope').ok, false);
    const tab = mgr.open({ tabId: 'pause-a', cwd: os.tmpdir() });
    live.add(tab.session);
    assert.equal(mgr.pause('pause-a').ok, false, 'nothing running');
    const done = resultOf(tab.session);
    mgr.send('pause-a', 'steps 2 150', { kind: 'user', text: 'steps 2 150' });
    assert.ok(await until(() => tab.session.openTools.size === 1));
    assert.equal(mgr.pause('pause-a').ok, true);
    const row = mgr.summary.find(t => t.id === 'pause-a');
    assert.equal(row.canPause, true);
    assert.equal(row.pause.phase, 'pausing');
    assert.ok(await until(() => mgr.summary.find(t => t.id === 'pause-a').pause?.phase === 'paused'));
    assert.equal(mgr.resume('pause-a').ok, true);
    await done;
    assert.equal(mgr.summary.find(t => t.id === 'pause-a').pause, null);
    // A routine's turn is waited on by the routine: it doesn't pause.
    tab.routineId = 'r-1';
    assert.equal(mgr.summary.find(t => t.id === 'pause-a').canPause, false);
  } finally {
    for (const t of mgr.tabs.values()) t.session.close();
  }
});

// --------------------------------------------------------------- the panel

test("the busy line and its button follow the pause", () => {
  assert.deepEqual(L.pauseLine(null), { text: '', button: 'pause', stop: true });
  assert.match(L.pauseLine({ phase: 'pausing', waitingOn: 'Bash' }).text, /^Pausing after this step… waiting for Bash$/);
  assert.equal(L.pauseLine({ phase: 'pausing' }).button, 'pausing');
  const paused = L.pauseLine({ phase: 'paused', coolsAt: new Date(2026, 10, 14, 14, 5).getTime() });
  assert.equal(paused.button, 'continue');
  assert.match(paused.text, /cache goes cold at 14:05/);
  assert.doesNotMatch(L.pauseLine({ phase: 'paused', coolsAt: null }).text, /cold/);
  assert.deepEqual(L.pauseLine({ phase: 'parked' }).button, 'continue');
  assert.equal(L.pauseLine({ phase: 'parked' }).stop, true, 'Stop ends a parked pause without carrying on');
  assert.equal(L.icon({ pause: { phase: 'paused' } }, 'turn').text, '⏸');
});

test("a parked turn's footer reads paused, and a pause that ran out leaves a note", () => {
  const fmt = { compact: String, duration: () => '1s' };
  const s = F.sounding({ kind: 'result', ok: true, parked: true }, fmt);
  assert.equal(s.word, 'Paused');
  assert.match(s.title, /Continue picks up/);
  assert.match(F.markFor({ kind: 'paused', what: 'ran-out' }, String).text, /ran out/);
});
