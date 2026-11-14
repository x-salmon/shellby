const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const { wireBugdex } = require('../src/main/wiring/bugdex');

// Just enough of main's `shared` for the Bugdex's hooks, with a book that has never been saved.
function fakeMain(config = {}) {
  const data = { bugdex: null, xp: null, catchBugs: true, ...config };
  const errors = [];
  const sent = [];
  const d = {
    CAPTURE: false, SNAPSHOT_WAIT_MS: 2000,
    config: { get: k => data[k], set: patch => Object.assign(data, patch) },
    log: { info() {}, warn() {}, error: (...a) => errors.push(a) },
    send: (_w, channel, payload) => sent.push({ channel, payload }),
    panel: { isVisible: () => false, isFocused: () => false },
    stickerState: () => ({ projects: {} }),
    devServers: { view: () => ({ servers: [] }), fixDraft: () => null },
    projects: { localRepos: async () => [] },
    manager: { tabs: new Map() },
  };
  return { d, data, errors, sent };
}

test('every hook copes with a book that has never been saved', async () => {
  const { d, errors } = fakeMain();
  const b = wireBugdex(d);
  const dir = os.tmpdir();
  await b.ciFixed({ key: 'x/y#1' });
  await b.ciFailed({ key: 'x/y#1', repo: 'x/y', failing: ['test'] });
  await b.pushedClean(dir);
  await b.homeResult('t1', { root: dir, branch: 'b' }, { ok: true, merged: true });
  await b.serverCrashed({ id: 's1', root: dir });
  b.serverUp({ id: 's1', root: dir });
  b.turnEnded('t1', { ok: true });
  await b.wrote('t1');
  b.secretIgnored(dir);
  assert.equal(b.commandStart({ command: 'npm test', dir }), null);
  assert.deepEqual(errors, []);
  assert.equal(b.view().caught, 0);
});

test('a hook that fails is logged, never thrown at main', async () => {
  const { d, errors } = fakeMain();
  d.devServers.view = () => { throw new Error('boom'); };
  const b = wireBugdex(d);
  assert.doesNotThrow(() => b.turnEnded('t1', { ok: true }));
  assert.equal(errors.length, 1);
});

test('switched off, or in just-the-crab mode, nothing is noted', async () => {
  for (const config of [{ catchBugs: false }, { crabOnly: true }]) {
    const { d, data } = fakeMain(config);
    const b = wireBugdex(d);
    await b.flakySeen({ id: 'a1b2c3d4e5f6', name: 'p' }, 'auth › signs in');
    b.auditPatched({ id: 'a1b2c3d4e5f6', name: 'p' });
    assert.equal(data.bugdex, null);
  }
});

test('a patched audit catches the Barnacled Anchor; a flaky fix the Phantom, or a Heisenbug with history', () => {
  const { d, data, sent } = fakeMain();
  Object.assign(d, { stat() {}, noteWeek() {}, awardXp() {}, notify() {}, life: { presentJar() {} }, critter: {}, outfit: () => ({ confetti: null }), noteRecap() {} });
  const b = wireBugdex(d);
  const p = { id: 'a1b2c3d4e5f6', name: 'proj' };
  b.auditPatched(p);
  b.flakyFixed(p, 'auth › signs in', [Date.now()]);
  const DAY = 24 * 3600 * 1000;
  b.flakyFixed(p, 'cart › totals', [0, 1, 2, 3, 4].map(i => Date.now() - i * DAY));
  const caught = Object.keys(data.bugdex.species).filter(id => data.bugdex.species[id].byDevice.local > 0).sort();
  assert.deepEqual(caught, ['barnacled-anchor', 'flaky-phantom', 'heisenbug']);
  assert.ok(sent.some(m => m.channel === 'bugdex:caught'));
});

test('his favourite catch follows him as its Bugdex portrait, the art the book shows', () => {
  const { d, sent } = fakeMain();
  Object.assign(d, { stat() {}, noteWeek() {}, awardXp() {}, notify() {}, life: { presentJar() {} }, critter: {}, outfit: () => ({ confetti: null }), noteRecap() {} });
  const b = wireBugdex(d);
  b.auditPatched({ id: 'a1b2c3d4e5f6', name: 'proj' });
  b.sendBuddy();
  const buddy = sent.filter(m => m.channel === 'critter:buddy').pop().payload;
  const sp = require('../src/main/bugdex/species').speciesById(buddy.id);
  assert.ok(sp.portrait, 'pick a catch that has a portrait, or this proves nothing');
  assert.deepEqual(buddy.pixels, require('../src/main/bugdex').artFor(sp, null).pixels);
  assert.ok(buddy.pixels.length > sp.pixels.length);
});

test('red builds are told apart by the checks that failed', () => {
  const { d } = fakeMain();
  const b = wireBugdex(d);
  assert.equal(b.ciSpecies({ failing: ['build', 'test', 'lint'] }), 'the-kraken');
  assert.equal(b.ciSpecies({ failing: ['test (windows-latest)'] }), 'matrix-hydra');
  assert.equal(b.ciSpecies({ failing: ['Deploy to Vercel'] }), 'sunken-deploy');
  assert.equal(b.ciSpecies({ failing: ['eslint'] }), 'lint-louse');
  assert.equal(b.ciSpecies({ failing: ['tsc'] }), 'type-tangle');
  assert.equal(b.ciSpecies({ failing: ['test'] }), 'red-tide');
});

test('starting over leaves a reset marker for sync, not nothing', async () => {
  const { d, data } = fakeMain();
  d.askOnce = async () => 0;
  const b = wireBugdex(d);
  assert.deepEqual(await b.forget(), { ok: true });
  assert.ok(data.bugdex.resetAt > 0);
});

test('a red build is a battle: reads and edits wear it down, a helper joins, and the fix knocks it out', async () => {
  const root = require('path').resolve(__dirname, '..'); // a real repo, for projectOf
  const { d, sent } = fakeMain();
  const beats = [];
  Object.assign(d, {
    stat() {}, noteWeek() {}, awardXp() {}, notify() {}, life: { presentJar() {} }, critter: {}, outfit: () => ({ confetti: null }), noteRecap() {},
    projects: { localRepos: async () => [{ root, remote: 'x/y' }] },
    manager: { tabs: new Map([['t1', { session: { cwd: root } }]]) },
    crewRoster: { member: type => ({ type, name: 'Pinchy', hue: 145, level: 3, specialty: 'ci' }), beat: (types, bugType) => beats.push({ types, bugType }) },
  });
  const b = wireBugdex(d);
  const pr = { key: 'x/y#7', repo: 'x/y', failing: ['test'] };
  await b.ciFailed(pr);
  let [fight] = b.battles();
  assert.equal(fight.species, 'red-tide');
  assert.equal(fight.hp, fight.max);
  assert.equal(fight.moves[0].line, 'A wild Red Tide appeared!');
  await b.tool('t1', { kind: 'tool', name: 'Read' });
  await b.tool('t1', { kind: 'tool', name: 'Edit', filePath: `${root}/x.js` });
  await b.tool('t1', { kind: 'tool', name: 'Read', sub: true, parent: 'p1' }); // a helper's own read: not a move
  await b.assist('t1', 'Explore');
  [fight] = b.battles();
  assert.deepEqual(fight.moves.map(m => m.move), ['appear', 'scout', 'patch', 'assist']);
  assert.equal(fight.moves[3].fx, 'super'); // its specialty is CI
  assert.ok(fight.hp < fight.max && fight.hp > 0);
  assert.deepEqual(fight.party.map(p => p.name), ['Pinchy']);
  b.ciEngaged(pr.key);
  await b.ciFixed(pr);
  [fight] = b.battles();
  assert.equal(fight.over, 'caught');
  assert.deepEqual(fight.moves.slice(-2).map(m => m.fx), ['ko', 'caught']);
  assert.deepEqual(beats, [{ types: ['Explore'], bugType: 'ci' }]);
  assert.ok(sent.some(m => m.channel === 'bugdex:caught' && m.payload.battle));
});

test('a bug spotted in one conversation is that conversation\'s fight: another one\'s reads and edits miss it', async () => {
  const root = require('path').resolve(__dirname, '..');
  const { d, data } = fakeMain();
  Object.assign(d, {
    projects: { localRepos: async () => [{ root, remote: 'x/y' }] },
    manager: { tabs: new Map([['t1', { session: { cwd: root } }], ['t2', { session: { cwd: root } }]]) },
  });
  const b = wireBugdex(d);
  await b.ciFailed({ key: 'x/y#8', repo: 'x/y', failing: ['test'] });
  data.bugdex.open[0].tabId = 't1'; // as a failed command in t1 leaves it
  await b.tool('t2', { kind: 'tool', name: 'Edit', filePath: `${root}/x.js` });
  let [fight] = b.battles();
  assert.deepEqual(fight.moves.map(m => m.move), ['appear']);
  await b.tool('t1', { kind: 'tool', name: 'Edit', filePath: `${root}/x.js` });
  [fight] = b.battles();
  assert.deepEqual(fight.moves.map(m => m.move), ['appear', 'patch']);
});

// ---- a failed command, then a passing one: the catch itself, in a throwaway repo

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** A git repo with one commit, at its long path (CI's temp dir is an 8.3 short name). */
function tempRepo() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-bugdex-')));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'crab@example.com');
  git('config', 'user.name', 'Crab');
  git('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'cart.js'), 'module.exports = (a, b) => a - b;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

const NODE_RED = 'not ok 1 - totals\nℹ tests 5\nℹ pass 4\nℹ fail 1\n';
const NODE_GREEN = 'ok 1 - totals\nℹ tests 9\nℹ pass 9\nℹ fail 0\n';

function catchingMain() {
  const m = fakeMain();
  Object.assign(m.d, { stat() {}, noteWeek() {}, awardXp() {}, notify() {}, life: { presentJar() {} }, critter: {}, outfit: () => ({ confetti: null }), noteRecap() {} });
  return m;
}

/** One command in tab t1, as sessions.js runs it: the start (and its snapshot), then the result. */
async function run(b, dir, command, text, isError) {
  const bugTree = b.commandStart({ command, dir });
  await b.commandResult({ command, dir, tabId: 't1', bugTree }, { text, isError });
}

const caughtIds = data => Object.keys(data.bugdex?.species || {}).filter(id => data.bugdex.species[id].byDevice?.local > 0);

test('a narrow test run failing is caught by the whole suite passing on fixed code', async () => {
  const dir = tempRepo();
  try {
    const { d, data, errors } = catchingMain();
    const b = wireBugdex(d);
    await run(b, dir, 'node --test test/cart.test.js', NODE_RED, true);
    assert.equal(data.bugdex.open.length, 1);
    assert.equal(data.bugdex.open[0].narrow, true);
    fs.writeFileSync(path.join(dir, 'src', 'cart.js'), 'module.exports = (a, b) => a + b;\n');
    await run(b, dir, 'npm test', NODE_GREEN, false);
    assert.deepEqual(caughtIds(data), ['red-snapper']);
    assert.equal(data.bugdex.open.length, 0);
    assert.deepEqual(errors, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a whole suite failing is never caught by a narrower run passing', async () => {
  const dir = tempRepo();
  try {
    const { d, data } = catchingMain();
    const b = wireBugdex(d);
    await run(b, dir, 'npm test', NODE_RED, true);
    assert.equal(data.bugdex.open[0].narrow, false);
    fs.writeFileSync(path.join(dir, 'src', 'cart.js'), 'module.exports = (a, b) => a + b;\n');
    await run(b, dir, 'node --test test/cart.test.js', NODE_GREEN, false);
    assert.deepEqual(caughtIds(data), []);
    assert.equal(data.bugdex.open.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a script failing is caught by the same script passing with other arguments', async () => {
  const dir = tempRepo();
  try {
    const { d, data } = catchingMain();
    const b = wireBugdex(d);
    await run(b, dir, 'node src/cart.js --fresh', "TypeError: Cannot read properties of undefined (reading 'total')\n    at src/cart.js:1:20\n", true);
    assert.equal(data.bugdex.open[0].species, 'nullfish');
    fs.writeFileSync(path.join(dir, 'src', 'cart.js'), 'module.exports = (a = 0, b = 0) => a + b;\n');
    await run(b, dir, 'node src/cart.js', 'ok\n', false);
    assert.deepEqual(caughtIds(data), ['nullfish']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scratch code failing is never spotted', async () => {
  const dir = tempRepo();
  try {
    const { d, data } = catchingMain();
    const b = wireBugdex(d);
    await run(b, dir, 'node -e "require(\'./nope\')"', "Error: Cannot find module './nope'\n", true);
    await run(b, dir, 'python -c "import nope"', "ModuleNotFoundError: No module named 'nope'\n", true);
    assert.equal(data.bugdex?.open?.length || 0, 0);
    assert.deepEqual(Object.keys(data.bugdex?.species || {}), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the same code passing lets the bug go instead of leaving it on the loose', async () => {
  const dir = tempRepo();
  try {
    const { d, data } = catchingMain();
    const b = wireBugdex(d);
    await run(b, dir, 'npm test', NODE_RED, true);
    assert.equal(data.bugdex.open.length, 1);
    await run(b, dir, 'npm test', NODE_GREEN, false);
    assert.deepEqual(caughtIds(data), [], 'a pass on unchanged code is never a catch');
    assert.equal(data.bugdex.open.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('closing a conversation lets the bugs it spotted go, and only those', async () => {
  const { d, data } = fakeMain();
  const b = wireBugdex(d);
  const enc = (fp, tabId, source = 'bash') => ({ species: 'nullfish', fp, project: 'a1b2c3d4e5f6', name: 'p', source, keys: [], kind: 'run', tabId, at: Date.now(), firstAt: Date.now() });
  data.bugdex = { open: [enc('111111111111', 't1'), enc('222222222222', 't2'), enc('333333333333', 't1', 'home')] };
  b.tabClosed('t1');
  assert.deepEqual(data.bugdex.open.map(e => e.fp), ['222222222222', '333333333333']);
});
