// Your pages, following you between PCs (github/sync.js), in a gist file of
// their own: shellby-pages.json. The main file's 512 KB is spoken for, and a
// page can be 1.5 MB on its own.
//
// Each page goes on its own and follows whichever PC changed its files last
// (state.sync.at, stamped by the store on every save), with a marker for a
// delete, like routines in sync/plans.js. Its data merges key by key: each key
// follows the PC that wrote it last (data.json's by[key].at), a removed key
// stays removed (data.json's gone), and a list both PCs appended to keeps both
// PCs' items. History doesn't travel: when two PCs changed a page, the later
// save wins and the other PC keeps its own as a version.
//
// A page can be This PC only (it never leaves), and its data can stay on this
// PC while the page goes. Pages travel in the order they were last opened,
// within a budget shared by all of them (LIMITS.SYNC_BYTES); one that doesn't
// fit stays home, and the rest still go.
//
// What arrives is decided here (apply) and done by the store (wiring/pages.js):
// a new page lands switched off with its access not agreed; a changed page keeps
// the version you agreed to running, and the new one waits until you look.
//
// The gist is untrusted input: every page is checked again by the same rules
// as create_page (format.js, checks.js), ids and keys by the store's, sizes
// capped, and nothing in it runs before you've said so here.
// Pure. See test/sync-pages.test.js.
const { LIMITS } = require('../pages/limits');
const format = require('../pages/format');
const checks = require('../pages/checks');

const FILE = 'shellby-pages.json';
const FORMAT = 1;
// The file may run a little over the pages' budget: stamps, markers and the envelope.
const FILE_BYTES = LIMITS.SYNC_BYTES + 128 * 1024;
const MAX_GONE = 200;
const THUMB_B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const num = v => (Number.isFinite(v) && v > 0 ? v : 0);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const json = v => { try { const s = JSON.stringify(v); return s === undefined ? null : s; } catch { return null; } };
const bytes = s => Buffer.byteLength(s, 'utf8');
const sorted = o => Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
const whoOf = raw => format.whoOf(raw);

// -------------------------------------------------------------- cleaning

/** A miniature as it travels: base64 of a JPEG up to SYNC_THUMB_BYTES, or null. */
function cleanThumb(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > Math.ceil(LIMITS.SYNC_THUMB_BYTES * 4 / 3) + 4 || !THUMB_B64_RE.test(raw)) return null;
  const buf = Buffer.from(raw, 'base64');
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? raw : null;
}

/**
 * A page's data as it travels: { keys: { key: { v, at, who, op } }, gone: { key: at } },
 * or null when its data stays on its PC. Keys the store would refuse, values
 * past a key's cap and anything past the page's caps are left out.
 */
function cleanData(raw) {
  if (!isObj(raw)) return null;
  const keys = {};
  let total = 0;
  const entries = Object.entries(isObj(raw.keys) ? raw.keys : {})
    .filter(([k, e]) => format.isDataKey(k) && isObj(e) && e.v !== undefined)
    .map(([k, e]) => [k, { v: Array.isArray(e.v) ? e.v.slice(-LIMITS.LIST_ITEMS) : e.v, at: num(e.at) || 1, who: whoOf(e.who), op: e.op === 'append' ? 'append' : 'set' }])
    .sort(([, a], [, b]) => b.at - a.at); // the newest first, so those are what fits
  for (const [k, e] of entries) {
    const s = json(e.v);
    if (s === null || bytes(s) > LIMITS.VALUE_BYTES) continue;
    if (Object.keys(keys).length >= LIMITS.DATA_KEYS || total + bytes(s) > LIMITS.DATA_BYTES) continue;
    keys[k] = { ...e, v: JSON.parse(s) };
    total += bytes(s);
  }
  const gone = Object.entries(isObj(raw.gone) ? raw.gone : {})
    .filter(([k, at]) => format.isDataKey(k) && !(k in keys) && num(at))
    .sort((x, y) => y[1] - x[1]).slice(0, MAX_GONE);
  return { keys: sorted(keys), gone: sorted(Object.fromEntries(gone)) };
}

/**
 * One page as it travels, checked as if create_page had saved it here, or
 * null when it won't do: { at, from, manifest, files, why, who, thumb, data }.
 */
function cleanItem(id, raw) {
  if (!format.isId(id) || !isObj(raw)) return null;
  const m = format.manifestOf(raw.manifest, { id });
  if (!m.ok) return null;
  const f = checks.filesOf(raw.files);
  if (!f.ok) return null;
  const c = checks.check(f.files, m.manifest.access);
  if (!c.ok) return null;
  return {
    at: num(raw.at) || 1,
    from: format.pcOf(raw.from),
    manifest: m.manifest,
    files: f.files,
    why: format.line(raw.why, LIMITS.WHY),
    who: whoOf(raw.who),
    thumb: cleanThumb(raw.thumb),
    data: cleanData(raw.data),
  };
}

const sizeOf = item => bytes(JSON.stringify(item));

/**
 * The file, cleaned: { format, pages: { id: item }, gone: { id: at } }. Pages
 * are kept in their order while they fit the budget and the page count; one
 * that doesn't fit is left out and the next is tried.
 */
function clean(raw) {
  const r = isObj(raw) ? raw : {};
  const pages = {};
  let used = 0;
  for (const [id, rawItem] of Object.entries(isObj(r.pages) ? r.pages : {})) {
    if (id in pages) continue;
    const item = cleanItem(id, rawItem);
    if (!item) continue;
    const size = sizeOf(item);
    if (Object.keys(pages).length >= LIMITS.PAGES || used + size > LIMITS.SYNC_BYTES) continue;
    pages[id] = item;
    used += size;
  }
  const gone = Object.entries(isObj(r.gone) ? r.gone : {})
    .filter(([id, at]) => format.isId(id) && !(id in pages) && num(at))
    .sort((x, y) => y[1] - x[1]).slice(0, MAX_GONE);
  return { format: FORMAT, pages, gone: sorted(Object.fromEntries(gone)) };
}

// -------------------------------------------------------------- this PC

/**
 * @typedef {{ id: string, state: any, manifest: any, files: Record<string, string>, data: { values: any, by: any, gone: any },
 *   thumb?: Buffer | null, version?: { why?: string, who?: any } | null }} LocalPage
 *   one page here: state is store.state(id); manifest and files are the version that travels
 *   (the one waiting from another PC, else the current one); version is that version's log line.
 * @typedef {{ me: { pc: string, name: string }, gone: Record<string, number>, pages: LocalPage[] }} Local
 */

/** A local page's data as it travels, or null when it stays here. */
function dataOf(page) {
  if (page.state.sync.data === 'here') return null;
  const { values, by, gone } = page.data || { values: {}, by: {}, gone: {} };
  const keys = {};
  for (const [k, v] of Object.entries(isObj(values) ? values : {})) {
    if (!format.isDataKey(k)) continue;
    const b = isObj(by?.[k]) ? by[k] : {};
    keys[k] = { v, at: num(b.at) || 1, who: whoOf(b.who), op: b.op === 'append' ? 'append' : 'set' };
  }
  return { keys, gone: isObj(gone) ? gone : {} };
}

/** A local page as an item for the file, or null when it stays on this PC (This PC only, or waiting to be added). */
function itemOf(page, me) {
  const s = page.state;
  if (s.sync.where === 'here' || s.wants) return null;
  const thumb = page.thumb && Buffer.isBuffer(page.thumb) && page.thumb.length <= LIMITS.SYNC_THUMB_BYTES ? page.thumb.toString('base64') : null;
  return cleanItem(page.id, {
    at: s.sync.at, from: s.sync.from || me, manifest: page.manifest, files: page.files,
    why: page.version?.why || '', who: page.version?.who, thumb, data: dataOf(page),
  });
}

/** Pages in the order they travel: last opened first. */
const travelOrder = pages => [...pages].sort((a, b) => (b.state.openedAt - a.state.openedAt) || (b.state.updatedAt - a.state.updatedAt));

/**
 * What each page takes of the budget and whether it fits, in travel order:
 * { used, budget, pages: [{ id, bytes, fits, where, data }] }. fits is null
 * for a page that doesn't travel at all.
 * @param {Local} local
 */
function measure(local) {
  let used = 0;
  const pages = travelOrder(local.pages).map(p => {
    const item = itemOf(p, local.me);
    const where = p.state.sync.where;
    if (!item) return { id: p.id, bytes: 0, fits: null, where: p.state.wants ? 'waiting' : where, data: p.state.sync.data };
    const size = sizeOf(item);
    const fits = used + size <= LIMITS.SYNC_BYTES;
    if (fits) used += size;
    return { id: p.id, bytes: size, fits, where, data: p.state.sync.data, item };
  });
  return { used, budget: LIMITS.SYNC_BYTES, pages };
}

/** This PC's pages as the file: those that travel and fit, plus markers for the ones deleted here. @param {Local} local */
function snapshot(local) {
  const here = new Set(local.pages.map(p => p.id));
  const pages = {};
  for (const m of measure(local).pages) if (m.fits && m.item) pages[m.id] = m.item;
  const gone = Object.fromEntries(Object.entries(isObj(local.gone) ? local.gone : {}).filter(([id]) => !here.has(id)));
  return clean({ format: FORMAT, pages, gone });
}

// -------------------------------------------------------------- merging

const count = (list, key) => list.reduce((n, i) => n + (JSON.stringify(i) === key ? 1 : 0), 0);

/** Both PCs' appends: the older list's items, then the newer's that it lacks (as many as it has), the oldest dropped past the cap. */
function unionList(older, newer) {
  const out = [...older];
  for (const item of newer) {
    const key = JSON.stringify(item);
    if (count(out, key) < count(newer, key)) out.push(item);
  }
  return out.slice(-LIMITS.LIST_ITEMS);
}

/** A tie between two writes at the same moment, settled the same way on both PCs. */
function tieBreak(ex, ey) {
  const a = Array.isArray(ex.v) && Array.isArray(ey.v) ? ey.v.length - ex.v.length : 0;
  if (a !== 0) return a > 0 ? ey : ex;
  return JSON.stringify(ex.v) <= JSON.stringify(ey.v) ? ex : ey;
}

/** Two copies of a page's data, key by key. Either may be null (that PC keeps its data to itself). */
function mergeData(x, y) {
  if (!x) return y;
  if (!y) return x;
  const keys = {};
  const gone = {};
  for (const k of new Set([...Object.keys(x.keys), ...Object.keys(y.keys), ...Object.keys(x.gone), ...Object.keys(y.gone)])) {
    const ex = x.keys[k], ey = y.keys[k];
    const goneAt = Math.max(num(x.gone[k]), num(y.gone[k]));
    let e = null;
    if (ex && ey) {
      if (ex.at === ey.at) e = same(ex.v, ey.v) ? ex : tieBreak(ex, ey);
      else if (Array.isArray(ex.v) && Array.isArray(ey.v) && ex.op === 'append' && ey.op === 'append') {
        const [older, newer] = ex.at < ey.at ? [ex, ey] : [ey, ex];
        e = { ...newer, v: unionList(older.v, newer.v) };
      } else e = ex.at > ey.at ? ex : ey;
    } else e = ex || ey || null;
    if (e && goneAt > e.at) e = null;
    if (e) keys[k] = e;
    else if (goneAt) gone[k] = goneAt;
  }
  return { keys: sorted(keys), gone: sorted(Object.fromEntries(Object.entries(gone).sort((p, q) => q[1] - p[1]).slice(0, MAX_GONE))) };
}

/**
 * Both PCs' pages: each from whichever changed it last (a tie keeps the item,
 * and between two items, a's: this PC's), its data merged key by key whoever
 * won, deletes as markers. a's order first, then what's new from b, cut to the budget.
 */
function merge(aIn, bIn) {
  const a = clean(aIn), b = clean(bIn);
  const latest = new Map();
  const consider = (id, e) => { const was = latest.get(id); if (!was || e.at > was.at || (e.at === was.at && e.item && !was.item)) latest.set(id, e); };
  for (const side of [a, b]) for (const [id, item] of Object.entries(side.pages)) consider(id, { at: item.at, item });
  for (const side of [a, b]) for (const [id, at] of Object.entries(side.gone)) consider(id, { at, item: null });
  const order = [...new Set([...Object.keys(a.pages), ...Object.keys(b.pages)])].filter(id => latest.get(id).item);
  const pages = {};
  for (const id of order) pages[id] = { ...latest.get(id).item, data: mergeData(a.pages[id]?.data || null, b.pages[id]?.data || null) };
  const gone = Object.fromEntries([...latest].filter(([, e]) => !e.item).map(([id, e]) => [id, e.at]));
  return clean({ format: FORMAT, pages, gone });
}

// -------------------------------------------------------------- arriving

/**
 * What a local copy of a page's data needs to match the merged one:
 * { set: { key: { v, by } }, remove: [key], gone }, or null when nothing.
 */
function dataDiff(local, merged) {
  const values = isObj(local?.values) ? local.values : {};
  const by = isObj(local?.by) ? local.by : {};
  const at = k => num(by[k]?.at) || 1;
  const set = {};
  const remove = [];
  for (const [k, e] of Object.entries(merged.keys)) {
    const have = Object.hasOwn(values, k);
    if (have && at(k) > e.at) continue; // this PC's is newer and wasn't in the file: it stays
    if (!have || at(k) !== e.at || !same(values[k], e.v)) set[k] = { v: e.v, by: { who: e.who, at: e.at, op: e.op } };
  }
  for (const [k, goneAt] of Object.entries(merged.gone)) if (Object.hasOwn(values, k) && !(k in merged.keys) && goneAt >= at(k)) remove.push(k);
  if (!Object.keys(set).length && !remove.length) return null;
  return { set, remove, gone: merged.gone };
}

/**
 * What this PC should do with the merged file, in order, for the store:
 *   { kind: 'new', id, item, data }        a page not here: made switched off, not agreed
 *   { kind: 'changed', id, item }          a later version: waits if a version is agreed here
 *   { kind: 'data', id, set, remove, gone } its data, merged
 *   { kind: 'gone', id }                   deleted later on another PC
 *   { kind: 'shared', id, at }             the gist now agrees with this PC's version
 * A page that's This PC only is left alone, and so is one deleted here later
 * than it changed elsewhere.
 * @param {Local} local
 */
function apply(local, mergedIn) {
  const merged = clean(mergedIn);
  const mine = new Map(local.pages.map(p => [p.id, p]));
  const actions = [];
  for (const [id, item] of Object.entries(merged.pages)) {
    const p = mine.get(id);
    if (p && p.state.sync.where === 'here') continue;
    if (!p) {
      if (num(local.gone?.[id]) >= item.at) continue;
      actions.push({ kind: 'new', id, item, data: item.data ? dataDiff(null, item.data) : null });
      continue;
    }
    if (item.at > p.state.sync.at) actions.push({ kind: 'changed', id, item });
    else if (item.at === p.state.sync.at && p.state.sync.sharedAt !== item.at) actions.push({ kind: 'shared', id, at: item.at });
    if (item.data && p.state.sync.data !== 'here') {
      const diff = dataDiff(p.data, item.data);
      if (diff) actions.push({ kind: 'data', id, ...diff });
    }
  }
  for (const [id, at] of Object.entries(merged.gone)) {
    const p = mine.get(id);
    if (p && p.state.sync.where !== 'here' && at > p.state.sync.at) actions.push({ kind: 'gone', id });
  }
  return actions;
}

/** "2 pages came from your laptop, switched off until you look at them." or '' (nothing new to say). */
function describeArrived(actions) {
  const fresh = actions.filter(a => a.kind === 'new');
  const changed = actions.filter(a => a.kind === 'changed');
  if (!fresh.length && !changed.length) return '';
  const names = [...new Set([...fresh, ...changed].map(a => a.item.from?.name).filter(Boolean))];
  const from = names.length === 1 ? names[0] : 'your other PCs';
  const n = (c, w) => `${c} ${w}${c === 1 ? '' : 's'}`;
  const parts = [];
  if (fresh.length) parts.push(`${n(fresh.length, 'page')} came from ${from}, switched off until you look`);
  if (changed.length) parts.push(`${fresh.length ? 'and ' : ''}${n(changed.length, 'new version')} ${changed.length === 1 ? 'is' : 'are'} waiting${fresh.length ? '' : ` from ${from}`}`);
  return `${parts.join(' ')}.`;
}

const content = merged => JSON.stringify({ ...clean(merged), note: 'Shellby sync: your pages (small apps Claude built), each switched off until you look at it on the PC it arrives on. Safe to delete; Shellby makes a new one.' });

module.exports = { FILE, FILE_BYTES, clean, cleanItem, cleanData, measure, snapshot, merge, mergeData, unionList, dataDiff, apply, describeArrived, content, same: (x, y) => same(clean(x), clean(y)) };
