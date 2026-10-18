// Credits: everyone who has made Shellby, shipped in each release as
// src/community/credits.json and shown on About → Made by. `release:cut`
// adds the authors of merged pull requests and the makers of packs merged
// into the gallery since the last tag; `contest:ship` adds a contest's
// winner. Nobody is ever taken off (merge only adds).
//
//   { format: 1, people: [{ login, for: ['code' | 'pack' | 'contest-YYYY-MM'], packs: [pack ids] }] }
//
// It also decides the contributor trophies (wardrobe/achievements.js): what
// the GitHub login you're signed in with (github/auth.js, the device-flow
// sign-in, never typed in) is credited for here, or in the gallery's index
// (registry.js fetchRegistryIndex, its optional `by`, `contest` and `winner`).
// A determined person could patch their copy to unlock a hat; that's fine.
//
// Pure: no I/O. See test/credits.test.js.

const FORMAT = 1;
const MAX_PEOPLE = 5000;
const MAX_REASONS = 40;
const MAX_PACKS = 60;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;   // github/card.js
const PACK_ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;          // registry.js
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const REASON_RE = /^(code|pack|contest-\d{4}-(0[1-9]|1[0-2]))$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const lower = s => String(s).toLowerCase();
const strings = (raw, re, max) => [...new Set((Array.isArray(raw) ? raw : []).filter(s => typeof s === 'string' && re.test(s)))].sort().slice(0, max);
/** "November 2026" for '2026-11'. */
const monthName = key => (MONTH_RE.test(key || '') ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : '');

/** credits.json as read from disk, made safe. Logins are unique, whatever their case. */
function normalize(raw) {
  const r = isObj(raw) ? raw : {};
  const byLogin = new Map();
  for (const p of (Array.isArray(r.people) ? r.people : []).slice(0, MAX_PEOPLE)) {
    if (!isObj(p) || typeof p.login !== 'string' || !LOGIN_RE.test(p.login) || /\[bot\]$/i.test(p.login)) continue;
    const was = byLogin.get(lower(p.login));
    const reasons = strings([...(was?.for || []), ...(Array.isArray(p.for) ? p.for : [])], REASON_RE, MAX_REASONS);
    const packs = strings([...(was?.packs || []), ...(Array.isArray(p.packs) ? p.packs : [])], PACK_ID_RE, MAX_PACKS);
    byLogin.set(lower(p.login), { login: was?.login || p.login, for: reasons, packs });
  }
  const people = [...byLogin.values()].filter(p => p.for.length || p.packs.length).sort((a, b) => (lower(a.login) < lower(b.login) ? -1 : 1));
  return { format: FORMAT, people };
}

/** Two lists together: everyone in either, every reason and pack. Only ever grows. */
const merge = (a, b) => normalize({ people: [...normalize(a).people, ...normalize(b).people] });

/** One more reason (and packs) for a login. A bad login or reason changes nothing. */
function add(credits, login, reason, packs = []) {
  if (!LOGIN_RE.test(String(login)) || (reason && !REASON_RE.test(reason))) return normalize(credits);
  return merge(credits, { people: [{ login, for: reason ? [reason] : [], packs }] });
}

/** The JSON written back to src/community/credits.json, one person a line so diffs stay small. */
function toText(credits, note) {
  const c = normalize(credits);
  const lines = c.people.map(p => `    ${JSON.stringify({ login: p.login, for: p.for, packs: p.packs }).replace(/^\{/, '{ ').replace(/\}$/, ' }').replace(/":/g, '": ').replace(/,"/g, ', "')}`);
  return `{\n  "format": ${FORMAT},\n${note ? `  "note": ${JSON.stringify(note)},\n` : ''}  "people": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

/**
 * What a login is credited for, here and in the gallery's index.
 *   index: [{ id, by, contest, winner }] (registry.js indexEntry), optional
 * -> { login, code, packs: [ids], packMaker, wins: ['YYYY-MM'], entries: ['YYYY-MM'] } | null without a login
 */
function forLogin(credits, login, index = []) {
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) return null;
  const me = normalize(credits).people.find(p => lower(p.login) === lower(login));
  const mine = (Array.isArray(index) ? index : []).filter(e => isObj(e) && typeof e.by === 'string' && lower(e.by) === lower(login) && PACK_ID_RE.test(e.id || ''));
  const months = list => [...new Set(list)].filter(m => MONTH_RE.test(m)).sort();
  const reasons = me?.for || [];
  return {
    login,
    code: reasons.includes('code'),
    packs: [...new Set([...(me?.packs || []), ...mine.map(e => e.id)])].sort(),
    packMaker: reasons.includes('pack') || !!(me?.packs || []).length || mine.length > 0,
    wins: months([...reasons.filter(r => r.startsWith('contest-')).map(r => r.slice(8)), ...mine.filter(e => e.winner && e.contest).map(e => e.contest)]),
    entries: months(mine.filter(e => e.contest).map(e => e.contest)),
  };
}

/**
 * The stats that unlock the trophies (wardrobe/achievements.js MAXIMA), from
 * forLogin's answer: [[event, n]]. Highs only, so saying it twice is harmless,
 * and a trophy once earned stays (as every trophy does) after you sign out.
 */
function trophyStats(mine) {
  if (!mine) return [];
  return [
    ['credit-packs', mine.packMaker ? Math.max(1, mine.packs.length) : 0],
    ['credit-code', mine.code ? 1 : 0],
    ['contest-wins', mine.wins.length],
    // A win was an entry too.
    ['contest-entries', new Set([...mine.entries, ...mine.wins]).size],
  ].filter(([, n]) => n > 0);
}

/**
 * About → Made by: everyone, grouped, each a link to their GitHub profile.
 *   me: the signed-in login, marked in the list
 * -> [{ id, title, people: [{ login, url, note, me }] }]
 */
function groups(credits, me = null) {
  const people = normalize(credits).people;
  const row = (p, note = '') => ({ login: p.login, url: `https://github.com/${p.login}`, note, me: !!me && lower(p.login) === lower(me) });
  const winners = people.flatMap(p => p.for.filter(r => r.startsWith('contest-')).map(r => ({ p, month: r.slice(8) })))
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0)).map(({ p, month }) => row(p, monthName(month)));
  return [
    { id: 'contest', title: '🏆 Contest winners', people: winners },
    { id: 'packs', title: '🪸 Pack makers', people: people.filter(p => p.packs.length || p.for.includes('pack')).map(p => row(p, p.packs.length > 1 ? `${p.packs.length} packs` : '')) },
    { id: 'code', title: '🔧 Code', people: people.filter(p => p.for.includes('code')).map(p => row(p)) },
  ].filter(g => g.people.length);
}

module.exports = { FORMAT, LOGIN_RE, REASON_RE, normalize, merge, add, toText, forLogin, trophyStats, groups, monthName };
