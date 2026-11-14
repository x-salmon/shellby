// Where pages live on disk, and the only code that writes there.
//
//   <root>\<id>\
//     state.json      on or off, what you agreed to, pinned, its versions' log
//     data.json       { values, by }: the page data, and who wrote each key
//     activity.json   the last 200 writes
//     thumb.png       the shelf's miniature (written by the service)
//     v\<n>\          version n: its files and its page.json
//   <root>\.drafts\<draft-id>\   the same, for a page still being built
//
// The current version is state.version. A save writes a new v\<n> and keeps
// the last 20; going back copies an old one forward, so nothing is lost.
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
const ok = extra => ({ ok: true, ...extra });
const no = error => ({ ok: false, error });
const KEY_RE = /^[^\u0000-\u001f]{1,100}$/;
const WHO_KINDS = ['you', 'page', 'agent', 'routine', 'terminal', 'pc'];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
const writeJson = (file, value) => writeFileDurable(file, JSON.stringify(value));

/** Who did something, cleaned: { kind, name }. */
function whoOf(raw) {
  const w = raw && typeof raw === 'object' ? raw : {};
  return { kind: WHO_KINDS.includes(w.kind) ? w.kind : 'you', name: format.line(w.name, 80) };
}

function stateOf(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const access = a => (a ? format.accessOf(a) : null);
  const agreed = access(s.agreed);
  const added = access(s.added);
  return {
    version: Number.isInteger(s.version) && s.version > 0 ? s.version : 1,
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
    lastChange: s.lastChange && typeof s.lastChange === 'object'
      ? { text: format.line(s.lastChange.text, 120), at: Number(s.lastChange.at) || 0 } : null,
    versions: (Array.isArray(s.versions) ? s.versions : [])
      .filter(v => v && Number.isInteger(v.n) && v.n > 0)
      .map(v => ({ n: v.n, at: Number(v.at) || 0, who: whoOf(v.who), why: format.line(v.why, LIMITS.WHY) }))
      .slice(-LIMITS.VERSIONS),
    broken: s.broken && typeof s.broken === 'object' ? { message: format.line(s.broken.message, 300), at: Number(s.broken.at) || 0 } : null,
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
    });
    writeJson(path.join(dirOf(id), 'data.json'), { values: {}, by: {} });
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
    const versions = [...s.versions, { n, at, who: whoOf(who), why: format.line(why, LIMITS.WHY) }].slice(-LIMITS.VERSIONS);
    saveState(id, { ...s, version: n, versions, updatedAt: at, broken: null, lastChange: { text: format.line(why, 120) || `Version ${n}`, at } });
    return ok({ version: n, growth: format.accessGrowth(s.agreed, man.access) });
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
    saveState(id, { ...s, tab: null, from: 'here', lastChange: { text: 'Saved to your pages', at: now() } });
    // What the preview wrote was sample data: the page starts empty.
    writeJson(path.join(dirOf(id), 'data.json'), { values: {}, by: {} });
    try { fs.rmSync(path.join(dirOf(id), 'activity.json'), { force: true }); } catch { /* none */ }
    return ok({ id });
  }

  function remove(id) {
    if (!known(id)) return no('No such page.');
    fs.rmSync(dirOf(id), { recursive: true, force: true });
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

  /** You said Let it: the page may now use everything its page.json asks for. */
  function agree(id) {
    const man = manifest(id);
    if (!man) return no('No such page.');
    const s = state(id);
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
  function data(id) {
    const raw = readJson(dataFile(id), null);
    const values = raw?.values && typeof raw.values === 'object' && !Array.isArray(raw.values) ? raw.values : {};
    const by = raw?.by && typeof raw.by === 'object' ? raw.by : {};
    return { values, by };
  }

  /** The data, or just these keys. A draft has data of its own, from its preview. */
  function read(id, keys) {
    if (!known(id)) return no('No such page.');
    const { values, by } = data(id);
    if (!Array.isArray(keys) || !keys.length) return ok({ values, by });
    const pick = o => Object.fromEntries(keys.filter(k => Object.hasOwn(o, k)).map(k => [k, o[k]]));
    return ok({ values: pick(values), by: pick(by) });
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
    for (const k of keys) if (typeof k !== 'string' || !KEY_RE.test(k)) return no(`"${String(k).slice(0, 40)}" isn't a key: 1 to 100 characters, no control characters.`);
    const { values, by } = data(id);
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
    for (const k of new Set(keys)) {
      if (Object.hasOwn(next, k)) nextBy[k] = { who: w, at };
      else delete nextBy[k];
    }
    writeJson(dataFile(id), { values: next, by: nextBy });
    const changed = [...new Set(keys)];
    const text = describeWrite(set, remove, append, appended);
    logActivity(id, { at, who: w, text, keys: changed });
    const s = state(id);
    saveState(id, { ...s, updatedAt: at, lastChange: { text: `${w.kind === 'you' ? 'You' : w.name || 'Someone'}: ${text}`, at } });
    return ok({ changed, values: Object.fromEntries(changed.filter(k => Object.hasOwn(next, k)).map(k => [k, next[k]])), text });
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
      version: s.version, updatedAt: s.updatedAt, createdAt: s.createdAt, lastChange: s.lastChange,
      needsOk: !format.isDraftId(id) && s.enabled && format.accessGrowth(s.agreed, man.access).length > 0,
      broken: s.broken,
    };
  }

  function markBroken(id, message) {
    if (!known(id)) return;
    const s = state(id);
    saveState(id, { ...s, broken: message ? { message: format.line(message, 300), at: now() } : null });
  }

  /** Drafts made by one conversation, newest first. */
  function draftsOf(tab) {
    return draftIds().map(id => ({ id, s: state(id) })).filter(d => d.s.tab === tab)
      .sort((a, b) => b.s.updatedAt - a.s.updatedAt).map(d => summary(d.id)).filter(Boolean);
  }

  return {
    root, ids, draftIds, known, state, manifest, files, readFile, create, update, revert, saveDraft, remove,
    setMeta, setAgents, agree, addHost, access, pendingAccess, read, write, activity, list, summary, markBroken, draftsOf,
  };
}

module.exports = { createStore, stateOf, whoOf };
