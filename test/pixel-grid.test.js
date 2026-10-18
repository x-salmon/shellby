// The Painter's grid (src/renderer/shared/pixel-grid.js): painting, filling,
// lines, moving and resizing, undo, the palette, frames, and the checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const G = require('../src/renderer/shared/pixel-grid');
const catalog = require('../src/main/wardrobe/catalog');
const skins = require('../src/main/skins');

const classic = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'skins', 'classic.json'), 'utf8'));
// A drawing from rows, with colours a (body) and b (legs).
const doc = (rows, extra = {}) => ({ ...G.blank('skin', rows[0].length, rows.length), frames: [rows], palette: { a: '#111111', b: '#222222', c: '#333333' }, parts: { a: 'body', b: 'legs', c: 'eyes' }, ...extra });
const R = d => G.rows(d);

test('modes take their limits from the validators', () => {
  assert.equal(G.MODES.skin.w, skins.LIMITS.cols);
  assert.equal(G.MODES.skin.h, skins.LIMITS.rows);
  assert.equal(G.MODES.skin.palette, skins.LIMITS.palette);
  assert.equal(G.MODES.accessory.w, catalog.LIMITS.itemGrid);
  assert.equal(G.MODES.effect.w, catalog.LIMITS.spriteGrid);
  assert.equal(G.MODES.decor.w, catalog.LIMITS.decorGrid);
  for (const m of ['accessory', 'effect', 'decor']) assert.equal(G.MODES[m].palette, catalog.LIMITS.paletteMax);
  assert.equal(G.MODES.decor.frames, catalog.LIMITS.framesMax + 1);
  assert.equal(G.MODES.effect.frames, catalog.LIMITS.framesMax + 1);
  assert.deepEqual([...skins.PARTS], G.PARTS);
  assert.deepEqual(G.ANCHOR_NAMES, catalog.ANCHORS);
  assert.deepEqual(G.effectiveAnchors({ anchors: null }), JSON.parse(JSON.stringify(catalog.DEFAULT_ANCHORS)));
});

test('a blank crab is classic\'s size and see-through', () => {
  const d = G.blank();
  assert.deepEqual([d.w, d.h], [22, 13]);
  assert.ok(R(d).every(r => r === '.'.repeat(22)));
  assert.equal(G.bounds(d), null);
});

test('flood fill: four ways, stops at other colours, fills holes only when they touch', () => {
  const d = doc(['aaaa', 'a..a', 'aaaa', '..b.']);
  assert.deepEqual(R(G.fill(d, 1, 1, 'b')), ['aaaa', 'abba', 'aaaa', '..b.'], 'the hole, and only the hole');
  assert.deepEqual(R(G.fill(d, 0, 0, 'c')), ['cccc', 'c..c', 'cccc', '..b.']);
  // Diagonals don't join: the corner gap stays.
  assert.deepEqual(R(G.fill(doc(['a.', '.a']), 0, 0, 'b')), ['b.', '.a']);
  assert.deepEqual(R(G.fill(d, 0, 3, 'c')), ['aaaa', 'a..a', 'aaaa', 'ccb.'], 'see-through fills too, up to another colour');
  assert.equal(G.fill(d, 0, 0, 'a'), d, 'the same colour changes nothing');
  assert.equal(G.fill(d, 9, 9, 'a'), d, 'outside the grid changes nothing');
  assert.equal(G.fill(d, 0, 0, 'z'), d, 'a colour not on the palette changes nothing');
});

test('painting, erasing and the 2-pixel brush; off the edge is ignored', () => {
  const d = doc(['....', '....']);
  assert.deepEqual(R(G.paint(d, G.brushCells(3, 1, 2), 'a')), ['....', '...a']);
  assert.deepEqual(R(G.paint(d, G.brushCells(0, 0, 2), 'b')), ['bb..', 'bb..']);
  const painted = G.paint(d, [[1, 0]], 'a');
  assert.deepEqual(R(G.paint(painted, [[1, 0]], '.')), ['....', '....'], 'the eraser is see-through');
  assert.equal(G.paint(painted, [[1, 0]], 'a'), painted, 'no change, same drawing');
  assert.equal(d.frames[0][0], '....', 'the old drawing is never changed');
});

test('lines include both ends, any direction', () => {
  assert.deepEqual(G.lineCells(0, 0, 3, 0), [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(G.lineCells(2, 2, 0, 0), [[2, 2], [1, 1], [0, 0]]);
  assert.deepEqual(G.lineCells(1, 1, 1, 1), [[1, 1]]);
  const steep = G.lineCells(0, 0, 1, 4);
  assert.equal(steep.length, 5);
  assert.deepEqual(steep.at(-1), [1, 4]);
});

test('move nudges every frame, refuses to push a pixel off, and takes moved anchors along', () => {
  const d = { ...doc(['.a.', '...', '...']), anchors: G.effectiveAnchors({ anchors: null }) };
  const m = G.move(d, 1, 1);
  assert.deepEqual(R(m), ['...', '..a', '...']);
  assert.deepEqual(m.anchors.head, [16, 0]);
  assert.equal(G.move(m, 1, 0), null, 'off the right edge');
  assert.equal(G.move(m, 0, 2), null, 'off the bottom');
  const empty = G.blank();
  assert.equal(G.move(empty, 1, 0), empty, 'an empty grid stays as it is');
  const deco = G.addFrame({ ...G.blank('decor', 3, 1), palette: { a: '#111111' }, frames: [['a..']] });
  assert.deepEqual(G.move(deco, 2, 0).frames, [['..a'], ['..a']], 'all frames move together');
  assert.equal(G.move(deco, 3, 0), null);
});

test('resize adds or trims one row or column on an edge, within the limits, never scaling', () => {
  const d = doc(['ab', 'ba']);
  assert.deepEqual(R(G.resize(d, 'left', 1)), ['.ab', '.ba']);
  assert.deepEqual(R(G.resize(d, 'right', 1)), ['ab.', 'ba.']);
  assert.deepEqual(R(G.resize(d, 'top', 1)), ['..', 'ab', 'ba']);
  assert.deepEqual(R(G.resize(d, 'bottom', -1)), ['ab']);
  assert.deepEqual(R(G.resize(d, 'left', -1)), ['b', 'a']);
  assert.equal(G.resize(doc(['a']), 'left', -1), null, 'never below one');
  assert.equal(G.resize(G.blank('skin', 40, 2), 'right', 1), null, 'never past 40 columns');
  assert.equal(G.resize(G.blank('skin', 2, 32), 'top', 1), null, 'never past 32 rows');
  assert.equal(G.resize(G.blank('effect', 8, 8), 'top', 1), null, 'an effect stops at 8');
  assert.equal(G.resize(d, 'middle', 1), null);
  const anchored = { ...d, anchors: G.effectiveAnchors({ anchors: null }) };
  assert.deepEqual(G.resize(anchored, 'top', 1).anchors.claw, [21, 7], 'moved anchors stay on the drawing');
  assert.equal(G.resize(d, 'top', 1).anchors, null, 'untouched anchors stay untouched');
});

test('undo keeps 200 whole drawings, redo goes forward, a new change drops the future', () => {
  const h = G.history();
  let d = doc(['....']);
  for (let i = 0; i < 205; i++) { h.record(d); d = G.paint(d, [[i % 4, 0]], i % 2 ? 'a' : 'b'); }
  assert.equal(h.size, G.UNDO_STEPS);
  let back = d, steps = 0;
  while (h.canUndo) { back = h.undo(back); steps++; }
  assert.equal(steps, 200);
  assert.equal(h.undo(back), null);
  const fwd = h.redo(back);
  assert.ok(fwd && h.canRedo);
  h.record(fwd);
  assert.equal(h.canRedo, false, 'a new change after undo drops what was undone');
  const s = G.history(3);
  s.record(1); s.record(2); s.record(3); s.record(4);
  assert.equal(s.undo(5), 4); assert.equal(s.undo(4), 3); assert.equal(s.undo(3), 2); assert.equal(s.undo(2), null);
});

test('the palette hands out characters in order, skips taken ones, and stops at the mode\'s cap', () => {
  assert.equal(G.nextChar({}), 'A');
  assert.equal(G.nextChar({ A: '#000000', B: '#000000' }), 'C');
  assert.equal(G.nextChar(Object.fromEntries([...G.CHARS].map(c => [c, '#000000']))), null);
  assert.ok(!G.CHARS.includes('.'), '. is see-through');
  let d = G.blank();
  const r = G.addColour(d, '#FF0000', 'claw');
  assert.equal(r.ch, 'A');
  assert.equal(r.doc.palette.A, '#ff0000');
  assert.equal(r.doc.parts.A, 'claw', 'the colour knows its part');
  for (let i = 0; i < G.MODES.skin.palette; i++) d = G.addColour(d, '#000000', 'body')?.doc || d;
  assert.equal(Object.keys(d.palette).length, G.MODES.skin.palette);
  assert.equal(G.addColour(d, '#000000', 'body'), null, 'full');
  assert.equal(G.addColour(G.blank(), 'red', 'body'), null, 'only #rrggbb');
  const acc = G.addColour(G.blank('accessory'), '#00ff00', 'claw').doc;
  assert.deepEqual(acc.parts, {}, 'accessories have no parts');
});

test('a colour can be recoloured and re-parted, and removed once nothing uses it', () => {
  const d = doc(['ab']);
  assert.equal(G.setColour(d, 'a', '#ABCDEF').palette.a, '#abcdef');
  assert.equal(G.setPart(d, 'a', 'claw').parts.a, 'claw');
  assert.equal(G.setPart(d, 'a', 'rocket'), d);
  assert.equal(G.removeColour(d, 'a'), null, 'still painted');
  const gone = G.removeColour(d, 'c');
  assert.equal(gone.palette.c, undefined);
  assert.equal(gone.parts.c, undefined);
});

test('frames: added as a copy after the one shown, up to the mode\'s limit, removable', () => {
  let d = { ...G.blank('decor', 2, 1), palette: { a: '#111111' } };
  d = G.paint(d, [[0, 0]], 'a');
  d = G.addFrame(d);
  assert.equal(d.frame, 1);
  assert.deepEqual(d.frames, [['a.'], ['a.']]);
  d = G.paint(d, [[1, 0]], 'a');
  assert.deepEqual(d.frames, [['a.'], ['aa']], 'painting changes only the frame shown');
  d = G.addFrame(G.addFrame(d));
  assert.equal(d.frames.length, 4);
  assert.equal(G.addFrame(d), null);
  assert.equal(G.addFrame(G.blank('skin')), null, 'a crab has one picture');
  assert.equal(G.removeFrame(G.blank('decor')), null);
  assert.equal(G.removeFrame(d).frames.length, 3);
});

test('a skin goes in and out of a drawing unchanged', () => {
  const d = G.fromSkin(classic);
  assert.deepEqual([d.w, d.h], [22, 13]);
  const back = G.toSkin(d, { id: 'classic', name: classic.name, author: classic.author, description: classic.description });
  assert.deepEqual(back, classic);
  assert.deepEqual(skins.validate(back, { strict: true }).errors, []);
  // Ragged rows come in padded; unknown characters as see-through.
  const ragged = G.fromSkin({ palette: { a: '#111111' }, pixels: ['a', 'aaz'] });
  assert.deepEqual(G.rows(ragged), ['a..', 'aa.']);
  // Moved anchors go in the file; untouched ones never do.
  assert.equal(G.toSkin(d, { id: 'x' }).anchors, undefined);
  const moved = G.setAnchor(d, 'head', 3.4, -60);
  assert.deepEqual(moved.anchors.head, [3, -16], 'snapped to whole pixels, inside the range');
  assert.deepEqual(G.toSkin(moved, { id: 'x' }).anchors, { ...JSON.parse(JSON.stringify(catalog.DEFAULT_ANCHORS)), head: [3, -16] });
  assert.equal(G.resetAnchors(moved).anchors, null);
});

test('accessories, effects and decor go in and out of a drawing as pack items that validate', () => {
  const known = { knownAchievements: new Set(), knownSeasons: new Set() };
  const pack = (field, item) => catalog.validatePack({ format: 1, id: 'p-test', name: 'P', author: 'Me', version: '1.0.0', [field]: [item] }, known);
  let acc = G.paint({ ...G.blank('accessory', 3, 2), palette: { a: '#111111' } }, [[0, 1], [1, 1], [2, 1]], 'a');
  acc = G.setPivot(acc, 1, 1);
  const hat = G.toItem(acc, { id: 'cap', name: 'Cap' }, { slot: 'hat' });
  assert.deepEqual(hat.pivot, [1, 1]);
  let r = pack('accessories', hat);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.pack.accessories.length, 1);
  assert.deepEqual(G.rows(G.fromItem('accessory', hat)), G.rows(acc));

  let fx = G.paint({ ...G.blank('effect', 2, 2), palette: { s: '#ffffff' } }, [[0, 0]], 's');
  fx = G.paint(G.addFrame(fx), [[1, 1]], 's');
  const flake = G.toItem(fx, { id: 'flake', name: 'Flake' }, { motion: 'fall', fps: 3 });
  r = pack('effects', flake);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.pack.effects[0].fps, 3);
  assert.deepEqual(G.fromItem('effect', flake).frames, fx.frames);

  let rock = G.paint({ ...G.blank('decor', 2, 2), palette: { r: '#888888' } }, [[0, 1], [1, 1]], 'r');
  r = pack('decor', G.toItem(rock, { id: 'rock', name: 'Rock' }, { category: 'rock', layer: 'floor' }));
  assert.deepEqual(r.warnings, []);
  rock = G.addFrame(rock);
  r = pack('decor', G.toItem(rock, { id: 'sand', name: 'Sand' }, { category: 'substrate' }));
  assert.deepEqual(r.warnings, [], 'a substrate has no layer or frames');
});

test('ids: a slug of the name and four random characters, short enough for a pack id', () => {
  const id = G.newId('Frosty the Crab!', () => 0.5);
  assert.match(id, /^frosty-the-crab-[a-z0-9]{4}$/);
  assert.match(G.newId('', () => 0), /^crab-[a-z0-9]{4}$/);
  const long = G.newId('x'.repeat(80), Math.random);
  assert.ok(catalog.PACK_ID_RE.test(`decor-${long}`), 'room for the pack prefix');
  assert.ok(catalog.ITEM_ID_RE.test(long));
  assert.equal(G.slug('Crème -- brûlée'), 'creme-brulee', 'accents come off');
});

test('checks: classic is clean; each problem is found, with the pixels to show', () => {
  const meta = { name: 'Classic', author: 'Shellby' };
  assert.deepEqual(G.checks(G.fromSkin(classic), meta).map(c => [c.id, c.level]), [['legs-touch', 'note']], 'nothing that blocks anything');
  assert.deepEqual(G.verdict([]), { save: true, share: true });

  const empty = G.checks(G.blank(), {});
  assert.deepEqual(empty.map(c => c.id), ['empty', 'name', 'author']);
  assert.deepEqual(G.verdict(empty), { save: false, share: false });

  // A colour with no part blocks saving.
  const loose = { ...doc(['ab', 'ac']), parts: { b: 'legs', c: 'eyes' } };
  const c1 = G.checks(loose, meta);
  const np = c1.find(c => c.id === 'no-part');
  assert.equal(np.blocks, 'save');
  assert.deepEqual(np.cells, [[0, 0], [0, 1]]);

  // No eyes, no legs: warnings that block sharing, not saving, unless on purpose.
  const plain = doc(['aa', 'aa']);
  const c2 = G.checks(plain, meta);
  assert.deepEqual(c2.filter(c => c.level === 'warning').map(c => c.id).sort(), ['anchors', 'no-eyes', 'no-legs']);
  assert.deepEqual(G.verdict(c2), { save: true, share: false });
  const c3 = G.checks(plain, meta, ['no-eyes', 'no-legs', 'anchors']);
  assert.deepEqual(G.verdict(c3), { save: true, share: true });
  assert.ok(c3.every(c => c.onPurpose));

  // Legs that touch are one shape and step together: a note, since classic's do too.
  const joined = G.checks(doc(['caaa', 'bbbb']), meta).find(c => c.id === 'legs-touch');
  assert.equal(joined.level, 'note');
  assert.equal(joined.cells.length, 4);
  assert.equal(G.checks(doc(['caaa', 'b.b.']), meta).find(c => c.id === 'legs-touch'), undefined);
  assert.equal(G.checks(doc(['caaa', 'b.b.', '.b..']), meta).find(c => c.id === 'legs-touch')?.level, 'note', 'corners count');

  // Name and author block sharing only.
  const nameless = G.checks(G.fromSkin(classic), {});
  assert.deepEqual(nameless.filter(c => c.blocks).map(c => c.id), ['name', 'author']);
  assert.deepEqual(G.verdict(nameless), { save: true, share: false });

  // Much bigger than classic: a note, never a block.
  const big = G.fromSkin({ ...classic, pixels: classic.pixels.map(r => r + r) });
  const note = G.checks(big, meta).find(c => c.id === 'big');
  assert.equal(note.level, 'note');
  assert.equal(note.blocks, null);
});

test('checks for an accessory: a pivot off the drawing', () => {
  let acc = G.paint({ ...G.blank('accessory', 8, 8), palette: { a: '#111111' } }, [[0, 0]], 'a');
  acc = G.setPivot(acc, 7, 7);
  assert.deepEqual(G.checks(acc, { name: 'Hat' }).map(c => c.id), ['pivot']);
  assert.deepEqual(G.checks(G.setPivot(acc, 0, 1), { name: 'Hat' }), []);
});
