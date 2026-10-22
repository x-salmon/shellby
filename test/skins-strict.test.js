// skins.validate(skin, { strict: true }) is what the Painter saves with, so a
// skin that saves is one the gallery's Pack check takes. The check runs
// docs/addon.schema.json, so the two are held to each other here: every skin
// Shellby ships passes both, and on a table of good and bad skins they agree.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validate, LIMITS } = require('../src/main/skins');
const { checkSchema } = require('../scripts/validate-packs');

const ROOT = path.join(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'addon.schema.json'), 'utf8'));
const bySchema = skin => checkSchema(skin, schema.$defs.skin, schema);
const strict = skin => validate(skin, { strict: true });

const shipped = [
  ...fs.readdirSync(path.join(ROOT, 'src', 'skins')).filter(f => f.endsWith('.json'))
    .map(f => [`src/skins/${f}`, JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'skins', f), 'utf8'))]),
  ...fs.readdirSync(path.join(ROOT, 'src', 'wardrobe')).filter(f => f.endsWith('.json'))
    .flatMap(f => (JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'wardrobe', f), 'utf8')).skins || []).map(s => [`src/wardrobe/${f} ${s.id}`, s])),
];

test('every skin Shellby ships passes strict mode and the schema', () => {
  assert.ok(shipped.length >= 4);
  for (const [where, skin] of shipped) {
    assert.deepEqual(strict(skin).errors, [], `${where}: strict`);
    assert.deepEqual(bySchema(skin), [], `${where}: schema`);
  }
});

const good = { id: 'tide', name: 'Tide', author: 'crabfan', description: 'Sea foam.', palette: { a: '#112233', b: '#445566' }, parts: { a: 'shell', b: 'body' }, pixels: ['ab', 'ba'] };
const without = key => Object.fromEntries(Object.entries(good).filter(([k]) => k !== key));
const palette = n => Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'].slice(0, n).map(c => [c, '#123456']));

// [what, skin, passes]
const TABLE = [
  ['a plain good skin', good, true],
  ['no parts at all', without('parts'), true],
  ['anchors moved', { ...good, anchors: { head: [1, -2], claw: [48, -16] } }, true],
  ['based on a gallery pack', { ...good, basedOn: 'skin-frosty' }, true],
  ['unlocked by a level', { ...good, unlock: { level: 5 } }, true],
  ['a contest winner', { ...good, won: '2026-10' }, true],
  ['won in a month that isn\'t one', { ...good, won: '2026-13' }, false],
  [`${LIMITS.palette} colours`, { ...good, palette: palette(LIMITS.palette), parts: {} }, true],
  ['40 × 32', { ...good, pixels: Array(32).fill('a'.repeat(40)) }, true],
  ['an unknown part', { ...good, parts: { a: 'rocket' } }, false],
  ['an unknown field', { ...good, onClick: 'alert(1)' }, false],
  [`${LIMITS.palette + 1} colours`, { ...good, palette: palette(LIMITS.palette + 1), parts: {} }, false],
  ['"." as a colour', { ...good, palette: { ...good.palette, '.': '#000000' } }, false],
  ['a long palette key', { ...good, palette: { ab: '#000000' } }, false],
  ['a colour that isn\'t #rrggbb', { ...good, palette: { a: 'red' } }, false],
  ['an empty palette', { ...good, palette: {}, parts: {} }, false],
  ['no id', without('id'), false],
  ['an id with capitals', { ...good, id: 'Tide' }, false],
  ['an id with an underscore', { ...good, id: 'tide_pool' }, false],
  ['a name too long', { ...good, name: 'x'.repeat(41) }, false],
  ['a description too long', { ...good, description: 'x'.repeat(121) }, false],
  ['an author that isn\'t text', { ...good, author: 7 }, false],
  ['33 rows', { ...good, pixels: Array(33).fill('a') }, false],
  ['41 columns', { ...good, pixels: ['a'.repeat(41)] }, false],
  ['no rows', { ...good, pixels: [] }, false],
  ['a row that isn\'t text', { ...good, pixels: ['ab', 3] }, false],
  ['an unknown anchor', { ...good, anchors: { tail: [1, 1] } }, false],
  ['an anchor off the range', { ...good, anchors: { head: [49, 0] } }, false],
  ['an anchor of three numbers', { ...good, anchors: { head: [1, 2, 3] } }, false],
  ['an anchor of halves', { ...good, anchors: { head: [1.5, 2] } }, false],
  ['basedOn that isn\'t a pack id', { ...good, basedOn: 'Not A Pack' }, false],
];

test('strict mode and addon.schema.json agree on good and bad skins', () => {
  for (const [what, skin, passes] of TABLE) {
    const s = strict(skin), sc = bySchema(skin);
    assert.equal(!s.errors.length, passes, `${what}: strict says ${s.errors.join('; ') || 'ok'}`);
    assert.equal(!sc.length, passes, `${what}: the schema says ${sc.join('; ') || 'ok'}`);
  }
});

test('the lenient path still takes what people already have in their folders', () => {
  // An unknown part is dropped, not an error; long text is cut; capitals are kept.
  const { skin, errors } = validate({ ...good, id: 'My_Crab', parts: { a: 'rocket', b: 'body' }, name: 'x'.repeat(60), extra: 1 });
  assert.deepEqual(errors, []);
  assert.equal(skin.id, 'My_Crab');
  assert.deepEqual(skin.parts, { b: 'body' });
  assert.equal(skin.name.length, 40);
  assert.equal(skin.extra, undefined);
  // ...and keeps the anchors and credit a painted skin carries.
  const painted = validate({ ...good, anchors: { head: [3, -2], face: [99, 0] }, basedOn: 'skin-frosty' }).skin;
  assert.deepEqual(painted.anchors, { head: [3, -2] }, 'the good anchors, the bad one left to the default');
  assert.equal(painted.basedOn, 'skin-frosty');
});
