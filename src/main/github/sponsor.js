// Do you sponsor Shellby on GitHub? Asked of GitHub as you (the device-flow
// sign-in, github/auth.js), so a private sponsorship counts too: GitHub tells
// the sponsor, never anyone else. A sponsorship that has ended still counts
// (activeOnly: false): 🏮 Patron of the Deep, like every trophy, stays once
// earned, at the best tier reached. What's done with the answer is in
// patron.js and wiring/credits.js.
const { perksFor } = require('../patron');

const OWNER = 'x-salmon';
const SPONSOR_URL = `https://github.com/sponsors/${OWNER}`;
const QUERY = 'query($login: String!) { viewer { login databaseId } user(login: $login) { sponsorshipForViewerAsSponsor(activeOnly: false) { privacyLevel tier { monthlyPriceInCents isOneTime } } } }';

/**
 * gh: a GitHubApi (github/api.js).
 * -> { id, login, isPublic, perks: { rank, gifts } } for a sponsor (id: your GitHub
 *    account's number, which never passes to anyone else; perks: patron.js perksFor
 *    its tier), false for someone who never has, or null when GitHub couldn't say
 *    (offline, an error, an odd answer).
 */
async function ownSponsorship(gh, owner = OWNER) {
  try {
    const r = await gh.post('/graphql', { query: QUERY, variables: { login: owner } });
    if (Array.isArray(r?.errors) && r.errors.length) return null;
    const viewer = r?.data?.viewer;
    const user = r?.data?.user;
    if (!Number.isSafeInteger(viewer?.databaseId) || typeof viewer?.login !== 'string') return null;
    if (!user || typeof user !== 'object' || !('sponsorshipForViewerAsSponsor' in user)) return null;
    const s = user.sponsorshipForViewerAsSponsor;
    if (s === null) return false;
    return { id: viewer.databaseId, login: viewer.login, isPublic: s?.privacyLevel === 'PUBLIC', perks: perksFor(s?.tier || null) };
  } catch {
    return null;
  }
}

module.exports = { OWNER, SPONSOR_URL, ownSponsorship };
