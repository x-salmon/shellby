// An ACP conversation (harness/acp-session.js) end to end, against a fake
// agent process (fixtures/fake-acp.js): the items and events the tab manager
// gets are the ones it gets from ClaudeSession.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { AcpSession } = require('../src/main/harness/acp-session');

const FAKE = path.join(__dirname, 'fixtures', 'fake-acp.js');
const HARNESS = { id: 'gemini', name: 'Gemini CLI', modes: { ask: ['default'], acceptEdits: ['auto_edit'], plan: ['plan'], autonomous: ['yolo'] } };

// Every session a test makes is stopped at the end, so no fake agent outlives the file.
const made = [];
after(() => { for (const s of made) s.kill(); });

function make({ env = {}, ...o } = {}) {
  const s = new AcpSession({
    harness: HARNESS, command: () => ({ file: process.execPath, prefix: [FAKE] }), cwd: __dirname,
    kill: proc => proc.kill(), env: () => env, ...o,
  });
  made.push(s);
  const items = [];
  s.on('item', i => items.push(i));
  return { s, items };
}

const until = (s, items, pred, ms = 5000) => new Promise((resolve, reject) => {
  const check = () => { const hit = items.find(pred); if (hit) { done(); resolve(hit); } };
  const timer = setTimeout(() => { done(); reject(new Error(`timed out; items: ${JSON.stringify(items.map(i => i.kind))}`)); }, ms);
  const done = () => { clearTimeout(timer); s.off('item', check); };
  s.on('item', check);
  check();
});

const results = items => items.filter(i => i.kind === 'result');

test('a message streams its reply and ends the turn with a result and usage', async t => {
  const { s, items } = make();
  t.after(() => s.kill());
  const busy = [];
  const ctx = [];
  s.on('busy', b => busy.push(b));
  s.on('context', c => ctx.push(c));
  s.send('hello there');
  const r = await until(s, items, i => i.kind === 'result');
  assert.equal(r.ok, true);
  assert.deepEqual(r.tokens, { input: 5000, output: 300, cacheRead: 0, cacheWrite: 0 });
  assert.equal(items.find(i => i.kind === 'init').sessionId, s.sessionId);
  assert.equal(items.find(i => i.kind === 'text').text, 'echo: hello there');
  assert.ok(items.some(i => i.kind === 'partial'), 'the reply showed as it was written');
  assert.deepEqual(busy, [true, false]);
  assert.equal(ctx[0].tokens, 5300);
  assert.equal(s.busy, false);
});

test('a second message goes to the same process and session', async t => {
  const { s, items } = make();
  t.after(() => s.kill());
  s.send('one');
  await until(s, items, i => i.kind === 'result');
  const pid = s.proc.pid;
  const id = s.sessionId;
  s.send('two');
  await until(s, items, i => results(items).length === 2);
  assert.equal(s.proc.pid, pid);
  assert.equal(s.sessionId, id);
  assert.equal(items.filter(i => i.kind === 'text').at(-1).text, 'echo: two');
});

test('a permission request is a card; allowing and denying reach the agent', async t => {
  const { s, items } = make();
  t.after(() => s.kill());
  s.send('tool');
  const card = await until(s, items, i => i.kind === 'permission');
  assert.equal(card.toolName, 'Bash');
  assert.equal(card.input.command, 'npm test');
  assert.equal(card.plain?.ask, 'Run your tests', 'in plain words, like a Claude card');
  assert.equal(s.pending.size, 1);
  assert.equal(s.respond(card.requestId, 'always'), true);
  await until(s, items, i => i.kind === 'result');
  assert.equal(items.find(i => i.kind === 'decision').decision, 'always');
  assert.equal(items.filter(i => i.kind === 'text').at(-1).text, 'ALLOWED always');
  assert.equal(items.find(i => i.kind === 'tool_result').isError, false);

  s.send('tool');
  const again = await until(s, items, i => i.kind === 'permission' && i.requestId !== card.requestId);
  s.respond(again.requestId, 'deny');
  await until(s, items, () => results(items).length === 2);
  assert.equal(items.filter(i => i.kind === 'text').at(-1).text, 'DENIED');
});

test('an edit card carries the file and the change', async t => {
  const { s, items } = make();
  t.after(() => s.kill());
  s.send('edit');
  const card = await until(s, items, i => i.kind === 'permission');
  assert.equal(card.toolName, 'Edit');
  assert.equal(card.filePath, 'a.js');
  assert.ok(card.edits?.length, 'the diff comes with it');
  s.respond(card.requestId, 'allow');
  await until(s, items, i => i.kind === 'result');
});

test('stopping a turn cancels it: an interrupted result, not an error', async t => {
  const { s, items } = make();
  t.after(() => s.kill());
  s.send('slow');
  await until(s, items, i => i.kind === 'tool');
  s.interrupt();
  const r = await until(s, items, i => i.kind === 'result');
  assert.equal(r.interrupted, true);
  assert.equal(r.error, null);
  assert.equal(s.busy, false);
});

test('an agent that errors or crashes ends the turn with what went wrong', async t => {
  const a = make();
  t.after(() => a.s.kill());
  a.s.send('fail');
  const r = await until(a.s, a.items, i => i.kind === 'result');
  assert.equal(r.ok, false);
  assert.match(r.error, /Quota exceeded/);

  const b = make();
  const exits = [];
  b.s.on('exit', c => exits.push(c));
  b.s.send('crash');
  const r2 = await until(b.s, b.items, i => i.kind === 'result');
  assert.equal(r2.ok, false);
  assert.match(r2.error, /exit code 3/);
  assert.deepEqual(exits, [3]);
  assert.equal(b.s.busy, false);
  b.s.send('after a crash');
  await until(b.s, b.items, () => results(b.items).length === 2);
  assert.equal(results(b.items).at(-1).ok, true, 'the next message starts it again');
});

test('the mode goes to the agent as its own name for it, now and when changed', async t => {
  const { s, items } = make({ mode: 'acceptEdits' });
  t.after(() => s.kill());
  s.send('mode');
  await until(s, items, i => i.kind === 'result');
  assert.equal(items.filter(i => i.kind === 'text').at(-1).text, 'mode: auto_edit');
  s.setMode('plan');
  await new Promise(r => setTimeout(r, 100));
  s.send('mode');
  await until(s, items, () => results(items).length === 2);
  assert.equal(items.filter(i => i.kind === 'text').at(-1).text, 'mode: plan');
});

test("a plan becomes Claude's to-do list", async t => {
  const { s, items } = make();
  t.after(() => s.kill());
  s.send('plan');
  const tool = await until(s, items, i => i.kind === 'tool' && i.name === 'TodoWrite');
  assert.deepEqual(tool.todo.items.map(i => i.subject), ['Look', 'Fix']);
});

test('a saved session is picked up again with session/load, or a fresh one when that fails', async t => {
  const ok = make({ resumeId: 'sess-old' });
  t.after(() => ok.s.kill());
  ok.s.send('hi');
  await until(ok.s, ok.items, i => i.kind === 'result');
  assert.equal(ok.s.sessionId, 'sess-old');

  const bad = make({ resumeId: 'sess-gone', env: { FAKE_ACP_LOAD_FAILS: '1' } });
  t.after(() => bad.s.kill());
  bad.s.send('hi');
  await until(bad.s, bad.items, i => i.kind === 'result');
  assert.notEqual(bad.s.sessionId, 'sess-gone');
  assert.match(bad.items.find(i => i.kind === 'error').text, /carries on in a fresh session/);
});

test("a missing CLI says so in plain words and ends the turn", async () => {
  const { s, items } = make({ command: () => null });
  s.send('hi');
  const r = await until(s, items, i => i.kind === 'result');
  assert.equal(r.ok, false);
  assert.match(r.error, /can't find Gemini CLI/);
});

test("what only Claude Code can do is refused plainly, and the rest reads as empty", () => {
  const { s } = make();
  assert.throws(() => s.rewindTo('x'), /isn't something this agent can do/);
  assert.deepEqual(s.runningCrew(), []);
  assert.equal(s.remote(), null);
  // Answered, not thrown: parity.js asks every running tab at once, and one refusal mustn't sink the rest.
  return s.request('mcp_status').then(r => { assert.equal(r.ok, false); assert.match(r.error, /isn't something this agent can do/); });
});

// ---- what the review found

test("picking a session up again doesn't replay it into the new turn", async () => {
  const { s, items } = make({ resumeId: 'sess-old' });
  s.send('new message');
  await until(s, items, i => i.kind === 'result');
  const said = items.filter(i => i.kind === 'text' || i.kind === 'partial').map(i => i.text).join(' ');
  assert.ok(!said.includes('REPLAYED'), `the old reply stays out (${said})`);
  assert.ok(!items.some(i => i.kind === 'tool' && i.id === 'old1'), 'and so do its old tool calls');
  assert.equal(items.filter(i => i.kind === 'text').at(-1).text, 'echo: new message');
});

test('Stop while the agent is still starting sends nothing and ends the turn as stopped', async () => {
  const { s, items } = make({ env: { FAKE_ACP_SLOW_START: '600' } });
  s.send('hello');
  await new Promise(r => setTimeout(r, 150));
  s.interrupt();
  const r = await until(s, items, i => i.kind === 'result');
  assert.equal(r.interrupted, true);
  assert.ok(!items.some(i => i.kind === 'text' && /echo/.test(i.text)), 'the message never went');
});

test("an agent that ignores Stop is ended, and the turn still ends as stopped", async () => {
  const { s, items } = make();
  s.send('stubborn');
  await until(s, items, i => i.kind === 'tool');
  s.interrupt(200);
  const r = await until(s, items, i => i.kind === 'result');
  assert.equal(r.interrupted, true);
  assert.equal(s.busy, false);
});

test("a mode the agent doesn't have is said once, and Plan isn't claimed", async () => {
  const { s, items } = make({ mode: 'plan', env: { FAKE_ACP_NO_MODES: '1' } });
  s.send('hi');
  await until(s, items, i => i.kind === 'result');
  assert.match(items.find(i => i.kind === 'error').text, /no mode Shellby could match to Plan only/);
  assert.equal(s.planning, false);
  s.send('again');
  await until(s, items, () => results(items).length === 2);
  assert.equal(items.filter(i => i.kind === 'error').length, 1, 'said once');
});

test('a CLI installed after a failed start is found on the next message', async () => {
  let installed = false;
  const { s, items } = make({ command: () => (installed ? { file: process.execPath, prefix: [FAKE] } : null) });
  s.send('first');
  await until(s, items, i => i.kind === 'result');
  installed = true;
  s.send('second');
  await until(s, items, () => results(items).length === 2);
  assert.equal(results(items).at(-1).ok, true);
});

test("a session that can't be picked up again says so", async () => {
  const { s, items } = make({ resumeId: 'sess-old', env: { FAKE_ACP_NO_LOAD: '1' } });
  s.send('hi');
  await until(s, items, i => i.kind === 'result');
  assert.match(items.find(i => i.kind === 'error').text, /won't remember what came earlier/);
});

test("its plan becomes the to-do list the tab's glance reads", async () => {
  const { s, items } = make();
  const seen = [];
  s.on('todos', t => seen.push(t));
  s.send('plan');
  await until(s, items, i => i.kind === 'result');
  assert.equal(seen.at(-1).total, 2);
});
