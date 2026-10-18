// Moment cards (src/renderer/panel/moment-card.js): every kind has its post
// text, every post fits with its link and one #Shellby, each new moment is
// built from what its celebration already has, and each celebration hands its
// moment over. moment-card.js runs in a vm with a SB holding only what it reads;
// the celebrations are checked in their sources.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PANEL = path.join(__dirname, '..', 'src', 'renderer', 'panel');
const plain = v => JSON.parse(JSON.stringify(v)); // out of the vm's realm, for deepEqual
const src = name => fs.readFileSync(path.join(PANEL, name), 'utf8');
const LINK = 'https://github.com/x-salmon/shellby';
const ART = { pixels: ['.ab.', 'abba', '.ab.'], palette: { a: '#ff7a5c', b: '#ffc15e' } };

// An SVG element that's just enough for posed(): attributes, groups and children.
function fakeSvg() {
  const attrs = { viewBox: '0 0 22 13' };
  return {
    childNodes: [], setAttribute(k, v) { attrs[k] = v; }, getAttribute: k => attrs[k] ?? null,
    querySelectorAll: () => [], append(...kids) { this.childNodes.push(...kids); },
  };
}

function load(state = {}) {
  const toasts = [];
  const SB = {
    state,
    toast: t => toasts.push(t),
    plural: (n, one, many = `${one}s`, f = String) => `${f(n)} ${n === 1 ? one : many}`,
    ordinal: k => `${k}th`,
    sprite: () => fakeSvg(),
    Sprite: { build: () => fakeSvg(), poster: s => s?.[0] || null },
    cardKit: {
      W: 1200, H: 630, C: { amber: '#ffc15e', coral: '#ff7a5c', glass: '#7fd6c2', sand: '#f3e6cc', sandDim: '#b3a892' },
      svgImage: async () => ({}), present: async spec => spec,
    },
  };
  const document = { createElementNS: () => fakeSvg(), createElement: () => ({}) };
  vm.runInContext(src('moment-card.js'), vm.createContext({ SB, document }), { filename: 'moment-card.js' });
  return { M: SB.momentCard, toasts };
}

// The richest panel state each builder reads.
const STATE = {
  xp: { level: 42, total: 123456 },
  life: { bond: { days: 88 } },
  wardrobe: { achievements: [{ done: true }, { done: true }, { done: false }], stats: { activeDays: 120 } },
  bugdex: { of: 60, species: [{ id: 'nullfish', name: 'Nullfish', state: 'caught', caught: 9 }, { id: 'ghost', name: 'Ghost Crab', state: 'caught', caught: 2 }] },
  stickers: { card: 'names', projects: [{ id: 'aaa', name: 'shellby', art: ART, tier: 'holo', tierName: 'Holo', ships: 20, hidden: false }, { id: 'bbb', name: 'secret-thing', art: ART, tier: 'paper', tierName: 'Paper', ships: 1, hidden: true }] },
  outfit: { stickers: [{}, {}] },
  streaks: { current: 30, longest: 41 },
  skin: { pixels: ['bb'], palette: { b: '#ff7a5c' } },
};

// What each celebration hands its card: the table in docs/plans/share-moments.md.
const EVENTS = {
  trophy: { achievement: { id: 'tide-turner', name: 'Tide Turner', icon: '🌊', description: 'Turned the tide' }, rewards: [{ name: 'Kelp Hat', ...ART }] },
  level: { level: 25, title: 'Reef Warden', rank: { name: 'Coral', color: '#ff7a5c' } },
  molt: { was: { name: 'Snail Shell', ...ART }, now: { name: 'Barnacle Shell', ...ART }, count: 2, badge: 'II' },
  sticker: { id: 'aaa' },
  catch: { id: 'nullfish', name: 'Nullfish', rarity: 'rare', pixels: ART.pixels, palette: ART.palette, habitat: 'The Shallows' },
  streak: { days: 30 },
  skin: { skin: { name: 'Sunset', pixels: ['..bb..', '.bbbb.'], palette: { b: '#ff7a5c' }, parts: { b: 'body' } }, name: 'Sunset', author: 'octocat' },
};
// Facts for the four kinds their callers draw themselves.
const SAYS = {
  shiny: { bug: true, name: 'Nullfish', odds: 512, after: 40 },
  medal: { emoji: '🎃', name: 'The Haunting 2026' },
  board: { month: 'October', place: 1, of: 4, bugs: 12 },
  egg: { code: 'EGG-1234-ABCD' },
};

test('every kind of card has its post text, and nothing else does', () => {
  const { M } = load();
  assert.deepEqual(Object.keys(M.POST_TEXT).sort(), [...M.MOMENT_KINDS].sort());
  for (const kind of M.MOMENT_KINDS) assert.equal(typeof M.POST_TEXT[kind], 'function', kind);
  // A kind with a builder is one of the kinds.
  for (const kind of Object.keys(M.FROM)) assert.ok(M.MOMENT_KINDS.includes(kind), kind);
});

test('every post names its moment, ends with #Shellby and the link, and stays under 200 characters', async () => {
  const { M } = load(STATE);
  const long = 'x'.repeat(300);
  for (const kind of M.MOMENT_KINDS) {
    const built = M.FROM[kind] ? await M.FROM[kind](EVENTS[kind]) : { m: { say: SAYS[kind] } };
    const post = M.postFor(kind, built.m.say);
    assert.ok(post.length < 200, `${kind}: ${post.length} characters`);
    assert.ok(post.endsWith(` #Shellby ${LINK}`), `${kind}: ${post}`);
    assert.equal(post.match(/#\w+/g).length, 1, `${kind}: one hashtag`);
    // The worst a caller can pass: every fact as long as it gets.
    const huge = Object.fromEntries(Object.keys(built.m.say).map(k => [k, typeof built.m.say[k] === 'string' ? long : built.m.say[k]]));
    const big = M.postFor(kind, huge);
    assert.ok(big.length < 200 && big.endsWith(LINK), `${kind} with long names: ${big.length}`);
  }
  assert.match(M.postFor('molt', { shell: 'Barnacle Shell', n: 2, badge: 'II' }), /^🐚 Shellby just molted into the Barnacle Shell 🦀/);
  assert.match(M.postFor('trophy', { name: 'Tide Turner', have: 2, of: 3 }), /unlocked Tide Turner/);
  assert.match(M.postFor('shiny', SAYS.shiny), /SPARKLY Nullfish\. 1 in 512, after 40 bugs/);
});

test('each new moment is built from what its celebration has', async () => {
  const { M } = load(STATE);
  for (const [kind, e] of Object.entries(EVENTS)) {
    const built = await M.FROM[kind](e);
    assert.ok(built?.m, kind);
    assert.ok(built.title && built.alt, `${kind} has a sheet title and alt text`);
    assert.ok(built.m.title && built.m.eyebrow, `${kind} has its words`);
    assert.ok(typeof built.m.paint === 'function' || built.m.art?.pixels, `${kind} has its art`);
    assert.ok((built.m.stats?.length || built.m.poses?.length) > 0 && (built.m.stats || built.m.poses).length <= 4, `${kind}: one to four tiles`);
  }
  const trophy = M.FROM.trophy(EVENTS.trophy).m;
  assert.equal(trophy.title, 'Unlocked: Tide Turner');
  assert.deepEqual(plain(trophy.stats[0]), ['trophies', '2/3']);
  const level = M.FROM.level(EVENTS.level).m;
  assert.equal(level.sub, 'Reef Warden');
  assert.deepEqual(plain(level.stats.map(s => s[0])), ['XP', 'days together', 'of 3 trophies', 'top bug']);
  assert.equal(level.stats[3][1], 'Nullfish', 'his most-caught bug');
  assert.equal(M.FROM.molt(EVENTS.molt).m.stats[1][1], '2', 'the stickers he carried over');
  const skin = await M.FROM.skin(EVENTS.skin);
  assert.equal(skin.m.poses.length, M.POSES.length, 'every pose a tile');
  assert.equal(M.POSES.length, 4);
  assert.equal(skin.m.sub, 'by octocat');
});

test('a sticker card names the project only with "Shell and names", and a hidden project gets none', () => {
  const named = load(STATE).M.FROM.sticker({ id: 'aaa' }).m;
  assert.equal(named.title, 'shellby');
  assert.equal(named.say.name, 'shellby');
  const art = load({ ...STATE, stickers: { ...STATE.stickers, card: 'art' } }).M.FROM.sticker({ id: 'aaa' });
  assert.equal(art.m.title, 'A new sticker');
  assert.equal(art.m.say.name, null);
  assert.ok(!JSON.stringify({ ...art, m: { ...art.m, paint: null } }).includes('shellby'), 'the name is nowhere on it');
  assert.equal(load(STATE).M.FROM.sticker({ id: 'bbb' }), null, 'hidden');
  assert.equal(load(STATE).M.FROM.sticker({ id: 'nope' }), null);
});

test('only rare and legendary catches get a card, and a skin card needs a real skin', async () => {
  const { M, toasts } = load(STATE);
  assert.equal(M.FROM.catch({ ...EVENTS.catch, rarity: 'common' }), null);
  assert.ok(M.FROM.catch({ ...EVENTS.catch, rarity: 'legendary' }));
  assert.equal(await M.FROM.skin({ skin: { pixels: 'no' } }), null);
  assert.equal(await M.share('skin', { name: 'x' }), toasts.length, 'no card, a word instead');
  assert.equal(M.can('catch', { ...EVENTS.catch, rarity: 'uncommon' }), false);
  assert.equal(M.can('nope', {}), false);
});

test('share hands the kit the kind, its words and its post (the Painter calls it with three fields)', async () => {
  const { M } = load(STATE);
  const spec = await M.share('skin', EVENTS.skin);
  assert.equal(spec.kind, 'skin');
  assert.equal(spec.title, 'Sunset');
  assert.match(spec.post(), /^🎨 I painted a Shellby skin: Sunset by octocat\./);
  const old = await M.share('shiny', { title: 'Nullfish', say: SAYS.shiny }, { title: 'A sparkly Nullfish', alt: 'alt' });
  assert.equal(old.title, 'A sparkly Nullfish');
  assert.match(old.post(), /SPARKLY Nullfish/);
});

test('every moment in the table is handed over by the place that celebrates it', () => {
  const has = (file, pattern, what) => assert.match(src(file), pattern, what);
  has('wardrobe.js', /card: \{ kind, m \}/, 'the trophy toast');
  has('wardrobe.js', /\['trophy', e\]/, 'as a trophy card');
  has('wardrobe.js', /'on-a-roll': 7, unstoppable: 30, 'hundred-tides': 100/, 'a streak trophy is a streak card');
  has('xp.js', /kind: 'level', m: e/, 'a level up');
  has('levels-ui.js', /SB\.momentCard\?\.share\('level', e\)/, 'a level ceremony');
  has('molt.js', /SB\.momentCard\?\.share\('molt', molted\)/, 'a finished molt');
  has('stickers.js', /kind: 'sticker', m: \{ id: p\.id \}/, 'a new sticker');
  has('stickers.js', /SB\.momentCard\.share\('sticker', \{ id: n\.id \}\)/, 'a sticker tier up');
  has('bugdex.js', /card: \{ kind: 'catch', m: c \}/, 'a rare catch');
  has('streaks.js', /card: \{ kind: 'streak', m: \{ days \} \}/, 'a streak');
  has('celebrate.js', /SB\.momentCard\.share\(c\.card\.kind, c\.card\.m, c\.card\.opts\)/, 'the 📸 shares the moment');
  has('celebrate.js', /return SB\.crabCard\?\.share\(\);/, 'and the crab card without one');
  // Settings → Shellby → Share buttons on celebrations, off: no 📸 anywhere a celebration shows one.
  has('celebrate.js', /SB\.shareButtons\(\) \? h\('button', \{ class: 'btn ghost slim-btn cel-share'/, 'the celebration card');
  has('levels-ui.js', /SB\.shareButtons\?\.\(\) !== false \? h\('button'/, 'the level ceremony');
  has('molt.js', /SB\.shareButtons\?\.\(\) === false/, 'the Molt sheet');
  has('stickers.js', /SB\.shareButtons\?\.\(\) !== false/, 'a sticker tier up');
});
