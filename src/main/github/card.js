// The calling card: one small public gist ("shellby-card.json") that says how
// your crab looks (outfit, colors, shell, level and the stickers on his shell)
// so a friend's Shellby can have him over, plus the two things the crabs chat
// about when they meet (src/main/banter.js): his temperament and the find he's
// proudest of. Nothing else goes in it: no stats, no history. Stickers are only colour patches unless you choose to share their
// names (stickers/index.js forCard), and never the projects you've hidden. His tank
// is on it only if you share it, as built-in decor ids and where they stand (tank/share.js).
// So is his Bugdex: which kinds of bug you've caught and how many badges, never
// counts, projects or errors (bugdex/index.js shared). During Wrapped week, and
// only with Show my year to friends on, last year's numbers and nemesis
// (yearbook.js forCard): never a project name.
// A public sponsor's signed proof rides along (patron.js): the patron items their
// proof doesn't reach, for the account that owns the card, come off their crab and out of their tank.
// A friend's card is somebody else's file, so it is always cleaned before use,
// and only believed when the gist really belongs to that friend.
const { findGist } = require('./gists');
const { cleanCardStickers } = require('../stickers');
const { cleanCardTank } = require('../tank/share');
const { cleanShared } = require('../bugdex');
const { cleanCardSwap } = require('../swaps');
const { cleanCardEggs } = require('../eggs');
const { cleanMedals } = require('../events');
const { cleanCardWrapped } = require('../yearbook');
const patron = require('../patron');

const CARD_FILE = 'shellby-card.json';
const FORMAT = 1;
const MAX_BYTES = 16 * 1024;
const MAX_PAGES = 5; // a friend with 500 newer gists than their card is a friend we can't find
const SLOTS = ['hat', 'face', 'neck', 'held', 'shell', 'effect'];
const KEY_RE = /^[a-z0-9][a-z0-9/-]{0,80}$/;
const SHELL_RE = /^[a-z0-9-]{1,40}$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const TEMPERAMENTS = ['chipper', 'fussy', 'cocky', 'sleepy']; // voice.js TEMPERAMENTS
const FIND_RE = /^[a-z0-9-]{1,40}$/;                           // a gifts/index.js FINDS id

const key = v => (typeof v === 'string' && KEY_RE.test(v) ? v : null);
const sameLogin = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Tolerate anything (a friend's card especially). own: it's yours, on its way
 * out, so the patron proof is passed along as it is: friends check it when they read it.
 */
function cleanCard(raw, { own = false } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const outfit = {};
  for (const s of SLOTS) outfit[s] = key(r.outfit?.[s]);
  const level = Number.isFinite(r.level) ? Math.min(99, Math.max(1, Math.floor(r.level))) : 1;
  const login = typeof r.login === 'string' && LOGIN_RE.test(r.login) ? r.login : null;
  // The GitHub account that owns the gist, by number (cardFromGist): a patron proof must be for it.
  const ownerId = Number.isSafeInteger(r.ownerId) && r.ownerId > 0 ? r.ownerId : null;
  const checked = !own && login && ownerId ? patron.verifyProof(r.patron, { login, id: ownerId }) : null;
  const proof = own ? (typeof r.patron === 'string' && patron.PROOF_RE.test(r.patron) ? r.patron : null) : checked ? r.patron : null;
  const look = {
    format: FORMAT,
    login,
    ownerId,
    skin: key(r.skin),
    home: typeof r.home === 'string' && SHELL_RE.test(r.home) ? r.home : null,
    level,
    outfit,
    stickers: cleanCardStickers(r.stickers),
    temperament: TEMPERAMENTS.includes(r.temperament) ? r.temperament : null,
    find: typeof r.find === 'string' && FIND_RE.test(r.find) ? r.find : null,
    tank: cleanCardTank(r.tank),
    bugdex: r.bugdex ? cleanShared(r.bugdex) : null,
    // What they'd swap and what they're after (swaps.js), their open eggs as hashes (eggs.js), tide event medals (events.js).
    swap: r.swap ? cleanCardSwap(r.swap) : null,
    eggs: cleanCardEggs(r.eggs),
    medals: cleanMedals(r.medals),
    // Last year's numbers during Wrapped week, if they chose to show them (yearbook.js forCard).
    wrapped: cleanCardWrapped(r.wrapped),
    // 🏮 Patron of the Deep, signed by getshellby.com for this login (patron.js).
    patron: proof,
    updatedAt: Number.isFinite(r.updatedAt) && r.updatedAt > 0 ? r.updatedAt : 0,
  };
  return own ? look : patron.withoutUnproven(look, checked);
}

/** Just the look, for "did anything change since we last published?" */
const lookOf = card => { const c = cleanCard(card, { own: true }); return JSON.stringify([c.login, c.skin, c.home, c.level, c.outfit, c.stickers, c.temperament, c.find, c.tank, c.bugdex, c.swap, c.eggs, c.medals, c.wrapped, c.patron]); };

const content = card => JSON.stringify({ ...cleanCard(card, { own: true }), ownerId: undefined, note: "Shellby calling card: how this crab looks (and his tank, if shared), so friends' crabs can visit. Turn off Visiting crabs in Shellby to delete it." }, null, 1);

/** Create or update your card; returns its gist id. */
async function publishCard(gh, card, knownId) {
  const id = await findGist(gh, knownId, CARD_FILE);
  if (id) {
    await gh.patch(`/gists/${encodeURIComponent(id)}`, { files: { [CARD_FILE]: { content: content(card) } } });
    return id;
  }
  const created = await gh.post('/gists', { public: true, description: 'Shellby calling card', files: { [CARD_FILE]: { content: content(card) } } });
  return created.id;
}

/** Take your card down (turning the feature off). A card that's already gone is fine. */
async function deleteCard(gh, knownId) {
  const id = await findGist(gh, knownId, CARD_FILE);
  if (!id) return false;
  try { await gh.delete(`/gists/${encodeURIComponent(id)}`); } catch (e) { if (e.status !== 404) throw e; }
  return true;
}

/** A gist as a card, if it is one and `login` owns it. */
function cardFromGist(g, login) {
  if (!g || !sameLogin(g.owner?.login, login)) return null;
  const f = g.files?.[CARD_FILE];
  if (!f || f.truncated || f.size > MAX_BYTES || typeof f.content !== 'string') return null;
  let raw;
  try { raw = JSON.parse(f.content); } catch { return null; }
  // The owner is who GitHub says it is, whatever the file claims: and it's the
  // owner, by account number, a patron proof must be for, so nobody else's can be borrowed.
  const card = cleanCard({ ...(raw && typeof raw === 'object' ? raw : {}), login: g.owner.login, ownerId: g.owner.id });
  return { id: g.id, card: { ...card, login: g.owner.login } };
}

/**
 * A friend's card: { id, card }, or null when they haven't got one (yet).
 * knownId is where it was last time, which saves listing their gists.
 */
async function findCard(gh, login, knownId) {
  if (!LOGIN_RE.test(String(login))) return null;
  if (knownId) {
    try {
      const hit = cardFromGist(await gh.get(`/gists/${encodeURIComponent(knownId)}`), login);
      if (hit) return hit;
    } catch (e) { if (e.status !== 404) throw e; }
  }
  for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await gh.get(`/users/${encodeURIComponent(login)}/gists?per_page=100&page=${page}`);
    const g = (list || []).find(x => x.files && x.files[CARD_FILE]);
    if (g) return cardFromGist(await gh.get(`/gists/${encodeURIComponent(g.id)}`), login);
    if (!list || list.length < 100) break;
  }
  return null;
}

module.exports = { CARD_FILE, LOGIN_RE, cleanCard, lookOf, publishCard, deleteCard, findCard, cardFromGist, sameLogin };
