/* Shellby panel — Time's month (time.js): the month's numbers, its calendar
   and the picked day's timesheet lines. shared/time-calendar.js decides what
   goes where; this only draws it and hands edits back to time.js. */
'use strict';
(function () {
  const { h } = SB;
  const F = window.ShellbyTimeFormat;
  const C = window.ShellbyTimeCalendar;
  const { dur } = F;
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const ADD_MINUTES = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480];

  const longDay = day => F.dateOf(day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  // A project's mark: one of five colours for the month's busiest, else a quiet one. Always beside its name.
  const tint = (colours, key) => (colours.has(key) ? `tm-c${colours.get(key)}` : 'tm-cx');

  // ------------------------------------------------------------------ the numbers

  function drawStats(el, summary, currency) {
    const s = C.stats(summary);
    const stat = (value, label) => h('div', { class: 'tm-stat' }, h('dt', { text: label }), h('dd', { text: value }));
    el.replaceChildren(
      stat(dur(s.seconds), 'this month'),
      s.billed ? stat(s.amount ? F.money(s.amount, currency) : `${F.decimal(s.billed)} h`, s.amount ? `billable, ${F.decimal(s.billed)} h` : 'billable') : null,
      s.daysWorked ? stat(dur(s.perDay), `a day, over ${F.plural(s.daysWorked, 'day')} with time`) : null);
  }

  // ------------------------------------------------------------------ the calendar

  function dayCell(cell, d, { picked, colours, onPick }) {
    if (!cell.inMonth) return h('span', { class: 'tm-day out', 'aria-hidden': 'true' }, h('span', { class: 'tm-d-n', text: String(cell.date) }));
    const seconds = d?.seconds || 0;
    const guess = !seconds && d?.guess ? d.guess : 0;
    const words = `${longDay(cell.day)}: ${seconds ? dur(seconds) : cell.future ? 'still to come' : 'nothing kept'}${guess ? `, about ${dur(guess)} going by commits` : ''}`;
    const cls = ['tm-day', `lv${C.level(seconds)}`, cell.today ? 'today' : '', cell.future ? 'future' : '', cell.day === picked ? 'picked' : '', d?.filled ? 'filled' : ''].filter(Boolean).join(' ');
    return h('button', {
      type: 'button', class: cls, 'aria-label': words, title: words, 'aria-pressed': String(cell.day === picked),
      tabindex: cell.day === picked ? '0' : '-1', disabled: cell.future, dataset: { day: cell.day }, onclick: () => onPick(cell.day),
    },
    h('span', { class: 'tm-d-n', text: String(cell.date) }),
    guess ? h('span', { class: 'tm-d-guess', 'aria-hidden': 'true' }) : null,
    h('span', { class: 'tm-d-t', text: seconds ? C.clock(seconds) : '' }),
    seconds ? h('span', { class: 'tm-d-mix', 'aria-hidden': 'true' }, ...d.mix.map(m => h('i', { class: tint(colours, m.key), style: `flex:${m.seconds}` }))) : null);
  }

  function drawCalendar(el, { month, today, picked, summary, onPick }) {
    const days = C.byDay(summary);
    const colours = C.colours(summary);
    const cells = [...WEEKDAYS, 'Week'].map(d => h('span', { class: `tm-dow${d === 'Week' ? ' tm-wk' : ''}`, 'aria-hidden': 'true', text: d }));
    for (const week of C.weeks(month, today)) {
      let total = 0;
      for (const cell of week) {
        const d = days.get(cell.day);
        if (cell.inMonth) total += d?.seconds || 0;
        cells.push(dayCell(cell, d, { picked, colours, onPick }));
      }
      cells.push(h('span', { class: 'tm-wk', 'aria-hidden': 'true' }, total ? C.clock(total) : ''));
    }
    el.replaceChildren(...cells);
  }

  // Arrow keys walk the days: a day either way, a week up or down, never past today or out of the month.
  function onCalendarKey(e, { month, today, picked, onPick }) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step || !picked) return;
    const d = F.dateOf(picked);
    const next = F.dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + step));
    const { from, to } = C.monthRange(month);
    e.preventDefault();
    if (next < from || next > to || next > today) return;
    onPick(next, { focus: true });
  }

  // ------------------------------------------------------------------ the picked day

  function line(l, { colours, act }) {
    const note = h('input', {
      class: 'field tm-note', value: l.note, maxlength: '200',
      placeholder: l.commits.length ? l.commits.map(c => c.subject).slice(0, 3).join('; ') : 'What it was for',
      'aria-label': `What the time on ${l.name} was for`,
    });
    note.addEventListener('change', () => act.note(l.key, note.value.trim()));
    const guess = !l.tracked && !l.manual && l.estimate ? l.estimate : 0;
    const parts = F.dayParts(l);
    return h('li', { class: `tm-line${l.estimated ? ' est' : ''}` },
      h('div', { class: 'tm-line-head' },
        h('span', { class: `tm-sw ${tint(colours, l.key)}`, 'aria-hidden': 'true' }),
        h('b', { class: 'tm-line-name', text: l.name }),
        l.client ? h('small', { class: 'tm-line-client', text: l.client }) : null,
        h('span', { class: 'tm-nudge' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Take 15 minutes off ${l.name}`, title: 'Take 15 minutes off', disabled: !l.total || l.estimated, dataset: { focus: `less:${l.key}` }, onclick: () => act.nudge(l.key, C.nudge(l, -1)) }, '−'),
          h('span', { class: 'tm-line-time', text: l.total ? C.clock(l.total) : '0:00' }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Add 15 minutes to ${l.name}`, title: 'Add 15 minutes', dataset: { focus: `more:${l.key}` }, onclick: () => act.nudge(l.key, C.nudge(l, 1)) }, '+'))),
      note,
      h('div', { class: 'tm-line-meta' },
        parts.length ? h('span', { text: parts.join(' · ') }) : null,
        l.commitCount ? h('span', { class: 'tm-commits', role: 'note', title: F.commitsTip(l), tabindex: '0', 'aria-label': `${F.plural(l.commitCount, 'commit')}: ${l.commits.map(c => c.subject).join('; ')}` }, F.plural(l.commitCount, 'commit')) : null,
        guess ? h('button', { type: 'button', class: 'btn slim-btn tm-keep', dataset: { focus: `keep:${l.key}` }, onclick: () => act.nudge(l.key, Math.max(1, Math.round(guess / 60))) }, `Keep ${dur(guess)}`) : null));
  }

  function adder({ projects, act }) {
    const project = h('select', { class: 'field slim', 'aria-label': 'Which project' },
      ...(projects.length ? projects.map(p => h('option', { value: p.key, text: p.name })) : [h('option', { value: '', text: 'No projects yet' })]));
    const minutes = h('select', { class: 'field slim', 'aria-label': 'How long' }, ...ADD_MINUTES.map(m => h('option', { value: String(m), text: dur(m * 60), selected: m === 30 })));
    const note = h('input', { class: 'field slim tm-add-note', maxlength: '200', placeholder: 'A call, a meeting… (optional)', 'aria-label': 'What it was for' });
    const err = h('p', { class: 'form-errors', role: 'alert', hidden: true });
    const form = h('form', { class: 'tm-adder', novalidate: true },
      h('span', { class: 'tm-adder-title', text: 'Add time' }), project, minutes, note,
      h('button', { type: 'submit', class: 'btn primary slim-btn', text: 'Add', disabled: !projects.length }), err);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const problem = await act.add(project.value, Number(minutes.value), note.value.trim());
      err.hidden = !problem;
      err.textContent = problem || '';
    });
    return form;
  }

  function drawDay(el, { day, summary, projects, act }) {
    const colours = C.colours(summary);
    const lines = C.lines(summary, day);
    const total = lines.reduce((n, l) => n + l.total, 0);
    el.replaceChildren(
      h('div', { class: 'tm-dv-head' },
        h('h3', { text: longDay(day) }),
        h('b', { class: 'tm-dv-total', text: total ? C.clock(total) : '' })),
      h('p', { class: 'tm-dv-sub', text: lines.length ? 'What each timesheet says for this day. Changes save as you go.' : 'Nothing kept on this day. Add time below if you worked.' }),
      lines.length ? h('ul', { class: 'tm-lines' }, ...lines.map(l => line(l, { colours, act }))) : null,
      adder({ projects, act }));
  }

  SB.timeMonth = { drawStats, drawCalendar, drawDay, onCalendarKey, tint };
})();
