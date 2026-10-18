// Pairing a phone with Shellby on your phone (pocket/server.js).
//
// A phone gets in with a device token: 32 random bytes it keeps in its own
// storage and sends with every request. It earns one by typing a short code
// that only this PC's screen shows: Settings → On your phone → Pair a phone.
// The code lasts five minutes, takes five tries in all, and works once.
//
// Shellby keeps a hash of each token, never the token, so a copy of
// settings.json (or its hourly backup) lets nobody in. Each phone can be
// forgotten on its own from Settings, and forgetting one ends its stream at once.
//
// Pure: no Electron, no disk. wiring/pocket.js keeps the list in the config.
const crypto = require('crypto');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: it's read off a screen
const CODE_LEN = 8;                  // 31^8: about 40 bits, against five guesses
const CODE_TTL_MS = 5 * 60 * 1000;
const CODE_TRIES = 5;
const MAX_DEVICES = 6;               // a phone, a tablet, and room to swap without forgetting first
const MAX_NAME = 40;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url
const ID_RE = /^[a-f0-9]{16}$/;

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function sameHex(a, b) {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length === 32 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** A fresh code, as it's typed: eight characters from CODE_ALPHABET. */
function newCode(random = crypto.randomInt) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return s;
}

/** How Settings shows it: K7Q2-M9XD. */
const showCode = code => (typeof code === 'string' && code.length === CODE_LEN ? `${code.slice(0, 4)}-${code.slice(4)}` : '');

/** What a person typed, as a code: case, spaces and the dash don't matter. */
function cleanCode(typed) {
  return String(typed ?? '').toUpperCase().replace(/[\s-]+/g, '').slice(0, 32);
}

/** A pairing window, opened from Settings. */
function openPairing(now = Date.now(), code = newCode()) {
  return { code, expiresAt: now + CODE_TTL_MS, tries: 0 };
}

/**
 * One go at the code.
 *   -> { ok: true, state: null }                   paired: the code is spent
 *   -> { ok: false, state, error }                 wrong; state counts the try
 * error: 'closed' (no code open, or it expired, or the tries ran out) | 'wrong'
 */
function tryCode(state, typed, now = Date.now()) {
  if (!state || !state.code || now > state.expiresAt || state.tries >= CODE_TRIES) return { ok: false, state: null, error: 'closed' };
  const given = cleanCode(typed);
  const a = Buffer.from(given.padEnd(CODE_LEN, '\0').slice(0, 32));
  const b = Buffer.from(state.code.padEnd(CODE_LEN, '\0'));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b) && given.length === CODE_LEN;
  if (match) return { ok: true, state: null };
  const tries = state.tries + 1;
  // The last wrong try closes it: a guesser gets five, not five per refresh.
  return { ok: false, state: tries >= CODE_TRIES ? null : { ...state, tries }, error: tries >= CODE_TRIES ? 'closed' : 'wrong' };
}

/** What a phone is called in Settings, from what its browser says it is. */
function nameFromAgent(ua) {
  const s = String(ua || '');
  if (/iPad/.test(s)) return 'iPad';
  if (/iPhone/.test(s)) return 'iPhone';
  if (/Android/.test(s)) return /Mobile/.test(s) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/.test(s) && /Mobile\//.test(s)) return 'iPad'; // iPadOS asks for the desktop site
  if (/Windows/.test(s)) return 'Windows PC';
  if (/Macintosh/.test(s)) return 'Mac';
  return 'Phone';
}

const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

/**
 * A new phone: its record for the config, and the token it alone is handed.
 * @param {{ name?: string, login?: string, now?: number }} [opts]
 */
function newDevice({ name, login = '', now = Date.now() } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const device = {
    id: crypto.randomBytes(8).toString('hex'),
    name: cleanName(name) || 'Phone',
    tokenHash: sha256(token),
    login: cleanName(login).slice(0, 200),
    createdAt: now,
    lastSeenAt: now,
    push: null,
  };
  return { device, token };
}

/** The list from settings.json, with anything malformed dropped. */
function normalizeDevices(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object' || !ID_RE.test(String(d.id)) || !/^[a-f0-9]{64}$/.test(String(d.tokenHash))) continue;
    if (out.some(o => o.id === d.id)) continue;
    out.push({
      id: d.id,
      name: cleanName(d.name) || 'Phone',
      tokenHash: d.tokenHash,
      login: typeof d.login === 'string' ? d.login.slice(0, 200) : '',
      createdAt: Number.isFinite(d.createdAt) ? d.createdAt : 0,
      lastSeenAt: Number.isFinite(d.lastSeenAt) ? d.lastSeenAt : 0,
      push: d.push && typeof d.push === 'object' && typeof d.push.endpoint === 'string' ? d.push : null,
    });
  }
  return out.slice(-MAX_DEVICES);
}

/** Room for one more: the one seen longest ago makes way. */
function addDevice(devices, device) {
  const list = normalizeDevices(devices);
  while (list.length >= MAX_DEVICES) {
    let oldest = 0;
    for (let i = 1; i < list.length; i++) if (list[i].lastSeenAt < list[oldest].lastSeenAt) oldest = i;
    list.splice(oldest, 1);
  }
  return [...list, device];
}

/** The phone a token belongs to, or null. Every hash is compared, so timing says nothing. */
function deviceFor(devices, token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const want = sha256(token);
  let found = null;
  for (const d of devices || []) if (sameHex(d.tokenHash, want) && !found) found = d;
  return found;
}

/** What Settings lists: never the hashes. */
function devicesView(devices, now = Date.now()) {
  return normalizeDevices(devices).map(d => ({
    id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt,
    push: !!d.push, recent: now - d.lastSeenAt < 2 * 60 * 1000,
  }));
}

module.exports = {
  CODE_ALPHABET, CODE_LEN, CODE_TTL_MS, CODE_TRIES, MAX_DEVICES, TOKEN_RE,
  addDevice, cleanCode, cleanName, deviceFor, devicesView, nameFromAgent, newCode, newDevice, normalizeDevices,
  openPairing, sha256, showCode, tryCode,
};
