// Where pages live on disk, and the only code that writes there.
//
//   <root>\<id>\
//     state.json      on or off, what you agreed to, pinned, its versions' log,
//                     and how it syncs (where it goes, its stamps, a version waiting)
//     data.json       { values, by, gone }: the page data, who wrote each key, and
//                     when each removed key went (so a sync doesn't bring it back)
//     activity.json   the last 200 writes
//     thumb.jpg       the shelf's miniature (written by the service)
//     pending.jpg     the miniature a new version from another PC came with
//     v\<n>\          version n: its files and its page.json
//   <root>\.drafts\<draft-id>\   the same, for a page still being built
//   <root>\.sync.json            { gone: { id: at } }: pages deleted here, for the sync
//
// The current version is state.version. A save writes a new v\<n> and keeps
// the last 20; going back copies an old one forward, so nothing is lost. A
// version from another PC (arrive) is written like a save but, when you've
// agreed to a version here, waits as state.sync.pending until you turn it on.
// Everything read back is checked again (format.js), since a page's folder is
// as untrusted as what wrote it. Writes go through writeFileDurable.
//
// Sync fs on small files, in main only: one writer, no interleaving.
// test/pages-store.test.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LIMITS } = require('./limits');
const format = require('./format');
const { writeFileDurable } = require('../durable');

const DRAFTS = '.drafts';
const SYNC_FILE = '.sync.json';
const MAX_GONE = 200;
const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });
const { whoOf } = format;
const WHERE = ['everywhere', 'here'];
const DATA_WHERE = ['with', 'here'];
const num = v => (Number.isFinite(v) && v > 0 ? v : 0);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
const writeJson = (file, value) => writeFileDurable(file, JSON.stringify(value));

/** One version's line in the log: { n, at, who, why, pc } (pc: the PC it came from, or null for this one). */
function versionOf(v) {
  return { n: v.n, at: Number(v.at) || 0, who: whoOf(v.who), why: format.line(v.why, LIMITS.WHY), pc: format.line(v.pc, 64) || null };
}

/**
 * How a page syncs (sync/pages.js): where it goes, its data's choice, the
 * stamp of the newest version this PC knows (at), the stamp the gist last
 * agreed on (sharedAt), which PC changed it last (from; null: this one), a
 * version from another PC waiting to be looked at (pending), and a version
 * of this PC's that lost to another PC's later one (lost).
 */
function syncOf(raw, fallbackAt) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const p = s.pending && typeof s.pending === 'object' && Number.isInteger(s.pending.n) && s.pending.n > 0 ? s.pending : null;
  const l = s.lost && typeof s.lost === 'object' && Number.isInteger(s.lost.n) && s.lost.n > 0 ? s.lost : null;
  return {
    where: WHERE.includes(s.where) ? s.where : 'everywhere',
    data: DATA_WHERE.includes(s.data) ? s.data : 'with',
    at: num(s.at) || fallbackAt || 1,
    sharedAt: num(s.sharedAt),
    from: format.pcOf(s.from),
    pending: p ? { n: p.n, at: num(p.at), from: format.pcOf(p.from), why: format.line(p.why, LIMITS.WHY), who: whoOf(p.who) } : null,
    lost: l ? { n: l.n, at: num(l.at), from: format.pcOf(l.from) } : null,
  };
}

/** A page that came from another PC and hasn't been looked at here: { kind, from, at, quiet }. */
function arrivedOf(raw) {
  const a = raw && typeof raw === 'object' ? raw : null;
  if (!a || !['new', 'changed'].includes(a.kind)) return null;
  return { kind: a.kind, from: format.pcOf(a.from), at: num(a.at), quiet: a.quiet === true };
}

function stateOf(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const access = a => (a ? format.accessOf(a) : null);
  const agreed = access(s.agreed);
  const added = access(s.added);
  const version = Number.isInteger(s.version) && s.version > 0 ? s.version : 1;
  const versions = (Array.isArray(s.versions) ? s.versions : [])
    .filter(v => v && Number.isInteger(v.n) && v.n > 0)
    .map(versionOf)
    .slice(-LIMITS.VERSIONS);
  return {
    version,
    enabled: s.enabled !== false,
    agreed: agreed?.ok ? agreed.access : null,
    added: added?.ok ? added.access : { ...format.NO_ACCESS },
    pinned: s.pinned === true,
    notifyOn: s.notifyOn !== false,
    wants: s.wants === 'add' ? 'add' : null,
    from: ['here', 'routine', 'terminal', 'pc'].includes(s.from) ? s.from : 'here',
    tab: typeof s.tab === 'string' ? s.tab.slice(0, 100) : null,
    createdAt: Number.isFinite(s.createdAt) ? s.createdAt : 0,
    updatedAt: Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
    openedAt: num(s.openedAt),
    lastChange: s.lastChange && typeof s.lastChange === 'object'
      ? { text: format.line(s.lastChange.text, 120), at: Number(s.lastChange.at) || 0 } : null,
    versions,
    broken: s.broken && typeof s.broken === 'object' ? { message: format.line(s.broken.message, 300), at: Number(s.broken.at) || 0 } : null,
    // A page from before it could sync counts as changed when its version was made.
    sync: syncOf(s.sync, versions.find(v => v.n === version)?.at || num(s.createdAt)),
    arrived: arrivedOf(s.arrived),
  };
}

/** How big a value is as JSON, or Infinity if it isn't JSON. */
function jsonBytes(v) {
  try { const s = JSON.stringify(v); return s === undefined ? Infinity : Buffer.byteLength(s, 'utf8'); } catch { return Infinity; }
}

/**
 * @param {string} root  the pages folder (userData\pages)
 * @param {{ now?: () => number }} [o]
 */
function createStore(root, { now = Date.now } = {}) {
  const dirOf = id => (format.isDraftId(id) ? path.join(root, DRAFTS, id) : path.join(root, id));
  const known = id => (format.isId(id) || format.isDraftId(id)) && fs.existsSync(path.join(dirOf(id), 'state.json'));
  const vdir = (id, n) => path.join(dirOf(id), 'v', String(n));

  function ids() {
    try {
      return fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && format.isId(e.name) && known(e.name)).map(e => e.name);
    } catch { return []; }
  }
  function draftIds() {
    try { return fs.readdirSync(path.join(root, DRAFTS)).filter(id => format.isDraftId(id) && known(id)); } catch { return []; }
  }

  const state = id => stateOf(readJson(path.join(dirOf(id), 'state.json'), null));
  const saveState = (id, s) => writeJson(path.join(dirOf(id), 'state.json'), s);

  function manifest(id, n) {
    const s = state(id);
    const m = format.manifestOf(readJson(path.join(vdir(id, n ?? s.version), 'page.json'), null), { id: format.isId(id) ? id : null });
    return m.ok ? m.manifest : null;
  }

  /** A version's files as { name: text }. Names are checked again on the way out. */
  function files(id, n) {
    if (!known(id)) return null;
    const dir = vdir(id, n ?? state(id).version);
    const out = {};
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name === 'page.json' || !format.isFileName(name)) continue;
        out[name] = fs.readFileSync(path.join(dir, name), 'utf8');
      }
    } catch { return null; }
    return out;
  }

  /** One file of the current version (or version n), for the protocol: a Buffer or null. */
  function readFile(id, name, n) {
    if (!known(id) || !format.isFileName(name)) return null;
    const file = path.join(vdir(id, n ?? state(id).version), name);
    if (path.dirname(file) !== vdir(id, n ?? state(id).version)) return null;
    try { return fs.readFileSync(file); } catch { return null; }
  }

  /** Write version n of id, then keep the newest LIMITS.VERSIONS. */
  function writeVersion(id, n, man, fileMap) {
    const dir = vdir(id, n);
    const tmp = `${dir}.tmp-${crypto.randomBytes(3).toString('hex')}`;
    fs.mkdirSync(tmp, { recursive: true });
    for (const [name, text] of Object.entries(fileMap)) fs.writeFileSync(path.join(tmp, name), text);
    fs.writeFileSync(path.join(tmp, 'page.json'), JSON.stringify(man, null, 2));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    let vs = [];
    try { vs = fs.readdirSync(path.join(dirOf(id), 'v')).map(Number).filter(Number.isInteger).sort((a, b) => a - b); } catch { /* none yet */ }
    for (const old of vs.slice(0, Math.max(0, vs.length - LIMITS.VERSIONS))) fs.rmSync(vdir(id, old), { recursive: true, force: true });
  }

  function freshId(name) {
    const base = format.slug(name);
    if (!fs.existsSync(dirOf(base))) return base;
    for (let i = 2; i < 1000; i++) {
      const id = `${base.slice(0, 36)}-${i}`;
      if (!fs.existsSync(dirOf(id))) return id;
    }
    return `${base.slice(0, 30)}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * A new page or draft from a checked manifest and files.
   * o: { draft, who, why, enabled, wants, from, tab }
   */
  function create(man, fileMap, o = {}) {
    if (o.draft && draftIds().length >= LIMITS.DRAFTS) return no(`There are already ${LIMITS.DRAFTS} drafts. Save or delete one first.`);
    if (!o.draft && ids().length >= LIMITS.PAGES) return no(`There are already ${LIMITS.PAGES} pages, the most Shellby keeps.`);
    const id = o.draft ? `draft-${crypto.randomBytes(6).toString('hex').slice(0, 8)}` : freshId(man.name);
    fs.mkdirSync(dirOf(id), { recursive: true });
    const at = now();
    writeVersion(id, 1, { ...man, id: o.draft ? null : id }, fileMap);
    saveState(id, {
      version: 1, enabled: o.enabled !== false, agreed: null, added: { ...format.NO_ACCESS },
      pinned: false, notifyOn: true, wants: o.wants || null, from: o.from || 'here', tab: o.tab || null,
      createdAt: at, updatedAt: at, lastChange: { text: 'Made', at },
      versions: [{ n: 1, at, who: whoOf(o.who), why: format.line(o.why, LIMITS.WHY) || 'First version' }],
      sync: { where: 'everywhere', data: 'with', at, sharedAt: 0, from: null, pending: null, lost: null },
    });
    writeJson(path.join(dirOf(id), 'data.json'), { values: {}, by: {}, gone: {} });
    return ok({ id, version: 1 });
  }

  /** A new version of id's files (and maybe page.json). -> { version, growth } */
  /** @param {string} id @param {any} man @param {Record<string, string>} fileMap @param {{ who?: any, why?: string }} [o] */
  function update(id, man, fileMap, { who, why } = {}) {
    if (!known(id)) return no(`There's no page "${String(id).slice(0, 40)}".`);
    const s = state(id);
    const n = Math.max(s.version, ...s.versions.map(v => v.n)) + 1;
    writeVersion(id, n, { ...man, id: format.isId(id) ? id : null }, fileMap);
    const at = now();
    const versions = [...s.versions, { n, at, who: whoOf(who), why: format.line(why, LIMITS.WHY), pc: null }].slice(-LIMITS.VERSIONS);
    // A change made here: it's this PC's newest, and anything waiting from another PC stays in History only.
    const sync = { ...s.sync, at, from: null, pending: null, lost: null };
    saveState(id, { ...s, version: n, versions, updatedAt: at, broken: null, lastChange: { text: format.line(why, 120) || `Version ${n}`, at }, sync, arrived: null });
    return ok({ version: n, growth: format.accessGrowth(s.agreed, man.access) });
  }

  // ------------------------------------------------------- from another PC
  /**
   * A version from another PC (sync/pages.js): { at, from, why, who } are
   * the other PC's. A page new here is made with the gist's id, switched off
   * and with its access not agreed. One you've agreed to here keeps running,
   * and the new version waits as sync.pending until you turn it on; one never
   * agreed here just takes the new version. A version of this PC's that the
   * gist never saw is kept in History and named in sync.lost.
   * -> { version, kind: 'new' | 'changed' }
   */
  function arrive(id, man, fileMap, { at, from, why, who }) {
    if (!format.isId(id)) return no('Not a page id.');
    const stamp = num(at) || 1;
    if (!known(id)) {
      if (ids().length >= LIMITS.PAGES) return no(`There are already ${LIMITS.PAGES} pages, the most Shellby keeps.`);
      fs.mkdirSync(dirOf(id), { recursive: true });
      const made = now();
      writeVersion(id, 1, { ...man, id }, fileMap);
      saveState(id, {
        version: 1, enabled: false, agreed: null, added: { ...format.NO_ACCESS },
        pinned: false, notifyOn: true, wants: null, from: 'pc', tab: null,
        createdAt: made, updatedAt: made, lastChange: { text: `Came from ${from?.name || 'another PC'}`, at: made },
        versions: [{ n: 1, at: stamp, who: whoOf(who), why: format.line(why, LIMITS.WHY) || 'First version', pc: from?.name || null }],
        sync: { where: 'everywhere', data: 'with', at: stamp, sharedAt: stamp, from, pending: null, lost: null },
        arrived: { kind: 'new', from, at: made, quiet: false },
      });
      writeJson(path.join(dirOf(id), 'data.json'), { values: {}, by: {}, gone: {} });
      forgetGone(id);
      return ok({ id, version: 1, kind: 'new' });
    }
    const s = state(id);
    const n = Math.max(s.version, ...s.versions.map(v => v.n)) + 1;
    writeVersion(id, n, { ...man, id }, fileMap);
    const made = now();
    const versions = [...s.versions, { n, at: stamp, who: whoOf(who), why: format.line(why, LIMITS.WHY), pc: from?.name || null }].slice(-LIMITS.VERSIONS);
    // This PC changed it since the gist last saw it: that version lost, and stays a version here.
    const lost = s.sync.at > s.sync.sharedAt && !s.sync.pending ? { n: s.version, at: s.sync.at, from } : s.sync.lost;
    const waits = !!s.agreed;
    const sync = { ...s.sync, at: stamp, sharedAt: stamp, from, pending: waits ? { n, at: stamp, from, why: format.line(why, LIMITS.WHY), who: whoOf(who) } : null, lost };
    saveState(id, {
      ...s, version: waits ? s.version : n, versions, updatedAt: made, sync,
      lastChange: { text: `${waits ? 'A new version' : 'Changed'} from ${from?.name || 'another PC'}`, at: made },
      arrived: { kind: waits ? 'changed' : 'new', from, at: made, quiet: false },
    });
    return ok({ id, version: n, kind: waits ? 'changed' : 'new' });
  }

  /**
   * Turn it on: you looked at what came from another PC and agreed. shown is
   * the version the sheet showed (the one waiting, or the current one), so a
   * version arriving meanwhile is looked at again.
   */
  function turnOn(id, shown) {
    if (!known(id) || format.isDraftId(id)) return no('No such page.');
    const s = state(id);
    const n = s.sync.pending?.n ?? s.version;
    if (n !== shown) return no('The page changed while you were looking. Have another look at what it asks for.');
    const man = manifest(id, n);
    if (!man) return no("The version can't be read.");
    const at = now();
    const from = s.sync.pending?.from || s.arrived?.from;
    const text = s.sync.pending ? `Turned on the version from ${from?.name || 'another PC'}` : 'Turned on';
    saveState(id, {
      ...s, version: n, agreed: man.access, enabled: true, wants: null, broken: null, arrived: null,
      sync: { ...s.sync, pending: null }, updatedAt: at, lastChange: { text, at },
    });
    try { fs.rmSync(pendingThumbFile(id), { force: true }); } catch { /* none */ }
    if (s.sync.pending) {
      const t = thumb(id);
      const pt = readPendingThumb(id);
      if (pt && !t) fs.writeFileSync(thumbFile(id), pt);
    }
    return ok({ version: n });
  }

  /** Not on this PC: it stays as it is (off, or running your version) and quiet until it next changes elsewhere. */
  function decline(id) {
    if (!known(id)) return no('No such page.');
    const s = state(id);
    if (!s.arrived) return ok();
    saveState(id, { ...s, arrived: { ...s.arrived, quiet: true } });
    return ok();
  }

  /** Where it goes: the page Everywhere or This PC only, and its data with it or staying here. */
  function setWhere(id, patch) {
    if (!known(id) || format.isDraftId(id)) return no('No such page.');
    const s = state(id);
    const sync = { ...s.sync };
    if (WHERE.includes(patch?.where)) sync.where = patch.where;
    if (DATA_WHERE.includes(patch?.data)) sync.data = patch.data;
    saveState(id, { ...s, sync });
    return ok({ sync });
  }

  /** The gist agreed on stamp `at` for this page (after a sync). */
  function markShared(id, at) {
    if (!known(id)) return;
    const s = state(id);
    if (s.sync.sharedAt === at) return;
    saveState(id, { ...s, sync: { ...s.sync, sharedAt: at } });
  }

  /** You opened it: pages travel in the order they were last opened. */
  function touchOpened(id) {
    if (!known(id) || format.isDraftId(id)) return;
    const s = state(id);
    const at = now();
    if (at - s.openedAt < 60_000) return;
    saveState(id, { ...s, openedAt: at });
  }

  // Pages deleted here, so a sync doesn't bring one back: <root>\.sync.json { gone: { id: at } }.
  const syncFile = () => path.join(root, SYNC_FILE);
  function syncState() {
    const raw = readJson(syncFile(), null);
    const g = raw && typeof raw === 'object' && raw.gone && typeof raw.gone === 'object' ? raw.gone : {};
    const gone = Object.fromEntries(Object.entries(g).filter(([id, at]) => format.isId(id) && num(at)).sort((x, y) => y[1] - x[1]).slice(0, MAX_GONE));
    return { gone };
  }
  function forgetGone(id) {
    const { gone } = syncState();
    if (!(id in gone)) return;
    const { [id]: _g, ...rest } = gone;
    writeJson(syncFile(), { gone: rest });
  }

  /** Go back to version n: a new version with n's files. */
  function revert(id, n, who) {
    if (!known(id)) return no('No such page.');
    const s = state(id);
    if (!s.versions.some(v => v.n === n) || !fs.existsSync(vdir(id, n))) return no(`Version ${n} isn't kept any more.`);
    const man = manifest(id, n);
    const fileMap = files(id, n);
    if (!man || !fileMap) return no(`Version ${n} can't be read.`);
    return update(id, man, fileMap, { who, why: `Went back to version ${n}` });
  }

  /** A draft becomes a page: it gets an id from its name and lands on the shelf. */
  function saveDraft(draftId) {
    if (!format.isDraftId(draftId) || !known(draftId)) return no('That draft is gone.');
    if (ids().length >= LIMITS.PAGES) return no(`There are already ${LIMITS.PAGES} pages, the most Shellby keeps.`);
    const man = manifest(draftId);
    if (!man) return no("The draft's page.json can't be read.");
    const id = freshId(man.name);
    fs.renameSync(dirOf(draftId), dirOf(id));
    const s = state(id);
    // Each version's page.json learns its id.
    for (const v of s.versions) {
      const f = path.join(vdir(id, v.n), 'page.json');
      const m = readJson(f, null);
      if (m) fs.writeFileSync(f, JSON.stringify({ ...m, id }, null, 2));
    }
    const at = now();
    saveState(id, { ...s, tab: null, from: 'here', lastChange: { text: 'Saved to your pages', at }, sync: { ...s.sync, at, sharedAt: 0, from: null } });
    // What the preview wrote was sample data: the page starts empty.
    writeJson(path.join(dirOf(id), 'data.json'), { values: {}, by: {}, gone: {} });
    try { fs.rmSync(path.join(dirOf(id), 'activity.json'), { force: true }); } catch { /* none */ }
    forgetGone(id);
    return ok({ id });
  }

  /** Delete it. A page (not a draft) leaves a marker so the sync deletes it on your other PCs too, and doesn't bring it back. */
  function remove(id) {
    if (!known(id)) return no('No such page.');
    fs.rmSync(dirOf(id), { recursive: true, force: true });
    if (format.isId(id)) {
      const { gone } = syncState();
      writeJson(syncFile(), { gone: { ...gone, [id]: now() } });
    }
    return ok();
  }

  const META = ['enabled', 'pinned', 'notifyOn'];
  /** On/off, pinned, Tell me when it changes. Pinned is capped by the caller. */
  function setMeta(id, patch) {
    if (!known(id)) return no('No such page.');
    const s = state(id);
    const next = { ...s };
    for (const k of META) if (typeof patch?.[k] === 'boolean') next[k] = patch[k];
    if (patch?.enabled === true) next.wants = null;
    saveState(id, next);
    return ok({ state: stateOf(next) });
  }

  /** Who may write: any, shellby or none. Lives in page.json, so it's a new version. */
  function setAgents(id, agents, who) {
    if (!format.AGENTS.includes(agents)) return no('agents is any, shellby or none.');
    const man = manifest(id);
    const fileMap = files(id);
    if (!man || !fileMap) return no('No such page.');
    if (man.agents === agents) return ok({ version: state(id).version });
    const words = { any: 'any conversation', shellby: "Shellby's own conversations", none: 'nobody' };
    return update(id, { ...man, agents }, fileMap, { who, why: `Agents: ${words[agents]} may write` });
  }

  /**
   * You said Let it to what version `shown` asks for. Refused if the page has
   * changed since (a newer version may ask for more than you saw).
   */
  function agree(id, shown) {
    const man = manifest(id);
    if (!man) return no('No such page.');
    const s = state(id);
    if (s.version !== shown) return no('The page changed while you were looking. Have another look at what it asks for.');
    saveState(id, { ...s, agreed: man.access, enabled: true, wants: null });
    return ok();
  }

  /** "Let it" on a refused host: added by you, kept apart from what Claude asked for. */
  function addHost(id, rawHost) {
    const host = format.hostOf(rawHost);
    if (!host) return no('Not a host.');
    if (!known(id)) return no('No such page.');
    const s = state(id);
    if (s.added.web.includes(host)) return ok();
    saveState(id, { ...s, added: { ...s.added, web: [...s.added.web, host].slice(0, LIMITS.WEB_HOSTS) } });
    return ok();
  }

  /**
   * What the page may use now: what you agreed to plus what you added, and
   * nothing while it's off or still waiting for your OK. Access a newer
   * version asks for waits for the access sheet.
   */
  function access(id) {
    if (!known(id) || format.isDraftId(id)) return { ...format.NO_ACCESS };
    const s = state(id);
    if (!s.enabled || !s.agreed) return { ...format.NO_ACCESS };
    return format.accessUnion(s.agreed, s.added);
  }

  /** What the current version asks for that you haven't agreed to. */
  function pendingAccess(id) {
    const man = manifest(id);
    if (!man || format.isDraftId(id)) return [];
    return format.accessGrowth(state(id).agreed, man.access);
  }

  // ------------------------------------------------------------- page data
  const dataFile = id => path.join(dirOf(id), 'data.json');
  const plainObj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  function data(id) {
    const raw = readJson(dataFile(id), null);
    const values = plainObj(raw?.values);
    const by = plainObj(raw?.by);
    // When each removed key went, so a sync with an older copy doesn't bring it back.
    const gone = Object.fromEntries(Object.entries(plainObj(raw?.gone)).filter(([k, at]) => format.isDataKey(k) && num(at)).slice(-MAX_GONE));
    return { values, by, gone };
  }

  /** The data, or just these keys. A draft has data of its own, from its preview. */
  function read(id, keys) {
    if (!known(id)) return no('No such page.');
    const { values, by, gone } = data(id);
    if (!Array.isArray(keys) || !keys.length) return ok({ values, by, gone });
    const pick = o => Object.fromEntries(keys.filter(k => Object.hasOwn(o, k)).map(k => [k, o[k]]));
    return ok({ values: pick(values), by: pick(by), gone });
  }

  /**
   * Change keys: { set: { k: v }, remove: [k], append: { k: item | [items] } }.
   * Every key's change is checked before any is made: all or nothing.
   * -> { changed: [keys], values, appended }
   */
  function write(id, ops, who) {
    if (!known(id)) return no('No such page.');
    const o = ops && typeof ops === 'object' ? ops : {};
    const set = o.set && typeof o.set === 'object' && !Array.isArray(o.set) ? o.set : {};
    const remove = Array.isArray(o.remove) ? o.remove : [];
    const append = o.append && typeof o.append === 'object' && !Array.isArray(o.append) ? o.append : {};
    const keys = [...Object.keys(set), ...remove, ...Object.keys(append)];
    if (!keys.length) return no('Nothing to write: give set, remove or append.');
    for (const k of keys) if (!format.isDataKey(k)) return no(`"${String(k).slice(0, 40)}" isn't a key: 1 to 100 characters, no control characters.`);
    const { values, by, gone } = data(id);
    const next = { ...values };
    const at = now();
    const w = whoOf(who);
    let appended = 0;
    for (const [k, v] of Object.entries(set)) {
      if (jsonBytes(v) > LIMITS.VALUE_BYTES) return no(`${k} is too big: one key holds at most ${LIMITS.VALUE_BYTES / 1024} KB.`);
      next[k] = JSON.parse(JSON.stringify(v));
    }
    for (const k of remove) delete next[k];
    for (const [k, v] of Object.entries(append)) {
      const cur = next[k] === undefined ? [] : next[k];
      if (!Array.isArray(cur)) return no(`${k} isn't a list, so it can't be appended to. Use set.`);
      const items = Array.isArray(v) ? v : [v];
      if (items.some(i => jsonBytes(i) === Infinity)) return no(`What's appended to ${k} must be JSON.`);
      appended += items.length;
      next[k] = [...cur, ...JSON.parse(JSON.stringify(items))].slice(-LIMITS.LIST_ITEMS);
      if (jsonBytes(next[k]) > LIMITS.VALUE_BYTES) return no(`${k} would be too big: one key holds at most ${LIMITS.VALUE_BYTES / 1024} KB.`);
    }
    if (Object.keys(next).length > LIMITS.DATA_KEYS) return no(`A page holds at most ${LIMITS.DATA_KEYS} keys.`);
    if (jsonBytes(next) > LIMITS.DATA_BYTES) return no(`A page's data is at most ${LIMITS.DATA_BYTES / 1024 / 1024} MB.`);
    const nextBy = { ...by };
    const nextGone = { ...gone };
    // op: an append merges item by item with another PC's appends (sync/pages.js); a set replaces.
    const onlyAppended = k => !Object.hasOwn(set, k) && Object.hasOwn(append, k);
    for (const k of new Set(keys)) {
      if (Object.hasOwn(next, k)) { nextBy[k] = { who: w, at, op: onlyAppended(k) ? 'append' : 'set' }; delete nextGone[k]; } else { delete nextBy[k]; nextGone[k] = at; }
    }
    writeJson(dataFile(id), { values: next, by: nextBy, gone: Object.fromEntries(Object.entries(nextGone).slice(-MAX_GONE)) });
    const changed = [...new Set(keys)];
    const text = describeWrite(set, remove, append, appended);
    logActivity(id, { at, who: w, text, keys: changed });
    const s = state(id);
    const whoText = w.kind === 'you' ? 'You' : w.kind === 'page' ? 'On the page' : w.name || 'Someone';
    saveState(id, { ...s, updatedAt: at, lastChange: { text: `${whoText}: ${text}`, at } });
    return ok({ changed, values: Object.fromEntries(changed.filter(k => Object.hasOwn(next, k)).map(k => [k, next[k]])), text });
  }

  /**
   * Data merged in from another PC (sync/pages.js apply): each key as the merge
   * decided it, with the stamp and signature it had there, never re-stamped
   * here (so the two PCs agree next time). from: { pc, name }.
   * -> { changed, values, text, who }
   */
  function arriveData(id, { set = {}, remove = [], gone = {} }, from) {
    if (!known(id) || format.isDraftId(id)) return no('No such page.');
    const { values, by, gone: wasGone } = data(id);
    const next = { ...values };
    const nextBy = { ...by };
    const nextGone = { ...wasGone };
    const parts = [];
    const touched = [];
    for (const [k, e] of Object.entries(plainObj(set))) {
      if (!format.isDataKey(k) || !e || typeof e !== 'object' || jsonBytes(e.v) > LIMITS.VALUE_BYTES) continue;
      const was = next[k];
      next[k] = JSON.parse(JSON.stringify(e.v));
      nextBy[k] = { who: whoOf(e.by?.who), at: num(e.by?.at) || now(), op: e.by?.op === 'append' ? 'append' : 'set', pc: format.line(e.by?.pc, 64) || from?.name || 'another PC' };
      delete nextGone[k];
      touched.push(k);
      const grew = Array.isArray(was) && Array.isArray(next[k]) && next[k].length > was.length;
      parts.push(grew ? `added ${next[k].length - was.length} to ${k}` : `changed ${k}`);
    }
    for (const k of Array.isArray(remove) ? remove : []) {
      if (!format.isDataKey(k) || !Object.hasOwn(next, k)) continue;
      delete next[k]; delete nextBy[k];
      nextGone[k] = num(gone[k]) || now();
      touched.push(k);
      parts.push(`removed ${k}`);
    }
    for (const [k, at] of Object.entries(plainObj(gone))) if (format.isDataKey(k) && num(at) && !Object.hasOwn(next, k)) nextGone[k] = Math.max(nextGone[k] || 0, at);
    if (!touched.length) return ok({ changed: [], values: {}, text: '', who: null });
    if (Object.keys(next).length > LIMITS.DATA_KEYS) return no(`A page holds at most ${LIMITS.DATA_KEYS} keys.`);
    if (jsonBytes(next) > LIMITS.DATA_BYTES) return no(`A page's data is at most ${LIMITS.DATA_BYTES / 1024 / 1024} MB.`);
    writeJson(dataFile(id), { values: next, by: nextBy, gone: Object.fromEntries(Object.entries(nextGone).slice(-MAX_GONE)) });
    const at = now();
    const who = { kind: 'pc', name: from?.name || 'another PC' };
    const text = parts.slice(0, 4).join('; ') + (parts.length > 4 ? ` and ${parts.length - 4} more` : '');
    logActivity(id, { at, who, text, keys: touched });
    const s = state(id);
    saveState(id, { ...s, updatedAt: at, lastChange: { text: `${who.name}: ${text}`.slice(0, 120), at } });
    return ok({ changed: touched, values: Object.fromEntries(touched.filter(k => Object.hasOwn(next, k)).map(k => [k, next[k]])), text, who });
  }

  function describeWrite(set, remove, append, appended) {
    const parts = [];
    if (appended) parts.push(`added ${appended} to ${Object.keys(append).join(', ')}`.slice(0, 80));
    const s = Object.keys(set);
    if (s.length) parts.push(`changed ${s.slice(0, 3).join(', ')}${s.length > 3 ? ` and ${s.length - 3} more` : ''}`);
    if (remove.length) parts.push(`removed ${remove.slice(0, 3).join(', ')}${remove.length > 3 ? ` and ${remove.length - 3} more` : ''}`);
    return parts.join('; ') || 'wrote';
  }

  // -------------------------------------------------------------- activity
  const activityFile = id => path.join(dirOf(id), 'activity.json');
  function activity(id) {
    const raw = readJson(activityFile(id), []);
    return (Array.isArray(raw) ? raw : []).filter(a => a && typeof a === 'object')
      .map(a => ({ at: Number(a.at) || 0, who: whoOf(a.who), text: format.line(a.text, 200), keys: Array.isArray(a.keys) ? a.keys.slice(0, 20).map(String) : [] }))
      .slice(-LIMITS.ACTIVITY);
  }
  function logActivity(id, entry) {
    writeJson(activityFile(id), [...activity(id), entry].slice(-LIMITS.ACTIVITY));
  }

  /** The shelf's view of every page (drafts left out). */
  function list() {
    return ids().map(id => summary(id)).filter(p => p !== null)
      .sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || (b.updatedAt - a.updatedAt));
  }

  function summary(id) {
    const man = manifest(id);
    if (!man) return null;
    const s = state(id);
    const { values } = data(id);
    return {
      id, name: man.name, description: man.description, icon: man.icon, project: man.project, phone: man.phone,
      agents: man.agents, access: man.access, keys: Object.keys(values).slice(0, 50),
      enabled: s.enabled, pinned: s.pinned, notifyOn: s.notifyOn, wants: s.wants, from: s.from,
      version: s.version, updatedAt: s.updatedAt, createdAt: s.createdAt, openedAt: s.openedAt, lastChange: s.lastChange,
      needsOk: !format.isDraftId(id) && s.enabled && format.accessGrowth(s.agreed, man.access).length > 0,
      broken: s.broken,
      sync: { where: s.sync.where, data: s.sync.data, pending: s.sync.pending, lost: s.sync.lost, from: s.sync.from },
      arrived: s.arrived,
    };
  }

  function markBroken(id, message) {
    if (!known(id)) return;
    const s = state(id);
    saveState(id, { ...s, broken: message ? { message: format.line(message, 300), at: now() } : null });
  }

  /** The shelf's miniature: a JPEG, written by the service when a page closes. */
  const thumbFile = id => path.join(dirOf(id), 'thumb.jpg');
  const isJpeg = buf => Buffer.isBuffer(buf) && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  /** pending: the miniature a version waiting from another PC came with, kept apart from this PC's own. */
  function writeThumb(id, jpeg, { pending = false } = {}) {
    if (!known(id) || !isJpeg(jpeg) || jpeg.length > 256 * 1024) return no('No thumb.');
    fs.writeFileSync(pending ? pendingThumbFile(id) : thumbFile(id), jpeg);
    return ok();
  }
  function thumb(id) {
    try { return fs.readFileSync(thumbFile(id)); } catch { return null; }
  }
  const pendingThumbFile = id => path.join(dirOf(id), 'pending.jpg');
  function readPendingThumb(id) {
    try { return fs.readFileSync(pendingThumbFile(id)); } catch { return null; }
  }

  /** Drafts made by one conversation, newest first. */
  function draftsOf(tab) {
    return draftIds().map(id => ({ id, s: state(id) })).filter(d => d.s.tab === tab)
      .sort((a, b) => b.s.updatedAt - a.s.updatedAt).map(d => summary(d.id)).filter(Boolean);
  }

  return {
    root, ids, draftIds, known, state, manifest, files, readFile, create, update, revert, saveDraft, remove,
    setMeta, setAgents, agree, addHost, access, pendingAccess, read, write, activity, list, summary, markBroken, draftsOf, writeThumb, thumb,
    // Between PCs (sync/pages.js, wiring/pages.js)
    arrive, arriveData, turnOn, decline, setWhere, markShared, touchOpened, syncState, pendingThumb: readPendingThumb,
  };
}

module.exports = { createStore, stateOf, whoOf };
