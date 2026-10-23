// The flaky test detective fed by Claude Code outside Shellby (external.js
// testRunsOf -> wiring/progress.js outsideTestStart / outsideTestRun): a fail
// and then a pass on the same code is a flake, and starts the "When a test
// flakes" workflows; an edit between the two records nothing.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { wireProgress } = require('../src/main/wiring/progress');
const { testRunsOf } = require('../src/main/external');
const flaky = require('../src/main/flaky');

// The long path: CI's temp folder is an 8.3 name (RUNNER~1), and git reports the long one.
const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-flaky-outside-')));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const git = (...args) => execFileSync('git', ['-C', root, ...args], { windowsHide: true, stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'crab@example.com');
git('config', 'user.name', 'Crab');
fs.writeFileSync(path.join(root, 'a.test.js'), 'test("b", () => {});\n');
git('add', '.');
git('commit', '-q', '-m', 'start');

const jest = fs.readFileSync(path.join(__dirname, 'fixtures', 'flaky', 'jest.txt'), 'utf8');
const TEST_ID = 'src/auth.spec.js › auth › signs in';

// Just enough of main's `shared` for the detective.
function fakeMain() {
  const data = { flaky: null, flakyTests: true, weekly: null, xp: null };
  const events = [];
  const errors = [];
  const d = {
    CAPTURE: false, SNAPSHOT_WAIT_MS: 10000,
    config: { get: k => data[k], set: patch => Object.assign(data, patch) },
    log: { info() {}, warn() {}, error: (...a) => errors.push(a) },
    send() {}, sayText: () => false,
    workflows: { event: (type, payload) => events.push({ type, payload }) },
  };
  return { d, data, events, errors };
}

const ev = (hook_event_name, extra) => ({ hook_event_name, session_id: 'abc-123', cwd: root, ...extra });
const tool = { tool_name: 'Bash', tool_input: { command: 'npm test' } };

/** One test command outside Shellby, start to finish, as the hooks report it. */
async function run(p, id, finish) {
  const [start] = testRunsOf(ev('PreToolUse', { ...tool, tool_use_id: id }));
  p.outsideTestStart(start);
  const [done] = testRunsOf(ev(finish.name, { ...tool, tool_use_id: id, ...finish.extra }));
  await p.outsideTestRun(done);
}

const fail = { name: 'PostToolUseFailure', extra: { error: jest } };
const pass = { name: 'PostToolUse', extra: { tool_response: { stdout: 'Tests:       6 passed, 6 total', stderr: '' } } };

test('a fail and then a pass on the same code outside Shellby is a flake, and starts the workflows', async () => {
  const { d, data, events, errors } = fakeMain();
  const p = wireProgress(d);
  await run(p, 'tu_1', fail);
  await run(p, 'tu_2', pass);
  assert.deepEqual(errors, []);
  const rows = flaky.flakyView(data.flaky, Date.now());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, TEST_ID);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'flaky');
  assert.equal(events[0].payload.test, TEST_ID);
  assert.equal(events[0].payload.folder, root);
  assert.equal(events[0].payload.week, 1);
  assert.equal(JSON.stringify(data.flaky).includes('npm test'), false, 'the command never reaches the ledger');
});

test('an edit between the two runs means the pass proves nothing', async () => {
  const { d, data, events, errors } = fakeMain();
  const p = wireProgress(d);
  await run(p, 'tu_1', fail);
  fs.writeFileSync(path.join(root, 'a.test.js'), 'test("b", () => { expect(1).toBe(1); });\n');
  await run(p, 'tu_2', pass);
  assert.deepEqual(errors, []);
  assert.deepEqual(flaky.flakyView(data.flaky, Date.now()), []);
  assert.deepEqual(events, []);
});

test('a run whose start was never seen, or with the detective off, records nothing', async () => {
  const { d, data, events } = fakeMain();
  const p = wireProgress(d);
  const [done] = testRunsOf(ev('PostToolUseFailure', { ...tool, tool_use_id: 'tu_9', error: jest }));
  await p.outsideTestRun(done);
  assert.equal(data.flaky, null);
  data.flakyTests = false;
  await run(p, 'tu_1', fail);
  await run(p, 'tu_2', pass);
  assert.equal(data.flaky, null);
  assert.deepEqual(events, []);
});
