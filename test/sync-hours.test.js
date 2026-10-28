const test = require('node:test');
const assert = require('node:assert/strict');
const { GitHubApi } = require('../src/main/github/api');
const { syncNow } = require('../src/main/github/sync');
const hours = require('../src/main/sync/hours');
const tt = require('../src/main/timetrack');
const { TimeTracker } = require('../src/main/timetrack/service');
const { startMockGitHub } = require('./fixtures/mock-github');

class MemConfig {
  constructor(data = {}) { this.data = { ...data }; }
  get(k) { return this.data[k]; }
  set(p) { this.data = { ...this.data, ...p }; return this.data; }
}
const io = c => ({ get: k => c.get(k), set: p => c.set(p) });
const DAY = '2026-10-26';
const WEEK = { from: '2026-10-26', to: '2026-11-01' };
const HOME = 'c:\\users\\me\\code\\shellby';
const WORK = 'd:\\repos\\shellby';
const books = (key, seconds, extra = {}) => ({
  enabled: true, sync: true, projects: { [key]: { name: 'shellby' } }, days: { [DAY]: { [key]: seconds } }, ...extra,
});
const pc = (device, timeTracking) => new MemConfig({ xp: { total: 0, device, byDevice: {} }, timeTracking });
const totalOn = (c, known = []) => tt.summarize(hours.combine(c.get('timeTracking'), c.get('timeElsewhere'), c.get('xp').device, known), WEEK).totals.seconds;
const withGist = async fn => {
  const mock = await startMockGitHub();
  try { await fn(new GitHubApi({ token: mock.state.token, api: mock.base }), mock); } finally { await mock.close(); }
};

test('hours kept on two PCs add up on both, under the project each one knows, and syncing again never counts them twice', () => withGist(async gh => {
  const home = pc('pc-home1', books(HOME, 3600));
  const work = pc('pc-work1', books(WORK, 1800));
  await syncNow(gh, io(home));
  await syncNow(gh, io(work));
  await syncNow(gh, io(home));
  await syncNow(gh, io(work));
  for (const c of [home, work]) assert.equal(totalOn(c), 5400);
  // The other PC's folder counts for this PC's project with the same folder name.
  const s = tt.summarize(hours.combine(home.get('timeTracking'), home.get('timeElsewhere'), 'pc-home1'), WEEK);
  assert.deepEqual(s.projects.map(p => [p.key, p.seconds]), [[HOME, 5400]]);
  // Each PC's own books are still only its own.
  assert.equal(home.get('timeTracking').days[DAY][HOME], 3600);
}));

test('a PC that never switched it on sends no hours and counts none', () => withGist(async gh => {
  const home = pc('pc-home1', books(HOME, 3600));
  const work = pc('pc-work1', books(WORK, 1800, { sync: false }));
  await syncNow(gh, io(home));
  await syncNow(gh, io(work));
  await syncNow(gh, io(home));
  assert.equal(totalOn(home), 3600);
  assert.equal(totalOn(work), 1800);
  assert.deepEqual(Object.keys(hours.clean(home.get('timeElsewhere')).shares), ['pc-home1']);
}));

test('switching it off takes that PC\'s hours off the others at their next sync', () => withGist(async gh => {
  const home = pc('pc-home1', books(HOME, 3600));
  const work = pc('pc-work1', books(WORK, 1800));
  await syncNow(gh, io(home));
  await syncNow(gh, io(work));
  await syncNow(gh, io(home));
  assert.equal(totalOn(home), 5400);
  work.set({ timeTracking: { ...work.get('timeTracking'), sync: false } });
  await syncNow(gh, io(work));
  await syncNow(gh, io(home));
  assert.equal(totalOn(home), 3600);
}));

test('with no new time, this PC\'s share keeps its stamp from one sync to the next', () => withGist(async gh => {
  const home = pc('pc-home1', books(HOME, 3600));
  await syncNow(gh, io(home));
  const at = hours.clean(home.get('timeElsewhere')).shares['pc-home1'].at;
  assert.ok(at > 0);
  await new Promise(r => setTimeout(r, 5));
  await syncNow(gh, io(home));
  await syncNow(gh, io(home));
  assert.equal(hours.clean(home.get('timeElsewhere')).shares['pc-home1'].at, at);
  // New time is a new stamp.
  home.set({ timeTracking: tt.credit(home.get('timeTracking'), HOME, 30, new Date(2026, 9, 26, 12).getTime()) });
  await syncNow(gh, io(home));
  assert.ok(hours.clean(home.get('timeElsewhere')).shares['pc-home1'].at > at);
}));

test('a project\'s rate follows the PC that changed it last', () => {
  const homeBooks = tt.setProject(books(HOME, 3600), HOME, { rate: 90, client: 'Acme' }, 2000);
  const workBooks = tt.setProject(books(WORK, 1800), WORK, { rate: 60 }, 1000);
  const merged = hours.merge(
    hours.snapshot(k => (k === 'timeTracking' ? homeBooks : undefined), 'pc-home1', 5000),
    hours.snapshot(k => (k === 'timeTracking' ? workBooks : undefined), 'pc-work1', 5000));
  const adopted = hours.adopt(workBooks, merged);
  assert.equal(adopted.projects[WORK].rate, 90);
  assert.equal(adopted.projects[WORK].client, 'Acme');
  // The newer side has nothing to take.
  assert.equal(hours.adopt(homeBooks, merged), homeBooks);
});

test('another PC\'s project that isn\'t here shows as its own, with its details', () => {
  const mine = books(HOME, 3600);
  const elsewhere = { shares: { 'pc-work1': { at: 1, days: { [DAY]: { 'd:\\repos\\client-site': 7200 } } } }, projects: { 'client-site': { name: 'Client site', rate: 50, at: 1 } } };
  const s = tt.summarize(hours.combine(mine, elsewhere, 'pc-home1'), WEEK);
  const site = s.projects.find(p => p.key === 'd:\\repos\\client-site');
  assert.equal(site.name, 'Client site');
  assert.equal(site.amount, 100);
});

test('two projects here with the same folder name: another PC\'s hours stay apart rather than guess', () => {
  const mine = { ...books(HOME, 60), projects: { [HOME]: { name: 'a' }, 'e:\\old\\shellby': { name: 'b' } } };
  const elsewhere = { shares: { 'pc-work1': { at: 1, days: { [DAY]: { [WORK]: 600 } } } } };
  const combined = hours.combine(mine, elsewhere, 'pc-home1');
  assert.equal(combined.days[DAY][WORK], 600);
  assert.equal(combined.days[DAY][HOME], 60);
});

// A tracker on the PC with id pc-home1, with the given books and what sync brought.
function tracker(timeTracking, timeElsewhere) {
  const saved = { timeTracking, timeElsewhere };
  const t = new TimeTracker({
    config: { get: k => saved[k], set: p => Object.assign(saved, p) }, now: () => new Date(2026, 9, 27, 10).getTime(),
    toPanel: () => {}, front: () => null, idle: () => ({ idleMs: 0, locked: false }), selfPid: 1,
    known: () => [{ key: HOME, name: 'shellby' }], claudeAt: () => ({ dirs: [], names: [] }), resolve: async () => null,
    device: () => 'pc-home1',
  });
  return { t, saved };
}

test("the Time page adds up every PC's hours, but a time tracker gets only this PC's", async () => {
  const { t } = tracker(books(HOME, 600), { shares: { 'pc-work1': { at: 1, days: { [DAY]: { [WORK]: 1200 } } } } });
  assert.equal((await t.summary({ range: 'custom', ...WEEK })).summary.totals.seconds, 1800);
  assert.equal((await t.summary({ range: 'custom', ...WEEK, local: true })).summary.totals.seconds, 600);
  assert.equal((await t.view({ range: 'custom', ...WEEK })).otherPcs, 1);
});

test('time another PC kept is taken off on that PC, so it never gets billed from there anyway', () => {
  const { t } = tracker(books(HOME, 600), { shares: { 'pc-work1': { at: 1, days: { [DAY]: { [WORK]: 1200 } } } } });
  const r = t.addTime({ key: HOME, day: DAY, minutes: -20 });
  assert.equal(r.ok, false);
  assert.match(r.error, /10m of that day was kept on this PC/);
  assert.equal(t.addTime({ key: HOME, day: DAY, minutes: -10 }).ok, true);
});

test("a change to a project is stamped after any copy seen yet, even with this PC's clock behind", () => {
  const future = Date.now() + 365 * 24 * 3600 * 1000;
  const { t } = tracker(books(HOME, 600), { projects: { shellby: { name: 'shellby', rate: 10, at: future } } });
  t.setProject(HOME, { rate: 99 });
  assert.ok(t.state.projects[HOME].at > future);
  const shared = hours.snapshot(k => t.deps.config.get(k), 'pc-home1', 5);
  assert.equal(shared.projects.shellby.rate, 99);
});

test('with sync off here, details from other PCs are left alone', () => {
  const mine = tt.setProject(books(HOME, 60, { sync: false }), HOME, { rate: 10 }, 1);
  assert.equal(hours.adopt(mine, { projects: { shellby: { name: 'shellby', rate: 99, at: 50 } } }), mine);
});

test('a network share from the gist is never taken for a folder', () => {
  const c = hours.clean({ shares: { 'pc-work1': { at: 1, days: { [DAY]: { '\\\\evil\\share\\repo': 60, '//evil/share': 60, [WORK]: 60 } } } } });
  assert.deepEqual(Object.keys(c.shares['pc-work1'].days[DAY]), [WORK]);
});

test('a share is cut to its budget from the oldest day, and junk from the gist is dropped', () => {
  const days = {};
  for (let i = 0; i < 400; i++) {
    const d = new Date(2025, 0, 1 + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days[key] = { 'c:\\a\\very\\long\\folder\\path\\for\\a\\project': 3600, 'c:\\another\\long\\folder\\path\\project-two': 1800 };
  }
  const c = hours.clean({ shares: { 'pc-home1': { at: 5, days }, 'NOT A PC': { at: 9, days }, 'pc-x123': 'junk' }, projects: { 'Upper': { name: 'x' }, ok: 'nope' } });
  assert.deepEqual(Object.keys(c.shares), ['pc-home1']);
  assert.deepEqual(c.projects, {});
  const kept = Object.keys(c.shares['pc-home1'].days);
  assert.ok(kept.length < 400 && kept.length > 100);
  assert.equal(kept[kept.length - 1], Object.keys(days).sort().pop());
  assert.ok(JSON.stringify(c.shares['pc-home1']).length <= hours.SHARE_BYTES + 200);
});

test('off on this PC, the Time page counts only its own hours', () => {
  const mine = books(HOME, 600, { sync: false });
  const elsewhere = { shares: { 'pc-work1': { at: 1, days: { [DAY]: { [WORK]: 1200 } } } } };
  assert.equal(tt.summarize(hours.combine(mine, elsewhere, 'pc-home1'), WEEK).totals.seconds, 600);
});
