// A conversation on another agent's CLI (harness/) through the real tab
// manager: it runs on that agent from its first message to its last, History
// keeps which agent and its session, and nothing of Claude Code's own (its
// models, effort, keep-warm pings, local models) is ever sent its way.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { SessionManager, NOT_CLAUDE } = require('../src/main/sessions');
const { History } = require('../src/main/history');
const { harnessFactory } = require('../src/main/harness');
const { AcpSession } = require('../src/main/harness/acp-session');
const localTab = require('../src/main/local/tab');

const FAKE = path.join(__dirname, 'fixtures', 'fake-acp.js');
const dirs = [];
const managers = [];
after(() => {
  for (const m of managers) for (const t of m.tabs.values()) t.session.kill();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function manager({ history } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-harness-'));
  dirs.push(dir);
  const mgr = new SessionManager({
    getExe: () => process.execPath, history: history || new History(dir), getMode: () => 'ask', getModel: () => 'claude-opus-5-5',
    makeHarness: harnessFactory({ fake: FAKE, node: process.execPath }),
  });
  managers.push(mgr);
  const seen = [];
  mgr.on('item', (_id, item) => seen.push(item));
  return { mgr, seen };
}

const resultOf = (seen, n = 1) => new Promise((resolve, reject) => {
  const start = Date.now();
  const tick = () => {
    const r = seen.filter(i => i.kind === 'result');
    if (r.length >= n) return resolve(r[n - 1]);
    if (Date.now() - start > 5000) return reject(new Error(`no result; saw ${seen.map(i => i.kind).join(',')}`));
    setTimeout(tick, 20);
  };
  tick();
});

test('a Gemini conversation runs on its agent, and History keeps which one and its session', async () => {
  const { mgr, seen } = manager();
  const tab = mgr.open({ tabId: 'g1', cwd: os.tmpdir(), harness: 'gemini' });
  assert.ok(tab.session instanceof AcpSession);
  assert.equal(tab.harness, 'gemini');
  mgr.send('g1', 'hello', { kind: 'user', text: 'hello' });
  const r = await resultOf(seen);
  assert.equal(r.ok, true);
  assert.equal(seen.find(i => i.kind === 'text').text, 'echo: hello');
  const entry = mgr.history.get('g1');
  assert.equal(entry.harness, 'gemini');
  assert.match(entry.claudeSessionId, /^sess-/, 'its session, to pick up where it left off');
  assert.equal(mgr.summary.find(s => s.id === 'g1').harness, 'gemini');
});

test('reopened from History it runs on the same agent and the same session', async () => {
  const first = manager();
  first.mgr.open({ tabId: 'g2', cwd: os.tmpdir(), harness: 'opencode' });
  first.mgr.send('g2', 'one', { kind: 'user', text: 'one' });
  await resultOf(first.seen);
  const entry = first.mgr.history.get('g2');
  first.mgr.close('g2', { kill: true });

  const again = manager({ history: first.mgr.history });
  // Asked for Claude, but History says OpenCode: History wins, so it's never carried on by another agent.
  const tab = again.mgr.open({ tabId: 'g2', cwd: os.tmpdir(), historyEntry: entry, harness: 'claude' });
  assert.equal(tab.harness, 'opencode');
  assert.equal(tab.session.sessionId, entry.claudeSessionId);
});

test("a conversation with no harness is Claude Code's as ever", () => {
  const { mgr } = manager();
  const tab = mgr.open({ tabId: 'c1', cwd: os.tmpdir() });
  assert.equal(tab.harness, 'claude');
  assert.ok(!(tab.session instanceof AcpSession));
  mgr.close('c1');
});

test("Claude Code's own settings are refused for another agent's conversation", async () => {
  const { mgr } = manager();
  const tab = mgr.open({ tabId: 'g3', cwd: os.tmpdir(), harness: 'codex' });
  assert.throws(() => mgr.setTabModel('g3', 'claude-opus-5-5', { byYou: true }), new RegExp(NOT_CLAUDE));
  assert.throws(() => mgr.setTabEffort('g3', 'high'), new RegExp(NOT_CLAUDE));
  await assert.rejects(mgr.ping('g3', 'ping'), new RegExp(NOT_CLAUDE));
  assert.equal(localTab.canMove(tab), false, 'never moved onto a local model');
});

test('an idle one sheds its process like a Claude one, and the next message starts it again', async () => {
  const { mgr, seen } = manager();
  const tab = mgr.open({ tabId: 'g4', cwd: os.tmpdir(), harness: 'gemini' });
  mgr.send('g4', 'one', { kind: 'user', text: 'one' });
  await resultOf(seen);
  tab.activeAt = 0;
  assert.deepEqual(mgr.stopIdle(1000), ['g4']);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(tab.session.proc, null);
  mgr.send('g4', 'two', { kind: 'user', text: 'two' });
  const r = await resultOf(seen, 2);
  assert.equal(r.ok, true);
});

test('an unknown harness is Claude, and one with no way to run it is refused', () => {
  const { mgr } = manager();
  assert.equal(mgr.open({ tabId: 'u1', cwd: os.tmpdir(), harness: 'nope' }).harness, 'claude');
  mgr.close('u1');
  const bare = new SessionManager({ getExe: () => process.execPath, history: mgr.history, getMode: () => 'ask', getModel: () => '' });
  assert.throws(() => bare.open({ tabId: 'u2', cwd: os.tmpdir(), harness: 'gemini' }), /aren't available here/);
});
