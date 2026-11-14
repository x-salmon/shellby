// Your other PCs, as the hub keeps them (docs/HUB.md).
//
// Each one runs Shellby with "On your phone" turned on, so it already serves
// itself on your tailnet at https://<pc>.<tailnet>.ts.net (pocket/server.js).
// The hub pairs with it the way a phone does, with the code that PC shows,
// and keeps the device token it's given. The token is kept encrypted by
// Windows (safeStorage, wiring/hub.js): here it's only ever the sealed text.
//
// An address is only ever an https URL on a .ts.net name, with one of the
// ports `tailscale serve` takes: nothing typed can point the hub at anything
// else on your network or the internet.
//
// Pure. test/hub-peers.test.js.
const crypto = require('crypto');

const MAX_PEERS = 16;
const MAX_NAME = 40;
const TS_HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.ts\.net$/;
const SERVE_PORTS = ['', '443', '8443', '10000'];
const ID_RE = /^p-[a-f0-9]{12}$/;

const line = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');

/**
 * What someone typed or pasted for a PC -> its origin ("https://desk.tail3f2c.ts.net"),
 * or null. A bare name gets https:// put in front; a path, a query or a login is dropped.
 */
function originOf(typed) {
  const raw = line(typed, 300);
  if (!raw) return null;
  let url;
  try { url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!TS_HOST.test(host) || !SERVE_PORTS.includes(url.port)) return null;
  return `https://${host}${url.port && url.port !== '443' ? `:${url.port}` : ''}`;
}

/** One saved PC, checked again (it's read from settings.json), or null. */
function peerOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const origin = originOf(raw.origin);
  if (!ID_RE.test(String(raw.id ?? '')) || !origin || typeof raw.token !== 'string' || !raw.token) return null;
  return {
    id: raw.id,
    origin,
    name: line(raw.name, MAX_NAME) || new URL(origin).hostname.split('.')[0],
    token: raw.token.slice(0, 4000), // sealed by safeStorage, as base64
    pairedAt: Number.isFinite(raw.pairedAt) ? raw.pairedAt : 0,
  };
}

/** The saved list, malformed entries and repeats of one address dropped. */
function normalize(list) {
  const seen = new Set();
  const out = [];
  for (const p of (Array.isArray(list) ? list : []).map(peerOf)) {
    if (!p || seen.has(p.origin)) continue;
    seen.add(p.origin);
    out.push(p);
  }
  return out.slice(0, MAX_PEERS);
}

/**
 * Add a paired PC: a new list, or { error }. Pairing the same address again
 * replaces it (a fresh token, after Forget on that PC, say).
 * @param {any[]} list
 * @param {{ origin: string, name?: string, token: string, now: number }} p
 */
function add(list, { origin, name, token, now }) {
  const o = originOf(origin);
  if (!o) return { error: "That isn't one of your PCs' Tailscale addresses (something.ts.net)." };
  const peers = normalize(list).filter(p => p.origin !== o);
  if (peers.length >= MAX_PEERS) return { error: `The hub keeps up to ${MAX_PEERS} PCs. Remove one first.` };
  const id = `p-${crypto.createHash('sha256').update(o).digest('hex').slice(0, 12)}`;
  return { list: [...peers, { id, origin: o, name: line(name, MAX_NAME) || new URL(o).hostname.split('.')[0], token, pairedAt: now }] };
}

const remove = (list, id) => normalize(list).filter(p => p.id !== id);

const rename = (list, id, name) => normalize(list).map(p => (p.id === id && line(name, MAX_NAME) ? { ...p, name: line(name, MAX_NAME) } : p));

module.exports = { MAX_PEERS, originOf, peerOf, normalize, add, remove, rename };
