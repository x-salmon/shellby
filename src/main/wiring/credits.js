// Credits (credits.js), wired up: the Made by list on About, and the
// contributor trophies (🪸 Reef Builder, 🔧 Shipwright, 🏆 Contest Champion,
// 🎨 Contestant). At boot and whenever you sign in, the GitHub login you're
// signed in with is looked up in src/community/credits.json, which ships with
// each release, and in the gallery's index (its optional `by`, `contest` and
// `winner`: the pack makers the gallery knows of before a release does).
// The index is read at most once a day, only while you're signed in and
// Community news is on. Without a sign-in nothing can be known, so the
// trophies say "Sign in to GitHub to claim". See docs/COMMUNITY.md.
const fs = require('fs');
const path = require('path');
const credits = require('../credits');
const { fetchRegistryIndex } = require('../registry');

const FILE = path.join(__dirname, '..', '..', 'community', 'credits.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_MS = 40 * 1000; // after boot, behind the news fetch
const INDEX_MAX = 500;      // index entries kept for a login: plenty for one person

/** d: what main shares (main.js `shared`): config, github, stat, log, registryUrl, every. */
function wireCredits(d) {
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

  /** What the signed-in login is credited for, or null when nobody's signed in. */
  const mine = () => credits.forLogin(shippedCredits(), login(), indexFor(login()));

  /** Tell the trophies (wardrobe/achievements.js): highs only, so it's harmless to say again. */
  function checkCredits() {
    if (d.CAPTURE || !d.config) return;
    for (const [event, n] of credits.trophyStats(mine())) d.stat(event, { n });
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

  /** About → Made by: everyone, grouped, with you marked. */
  function creditsView() {
    const me = mine();
    return {
      groups: credits.groups(shippedCredits(), login()),
      signedIn: !!login(),
      mine: me ? { login: me.login, code: me.code, packs: me.packs.length, wins: me.wins.map(credits.monthName), entries: me.entries.length } : null,
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
    });
    setTimeout(() => refreshIndex().catch(() => {}), FIRST_MS).unref?.();
    d.every(() => refreshIndex().catch(() => {}), DAY_MS / 4);
  }

  return { creditsView, checkCredits, startCredits, shippedCredits, myCredits: mine };
}

module.exports = { wireCredits, CREDITS_FILE: FILE };
