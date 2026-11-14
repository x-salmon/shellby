// The tide chart on the Automate page: every routine, workflow and held task
// on one line through time. Runs that already happened sit behind "now", the
// ones still to come ahead of it, and the usage window you're in is shaded so
// a task waiting for the reset shows where it will really run. Workflows that
// wait for something other than the clock (a red build, a file) can't be put
// on a timeline, so they're listed as "listening" instead.
//
// Pure: main sends each routine's and workflow's starts (routinesView,
// workflowView: upcoming, recent), the panel draws what this returns
// (panel/automate-tide.js). See test/tide-chart.test.js.
(function (root) {
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const WINDOW_MS = 5 * HOUR; // a usage window, ending at the reset
  const RANGES = Object.freeze({
    week: { behind: 36 * HOUR, ahead: 7 * DAY },
    day: { behind: 6 * HOUR, ahead: DAY },
  });
  const LEVELS = 3;         // label rows above the wave
  const LABEL_PAD_PX = 18;  // a label's padding and border
  const LABEL_GAP_PX = 8;   // room kept between two labels on one row
  // A schedule this frequent is drawn as one bar, not a ring per start
  // (a site check every 15 minutes would bury the week in rings).
  const DENSE_MIN = 6;
  const DENSE_GAP = 3 * HOUR;

  // A run's status, as one of the chart's tones.
  const RUN_TONE = Object.freeze({ ok: 'ok', error: 'err', stopped: 'off', running: 'run', retrying: 'run', waiting: 'wait' });

  const num = v => (Number.isFinite(v) ? v : null);
  const name = v => (typeof v === 'string' ? v : '');
  const toneOf = status => (typeof status === 'string' && Object.hasOwn(RUN_TONE, status) ? RUN_TONE[status] : 'done');
  const times = list => (Array.isArray(list) ? list.map(x => num(typeof x === 'object' && x ? x.at : x)).filter(v => v !== null) : []);

  /** The routines' marks: past starts from History, the next ones from the schedule. */
  function routineMarks(r) {
    const out = [];
    const past = times(r.recent).sort((a, b) => a - b);
    past.forEach((at, i) => {
      const latest = i === past.length - 1;
      const tone = latest && r.running ? 'run' : latest ? toneOf(r.lastStatus) : 'done';
      out.push({ kind: 'routine', id: r.id, name: name(r.name), at, tone });
    });
    if (r.enabled !== false) for (const at of times(r.upcoming)) out.push({ kind: 'routine', id: r.id, name: name(r.name), at, tone: 'plan' });
    return out;
  }

  function workflowMarks(w) {
    const out = [];
    for (const run of Array.isArray(w.recent) ? w.recent : []) {
      const at = num(run?.at);
      if (at !== null) out.push({ kind: 'workflow', id: w.id, name: name(w.name), at, tone: toneOf(run.status), runId: typeof run.runId === 'string' ? run.runId : null });
    }
    if (w.enabled !== false) for (const at of times(w.upcoming)) out.push({ kind: 'workflow', id: w.id, name: name(w.name), at, tone: 'plan' });
    return out;
  }

  // Held for the reset (main's held.js): a routine's run or a task from the queue.
  function heldMarks(held) {
    return (Array.isArray(held) ? held : []).filter(x => x && num(x.at) !== null && (x.kind === 'task' || x.kind === 'routine'))
      .map(x => ({ kind: 'held', id: x.id, name: x.name || (x.kind === 'task' ? 'Queued task' : 'Routine'), at: x.at, tone: x.running ? 'run' : 'held', routineId: x.routineId || null }));
  }

  const keyOf = m => `${m.kind}:${m.id}`;
  const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

  /** How often, in words: "every 15 min", "every hour", "every 2 hours". */
  function everyText(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `every ${min} min`;
    const hours = Math.round(min / 60);
    return hours === 1 ? 'every hour' : `every ${hours} hours`;
  }

  /**
   * Things that start every few minutes or hours: their starts still to come
   * become one streak from the first to the chart's end, and of what they did
   * only the latest run and the ones that went wrong or wait for you stay.
   */
  function thinDense(marks, to) {
    const groups = new Map();
    for (const m of marks) {
      const k = `${keyOf(m)}:${m.past ? 'past' : 'ahead'}`;
      groups.set(k, [...(groups.get(k) || []), m]);
    }
    const out = [];
    for (const list of groups.values()) {
      const gaps = list.slice(1).map((m, i) => m.at - list[i].at);
      if (list.length < DENSE_MIN || list[0].kind === 'held' || median(gaps) >= DENSE_GAP) { out.push(...list); continue; }
      if (list[0].past) {
        out.push(...list.filter((m, i) => i === list.length - 1 || m.tone === 'err' || m.tone === 'wait'));
        continue;
      }
      const every = median(gaps);
      out.push({ ...list[0], name: `${list[0].name}, ${everyText(every)}`, streak: { end: to, every } });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /** Day lines at each local midnight, named at midday; hours every six in the day view. */
  function ticks(from, to, now, range, locale) {
    const out = [];
    if (range === 'day') {
      const start = new Date(from);
      start.setMinutes(0, 0, 0);
      start.setHours(Math.ceil(start.getHours() / 6) * 6);
      const fmt = new Intl.DateTimeFormat(locale, { hour: 'numeric' });
      for (let t = start.getTime(); t <= to; t = new Date(new Date(t).setHours(new Date(t).getHours() + 6)).getTime()) {
        if (t >= from) out.push({ at: t, line: true, label: fmt.format(t) });
      }
      return out;
    }
    const today = new Date(now).setHours(0, 0, 0, 0);
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    const first = new Date(from).setHours(0, 0, 0, 0);
    for (let d = new Date(first); d.getTime() <= to; d.setDate(d.getDate() + 1)) {
      const midnight = d.getTime();
      const noon = new Date(d).setHours(12);
      if (midnight >= from) out.push({ at: midnight, line: true, label: null });
      if (noon >= from && noon <= to) out.push({ at: noon, line: false, label: midnight === today ? 'Today' : fmt.format(noon) });
    }
    return out;
  }

  /**
   * Which marks get a name above them, and on which row. The next start of each
   * thing, every held task, and past runs that went wrong or wait for you are
   * worth naming; a label only goes where it doesn't cover another.
   */
  function placeLabels(marks, widthPx, charPx) {
    const seen = new Set();
    const ends = new Array(LEVELS).fill(-Infinity);
    const wanted = marks.filter(m => {
      if (m.tone === 'err' || m.tone === 'wait') return true;
      if (m.past) return false;
      const key = `${m.kind}:${m.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.at - b.at);
    for (const m of wanted) {
      const w = Math.min(100, ((m.name.length * charPx + LABEL_PAD_PX) / widthPx) * 100);
      // A streak's name starts where it does; a run's sits centred over it.
      const left = Math.max(0, Math.min(100 - w, m.streak ? m.pct : m.pct - w / 2));
      const gap = (LABEL_GAP_PX / widthPx) * 100;
      const level = ends.findIndex(end => end + gap <= left);
      if (level < 0) continue;
      ends[level] = left + w;
      m.label = { level, left, width: w };
    }
  }

  /**
   * @param {{ now: number, range?: 'week' | 'day', routines?: any[], workflows?: any[], held?: any[],
   *   resetAt?: number | null, widthPx?: number, charPx?: number, locale?: string }} input
   */
  function build({ now, range = 'week', routines = [], workflows = [], held = [], resetAt = null, widthPx = 400, charPx = 6.4, locale = undefined }) {
    const span = RANGES[range] || RANGES.week;
    const from = now - span.behind;
    const to = now + span.ahead;
    const pct = at => ((at - from) / (to - from)) * 100;
    const all = [
      ...(Array.isArray(routines) ? routines : []).filter(Boolean).flatMap(routineMarks),
      ...(Array.isArray(workflows) ? workflows : []).filter(Boolean).flatMap(workflowMarks),
      ...heldMarks(held),
    ];
    const marks = thinDense(all.filter(m => m.at >= from && m.at <= to)
      .map(m => ({ ...m, past: m.at <= now, pct: pct(m.at), label: null }))
      .sort((a, b) => a.at - b.at), to)
      .map(m => (m.streak ? { ...m, streak: { ...m.streak, endPct: pct(m.streak.end) } } : m));
    placeLabels(marks, Math.max(120, widthPx), charPx);
    const reset = num(resetAt);
    const band = reset !== null && reset > now && reset - WINDOW_MS < to
      ? { at: reset, left: pct(Math.max(from, reset - WINDOW_MS)), right: pct(Math.min(to, reset)) } : null;
    // workflowView's listening: what starts it besides the clock, in words, or null.
    const listening = (Array.isArray(workflows) ? workflows : []).filter(w => w && typeof w.listening === 'string' && w.enabled !== false)
      .map(w => ({ id: w.id, name: name(w.name), text: w.listening }));
    return {
      from, to, now, range: RANGES[range] ? range : 'week',
      nowPct: pct(now), band, marks, listening,
      ticks: ticks(from, to, now, range, locale).map(t => ({ ...t, pct: pct(t.at) })),
      empty: marks.length === 0 && listening.length === 0,
    };
  }

  const api = { build, everyText, RANGES, WINDOW_MS, LEVELS, RUN_TONE, DENSE_MIN, DENSE_GAP };
  root.ShellbyTideChart = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
