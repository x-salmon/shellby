// Saving from the Painter (ipc/wardrobe.js skins:save → wiring/painter.js):
// ids checked, built-in and pack ids refused, strict validation in main whatever
// the panel says, an atomic write, then the same reload and broadcast as
// Settings → Reload. And its drafts, the desk preview, and sharing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installFakeElectron, createFakeIpc, fakeConfig } = require('./helpers/fake-ipc');

const userData = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-painter-')));
const electron = installFakeElectron({ userData });
const { wirePainter } = require('../src/main/wiring/painter');
const { registerWardrobeIpc } = require('../src/main/ipc/wardrobe');
const { loadSkins } = require('../src/main/skins');
const { loadCatalog } = require('../src/main/wardrobe/catalog');
const { KNOWN_ACHIEVEMENTS } = require('../src/main/wardrobe/achievements');
const { KNOWN_SEASONS } = require('../src/main/wardrobe/seasons');

const ROOT = path.join(__dirname, '..');
const classic = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'skins', 'classic.json'), 'utf8'));
const mine = (over = {}) => ({ ...classic, id: 'frosty-k3x9', name: 'Frosty', author: 'crabfan', description: 'Cold.', ...over });

function setup({ github = null, config = fakeConfig(), registry = null } = {}) {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(userData, 'run-')));
  const skinsDir = path.join(base, 'skins');
  const wardrobeDir = path.join(base, 'wardrobe');
  fs.mkdirSync(skinsDir);
  const calls = { broadcastWardrobe: 0, broadcastSkin: 0, published: [], asked: [], specs: [], opened: [], publishAnswer: 'yes' };
  const wardrobe = {
    userDir: wardrobeDir,
    catalog: loadCatalog({ builtinDir: path.join(ROOT, 'src', 'wardrobe'), userDir: wardrobeDir, knownAchievements: KNOWN_ACHIEVEMENTS, knownSeasons: KNOWN_SEASONS }),
    load() { this.catalog = loadCatalog({ builtinDir: path.join(ROOT, 'src', 'wardrobe'), userDir: wardrobeDir, knownAchievements: KNOWN_ACHIEVEMENTS, knownSeasons: KNOWN_SEASONS }); },
    emit() {},
    lockInfo: item => (item.unlock?.default ? null : { reason: 'achievement' }),
  };
  const d = {
    config, wardrobe, github,
    skins: loadSkins(skinsDir),
    userSkinsDir: () => skinsDir,
    allSkins: () => d.skins,
    broadcastWardrobe: () => { calls.broadcastWardrobe++; },
    broadcastSkin: () => { calls.broadcastSkin++; },
    registryUrl: () => registry || 'http://127.0.0.1:9/',
    githubEndpoints: () => ({ api: 'http://127.0.0.1:9' }),
    askOnce: async spec => { calls.asked.push(spec.title); calls.specs.push(spec); return 0; },
    // wiring/github.js's: handed the wrap itself; what's on disk when it asks is noted.
    confirmAndPublishPack: async (packId, opts) => {
      calls.published.push({ packId, opts, json: opts.pack, onDiskWhenAsked: fs.existsSync(path.join(wardrobeDir, `${packId}.json`)) ? fs.readFileSync(path.join(wardrobeDir, `${packId}.json`), 'utf8') : null });
      return calls.publishAnswer === 'yes' ? { ok: true, url: 'https://github.com/x-salmon/shellby-packs/pull/7', number: 7 } : { ok: false, canceled: true };
    },
    log: { warn: () => {} },
  };
  Object.assign(d, wirePainter(d));
  const ipc = createFakeIpc();
  registerWardrobeIpc(ipc.ipcMain, {
    wardrobe: () => wardrobe, reloadSkins: d.reloadSkins, userSkinsDir: d.userSkinsDir, openPath: () => {},
    painter: {
      readSkin: d.painterReadSkin, saveSkin: d.painterSaveSkin, preview: d.painterPreview, saveItem: d.painterSaveItem, items: d.painterItems,
      drafts: d.painterDrafts, saveDraft: d.painterSaveDraft, deleteDraft: d.painterDeleteDraft, wishes: d.painterWishes,
      share: d.painterShare, gallery: d.painterGallery, exportPack: d.painterExport, code: d.painterCode, studio: d.painterStudio,
    },
  });
  return { d, ipc, skinsDir, wardrobeDir, calls };
}

test('a good skin is saved, read back, and everyone hears', async () => {
  const { d, ipc, skinsDir, calls } = setup();
  const r = await ipc.invoke('skins:save', mine());
  assert.equal(r.ok, true, r.error);
  assert.equal(r.id, 'frosty-k3x9');
  assert.ok(Array.isArray(r.warnings));
  const file = path.join(skinsDir, 'frosty-k3x9.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).pixels, classic.pixels);
  assert.deepEqual(fs.readdirSync(skinsDir), ['frosty-k3x9.json'], 'written atomically: no temp file left');
  assert.equal(calls.broadcastWardrobe, 1, 'the same reload and broadcast as Settings → Reload');
  assert.ok(d.skins.some(s => s.id === 'frosty-k3x9' && s.source === 'user'));
  const back = await ipc.invoke('skins:read', 'frosty-k3x9');
  assert.equal(back.ok, true);
  assert.equal(back.source, 'user');
  assert.equal(back.skin.name, 'Frosty');
});

test('ids: only [\\w-]{1,40}, and never a built-in skin\'s or the built-in pack\'s', async () => {
  const { ipc, skinsDir } = setup();
  for (const id of ['../evil', 'a b', 'x'.repeat(41), '', 7, 'con/x']) {
    const r = await ipc.invoke('skins:save', mine({ id }));
    assert.equal(r.ok, false, `${JSON.stringify(id)} refused`);
  }
  assert.equal((await ipc.invoke('skins:save', mine({ id: 'classic' }))).ok, false, 'a built-in skin');
  assert.match((await ipc.invoke('skins:save', mine({ id: 'ghost' }))).error, /ships with/, 'a built-in pack skin');
  assert.deepEqual(fs.readdirSync(skinsDir), []);
});

test('main checks strictly, whatever the panel sent', async () => {
  const { ipc, skinsDir } = setup();
  assert.match((await ipc.invoke('skins:save', mine({ parts: { ...classic.parts, l: 'rocket' } }))).error, /unknown part/);
  assert.match((await ipc.invoke('skins:save', mine({ onClick: 'alert(1)' }))).error, /unknown field/);
  assert.match((await ipc.invoke('skins:save', mine({ pixels: Array(33).fill('S') }))).error, /rows/);
  assert.match((await ipc.invoke('skins:save', mine({ id: 'Frosty' }))).error, /lowercase/);
  // A colour with no part blocks saving: it wouldn't move with him.
  const { l: _l, ...noLegs } = classic.parts;
  assert.match((await ipc.invoke('skins:save', mine({ parts: noLegs }))).error, /no part/);
  assert.equal((await ipc.invoke('skins:save', 'nope')).ok, false);
  assert.deepEqual(fs.readdirSync(skinsDir), []);
});

test('saving over your own skin needs replace; the crab\'s window can\'t save at all', async () => {
  const { ipc } = setup();
  assert.equal((await ipc.invoke('skins:save', mine())).ok, true);
  assert.match((await ipc.invoke('skins:save', mine({ name: 'Frostier' }))).error, /already have/);
  assert.equal((await ipc.invoke('skins:save', mine({ name: 'Frostier' }), { replace: true })).ok, true);
  await assert.rejects(ipc.invokeAs(ipc.senders.critter, 'skins:save', mine()), /Not allowed/);
  await assert.rejects(ipc.invokeAs(ipc.senders.critter, 'painter:draft-save', {}), /Not allowed/);
});

test('a locked pack skin can\'t be a starting point; an unlocked gallery one credits its pack', async () => {
  const { ipc, wardrobeDir, d } = setup();
  assert.match((await ipc.invoke('skins:read', 'ghost')).error, /locked/);
  fs.mkdirSync(wardrobeDir, { recursive: true });
  fs.writeFileSync(path.join(wardrobeDir, 'skin-snow.json'), JSON.stringify({ format: 1, id: 'skin-snow', name: 'Snow', author: 'pal', version: '1.0.0', skins: [{ ...classic, id: 'snow' }] }));
  d.wardrobe.load();
  const r = await ipc.invoke('skins:read', 'skin-snow/snow');
  assert.equal(r.ok, true);
  assert.equal(r.basedOn, 'skin-snow');
  assert.equal(r.skin.id, 'snow');
  assert.equal((await ipc.invoke('skins:read', 'nope')).ok, false);
});

test('drafts: kept, listed newest first, trimmed to what a draft is, and deleted', async () => {
  const { ipc } = setup();
  const G = require('../src/renderer/shared/pixel-grid');
  const doc = G.fromSkin(classic);
  assert.equal((await ipc.invoke('painter:draft-save', { id: 'tide-aaaa', mode: 'skin', name: 'Tide', doc, evil: 'x', onPurpose: ['no-eyes', '<script>'] })).ok, true);
  await new Promise(r => setTimeout(r, 5));
  assert.equal((await ipc.invoke('painter:draft-save', { id: 'reef-bbbb', mode: 'skin', name: 'Reef', doc })).ok, true);
  const list = await ipc.invoke('painter:drafts');
  assert.deepEqual(list.map(x => x.id), ['reef-bbbb', 'tide-aaaa']);
  assert.equal(list[1].evil, undefined);
  assert.deepEqual(list[1].onPurpose, ['no-eyes']);
  assert.deepEqual(list[1].doc.frames[0], classic.pixels);
  // Not a drawing: refused.
  assert.equal((await ipc.invoke('painter:draft-save', { id: 'bad', mode: 'skin', doc: { ...doc, w: 99 } })).ok, false);
  assert.equal((await ipc.invoke('painter:draft-save', { id: '../up', mode: 'skin', doc })).ok, false);
  assert.equal(await ipc.invoke('painter:draft-delete', '../up'), false);
  assert.equal(await ipc.invoke('painter:draft-delete', 'tide-aaaa'), true);
  assert.deepEqual((await ipc.invoke('painter:drafts')).map(x => x.id), ['reef-bbbb']);
});

test('try him on the desk: the crab wears it for a minute, null takes it off', async () => {
  const { d, ipc, calls } = setup();
  const r = await ipc.invoke('skins:preview', mine());
  assert.equal(r.ok, true);
  assert.ok(r.until > Date.now() + 50 * 1000);
  assert.equal(d.deskPreview.skin.id, 'frosty-k3x9');
  assert.equal(calls.broadcastSkin, 1);
  assert.equal((await ipc.invoke('skins:preview', null)).ok, true);
  assert.equal(d.deskPreview, null);
  assert.equal(calls.broadcastSkin, 2);
  assert.equal((await ipc.invoke('skins:preview', { pixels: 'no' })).ok, false);
});

test('an accessory saves as a pack of your own, and lists as yours', async () => {
  const { ipc, wardrobeDir } = setup();
  const cap = { id: 'cap-aaaa', name: 'Cap', slot: 'hat', pivot: [1, 1], palette: { a: '#111111' }, pixels: ['aaa', '.a.'] };
  const r = await ipc.invoke('painter:save-item', 'accessory', cap);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.key, 'acc-cap-aaaa/cap-aaaa');
  assert.ok(fs.existsSync(path.join(wardrobeDir, 'acc-cap-aaaa.json')));
  assert.match((await ipc.invoke('painter:save-item', 'accessory', cap)).error, /already have/);
  assert.equal((await ipc.invoke('painter:save-item', 'accessory', cap, { replace: true })).ok, true);
  const items = await ipc.invoke('painter:items', 'accessory');
  assert.ok(items.find(i => i.key === 'acc-cap-aaaa/cap-aaaa').mine);
  assert.ok(items.some(i => !i.mine && i.source === 'builtin'));
  assert.ok(items.filter(i => i.locked).every(i => i.item === null), 'a locked one shows no art to copy');
  assert.equal((await ipc.invoke('painter:save-item', 'accessory', { ...cap, slot: 'tail' })).ok, false, 'checked like any pack');
  assert.equal((await ipc.invoke('painter:save-item', 'skin', cap)).ok, false);
});

test('share: wrapped, installed, published with the wish line, the contest page opened and the wish told', async () => {
  const github = { can: f => f === 'publish', view: () => ({ login: 'crabfan' }), gh: () => ({ post: async (p, body) => { github.posted.push([p, body]); return {}; } }), posted: [] };
  const config = fakeConfig();
  const { ipc, calls, wardrobeDir } = setup({ github, config });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ format: 1, packs: [{ id: 'skin-frosty-k3x9', version: '1.0.2', by: 'crabFan' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    assert.equal((await ipc.invoke('painter:share', 'skin', 'frosty-k3x9')).ok, false, 'saved first');
    await ipc.invoke('skins:save', mine());
    const r = await ipc.invoke('painter:share', 'skin', 'frosty-k3x9', { contest: '2026-11', wish: 12 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.version, '1.0.3', 'the gallery had 1.0.2');
    const [pub] = calls.published;
    assert.equal(pub.packId, 'skin-frosty-k3x9');
    assert.equal(pub.opts.forLine, 'For x-salmon/shellby#12');
    assert.equal(pub.json.contest, '2026-11');
    assert.equal(pub.json.skins[0].id, 'frosty-k3x9');
    assert.equal(pub.opts.update, '1.0.2', 'an update of your own pack says so, with the version it has now');
    assert.equal(pub.onDiskWhenAsked, null, 'nothing written before the yes');
    assert.ok(fs.existsSync(path.join(wardrobeDir, 'skin-frosty-k3x9.json')), 'installed once the pull request is open');
    const wishSpec = calls.specs.find(s => s.title === 'Tell the wish you made it?');
    assert.equal(wishSpec.defaultId, wishSpec.cancelId, 'Not now by default');
    assert.match(electron.callsOf('shell.openExternal').at(-1)[0], /discussions\/new\?category=contest-entries/);
    assert.deepEqual(calls.asked, ['Tell the wish you made it?']);
    assert.equal(github.posted[0][0], '/repos/x-salmon/shellby/issues/12/comments');
    assert.match(github.posted[0][1].body, /pull\/7/);
    assert.equal(r.commented, true);
    const shares = config.get('painterShares');
    assert.equal(shares['skin-frosty-k3x9'].version, '1.0.3');
    // Not yet in the gallery at 1.0.3: In review.
    assert.equal((await ipc.invoke('painter:gallery'))['skin-frosty-k3x9'].state, 'review');
    assert.equal((await ipc.invoke('painter:code', 'skin', 'frosty-k3x9')).ok, false, 'no outfit code until it is in');
    // A bad contest month or wish never reaches main's share.
    await ipc.invoke('painter:share', 'skin', 'frosty-k3x9', { contest: 'soon', wish: -1 });
    assert.equal(calls.published.at(-1).json.contest, undefined);
    assert.equal(calls.published.at(-1).opts.forLine, '');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// The registry answers with these packs for a share test.
async function withRegistry(packs, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ format: 1, packs }), { status: 200, headers: { 'content-type': 'application/json' } });
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}
const signedIn = () => ({ can: f => f === 'publish', view: () => ({ login: 'crabfan' }), gh: () => ({ post: async () => ({}) }) });
const galleryPack = over => ({ format: 1, id: 'skin-frosty-k3x9', name: 'Theirs', author: 'pal', version: '1.0.5', skins: [{ ...classic, id: 'frosty-k3x9', name: 'Theirs' }], ...over });

test('share: Cancel writes nothing, and never touches a gallery pack installed under that id', async () => {
  const { ipc, calls, wardrobeDir, d } = setup({ github: signedIn() });
  calls.publishAnswer = 'no';
  await ipc.invoke('skins:save', mine());
  await withRegistry([], async () => {
    const r = await ipc.invoke('painter:share', 'skin', 'frosty-k3x9');
    assert.equal(r.canceled, true);
    assert.equal(calls.published.length, 1);
    assert.equal(fs.existsSync(path.join(wardrobeDir, 'skin-frosty-k3x9.json')), false, 'Cancel: nothing installed');
    // Someone's gallery pack with that id, installed: never written over, asked or not.
    fs.mkdirSync(wardrobeDir, { recursive: true });
    const theirs = JSON.stringify(galleryPack());
    fs.writeFileSync(path.join(wardrobeDir, 'skin-frosty-k3x9.json'), theirs);
    d.wardrobe.load();
    calls.publishAnswer = 'yes';
    const again = await ipc.invoke('painter:share', 'skin', 'frosty-k3x9');
    assert.equal(again.ok, false);
    assert.match(again.error, /didn’t make/);
    assert.equal(calls.published.length, 1, 'not even asked');
    assert.equal(fs.readFileSync(path.join(wardrobeDir, 'skin-frosty-k3x9.json'), 'utf8'), theirs);
  });
});

test('share: an id someone else has in the gallery is refused, yours (by login or shared here) is an update', async () => {
  const { ipc, calls, wardrobeDir } = setup({ github: signedIn() });
  await ipc.invoke('skins:save', mine());
  for (const entry of [{ id: 'skin-frosty-k3x9', version: '1.0.5', by: 'pal' }, { id: 'skin-frosty-k3x9', version: '1.0.5' }]) {
    const r = await withRegistry([entry], () => ipc.invoke('painter:share', 'skin', 'frosty-k3x9'));
    assert.equal(r.ok, false);
    assert.equal(r.taken, true);
    assert.match(r.error, /isn’t yours.*Rename/);
  }
  assert.deepEqual(calls.published, [], 'never asked, never published over theirs');
  assert.equal(fs.existsSync(path.join(wardrobeDir, 'skin-frosty-k3x9.json')), false);
  // Offline: no way to tell whose the name is, so not now.
  assert.match((await ipc.invoke('painter:share', 'skin', 'frosty-k3x9')).error, /Couldn’t reach the gallery/);

  // Shared from this PC before: yours, even with no `by` in the registry.
  const config = fakeConfig({ painterShares: { 'skin-frosty-k3x9': { kind: 'skin', id: 'frosty-k3x9', version: '1.0.5', url: 'u', at: 1, listed: true } } });
  const mineHere = setup({ github: signedIn(), config });
  await mineHere.ipc.invoke('skins:save', mine());
  const r = await withRegistry([{ id: 'skin-frosty-k3x9', version: '1.0.5', by: 'old-login' }], () => mineHere.ipc.invoke('painter:share', 'skin', 'frosty-k3x9'));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.version, '1.0.6');
  assert.equal(mineHere.calls.published[0].opts.update, '1.0.5');
});

test('save-item: never writes over a pack the Painter didn\'t make, and writes only the item\'s own fields', async () => {
  const { ipc, wardrobeDir, d } = setup();
  const cap = { id: 'cap-aaaa', name: 'Cap', slot: 'hat', pivot: [1, 1], palette: { a: '#111111' }, pixels: ['aaa', '.a.'] };
  fs.mkdirSync(wardrobeDir, { recursive: true });
  const theirs = JSON.stringify({ format: 1, id: 'acc-cap-aaaa', name: 'Their cap', author: 'pal', version: '2.0.0', accessories: [{ ...cap, name: 'Their cap' }] });
  fs.writeFileSync(path.join(wardrobeDir, 'acc-cap-aaaa.json'), theirs);
  d.wardrobe.load();
  const r = await ipc.invoke('painter:save-item', 'accessory', cap, { replace: true });
  assert.equal(r.ok, false);
  assert.match(r.error, /didn’t make/);
  assert.equal(fs.readFileSync(path.join(wardrobeDir, 'acc-cap-aaaa.json'), 'utf8'), theirs);

  const ok = await ipc.invoke('painter:save-item', 'accessory', { ...cap, id: 'brim-bbbb', evil: 'x'.repeat(100000), onLoad: 'alert(1)' });
  assert.equal(ok.ok, true, ok.error);
  const written = JSON.parse(fs.readFileSync(path.join(wardrobeDir, 'acc-brim-bbbb.json'), 'utf8'));
  assert.equal(written.accessories[0].evil, undefined);
  assert.equal(written.accessories[0].onLoad, undefined);
  assert.equal((await ipc.invoke('painter:save-item', 'accessory', { ...cap, id: 'brim-bbbb', name: 'Brim 2' }, { replace: true })).ok, true, 'your own, written over when asked');
});

test('share without GitHub explains, and asks for nothing', async () => {
  const { ipc, calls } = setup({ github: { can: () => false, view: () => ({}) } });
  await ipc.invoke('skins:save', mine());
  const r = await ipc.invoke('painter:share', 'skin', 'frosty-k3x9');
  assert.equal(r.ok, false);
  assert.equal(r.needsGitHub, true);
  assert.deepEqual(calls.published, []);
});

test('In the gallery once the registry lists the version you shared', async () => {
  const config = fakeConfig({ painterShares: { 'skin-frosty-k3x9': { kind: 'skin', id: 'frosty-k3x9', version: '1.0.0', url: 'u', at: 1, listed: false } } });
  const { ipc } = setup({ config });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ format: 1, packs: [{ id: 'skin-frosty-k3x9', version: '1.0.0' }] }), { status: 200 });
  try {
    assert.equal((await ipc.invoke('painter:gallery'))['skin-frosty-k3x9'].state, 'gallery');
    assert.equal(config.get('painterShares')['skin-frosty-k3x9'].listed, true);
    const code = await ipc.invoke('painter:code', 'skin', 'frosty-k3x9');
    assert.match(code.code, /^SHB-/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
