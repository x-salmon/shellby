// The Painter's drafts and pack wishes (src/main/painter.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const painter = require('../src/main/painter');
const G = require('../src/renderer/shared/pixel-grid');

const issue = (number, title, kind, extra = {}) => ({ number, title, body: `### What kind?\n\n${kind}\n\n### The idea\n\nA crab in a scarf.`, ...extra });

test('wishes: the kind from the issue form, the "Pack wish:" off the title, pull requests and odd ones out', () => {
  const got = painter.parseWishes([
    issue(12, 'Pack wish: A frosty crab', 'Shell or skin'),
    issue(11, 'Pack wish: party hat', 'Accessory or outfit'),
    issue(10, 'Pack wish: snow', 'Effect'),
    issue(9, 'Pack wish: a shipwreck', 'Tank decor'),
    issue(8, 'Pack wish: a pirate voice', 'Voice or lines'),
    issue(7, 'Pack wish: crab', 'Shell or skin', { pull_request: {} }),
    issue(6, 'Pack wish:   ', 'Shell or skin'),
    { number: 'x', title: 'bad' },
    issue(5, `Pack wish: ${'very '.repeat(30)}long‮`, 'Shell or skin'),
  ]);
  assert.deepEqual(got.map(w => [w.number, w.kind]), [[12, 'skin'], [11, 'accessory'], [10, 'effect'], [9, 'decor'], [5, 'skin']]);
  assert.equal(got[0].title, 'A frosty crab');
  assert.equal(got[0].url, 'https://github.com/x-salmon/shellby/issues/12');
  assert.ok(got.at(-1).title.length <= 60 && !got.at(-1).title.includes('‮'));
  assert.deepEqual(painter.parseWishes('nope'), []);
});

test('every kind in the issue form that the Painter paints is mapped', () => {
  const yml = require('fs').readFileSync(require('path').join(__dirname, '..', '.github', 'ISSUE_TEMPLATE', 'pack_wish.yml'), 'utf8');
  for (const label of Object.keys(painter.WISH_KINDS)) assert.ok(yml.includes(label), `${label} is still an option`);
});

test('wishes are fetched once a day, and a failed fetch keeps the last ones', async () => {
  let asked = 0;
  const ok = async url => { asked++; assert.match(url, /\/repos\/x-salmon\/shellby\/issues\?labels=pack%20wish&state=open/); return new Response(JSON.stringify([issue(3, 'Pack wish: Crab', 'Shell or skin')]), { status: 200 }); };
  const first = await painter.fetchWishes({ api: 'https://api.example', fetchImpl: ok, now: 1000 });
  assert.equal(first.fresh, true);
  assert.equal(first.wishes[0].number, 3);
  const cached = await painter.fetchWishes({ fetchImpl: ok, cache: { at: first.at, wishes: first.wishes }, now: first.at + 3600e3 });
  assert.equal(cached.fresh, false);
  assert.equal(asked, 1, 'under a day: no fetch');
  const offline = async () => { throw new Error('offline'); };
  const stale = await painter.fetchWishes({ fetchImpl: offline, cache: { at: 0, wishes: first.wishes }, now: painter.WISH_TTL_MS + 5 });
  assert.deepEqual(stale.wishes.map(w => w.number), [3], 'offline: yesterday\'s wishes');
  assert.deepEqual((await painter.fetchWishes({ fetchImpl: offline })).wishes, [], 'offline with none kept: none');
  const tampered = await painter.fetchWishes({ fetchImpl: offline, cache: { at: Date.now(), wishes: [{ number: 1, title: 'x', kind: 'rocket' }, { number: 2, title: 'ok', kind: 'decor', url: 'https://evil.example' }] } });
  assert.deepEqual(tampered.wishes, [{ number: 2, title: 'ok', kind: 'decor', url: 'https://github.com/x-salmon/shellby/issues/2' }]);
});

test('a draft is trimmed to what a draft is', () => {
  const doc = G.blank('decor', 3, 2);
  const d = painter.cleanDraft({ id: 'rock-abcd', doc: { ...doc, frames: [doc.frames[0], doc.frames[0]] }, name: 'x'.repeat(80), settings: { category: 'rock', evil: { a: 1 } }, wish: { number: 4, title: 'Rock' }, saved: 'yes' }, 50);
  assert.equal(d.mode, 'decor');
  assert.equal(d.name.length, 40);
  assert.deepEqual(d.settings, { category: 'rock' });
  assert.deepEqual(d.wish, { number: 4, title: 'Rock' });
  assert.equal(d.saved, false);
  assert.equal(d.updatedAt, 50);
  assert.equal(painter.cleanDraft({ id: 'x', doc: { ...doc, frames: Array(5).fill(doc.frames[0]) } }), null, 'too many frames');
  assert.equal(painter.cleanDraft({ id: 'x', doc: { ...doc, frames: [['...', '..']] } }), null, 'ragged rows');
  assert.equal(painter.cleanDraft({ id: 'x', doc: { ...doc, mode: 'voice' } }), null);
  assert.equal(painter.cleanDoc({ ...G.blank(), palette: { '.': '#000000', a: 'red', b: '#00FF00' } }).palette.b, '#00FF00');
  assert.deepEqual(Object.keys(painter.cleanDoc({ ...G.blank(), palette: { '.': '#000000', a: 'red', b: '#00ff00' } }).palette), ['b']);
});
