// The Time tab's month calendar (panel/time.js): which days a month shows,
// how full each one was, and what a picked day holds. Works on the summary
// main's timetrack.summarize() returns for the month. No DOM, so it runs in
// the browser and in Node (for tests).
(function (root) {
  const H = 3600;
  const COLOURS = 5;
  const NUDGE = 15;    // minutes a + or − moves a day line   // the busiest projects get a colour each; the rest share a quiet one

  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = day => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d || 1); };

  /** "2026-11-13" -> "2026-11". */
  const monthOf = day => day.slice(0, 7);

  /** "2026-11" moved by n months: shiftMonth("2026-12", 1) is "2027-01". */
  const shiftMonth = (month, n) => { const d = dateOf(month); return dayKey(new Date(d.getFullYear(), d.getMonth() + n, 1)).slice(0, 7); };

  /** The month's first and last day, as the custom range main takes. */
  const monthRange = month => {
    const d = dateOf(month);
    return { from: dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), to: dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  };

  /** "November 2026". */
  const monthLabel = month => dateOf(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  /**
   * The month as weeks of seven days, Monday first, with the days from the
   * months around it filling the first and last week.
   *   [[{ day, date, inMonth, today, future }]]
   */
  function weeks(month, today) {
    const { from, to } = monthRange(month);
    const first = dateOf(from);
    const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - ((first.getDay() + 6) % 7));
    const out = [];
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
        const day = dayKey(d);
        week.push({ day, date: d.getDate(), inMonth: day >= from && day <= to, today: day === today, future: day > today });
      }
      // Six rows would leave an empty one at the end of a short month.
      if (w && week[0].day > to) break;
      out.push(week);
    }
    return out;
  }

  /** How full a day was, 0 (nothing) to 4 (a long day), for its shade. */
  const level = seconds => (seconds <= 0 ? 0 : seconds < 2 * H ? 1 : seconds < 4 * H ? 2 : seconds < 6 * H ? 3 : 4);

  /**
   * Each day's total across the projects, its projects biggest first, and the
   * guess from commits when there's no time but there are commits.
   *   Map(day -> { seconds, mix: [{ key, seconds }], guess, filled, notes })
   */
  function byDay(summary) {
    const out = new Map();
    for (const p of summary?.projects || []) {
      for (const r of p.days || []) {
        const d = out.get(r.day) || { seconds: 0, mix: [], guess: 0, filled: false, notes: 0 };
        d.seconds += r.total;
        if (r.total) d.mix.push({ key: p.key, seconds: r.total });
        if (!r.total && r.estimate) d.guess += r.estimate;
        if (r.estimated) d.filled = true;
        if (r.note) d.notes++;
        out.set(r.day, d);
      }
    }
    for (const d of out.values()) d.mix.sort((a, b) => b.seconds - a.seconds);
    return out;
  }

  /** What each project has on one day, biggest first: the lines of that day's timesheet. */
  const lines = (summary, day) => (summary?.projects || [])
    .map(p => {
      const r = (p.days || []).find(x => x.day === day);
      return r ? { key: p.key, name: p.name, client: p.client, rate: p.rate, billable: p.billable, ...r } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  /** The month's headline numbers: all of it, and a usual day out of the days with any time. */
  function stats(summary) {
    const days = [...byDay(summary).values()].filter(d => d.seconds > 0);
    const seconds = summary?.totals?.seconds || 0;
    return {
      seconds, billed: summary?.totals?.billed || 0, amount: summary?.totals?.amount || 0,
      daysWorked: days.length, perDay: days.length ? Math.round(seconds / days.length) : 0,
    };
  }

  /**
   * The day to open: the one you picked if it's in this month and not ahead
   * of today, else today if it's in the month, else the month's last day with
   * time, else its last day (or today, if that's sooner).
   */
  function pickDay(month, today, picked, summary) {
    const { from, to } = monthRange(month);
    const inMonth = d => !!d && d >= from && d <= to && d <= today;
    if (inMonth(picked)) return picked;
    if (inMonth(today)) return today;
    const worked = [...byDay(summary).entries()].filter(([d, v]) => v.seconds > 0 && inMonth(d)).map(([d]) => d).sort();
    if (worked.length) return worked[worked.length - 1];
    return to < today ? to : from;
  }

  /** Project key -> colour index (0..4) for the busiest projects of the month. */
  const colours = summary => new Map([...(summary?.projects || [])]
    .filter(p => p.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
    .slice(0, COLOURS)
    .map((p, i) => [p.key, i]));

  /**
   * Minutes for a day line's + (dir 1) or − (dir -1): 15, but − never takes off
   * more than the day has (a leftover minus would eat time tracked later), and
   * + on a day filled from commits keeps that guess as well, rather than
   * replacing it with 15 minutes.
   */
  const nudge = (l, dir) => (dir < 0
    ? -Math.min(NUDGE, Math.round((l.total || 0) / 60))
    : (l.estimated ? Math.round((l.estimate || 0) / 60) : 0) + NUDGE);

  /** Seconds as a timesheet's "8:20". */
  const clock = s => { const m = Math.round(Math.max(0, s || 0) / 60); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };

  const api = { monthOf, shiftMonth, monthRange, monthLabel, weeks, level, byDay, lines, stats, pickDay, colours, nudge, clock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbyTimeCalendar = api;
})(typeof window !== 'undefined' ? window : globalThis);
