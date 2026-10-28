// The Time page's hours, following you between PCs (github/sync.js), once you
// switch on "Sync my hours" there. Off by default: until then they stay on
// the PC that kept them.
//
// Each PC writes only its own share (the seconds it tracked, the time you
// added or took off there, and its notes), with when that share last changed,
// so the newest of each PC's shares wins, the way his finds do (sync/life.js).
// Nothing is added into this PC's own books: the Time page lays the other PCs'
// shares over them when it adds up a range (combine), so this PC's share is
// always just what it kept itself, and a sync can never count anything twice.
// Switching it off sends an empty share once, so the other PCs drop this one's
// hours too.
//
// A project is a folder, and the same repo can live in a different folder on
// each PC, so another PC's folder counts for the project here with the same
// folder name (when just one has it); else it shows as a project of its own.
// A project's client, rate, name and billable flag follow whichever PC changed
// them last (adopt).
//
// What stays on each PC: whether it keeps time at all, the idle limit, the
// rounding and the currency, and what it sent to Toggl, Clockify or Harvest
// (each PC sends its own hours, so nothing goes over twice).
// Pure. See test/sync-hours.test.js.
const tt = require('../timetrack');

const DEVICE_RE = /^[a-z0-9-]{4,40}$/;
const PID_RE = /^[^\\/:*?"<>|\u0000-\u001f]{1,100}$/;
const MAX_DEVICES = 4;
const MAX_PROJECTS = 200;
// The gist is read only below 512 KB (github/sync.js MAX_BYTES), so each PC's
// share travels up to this (in bytes, as the gist is written: indented),
// newest days first: older ones stay on their PC.
const SHARE_BYTES = 24 * 1024;
const INDENT_BYTES = 8; // github/sync.js writes the gist one space a level deep: each entry's line starts this far in
const KINDS = ['days', 'manual', 'notes'];
const META = ['name', 'client', 'rate', 'billable', 'ignored'];

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const pos = v => (Number.isFinite(v) && v > 0 ? v : 0);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const own = (map, k) => (map && Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined);

/** What matches a project between PCs: its folder's name, case-folded. */
const pidOf = key => String(key || '').split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() || '';

// A folder from the gist is only ever a drive's (C:\...) or a POSIX one: never a
// network share (\\host\share), which git would go and reach for.
const UNC = /^[\\/]{2}/;
const localOnly = days => Object.fromEntries(Object.entries(isObj(days) ? days : {})
  .map(([day, m]) => [day, Object.fromEntries(Object.entries(isObj(m) ? m : {}).filter(([k]) => !UNC.test(k)))]));
const sizeOf = m => Buffer.byteLength(JSON.stringify(m)) + Object.keys(m).length * INDENT_BYTES;

/** One PC's hours: clean, and cut to SHARE_BYTES by dropping the oldest days. */
function cleanBody(raw) {
  const s = tt.normalize(isObj(raw) ? { days: localOnly(raw.days), manual: localOnly(raw.manual), notes: localOnly(raw.notes) } : {});
  const days = [...new Set(KINDS.flatMap(k => Object.keys(s[k])))].sort().reverse();
  const out = { days: {}, manual: {}, notes: {} };
  let bytes = 0;
  for (const day of days) {
    const part = KINDS.map(k => (s[k][day] ? sizeOf(s[k][day]) + day.length + INDENT_BYTES : 0)).reduce((a, b) => a + b, 0);
    if (bytes + part > SHARE_BYTES) break;
    bytes += part;
    for (const k of KINDS) if (s[k][day]) out[k][day] = s[k][day];
  }
  // Oldest first, as timetrack keeps them, so two copies of one share compare equal.
  for (const k of KINDS) out[k] = Object.fromEntries(Object.entries(out[k]).sort(([a], [b]) => (a < b ? -1 : 1)));
  return out;
}

/** A project's details as they travel: { name, client, rate, billable, ignored, at }. */
function cleanMeta(raw) {
  const p = tt.cleanProject(raw);
  return { ...Object.fromEntries(META.map(k => [k, p[k]])), at: p.at };
}

/**
 * Which of two copies of a project's details wins: the newer change, and when
 * neither was ever changed, the one with a rate or client, then either way the
 * same pick on every PC.
 */
function newerMeta(a, b) {
  if (!a || !b) return a || b || null;
  if (a.at !== b.at) return b.at > a.at ? b : a;
  const filled = m => (m.rate ? 2 : 0) + (m.client ? 1 : 0);
  if (filled(a) !== filled(b)) return filled(b) > filled(a) ? b : a;
  return JSON.stringify(b) > JSON.stringify(a) ? b : a;
}

/** Tolerate anything (remote data especially). -> { shares: { device: { at, days, manual, notes } }, projects: { pid: meta } } */
function clean(raw) {
  const r = isObj(raw) ? raw : {};
  const shares = Object.entries(isObj(r.shares) ? r.shares : {}).filter(([dev, e]) => DEVICE_RE.test(dev) && isObj(e))
    .sort((x, y) => pos(y[1].at) - pos(x[1].at)).slice(0, MAX_DEVICES)
    .map(([dev, e]) => [dev, { at: pos(e.at), ...cleanBody(e) }])
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  const projects = Object.entries(isObj(r.projects) ? r.projects : {}).filter(([pid, m]) => PID_RE.test(pid) && pid === pid.toLowerCase() && isObj(m))
    .slice(0, MAX_PROJECTS).map(([pid, m]) => [pid, cleanMeta(m)])
    .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return { shares: Object.fromEntries(shares), projects: Object.fromEntries(projects) };
}

/**
 * This PC's part, on top of what it last knew (timeElsewhere): its own share
 * worked out afresh, the other PCs' as they last came. get: config.get.
 * device: this PC's id (progression/xp.js).
 */
function snapshot(get, device, now) {
  const known = clean(get('timeElsewhere'));
  const s = tt.normalize(get('timeTracking'));
  const shares = { ...known.shares };
  const projects = { ...known.projects };
  if (DEVICE_RE.test(device || '')) {
    const was = own(known.shares, device);
    const mine = s.sync ? cleanBody(s) : cleanBody({});
    // Off and never shared: nothing to say. Off after sharing: an empty share, so the others drop it.
    if (s.sync || was) {
      const { at: _at, ...wasBody } = was || {};
      // A change is always newer than the share it replaces, even with this PC's clock gone back.
      shares[device] = { at: was && same(wasBody, mine) ? was.at : Math.max(now, pos(was?.at) + 1), ...mine };
    }
  }
  if (s.sync) {
    for (const [key, p] of Object.entries(s.projects)) {
      const pid = pidOf(key);
      if (PID_RE.test(pid)) projects[pid] = newerMeta(own(projects, pid), cleanMeta(p));
    }
  }
  return clean({ shares, projects });
}

/** Both sides together: the newest share of each PC, the newest details of each project. */
function merge(aIn, bIn) {
  const a = clean(aIn), b = clean(bIn);
  const shares = {};
  for (const dev of new Set([...Object.keys(a.shares), ...Object.keys(b.shares)])) {
    const x = own(a.shares, dev), y = own(b.shares, dev);
    shares[dev] = !x || (y && y.at > x.at) ? y : x;
  }
  const projects = {};
  for (const pid of new Set([...Object.keys(a.projects), ...Object.keys(b.projects)])) projects[pid] = newerMeta(own(a.projects, pid), own(b.projects, pid));
  return clean({ shares, projects });
}

/** What to write into this PC's settings for a merged part (a patch for config.set). */
function patchFor(mergedIn, get) {
  const merged = clean(mergedIn);
  return same(merged, clean(get('timeElsewhere'))) ? {} : { timeElsewhere: merged };
}

/**
 * This PC's books with the newer details of each project from the other PCs
 * laid in. Returns the same object when nothing changed.
 */
function adopt(stateIn, elsewhereIn) {
  const s = tt.normalize(stateIn);
  if (!s.sync) return stateIn;
  const e = clean(elsewhereIn);
  /** @type {Record<string, any> | null} */
  let projects = null;
  for (const [key, p] of Object.entries(s.projects)) {
    const theirs = own(e.projects, pidOf(key));
    if (!theirs) continue;
    const mine = cleanMeta(p);
    if (same(mine, theirs) || newerMeta(mine, theirs) !== theirs) continue;
    projects = projects || { ...s.projects };
    projects[key] = { ...p, ...theirs };
  }
  return projects ? tt.normalize({ ...s, projects }) : stateIn;
}

/** A folder from another PC -> the project here it counts for: the same folder, else the one here with its name, else itself. */
function keyMap(state, known = []) {
  const local = new Set([...Object.keys(state.projects), ...known]);
  const byPid = new Map();
  for (const k of local) byPid.set(pidOf(k), [...(byPid.get(pidOf(k)) || []), k]);
  return path => {
    if (local.has(path)) return path;
    const hits = byPid.get(pidOf(path)) || [];
    return hits.length === 1 ? hits[0] : path;
  };
}

/**
 * This PC's books with the other PCs' hours laid over them, for adding up a
 * range (timetrack.summarize). Off on this PC: just its own. known: the keys
 * of projects this PC knows but has no time for yet.
 */
function combine(stateIn, elsewhereIn, device, known = []) {
  const s = tt.normalize(stateIn);
  if (!s.sync) return s;
  const e = clean(elsewhereIn);
  const others = Object.entries(e.shares).filter(([dev]) => dev !== device).map(([, share]) => share);
  if (!others.length) return s;
  const keyFor = keyMap(s, known);
  const out = { days: { ...s.days }, manual: { ...s.manual }, notes: { ...s.notes } };
  const projects = { ...s.projects };
  const knownSet = new Set(known);
  for (const share of others) {
    for (const kind of KINDS) {
      for (const [day, m] of Object.entries(share[kind])) {
        const into = { ...(out[kind][day] || {}) };
        for (const [path, v] of Object.entries(m)) {
          const key = keyFor(path);
          if (kind === 'notes') { if (!into[key]) into[key] = v; } else into[key] = (into[key] || 0) + v;
          if (!own(projects, key) && !knownSet.has(key)) projects[key] = tt.cleanProject(own(e.projects, pidOf(key)) || { name: path.split(/[\\/]/).filter(Boolean).pop() });
        }
        out[kind][day] = into;
      }
    }
  }
  return tt.normalize({ ...s, ...out, projects });
}

/** A stamp for a project's details changed now: after any copy of them seen yet, even with a clock gone wrong. */
function stampFor(stateIn, elsewhereIn, key, now) {
  const theirs = own(clean(elsewhereIn).projects, pidOf(key));
  return Math.max(now, pos(tt.projectOf(tt.normalize(stateIn), key)?.at) + 1, pos(theirs?.at) + 1);
}

/** Seconds the other PCs have for a project here on a day (shown when you try to take it off here). */
function elsewhereOn(stateIn, elsewhereIn, device, key, day, known = []) {
  const s = tt.normalize(stateIn);
  if (!s.sync) return 0;
  const e = clean(elsewhereIn);
  const keyFor = keyMap(s, known);
  let n = 0;
  for (const [dev, share] of Object.entries(e.shares)) {
    if (dev === device) continue;
    for (const kind of ['days', 'manual']) for (const [path, v] of Object.entries(share[kind][day] || {})) if (keyFor(path) === key) n += v;
  }
  return Math.max(0, n);
}

/** Whether a settings change touched anything synced here (config.onSet), to sync soon. */
function moved(patch, prev) {
  if (!('timeTracking' in patch)) return false;
  const a = tt.normalize(patch.timeTracking), b = tt.normalize(prev.timeTracking);
  return a.sync !== b.sync || (a.sync && !same(Object.values(a.projects).map(cleanMeta), Object.values(b.projects).map(cleanMeta)));
}

module.exports = { clean, snapshot, merge, patchFor, adopt, combine, elsewhereOn, stampFor, moved, pidOf, newerMeta, SHARE_BYTES };
