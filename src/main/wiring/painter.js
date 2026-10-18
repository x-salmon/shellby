// The Painter (docs/plans/crab-painter.md): saving what you paint, trying it on
// the desktop crab, its drafts, pack wishes, and sharing it to the community
// gallery. The panel's channels are in ipc/wardrobe.js; the pure parts are
// painter.js (drafts, wishes), wardrobe/wrap.js (one thing as a pack) and
// renderer/shared/pixel-grid.js (the checks, the same ones the panel shows).
// Kept out of main.js, which only wires it up.
const { app, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const G = require('../../renderer/shared/pixel-grid');
const painter = require('../painter');
const { loadSkins, validate: validateSkin, saveSkin: writeSkin } = require('../skins');
const { validatePack, packPath, PACK_ID_RE } = require('../wardrobe/catalog');
const { KNOWN_ACHIEVEMENTS } = require('../wardrobe/achievements');
const { KNOWN_SEASONS } = require('../wardrobe/seasons');
const { publicItem } = require('../wardrobe/service');
const { encodeOutfit } = require('../wardrobe/codes');
const wrap = require('../wardrobe/wrap');
const { fetchRegistryIndex } = require('../registry');

const PREVIEW_MS = 60 * 1000;      // "Try him on the desk"
const GALLERY_CHECK_MS = 3600 * 1000; // In review -> In the gallery, at most hourly
const STUDIO_URL = 'https://getshellby.com/community/studio/';
const known = { knownAchievements: KNOWN_ACHIEVEMENTS, knownSeasons: KNOWN_SEASONS };
const LOOSE_ID = /^[\w-]{1,40}$/;
const CATALOG_FIELD = { accessory: 'accessories', effect: 'effects', decor: 'decor' };

/** d: what main shares (main.js `shared`). */
function wirePainter(d) {
  const painterDir = () => path.join(app.getPath('userData'), 'painter');
  const draftsDir = () => path.join(painterDir(), 'drafts');
  const wishesFile = () => path.join(painterDir(), 'wishes.json');

  // The skins folder read again, the wardrobe too, and everyone told: what
  // Settings → Reload does, and what saving a skin does after it writes.
  function reloadSkins() {
    d.skins = loadSkins(d.userSkinsDir());
    d.wardrobe?.load();
    d.broadcastWardrobe();
    return d.allSkins();
  }

  // ------------------------------------------------------------ skins

  // Ids a skin of yours can't take: the built-in skins and the built-in pack's.
  const reservedSkinIds = () => new Set([
    ...d.skins.filter(s => s.source === 'builtin').map(s => s.id),
    ...(d.wardrobe?.catalog.skins || []).filter(s => s.source === 'builtin').map(s => s.key),
  ]);

  /**
   * A skin to start from or edit, by id: a built-in, one of yours, or a pack's
   * you've unlocked (a locked one would hand out its unlock).
   * -> { ok, skin, source, basedOn? } | { ok: false, error }
   */
  function readSkin(id) {
    if (typeof id !== 'string' || id.length > 81) return { ok: false, error: 'No such skin.' };
    const loose = d.skins.find(s => s.id === id);
    if (loose) {
      const { source, ...skin } = loose;
      return { ok: true, skin, source };
    }
    const packed = d.wardrobe?.catalog.skins.find(s => s.key === id);
    if (!packed) return { ok: false, error: 'No such skin.' };
    if (d.wardrobe.lockInfo(packed)) return { ok: false, error: "That one's still locked, so it can't be a starting point." };
    const { palette, parts, pixels, anchors, name, author, description } = packed;
    // A gallery skin is CC BY 4.0: a copy says what it was based on.
    return { ok: true, skin: { id: packed.key.split('/').pop(), name, author, description, palette, parts, pixels, anchors }, source: packed.source, ...(packed.source === 'user' ? { basedOn: packed.packId } : {}) };
  }

  /**
   * Save a skin from the Painter: checked strictly here (never trust the panel),
   * written to the skins folder, then everyone reloads. opts.replace: it was
   * saved under this id before (Save again, or Edit on your own).
   * -> { ok, id, warnings } | { ok: false, error }
   */
  function saveSkin(raw, { replace = false } = {}) {
    if (typeof raw?.id !== 'string' || !LOOSE_ID.test(raw.id)) return { ok: false, error: 'That name can’t be a skin id.' };
    const { skin, errors } = validateSkin(raw, { strict: true });
    if (!skin) return { ok: false, error: `The skin has a problem: ${errors[0]}` };
    if (reservedSkinIds().has(raw.id)) return { ok: false, error: 'That id belongs to a skin Shellby ships with.' };
    const mine = d.skins.find(s => s.id === raw.id && s.source === 'user');
    if (mine && !replace) return { ok: false, error: 'You already have a skin with that id.' };
    const doc = G.fromSkin(raw);
    const list = G.checks(doc, raw);
    const block = list.find(c => c.blocks === 'save');
    if (block) return { ok: false, error: block.text };
    const out = G.toSkin(doc, { id: raw.id, name: raw.name, author: raw.author, description: raw.description, basedOn: skin.basedOn });
    try { writeSkin(d.userSkinsDir(), out); } catch (e) { return { ok: false, error: `Couldn't save it: ${e.code || e.message}` }; }
    reloadSkins();
    return { ok: true, id: out.id, warnings: list.filter(c => c.level !== 'block').map(c => c.text) };
  }

  // ------------------------------------------------------------ on the desk

  let previewTimer = null;
  /** The crab wears this drawing for a minute, then his own skin again. null ends it now. */
  function previewSkin(raw) {
    clearTimeout(previewTimer);
    if (!raw) { d.deskPreview = null; d.broadcastSkin(); return { ok: true, until: 0 }; }
    const { skin, errors } = validateSkin(raw, 'preview');
    if (!skin) return { ok: false, error: errors[0] };
    const until = Date.now() + PREVIEW_MS;
    d.deskPreview = { skin: { ...skin, source: 'preview' }, until };
    d.broadcastSkin();
    previewTimer = setTimeout(() => { d.deskPreview = null; d.broadcastSkin(); }, PREVIEW_MS);
    return { ok: true, until };
  }

  // ------------------------------------------------------------ accessories, effects, decor

  // Your own things, saved from the Painter as a pack each (wrap.js): written
  // straight in, since you made them. Refuses an id a built-in pack has, and a
  // pack of yours the Painter didn't make.
  function writeOwnPack(pack, { replace = false } = {}) {
    const { pack: p, errors, warnings } = validatePack(pack, { ...known, source: 'user' });
    if (!p) return { ok: false, error: `It has a problem: ${errors[0]}` };
    if (warnings.length) return { ok: false, error: `It has a problem: ${warnings[0]}` };
    const w = d.wardrobe;
    if (!w) return { ok: false, error: 'Shellby is still starting. Try again in a moment.' };
    if (w.catalog.packs.some(x => x.source === 'builtin' && x.id === pack.id)) return { ok: false, error: 'That id belongs to a built-in pack.' };
    const dest = packPath(w.userDir, pack.id);
    if (!dest) return { ok: false, error: 'That name can’t be a pack id.' };
    if (fs.existsSync(dest) && !replace) return { ok: false, error: 'You already have a pack with that id.' };
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(pack, null, 2));
      fs.renameSync(tmp, dest);
    } catch (e) { return { ok: false, error: `Couldn't save it: ${e.code || e.message}` }; }
    w.load();
    w.emit('changed');
    return { ok: true, packId: pack.id };
  }

  const installedVersion = packId => d.wardrobe?.catalog.packs.find(p => p.id === packId && p.source === 'user')?.version || null;

  /** Save an accessory, effect or piece of decor as a pack of your own. -> { ok, packId, key } */
  function saveItem(kind, item, { replace = false } = {}) {
    if (!CATALOG_FIELD[kind]) return { ok: false, error: 'The Painter can’t save that kind of thing.' };
    const prev = installedVersion(wrap.packIdFor(kind, item?.id));
    const pack = wrap.wrapItem(kind, item, { login: d.github?.view().login || '' });
    if (!pack) return { ok: false, error: 'That name can’t be an id.' };
    if (prev) pack.version = prev; // saving isn't sharing: the version moves when it goes to the gallery
    const r = writeOwnPack(pack, { replace });
    return r.ok ? { ...r, key: `${pack.id}/${item.id}` } : r;
  }

  /**
   * Everything of a kind you could start from: { key, name, packId, source,
   * locked, mine, item }. A locked one is listed (so it isn't a mystery) but
   * can't be opened, like a locked skin.
   */
  function listItems(kind) {
    const field = CATALOG_FIELD[kind];
    const w = d.wardrobe;
    if (!field || !w) return [];
    const all = [...w.catalog[field].values()];
    return all.map(it => ({
      key: it.key, name: it.name, packId: it.packId, source: it.source,
      locked: !!w.lockInfo(it),
      mine: it.source === 'user' && it.packId === wrap.packIdFor(kind, it.id),
      item: w.lockInfo(it) ? null : publicItem(it),
    }));
  }

  // ------------------------------------------------------------ drafts

  const listDrafts = () => painter.listDrafts(draftsDir());
  const saveDraft = draft => painter.saveDraft(draftsDir(), draft);
  const deleteDraft = id => painter.deleteDraft(draftsDir(), id);

  // ------------------------------------------------------------ pack wishes

  let wishesInFlight = null;
  /** Up to three open pack wishes of a kind, newest first (cached a day; none when offline). */
  async function wishes(kind) {
    let cache = null;
    try { cache = JSON.parse(fs.readFileSync(wishesFile(), 'utf8')); } catch { /* none yet */ }
    wishesInFlight ||= painter.fetchWishes({ api: d.githubEndpoints?.().api, cache }).finally(() => { wishesInFlight = null; });
    const r = await wishesInFlight;
    if (r.fresh) { try { fs.mkdirSync(painterDir(), { recursive: true }); fs.writeFileSync(wishesFile(), JSON.stringify({ at: r.at, wishes: r.wishes })); } catch { /* next time */ } }
    return r.wishes.filter(w => !kind || w.kind === kind).slice(0, 3);
  }

  // ------------------------------------------------------------ sharing

  // What's going out: your skin from the folder, or your own pack's item.
  function shareable(kind, id) {
    if (kind === 'skin') {
      const s = d.skins.find(x => x.id === id && x.source === 'user');
      if (!s) return { error: 'Save it first, then share it.' };
      let raw;
      try { raw = JSON.parse(fs.readFileSync(path.join(d.userSkinsDir(), `${id}.json`), 'utf8')); } catch { return { error: "Couldn't read that skin's file." }; }
      const { skin, errors } = validateSkin(raw, { strict: true });
      if (!skin) return { error: `The skin has a problem: ${errors[0]}` };
      // Warnings you can call on purpose are the Painter's to ask about; what blocks, blocks here too.
      const block = G.checks(G.fromSkin(raw), raw).find(c => c.level === 'block');
      if (block) return { error: block.text };
      const { source: _s, ...clean } = skin;
      return { item: { ...clean, ...(raw.anchors ? { anchors: raw.anchors } : {}), author: raw.author || '' }, name: skin.name };
    }
    const field = CATALOG_FIELD[kind];
    const packId = wrap.packIdFor(kind, id);
    const file = packId && d.wardrobe ? packPath(d.wardrobe.userDir, packId) : null;
    if (!field || !file || !fs.existsSync(file)) return { error: 'Save it first, then share it.' };
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      const item = (json[field] || []).find(x => x.id === id);
      if (!item) return { error: "Couldn't find it in its pack." };
      return { item, name: item.name };
    } catch { return { error: "Couldn't read its pack." }; }
  }

  const shares = () => (d.config.get('painterShares') && typeof d.config.get('painterShares') === 'object' ? d.config.get('painterShares') : {});

  /**
   * Share to the gallery: wrap it in a pack (wrap.js), install that pack (so
   * it's one of yours, which is what publishing takes, replacing an earlier
   * wrap), then the usual confirm and pull request (confirmAndPublishPack).
   * opts: { contest: 'YYYY-MM' to enter it, wish: the pack wish's number }.
   * -> confirmAndPublishPack's answer, plus { packId, version, commented, contestUrl }
   */
  async function share(kind, id, { contest = null, wish = null } = {}) {
    if (!d.github?.can('publish')) return { ok: false, needsGitHub: true, error: 'Sign in to GitHub and turn on "Publish Wardrobe packs" in Settings → GitHub to share from here.' };
    const got = shareable(kind, id);
    if (got.error) return { ok: false, error: got.error };
    const packId = wrap.packIdFor(kind, id);
    if (!packId) return { ok: false, error: 'That name can’t be a pack id.' };
    const index = await fetchRegistryIndex({ baseUrl: d.registryUrl() });
    const prev = index.ok ? index.packs.find(p => p.id === packId) || null : null;
    const login = d.github.view().login || '';
    const pack = wrap.wrapItem(kind, got.item, { login, prev, contest });
    const installed = writeOwnPack(pack, { replace: true });
    if (!installed.ok) return installed;
    const number = Number.isInteger(wish) && wish > 0 ? wish : null;
    const r = await d.confirmAndPublishPack(packId, { forLine: wrap.wishLine(number) });
    if (!r.ok) return { ...r, packId };
    d.config.set({ painterShares: { ...shares(), [packId]: { kind, id, version: pack.version, url: r.url, at: Date.now(), listed: false, ...(pack.contest ? { contest: pack.contest } : {}) } } });
    let contestUrl = null;
    if (pack.contest) {
      contestUrl = wrap.contestEntryUrl({ name: got.name, packId, month: pack.contest, prUrl: r.url });
      shell.openExternal(contestUrl);
    }
    const commented = number ? await tellTheWish(number, got.name, r.url) : false;
    return { ...r, packId, version: pack.version, commented, contestUrl };
  }

  // A pull request in shellby-packs can't close an issue in shellby, so the
  // wish hears about it as a comment, from your own account, if you say so.
  async function tellTheWish(number, name, url) {
    const response = await d.askOnce({
      icon: '💌',
      title: 'Tell the wish you made it?',
      message: `Comment on ${wrap.GALLERY_REPO}#${number} with a link to "${name}", as @${d.github.view().login}`,
      detail: 'Whoever wished for it gets a notification. The maintainer closes the wish once your pack is in the gallery.',
      buttons: [{ label: 'Comment', style: 'primary' }, { label: 'Not now' }], defaultId: 0, cancelId: 1,
    });
    if (response !== 0) return false;
    try {
      await d.github.gh().post(`/repos/${wrap.GALLERY_REPO}/issues/${number}/comments`, { body: `I made this for the wish: ${url}\n\n(Shared from the Shellby Painter.)` });
      return true;
    } catch (e) {
      d.log?.warn('wish comment failed', e?.message);
      return false;
    }
  }

  let galleryCheckedAt = 0;
  /**
   * What became of what you shared: { [packId]: { id, kind, state: 'review' |
   * 'gallery', url, version } }. Asks the registry when it's been an hour.
   */
  async function galleryStatus({ refresh = true } = {}) {
    let all = shares();
    const waiting = Object.values(all).some(s => !s.listed);
    if (refresh && waiting && Date.now() - galleryCheckedAt > GALLERY_CHECK_MS) {
      galleryCheckedAt = Date.now();
      const index = await fetchRegistryIndex({ baseUrl: d.registryUrl() });
      if (index.ok) {
        const next = { ...all };
        for (const [packId, s] of Object.entries(all)) {
          const hit = index.packs.find(p => p.id === packId);
          if (hit && hit.version === s.version && !s.listed) next[packId] = { ...s, listed: true };
        }
        if (JSON.stringify(next) !== JSON.stringify(all)) { d.config.set({ painterShares: next }); all = next; }
      }
    }
    return Object.fromEntries(Object.entries(all).filter(([k]) => PACK_ID_RE.test(k)).map(([k, s]) => [k, { id: s.id, kind: s.kind, state: s.listed ? 'gallery' : 'review', url: s.url, version: s.version }]));
  }

  /** "Save a file": the pack as it would be shared, for a pull request by hand (docs/ADDONS.md). */
  async function exportPack(kind, id) {
    const got = shareable(kind, id);
    if (got.error) return { ok: false, error: got.error };
    const pack = wrap.wrapItem(kind, got.item, { login: d.github?.view().login || '' });
    if (!pack) return { ok: false, error: 'That name can’t be a pack id.' };
    const r = await dialog.showSaveDialog(d.panel, {
      title: 'Save the pack', defaultPath: path.join(app.getPath('documents'), `${pack.id}.json`),
      filters: [{ name: 'Shellby pack', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    try { fs.writeFileSync(r.filePath, `${JSON.stringify(pack, null, 2)}\n`); } catch (e) { return { ok: false, error: `Couldn't write it: ${e.code || e.message}` }; }
    return { ok: true, path: r.filePath };
  }

  /** An outfit code for a skin that's in the gallery: anyone can wear it from that. */
  function galleryCode(kind, id) {
    const packId = wrap.packIdFor(kind, id);
    if (kind !== 'skin' || !packId || !shares()[packId]?.listed) return { ok: false };
    return { ok: true, code: encodeOutfit({}, `${packId}/${id}`) };
  }

  const openStudio = () => shell.openExternal(STUDIO_URL);

  return {
    reloadSkins,
    painterReadSkin: readSkin, painterSaveSkin: saveSkin, painterPreview: previewSkin, painterSaveItem: saveItem, painterItems: listItems,
    painterDrafts: listDrafts, painterSaveDraft: saveDraft, painterDeleteDraft: deleteDraft, painterWishes: wishes,
    painterShare: share, painterGallery: galleryStatus, painterExport: exportPack, painterCode: galleryCode, painterStudio: openStudio,
  };
}

module.exports = { wirePainter, PREVIEW_MS, STUDIO_URL };
