// One painted thing wrapped in a pack of its own (src/main/wardrobe/wrap.js),
// ready for the gallery: ids, versions, the contest month, and that what it
// makes passes the app's validator and the gallery's schema with nothing to say.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const wrap = require('../src/main/wardrobe/wrap');
const { validatePack } = require('../src/main/wardrobe/catalog');
const { KNOWN_ACHIEVEMENTS } = require('../src/main/wardrobe/achievements');
const { KNOWN_SEASONS } = require('../src/main/wardrobe/seasons');
const { checkSchema } = require('../scripts/validate-packs');

const ROOT = path.join(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'addon.schema.json'), 'utf8'));
const known = { knownAchievements: KNOWN_ACHIEVEMENTS, knownSeasons: KNOWN_SEASONS, source: 'user' };
const classic = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'skins', 'classic.json'), 'utf8'));
const skin = { ...classic, id: 'frosty-k3x9', name: 'Frosty', author: 'crabfan', description: 'Just in from the cold.' };

// Clean for the app and the gallery alike.
function clean(pack) {
  const { pack: p, errors, warnings } = validatePack(pack, known);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(checkSchema(pack, schema, schema), []);
  return p;
}

test('a skin becomes skin-<id>, named and credited from the skin', () => {
  const pack = wrap.wrapSkin(skin, { login: 'crabfan' });
  assert.equal(pack.id, 'skin-frosty-k3x9');
  assert.deepEqual([pack.format, pack.name, pack.author, pack.description, pack.version], [1, 'Frosty', 'crabfan', 'Just in from the cold.', '1.0.0']);
  assert.equal(pack.skins.length, 1);
  assert.deepEqual(pack.skins[0].pixels, classic.pixels);
  assert.equal(pack.contest, undefined, 'not an entry unless asked');
  const p = clean(pack);
  assert.equal(p.skins[0].key, 'skin-frosty-k3x9/frosty-k3x9');
});

test('no author on the skin: the GitHub login is', () => {
  const pack = wrap.wrapSkin({ ...skin, author: '' }, { login: 'octocrab' });
  assert.equal(pack.author, 'octocrab');
  assert.equal(pack.skins[0].author, 'octocrab');
  clean(pack);
  assert.equal(wrap.wrapSkin({ ...skin, author: '' }).author, 'unknown', 'never empty');
});

test('versions: 1.0.0 the first time, then the gallery\'s with the patch raised', () => {
  assert.equal(wrap.nextVersion(null), '1.0.0');
  assert.equal(wrap.nextVersion({ id: 'skin-frosty-k3x9', version: '1.0.0' }), '1.0.1');
  assert.equal(wrap.nextVersion({ version: '2.4.9' }), '2.4.10');
  assert.equal(wrap.nextVersion({ version: 'v2' }), '1.0.0', 'a version that isn\'t one starts over');
  assert.equal(wrap.wrapSkin(skin, { prev: { id: 'skin-frosty-k3x9', version: '1.0.3' } }).version, '1.0.4');
});

test('a contest entry names its month; anything else is left out', () => {
  const pack = wrap.wrapSkin(skin, { contest: '2026-11' });
  assert.equal(pack.contest, '2026-11');
  assert.equal(clean(pack).contest, '2026-11');
  assert.equal(wrap.wrapSkin(skin, { contest: 'November' }).contest, undefined);
  assert.equal(wrap.wrapSkin(skin, { contest: '2026-13' }).contest, undefined);
});

test('ids: a prefix for each kind, never past 40 characters', () => {
  assert.equal(wrap.packIdFor('skin', 'frosty'), 'skin-frosty');
  assert.equal(wrap.packIdFor('accessory', 'cap'), 'acc-cap');
  assert.equal(wrap.packIdFor('effect', 'snow'), 'fx-snow');
  assert.equal(wrap.packIdFor('decor', 'rock'), 'decor-rock');
  assert.equal(wrap.packIdFor('skin', 'x'.repeat(40)).length, 40);
  assert.equal(wrap.packIdFor('voice', 'x'), null);
  assert.equal(wrap.packIdFor('skin', 'Bad Id'), null);
  assert.equal(wrap.wrapItem('voice', { id: 'x' }), null);
});

test('an accessory, an effect and a piece of decor wrap cleanly too', () => {
  const cap = { id: 'cap', name: 'Cap', slot: 'hat', pivot: [1, 1], palette: { a: '#111111' }, pixels: ['aaa', '.a.'] };
  const acc = wrap.wrapItem('accessory', cap, { login: 'crabfan' });
  assert.equal(acc.id, 'acc-cap');
  assert.equal(clean(acc).accessories[0].key, 'acc-cap/cap');
  const flake = { id: 'flake', name: 'Flake', motion: 'fall', count: 10, speed: 1, sprites: [{ palette: { s: '#ffffff' }, pixels: ['s.', '.s'], frames: [['.s', 's.']] }], fps: 3 };
  assert.equal(clean(wrap.wrapItem('effect', flake, { login: 'crabfan' })).effects[0].fps, 3);
  const rock = { id: 'rock', name: 'Rock', category: 'rock', layer: 'floor', palette: { r: '#888888' }, pixels: ['rr'] };
  clean(wrap.wrapItem('decor', rock, { login: 'crabfan', contest: '2026-12' }));
});

test('the contest discussion link is prefilled, and only on github.com', () => {
  const url = new URL(wrap.contestEntryUrl({ name: 'Frosty', packId: 'skin-frosty-k3x9', month: '2026-11', prUrl: 'https://github.com/x-salmon/shellby-packs/pull/7' }));
  assert.equal(url.origin + url.pathname, 'https://github.com/x-salmon/shellby/discussions/new');
  assert.equal(url.searchParams.get('category'), 'contest-entries');
  assert.equal(url.searchParams.get('title'), 'Frosty');
  const body = url.searchParams.get('body');
  assert.match(body, /2026-11 crab contest/);
  assert.match(body, /pull\/7/);
  assert.match(body, /shellby:\/\/install\?pack=skin-frosty-k3x9/);
});

test('a wish line only for a real issue number', () => {
  assert.equal(wrap.wishLine(12), 'For x-salmon/shellby#12');
  assert.equal(wrap.wishLine(0), '');
  assert.equal(wrap.wishLine('12'), '');
});
