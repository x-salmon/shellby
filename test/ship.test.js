// Ship it (src/main/ship.js): a copy, from finished work to a pull request.
// The order of the steps and where each one stops, with stand-ins for the
// checks, git and GitHub; the pull request's words from the work itself.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shipCopy, prTitle, prBody, checksLine, parseNumstat } = require('../src/main/ship');

const W = { path: 'C:\\copies\\crab', root: 'C:\\code\\crab', branch: 'shellby/fix-login-abc123', base: 'main' };
const PASS = { status: 'pass', commands: [{ cmd: 'npm run test', ok: true, durationMs: 12000, failed: [] }] };

// Every step recorded, each answer overridable.
function deps(over = {}) {
  const calls = [];
  const rec = (name, value) => (...args) => { calls.push([name, ...args]); return typeof value === 'function' ? value(...args) : value; };
  const d = {
    worktreeOf: rec('worktreeOf', W),
    isBusy: rec('isBusy', false),
    canPr: rec('canPr', { ok: true }),
    status: rec('status', Promise.resolve({ ok: true, ahead: 1, uncommitted: 2 })),
    gate: rec('gate', Promise.resolve({ ok: true, verdict: PASS })),
    commit: rec('commit', Promise.resolve({ ok: true })),
    git: rec('git', (_cwd, args) => Promise.resolve(args.includes('log')
      ? { ok: true, out: 'Fix the flaky login test\nAdd a retry helper\n' }
      : { ok: true, out: '12\t3\tsrc/auth.js\n-\t-\tlogo.png\n' })),
    openPr: rec('openPr', req => Promise.resolve({ ok: true, url: 'https://github.com/me/crab/pull/7', number: 7, repo: 'me/crab', base: req.base, branch: W.branch, draft: req.draft })),
    title: rec('title', 'Fix the flaky login test'),
    reply: rec('reply', 'Fixed it: the test raced the session store. @alice may want to look.'),
    note: rec('note', undefined),
    ...over,
  };
  return { d, calls, names: () => calls.map(c => c[0]) };
}

test('ships in order: checks, commit, pull request, then a note in the conversation', async () => {
  const { d, calls, names } = deps();
  const r = await shipCopy('t1', {}, d);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.green, true);
  const order = names().filter(n => ['status', 'gate', 'commit', 'openPr', 'note'].includes(n));
  assert.deepEqual(order, ['status', 'gate', 'commit', 'openPr', 'note']);
  assert.deepEqual(calls.find(c => c[0] === 'gate').slice(1), ['t1', W, { check: true, force: false }], 'the checks always run for Ship it');
  const req = calls.find(c => c[0] === 'openPr')[1];
  assert.equal(req.folder, W.path);
  assert.equal(req.base, 'main', 'against the branch the copy came from');
  assert.equal(req.draft, false);
  assert.equal(req.title, 'Fix the flaky login test');
  assert.match(req.body, /## Summary\n\nFixed it/);
  assert.match(req.body, /@\u200dalice/, 'nobody is pinged');
  assert.match(req.body, /- `Fix the flaky login test`\n- `Add a retry helper`/);
  assert.match(req.body, /- `src\/auth.js` \+12 −3\n- `logo.png` binary/);
  assert.match(req.body, /✅ Checks passed: `npm run test` passed \(12s\)\./);
  const note = calls.find(c => c[0] === 'note');
  assert.deepEqual(note.slice(1), ['t1', { kind: 'shipped', url: 'https://github.com/me/crab/pull/7', number: 7, repo: 'me/crab', base: 'main', draft: false, existing: false, green: true }]);
});

test('a secret in Claude\'s reply never reaches the pull request', async () => {
  const token = `ghp_${'a1B2'.repeat(9)}`;
  const { d, calls } = deps({ reply: () => `Done.\nI used ${token} to test it.\nAll green.` });
  await shipCopy('t1', {}, d);
  const { body } = calls.find(c => c[0] === 'openPr')[1];
  assert.ok(!body.includes(token));
  assert.match(body, /Done\.\n\(a line left out: it looked like a GitHub token\)\nAll green\./);
});

test('a draft is asked for when you say so', async () => {
  const { d, calls } = deps();
  await shipCopy('t1', { draft: true }, d);
  assert.equal(calls.find(c => c[0] === 'openPr')[1].draft, true);
});

test('red checks stop it before anything is committed or pushed, with the fix to offer', async () => {
  const red = { ok: false, red: true, checks: { status: 'fail', names: ['login works'], count: 1 }, fix: 'Fix the login test' };
  const { d, names } = deps({ gate: () => Promise.resolve(red) });
  const r = await shipCopy('t1', {}, d);
  assert.equal(r.ok, false);
  assert.equal(r.red, true);
  assert.equal(r.fix, 'Fix the login test');
  assert.equal(r.error, '1 test failing on this branch, so nothing was pushed.');
  assert.ok(!names().includes('commit') && !names().includes('openPr') && !names().includes('note'));
});

test('"Ship it anyway" goes past red checks and says so in the pull request', async () => {
  const { d, calls } = deps({ gate: (_t, _w, o) => Promise.resolve(o.force ? { ok: true } : { ok: false, red: true }) });
  const r = await shipCopy('t1', { force: true }, d);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.green, false);
  assert.match(calls.find(c => c[0] === 'openPr')[1].body, /⚠️ Shipped anyway, past checks that failed\./);
});

test('stops early when there is nothing to ship, he is busy, or GitHub is not set up', async () => {
  let x = deps({ worktreeOf: () => null });
  assert.match((await shipCopy('t1', {}, x.d)).error, /copy of its own/);
  x = deps({ isBusy: () => true });
  assert.equal((await shipCopy('t1', {}, x.d)).error, 'Let him finish first.');
  x = deps({ canPr: () => ({ ok: false, error: 'Sign in with GitHub first.' }) });
  assert.equal((await shipCopy('t1', {}, x.d)).error, 'Sign in with GitHub first.');
  x = deps({ status: () => Promise.resolve({ ok: true, ahead: 0, uncommitted: 0 }) });
  const r = await shipCopy('t1', {}, x.d);
  assert.equal(r.nothing, true);
  assert.ok(!x.names().includes('gate'), 'no tests run for nothing');
});

test('he started on something while the tests ran: nothing is pushed', async () => {
  let busy = false;
  const { d, names } = deps({
    isBusy: () => busy,
    gate: () => { busy = true; return Promise.resolve({ ok: true, verdict: PASS }); },
  });
  const r = await shipCopy('t1', {}, d);
  assert.equal(r.ok, false);
  assert.match(r.error, /started on something new/);
  assert.ok(!names().includes('commit'));
});

test('a failed commit or pull request comes back as it is, with no note', async () => {
  let x = deps({ commit: () => Promise.resolve({ ok: false, error: "Couldn't commit." }) });
  assert.equal((await shipCopy('t1', {}, x.d)).error, "Couldn't commit.");
  x = deps({ openPr: () => Promise.resolve({ ok: false, cancelled: true, secrets: 1, error: 'Not pushed: it had something that looks like a secret.' }) });
  const r = await shipCopy('t1', {}, x.d);
  assert.equal(r.cancelled, true);
  assert.ok(!x.names().includes('note'));
});

test('prTitle: the conversation\'s name, else the only commit, else the branch', () => {
  assert.equal(prTitle('  Fix   the login ', [], 'b'), 'Fix the login');
  assert.equal(prTitle('Untitled', ['Add dark mode'], 'b'), 'Add dark mode');
  assert.equal(prTitle('', ['one', 'two'], 'shellby/x-abc123'), 'Work from shellby/x-abc123');
  assert.equal(prTitle('Ask @bob', [], 'b'), 'Ask @\u200dbob');
  assert.equal(prTitle('x'.repeat(300), [], 'b').length, 120);
});

test('prBody: long lists are cut short, and code can\'t break out of its quotes', () => {
  const commits = Array.from({ length: 25 }, (_, i) => `commit ${i}`);
  const files = Array.from({ length: 35 }, (_, i) => ({ path: `f${i}.js`, added: 1, removed: 0 }));
  const body = prBody({ summary: '', commits, files, verdict: null });
  assert.match(body, /- …and 5 more\n/);
  assert.match(body, /- …and 5 more files/);
  assert.doesNotMatch(body, /## Summary/);
  assert.match(body, /No checks ran/);
  assert.match(prBody({ commits: ['use `rm -rf`'], files: [] }), /- `use 'rm -rf'`/);
});

test('checksLine: a pass, a red run shipped anyway, and a run that could not start', () => {
  assert.match(checksLine(PASS), /^✅/);
  const red = { status: 'fail', commands: [{ cmd: 'npm run test', ok: false, durationMs: 3000, failed: ['a', 'b'] }] };
  assert.equal(checksLine(red), '❌ 2 tests failing, shipped anyway: `npm run test` failed (3s).');
  const env = { status: 'error', commands: [{ cmd: 'python -m pytest -q', ok: false, needsEnv: true, error: 'no pytest', durationMs: 100 }] };
  assert.match(checksLine(env), /^⚠️ The checks couldn't run on this PC/);
});

test('parseNumstat reads counts, binary files and paths with tabs', () => {
  assert.deepEqual(parseNumstat('1\t2\ta.js\n-\t-\timg.png\n3\t0\tdir/with\ttab.txt\n'), [
    { path: 'a.js', added: 1, removed: 2 },
    { path: 'img.png', added: null, removed: null },
    { path: 'dir/with\ttab.txt', added: 3, removed: 0 },
  ]);
});
