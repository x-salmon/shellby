// What you use: how often you open each of the panel's screens, and how often
// you do each thing with him (dress him, keep a find, decorate the tank...),
// counted on this PC and never sent anywhere (it isn't one of the settings Sync
// carries). Settings → System → What you use reads it back: the screens you
// live in, and the ones you've never opened, each with a line on what it's
// for; then the things you do most and the ones you never have. Only known
// screens and actions count, one at a time. Pure: no I/O; main records the
// actions (wiring/feature-acts.js). See test/feature-use.test.js.
const { ROOMS } = require('./rooms');

// Every screen worth counting: the rooms, plus the ones that are always there
// or sit one level down. Settings and onboarding aren't features.
const SCREENS = Object.freeze([
  { id: 'chat', name: 'Chat', text: 'Where you and Claude work.' },
  ...ROOMS.filter(r => !r.part).map(({ id, name, text, in: inside }) => ({ id, name, text, ...(inside ? { in: inside } : {}) })), // a part (the Reef) is a card, not a screen
  { id: 'wardrobe', name: 'Outfits', text: 'His wardrobe: hats, shells and colours, more as he levels up.' },
  { id: 'shop', in: 'toolbox', name: 'Skill Shop', text: 'The Toolbox’s Get more tab: plugins with skills, agents and tools to add to Claude Code.' },
  { id: 'routines', in: 'workflows', name: 'Routines', text: 'A prompt that runs on a schedule, or Claude cloud routines.' },
  { id: 'time', in: 'history', name: 'Time', text: 'Hours per project from your conversations, for a timesheet.' },
]);
const BY_ID = new Map(SCREENS.map(s => [s.id, s]));

// Every thing you can do with him worth counting, each with the line Settings
// shows. A fixed list: an id main doesn't know is ignored, so a stale renderer
// can't invent a row. Rewards now open inline in chat too (reward-opened), so
// a visit to a screen under-counts what gets used.
const ACTIONS = Object.freeze([
  { id: 'outfit', name: 'Dressed him', text: 'Changed his outfit in the Wardrobe or from an outfit code.' },
  { id: 'find-made', name: 'Dug up a find', text: 'A find he dug up for you, on his own or when you asked him to dig.' },
  { id: 'find-kept', name: 'Kept a find', text: 'Made one of his finds your favourite.' },
  { id: 'bug-caught', name: 'Caught a bug', text: 'A bug Claude fixed went into a jar.' },
  { id: 'battle', name: 'Watched a bug battle', text: 'A battle played out on the Bugdex screen to its catch or its escape.' },
  { id: 'sticker-placed', name: 'Placed a sticker', text: 'Put a shipping sticker on his shell, or had him arrange them.' },
  { id: 'tank', name: 'Decorated the tank', text: 'Saved a layout of his tank.' },
  { id: 'reward-opened', name: 'Opened a reward', text: 'Opened a reward card where it appeared in chat.' },
]);
const ACTION_BY_ID = new Map(ACTIONS.map(a => [a.id, a]));
// Opened or done in the last this-many days counts as still in use.
const DORMANT_DAYS = 30;
const DAY = 86400000;

const count = n => Math.max(0, Math.floor(Number(n) || 0));
const time = t => (Number.isFinite(t) && t > 0 ? t : 0);

/** The counts under `key` of a stored value, kept to the ids `known` has. */
function counts(v, key, known) {
  const out = {};
  const raw = v && typeof v === 'object' && v[key] && typeof v[key] === 'object' ? v[key] : {};
  for (const id of Object.keys(raw)) {
    if (!known.has(id)) continue;
    const n = count(raw[id]?.n);
    if (n) out[id] = { n, last: time(raw[id]?.last) };
  }
  return out;
}

/** A stored value made safe: { since, views: { id: { n, last } }, uses: { id: { n, last } } }. A value from before `uses` is still good. */
function normalize(v) {
  return { since: time(v?.since), views: counts(v, 'views', BY_ID), uses: counts(v, 'uses', ACTION_BY_ID) };
}

/** `key`'s count for `id` one up, at `now`. */
function tally(s, key, id, now) {
  const was = s[key][id];
  return { ...s, since: s.since || now, [key]: { ...s[key], [id]: { n: (was?.n || 0) + 1, last: now } } };
}

/** A visit to screen `id` at `now`. Unknown screens leave it as it was. */
function record(v, id, now) {
  const s = normalize(v);
  return BY_ID.has(id) ? tally(s, 'views', id, now) : s;
}

/** Action `id` done at `now`. Unknown actions leave it as it was. */
function act(v, id, now) {
  const s = normalize(v);
  return ACTION_BY_ID.has(id) ? tally(s, 'uses', id, now) : s;
}

/**
 * One list sorted three ways: `used` most-counted first, `quiet` counted but
 * not for DORMANT_DAYS, `never` not counted since counting began. Each has the
 * list's own fields (id, name, text...); used and quiet also n and last.
 */
function sorted(all, tallies, now) {
  const seen = all.filter(x => tallies[x.id]).map(x => ({ ...x, ...tallies[x.id] }));
  const isQuiet = x => now - x.last > DORMANT_DAYS * DAY;
  return {
    used: seen.filter(x => !isQuiet(x)).sort((a, b) => b.n - a.n || b.last - a.last),
    quiet: seen.filter(isQuiet).sort((a, b) => b.last - a.last),
    never: all.filter(x => !tallies[x.id]),
  };
}

/**
 * What Settings shows: the screens as `used`, `quiet` and `never` (each with
 * id, name, text and `in`, the screen it's a tab of), and `actions` the same
 * three ways for the things you do with him.
 */
function report(v, now) {
  const s = normalize(v);
  return { since: s.since || null, ...sorted(SCREENS, s.views, now), actions: sorted(ACTIONS, s.uses, now) };
}

module.exports = { SCREENS, ACTIONS, DORMANT_DAYS, normalize, record, act, report };
