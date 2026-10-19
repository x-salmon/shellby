// 🏮 Patron of the Deep: proof that someone sponsors Shellby on GitHub, and at which tier.
//
// Each sponsor tier has its own trophy and reward (wardrobe/achievements.js),
// as "perks": `rank` climbs the monthly tiers (any sponsorship 1, $7 2, $15 3,
// $40 4) and `gifts` the one-time ones ($10 1, $50 2). A one-time $50 also
// reaches rank 3. The best a sponsor has ever reached is what counts: like
// every trophy, a tier's reward stays once earned.
//
// Two kinds of proof, for two audiences:
//  - Your own PC: GitHub says you sponsor, and at which tier (github/sponsor.js,
//    asked as you, so a private sponsorship counts). That answer, with the
//    GitHub account it's for, is sealed with the OS (Electron safeStorage, as
//    the GitHub token is) before it goes in config, so editing config.json by
//    hand, or copying it to another PC or person, unlocks nothing. It holds
//    while you're signed out or signed in as that account, not while someone
//    else is, so a sponsor can't sign in on a friend's PC to lend it. (A script
//    run as you can forge a seal, as it could patch Shellby: this is for
//    everyone else.)
//  - Everyone else: a proof signed by getshellby.com (x-salmon/shellby-site,
//    api/patron.js), which reads x-salmon's public sponsors and their tiers
//    from GitHub. Only a public sponsorship gets one, so nobody can use it to
//    find out who sponsors privately. It goes on your calling card
//    (github/card.js), and a friend's Shellby only draws a patron item on your
//    crab, as his skin, or in your tank when the proof checks out for the
//    GitHub account that owns the card's gist (its number, which never passes
//    to anyone else, as a login can) and reaches that item's tier.
//
// A proof is `<payload>.<signature>`, both base64url. The payload is
// {"v":3,"k":<key id>,"id":<GitHub account id>,"login":"…","r":<rank>,"g":<gifts>,"exp":<unix s>},
// and the signature is Ed25519 over DOMAIN followed by its bytes. It lasts 30
// days (getshellby.com decides) and is fetched afresh daily. Someone who
// rebuilds Shellby can draw anything on their own screen; they still can't
// put the lantern on their crab on yours.
//
// Pure apart from node:crypto: the sealing crypto is passed in. See test/patron.test.js.
const nodeCrypto = require('crypto');
const { ACHIEVEMENTS } = require('./wardrobe/achievements');

// scripts/patron-keygen.js made them; their private halves are only on getshellby.com.
// A new key gets the next id, and the old one stays until its proofs have run out.
const PUBLIC_KEYS = Object.freeze({
  1: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfpR63pmqKmzpbyUpXNY9UWmjQtOQAl7jSiz1Aeikxss=
-----END PUBLIC KEY-----`,
});
const DOMAIN = Buffer.from('shellby-patron-v3\n', 'utf8'); // api/patron.js signs the same
const PROOF_URL = 'https://getshellby.com/api/patron';
const FETCH_TIMEOUT_MS = 10000;

// The tiers, in cents (api/patron.js has the same table). Monthly: rank. One-time: gifts, and a rank.
const MONTHLY_RANKS = [[4000, 4], [1500, 3], [700, 2]];   // below $7, any sponsorship: 1
const ONE_TIME = [[5000, { rank: 3, gifts: 2 }], [1000, { rank: 1, gifts: 1 }]];
const MAX_RANK = 4;
const MAX_GIFTS = 2;
const STAT_OF = { patronRank: 'rank', patronGifts: 'gifts' };

/** The sponsor trophies: [{ id, perk: 'rank' | 'gifts', goal, rewards }]. */
const PATRON_ACHIEVEMENTS = Object.freeze(ACHIEVEMENTS.filter(a => STAT_OF[a.stat])
  .map(a => Object.freeze({ id: a.id, perk: STAT_OF[a.stat], goal: a.goal, rewards: a.rewards })));
const PATRON_ACHIEVEMENT_IDS = new Set(PATRON_ACHIEVEMENTS.map(a => a.id));
/** Item key -> the perk it needs: { perk, goal }. Never drawn without a proof that reaches it. */
const PATRON_ITEMS = new Map(PATRON_ACHIEVEMENTS.flatMap(a => a.rewards.map(key => [key, { perk: a.perk, goal: a.goal }])));

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;   // github/card.js
const PROOF_RE = /^[A-Za-z0-9_-]{16,400}\.[A-Za-z0-9_-]{80,100}$/;
const MAX_SEALED = 4096;
const MAX_SEALS = 5; // GitHub accounts remembered on one PC

const sameLogin = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = v => Number.isSafeInteger(v) && v > 0;
const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function parse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * The perks a sponsorship's tier gives. tier: GitHub's { monthlyPriceInCents, isOneTime },
 * or null (a custom amount with no tier, say): any sponsorship reaches rank 1.
 * -> { rank, gifts }
 */
function perksFor(tier) {
  const cents = Number.isFinite(tier?.monthlyPriceInCents) ? tier.monthlyPriceInCents : 0;
  if (tier?.isOneTime) return { ...(ONE_TIME.find(([min]) => cents >= min)?.[1] || { rank: 1, gifts: 0 }) };
  return { rank: MONTHLY_RANKS.find(([min]) => cents >= min)?.[1] || 1, gifts: 0 };
}

/** The better of two perks, each part on its own; either may be null. */
function bestPerks(a, b) {
  if (!a) return b ? { rank: b.rank, gifts: b.gifts } : null;
  if (!b) return { rank: a.rank, gifts: a.gifts };
  return { rank: Math.max(a.rank, b.rank), gifts: Math.max(a.gifts, b.gifts) };
}

/** Do these perks (null: none) reach a sponsor trophy, or an item ({ perk, goal })? */
const reaches = (perks, need) => !!perks && !!need && perks[need.perk] >= need.goal;
/** Is a trophy allowed by these perks? Anything not a sponsor trophy always is. */
function allowsAchievement(perks, id) {
  const a = PATRON_ACHIEVEMENTS.find(x => x.id === id);
  return !a || reaches(perks, a);
}

/** Stats with the sponsor ones set from proven perks, whatever config says. */
const maskStats = (stats, perks) => ({ ...stats, patronRank: perks ? perks.rank : 0, patronGifts: perks ? perks.gifts : 0 });

/**
 * A signed proof, checked: { id, login, rank, gifts, exp } when it's genuine,
 * unexpired and for `login` (and `id`, when given), otherwise null. Anything
 * at all can be passed in. The keys are read from the exports when called, so
 * a test can stand in its own pair.
 */
function verifyProof(proof, { login, id = null, now = Date.now() } = {}, keys = module.exports.PUBLIC_KEYS) {
  if (typeof proof !== 'string' || !PROOF_RE.test(proof) || !LOGIN_RE.test(String(login))) return null;
  const [body, sig] = proof.split('.');
  const bytes = Buffer.from(body, 'base64url');
  const p = parse(bytes.toString('utf8'));
  const key = isObj(p) && Object.prototype.hasOwnProperty.call(keys, p.k) ? keys[p.k] : null;
  if (!key) return null;
  let ok;
  try { ok = nodeCrypto.verify(null, Buffer.concat([DOMAIN, bytes]), key, Buffer.from(sig, 'base64url')); } catch { return null; }
  if (!ok || p.v !== 3 || !isId(p.id) || !sameLogin(p.login, login) || !Number.isFinite(p.exp)) return null;
  if (!inRange(p.r, 1, MAX_RANK) || !inRange(p.g, 0, MAX_GIFTS)) return null;
  if (id !== null && p.id !== id) return null;
  if (p.exp * 1000 <= now) return null;
  return { id: p.id, login: p.login, rank: p.r, gifts: p.g, exp: p.exp };
}

/**
 * Ask getshellby.com for a public sponsor's proof. id: your GitHub account's
 * number, which the proof must carry. -> the proof string, false when it says
 * there is none, or null when it couldn't say (offline, an error, an odd answer).
 */
async function fetchProof(login, { id, fetchImpl = fetch, url = PROOF_URL } = {}) {
  if (!LOGIN_RE.test(String(login)) || !isId(id)) return null;
  try {
    const res = await fetchImpl(`${url}?login=${encodeURIComponent(login.toLowerCase())}`, {
      headers: { accept: 'application/json', 'user-agent': 'Shellby' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return false;
    if (!res.ok) return null;
    const data = await res.json();
    return verifyProof(data?.proof, { login, id }) ? data.proof : null;
  } catch {
    return null;
  }
}

/**
 * Your own sponsorship, sealed for config: a base64 string only this Windows
 * user on this PC can open. crypto: Electron's safeStorage (a stand-in in tests).
 * -> null when the OS can't encrypt.
 */
function seal(crypto, { login, id, rank, gifts }) {
  if (!crypto?.isEncryptionAvailable?.() || !LOGIN_RE.test(String(login)) || !isId(id)) return null;
  if (!inRange(rank, 1, MAX_RANK) || !inRange(gifts, 0, MAX_GIFTS)) return null;
  return crypto.encryptString(JSON.stringify({ v: 3, login, id, rank, gifts })).toString('base64');
}

/** What seal() sealed: { login, id, rank, gifts }, or null for anything else (edited, from another PC). */
function open(crypto, sealed) {
  if (typeof sealed !== 'string' || !sealed || sealed.length > MAX_SEALED || !crypto?.isEncryptionAvailable?.()) return null;
  let p;
  try { p = parse(crypto.decryptString(Buffer.from(sealed, 'base64'))); } catch { return null; }
  if (!isObj(p) || p.v !== 3 || typeof p.login !== 'string' || !LOGIN_RE.test(p.login) || !isId(p.id)) return null;
  if (!inRange(p.rank, 1, MAX_RANK) || !inRange(p.gifts, 0, MAX_GIFTS)) return null;
  return { login: p.login, id: p.id, rank: p.rank, gifts: p.gifts };
}

/** Config's sealed sponsorships, one per GitHub account: { [account id]: sealed }, made safe. */
function sealsOf(sponsorConfig) {
  const s = isObj(sponsorConfig) && isObj(sponsorConfig.seals) ? sponsorConfig.seals : {};
  return Object.fromEntries(Object.entries(s).filter(([id, v]) => /^\d{1,15}$/.test(id) && typeof v === 'string').slice(-MAX_SEALS));
}

/** Every seal that opens, each { login, id, rank, gifts }. */
const openAll = (crypto, seals) => Object.values(seals).map(v => open(crypto, v)).filter(o => o && seals[o.id] !== undefined);

/**
 * The perks proven on this PC: reads config's `sponsor`, opens its seals, and
 * gives the one for the account you're signed in as, or with nobody signed in,
 * the best of them. So a sponsor's perks hold while signed out, but not while
 * someone else is signed in (they can't be lent). The last answer is
 * remembered, so asking often (the Wardrobe does) costs nothing.
 *   crypto: safeStorage, or a function giving it. login: () => the signed-in login, or null.
 * -> () => { rank, gifts } | null
 */
function perksOnThisPc(config, crypto, login = () => null) {
  let last = { key: undefined, opened: [] };
  return () => {
    const seals = sealsOf(config?.get('sponsor'));
    const key = JSON.stringify(seals);
    if (key !== last.key) {
      const cr = typeof crypto === 'function' ? crypto() : crypto;
      // Not remembered while the OS can't decrypt yet: it may be able to in a moment.
      if (!cr?.isEncryptionAvailable?.()) return null;
      last = { key, opened: openAll(cr, seals) };
    }
    const who = login();
    const mine = who ? last.opened.filter(o => sameLogin(who, o.login)) : last.opened;
    return mine.reduce((best, o) => bestPerks(best, o), null);
  };
}

/**
 * A friend's look with the patron items they haven't proven taken off: outfit
 * slots and the skin holding one are emptied, and tank pieces and tank style
 * that are one are removed. perks: their proof's, or null for none.
 */
function withoutUnproven(look, perks) {
  if (!isObj(look)) return look;
  const off = k => (PATRON_ITEMS.has(k) && !reaches(perks, PATRON_ITEMS.get(k)) ? null : k);
  const outfit = isObj(look.outfit) ? Object.fromEntries(Object.entries(look.outfit).map(([slot, k]) => [slot, off(k)])) : look.outfit;
  let tank = look.tank;
  if (isObj(tank) && Array.isArray(tank.placed)) {
    const style = isObj(tank.style) ? { ...tank.style, substrate: off(tank.style.substrate), backdrop: off(tank.style.backdrop) } : tank.style;
    tank = { ...tank, style, placed: tank.placed.filter(p => off(p?.ref) !== null) };
    if (!tank.placed.length) tank = null;
  }
  return { ...look, outfit, tank, ...('skin' in look ? { skin: off(look.skin) } : {}) };
}

module.exports = {
  PUBLIC_KEYS, DOMAIN, PROOF_URL, PROOF_RE, PATRON_ACHIEVEMENTS, PATRON_ACHIEVEMENT_IDS, PATRON_ITEMS,
  perksFor, bestPerks, allowsAchievement, maskStats, verifyProof, fetchProof, seal, open, sealsOf, perksOnThisPc, withoutUnproven,
};
