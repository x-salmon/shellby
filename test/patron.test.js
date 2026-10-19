const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const patron = require('../src/main/patron');
const card = require('../src/main/github/card');
const { loadCatalog } = require('../src/main/wardrobe/catalog');
const { KNOWN_ACHIEVEMENTS } = require('../src/main/wardrobe/achievements');

const BUILTIN = path.join(__dirname, '..', 'src', 'wardrobe');
const keys = crypto.generateKeyPairSync('ed25519');
const KEYS = { 1: keys.publicKey.export({ type: 'spki', format: 'pem' }) };
const DAY_S = 86400;
const nowS = () => Math.floor(Date.now() / 1000);
const signFor = (payload, { key = keys.privateKey, domain = patron.DOMAIN } = {}) => {
  const body = Buffer.from(JSON.stringify(payload));
  return `${body.toString('base64url')}.${crypto.sign(null, Buffer.concat([domain, body]), key).toString('base64url')}`;
};
const proofFor = (login, id, extra = {}) => signFor({ v: 3, k: 1, id, login, r: 1, g: 0, exp: nowS() + 30 * DAY_S, ...extra });
function withTestKey(t) {
  const real = patron.PUBLIC_KEYS;
  patron.PUBLIC_KEYS = KEYS;
  t.after(() => { patron.PUBLIC_KEYS = real; });
}

test('the built-in public key is a real Ed25519 key, and the items are the trophy\'s', () => {
  for (const pem of Object.values(patron.PUBLIC_KEYS)) assert.equal(crypto.createPublicKey(pem).asymmetricKeyType, 'ed25519');
  assert.deepEqual([...patron.PATRON_ITEMS.keys()].sort(), ['abyss', 'abyssal-clam', 'anglers-lantern', 'bioluminescence', 'message-in-a-bottle', 'sunken-galleon']);
  assert.deepEqual(patron.PATRON_ITEMS.get('abyss'), { perk: 'rank', goal: 4 });
});

test('verifyProof: genuine, unexpired and for this account, whatever the login\'s case', () => {
  const p = proofFor('Fan', 101);
  assert.equal(patron.verifyProof(p, { login: 'fan', id: 101 }, KEYS).id, 101);
  assert.equal(patron.verifyProof(p, { login: 'fan' }, KEYS).login, 'Fan', 'the id is checked when given');
});

test('verifyProof: refuses forgeries, other accounts, expired proofs and junk', () => {
  const ok = { login: 'fan', id: 101 };
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  assert.equal(patron.verifyProof(signFor({ v: 3, k: 1, id: 101, login: 'fan', r: 1, g: 0, exp: nowS() + DAY_S }, { key: other }), ok, KEYS), null, 'signed by someone else');
  assert.equal(patron.verifyProof(signFor({ v: 3, k: 1, id: 101, login: 'fan', r: 1, g: 0, exp: nowS() + DAY_S }, { domain: Buffer.alloc(0) }), ok, KEYS), null, 'signed for something else');
  assert.equal(patron.verifyProof(proofFor('fan', 101), { login: 'someone-else', id: 101 }, KEYS), null, 'borrowed by login');
  assert.equal(patron.verifyProof(proofFor('fan', 101), { login: 'fan', id: 999 }, KEYS), null, 'a login now on another account');
  assert.equal(patron.verifyProof(proofFor('fan', 101, { exp: nowS() - 1 }), ok, KEYS), null, 'run out');
  assert.equal(patron.verifyProof(proofFor('fan', 101, { k: 2 }), ok, KEYS), null, 'a key it doesn\'t know');
  assert.equal(patron.verifyProof(proofFor('fan', 101, { v: 1 }), ok, KEYS), null, 'another version');
  const [, sig] = proofFor('fan', 101).split('.');
  const edited = `${Buffer.from(JSON.stringify({ v: 3, k: 1, id: 103, login: 'cheat', r: 4, g: 2, exp: nowS() + DAY_S })).toString('base64url')}.${sig}`;
  assert.equal(patron.verifyProof(edited, { login: 'cheat', id: 103 }, KEYS), null, 'payload edited');
  for (const junk of [null, 42, '', 'a.b', 'x'.repeat(5000), `${'a'.repeat(20)}.${'!'.repeat(86)}`]) assert.equal(patron.verifyProof(junk, ok, KEYS), null);
  assert.equal(patron.verifyProof(proofFor('fan', 101), { login: '../evil' }, KEYS), null, 'a bad login');
  assert.equal(patron.verifyProof(proofFor('fan', 101), undefined, KEYS), null);
});

test('seal and open: only what this PC sealed opens', () => {
  const safe = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(`k${s}`), decryptString: b => { const t = b.toString(); if (t[0] !== 'k') throw new Error('no'); return t.slice(1); } };
  const sealed = patron.seal(safe, { login: 'fan', id: 101, rank: 3, gifts: 1 });
  assert.deepEqual(patron.open(safe, sealed), { login: 'fan', id: 101, rank: 3, gifts: 1 });
  assert.equal(patron.open(safe, Buffer.from('{"v":3,"login":"fan","id":101,"rank":4,"gifts":2}').toString('base64')), null, 'written by hand');
  assert.equal(patron.seal(safe, { login: 'fan', id: 101, rank: 9, gifts: 0 }), null, 'no such tier');
  assert.equal(patron.open({ ...safe, isEncryptionAvailable: () => false }, sealed), null);
  assert.equal(patron.seal({ isEncryptionAvailable: () => false }, { login: 'fan', id: 101 }), null);
  assert.equal(patron.seal(safe, { login: 'fan', rank: 1, gifts: 0 }), null, 'no account number');
  assert.equal(patron.open(safe, 'x'.repeat(10000)), null);
});

test('perksOnThisPc: waits for the OS rather than remembering a no', () => {
  let ready = false;
  const safe = { isEncryptionAvailable: () => ready, encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
  const sealed = Buffer.from(JSON.stringify({ v: 3, login: 'fan', id: 101, rank: 2, gifts: 0 })).toString('base64');
  const config = { get: () => ({ seals: { 101: sealed } }) };
  const proven = patron.perksOnThisPc(config, safe);
  assert.equal(proven(), null, 'not ready yet');
  ready = true;
  assert.deepEqual(proven(), { rank: 2, gifts: 0 }, 'ready now');
});

test('perksFor: the tiers on the Sponsors page', () => {
  const m = cents => patron.perksFor({ monthlyPriceInCents: cents, isOneTime: false });
  const o = cents => patron.perksFor({ monthlyPriceInCents: cents, isOneTime: true });
  assert.deepEqual([m(300), m(700), m(1500), m(4000)].map(p => p.rank), [1, 2, 3, 4]);
  assert.deepEqual([o(1000), o(5000)], [{ rank: 1, gifts: 1 }, { rank: 3, gifts: 2 }]);
  assert.deepEqual(patron.perksFor(null), { rank: 1, gifts: 0 }, 'a custom amount with no tier still counts');
  assert.deepEqual(patron.bestPerks({ rank: 4, gifts: 0 }, { rank: 1, gifts: 1 }), { rank: 4, gifts: 1 });
});

test('a friend only shows the tier their proof reaches', t => {
  withTestKey(t);
  const outfit = { hat: 'anglers-lantern', effect: 'bioluminescence', held: 'message-in-a-bottle' };
  const raw = { login: 'fan', skin: 'abyss', outfit, patron: proofFor('fan', 101, { r: 2, g: 0 }) };
  const c = card.cardFromGist(gist({ login: 'fan', id: 101 }, raw), 'fan').card;
  assert.equal(c.outfit.hat, 'anglers-lantern');
  assert.equal(c.outfit.effect, 'bioluminescence');
  assert.equal(c.outfit.held, null, 'the bottle is a one-time tier\'s');
  assert.equal(c.skin, null, 'the Abyss is a Leviathan\'s');
});

test('fetchProof: the proof, false for none, null when it can\'t say', async t => {
  withTestKey(t);
  const p = proofFor('Fan', 101);
  const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });
  assert.equal(await patron.fetchProof('Fan', { id: 101, fetchImpl: reply(200, { ok: true, proof: p }) }), p);
  assert.equal(await patron.fetchProof('Fan', { id: 101, fetchImpl: reply(404, { ok: false }) }), false);
  assert.equal(await patron.fetchProof('Fan', { id: 101, fetchImpl: reply(502, {}) }), null);
  assert.equal(await patron.fetchProof('Fan', { id: 999, fetchImpl: reply(200, { ok: true, proof: p }) }), null, 'not this account\'s');
  assert.equal(await patron.fetchProof('Fan', { id: 101, fetchImpl: async () => { throw new Error('offline'); } }), null);
  assert.equal(await patron.fetchProof('Fan', { fetchImpl: reply(200, { ok: true, proof: p }) }), null, 'no account number');
  let asked = null;
  await patron.fetchProof('Fan', { id: 101, fetchImpl: async (url, o) => { asked = { url, timeout: !!o.signal }; return { ok: false, status: 404 }; } });
  assert.deepEqual(asked, { url: 'https://getshellby.com/api/patron?login=fan', timeout: true }, 'lowercase, one URL per account, with a time limit');
});

const look = (extra = {}) => ({
  login: 'fan',
  outfit: { hat: 'anglers-lantern', effect: 'bioluminescence', neck: 'striped-scarf' },
  tank: { size: 'nano', style: {}, placed: [{ ref: 'abyssal-clam', x: 1, row: 0 }, { ref: 'rock-round', x: 3, row: 0 }] },
  ...extra,
});
const gist = (owner, raw) => ({ id: 'g1', owner, files: { 'shellby-card.json': { size: 900, content: JSON.stringify(raw) } } });

test('a friend\'s card without a proof loses the patron items, and nothing else', () => {
  const c = card.cardFromGist(gist({ login: 'fan', id: 101 }, look()), 'fan').card;
  assert.equal(c.outfit.hat, null);
  assert.equal(c.outfit.effect, null);
  assert.equal(c.outfit.neck, 'striped-scarf');
  assert.deepEqual(c.tank?.placed.map(p => p.ref), ['rock-round']);
  assert.equal(c.patron, null);
});

test('a friend\'s card with their own proof keeps them, and keeps them when read again', t => {
  withTestKey(t);
  // A Pearl Diver: lantern, plankton and clam.
  const c = card.cardFromGist(gist({ login: 'fan', id: 101 }, look({ patron: proofFor('fan', 101, { r: 3 }) })), 'fan').card;
  assert.equal(c.outfit.hat, 'anglers-lantern');
  assert.equal(c.outfit.effect, 'bioluminescence');
  assert.deepEqual(c.tank.placed.map(p => p.ref), ['abyssal-clam', 'rock-round']);
  // friends.js cleans the card it stored every time it reads it.
  assert.equal(card.cleanCard(c).outfit.hat, 'anglers-lantern');
});

test('a borrowed proof doesn\'t work: another login, or a login that changed hands', t => {
  withTestKey(t);
  // cheat's gist, with fan's real proof and fan's login written in it.
  const borrowed = card.cardFromGist(gist({ login: 'cheat', id: 103 }, look({ patron: proofFor('fan', 101) })), 'cheat').card;
  assert.equal(borrowed.login, 'cheat');
  assert.equal(borrowed.outfit.hat, null);
  // fan renamed; a stranger took the name "fan" (a new account, a new number).
  const squatter = card.cardFromGist(gist({ login: 'fan', id: 555 }, look({ patron: proofFor('fan', 101) })), 'fan').card;
  assert.equal(squatter.outfit.hat, null);
  // And a bare cleanCard, with no owner known, believes nothing.
  assert.equal(card.cleanCard(look({ patron: proofFor('fan', 101) })).outfit.hat, null);
});

test('your own card keeps the lantern and the proof on its way out', t => {
  withTestKey(t);
  const p = proofFor('fan', 101);
  const out = card.cleanCard(look({ patron: p }), { own: true });
  assert.equal(out.outfit.hat, 'anglers-lantern');
  assert.equal(out.patron, p);
});

test('an owner login outside the usual pattern is kept as GitHub gives it', () => {
  const c = card.cardFromGist(gist({ login: 'fan_corp', id: 7 }, look()), 'fan_corp').card;
  assert.equal(c.login, 'fan_corp');
});

test('patron items in a friend\'s tank style come off too', () => {
  const l = patron.withoutUnproven({ outfit: {}, tank: { style: { substrate: 'abyssal-clam', backdrop: 'sand' }, placed: [{ ref: 'rock-round' }] } }, null);
  assert.deepEqual(l.tank.style, { substrate: null, backdrop: 'sand' });
});

test('a pack of your own can\'t carry the supporter art, recoloured or not', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-patron-'));
  const community = JSON.parse(fs.readFileSync(path.join(BUILTIN, 'community.json'), 'utf8'));
  const lantern = community.accessories.find(a => a.id === 'anglers-lantern');
  const clam = community.decor.find(x => x.id === 'abyssal-clam');
  // Every letter renamed and recoloured, and the unlock dropped.
  const rename = rows => rows.map(r => r.replace(/[^.]/g, ch => String.fromCharCode(ch.charCodeAt(0) ^ 32)));
  const palette = p => Object.fromEntries(Object.keys(p).map(k => [String.fromCharCode(k.charCodeAt(0) ^ 32), '#123456']));
  fs.writeFileSync(path.join(dir, 'copy.json'), JSON.stringify({
    format: 1, id: 'totally-mine', name: 'Mine', author: 'me', version: '1.0.0',
    accessories: [
      { ...lantern, id: 'my-lantern', unlock: undefined, pixels: rename(lantern.pixels), palette: palette(lantern.palette) },
      { id: 'my-hat', name: 'My Hat', slot: 'hat', pivot: [1, 1], palette: { a: '#ff0000' }, pixels: ['aaa', 'aaa', 'aaa'] },
    ],
    decor: [{ ...clam, id: 'my-clam', unlock: undefined }],
  }));
  const cat = loadCatalog({ builtinDir: BUILTIN, userDir: dir, knownAchievements: KNOWN_ACHIEVEMENTS });
  assert.ok(!cat.accessories.has('totally-mine/my-lantern'));
  assert.ok(!cat.decor.has('totally-mine/my-clam'));
  assert.ok(cat.accessories.has('totally-mine/my-hat'), 'an ordinary hat still loads');
  assert.ok(cat.accessories.has('anglers-lantern'), 'the real one is still there');
  const warnings = cat.packs.find(p => p.id === 'totally-mine')?.warnings || [];
  assert.ok(warnings.some(w => /supporter item/.test(w)), warnings.join('; '));
});
