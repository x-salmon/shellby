// copy-service.js: what a diff block from the renderer may point git at, and
// which tabs get the "make a copy first" hook.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { createCopies, NAME_THE_BRANCH } = require('../src/main/worktrees/copy-service');

const ROOT = os.tmpdir(); // a folder that exists
const GONE = path.join(os.tmpdir(), 'shellby-copy-that-was-tidied-away');

function setup({ items = [], entry = null, data = { worktrees: true } } = {}) {
  const d = {
    config: { get: k => data[k] },
    manager: null,
    history: { load: () => items, get: () => entry },
    remote: null,
    CAPTURE: false,
    log: { info: () => {} },
    isStr: s => typeof s === 'string' && s.length > 0,
    worktreeHome: () => path.join(os.tmpdir(), 'shellby-worktrees'),
    claudeConfigDir: () => path.join(os.tmpdir(), '.claude'),
    routineTabs: new Map(), queueTabs: new Map(), queueWaits: new Map(), turnStarts: new Map(),
  };
  return createCopies(d);
}

const change = { kind: 'changes', root: ROOT, before: 'a1', after: 'b2', files: [{ path: 'src/x.js', status: 'M' }] };

test('a diff the tab reported is passed through', () => {
  const copies = setup({ items: [change] });

  const ref = copies.changeRef({ tabId: 't1', root: ROOT, before: 'a1', after: 'b2', file: 'src/x.js' });

  assert.deepEqual(ref, { tabId: 't1', root: ROOT, before: 'a1', after: 'b2', file: 'src/x.js', status: 'M' });
});

test('a diff the tab never reported, or a file outside it, is refused', () => {
  const copies = setup({ items: [change] });

  assert.equal(copies.changeRef({ tabId: 't1', root: ROOT, before: 'a1', after: 'zz' }), null);
  assert.equal(copies.changeRef({ tabId: 't1', root: ROOT, before: 'a1', after: 'b2', file: '../secrets' }), null);
  assert.equal(copies.changeRef({ root: ROOT, before: 'a1', after: 'b2' }), null);
});

test('a diff from a copy that has since gone reads from the repo it came from', () => {
  const copies = setup({
    items: [{ ...change, root: GONE }],
    entry: { copies: [{ path: GONE, root: ROOT }] },
  });

  const ref = copies.changeRef({ tabId: 't1', root: GONE, before: 'a1', after: 'b2' });

  assert.equal(ref.root, ROOT);
  assert.equal(ref.retired, true);
});

test('routine and workflow tabs, and tabs that opted out, get no copy hook', async () => {
  const copies = setup();
  for (const extra of [{ routineId: 'r1' }, { workflowRunId: 'w1' }, { noCopy: true }]) {
    const tab = { id: 't1', session: { cwd: ROOT, beforeWork: () => ({}) }, ...extra };

    await copies.armCopy(tab);

    assert.equal(tab.session.beforeWork, null);
  }
});

test('with copies turned off, no tab gets the hook', async () => {
  const copies = setup({ data: { worktrees: false } });
  const tab = { id: 't1', session: { cwd: ROOT, beforeWork: () => ({}) } };

  await copies.armCopy(tab);

  assert.equal(tab.session.beforeWork, null);
});

test('a tab that will never get a copy is looked at once, not before every turn', async () => {
  const changes = require('../src/main/changes');
  const real = changes.rootOf;
  let asked = 0;
  changes.rootOf = async () => { asked++; return null; }; // not a repo
  try {
    const copies = setup();
    const tab = { id: 't1', saved: false, session: { cwd: ROOT, beforeWork: null } };
    await copies.armCopy(tab);
    await copies.armCopy(tab);
    await copies.armCopy(tab);
    assert.equal(asked, 1, 'git asked once');
    assert.equal(tab.session.beforeWork, null);
  } finally { changes.rootOf = real; }
});

test('the branch-naming request asks for one "Branch:" line', () => {
  assert.match(NAME_THE_BRANCH, /"Branch: <name>"/);
  // The first word is the commit type workMessage reads, so the work comes home typed.
  assert.match(NAME_THE_BRANCH, /first word its kind: feat, fix/);
});

// ---- another agent's conversation (harness/): its copy comes before its first message

const fs = require('fs');
const { execFileSync } = require('child_process');

function repoAndHome() {
  // realpath: CI's temp folder is an 8.3 short name and git reports the long one.
  const repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-cf-repo-')));
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-cf-home-')));
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'first');
  return { repo, home, cleanup: () => { for (const d of [repo, home]) fs.rmSync(d, { recursive: true, force: true }); } };
}

function harnessSetup({ home, data = { worktrees: true } }) {
  const notes = [];
  const tabs = new Map();
  const d = {
    config: { get: k => data[k] },
    manager: { tabs, note: (id, item) => notes.push(item), changed: () => {} },
    history: { load: () => [], get: () => null, update: () => {} },
    CAPTURE: false,
    log: { info: () => {}, warn: () => {} },
    worktreeHome: () => home,
  };
  const tabOf = (session) => { const tab = { id: 'h1', title: 'Gemini task', harness: 'gemini', session }; tabs.set('h1', tab); return tab; };
  return { copies: createCopies(d), notes, tabOf };
}

test("another agent's new conversation in a repository gets its copy before its first message", async t => {
  const { repo, home, cleanup } = repoAndHome();
  t.after(cleanup);
  const { copies, notes, tabOf } = harnessSetup({ home });
  const tab = tabOf({ cwd: repo, sessionId: null });

  await copies.copyFirst(tab);

  assert.ok(tab.worktree, 'it has a copy');
  assert.ok(tab.session.cwd.toLowerCase().startsWith(home.toLowerCase()), `and works in it (${tab.session.cwd})`);
  assert.equal(notes[0].kind, 'moved');
});

test("one whose session began in the checkout, or with copies off, or outside a repository, stays put", async t => {
  const { repo, home, cleanup } = repoAndHome();
  t.after(cleanup);
  const started = harnessSetup({ home });
  const a = started.tabOf({ cwd: repo, sessionId: 'sess-1' });
  await started.copies.copyFirst(a);
  assert.equal(a.session.cwd, repo);
  assert.equal(a.staysPut, true);

  const off = harnessSetup({ home, data: { worktrees: false } });
  const b = off.tabOf({ cwd: repo, sessionId: null });
  await off.copies.copyFirst(b);
  assert.equal(b.session.cwd, repo);

  const plain = harnessSetup({ home });
  const c = plain.tabOf({ cwd: home, sessionId: null });
  await plain.copies.copyFirst(c);
  assert.equal(c.session.cwd, home);
  assert.equal(c.staysPut, true);
});
