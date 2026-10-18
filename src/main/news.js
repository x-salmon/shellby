// Community news: a small feed on the gallery's site (news.json beside
// index.json, built from news/*.json in x-salmon/shellby-packs), so "the
// November contest is open" can reach people without a release. See
// docs/plans/community-events.md §2 and docs/COMMUNITY.md.
//
// The feed is data only and is checked strictly: an unknown kind, a bad date,
// a link off the three allowed sites or a bad pack id drops that item alone,
// and every string is clipped and stripped of control characters. The gallery
// checks the same rules when an item is added (its Pack check copies these).
//
// Why it isn't signed: it's served from a repository the maintainer controls,
// it holds no code or HTML, and the worst a bad item can do is show a wrong
// line that links to one of the allowed sites. A signature would add a key to
// keep safe for no more than that.
//
// Pure: no I/O, no clock (callers pass "today", as d.today() gives it, so
// SHELLBY_TODAY moves the news with the seasons and events). See test/news.test.js.

const FORMAT = 1;
const MAX_BYTES = 64 * 1024;
const MAX_ITEMS = 50;
const MAX_SEEN = 200;
const KINDS = Object.freeze(['contest', 'winner', 'event', 'featured', 'note']);
const CONTEST_KINDS = Object.freeze(['skin', 'accessory', 'effect', 'voice', 'scene', 'decor']);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/; // registry.js and wardrobe/catalog.js
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const TITLE_MAX = 60;
const BODY_MAX = 200;
const THEME_MAX = 40;
const URL_MAX = 300;
// Where a news item may link: Shellby's own repository, its site, and the gallery's.
const URL_PREFIXES = Object.freeze(['https://github.com/x-salmon/', 'https://getshellby.com/', 'https://x-salmon.github.io/']);
// Which kind shows first when several are current.
const ORDER = { contest: 0, winner: 1, event: 2, featured: 3, note: 4 };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const pad = n => String(n).padStart(2, '0');
/** A Date as the feed's local 'YYYY-MM-DD'. */
const dayOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Plain text, one line, at most `max` characters; '' when it isn't a string. */
function clip(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/** A real calendar day as 'YYYY-MM-DD', or null. */
function realDay(v) {
  const m = DAY_RE.exec(typeof v === 'string' ? v : '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(y, mo - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d ? v : null;
}

/** An https link to one of the allowed sites, or null. */
function allowedUrl(v) {
  if (typeof v !== 'string' || v.length > URL_MAX) return null;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const href = u.href;
  return URL_PREFIXES.some(p => href.startsWith(p) && href.length > p.length) ? href : null;
}

/** "November 2026" for '2026-11'. */
function monthName(key) {
  const m = MONTH_RE.exec(key || '');
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/**
 * One item, checked. -> the clean item, or null to drop it.
 *   { id, kind, title, body, url, from, until, contest?, pack? }
 */
function cleanItem(raw) {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
  if (!KINDS.includes(raw.kind)) return null;
  const title = clip(raw.title, TITLE_MAX);
  if (!title) return null;
  const from = realDay(raw.from), until = realDay(raw.until);
  if (!from || !until || until < from) return null;
  const item = { id: raw.id, kind: raw.kind, title, body: clip(raw.body, BODY_MAX), url: null, from, until };
  if (raw.url !== undefined && raw.url !== null) {
    item.url = allowedUrl(raw.url);
    if (!item.url) return null;
  }
  // A contest item says which month, its theme and what may enter; nothing else has one.
  if (raw.kind === 'contest') {
    const c = raw.contest;
    if (!isObj(c) || !MONTH_RE.test(c.month || '')) return null;
    const theme = clip(c.theme, THEME_MAX);
    const kinds = Array.isArray(c.kinds) ? [...new Set(c.kinds)] : [];
    if (!theme || !kinds.length || !kinds.every(k => CONTEST_KINDS.includes(k))) return null;
    item.contest = { month: c.month, theme, kinds, monthName: monthName(c.month) };
  } else if (raw.contest !== undefined) return null;
  // A registry pack, only on a winner or a featured item: what Get it installs.
  if (raw.pack !== undefined) {
    if (!['winner', 'featured'].includes(raw.kind) || typeof raw.pack !== 'string' || !PACK_ID_RE.test(raw.pack)) return null;
    item.pack = raw.pack;
  }
  return item;
}

/**
 * The whole feed, checked. Never throws. A feed in another format, or not a
 * feed at all, is null (yesterday's copy stays); a bad item is dropped alone.
 * -> { format, items } | null
 */
function cleanFeed(raw) {
  if (!isObj(raw) || raw.format !== FORMAT || !Array.isArray(raw.items)) return null;
  const items = [];
  const ids = new Set();
  for (const r of raw.items.slice(0, MAX_ITEMS * 2)) {
    const it = cleanItem(r);
    if (!it || ids.has(it.id)) continue;
    ids.add(it.id);
    items.push(it);
    if (items.length >= MAX_ITEMS) break;
  }
  return { format: FORMAT, items };
}

/** Bytes from the fetch as a feed: too big or unreadable is null. */
function parseFeed(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) return null;
  try { return cleanFeed(JSON.parse(text.replace(/^﻿/, ''))); } catch { return null; }
}

const current = (it, today) => it.from <= today && today <= it.until;
const byOrder = (a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.from < b.from ? 1 : a.from > b.from ? -1 : 0) || (a.id < b.id ? -1 : 1);

/**
 * What to show today: the current items you haven't closed, most important
 * first (a contest, a winner, an event, a featured pack, a note), and the
 * current contest whether you closed its card or not (the Painter offers it).
 *   today: a Date (d.today()) or 'YYYY-MM-DD'
 * -> { items, contest }
 */
function pick(feedIn, today, seenIn = []) {
  const feed = cleanFeed(feedIn) || { items: [] };
  const day = today instanceof Date ? dayOf(today) : realDay(today);
  if (!day) return { items: [], contest: null };
  const seen = new Set(cleanSeen(seenIn));
  const on = feed.items.filter(it => current(it, day)).sort(byOrder);
  return { items: on.filter(it => !seen.has(it.id)), contest: on.find(it => it.kind === 'contest') || null };
}

/** Closed items' ids, as kept and synced: good ids only, newest last, capped. */
function cleanSeen(raw) {
  const list = (Array.isArray(raw) ? raw : []).filter(id => typeof id === 'string' && ID_RE.test(id));
  return [...new Set(list)].slice(-MAX_SEEN);
}

/** Two PCs' closed items together (github/sync.js): closed on either is closed. */
const mergeSeen = (a, b) => cleanSeen([...cleanSeen(a), ...cleanSeen(b)]);

/** Close one: it isn't shown again, on this PC or (with Sync) any other. */
const markSeen = (seen, id) => (typeof id === 'string' && ID_RE.test(id) ? mergeSeen(seen, [id]) : cleanSeen(seen));

/** config `news`, read from disk: { feed, fetchedAt, triedAt, seen }. */
function normalize(raw) {
  const r = isObj(raw) ? raw : {};
  const time = v => (Number.isFinite(v) && v > 0 ? v : 0);
  return { feed: cleanFeed(r.feed), fetchedAt: time(r.fetchedAt), triedAt: time(r.triedAt), seen: cleanSeen(r.seen) };
}

module.exports = {
  FORMAT, MAX_BYTES, KINDS, CONTEST_KINDS, URL_PREFIXES, ID_RE,
  clip, allowedUrl, monthName, cleanItem, cleanFeed, parseFeed, pick, cleanSeen, mergeSeen, markSeen, normalize, dayOf,
};
