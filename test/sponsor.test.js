const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const sponsor = require('../src/main/github/sponsor');
const patron = require('../src/main/patron');
const { Config } = require('../src/main/config');
const { Wardrobe } = require('../src/main/wardrobe/service');
const { wireCredits } = require('../src/main/wiring/credits');

const BUILTIN = path.join(__dirname, '..', 'src', 'wardrobe');
// Each tier's own reward (wardrobe/achievements.js), lowest monthly first, then the one-time ones.
const LADDER = ['anglers-lantern', 'bioluminescence', 'abyssal-clam', 'abyss'];
const GIFTS = ['message-in-a-bottle', 'sunken-galleon'];
const ALL = [...LADDER, ...GIFTS];

// The OS's safeStorage, stood in for: only what it sealed opens.
const fakeSafe = {
  isEncryptionAvailable: () => true,
  encryptString: s => Buffer.from(`sealed:${Buffer.from(s).toString('hex')}`),
  decryptString: b => {
    const t = b.toString();
    if (!t.startsWith('sealed:')) throw new Error('not ours');
    return Buffer.from(t.slice(7), 'hex').toString();
  },
};

// getshellby.com's signer, stood in for with a key pair of the test's own.
const keys = crypto.generateKeyPairSync('ed25519');
const IDS = { fan: 101, quiet: 102, cheat: 103, 'someone-else': 104 };
const signFor = (login, { rank = 1, gifts = 0 } = {}) => {
  const body = Buffer.from(JSON.stringify({ v: 3, k: 1, id: IDS[login.toLowerCase()], login, r: rank, g: gifts, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }));
  return `${body.toString('base64url')}.${crypto.sign(null, Buffer.concat([patron.DOMAIN, body]), keys.privateKey).toString('base64url')}`;
};
function withTestKey(t) {
  const real = patron.PUBLIC_KEYS;
  patron.PUBLIC_KEYS = { 1: keys.publicKey.export({ type: 'spki', format: 'pem' }) };
  t.after(() => { patron.PUBLIC_KEYS = real; });
}

/** A GitHubApi stand-in: answers /graphql with `answer` (a value or an Error). */
function fakeGh(answer) {
  const calls = [];
  return {
    calls,
    answer,
    async post(p, body) {
      calls.push({ path: p, body });
      if (this.answer instanceof Error) throw this.answer;
      return this.answer;
    },
  };
}
// GitHub's answer for the signed-in account (who: its login).
const says = (s, who = 'fan') => ({ data: { viewer: { login: who, databaseId: IDS[who] }, user: { sponsorshipForViewerAsSponsor: s } } });
// A sponsorship as GitHub gives it: public or not, and its tier (cents a month, or once).
const monthly = (cents, privacyLevel = 'PUBLIC') => ({ privacyLevel, tier: { monthlyPriceInCents: cents, isOneTime: false } });
const once = (cents, privacyLevel = 'PUBLIC') => ({ privacyLevel, tier: { monthlyPriceInCents: cents, isOneTime: true } });
const PUBLIC = monthly(300);
const PRIVATE = monthly(300, 'PRIVATE');

test('ownSponsorship asks GitHub about x-salmon, as you, past sponsorships too, with the tier', async () => {
  const gh = fakeGh(says(PUBLIC));
  assert.deepEqual(await sponsor.ownSponsorship(gh), { id: 101, login: 'fan', isPublic: true, perks: { rank: 1, gifts: 0 } });
  assert.equal(gh.calls[0].path, '/graphql');
  assert.equal(gh.calls[0].body.variables.login, 'x-salmon');
  assert.match(gh.calls[0].body.query, /sponsorshipForViewerAsSponsor\(activeOnly: false\)/);
  assert.match(gh.calls[0].body.query, /tier \{ monthlyPriceInCents isOneTime \}/);
  assert.deepEqual(await sponsor.ownSponsorship(fakeGh(says(monthly(1500, 'PRIVATE')))), { id: 101, login: 'fan', isPublic: false, perks: { rank: 3, gifts: 0 } });
  assert.deepEqual((await sponsor.ownSponsorship(fakeGh(says({ privacyLevel: 'PUBLIC', tier: null })))).perks, { rank: 1, gifts: 0 }, 'a custom amount with no tier');
  assert.equal(await sponsor.ownSponsorship(fakeGh(says(null))), false, 'never sponsored');
});

test('ownSponsorship says null when GitHub can\'t say', async () => {
  assert.equal(await sponsor.ownSponsorship(fakeGh(new Error('offline'))), null);
  assert.equal(await sponsor.ownSponsorship(fakeGh({ data: { user: null } })), null, 'no such user');
  assert.equal(await sponsor.ownSponsorship(fakeGh({ errors: [{ message: 'nope' }] })), null);
  assert.equal(await sponsor.ownSponsorship(fakeGh({ data: { viewer: {}, user: { sponsorshipForViewerAsSponsor: null } } })), null, 'no account number');
  assert.equal(await sponsor.ownSponsorship(fakeGh({ ...says(PUBLIC), errors: [{ message: 'partly' }] })), null, 'any error, even with data');
});

// The wiring, with a real Wardrobe and its trophies, and GitHub and the signer faked.
function rig({ login = null, answer = says(null), signer = who => ({ status: 200, body: { ok: true, proof: signFor(who) } }), safe = fakeSafe } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-sponsor-'));
  const config = new Config(dir);
  const gh = fakeGh(answer);
  const github = Object.assign(new EventEmitter(), {
    signedIn: !!login, login, gh: () => gh,
    view() { return { signedIn: this.signedIn, login: this.signedIn ? this.login : null }; },
  });
  const fetched = [];
  const fetchImpl = async url => {
    const who = new URL(url).searchParams.get('login');
    fetched.push(who);
    const r = signer(who);
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  const d = { config, github, log: { info() {}, warn() {} }, every() {}, registryUrl: () => 'http://127.0.0.1:9/' };
  const opts = { safeStorage: safe, fetchImpl };
  d.patronPerks = patron.perksOnThisPc(config, safe, () => (github.signedIn ? github.login : null));
  const w = new Wardrobe({ config, builtinDir: BUILTIN, userDir: path.join(dir, 'packs'), now: () => new Date(2026, 10, 5), signedIn: () => github.signedIn, patron: d.patronPerks });
  w.load();
  d.stat = (e, p) => w.record(e, p);
  const fns = wireCredits(d, opts);
  return { d, w, github, gh, fns, config, fetched, opts };
}
const patronCard = w => w.view().achievements.find(a => a.id === 'patron');

test('a public sponsor gets Patron of the Deep, the lantern and a proof for the card', async t => {
  withTestKey(t);
  const r = rig({ login: 'fan', answer: says(PUBLIC) });
  assert.equal(patronCard(r.w).link.url, sponsor.SPONSOR_URL, 'locked: the card says where to sponsor');
  await r.fns.refreshSponsor();
  assert.ok(r.w.data.unlocked.includes('patron'));
  assert.ok(r.w.isUnlocked(r.w.item('anglers-lantern')));
  for (const id of ALL.slice(1)) assert.ok(!r.w.isUnlocked(r.w.item(id)), `${id} is another tier's`);
  assert.equal(patronCard(r.w).link, null, 'earned: nothing left to do');
  assert.deepEqual(r.fetched, ['fan']);
  assert.ok(patron.verifyProof(r.fns.patronProof(), { login: 'fan', id: 101 }));
  assert.deepEqual([r.fns.creditsView().mine.sponsor, r.fns.creditsView().mine.shown], [true, true]);
  assert.equal(typeof r.config.get('sponsor').sponsoring, 'undefined', 'no plain yes/no kept');
});

test('a private sponsor gets the trophy, but no proof is asked for', async t => {
  withTestKey(t);
  const r = rig({ login: 'quiet', answer: says(PRIVATE, 'quiet') });
  await r.fns.refreshSponsor();
  assert.ok(r.w.isUnlocked(r.w.item('anglers-lantern')));
  assert.deepEqual(r.fetched, [], 'getshellby.com never hears of a private sponsor');
  assert.equal(r.fns.patronProof(), null);
  assert.deepEqual([r.fns.creditsView().mine.sponsor, r.fns.creditsView().mine.shown], [true, false]);
});

test('editing config.json unlocks nothing', async () => {
  const r = rig({ login: 'cheat' });
  const w = r.config.get('wardrobe') || {};
  r.config.set({ wardrobe: { ...w, unlocked: ['patron'] }, stats: { supporter: 1 } });
  r.config.set({ sponsor: { login: 'cheat', sealed: Buffer.from('{"v":2,"login":"cheat","id":103}').toString('base64'), sponsoring: true } });
  assert.ok(!r.w.isUnlocked(r.w.item('anglers-lantern')));
  assert.ok(!r.w.data.unlocked.includes('patron'));
  assert.equal(patronCard(r.w).done, false);
  r.fns.checkCredits();
  assert.ok(!r.w.isUnlocked(r.w.item('abyssal-clam')), 'and checking again doesn\'t either');
});

test('a sponsor\'s config copied to another PC unlocks nothing there', async () => {
  const r = rig({ login: 'fan', answer: says(PRIVATE) });
  await r.fns.refreshSponsor();
  const copied = { wardrobe: r.config.get('wardrobe'), stats: r.config.get('stats'), sponsor: r.config.get('sponsor') };
  // Another PC's safeStorage can't open this one's seal.
  const elsewhere = rig({ safe: { ...fakeSafe, decryptString: () => { throw new Error('wrong key'); } } });
  elsewhere.config.set(copied);
  assert.ok(!elsewhere.w.isUnlocked(elsewhere.w.item('anglers-lantern')));
});

test('once proven, it stays: after the sponsorship ends and after signing out', async t => {
  withTestKey(t);
  const r = rig({ login: 'fan', answer: says(PUBLIC) });
  await r.fns.refreshSponsor();
  r.gh.answer = says(null);
  await r.fns.refreshSponsor({ force: true });
  assert.ok(r.w.isUnlocked(r.w.item('anglers-lantern')));
  r.github.signedIn = false;
  r.github.emit('change');
  assert.ok(r.w.isUnlocked(r.w.item('anglers-lantern')), 'signed out');
});

test('no trophy again on a later start: no second celebration', async t => {
  withTestKey(t);
  const r = rig({ login: 'fan', answer: says(PUBLIC) });
  await r.fns.refreshSponsor();
  const again = new Wardrobe({ config: r.config, builtinDir: BUILTIN, userDir: path.join(os.tmpdir(), 'none'), patron: r.d.patronPerks });
  again.load();
  let unlocked = 0;
  again.on('unlocked', e => { if (e.achievement.id === 'patron') unlocked += 1; });
  again.record('task-completed', {});
  r.d.stat = (e, p) => again.record(e, p);
  r.fns.checkCredits();
  assert.equal(unlocked, 0);
});

test('not a sponsor, or not signed in: locked, and saying why', async () => {
  const no = rig({ login: 'fan', answer: says(null) });
  await no.fns.refreshSponsor();
  assert.ok(!no.w.data.unlocked.includes('patron'));
  assert.equal(no.w.lockInfo(no.w.item('anglers-lantern')).text, 'Patron of the Deep: Sponsor Shellby on GitHub, any tier');

  const out = rig();
  await out.fns.refreshSponsor();
  assert.equal(out.gh.calls.length, 0, 'signed out: GitHub isn\'t asked');
  assert.equal(out.w.lockInfo(out.w.item('abyssal-clam')).text, 'Pearl Diver: sign in to GitHub to claim');
  assert.equal(no.w.lockInfo(no.w.item('abyss')).text, 'Leviathan: Sponsor Shellby at $40 a month or more', 'each says its own tier');
});

test('GitHub is asked at most once a day, and errors keep what was known', async t => {
  withTestKey(t);
  const r = rig({ login: 'fan', answer: says(PUBLIC) });
  await r.fns.refreshSponsor();
  await r.fns.refreshSponsor();
  assert.equal(r.gh.calls.length, 1, 'the second, the same day, is skipped');

  const proof = r.fns.patronProof();
  r.gh.answer = new Error('offline');
  await r.fns.refreshSponsor({ force: true });
  assert.equal(r.fns.patronProof(), proof, 'GitHub down: kept');

  r.gh.answer = says(PUBLIC);
  r.opts.fetchImpl = async () => ({ ok: false, status: 502, json: async () => ({}) });
  await r.fns.refreshSponsor({ force: true });
  assert.equal(r.fns.patronProof(), proof, 'the signer down: kept');
});

test('an answer that arrives after a switch to another login is dropped', async () => {
  const r = rig({ login: 'fan' });
  let answer;
  r.gh.post = () => new Promise(res => { answer = res; });
  const asking = r.fns.refreshSponsor();
  r.github.login = 'someone-else';
  answer(says(PRIVATE));
  await asking;
  assert.equal(r.config.get('sponsor'), null, 'fan\'s answer isn\'t written while someone-else is signed in');
  assert.ok(!r.w.data.unlocked.includes('patron'));
});

test('signing in asks GitHub straight away', async () => {
  const r = rig({ answer: says(PRIVATE) });
  r.fns.startCredits();
  r.github.signedIn = true;
  r.github.login = 'fan';
  r.github.emit('change');
  await new Promise(res => setImmediate(res));
  assert.equal(r.gh.calls.length, 1);
  assert.ok(r.w.data.unlocked.includes('patron'));
});

test("a sponsor can't lend it by signing in on someone else's PC", async () => {
  const r = rig({ login: 'fan', answer: says(PRIVATE) });
  await r.fns.refreshSponsor();
  assert.ok(r.w.isUnlocked(r.w.item('anglers-lantern')), 'fan, signed in');
  r.github.login = 'cheat';
  assert.ok(!r.w.isUnlocked(r.w.item('anglers-lantern')), 'cheat, signed in after fan');
  r.github.signedIn = false;
  assert.ok(r.w.isUnlocked(r.w.item('anglers-lantern')), 'nobody signed in: it stays, as trophies do');
});

test('one ask at a time, and a public sponsor without a proof is asked again within the hour', async t => {
  withTestKey(t);
  const r = rig({ login: 'fan', answer: says(PUBLIC), signer: () => ({ status: 404, body: { ok: false } }) });
  await Promise.all([r.fns.refreshSponsor(), r.fns.refreshSponsor(), r.fns.refreshSponsor()]);
  assert.equal(r.gh.calls.length, 1);
  const c = r.config.get('sponsor');
  assert.ok(c.nextAt - c.checkedAt <= 60 * 60 * 1000, 'soon, not tomorrow');
  assert.equal(r.fns.patronProof(), null);
  assert.ok(r.w.isUnlocked(r.w.item('anglers-lantern')), 'the trophy itself is already yours');
});

// What each tier unlocks: [GitHub's sponsorship, the items it unlocks].
const TIERS = [
  ['$3 a month (Krill)', monthly(300), ['anglers-lantern']],
  ['$1 a month, a custom amount', monthly(100), ['anglers-lantern']],
  ['$7 a month (Lanternfish)', monthly(700), ['anglers-lantern', 'bioluminescence']],
  ['$15 a month (Pearl Diver)', monthly(1500), ['anglers-lantern', 'bioluminescence', 'abyssal-clam']],
  ['$40 a month (Leviathan)', monthly(4000), LADDER],
  ['$5 once', once(500), ['anglers-lantern']],
  ['$10 once (Message in a Bottle)', once(1000), ['anglers-lantern', 'message-in-a-bottle']],
  ['$50 once (Sunken Treasure)', once(5000), ['anglers-lantern', 'bioluminescence', 'abyssal-clam', ...GIFTS]],
];
for (const [name, sponsorship, unlocked] of TIERS) {
  test(`each tier unlocks its own rewards: ${name}`, async () => {
    const r = rig({ login: 'fan', answer: says(sponsorship) });
    await r.fns.refreshSponsor();
    assert.deepEqual(ALL.filter(id => r.w.isUnlocked(r.w.item(id))), unlocked);
  });
}

test('every published tier gets something different from every other', () => {
  // The six tiers on the Sponsors page (the names in brackets); custom amounts fall into one of them.
  const published = TIERS.filter(([name]) => name.includes('(')).map(([, , unlocked]) => unlocked.join());
  assert.equal(published.length, 6);
  assert.equal(new Set(published).size, 6);
});

test('the best tier ever reached stays: moving down a tier takes nothing back', async () => {
  const r = rig({ login: 'fan', answer: says(monthly(4000)) });
  await r.fns.refreshSponsor();
  r.gh.answer = says(monthly(300));
  await r.fns.refreshSponsor({ force: true });
  assert.ok(r.w.isUnlocked(r.w.item('abyss')), 'still a Leviathan');
  r.gh.answer = says(once(1000));
  await r.fns.refreshSponsor({ force: true });
  assert.deepEqual(ALL.filter(id => r.w.isUnlocked(r.w.item(id))), [...LADDER, 'message-in-a-bottle'], 'and a bottle on top');
});

test("a higher tier in config.json alone unlocks nothing past what's proven", async () => {
  const r = rig({ login: 'fan', answer: says(PUBLIC) });
  await r.fns.refreshSponsor();
  const w = r.config.get('wardrobe');
  r.config.set({ wardrobe: { ...w, unlocked: [...w.unlocked, 'leviathan', 'sunken-treasure'] }, stats: { ...r.config.get('stats'), patronRank: 4, patronGifts: 2 } });
  assert.ok(r.w.isUnlocked(r.w.item('anglers-lantern')));
  assert.ok(!r.w.isUnlocked(r.w.item('abyss')));
  assert.ok(!r.w.isUnlocked(r.w.item('sunken-galleon')));
});

test('a non-sponsor signing in on this PC, and changing his outfit, costs the sponsor nothing', async () => {
  const r = rig({ login: 'fan', answer: says(monthly(700)) });
  let celebrations = 0;
  r.w.on('unlocked', e => { if (e.achievement.id === 'lanternfish') celebrations += 1; });
  await r.fns.refreshSponsor();
  assert.equal(celebrations, 1);
  r.github.login = 'cheat';
  assert.ok(!r.w.isUnlocked(r.w.item('bioluminescence')), 'not while cheat is signed in');
  r.w.setOutfit({ hat: null }); // any save at all
  r.w.record('task-completed', {});
  r.github.login = 'fan';
  r.fns.checkCredits();
  assert.ok(r.w.isUnlocked(r.w.item('bioluminescence')), 'back for fan');
  assert.equal(celebrations, 1, 'and no second celebration');
});

test('two sponsor accounts on one PC each keep their own tier', async () => {
  const r = rig({ login: 'fan', answer: says(monthly(4000)) });
  await r.fns.refreshSponsor();
  r.github.login = 'quiet';
  r.gh.answer = says(monthly(300, 'PRIVATE'), 'quiet');
  await r.fns.refreshSponsor({ force: true });
  assert.ok(!r.w.isUnlocked(r.w.item('abyss')), 'quiet is a Krill');
  r.github.login = 'fan';
  assert.ok(r.w.isUnlocked(r.w.item('abyss')), 'fan is still a Leviathan');
});

test('going private takes the proof off the card at once', async t => {
  withTestKey(t);
  const r = rig({ login: 'fan', answer: says(PUBLIC) });
  await r.fns.refreshSponsor();
  assert.ok(r.fns.patronProof());
  r.gh.answer = says(PRIVATE);
  await r.fns.refreshSponsor({ force: true });
  assert.equal(r.fns.patronProof(), null);
  assert.ok(r.w.isUnlocked(r.w.item('anglers-lantern')), 'the lantern itself stays');
});
