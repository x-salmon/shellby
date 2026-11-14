/* Shellby panel — Time's "how it was written" view (time.js): one day as a
   line of when its time was kept, what you asked Claude and when you
   committed, beside what Shellby wrote. Picking a sentence lights up what it
   came from. shared/time-dayline.js works out where everything goes; this
   only draws it and hands actions back to time.js. */
'use strict';
(function () {
  const { h } = SB;
  const F = window.ShellbyTimeFormat;
  const C = window.ShellbyTimeCalendar;
  const L = window.ShellbyTimeDayline;

  /** @type {string | null} 'key|index': the sentence whose sources are lit, kept across redraws */
  let picked = null;
  /** @type {string | null} */
  let shownDay = null;

  const timeOf = at => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const colourOf = (colours, key) => SB.timeMonth.tint(colours, key);

  // ------------------------------------------------------------------ the day's line

  function lane(label, mark, children) {
    return h('div', { class: 'td-lane-row' },
      h('span', { class: 'td-lane-label' }, h('i', { class: `td-src ${mark}`, 'aria-hidden': 'true' }, mark === 'kept' ? '' : mark === 'chat' ? 'C' : 'G'), label),
      h('div', { class: 'td-lane' }, ...children));
  }

  function drawLine(view, lit, colours) {
    const ln = L.lanes(view);
    const names = new Map(view.lines.map(l => [l.key, l.name]));
    return h('section', { class: 'td-line', 'aria-label': 'The day, hour by hour' },
      h('div', { class: 'td-hours', 'aria-hidden': 'true' }, ...ln.hours.map((x, i) => h('span', { class: i === ln.hours.length - 1 ? 'end' : i === 0 ? 'start' : '', style: `left:${x.at}%`, text: x.label }))),
      lane('Time kept', 'kept', ln.kept.map(k => h('span', { class: `td-kept ${colourOf(colours, k.key)}`, style: `left:${k.left}%;width:${k.width}%`, title: names.get(k.key) || '' }))),
      lane('Claude', 'chat', ln.chats.map(c => h('span', {
        class: `td-chat${lit.has(c.id) ? ' lit' : ''}`, style: `left:${c.left}%;width:${c.width}%`, title: `${names.get(c.key) || ''}: ${c.title}`,
      }, h('span', { text: c.title })))),
      lane('Commits', 'commit', ln.commits.map(c => h('span', { class: `td-tick${lit.has(c.id) ? ' lit' : ''}`, style: `left:${c.left}%`, title: c.subject }))));
  }

  // ------------------------------------------------------------------ what was written

  function story(view, colours, act) {
    const total = view.lines.reduce((n, l) => n + l.total, 0);
    const pick = id => { picked = id; act.redraw(); };
    const lines = view.lines.map(l => {
      let body;
      if (L.showsDraft(l)) {
        body = h('p', { class: 'td-says' }, ...l.draft.sentences.flatMap((s, i) => [i ? ' ' : '', h('button', {
          type: 'button', class: `td-sentence${picked === `${l.key}|${i}` ? ' on' : ''}`, 'aria-pressed': String(picked === `${l.key}|${i}`),
          dataset: { focus: `sentence:${l.key}|${i}` }, text: s.text, onclick: () => pick(`${l.key}|${i}`),
        })]));
      } else if (l.note) {
        body = h('p', { class: 'td-says' }, l.note, h('span', { class: 'td-yours', text: ' (yours)' }));
      } else {
        body = h('p', { class: 'td-says muted', text: 'Not written up yet.' });
      }
      const state = l.note && !l.draft?.kept ? null : l.draft?.kept ? h('span', { class: 'td-tag kept', text: 'Kept' }) : l.draft ? h('span', { class: 'td-tag draft', text: 'Draft' }) : null;
      return h('li', { class: 'td-proj' },
        h('div', { class: 'td-proj-head' },
          h('span', { class: `tm-sw ${colourOf(colours, l.key)}`, 'aria-hidden': 'true' }),
          h('b', { text: l.name }),
          h('small', { text: [C.clock(l.total), l.client].filter(Boolean).join(' · ') }),
          state,
          l.draft && !l.note ? h('button', { type: 'button', class: 'btn primary slim-btn td-keep', text: 'Keep', 'aria-label': `Keep the draft for ${l.name}`, dataset: { focus: `td-keep:${l.key}` }, onclick: () => act.keep(l.key) }) : null),
        body);
    });
    const open = view.lines.filter(l => !l.note && l.draft).length;
    const by = view.lines.find(l => l.draft)?.draft.by;
    return h('article', { class: 'td-story' },
      h('div', { class: 'td-story-head' }, h('h4', { text: 'What you did' }), h('b', { text: total ? C.clock(total) : '' })),
      h('ul', { class: 'td-projs' }, ...lines),
      h('div', { class: 'td-story-foot' },
        open > 1 ? h('button', { type: 'button', class: 'btn primary slim-btn', text: `Keep all ${open}`, dataset: { focus: 'td-keep-all' }, onclick: () => act.keep(null) }) : null,
        view.lines.some(l => !l.note) ? writeAgain(act) : null,
        by ? h('span', { class: 'td-by' }, h('span', { class: 'td-dot', 'aria-hidden': 'true' }), `Written by ${SB.timeMonth.byWho(by)}`) : null));
  }

  // Write the open lines again; the button comes back however that ends.
  function writeAgain(act) {
    const b = h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Write it again', dataset: { focus: 'td-write' } });
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = 'Writing…';
      try { await act.write(); } finally { b.disabled = false; b.textContent = 'Write it again'; }
    });
    return b;
  }

  // ------------------------------------------------------------------ behind the picked sentence

  function behind(view) {
    const [key, index] = (picked || '').split('|');
    const l = view.lines.find(x => x.key === key);
    const s = l?.draft?.sentences?.[Number(index)];
    if (!s) return h('section', { class: 'td-behind' }, h('h4', { text: 'Behind each sentence' }), h('p', { class: 'muted small', text: 'Pick a sentence Shellby wrote to see the commits and conversations it came from.' }));
    const sources = L.sourcesOf(view, s.src);
    return h('section', { class: 'td-behind', 'aria-live': 'polite' },
      h('h4', { text: 'Behind this sentence' }),
      h('p', { class: 'td-claim', text: 'What Shellby says it wrote this from. Check it reads right before you keep it.' }),
      h('blockquote', { text: s.text }),
      sources.length ? h('ul', { class: 'td-evidence' }, ...sources.map(x => (x.kind === 'chat'
        ? h('li', {}, h('i', { class: 'td-src chat', 'aria-hidden': 'true' }, 'C'),
          h('div', {}, h('b', { text: `“${x.title || 'A conversation'}”` }), h('span', { text: `You asked: “${x.asks[0].text}”` })),
          h('time', { text: x.to - x.from > 60000 ? `${timeOf(x.from)}–${timeOf(x.to)}` : timeOf(x.from) }))
        : h('li', {}, h('i', { class: 'td-src commit', 'aria-hidden': 'true' }, 'G'),
          h('div', {}, h('code', { text: x.subject }), h('span', { text: l.name })),
          h('time', { text: timeOf(x.at) })))))
        : h('p', { class: 'muted small', text: 'Shellby didn’t say what this came from, so check it before you keep it.' }));
  }

  function reads() {
    return h('section', { class: 'td-reads' },
      h('h4', { text: 'What Shellby reads to write it' }),
      h('ul', {},
        h('li', {}, h('b', { text: 'Your commit messages' }), ' for the day, in each project.'),
        h('li', {}, h('b', { text: 'What you asked Claude' }), ' in Shellby that day: each conversation’s title and your messages. Routines are left out.'),
        h('li', {}, h('b', { text: 'Your hours' }), ' on each project.')),
      h('p', { class: 'muted small', text: 'Never your code, your files or your window titles. With a local model set up (Settings, Claude) it’s written on this PC when that model answers; otherwise, or if it can’t, it’s one short Claude call. Each client’s projects are written up on their own.' }));
  }

  /**
   * view: main's dayView(); act: { back, keep(key|null), write(), redraw() }
   * summary: the month's (for each project's colour).
   */
  function draw(el, view, { summary, act }) {
    if (view.day !== shownDay) { shownDay = view.day; picked = null; }
    const was = picked;
    if (!was || !view.lines.some(l => was.startsWith(l.key + '|') && L.showsDraft(l))) picked = L.firstSentence(view);
    const colours = C.colours(summary);
    const [key, index] = (picked || '').split('|');
    const lit = new Set(view.lines.find(l => l.key === key)?.draft?.sentences?.[Number(index)]?.src || []);
    const total = view.lines.reduce((n, l) => n + l.total, 0);
    el.replaceChildren(
      h('div', { class: 'td-head' },
        h('button', { type: 'button', class: 'btn ghost slim-btn', text: '‹ Back to the month', dataset: { focus: 'td-back' }, onclick: act.back }),
        h('h3', { text: SB.timeMonth.longDay(view.day) }),
        h('b', { class: 'tm-dv-total', text: total ? F.dur(total) : '' })),
      view.lines.length ? drawLine(view, lit, colours) : h('p', { class: 'muted', text: 'Nothing kept on this day.' }),
      h('div', { class: 'td-lower' },
        story(view, colours, act),
        h('div', { class: 'td-side' }, behind(view), reads())));
  }

  SB.timeDay = { draw };
})();
