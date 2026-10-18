const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const credits = require('../src/main/credits');
const gather = require('../scripts/lib/credits-gather');
const { Config } = require('../src/main/config');
const { Wardrobe } = require('../src/main/wardrobe/service');
const { wireCredits, CREDITS_FILE } = require('../src/main/wiring/credits');

const BUILTIN = path.join(__dirname, '..', 'src', 'wardrobe');
const FIXTURE = {
  format: 1,
  people: [
    { login: 'crabfan', for: ['contest-2026-11', 'pack'], packs: ['skin-frosty'] },
    { login: 'octo', for: ['code'] },
    { login: 'Octo', for: ['pack'], packs: ['tiny-hats'] },
    { login: 'dependabot[bot]', for: ['code'] },
    { login: '../evil', for: ['code'] },
    { login: 'nobody', for: ['hacking'] },
  ],
};

test('credits.json as shipped is well formed, and nobody in it is a bot', () => {
  const raw = JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8'));
  const c = credits.normalize(raw);
  assert.equal(raw.format, 1);
  assert.equal(c.people.length, raw.people.length, 'every entry survives the check');
  assert.equal(fs.readFileSync(CREDITS_FILE, 'utf8'), credits.toText(c, raw.note), 'written the way release:cut writes it');
});

test('junk is dropped, logins merge whatever their case, and merging only adds', () => {
  const c = credits.normalize(FIXTURE);
  assert.deepEqual(c.people.map(p => p.login), ['crabfan', 'octo']);
  assert.deepEqual(c.people[1], { login: 'octo', for: ['code', 'pack'], packs: ['tiny-hats'] });
  const more = credits.add(c, 'newbie', 'code');
  assert.deepEqual(more.people.map(p => p.login), ['crabfan', 'newbie', 'octo']);
  assert.deepEqual(credits.merge(more, { people: [] }), more, 'nobody is taken off');
  assert.deepEqual(credits.add(c, 'x', 'bribe'), c);
  assert.deepEqual(JSON.parse(credits.toText(more, 'hi')).people.length, 3);
});

test('what a login is credited for: credits.json and the gallery\'s index together', () => {
  const index = [
    { id: 'skin-ghosty', by: 'CrabFan', contest: '2026-10', winner: false },
    { id: 'skin-frosty', by: 'crabfan', contest: '2026-11', winner: true },
    { id: 'theirs', by: 'someone', contest: '2026-11' },
  ];
  const me = credits.forLogin(FIXTURE, 'CRABFAN', index);
  assert.deepEqual(me.packs, ['skin-frosty', 'skin-ghosty']);
  assert.deepEqual(me.wins, ['2026-11']);
  assert.deepEqual(me.entries, ['2026-10', '2026-11']);
  assert.equal(me.code, false);
  assert.deepEqual(credits.trophyStats(me), [['credit-packs', 2], ['contest-wins', 1], ['contest-entries', 2]]);
  assert.deepEqual(credits.trophyStats(credits.forLogin(FIXTURE, 'octo')), [['credit-packs', 1], ['credit-code', 1]]);
  assert.equal(credits.forLogin(FIXTURE, null), null);
  assert.deepEqual(credits.trophyStats(credits.forLogin(FIXTURE, 'stranger')), []);
  assert.deepEqual(credits.trophyStats(credits.forLogin(null, 'ghost', [{ id: 'mine', by: 'ghost' }])), [['credit-packs', 1]], 'a pack the gallery knows of before a release does');
});

test('Made by: grouped, newest win first, each a link to their profile', () => {
  const g = credits.groups(credits.add(FIXTURE, 'crabfan', 'contest-2027-01'), 'octo');
  assert.deepEqual(g.map(x => x.id), ['contest', 'packs', 'code']);
  assert.deepEqual(g[0].people.map(p => p.note), ['January 2027', 'November 2026']);
  assert.equal(g[2].people[0].url, 'https://github.com/octo');
  assert.equal(g[2].people[0].me, true);
  assert.deepEqual(credits.groups(null), []);
});

// The wiring, with a real Wardrobe and its trophies.
// credits.json itself is swapped for FIXTURE by the test (fs.readFileSync mocked).
function rig({ login = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-credits-'));
  const config = new Config(dir);
  const github = Object.assign(new EventEmitter(), { signedIn: !!login, login, view() { return { signedIn: this.signedIn, login: this.signedIn ? this.login : null }; } });
  const d = {
    config, github, log: { info() {}, warn() {} }, every() {}, registryUrl: () => 'http://127.0.0.1:9/',
  };
  const w = new Wardrobe({ config, builtinDir: BUILTIN, userDir: path.join(dir, 'packs'), now: () => new Date(2026, 10, 5), signedIn: () => github.signedIn, contestWins: () => d.myCredits?.()?.wins || [] });
  w.load();
  d.wardrobe = w;
  d.stat = (e, p) => w.record(e, p);
  const fns = wireCredits(d);
  Object.assign(d, fns);
  return { d, w, github, fns };
}

test('the trophies unlock for the signed-in login in credits.json, and not otherwise', t => {
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (f, ...rest) => (f === CREDITS_FILE ? JSON.stringify(FIXTURE) : read(f, ...rest)));
  const out = rig();
  out.fns.checkCredits();
  assert.equal(out.w.data.unlocked.filter(id => ['reef-builder', 'shipwright', 'contest-champion', 'contestant'].includes(id)).length, 0, 'signed out: nothing can be known');
  const locked = out.w.view().achievements.find(a => a.id === 'shipwright');
  assert.equal(locked.claim, 'Sign in to GitHub to claim');
  assert.equal(out.w.lockInfo(out.w.item('tiny-wrench')).text, 'Shipwright: sign in to GitHub to claim');

  const stranger = rig({ login: 'stranger' });
  stranger.fns.checkCredits();
  assert.ok(!stranger.w.data.unlocked.includes('shipwright'), 'a login that isn\'t in it gets nothing');
  assert.equal(stranger.w.view().achievements.find(a => a.id === 'shipwright').claim, null);

  const champ = rig({ login: 'crabfan' });
  champ.fns.startCredits();
  const got = champ.w.data.unlocked;
  assert.ok(got.includes('reef-builder') && got.includes('contest-champion') && got.includes('contestant'));
  assert.ok(!got.includes('shipwright'));
  assert.ok(champ.w.isUnlocked(champ.w.item('golden-shell-trim')));
  assert.equal(champ.w.view().achievements.find(a => a.id === 'contest-champion').description, 'Won the November 2026 crab contest');

  // Signing out never takes a trophy back.
  champ.github.signedIn = false;
  champ.github.emit('change');
  assert.ok(champ.w.data.unlocked.includes('contest-champion'));
  assert.ok(champ.w.isUnlocked(champ.w.item('coral-crown')));
  assert.equal(champ.w.view().achievements.find(a => a.id === 'contest-champion').claim, null, 'earned: nothing to claim');

  // ...and signing in later claims what's yours.
  const late = rig();
  late.fns.startCredits();
  late.github.signedIn = true;
  late.github.login = 'octo';
  late.github.emit('change');
  assert.ok(late.w.data.unlocked.includes('shipwright'));
  const v = late.fns.creditsView();
  assert.equal(v.mine.code, true);
  assert.ok(v.groups.find(g => g.id === 'code').people.some(p => p.me));
});

test('release:cut reads who made it from git and the gallery, and only adds', async () => {
  const rec = (subject, email = 'x@example.com', body = '') => `deadbeef\x1f${subject}\x1f${email}\x1f${body}\x1e`;
  const log = [
    rec('Merge pull request #12 from octo/fix-thing'),
    rec('feat: something (#40)', 'me@example.com'),
    rec('fix: typo', '12345+helper@users.noreply.github.com'),
    rec('docs: words', 'x@example.com', 'Co-authored-by: Pal <777+pal@users.noreply.github.com>\nCo-authored-by: Robot <49699333+dependabot[bot]@users.noreply.github.com>'),
    rec('chore: bump', '49699333+dependabot[bot]@users.noreply.github.com'),
  ].join('\n');
  assert.deepEqual(gather.fromLog(log), { logins: ['helper', 'octo', 'pal'], prs: [40] });
  const r = await gather.gather(FIXTURE, log, {
    prAuthors: async prs => (prs.includes(40) ? ['squasher'] : []),
    packMakers: async () => ({ ok: true, makers: [{ login: 'crabfan', packs: ['skin-ghosty'] }, { login: 'artist', packs: ['neon'] }] }),
  });
  const names = r.credits.people.map(p => p.login);
  assert.deepEqual(names, ['artist', 'crabfan', 'helper', 'octo', 'pal', 'squasher']);
  assert.deepEqual(r.credits.people.find(p => p.login === 'crabfan').packs, ['skin-frosty', 'skin-ghosty'], 'kept, and added to');
  assert.deepEqual(r.added.map(a => a.login), ['artist', 'crabfan', 'helper', 'pal', 'squasher']);
  const offline = await gather.gather(FIXTURE, '', { packMakers: async () => ({ ok: false, makers: [], error: 'offline' }) });
  assert.equal(offline.added.length, 0);
  assert.match(offline.notes[0], /offline/);
});
