/* Shellby panel — the tide chart at the top of Automate: every routine,
   workflow and task waiting for the reset on one line through the week.
   What goes where is worked out in shared/tide-chart.js; this draws it into
   each [data-tide] (one on Workflows, one on Routines) and opens what you press. */
'use strict';
(function () {
  const { h, api, state } = SB;
  const T = window.ShellbyTideChart;
  const SVG = 'http://www.w3.org/2000/svg';
  const WAVE_W = 1000;
  const WAVE_H = 40;
  const CHAR_PX = 6.6;  // an average label character at the chart's 11px
  const FALLBACK_W = 420;

  const TONE_WORDS = Object.freeze({
    ok: 'ran', done: 'ran', err: 'failed', wait: 'is waiting for you', run: 'is running', off: 'was stopped',
    plan: 'runs', held: 'runs after your usage resets',
  });

  const REDRAW_MS = 60000;

  let range = 'week';
  let askedForWorkflows = false;
  /** @type {any} */
  let chart = null;

  // ------------------------------------------------------------ drawing

  /** The tide: a gentle wave, filled behind now and dashed ahead of it. */
  function wave(nowPct) {
    const nowX = Math.max(0, Math.min(WAVE_W, (nowPct / 100) * WAVE_W));
    const y = x => (WAVE_H / 2 + Math.sin(x / 38) * 6 + Math.sin(x / 13) * 1.5).toFixed(1);
    const line = (a, b) => {
      let d = '';
      for (let x = a; x <= b; x += 10) d += `${d ? ' L' : 'M'}${x.toFixed(1)} ${y(x)}`;
      return `${d} L${b.toFixed(1)} ${y(b)}`;
    };
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'tide-wave');
    svg.setAttribute('viewBox', `0 0 ${WAVE_W} ${WAVE_H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    const path = (d, cls) => {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', cls);
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(p);
    };
    if (nowX > 0) path(`${line(0, nowX)} L${nowX.toFixed(1)} ${WAVE_H} L0 ${WAVE_H} Z`, 'tide-past');
    if (nowX < WAVE_W) path(line(nowX, WAVE_W), 'tide-ahead');
    return svg;
  }

  function whenText(m) {
    const exact = new Date(m.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return m.past ? `${exact}, ${SB.relTime(m.at)}` : exact;
  }

  function markEls(m, i) {
    const label = m.streak ? `${m.name}, from ${whenText(m)}`
      : `${m.name} ${TONE_WORDS[m.tone] || 'runs'} ${m.past ? '' : 'at '}${whenText(m)}`.replace(/\s+/g, ' ');
    const els = [];
    // Something that runs every few minutes: one dotted run of the tide from its next start on.
    if (m.streak) els.push(h('span', { class: 'tide-streak', 'aria-hidden': 'true', 'data-mk': String(i), title: label, style: `left:${m.pct}%;width:${Math.max(0, m.streak.endPct - m.pct)}%` }));
    els.push(h('button', {
      type: 'button', class: `tide-mk ${m.tone}${m.past ? ' past' : ''}`, style: `left:${m.pct}%`,
      'data-mk': String(i), title: label, 'aria-label': label,
      // Tab stops only for the named marks (each thing's next start, and runs that need a look),
      // so a busy week isn't a hundred stops; every mark still answers a click.
      tabindex: m.label ? null : '-1',
    }));
    if (m.label) {
      els.push(h('span', { class: 'tide-stem', 'aria-hidden': 'true', style: `left:${m.pct}%;height:calc(var(--tide-row) * ${m.label.level} + var(--tide-stem))` }));
      els.push(h('span', {
        class: `tide-lbl ${m.tone}`, 'aria-hidden': 'true', 'data-mk': String(i), title: label,
        style: `left:${m.label.left}%;max-width:${m.label.width}%;bottom:calc(var(--tide-lbl-y) + var(--tide-row) * ${m.label.level})`,
      }, m.name));
    }
    return els;
  }

  function track(c) {
    const kids = [wave(c.nowPct)];
    for (const t of c.ticks) {
      if (t.line) kids.push(h('span', { class: 'tide-day', style: `left:${t.pct}%`, 'aria-hidden': 'true' }));
      if (t.label) kids.push(h('span', { class: 'tide-tick', style: `left:${t.pct}%`, text: t.label, 'aria-hidden': 'true' }));
    }
    // On the top row, kept apart: "now" reads leftwards from its line, the reset rightwards from the window's end.
    if (c.band) {
      kids.push(h('span', { class: 'tide-band', style: `left:${c.band.left}%;width:${Math.max(0.4, c.band.right - c.band.left)}%`, 'aria-hidden': 'true' }));
      kids.push(h('span', { class: 'tide-reset', style: `left:${c.band.right}%`, 'aria-hidden': 'true',
        text: `resets ${state.outlook?.resetText || new Date(c.band.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }));
    }
    kids.push(h('span', { class: 'tide-now', style: `left:${c.nowPct}%`, 'aria-hidden': 'true' }, h('span', { text: 'now' })));
    c.marks.forEach((m, i) => kids.push(...markEls(m, i)));
    return h('div', { class: 'tide-track', role: 'group', 'aria-label': c.range === 'day' ? 'Runs over the next day' : 'Runs over the week' }, kids);
  }

  function listening(c) {
    if (!c.listening.length) return null;
    return h('div', { class: 'tide-listen' },
      h('span', { class: 'tide-listen-name', text: 'Listening' }),
      c.listening.map(l => h('button', {
        type: 'button', class: 'tide-ear', 'aria-label': `${l.name}: ${l.text}. Show its runs`,
        onclick: () => openWorkflow(l.id),
      }, h('b', { text: l.name }), l.text ? h('span', { text: l.text }) : null)));
  }

  function head() {
    const pick = r => h('button', { type: 'button', 'aria-pressed': String(range === r), onclick: () => { range = r; SB.renderTide(); } }, r === 'day' ? 'Next day' : 'Week');
    return h('div', { class: 'tide-head' },
      h('h3', { class: 'tide-title', text: range === 'day' ? 'The next day' : 'This week' }),
      h('div', { class: 'seg tide-range', role: 'group', 'aria-label': 'How far ahead' }, pick('day'), pick('week')));
  }

  function draw(box) {
    const width = box.clientWidth || box.closest('.view')?.clientWidth || FALLBACK_W;
    chart = T.build({
      now: Date.now(), range,
      routines: state.routines || [],
      workflows: state.workflows?.workflows || [],
      held: state.outlook?.held || [],
      resetAt: state.outlook?.resetAt || null,
      widthPx: width, charPx: CHAR_PX,
    });
    // On Workflows it belongs to the list, not the editor or a run.
    const elsewhere = !!box.closest('#workflowsView') && SB.wfKit?.current?.().name !== 'list';
    box.hidden = chart.empty || elsewhere;
    if (box.hidden) { box.replaceChildren(); return; }
    box.replaceChildren(head(), track(chart), listening(chart));
  }

  // ------------------------------------------------------------ opening things

  function openWorkflow(id, runId = null) {
    const wf = SB.views.workflows;
    if (runId && wf?.openRun) return wf.openRun(runId);
    if (wf?.openRuns) wf.openRuns(id);
  }

  function openRoutine(id) {
    SB.setView('routines');
    requestAnimationFrame(() => {
      const row = /** @type {HTMLElement | null} */ (document.querySelector(`#routineList [data-routine-id="${CSS.escape(id)}"]`));
      if (!row) return;
      row.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      /** @type {HTMLElement | null} */ (row.querySelector('.ar-title'))?.focus({ preventScroll: true });
      row.classList.remove('tide-found');
      void row.offsetWidth; // start the highlight again if it's still showing
      row.classList.add('tide-found');
    });
  }

  function open(m) {
    if (m.kind === 'workflow') return openWorkflow(m.id, m.runId);
    if (m.kind === 'routine') return openRoutine(m.id);
    if (m.routineId) return openRoutine(m.routineId);
    SB.setView('routines#resetQueue');
  }

  document.addEventListener('click', e => {
    const hit = /** @type {HTMLElement} */ (e.target).closest?.('[data-tide] [data-mk]');
    const m = hit && chart?.marks[Number(hit.getAttribute('data-mk'))];
    if (m) open(m);
  });

  // ------------------------------------------------------------ when to draw

  const boxes = () => /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-tide]'));

  SB.renderTide = () => {
    if (!T) return;
    // Workflows arrive when their page first opens; the chart on Routines wants them too.
    // Asked for once: if that fails, main's next push brings them (applyView redraws).
    if (!state.workflows && !askedForWorkflows) {
      askedForWorkflows = true;
      api.listWorkflows().then(v => { if (v && !state.workflows) SB.applyWorkflows?.(v); })
        .catch(e => console.warn('[shellby] tide chart: no workflows yet', e));
    }
    // A chart is extra: whatever it trips on must never stop the page under it drawing.
    boxes().forEach(box => {
      try { draw(box); } catch (e) {
        console.warn('[shellby] tide chart failed', e);
        box.hidden = true;
      }
    });
  };

  // "now" walks along while the page is open, even when nothing else changes.
  setInterval(() => {
    if ((state.view === 'routines' || state.view === 'workflows') && !document.hidden) SB.renderTide();
  }, REDRAW_MS);

  // Labels are placed for the chart's width, so a wider panel redraws them.
  let lastWidth = 0;
  const ro = new ResizeObserver(entries => {
    const w = Math.round(entries[0]?.contentRect.width || 0);
    if (w && Math.abs(w - lastWidth) > 24) { lastWidth = w; SB.renderTide(); }
  });
  boxes().forEach(b => ro.observe(b));
})();
