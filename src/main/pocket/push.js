// Web Push, sent straight from the PC to the phone's browser.
//
// A phone that pairs with Shellby hands over a push subscription: an endpoint
// at its browser's push service (Safari's web.push.apple.com, Chrome's FCM,
// Firefox's Mozilla service, Edge's WNS) and two keys. Shellby then POSTs
// "Shellby needs you" there itself, with no server of ours in the middle.
//
// Three small standards make that work, and all three fit in Node's crypto:
//
//   RFC 8292  VAPID: an ES256 JWT that says who's sending, so the push service
//             can tie the subscription to our key and nobody else's.
//   RFC 8291  Message encryption: the push service only ever sees ciphertext.
//   RFC 8188  The aes128gcm content coding that ciphertext travels in.
//
// The usual web-push package pulls in a handful of others to do the same
// thing. CONTRIBUTING keeps the dependency list small (nothing to audit), and
// this is a page of code with the RFC's own test vector to hold it to, so it
// lives here.
//
// A subscription comes from the phone, so its endpoint is never trusted:
// endpointAllowed only lets through the four push services above, over plain
// https on the default port. Without that, a pairing could point Shellby's
// POSTs at anything on your network.
const crypto = require('crypto');

const CURVE = 'prime256v1';
const RECORD_SIZE = 4096;
// One record of RECORD_SIZE holds 16 bytes of GCM tag and a padding delimiter,
// and the header (86 bytes) comes out of the same 4096 push services accept.
const HEADER_SIZE = 16 + 4 + 1 + 65;
const MAX_PAYLOAD = RECORD_SIZE - HEADER_SIZE - 16 - 1;  // 3993
const MAX_ENDPOINT = 1000;
const MAX_KEY_TEXT = 200;          // a base64 p256dh is 87 characters; this is plenty
const MAX_JWT_TTL_S = 24 * 3600;   // RFC 8292: no more than 24 hours ahead
const MAX_TTL_S = 28 * 24 * 3600;  // push services keep a message four weeks at most
const URGENCIES = ['very-low', 'low', 'normal', 'high'];
const TOPIC = /^[A-Za-z0-9_-]{1,32}$/;

// The push services Shellby will talk to. Apple shards across *.push.apple.com
// and Microsoft across *.notify.windows.com; the other two are single hosts.
const HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
const SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

// ------------------------------------------------------------------ encoding

const b64url = buf => Buffer.from(buf).toString('base64url');

/**
 * Bytes from base64url, or null. Browsers hand keys over as base64url, but
 * some code on the way converts them to standard base64 with padding, so both
 * are welcome. Anything else (spaces, stray characters) is not.
 */
function fromB64(text, max = MAX_KEY_TEXT) {
  if (Buffer.isBuffer(text)) return text;
  if (typeof text !== 'string' || !text || text.length > max) return null;
  const s = text.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) return null;
  return Buffer.from(s, 'base64url');
}

/**
 * A real point on P-256, uncompressed (0x04 || X || Y). convertKey throws on one that isn't on the curve.
 * @param {unknown} buf
 * @returns {buf is Buffer}
 */
function validPoint(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 65 || buf[0] !== 0x04) return false;
  try {
    crypto.ECDH.convertKey(buf, CURVE, undefined, undefined, 'uncompressed');
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------ VAPID

/** A fresh VAPID key pair: the 65-byte public point and the 32-byte private scalar, both base64url. */
function newVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: CURVE });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(String(pub.x), 'base64url'), Buffer.from(String(pub.y), 'base64url')]);
  return { publicKey: b64url(point), privateKey: priv.d };
}

/** The signing key as a KeyObject, or null when the pair doesn't hold together. */
function signingKey(keys) {
  const point = fromB64(keys?.publicKey);
  const d = fromB64(keys?.privateKey);
  if (!validPoint(point) || !d || d.length !== 32) return null;
  // The private key has to be the one behind this public key: a pair stitched
  // together from two saves would sign JWTs every push service turns down.
  try {
    const ecdh = crypto.createECDH(CURVE);
    ecdh.setPrivateKey(d);
    if (!ecdh.getPublicKey().equals(point)) return null;
    return crypto.createPrivateKey({
      format: 'jwk',
      key: { kty: 'EC', crv: 'P-256', x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33)), d: b64url(d) },
    });
  } catch { return null; }
}

const validVapidKeys = keys => signingKey(keys) !== null;

/**
 * The VAPID JWT for one push service (RFC 8292). audience is the endpoint's
 * origin; subject is how the service can reach whoever runs the sender.
 * exp is held to 24 hours ahead whatever ttlSeconds asks for.
 */
function vapidJwt({ audience, subject, keys, now = Date.now(), ttlSeconds = 12 * 3600 }) {
  const key = signingKey(keys);
  if (!key) throw new Error('VAPID keys are not a valid pair');
  const ttl = Math.min(Math.max(Number(ttlSeconds) || 0, 60), MAX_JWT_TTL_S);
  const exp = Math.floor(now / 1000) + ttl;
  const part = obj => b64url(Buffer.from(JSON.stringify(obj)));
  const data = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: audience, exp, sub: subject })}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64url(sig)}`;
}

// ------------------------------------------------------------------ subscriptions

/**
 * Whether Shellby may POST to this URL: one of the known push services, over
 * https, on the default port, with nothing tucked into it. This is the SSRF
 * guard, so it errs towards no.
 */
function endpointAllowed(url) {
  if (typeof url !== 'string' || !url || url.length > MAX_ENDPOINT) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port !== '') return false;
  const host = u.hostname.toLowerCase();
  // Letters, digits, dots and dashes only, with no empty label: that rules out
  // IP literals ([::1] has brackets, and no dotted quad is on the list anyway),
  // a trailing dot ("web.push.apple.com.") and anything punycode-shaped oddly.
  if (!/^[a-z0-9.-]+$/.test(host) || host.split('.').some(label => !label)) return false;
  return HOSTS.includes(host) || SUFFIXES.some(s => host.endsWith(s) && host.length > s.length);
}

/**
 * A subscription as PushSubscription.toJSON() gives it, checked and in
 * canonical form: { endpoint, keys: { p256dh, auth } }, or null when any part
 * of it is wrong.
 */
function normalizeSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { endpoint } = raw;
  if (!endpointAllowed(endpoint)) return null;
  const p256dh = fromB64(raw.keys?.p256dh);
  const auth = fromB64(raw.keys?.auth);
  if (!validPoint(p256dh) || !auth || auth.length !== 16) return null;
  return { endpoint, keys: { p256dh: b64url(p256dh), auth: b64url(auth) } };
}

// ------------------------------------------------------------------ encryption

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/**
 * The content key and nonce for one message (RFC 8291 §3.3-3.4, RFC 8188 §2.2).
 * Both ends run the same steps; only who holds which private key differs.
 */
function deriveKeys({ secret, auth, uaPublic, asPublic, salt }) {
  const prkKey = hmac(auth, secret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  return { cek, nonce };
}

/** The sender's ECDH pair for this one message: the one given, or a fresh one. */
function senderEcdh(localKeys) {
  if (localKeys && typeof localKeys.computeSecret === 'function') return localKeys;
  const ecdh = crypto.createECDH(CURVE);
  if (localKeys?.privateKey) ecdh.setPrivateKey(/** @type {Buffer} */ (fromB64(localKeys.privateKey)));
  else ecdh.generateKeys();
  return ecdh;
}

/**
 * The aes128gcm body for one push (RFC 8291 + RFC 8188): a single record of
 * RECORD_SIZE, header salt || rs || idlen || as_public, then the ciphertext of
 * payload || 0x02.
 *
 * Throws a RangeError for a payload over MAX_PAYLOAD bytes (Shellby's are a
 * line or two; something that big is a bug, not a message to split), and an
 * Error for keys that aren't keys. salt and localKeys are only ever passed to
 * reproduce a known answer; left out, both are fresh for every message, as
 * they must be.
 */
/** @param {{ payload: any, p256dh: any, auth: any, salt?: any, localKeys?: any }} args */
function encrypt({ payload, p256dh, auth, salt, localKeys }) {
  const plain = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ''));
  if (plain.length > MAX_PAYLOAD) throw new RangeError(`push payload is ${plain.length} bytes, over ${MAX_PAYLOAD}`);
  const uaPublic = fromB64(p256dh);
  const authSecret = fromB64(auth);
  if (!validPoint(uaPublic) || !authSecret || authSecret.length !== 16) throw new Error('not a valid subscription key');
  const saltBuf = salt ? fromB64(salt) : crypto.randomBytes(16);
  if (!saltBuf || saltBuf.length !== 16) throw new Error('salt must be 16 bytes');

  const ecdh = senderEcdh(localKeys);
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const { cek, nonce } = deriveKeys({ secret, auth: authSecret, uaPublic, asPublic, salt: saltBuf });

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(plain), cipher.update(Buffer.from([2])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(HEADER_SIZE);
  saltBuf.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;
  asPublic.copy(header, 21);
  return Buffer.concat([header, sealed]);
}

/**
 * The phone's half: the plaintext back out of an aes128gcm body. Shellby never
 * receives pushes; this is here so the tests (and an e2e stand-in for a push
 * service) can check what encrypt sent. Throws on anything that doesn't open.
 */
/** @param {{ body: any, p256dhPrivate: any, p256dhPublic?: any, auth: any }} args */
function decrypt({ body, p256dhPrivate, p256dhPublic, auth }) {
  const buf = Buffer.from(body);
  if (buf.length < 21) throw new Error('body too short');
  const salt = buf.subarray(0, 16);
  const idlen = buf[20];
  const asPublic = buf.subarray(21, 21 + idlen);
  const sealed = buf.subarray(21 + idlen);
  if (sealed.length < 17) throw new Error('body too short');

  const ecdh = crypto.createECDH(CURVE);
  ecdh.setPrivateKey(/** @type {Buffer} */ (fromB64(p256dhPrivate)));
  const uaPublic = /** @type {Buffer} */ (p256dhPublic ? fromB64(p256dhPublic) : ecdh.getPublicKey());
  const secret = ecdh.computeSecret(asPublic);
  const { cek, nonce } = deriveKeys({ secret, auth: fromB64(auth), uaPublic, asPublic, salt });

  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(sealed.subarray(-16));
  const padded = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
  // Padding is zeros after the delimiter; 0x02 marks the last (and only) record.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 2) throw new Error('no last-record delimiter');
  return padded.subarray(0, end);
}

// ------------------------------------------------------------------ sending

/**
 * Everything fetch needs for one push: { url, method, headers, body }, or
 * { error } when the subscription, keys or payload won't do. payload may be a
 * string or an object (sent as JSON). A topic that isn't up to 32 base64url
 * characters is left off rather than sent for the service to refuse, and an
 * urgency that isn't one of the four becomes 'normal'.
 */
/**
 * @param {any} subscription
 * @param {any} payload
 * @param {{ keys?: any, subject?: string, ttl?: number, urgency?: string, topic?: string, now?: number }} [opts]
 */
function buildPushRequest(subscription, payload, { keys, subject, ttl = 3600, urgency = 'normal', topic, now = Date.now() } = {}) {
  const sub = normalizeSubscription(subscription);
  if (!sub) return { error: 'not a valid push subscription' };
  if (!validVapidKeys(keys)) return { error: 'VAPID keys are not a valid pair' };
  if (typeof subject !== 'string' || !/^(mailto:|https:\/\/)\S+$/.test(subject)) return { error: 'VAPID subject must be a mailto: or https: URL' };

  const text = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload ?? null);
  let body;
  try {
    body = encrypt({ payload: text, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
  } catch (e) { return { error: e.message }; }

  const audience = new URL(sub.endpoint).origin;
  const jwt = vapidJwt({ audience, subject, keys, now });
  const seconds = Number.isFinite(Number(ttl)) ? Math.min(Math.max(Math.floor(Number(ttl)), 0), MAX_TTL_S) : 3600;
  const headers = {
    TTL: String(seconds),
    Urgency: URGENCIES.includes(urgency) ? urgency : 'normal',
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(body.length),
    Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
  };
  if (typeof topic === 'string' && TOPIC.test(topic)) headers.Topic = topic;
  return { url: sub.endpoint, method: 'POST', headers, body };
}

/**
 * POST one push. Never throws: { ok, status, gone, error? }. ok is any 2xx
 * (push services answer 201 Created); gone is 404 or 410, which means the
 * phone dropped the subscription and Shellby should forget it. Redirects are
 * refused, since following one would step round endpointAllowed.
 */
async function sendPush(request, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!request || request.error) return { ok: false, status: 0, gone: false, error: request?.error || 'no request' };
  try {
    const res = await fetchImpl(request.url, {
      method: request.method || 'POST',
      headers: request.headers,
      body: request.body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const status = Number(res?.status) || 0;
    // Read (and drop) the answer so the connection goes back to the pool.
    let detail = '';
    try { detail = typeof res.text === 'function' ? String(await res.text()).slice(0, 200) : ''; } catch { /* gone */ }
    const ok = status >= 200 && status < 300;
    const gone = status === 404 || status === 410;
    return ok ? { ok, status, gone } : { ok, status, gone, error: `HTTP ${status}${detail ? `: ${detail}` : ''}` };
  } catch (e) {
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    return { ok: false, status: 0, gone: false, error: timedOut ? `timed out after ${timeoutMs}ms` : (e?.message || String(e)) };
  }
}

module.exports = {
  RECORD_SIZE, MAX_PAYLOAD, MAX_ENDPOINT, URGENCIES, HOSTS, SUFFIXES,
  newVapidKeys, validVapidKeys, vapidJwt,
  endpointAllowed, normalizeSubscription,
  encrypt, decrypt,
  buildPushRequest, sendPush,
};
