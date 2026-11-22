// Whose plan a conversation spends (pure: no Electron, no I/O).
//
// A conversation in a folder on another computer runs that computer's Claude
// Code, signed in there (remote/service.js). When that's another Claude
// account, its rate-limit events say how full *that* plan is: they must not
// move this PC's meter, limit nap, forecast or guard. They're kept per
// computer here instead, and the meter shows them while you're in one of its
// tabs (renderer tab-meters.js).
//
// Treated as your own plan (null): a folder on this PC, a computer signed in
// with the same email or one whose sign-in Shellby hasn't seen yet, and any
// computer while this PC itself isn't signed in (Claude Code only over there:
// that computer's plan is the only one you use).

const limits = require('../limits');

/** @param {unknown} a @param {unknown} b */
const sameEmail = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * place: remote/service placeOf(cwd) or null; computer: its remoteComputers row;
 * local: claude auth status on this PC ({ loggedIn, email }).
 * -> null (this PC's plan) | { host, email, plan }
 */
function accountFor({ place, computer, local }) {
  if (!place?.host) return null;
  if (!local?.loggedIn) return null;
  const check = computer?.check || null;
  if (typeof check?.email !== 'string' || !check.email || sameEmail(check.email, local.email)) return null;
  return { host: place.host, email: check.email, plan: check.subscriptionType || null };
}

const hostKey = host => String(host).toLowerCase();

/**
 * A reading for another account, merged into the per-computer map (a new map).
 * A window the event doesn't mention keeps its last value, so a bare
 * "allowed" event never empties the meter. The status doesn't: an old "rejected"
 * must not outlive a reading that no longer says so (limitOf).
 */
function withReading(byHost, account, item, now) {
  const map = byHost && typeof byHost === 'object' ? byHost : {};
  const prev = readingFor(map, account) || {}; // never another account's, from before a new sign-in there
  return {
    ...map,
    [hostKey(account.host)]: {
      host: account.host, email: account.email, plan: account.plan,
      status: item.status ?? null,
      fiveHour: item.fiveHour || prev.fiveHour || null,
      sevenDay: item.sevenDay || prev.sevenDay || null,
      at: now,
    },
  };
}

/**
 * The reading a conversation on `account` sees: its computer's, or null. One
 * taken while that computer was signed in to someone else is no longer theirs.
 */
function readingFor(byHost, account) {
  const r = account && byHost ? byHost[hostKey(account.host)] || null : null;
  return r && sameEmail(r.email, account.email) ? r : null;
}

/**
 * The limit a kept reading says its account is at: { window, resetsAt }, or null
 * once that has reset. Judged as of when it was taken: a 5-hour window that has
 * rolled over since doesn't make the weekly one the reason it was rejected.
 */
function limitOf(reading, now) {
  const hit = reading ? limits.limitFrom(reading, reading.at ?? now) : null;
  return hit && hit.resetsAt > now ? hit : null;
}

/** When "after the reset" is for a kept reading: its limit's reset, else the 5-hour window's. Null when not known. */
function resetOf(reading, now) {
  const hit = limitOf(reading, now);
  if (hit) return hit.resetsAt;
  const r = reading?.fiveHour?.resetsAt;
  return Number.isFinite(r) && r > now ? r : null;
}

/**
 * What the panel needs: every computer that's on another account, with its
 * last reading when there is one, and the limit it's at. computers: remoteComputers; byHost: withReading's map.
 */
function othersView(computers, byHost, local, now = Date.now()) {
  return (computers || [])
    .map(c => accountFor({ place: { host: c?.alias }, computer: c, local }))
    .filter(Boolean)
    .map(a => {
      const r = readingFor(byHost, a);
      const hit = limitOf(r, now);
      return {
        host: a.host, email: a.email, plan: a.plan, status: r?.status || null, fiveHour: r?.fiveHour || null, sevenDay: r?.sevenDay || null, at: r?.at || null,
        limit: hit ? { ...hit, name: limits.windowName(hit.window) } : null,
      };
    });
}

/**
 * Is this PC's saved reading (config.lastUsage) someone else's? Each reading
 * keeps the email it was taken under (`account`). One from another account, or
 * from before readings said whose they were, no longer fits a sign-in with an
 * email. Signed out, or a sign-in with no email (an API key): there's no way to
 * tell, so it stays.
 * @param {{ account?: string | null } | null | undefined} reading
 * @param {{ loggedIn?: boolean, email?: string | null } | null | undefined} local
 */
function usageStale(reading, local) {
  if (!reading || !local?.loggedIn || typeof local.email !== 'string' || !local.email) return false;
  return !sameEmail(reading.account, local.email);
}

module.exports = { accountFor, withReading, readingFor, limitOf, resetOf, othersView, hostKey, usageStale, sameEmail };
