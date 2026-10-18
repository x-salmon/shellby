// Web Push from the PC (pocket/push.js): the RFC 8291 test vector byte for
// byte, the VAPID JWT, the SSRF guard on endpoints, subscription checks, the
// request it builds and how it reads a push service's answer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const push = require('../src/main/pocket/push');

// RFC 8291 Appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};
const b = s => Buffer.from(s, 'base64url');

/** A phone's side of a subscription: its keys, and the subscription it would hand over. */
function phone(endpoint = 'https://fcm.googleapis.com/fcm/send/abc') {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    priv: ecdh.getPrivateKey(),
    sub: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
  };
}

// ------------------------------------------------------------------ encryption

test('encrypt reproduces the RFC 8291 test vector byte for byte', () => {
  const body = push.encrypt({
    payload: RFC.plaintext, p256dh: RFC.uaPublic, auth: RFC.auth, salt: RFC.salt,
    localKeys: { publicKey: b(RFC.asPublic), privateKey: b(RFC.asPrivate) },
  });
  assert.equal(body.toString('base64url'), RFC.body);
});

test('encrypt takes the sender keys as an ECDH object too', () => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(b(RFC.asPrivate));
  const body = push.encrypt({ payload: RFC.plaintext, p256dh: RFC.uaPublic, auth: RFC.auth, salt: b(RFC.salt), localKeys: ecdh });
  assert.equal(body.toString('base64url'), RFC.body);
});

test('decrypt opens the RFC test vector', () => {
  const out = push.decrypt({ body: b(RFC.body), p256dhPrivate: RFC.uaPrivate, p256dhPublic: RFC.uaPublic, auth: RFC.auth });
  assert.equal(out.toString(), RFC.plaintext);
});

test('what encrypt seals with fresh keys, decrypt opens again', () => {
  const { priv, sub } = phone();
  const message = JSON.stringify({ title: 'Shellby needs you', body: 'Allow Bash: npm test?' });
  const body = push.encrypt({ payload: message, ...sub.keys });
  assert.equal(body.readUInt32BE(16), push.RECORD_SIZE);
  assert.equal(body[20], 65);
  assert.equal(push.decrypt({ body, p256dhPrivate: priv, auth: sub.keys.auth }).toString(), message);
});

test('every message gets its own salt and sender key', () => {
  const { sub } = phone();
  const one = push.encrypt({ payload: 'hi', ...sub.keys });
  const two = push.encrypt({ payload: 'hi', ...sub.keys });
  assert.notDeepEqual(one.subarray(0, 86), two.subarray(0, 86));
});

test('a tampered body does not open', () => {
  const { priv, sub } = phone();
  const body = push.encrypt({ payload: 'hello', ...sub.keys });
  body[body.length - 1] ^= 1;
  assert.throws(() => push.decrypt({ body, p256dhPrivate: priv, auth: sub.keys.auth }));
});

test('a payload of MAX_PAYLOAD fits in 4096 bytes, and one byte more is refused', () => {
  const { priv, sub } = phone();
  const body = push.encrypt({ payload: 'x'.repeat(push.MAX_PAYLOAD), ...sub.keys });
  assert.equal(body.length, 4096);
  assert.equal(push.decrypt({ body, p256dhPrivate: priv, auth: sub.keys.auth }).length, push.MAX_PAYLOAD);
  assert.throws(() => push.encrypt({ payload: 'x'.repeat(push.MAX_PAYLOAD + 1), ...sub.keys }), RangeError);
});

// ------------------------------------------------------------------ VAPID

test('new VAPID keys are a 65-byte point and a 32-byte scalar that belong together', () => {
  const keys = push.newVapidKeys();
  assert.equal(b(keys.publicKey).length, 65);
  assert.equal(b(keys.publicKey)[0], 0x04);
  assert.equal(b(keys.privateKey).length, 32);
  assert.equal(push.validVapidKeys(keys), true);
});

test('a public key from one pair and a private key from another are turned down', () => {
  const one = push.newVapidKeys();
  const two = push.newVapidKeys();
  assert.equal(push.validVapidKeys({ publicKey: one.publicKey, privateKey: two.privateKey }), false);
});

test('VAPID keys of the wrong shape are turned down', () => {
  const keys = push.newVapidKeys();
  for (const bad of [null, {}, { publicKey: keys.publicKey }, { ...keys, publicKey: keys.publicKey.slice(0, 40) },
    { ...keys, privateKey: 'not base64!' }, { ...keys, publicKey: 'A'.repeat(87) }]) {
    assert.equal(push.validVapidKeys(bad), false, JSON.stringify(bad));
  }
});

test('the VAPID JWT is ES256 over the audience, an expiry and the subject, and verifies', () => {
  const keys = push.newVapidKeys();
  const now = Date.UTC(2026, 9, 18, 12);
  const jwt = push.vapidJwt({ audience: 'https://web.push.apple.com', subject: 'https://getshellby.com/', keys, now });
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  assert.deepEqual(JSON.parse(b(parts[0])), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(b(parts[1]));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'https://getshellby.com/');
  assert.equal(claims.exp, now / 1000 + 12 * 3600);

  const pub = b(keys.publicKey);
  const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  const ok = crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'ieee-p1363' }, b(parts[2]));
  assert.equal(ok, true);
});

test('the JWT never expires more than 24 hours ahead', () => {
  const now = Date.now();
  const jwt = push.vapidJwt({ audience: 'https://fcm.googleapis.com', subject: 'mailto:a@b.c', keys: push.newVapidKeys(), now, ttlSeconds: 7 * 24 * 3600 });
  const { exp } = JSON.parse(b(jwt.split('.')[1]));
  assert.ok(exp <= Math.floor(now / 1000) + 24 * 3600);
});

// ------------------------------------------------------------------ endpoints

test('the four push services are allowed', () => {
  for (const url of [
    'https://web.push.apple.com/QGuQyavXutnMH9Kf4oD8HVvUu8nD7Qs3Ylo0gR5Q',
    'https://api.push.apple.com/3/device/x',
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x',
    'https://FCM.GoogleAPIs.com/fcm/send/abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
  ]) assert.equal(push.endpointAllowed(url), true, url);
});

test('anything else is not, however it is dressed up', () => {
  for (const url of [
    'http://web.push.apple.com/x',
    'https://example.com/push',
    'https://web.push.apple.com.evil.com/',
    'https://evil.com/web.push.apple.com',
    'https://evilpush.apple.com/x',
    'https://notify.windows.com/x',
    'https://user:pw@fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com@evil.com/',
    'https://fcm.googleapis.com:8443/fcm/send/abc',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://push.apple.com./x',
    'https://web.push.apple.com./x',
    'ftp://fcm.googleapis.com/x',
    `https://fcm.googleapis.com/${'a'.repeat(1000)}`,
    'not a url',
    '',
    null,
    undefined,
    42,
    { href: 'https://fcm.googleapis.com/' },
  ]) assert.equal(push.endpointAllowed(url), false, String(url));
});

// ------------------------------------------------------------------ subscriptions

test('a good subscription comes back in canonical base64url', () => {
  const { sub } = phone('https://web.push.apple.com/abc');
  assert.deepEqual(push.normalizeSubscription({ ...sub, expirationTime: null }), sub);
});

test('keys in standard base64 with padding are accepted and re-encoded', () => {
  const { sub } = phone();
  const std = s => b(s).toString('base64');
  const out = push.normalizeSubscription({ endpoint: sub.endpoint, keys: { p256dh: std(sub.keys.p256dh), auth: std(sub.keys.auth) } });
  assert.deepEqual(out, sub);
});

test('a subscription with a bad endpoint or bad keys is turned down', () => {
  const { sub } = phone();
  const offCurve = Buffer.alloc(65, 1);
  offCurve[0] = 0x04;
  for (const bad of [
    null, 'x', {},
    { ...sub, endpoint: 'https://evil.com/x' },
    { endpoint: sub.endpoint },
    { ...sub, keys: { ...sub.keys, p256dh: sub.keys.p256dh.slice(0, 60) } },
    { ...sub, keys: { ...sub.keys, p256dh: offCurve.toString('base64url') } },
    { ...sub, keys: { ...sub.keys, p256dh: `${sub.keys.p256dh}!` } },
    { ...sub, keys: { ...sub.keys, auth: crypto.randomBytes(12).toString('base64url') } },
    { ...sub, keys: { ...sub.keys, auth: 42 } },
  ]) assert.equal(push.normalizeSubscription(bad), null, JSON.stringify(bad));
});

// ------------------------------------------------------------------ the request

test('buildPushRequest gives the headers a push service wants, and a body the phone can open', () => {
  const keys = push.newVapidKeys();
  const { priv, sub } = phone('https://web.push.apple.com/QGuQ');
  const req = push.buildPushRequest(sub, { title: 'Shellby needs you' }, { keys, subject: 'https://getshellby.com/', ttl: 600, urgency: 'high', topic: 'prompt-t1' });
  assert.equal(req.url, sub.endpoint);
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.TTL, '600');
  assert.equal(req.headers.Urgency, 'high');
  assert.equal(req.headers.Topic, 'prompt-t1');
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(req.headers['Content-Type'], 'application/octet-stream');
  assert.equal(req.headers['Content-Length'], String(req.body.length));
  const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(req.headers.Authorization);
  assert.ok(m, req.headers.Authorization);
  assert.equal(m[2], keys.publicKey);
  assert.equal(JSON.parse(b(m[1].split('.')[1])).aud, 'https://web.push.apple.com');
  assert.deepEqual(JSON.parse(push.decrypt({ body: req.body, p256dhPrivate: priv, auth: sub.keys.auth })), { title: 'Shellby needs you' });
});

test('a bad topic is left off and a bad urgency becomes normal', () => {
  const keys = push.newVapidKeys();
  const { sub } = phone();
  for (const topic of ['has space', 'x'.repeat(33), 'a/b', 42]) {
    const req = push.buildPushRequest(sub, 'hi', { keys, subject: 'mailto:hi@getshellby.com', urgency: 'urgent', topic });
    assert.equal('Topic' in req.headers, false, String(topic));
    assert.equal(req.headers.Urgency, 'normal');
    assert.equal(req.headers.TTL, '3600');
  }
});

test('buildPushRequest says why it cannot build a request', () => {
  const keys = push.newVapidKeys();
  const { sub } = phone();
  assert.ok(push.buildPushRequest({ ...sub, endpoint: 'https://evil.com/' }, 'hi', { keys, subject: 'https://getshellby.com/' }).error);
  assert.ok(push.buildPushRequest(sub, 'hi', { keys: {}, subject: 'https://getshellby.com/' }).error);
  assert.ok(push.buildPushRequest(sub, 'hi', { keys, subject: 'http://getshellby.com/' }).error);
  assert.ok(push.buildPushRequest(sub, 'x'.repeat(5000), { keys, subject: 'https://getshellby.com/' }).error);
});

// ------------------------------------------------------------------ sending

const request = () => push.buildPushRequest(phone().sub, 'hi', { keys: push.newVapidKeys(), subject: 'https://getshellby.com/' });
const answer = status => async () => ({ status, text: async () => '' });

test('sendPush passes the request through as it is, refusing redirects', async () => {
  const req = request();
  let seen;
  const res = await push.sendPush(req, { fetchImpl: async (url, init) => { seen = { url, init }; return { status: 201, text: async () => '' }; } });
  assert.deepEqual(res, { ok: true, status: 201, gone: false });
  assert.equal(seen.url, req.url);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers, req.headers);
  assert.equal(seen.init.body, req.body);
  assert.equal(seen.init.redirect, 'error');
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test('a 410 or 404 means the subscription is gone', async () => {
  for (const status of [404, 410]) {
    const res = await push.sendPush(request(), { fetchImpl: answer(status) });
    assert.equal(res.ok, false);
    assert.equal(res.gone, true);
    assert.equal(res.status, status);
  }
  const busy = await push.sendPush(request(), { fetchImpl: answer(429) });
  assert.equal(busy.gone, false);
  assert.match(busy.error, /429/);
});

test('sendPush never throws, whatever fetch does', async () => {
  const res = await push.sendPush(request(), { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual(res, { ok: false, status: 0, gone: false, error: 'fetch failed' });
  // AbortSignal.timeout's timer doesn't hold the process open, so the hanging
  // fake fetch holds it instead, as a real socket would.
  const hang = (_url, { signal }) => new Promise((_r, reject) => {
    const keep = setTimeout(() => {}, 5000);
    signal.addEventListener('abort', () => { clearTimeout(keep); reject(signal.reason); });
  });
  const slow = await push.sendPush(request(), { timeoutMs: 20, fetchImpl: hang });
  assert.equal(slow.ok, false);
  assert.match(slow.error, /timed out/);
  const none = await push.sendPush({ error: 'not a valid push subscription' });
  assert.equal(none.ok, false);
});
