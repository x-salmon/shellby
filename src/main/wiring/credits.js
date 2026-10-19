// Credits (credits.js), wired up: the Made by list on About, and the
// contributor trophies (🪸 Reef Builder, 🔧 Shipwright, 🏆 Contest Champion,
// 🎨 Contestant, and 🏮 Patron of the Deep for sponsoring). At boot and
// whenever you sign in, the GitHub login you're signed in with is looked up in
// src/community/credits.json, which ships with each release, and in the
// gallery's index (its optional `by`, `contest` and `winner`: the pack makers
// the gallery knows of before a release does).
// The index is read at most once a day, only while you're signed in and
// Community news is on. Without a sign-in nothing can be known, so the
// trophies say "Sign in to GitHub to claim". Sponsoring is asked of GitHub
// itself (github/sponsor.js), at sign-in and then at most once a day, whatever
// Community news says. The answer is sealed before it's kept, and a public
// sponsor's signed proof for the calling card comes from getshellby.com
// (patron.js says why). See docs/COMMUNITY.md.
const fs = require('fs');
const path = require('path');
const credits = require('../credits');
const { fetchRegistryIndex } = require('../registry');
const sponsor = require('../github/sponsor');
const patron = require('../patron');

const FILE = path.join(__dirname, '..', '..', 'community', 'credits.json');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FIRST_MS = 40 * 1000; // after boot, behind the news fetch
const INDEX_MAX = 500;      // index entries kept for a login: plenty for one person

/**
 * d: what main shares (main.js `shared`): config, github, stat, log, registryUrl, every.
 * opts: stand-ins for tests: safeStorage (Electron's otherwise) and fetchImpl (for the patron proof).
 */
function wireCredits(d, opts = {}) {
  let shipped = null;
  /** The credits this release shipped with (read once, made safe). */
  function shippedCredits() {
    if (shipped) return shipped;
    try { shipped = credits.normalize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch (e) {
      d.log.warn('credits: could not read credits.json', e?.message || String(e));
      shipped = credits.normalize(null);
    }
    return shipped;
  }

  const login = () => (d.github?.signedIn ? d.github.view().login : null);
  const read = () => {
    const c = d.config?.get('credits');
    return c && typeof c === 'object' ? c : {};
  };
  // The gallery's entries made by this login, as last read: [{ id, by, contest, winner }].
  const indexFor = who => {
    const c = read();
    return who && c.login && c.login.toLowerCase() === who.toLowerCase() && Array.isArray(c.index) ? c.index.slice(0, INDEX_MAX).map(e => ({ ...e, by: who })) : [];
  };

  // { login, checkedAt, nextAt, seals, proof }: seals are patron.seal's, one per GitHub account
  // ({ [id]: sealed }); proof is the signed one for the signed-in account (public sponsors only).
  const sponsorState = () => {
    const c = d.config?.get('sponsor');
    return c && typeof c === 'object' ? c : {};
  };
  const safe = () => opts.safeStorage || require('electron').safeStorage;
  /**
   * The sponsor perks proven on this PC ({ rank, gifts } or null): the sealed answer opens, and you're
   * signed out or signed in as the account it's for. They stay after you sign out, as trophies do.
   * wiring/wardrobe.js makes it.
   */
  const patronPerks = d.patronPerks || patron.perksOnThisPc(d.config, safe, login);
  /** The signed proof for your calling card: unexpired, and for the account you're signed in as. */
  const patronProof = () => {
    const who = login();
    const mine = who && Object.values(patron.sealsOf(sponsorState())).map(v => patron.open(safe(), v)).find(o => o && o.login.toLowerCase() === who.toLowerCase());
    const p = sponsorState().proof;
    return mine && patron.verifyProof(p, { login: who, id: mine.id }) ? p : null;
  };

  /** What the signed-in login is credited for, or null when nobody's signed in. */
  const mine = () => {
    const me = credits.forLogin(shippedCredits(), login(), indexFor(login()));
    return me && { ...me, sponsor: !!patronPerks() };
  };

  /** Tell the trophies (wardrobe/achievements.js): highs only, so it's harmless to say again. */
  function checkCredits() {
    if (d.CAPTURE || !d.config) return;
    for (const [event, n] of credits.trophyStats(mine())) d.stat(event, { n });
    // Sponsoring isn't in credits.json: it's the sealed answer, signed in or not (patron.js).
    const perks = patronPerks();
    if (perks) d.stat('patron-rank', { n: perks.rank });
    if (perks?.gifts) d.stat('patron-gifts', { n: perks.gifts });
  }

  /** The gallery's index, once a day while signed in and Community news is on. */
  async function refreshIndex({ force = false } = {}) {
    const who = login();
    if (!who || d.config.get('communityNews') === false) return;
    const c = read();
    const same = c.login && c.login.toLowerCase() === who.toLowerCase();
    if (!force && same && Date.now() - (c.checkedAt || 0) < DAY_MS) return;
    const r = await fetchRegistryIndex({ baseUrl: d.registryUrl() });
    if (!r.ok) { d.log.info(`credits: index not read (${r.errors[0]})`); return; }
    const index = r.packs.filter(p => p.by && p.by.toLowerCase() === who.toLowerCase()).slice(0, INDEX_MAX).map(({ id, contest, winner }) => ({ id, contest, winner }));
    d.config.set({ credits: { login: who, checkedAt: Date.now(), index } });
    checkCredits();
  }

  /**
   * Ask GitHub whether you sponsor Shellby: at most once a day, or now with force. One ask
   * at a time; one for an account you've since signed out of is followed by one for you.
   */
  let asking = null;
  function refreshSponsor({ force = false } = {}) {
    const who = login();
    if (asking && asking.who !== who) return asking.promise.then(() => refreshSponsor({ force: true }));
    if (!asking) {
      const promise = askSponsor({ force }).finally(() => { if (asking?.promise === promise) asking = null; });
      asking = { who, promise };
    }
    return asking.promise;
  }
  async function askSponsor({ force }) {
    const who = login();
    if (!who || d.CAPTURE || !d.config || !d.github?.gh) return;
    const c = d.config.get('sponsor');
    const same = c && typeof c.login === 'string' && c.login.toLowerCase() === who.toLowerCase();
    if (!force && same && Date.now() < (c.nextAt || (c.checkedAt || 0) + DAY_MS)) return;
    const s = await sponsor.ownSponsorship(d.github.gh());
    // GitHub couldn't say: keep what it said last, and ask again next time round.
    if (s === null) { d.log.info('credits: sponsorship not read'); return; }
    // Only a public sponsorship gets a proof friends can check; a private one stays between you and GitHub.
    const proof = s && s.isPublic ? await patron.fetchProof(s.login, { id: s.id, fetchImpl: opts.fetchImpl }) : false;
    // Signed in as someone else while GitHub was asked: that answer isn't theirs.
    if (login()?.toLowerCase() !== who.toLowerCase()) return;
    const was = sponsorState();
    // Never sponsored (or the OS can't seal it): whatever was proven before stays, as trophies do.
    // The best tier this account has reached: a lower one now doesn't take a trophy back.
    // Each account has its own seal, so signing in as another never costs this one its tier.
    const seals = patron.sealsOf(was);
    const before = s ? patron.open(safe(), seals[s.id]) : null;
    const best = s && patron.bestPerks(s.perks, before);
    const sealed = s && patron.seal(safe(), { login: s.login, id: s.id, ...best });
    if (s && !sealed) d.log.warn('credits: sponsoring, but the OS could not seal it');
    if (sealed) {
      delete seals[s.id];
      seals[s.id] = sealed; // newest last: sealsOf keeps the newest when there are too many
    }
    // No new proof (getshellby.com down, or not on its list yet): the last one stands until it
    // runs out. Not once the sponsorship is private: then it comes off the card at once.
    const kept = s && s.isPublic && same && patron.verifyProof(was.proof, { login: who, id: s.id }) ? was.proof : null;
    const now = Date.now();
    // A public sponsor without a proof yet (just made public, say) is asked again within the hour.
    const nextAt = s?.isPublic && !proof && !kept ? now + HOUR_MS : now + DAY_MS;
    d.config.set({ sponsor: { login: who, checkedAt: now, nextAt, seals: patron.sealsOf({ seals }), proof: proof || kept || null, isPublic: !!s?.isPublic } });
    checkCredits();
    d.broadcastWardrobe?.();
  }

  /** About → Made by: everyone, grouped, with you marked. */
  function creditsView() {
    const me = mine();
    return {
      groups: credits.groups(shippedCredits(), login()),
      signedIn: !!login(),
      mine: me ? { login: me.login, code: me.code, packs: me.packs.length, wins: me.wins.map(credits.monthName), entries: me.entries.length, sponsor: me.sponsor, shown: me.sponsor && !!patronProof() } : null,
      sponsorUrl: sponsor.SPONSOR_URL,
    };
  }

  function startCredits() {
    let was = login();
    checkCredits();
    d.github?.on?.('change', () => {
      const now = login();
      if (now === was) return;
      was = now;
      checkCredits();
      d.broadcastWardrobe?.(); // "Sign in to GitHub to claim" comes and goes with the sign-in
      refreshIndex().catch(e => d.log.warn('credits index failed', e?.message || String(e)));
      refreshSponsor({ force: true }).catch(e => d.log.warn('credits sponsor check failed', e?.message || String(e)));
    });
    const both = () => { refreshIndex().catch(() => {}); refreshSponsor().catch(() => {}); };
    setTimeout(both, FIRST_MS).unref?.();
    d.every(both, DAY_MS / 4);
    // Hourly, though it only asks when it's due (nextAt): a sponsor who just went public isn't kept waiting.
    d.every(() => refreshSponsor().catch(() => {}), HOUR_MS);
  }

  return { creditsView, checkCredits, startCredits, shippedCredits, myCredits: mine, refreshSponsor, patronPerks, patronProof };
}

module.exports = { wireCredits, CREDITS_FILE: FILE };
