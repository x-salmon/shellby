// The Time tab's "how it was written" view (panel/time-day.js): where on the
// day's line each piece of evidence sits, and what a sentence points back to.
// Works on the day main's TimeTracker.dayView() returns. No DOM, so it runs in
// the browser and in Node (for tests).
(function (root) {
  const SLOT_MIN = 15;        // timetrack/index.js SLOT_MIN: time is kept by the quarter hour
  const DAY_MIN = 24 * 60;
  const MIN_SPAN = 8 * 60;    // the line shows at least a working day...
  const QUIET = [8 * 60, 18 * 60]; // ...8 to 6 when there's nothing to show
  const MIN_BAR = 0.6;        // percent: a short conversation still shows

  const minuteOf = at => { const d = new Date(at); return d.getHours() * 60 + d.getMinutes(); };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  /** Consecutive quarter hours -> [{ start, end }] in minutes of the day. */
  function runs(slots) {
    const out = [];
    for (const i of [...new Set(slots || [])].filter(Number.isInteger).sort((a, b) => a - b)) {
      const last = out[out.length - 1];
      if (last && last.end === i * SLOT_MIN) last.end += SLOT_MIN;
      else out.push({ start: i * SLOT_MIN, end: (i + 1) * SLOT_MIN });
    }
    return out;
  }

  /** The hours the line spans: whole hours around everything that happened, at least MIN_SPAN. */
  function span(view) {
    const marks = [];
    for (const l of view?.lines || []) {
      for (const r of runs(l.slots)) marks.push(r.start, r.end);
      for (const c of l.chats || []) marks.push(minuteOf(c.from), minuteOf(c.to));
      for (const c of l.commits || []) marks.push(minuteOf(c.at));
    }
    if (!marks.length) return { from: QUIET[0], to: QUIET[1] };
    let from = Math.floor(Math.min(...marks) / 60) * 60;
    let to = Math.min(DAY_MIN, Math.ceil((Math.max(...marks) + 1) / 60) * 60);
    while (to - from < MIN_SPAN) {
      if (to < DAY_MIN) to += 60; else from -= 60;
    }
    return { from: Math.max(0, from), to };
  }

  /** '9 am', '12 pm', '7 pm' */
  const hourLabel = min => { const h = Math.floor(min / 60) % 24; return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`; };

  /**
   * Everything the line draws, as percents of its width:
   * { hours: [{ label, at }], kept: [{ key, left, width }], chats: [{ id, key, title, left, width }], commits: [{ id, key, subject, left }] }
   */
  function lanes(view) {
    const w = span(view);
    const pct = min => clamp(((min - w.from) / (w.to - w.from)) * 100, 0, 100);
    const hours = [];
    for (let m = w.from; m <= w.to; m += 60) hours.push({ label: hourLabel(m), at: pct(m) });
    const kept = [];
    const chats = [];
    const commits = [];
    for (const l of view?.lines || []) {
      for (const r of runs(l.slots)) kept.push({ key: l.key, left: pct(r.start), width: pct(r.end) - pct(r.start) });
      for (const c of l.chats || []) {
        const left = pct(minuteOf(c.from));
        chats.push({ id: c.id, key: l.key, title: c.title, left, width: Math.max(MIN_BAR, pct(Math.max(minuteOf(c.to), minuteOf(c.from))) - left) });
      }
      for (const c of l.commits || []) commits.push({ id: c.id, key: l.key, subject: c.subject, left: pct(minuteOf(c.at)) });
    }
    return { span: w, hours, kept, chats, commits };
  }

  /**
   * What a sentence's source ids point at, in the order it gave them:
   * [{ kind: 'commit', id, at, subject } | { kind: 'chat', id, title, from, to, asks }]. Ids it can't find are dropped.
   */
  function sourcesOf(view, ids) {
    const all = new Map();
    for (const l of view?.lines || []) {
      for (const c of l.commits || []) all.set(c.id, { kind: 'commit', ...c });
      for (const c of l.chats || []) all.set(c.id, { kind: 'chat', ...c });
    }
    return [...new Set(ids || [])].map(id => all.get(id)).filter(Boolean);
  }

  /** Whether a line shows Shellby's draft: there is one, and no words of yours stand in its place. */
  const showsDraft = l => !!l?.draft?.sentences?.length && (!l.note || !!l.draft.kept);

  /** The sentence picked by default: the first one of the first line showing a draft, as 'key|index', or null. */
  function firstSentence(view) {
    const l = (view?.lines || []).find(showsDraft);
    return l ? `${l.key}|0` : null;
  }

  const api = { runs, span, hourLabel, lanes, sourcesOf, showsDraft, firstSentence, minuteOf, SLOT_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbyTimeDayline = api;
})(typeof window !== 'undefined' ? window : globalThis);
