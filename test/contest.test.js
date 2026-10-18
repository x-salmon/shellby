const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tally, report } = require('../scripts/contest-tally');
const { ship, parseArgs } = require('../scripts/contest-ship');
const { loadCatalog } = require('../src/main/wardrobe/catalog');
const { KNOWN_ACHIEVEMENTS } = require('../src/main/wardrobe/achievements');
const { KNOWN_SEASONS } = require('../src/main/wardrobe/seasons');
const credits = require('../src/main/credits');

const CONTEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'wardrobe', 'contest.json'), 'utf8'));
const post = (number, login, at, body, votes = 0) => ({ number, title: `Entry ${number}`, url: `https://github.com/x-salmon/shellby/discussions/${number}`, upvoteCount: votes, createdAt: at, body, author: login ? { login } : null });
const link = id => `My entry!\n\nshellby://install?pack=${id}\n`;

test('the tally counts merged entries by upvotes, one a person, until the 21st', () => {
  const packs = [
    { id: 'skin-frosty', name: 'Frosty', by: 'crabfan', contest: '2026-11' },
    { id: 'skin-icy', name: 'Icy', by: 'octo', contest: '2026-11' },
    { id: 'skin-late', name: 'Late', by: 'slow', contest: '2026-11' },
    { id: 'skin-again', name: 'Again', by: 'crabfan', contest: '2026-11' },
    { id: 'skin-october', name: 'Old', by: 'pal', contest: '2026-10' },
    { id: 'skin-stolen', name: 'Stolen', by: 'artist', contest: '2026-11' },
  ];
  const r = tally([
    post(1, 'crabfan', '2026-11-02T10:00:00Z', link('skin-frosty'), 7),
    post(2, 'octo', '2026-11-03T10:00:00Z', link('skin-icy'), 12),
    post(3, 'crabfan', '2026-11-04T10:00:00Z', link('skin-again'), 30),
    post(4, 'slow', '2026-11-22T10:00:00Z', link('skin-late'), 40),
    post(5, 'pal', '2026-11-05T10:00:00Z', link('skin-october'), 9),
    post(6, 'nolink', '2026-11-05T10:00:00Z', 'look at my crab', 9),
    post(7, 'thief', '2026-11-06T10:00:00Z', link('skin-stolen'), 9),
    post(8, 'ghosty', '2026-11-06T10:00:00Z', link('skin-unmerged'), 9),
    post(9, 'early', '2026-10-30T10:00:00Z', link('skin-frosty'), 99),
  ], packs, '2026-11');
  assert.deepEqual(r.ranked.map(e => [e.number, e.votes, e.login]), [[2, 12, 'octo'], [1, 7, 'crabfan']]);
  assert.deepEqual(r.dropped.map(d => d.number).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8]);
  assert.match(r.dropped.find(d => d.number === 3).why, /second entry \(#1 counts\)/);
  assert.match(r.dropped.find(d => d.number === 4).why, /after the 21st/);
  assert.match(r.dropped.find(d => d.number === 7).why, /added by @artist/);
  const text = report('2026-11', r);
  assert.match(text, /November 2026: 2 entries counted, 6 dropped/);
  assert.match(text, / 1\. {2}12 ▲ {2}Icy \(skin-icy\) by @octo/);
  assert.match(report('2026-12', { ranked: [], dropped: [] }), /No entries/);
  assert.throws(() => tally([], [], 'November'));
});

const winner = {
  format: 1, id: 'skin-frosty', name: 'Frosty', author: 'Crab Fan', version: '1.0.0', contest: '2026-11',
  skins: [{ id: 'frosty', name: 'Frosty', description: 'Just in from the cold.', palette: { a: '#8ecae6', b: '#ffffff' }, pixels: ['aab', 'bba'] }],
};

test('contest:ship puts the winning skin in the built-in pack, open to all, and credits the winner', () => {
  const r = ship({ contestJson: CONTEST, creditsJson: { people: [] }, packJson: winner, packId: 'skin-frosty', month: '2026-11', login: 'crabfan' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.skin, {
    id: 'contest-2026-11', name: 'Frosty', author: 'Crab Fan', description: 'Crab contest winner, November 2026. Just in from the cold.',
    palette: winner.skins[0].palette, pixels: winner.skins[0].pixels, won: '2026-11',
  });
  assert.equal(r.skin.unlock, undefined, 'no lock: the prize is everyone wearing it');
  assert.deepEqual(credits.forLogin(r.credits, 'crabfan').wins, ['2026-11']);
  assert.match(r.note, /^### New\n- \*\*November 2026's crab contest winner ships with Shellby\.\*\* Frosty by @crabfan/);

  // It loads as a built-in pack, its tile knowing whose and when.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-contest-'));
  fs.writeFileSync(path.join(dir, 'contest.json'), JSON.stringify(r.contest));
  const cat = loadCatalog({ builtinDir: dir, knownAchievements: KNOWN_ACHIEVEMENTS, knownSeasons: KNOWN_SEASONS });
  assert.deepEqual(cat.errors, []);
  assert.equal(cat.skins[0].key, 'contest-2026-11');
  assert.equal(cat.skins[0].won, '2026-11');
  assert.equal(cat.skins[0].author, 'Crab Fan');
  assert.deepEqual(cat.skins[0].unlock, { default: true });

  // A community pack can't claim a win.
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-contest-'));
  fs.writeFileSync(path.join(user, 'fake.json'), JSON.stringify({ ...r.contest, id: 'fake-winner' }));
  assert.equal(loadCatalog({ userDir: user }).skins[0].won, undefined);

  const twice = ship({ contestJson: r.contest, creditsJson: r.credits, packJson: winner, packId: 'skin-frosty', month: '2026-11', login: 'crabfan' });
  assert.match(twice.error, /already in contest\.json/);
});

test('contest:ship says what it needs', () => {
  const base = { contestJson: CONTEST, creditsJson: null, packJson: winner, packId: 'skin-frosty', month: '2026-11', login: 'crabfan' };
  assert.match(ship({ ...base, month: 'Nov' }).error, /YYYY-MM/);
  assert.match(ship({ ...base, login: null }).error, /--login/);
  assert.match(ship({ ...base, packJson: { ...winner, skins: [] } }).error, /no skins/);
  assert.match(ship({ ...base, packJson: { ...winner, skins: [winner.skins[0], { ...winner.skins[0], id: 'two' }] } }).error, /--skin/);
  assert.equal(ship({ ...base, packJson: { ...winner, skins: [winner.skins[0], { ...winner.skins[0], id: 'two' }] }, skinId: 'two' }).ok, true);
  assert.match(ship({ ...base, packJson: { nope: true } }).error, /pack check/);
  assert.deepEqual(parseArgs(['skin-frosty', '2026-11', '--skin', 'frosty', '--login', 'crabfan', '--dry-run']), { packId: 'skin-frosty', month: '2026-11', skin: 'frosty', login: 'crabfan', dryRun: true });
});
