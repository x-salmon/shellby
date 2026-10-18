// The Painter's files and the pack wishes it offers (docs/plans/crab-painter.md).
// Drafts live in %APPDATA%\Shellby\painter\drafts\<id>.json, one per thing
// you're painting, saved a second after every change so closing the panel or a
// crash loses nothing. A draft isn't a skin until you save it. Nothing here
// trusts the panel: every draft is checked and trimmed to its known fields
// before it's written, and read back the same way.
//
// Pack wishes are the open "pack wish" issues on GitHub: what people would like
// someone to make. Read from GitHub's public API, no sign-in, cached for a day.
const fs = require('fs');
const path = require('path');
const G = require('../renderer/shared/pixel-grid');

const DRAFT_ID = /^[\w-]{1,40}$/;
const MAX_DRAFT_BYTES = 256 * 1024;
const MAX_DRAFTS = 60;
const HEX = /^#[0-9a-f]{6}$/i;
const WISH_TTL_MS = 24 * 3600 * 1000;
const WISH_REPO = 'x-salmon/shellby';
// The issue form's "What kind?" answers (.github/ISSUE_TEMPLATE/pack_wish.yml) -> Painter modes.
const WISH_KINDS = { 'Shell or skin': 'skin', 'Accessory or outfit': 'accessory', Effect: 'effect', 'Tank decor': 'decor' };

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]+/g, ' ').slice(0, max) : '');

function draftPath(dir, id) {
  if (typeof id !== 'string' || !DRAFT_ID.test(id)) return null;
  const root = path.resolve(dir);
  const file = path.join(root, `${id}.json`);
  return path.dirname(file) === root ? file : null;
}

// A drawing as main keeps it: only rows of the mode's size, colours that are colours.
function cleanDoc(doc) {
  if (!isObj(doc) || !G.MODES[doc.mode]) return null;
  const m = G.MODES[doc.mode];
  const w = doc.w, h = doc.h;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > m.w || h > m.h) return null;
  if (!Array.isArray(doc.frames) || !doc.frames.length || doc.frames.length > m.frames) return null;
  const frames = doc.frames.map(f => (Array.isArray(f) && f.length === h && f.every(r => typeof r === 'string' && r.length === w) ? [...f] : null));
  if (frames.some(f => !f)) return null;
  const palette = {};
  for (const [k, v] of Object.entries(isObj(doc.palette) ? doc.palette : {})) {
    if (k.length === 1 && k !== G.EMPTY && HEX.test(v) && Object.keys(palette).length < m.palette) palette[k] = v;
  }
  const parts = {};
  for (const [k, v] of Object.entries(isObj(doc.parts) ? doc.parts : {})) if (palette[k] && G.PARTS.includes(v)) parts[k] = v;
  const point = (p, lo, hi) => (Array.isArray(p) && p.length === 2 && p.every(n => Number.isInteger(n) && n >= lo && n <= hi) ? [p[0], p[1]] : null);
  let anchors = null;
  if (isObj(doc.anchors)) {
    anchors = {};
    for (const n of G.ANCHOR_NAMES) anchors[n] = point(doc.anchors[n], ...G.ANCHOR_RANGE);
    if (Object.values(anchors).some(a => !a)) anchors = null;
  }
  const frame = Number.isInteger(doc.frame) && doc.frame >= 0 && doc.frame < frames.length ? doc.frame : 0;
  return { mode: doc.mode, w, h, frames, frame, palette, parts, anchors, pivot: doc.mode === 'accessory' ? point(doc.pivot, -16, 32) : null };
}

/** A draft from the panel (or the disk) made safe, or null if it isn't one. */
function cleanDraft(raw, now = Date.now()) {
  if (!isObj(raw) || !draftPath('.', raw.id)) return null;
  const doc = cleanDoc(raw.doc);
  if (!doc) return null;
  const settings = {};
  for (const [k, v] of Object.entries(isObj(raw.settings) ? raw.settings : {})) {
    if (/^[a-z]{1,12}$/i.test(k) && (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.length <= 20)) settings[k] = v;
  }
  const wish = isObj(raw.wish) && Number.isInteger(raw.wish.number) && raw.wish.number > 0 ? { number: raw.wish.number, title: clip(raw.wish.title, 80) } : null;
  return {
    id: raw.id, mode: doc.mode, doc,
    name: clip(raw.name, 40), author: clip(raw.author, 40), description: clip(raw.description, 120),
    settings, wish,
    onPurpose: Array.isArray(raw.onPurpose) ? raw.onPurpose.filter(s => typeof s === 'string' && /^[a-z-]{1,20}$/.test(s)).slice(0, 12) : [],
    basedOn: typeof raw.basedOn === 'string' && /^[a-z0-9][a-z0-9-]{1,39}$/.test(raw.basedOn) ? raw.basedOn : '',
    // Saved before under this id: Save replaces it rather than refusing a clash.
    saved: raw.saved === true,
    guide: raw.guide === true,
    updatedAt: Number.isFinite(raw.updatedAt) ? Math.min(raw.updatedAt, now) : now,
  };
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Every draft in the folder, newest first. Unreadable ones are skipped. */
function listDrafts(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const file = path.join(dir, f);
      if (fs.statSync(file).size > MAX_DRAFT_BYTES) continue;
      const d = cleanDraft(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (d && `${d.id}.json` === f) out.push(d);
    } catch { /* a half-written or hand-edited file: not a draft */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_DRAFTS);
}

/** -> { ok, draft } | { ok: false, error } */
function saveDraft(dir, raw, now = Date.now()) {
  const d = cleanDraft({ ...(isObj(raw) ? raw : {}), updatedAt: now }, now);
  if (!d) return { ok: false, error: "That isn't a drawing Shellby can keep." };
  const text = JSON.stringify(d);
  if (Buffer.byteLength(text) > MAX_DRAFT_BYTES) return { ok: false, error: 'That drawing is too big to keep.' };
  try { writeAtomic(draftPath(dir, d.id), text); } catch { return { ok: false, error: "Couldn't keep the draft." }; }
  return { ok: true, draft: d };
}

/** -> true if a draft was there and is gone. */
function deleteDraft(dir, id) {
  const file = draftPath(dir, id);
  if (!file) return false;
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

// ------------------------------------------------------------ pack wishes

/** The kind a wish asks for, from the issue form's body ("### What kind?" then the answer). */
function wishKind(body) {
  const m = /###\s*What kind\?\s*\n+\s*([^\n]+)/i.exec(String(body || ''));
  return m ? WISH_KINDS[m[1].trim()] || null : null;
}

/** GitHub's issues as wishes: { number, title, kind, url }, pull requests and odd ones left out. */
function parseWishes(issues) {
  if (!Array.isArray(issues)) return [];
  const out = [];
  for (const i of issues) {
    if (!isObj(i) || i.pull_request || !Number.isInteger(i.number) || i.number < 1) continue;
    const title = clip(String(i.title || '').replace(/^\s*pack wish\s*:\s*/i, ''), 60).trim();
    const kind = wishKind(i.body);
    if (!title || !kind) continue;
    out.push({ number: i.number, title, kind, url: `https://github.com/${WISH_REPO}/issues/${i.number}` });
  }
  return out;
}

/** Wishes kept from before (the cache file), checked again on the way in. */
function cleanWishes(list) {
  const kinds = new Set(Object.values(WISH_KINDS));
  return (Array.isArray(list) ? list : []).filter(w => isObj(w) && Number.isInteger(w.number) && w.number > 0 && kinds.has(w.kind) && typeof w.title === 'string' && w.title.trim())
    .map(w => ({ number: w.number, title: clip(w.title, 60).trim(), kind: w.kind, url: `https://github.com/${WISH_REPO}/issues/${w.number}` }));
}

/**
 * Open pack wishes from GitHub, never throwing. cache: { at, wishes } from
 * before; a fresh one (under a day old) is used as it is, and a failed fetch
 * (offline, rate-limited) keeps it. -> { wishes, at, fresh }
 */
async function fetchWishes({ api = 'https://api.github.com', fetchImpl = globalThis.fetch, cache = null, now = Date.now(), timeoutMs = 10000 } = {}) {
  const kept = isObj(cache) && Array.isArray(cache.wishes) ? { wishes: cleanWishes(cache.wishes), at: Number(cache.at) || 0 } : null;
  if (kept && now - kept.at < WISH_TTL_MS) return { ...kept, fresh: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `${api.replace(/\/+$/, '')}/repos/${WISH_REPO}/issues?labels=${encodeURIComponent('pack wish')}&state=open&per_page=50&sort=created&direction=desc`;
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('too big');
    return { wishes: parseWishes(JSON.parse(text)), at: now, fresh: true };
  } catch {
    return kept ? { ...kept, fresh: false } : { wishes: [], at: 0, fresh: false };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { DRAFT_ID, MAX_DRAFT_BYTES, WISH_TTL_MS, WISH_KINDS, WISH_REPO, draftPath, cleanDoc, cleanDraft, listDrafts, saveDraft, deleteDraft, wishKind, parseWishes, cleanWishes, fetchWishes };
