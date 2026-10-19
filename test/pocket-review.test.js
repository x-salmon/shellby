// Shellby on your phone, looking back (pocket/review.js): search across
// History, a project's conversations, a closed one read-only, what happened
// while the phone was away, a conversation's checks with Fix it as a reply,
// and a copy's whole branch against where it started.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPocketReview, gistOf, sinceThen, fixText, phoneEntry } = require('../src/main/pocket/review');

const PROJECT = 'C:\\code\\shellby';
const OTHER = 'C:\\code\\other';
const DAY = 864e5;
const NOW = Date.UTC(2026, 9, 19, 12);

// A History stand-in: an index and a transcript per id, written to disk like the real one.
function fakeHistory(entries, transcripts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-review-'));
  for (const [id, items] of Object.entries(transcripts)) fs.writeFileSync(path.join(dir, `${id}.jsonl`), items.map(i => JSON.stringify(i)).join('\n') + '\n');
  return {
    list: () => entries,
    get: id => entries.find(e => e.id === id) || null,
    load: id => (transcripts[id] || []),
    file: id => path.join(dir, `${id}.jsonl`),
    flush() {},
  };
}

function reviewFor({ entries = [], transcripts = {}, tabs = [], prompts = [], over = {} } = {}) {
  const rec = [];
  const manager = { tabs: new Map(tabs.map(t => [t.id, t])), isBusy: id => !!manager.tabs.get(id)?.session?.busy };
  const d = { manager, history: fakeHistory(entries, transcripts), worktreeHome: () => path.join(os.tmpdir(), 'nowhere'), ...over };
  const x = createPocketReview(d, {
    projects: () => [{ key: PROJECT, name: 'shellby' }, { key: OTHER, name: 'other' }],
    prompts: () => prompts,
    reply: body => { rec.push(['reply', body]); return { ok: true, turnId: 'u1' }; },
    maxText: 4000,
    now: () => NOW,
  });
  return { x, rec, d };
}

const entry = (id, over = {}) => ({ id, title: `Task ${id}`, cwd: PROJECT, createdAt: NOW - DAY, updatedAt: NOW - DAY, ...over });
const tab = (id, over = {}) => ({ id, title: `Tab ${id}`, inTerminal: false, session: { busy: false, pending: new Map() }, ...over });

test('the gist of a transcript is your first prompt and Claude’s last word', () => {
  const docs = gistOf([
    JSON.stringify({ kind: 'user', text: 'Fix the upload test' }), 'not json', JSON.stringify({ kind: 'text', text: 'Looking.' }),
    JSON.stringify({ kind: 'text', text: 'helper words', sub: true }), JSON.stringify({ kind: 'text', text: 'Done: the retry was off by one.' }),
  ].join('\n'));
  assert.deepEqual(docs.map(d => [d.at, d.kind]), [[0, 'user'], [3, 'text']]);
  assert.equal(docs[1].text, 'Done: the retry was off by one.');
});

test('search finds a conversation by title, first prompt or summary, paged, and says whether it is open', async () => {
  const entries = [entry('a', { title: 'Upload retries' }), entry('b', { title: 'Something else' }), entry('c', { title: 'Third' })];
  const transcripts = {
    a: [{ kind: 'user', text: 'fix the upload test' }, { kind: 'text', text: 'Fixed the retry.' }],
    b: [{ kind: 'user', text: 'tidy the menu' }, { kind: 'text', text: 'The upload button moved too.' }],
    c: [{ kind: 'user', text: 'unrelated' }],
  };
  const { x } = reviewFor({ entries, transcripts, tabs: [tab('b')] });
  assert.equal((await x.actions.find({ query: ' ' })).ok, false);
  const r = await x.actions.find({ query: 'upload' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.results.map(e => e.id), ['a', 'b']);
  assert.equal(r.results[0].open, false);
  assert.equal(r.results[1].open, true);
  assert.match(r.results[1].snippet, /upload button/);
  assert.equal(r.results[1].said, 'claude');
  assert.ok(!JSON.stringify(r).includes('C:\\code'));
  assert.equal(r.more, false);
  assert.deepEqual((await x.actions.find({ query: 'upload', page: 1 })).results, []);
});

test('a project’s history is its own conversations, newest first, a page at a time, never a path', () => {
  const entries = [
    entry('old', { updatedAt: NOW - 3 * DAY }), entry('new', { updatedAt: NOW - 1000 }),
    entry('copy', { cwd: 'C:\\Users\\me\\AppData\\Roaming\\Shellby\\worktrees\\abc\\shellby', worktree: { originalCwd: PROJECT, branch: 'shellby/x-abc123' }, updatedAt: NOW - DAY }),
    entry('elsewhere', { cwd: OTHER, updatedAt: NOW }),
  ];
  const { x } = reviewFor({ entries, tabs: [tab('new')] });
  const r = x.actions.history({ project: PROJECT });
  assert.deepEqual(r.entries.map(e => e.id), ['new', 'copy', 'old']);
  assert.equal(r.entries[0].open, true);
  assert.equal(r.entries[1].copy, true);
  assert.equal(r.entries[1].folder, 'shellby');
  assert.ok(!JSON.stringify(r).includes('AppData'));
  assert.deepEqual(x.actions.history({}).entries.map(e => e.id), ['elsewhere', 'new', 'copy', 'old']);
  assert.equal(x.actions.history({ project: 'C:\\nope' }).ok, false);
  const many = Array.from({ length: 35 }, (_, i) => entry(`e${i}`, { updatedAt: NOW - i }));
  const paged = reviewFor({ entries: many }).x.actions.history({ project: PROJECT });
  assert.equal(paged.entries.length, 30);
  assert.equal(paged.more, true);
  assert.equal(reviewFor({ entries: many }).x.actions.history({ project: PROJECT, page: 1 }).entries.length, 5);
});

test('a closed conversation comes back read-only as phone items; an open one is sent to its live screen', () => {
  const transcripts = { a: [{ kind: 'user', text: 'hi', turnId: 'u1' }, { kind: 'text', text: 'hello' }, { kind: 'usage', fiveHour: {} }] };
  const { x } = reviewFor({ entries: [entry('a'), entry('b')], transcripts, tabs: [tab('b')] });
  const r = x.actions.past({ id: 'a' });
  assert.deepEqual(r.items.map(i => i.k), ['user', 'text']);
  assert.equal(r.open, false);
  assert.deepEqual(x.actions.past({ id: 'b' }).items, []);
  assert.equal(x.actions.past({ id: 'b' }).open, true);
  assert.equal(x.actions.past({ id: 'zz' }).ok, false);
  assert.equal(x.actions.past({ id: '../x' }).ok, false);
});

test('while you were away: the turns that ended since, what went wrong, what waits, and the window spent', () => {
  const since = NOW - 3600e3;
  const transcripts = {
    done: [{ t: since - 10, kind: 'result', ok: true, cost: { share: 9 } }, { t: since + 10, kind: 'result', ok: true, tokens: 500, cost: { share: 2.5 } }],
    bad: [{ t: since + 20, kind: 'result', ok: false, tokens: 100, cost: { share: 1 } }],
    older: [{ t: since - 20, kind: 'result', ok: true, cost: { share: 50 } }],
  };
  const entries = [entry('done', { updatedAt: since + 10 }), entry('bad', { updatedAt: since + 20 }), entry('older', { updatedAt: since - 20 }), entry('quiet', { updatedAt: NOW })];
  const { x } = reviewFor({ entries, transcripts, tabs: [tab('bad')], prompts: [{ tabId: 'bad', requestId: 'r1' }, { tabId: 'bad', requestId: 'r2' }] });
  const r = x.actions.away({ since });
  assert.equal(r.ok, true);
  assert.deepEqual(r.finished.map(e => e.id), ['done']);
  assert.deepEqual(r.trouble.map(e => [e.id, e.open]), [['bad', true]]);
  assert.deepEqual(r.waiting, [{ tabId: 'bad', title: 'Tab bad' }]);
  assert.equal(r.share, 3.5);
  assert.equal(r.tokens, 600);
  assert.equal(r.turns, 2);
  assert.equal(x.actions.away({ since: 'yesterday' }).ok, false);
  assert.equal(x.actions.away({ since: NOW + 1 }).ok, false);
  // Looks back a week at most.
  assert.equal(x.actions.away({ since: 1 }).since, NOW - 7 * DAY);
  assert.equal(sinceThen([], () => [], 0, 1).turns, 0);
});

const verdict = (status = 'fail') => ({
  kind: 'checks', status, after: 'a1', at: NOW - 60e3, root: PROJECT, tree: 't',
  commands: [
    { cmd: 'npm test', ok: false, failed: ['upload retries'], tail: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') },
    { cmd: 'npm run lint', ok: true, failed: [], tail: 'clean' },
  ],
});

test('checks show as passed, failed or running, a failed command with the tail of its output', () => {
  const t = tab('t1', { checks: { status: 'fail', after: 'a1' } });
  const { x, d } = reviewFor({ entries: [entry('t1')], transcripts: { t1: [verdict()] }, tabs: [t, tab('t2')] });
  const r = x.actions.checks({ tabId: 't1' });
  assert.equal(r.status, 'fail');
  assert.equal(r.canFix, true);
  assert.deepEqual(r.commands.map(c => [c.cmd, c.ok]), [['npm test', false], ['npm run lint', true]]);
  assert.deepEqual(r.commands[0].failed, ['upload retries']);
  assert.equal(r.commands[0].tail.split('\n').length, 20);
  assert.equal(r.commands[1].tail, '');
  // No checks yet: nothing, not an error. A run going now says so.
  assert.deepEqual(x.actions.checks({ tabId: 't2' }), { ok: true, status: null, after: null, at: null, commands: [], canFix: false });
  d.checksRunning = id => (id === 't1' ? { after: 'a2' } : null);
  assert.equal(x.actions.checks({ tabId: 't1' }).status, 'running');
  assert.equal(x.actions.checks({ tabId: 't1' }).canFix, false);
  assert.equal(x.actions.checks({ tabId: 'gone' }).ok, false);
  // This run's own verdict in full wins over the one History kept.
  d.checksRunning = () => null;
  d.lastVerdict = () => verdict('timeout');
  assert.equal(x.actions.checks({ tabId: 't1' }).status, 'timeout');
});

test('Fix it goes through the phone’s reply path, with the failure trimmed to a phone message', () => {
  const t = tab('t1', { worktree: { branch: 'shellby/fix-abc123' } });
  const busy = tab('t2', { session: { busy: true, pending: new Map() } });
  const { x, rec } = reviewFor({ entries: [entry('t1'), entry('t2')], transcripts: { t1: [verdict()], t2: [verdict()] }, tabs: [t, busy, tab('t3')] });
  const r = x.actions['checks-fix']({ tabId: 't1', mode: 'acceptEdits' });
  assert.deepEqual(r, { ok: true, turnId: 'u1' });
  const [[, body]] = rec;
  assert.equal(body.tabId, 't1');
  assert.equal(body.mode, 'acceptEdits');
  assert.match(body.text, /checks failed on shellby\/fix-abc123/);
  assert.match(body.text, /`npm test` failed: upload retries/);
  assert.match(body.text, /line 39/);
  assert.ok(!body.text.includes('npm run lint'));
  assert.ok(body.text.length <= 4000);
  // Busy or not: the reply path decides that; here only what there is to fix.
  assert.equal(x.actions['checks-fix']({ tabId: 't3' }).ok, false);
  assert.equal(x.actions['checks-fix']({ tabId: 'nope' }).ok, false);
  // Passed checks have nothing to fix.
  const green = reviewFor({ entries: [entry('g')], transcripts: { g: [verdict('pass')] }, tabs: [tab('g')] });
  assert.match(green.x.actions['checks-fix']({ tabId: 'g' }).error, /passed/);
  // A huge tail shrinks until it fits.
  const huge = { ...verdict(), commands: [{ cmd: 'npm test', ok: false, failed: [], tail: Array.from({ length: 30 }, () => 'x'.repeat(300)).join('\n') }] };
  assert.ok(fixText(huge, { branch: null, max: 2000 }).length <= 2000);
});

test('a phone entry never carries a path', () => {
  const e = phoneEntry({ id: 'x', title: 'T', cwd: PROJECT, worktree: { originalCwd: PROJECT }, updatedAt: 5, lastOutcome: 'ok', fromPhone: true }, { open: true });
  assert.deepEqual(e, { id: 'x', title: 'T', folder: 'shellby', at: 5, createdAt: null, outcome: 'ok', done: false, open: true, copy: true, fromPhone: true });
});

// ---- the whole branch, in a real repository with a copy of its own

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(os.tmpdir(), 'no-git-config'), GIT_TERMINAL_PROMPT: '0' } }).trim();

function repoWithCopy() {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-branch-')));
  const root = path.join(base, 'repo');
  const home = path.join(base, 'worktrees');
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'crab@example.com');
  git(root, 'config', 'user.name', 'Crab');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'two\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'start');
  const branch = 'shellby/fix-it-abc123';
  const wt = path.join(home, 'abc123', 'repo');
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  git(root, 'worktree', 'add', '-q', '-b', branch, wt, 'HEAD');
  // A commit on the branch, a change left uncommitted, and a new file never added.
  fs.writeFileSync(path.join(wt, 'a.txt'), 'one\nmore\n');
  git(wt, 'commit', '-q', '-am', 'feat: more');
  fs.writeFileSync(path.join(wt, 'b.txt'), 'two\nthree\n');
  fs.writeFileSync(path.join(wt, 'c.txt'), 'new\n');
  // The base moves on too: that commit is not the branch's to bring home.
  fs.writeFileSync(path.join(root, 'd.txt'), 'base\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base moved');
  return { root, home, w: { path: wt, cwd: wt, branch, base: 'main', root, originalCwd: root, named: true } };
}

test('See everything: the copy’s branch against where it started, uncommitted work and all, file by file', async () => {
  let repo;
  try { repo = repoWithCopy(); } catch (err) { test.skip(`git is not here: ${err.message}`); return; }
  const t = tab('t1', { worktree: repo.w });
  const { x, d } = reviewFor({ entries: [entry('t1')], tabs: [t, tab('t2')] });
  d.worktreeHome = () => repo.home;
  const r = await x.actions.branch({ tabId: 't1' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.branch, 'shellby/fix-it-abc123');
  assert.equal(r.base, 'main');
  assert.deepEqual(r.files.map(f => f.path).sort(), ['a.txt', 'b.txt', 'c.txt']);
  assert.equal(r.added, 3);
  assert.equal(r.removed, 0);
  // Three files: the whole patch comes at once, and the base's own later commit isn't in it.
  assert.match(r.patch, /\+more/);
  assert.match(r.patch, /\+three/);
  assert.match(r.patch, /\+new/);
  assert.ok(!r.patch.includes('d.txt'));
  assert.equal(r.truncated, false);
  // One file at a time, and only files on the branch.
  const one = await x.actions.branch({ tabId: 't1', file: 'b.txt' });
  assert.match(one.patch, /\+three/);
  assert.ok(!one.patch.includes('more'));
  assert.equal((await x.actions.branch({ tabId: 't1', file: 'd.txt' })).ok, false);
  assert.equal((await x.actions.branch({ tabId: 't1', file: '../x' })).ok, false);
  // No copy, or a copy outside Shellby's own folder: no.
  assert.match((await x.actions.branch({ tabId: 't2' })).error, /no copy/);
  d.worktreeHome = () => path.join(repo.home, 'elsewhere');
  assert.match((await x.actions.branch({ tabId: 't1' })).error, /no copy/);
});
