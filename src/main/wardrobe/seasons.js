// Seasonal events. Each season is a yearly window of [month, day] dates
// (inclusive, local time) that may wrap the new year. While a season is active
// its items can be unlocked ({"unlock": {"season": "<id>"}}) and its outfit is
// suggested. Outfit values are item keys from the built-in packs in src/wardrobe.
//
// The windows are written for the northern hemisphere. The ones that follow the
// weather (`nature`: spring, summer, autumn) move six months for someone south
// of the equator ({ south: true }, from the town picked for the weather; see
// weather/index.js); the holidays keep their dates wherever you are.
//
// Holidays that move (Thanksgiving, Easter, Mother's Day...) carry `dates(year)`,
// which gives that year's window; their `start`/`end` are the widest it can be.
// None of them wrap the new year.

/** @typedef {[number, number]} MonthDay */

/** [month, day] of the nth `weekday` (0 = Sunday) of a month; n = -1 is the last. @returns {MonthDay} */
function nthWeekday(year, month, weekday, n) {
  if (n < 0) {
    const last = new Date(year, month, 0);
    return [month, last.getDate() - ((last.getDay() - weekday + 7) % 7)];
  }
  const first = new Date(year, month - 1, 1).getDay();
  return [month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7];
}
/** Western Easter Sunday (the anonymous Gregorian computus). @returns {MonthDay} */
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((8 * b + 13) / 25) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return [Math.floor(n / 31), (n % 31) + 1];
}
/** A window from `before` days ahead of [month, day] to `after` days past it. @param {number} year @param {MonthDay} md @param {number} before @param {number} after */
function around(year, [m, d], before, after) {
  /** @returns {MonthDay} */
  const at = k => { const x = new Date(year, m - 1, d + k); return [x.getMonth() + 1, x.getDate()]; };
  return { start: at(-before), end: at(after) };
}

const freeze = s => Object.freeze({ ...s, start: Object.freeze(s.start), end: Object.freeze(s.end), outfit: Object.freeze(s.outfit) });

const SEASONS = Object.freeze([
  { id: 'halloween', name: 'Spooky Season', emoji: '🎃', start: [10, 1], end: [11, 2], priority: 3, outfit: { hat: 'witch-hat', held: 'pumpkin-pail', shell: 'bat-wings', effect: 'bats' } },
  { id: 'winter', name: 'Winter Holidays', emoji: '❄️', start: [12, 1], end: [1, 7], priority: 3, outfit: { hat: 'santa-hat', neck: 'striped-scarf', held: 'candy-cane', effect: 'snow' } },
  { id: 'valentine', name: 'Valentine’s', emoji: '💘', start: [2, 7], end: [2, 15], priority: 3, outfit: { hat: 'heart-antennae', face: 'blush', held: 'rose', shell: 'cupid-wings', effect: 'hearts' } },
  { id: 'spring', name: 'Spring', emoji: '🌱', start: [3, 20], end: [5, 31], priority: 1, nature: true, outfit: { hat: 'flower-crown', shell: 'sprout' } },
  { id: 'summer', name: 'Summer', emoji: '☀️', start: [6, 21], end: [8, 31], priority: 1, nature: true, outfit: { hat: 'sun-hat', face: 'beach-shades', neck: 'lei', held: 'ice-cream', effect: 'fireflies' } },
  { id: 'autumn', name: 'Autumn', emoji: '🍂', start: [9, 15], end: [11, 30], priority: 2, nature: true, outfit: { hat: 'acorn-cap', neck: 'autumn-scarf', shell: 'wheat-sheaf', effect: 'leaves' } },
  // Holidays. Priority 3 beats autumn and spring; New Year's Eve's 4 beats winter.
  { id: 'new-year', name: 'New Year’s Eve', emoji: '🎆', start: [12, 30], end: [1, 1], priority: 4, outfit: { hat: 'new-year-tiara', face: 'countdown-glasses', held: 'noisemaker', effect: 'midnight-confetti' } },
  { id: 'st-patricks', name: 'St. Patrick’s Day', emoji: '☘️', start: [3, 14], end: [3, 17], priority: 3, outfit: { hat: 'leprechaun-hat', neck: 'shamrock-pin', held: 'pot-of-gold', effect: 'clovers' } },
  { id: 'easter', name: 'Easter', emoji: '🐣', start: [3, 15], end: [4, 26], priority: 3, dates: y => around(y, easter(y), 7, 1), outfit: { hat: 'bunny-ears', held: 'egg-basket', shell: 'painted-egg' } },
  { id: 'earth-day', name: 'Earth Day', emoji: '🌍', start: [4, 20], end: [4, 22], priority: 3, outfit: { hat: 'sapling-hat', held: 'little-globe', shell: 'moss-shell' } },
  { id: 'mothers-day', name: 'Mother’s Day', emoji: '💐', start: [5, 6], end: [5, 14], priority: 3, dates: y => around(y, nthWeekday(y, 5, 0, 2), 2, 0), outfit: { neck: 'pearl-necklace', held: 'carnation' } },
  { id: 'memorial-day', name: 'Memorial Day', emoji: '🎗️', start: [5, 23], end: [5, 31], priority: 3, dates: y => around(y, nthWeekday(y, 5, 1, -1), 2, 0), outfit: { neck: 'remembrance-ribbon', held: 'memorial-wreath' } },
  { id: 'fathers-day', name: 'Father’s Day', emoji: '👔', start: [6, 13], end: [6, 21], priority: 3, dates: y => around(y, nthWeekday(y, 6, 0, 3), 2, 0), outfit: { hat: 'dad-cap', neck: 'necktie', held: 'grill-spatula' } },
  { id: 'independence-day', name: 'Fourth of July', emoji: '🎇', start: [7, 2], end: [7, 5], priority: 3, outfit: { hat: 'star-topper', held: 'sparkler', effect: 'fireworks' } },
  { id: 'labor-day', name: 'Labor Day', emoji: '🛠️', start: [8, 30], end: [9, 7], priority: 3, dates: y => around(y, nthWeekday(y, 9, 1, 1), 2, 0), outfit: { hat: 'builder-helmet', neck: 'work-bandana', held: 'lunch-pail' } },
  { id: 'veterans-day', name: 'Veterans Day', emoji: '🎖️', start: [11, 9], end: [11, 11], priority: 3, outfit: { hat: 'garrison-cap', neck: 'service-medal', held: 'poppy' } },
  { id: 'thanksgiving', name: 'Thanksgiving', emoji: '🦃', start: [11, 19], end: [12, 1], priority: 3, dates: y => around(y, nthWeekday(y, 11, 4, 4), 3, 3), outfit: { hat: 'turkey-hat', neck: 'napkin-bib', held: 'drumstick', shell: 'cornucopia' } },
].map(freeze));

const KNOWN_SEASONS = new Set(SEASONS.map(s => s.id));

// Six months on: [3, 20] -> [9, 20]. A day the new month doesn't have comes
// back to its last ([8, 31] -> [2, 28], [5, 31] -> [11, 30]), since the
// Wardrobe turns ends into real dates for its banner (service.js windowEnd).
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const halfYear = ([m, d]) => { const to = ((m + 5) % 12) + 1; return [to, Math.min(d, MONTH_DAYS[to - 1])]; };
const southern = new Map(SEASONS.filter(s => s.nature).map(s => [s.id, freeze({ ...s, start: halfYear(s.start), end: halfYear(s.end) })]));

/** The season as it falls where you are: nature seasons flip south of the equator. */
const local = (season, { south = false } = {}) => (south && southern.get(season.id)) || season;
/** The season with `year`'s dates (only the moving holidays change). */
const forYear = (season, year) => (season.dates ? freeze({ ...season, ...season.dates(year) }) : season);
const byId = (id, opts) => { const s = SEASONS.find(x => x.id === id); return s ? local(s, opts) : null; };

// [month, day] -> comparable number, e.g. [10, 1] -> 1001
const md = ([m, d]) => m * 100 + d;
const wraps = s => md(s.start) > md(s.end);

function validDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
}

function inWindow(season, date) {
  season = forYear(season, date.getFullYear());
  const today = (date.getMonth() + 1) * 100 + date.getDate();
  const a = md(season.start);
  const b = md(season.end);
  return wraps(season) ? today >= a || today <= b : today >= a && today <= b;
}

const startIn = (season, year) => { const s = forYear(season, year); return new Date(year, s.start[0] - 1, s.start[1]); };

/** Is `seasonId` running on `date`? Unknown ids are never active. */
function isActive(seasonId, date = new Date(), opts = {}) {
  const s = byId(seasonId, opts);
  return !!s && inWindow(s, validDate(date));
}

/** Every season running on `date`, highest priority first (ties by id), with the dates where you are. */
function activeSeasons(date = new Date(), opts = {}) {
  const d = validDate(date);
  return SEASONS.map(s => forYear(local(s, opts), d.getFullYear())).filter(s => inWindow(s, d))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The one season to feature in the UI, or null. */
function featuredSeason(date = new Date(), opts = {}) {
  return activeSeasons(date, opts)[0] || null;
}

/**
 * Start (local midnight) of the current window if the season is active,
 * otherwise of the next window strictly after `date`. Unknown id → null.
 */
function nextStart(seasonId, date = new Date(), opts = {}) {
  const s = byId(seasonId, opts);
  if (!s) return null;
  const d = validDate(date);
  const year = d.getFullYear();
  if (inWindow(s, d)) {
    // A wrapping window seen from January started the previous year.
    const today = (d.getMonth() + 1) * 100 + d.getDate();
    return startIn(s, wraps(s) && today < md(s.start) ? year - 1 : year);
  }
  const thisYear = startIn(s, year);
  return thisYear > d ? thisYear : startIn(s, year + 1);
}

module.exports = { SEASONS, KNOWN_SEASONS, activeSeasons, featuredSeason, isActive, nextStart, local, forYear };
