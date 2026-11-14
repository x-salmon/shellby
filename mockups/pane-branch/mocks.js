// Draws every option from the same three branches, at the slider's width.
// Branch names come out of src/main/worktrees/index.js as shellby/<slug>-<6 hex>.
(() => {
  const BRANCHES = [
    { branch: 'shellby/feat-notifications-bell-47f58c', base: 'main', title: 'Notification bell', check: 'pass', ahead: 3, focused: true, feed: 'Wired the bell to the hook events…' },
    { branch: 'shellby/fix-login-redirect-a1b2c3', base: 'main', title: 'Login loops back', check: 'fail', ahead: 1, feed: 'The redirect test still fails on…' },
    { branch: 'shellby/refactor-split-pane-drag-handles-9e01d2', base: 'main', title: 'Pane drag handles', check: 'running', ahead: 0, feed: 'Running npm test…' },
  ];
  const KINDS = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore', 'ci'];
  const COLOURED = new Set(['feat', 'fix', 'perf', 'refactor']);
  const MARK = { pass: '✓', fail: '✗', running: '…' };
  const SAY = { pass: 'Its last checks passed', fail: 'Its last checks failed', running: 'Its checks are running' };

  /** shellby/feat-notifications-bell-47f58c -> { kind: 'feat', words: 'notifications bell', slug: 'feat-notifications-bell' } */
  function parse(full) {
    const slug = full.replace(/^shellby\//, '').replace(/-[0-9a-f]{6}$/, '');
    const [first, ...rest] = slug.split('-');
    const isKind = KINDS.includes(first);
    return {
      slug,
      kind: isKind ? first : '',
      colour: isKind && COLOURED.has(first) ? first : 'other',
      words: (isKind ? rest : [first, ...rest]).join(' '),
    };
  }

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...kids.flat().filter(Boolean));
    return el;
  }
  const svg = markup => { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; };
  const GLYPH = '<svg class="glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5v11M4.5 10.5c0-3 7-2.5 7-6.5M11.5 2.5v1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="4.5" cy="12.6" r="1.5" fill="currentColor"/><circle cx="11.5" cy="3.2" r="1.5" fill="currentColor"/></svg>';
  const glyph = () => svg(GLYPH);
  const mark = b => h('span', { class: `mark ${b.check}`, 'aria-hidden': 'true', text: MARK[b.check] });
  const plus = () => h('button', { class: 'pane-btn', type: 'button', 'aria-label': 'New conversation in this pane' },
    svg('<svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'));
  const zoom = () => h('button', { class: 'pane-btn', type: 'button', 'aria-label': 'Zoom this pane' },
    svg('<svg viewBox="0 0 16 16"><path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'));
  const tab = b => h('div', { class: 'tabs' }, h('div', { class: 'tab' }, h('span', { class: 'tab-title', text: b.title }), h('span', { class: 'tab-x', 'aria-hidden': 'true', text: '×' })));
  const title = (b, p) => [`Its own copy, on ${b.branch} (from ${b.base})`, SAY[b.check]].join('\n');

  function pane(head, b) {
    return h('div', { class: `pane${b.focused ? ' focused' : ''}` }, head, h('div', { class: 'feed', text: b.feed }));
  }

  // ------------------------------------------------------------ the options
  const OPTIONS = [
    {
      id: 'today', name: 'Today',
      say: ['The branch as git has it, minus <code>shellby/</code>. In a two-pane panel there is room for about eleven letters, so every branch reads <code>feat-notific…</code> or <code>refactor-spl…</code>, and the id at the end, which is the same as the copy\'s folder, never shows anyway.'],
      facts: { Keeps: 'Exactly what git calls it', Loses: 'Everything after the first word' },
      lane: (b, p) => h('div', { class: 'lane', title: title(b, p) }, mark(b), h('span', { class: 'clip', text: p.slug + b.branch.slice(-7) })),
    },
    {
      id: 'tidy', name: 'Tidy name',
      say: [
        'Three small changes, no new layout. The id goes (it\'s in the tooltip and the branch menu). The kind becomes a tag, coloured by kind. The words lose their hyphens and use the body font, which fits about a third more letters than mono at the same size.',
        'The cheapest fix: a dozen lines in <code>paintLane</code> and the lane\'s CSS.',
      ],
      facts: { Keeps: 'The kind, as a tag that never truncates', Loses: 'The exact git name, in the header' },
      lane: (b, p) => h('div', { class: 'lane', 'data-kind': p.colour, title: title(b, p) }, mark(b), p.kind ? h('span', { class: 'tag', text: p.kind }) : null, h('span', { class: 'clip', text: p.words })),
    },
    {
      id: 'glyph', name: 'Kind as colour',
      say: [
        'The kind leaves the text altogether and becomes the colour of the branch glyph: sea-glass for a feature, coral for a fix, amber for speed. All the room goes to the words that tell panes apart.',
        'Colour alone can\'t carry meaning, so the tooltip still names the kind, and the same colours would show on the subbar\'s branch chip and in Ready to review, so they\'re learned once.',
      ],
      facts: { Keeps: 'Most letters of any option', Loses: 'The kind, unless you know the colours' },
      legend: true,
      lane: (b, p) => h('div', { class: 'lane', 'data-kind': p.colour, title: title(b, p) }, mark(b), glyph(), h('span', { class: 'clip', text: p.words })),
    },
    {
      id: 'middle', name: 'Keep both ends',
      say: [
        'Stays faithful to git: the same mono slug, minus the id, but the middle gives way instead of the end. <code>feat-noti…ons-bell</code> keeps the kind and the last word, which is usually the noun that names the thing.',
        'Works best when branches share a first word, which Shellby\'s do by design.',
      ],
      facts: { Keeps: 'Git\'s spelling; both ends', Loses: 'Readability: the middle is guesswork' },
      lane: (b, p) => h('div', { class: 'lane', title: title(b, p) }, mark(b), h('span', { class: 'clip', 'data-mid': p.slug })),
    },
    {
      id: 'elastic', name: 'Grows into space', pick: true,
      say: [
        'Tidy name and kind-as-colour, with the 140px cap gone. On a wide pane (full screen on 4K) the whole name shows, right-aligned against the buttons. As the pane narrows, the tab gives way first, then the words; below about 260px the lane folds to the coloured glyph and the check.',
        'Hover or tab to it and a card drops down with the full git name, where it came from and how its checks went. Nothing is ever lost, it\'s one step away.',
      ],
      facts: { Keeps: 'Everything, at any width', Loses: 'Nothing; costs a container query and a card' },
      try: 'Try it: drag the slider across 260px, then hover a lane.',
      lane: (b, p) => [
        h('div', { class: 'lane', 'data-kind': p.colour, tabindex: '0', 'aria-label': `Branch ${p.words}, ${p.kind || 'other'}. ${SAY[b.check]}` }, mark(b), glyph(), h('span', { class: 'clip', text: p.words })),
        h('div', { class: 'peek', role: 'tooltip' },
          h('b', { 'data-kind': p.colour }, glyph(), p.kind ? h('span', { class: 'tag', text: p.kind }) : null, p.words),
          h('div', {}, h('code', { text: b.branch })),
          h('div', { text: `From ${b.base}. ${SAY[b.check]}.` })),
      ],
    },
    {
      id: 'under', name: 'Under the tab',
      say: [
        'The branch moves into the tab, as a second line under the title, so every tab in a pane carries its own branch, not just the one showing. The lane goes, and the header grows by 10px.',
        'Best when one pane holds several conversations, each in its own copy. The cost is height on every pane, and a second line that\'s small.',
      ],
      facts: { Keeps: 'A branch per tab, not per pane', Loses: '10px of every pane, and the lane as a drag handle' },
      head: (b, p) => h('div', { class: 'head' },
        h('div', { class: 'tabs' }, h('div', { class: 'tab', title: title(b, p) },
          h('div', { class: 'tab-main' }, h('span', { class: 'tab-title', text: b.title }),
            h('span', { class: 'tab-sub', 'data-kind': p.colour }, glyph(), mark(b), h('span', { class: 'clip', text: p.words }))),
          h('span', { class: 'tab-x', 'aria-hidden': 'true', text: '×' }))),
        h('div', { class: 'spacer' }), plus(), zoom()),
    },
    {
      id: 'pill', name: 'A chip with state',
      say: [
        'The lane becomes a button. Besides the name it says how many commits the copy is ahead of <code>main</code>, and clicking it opens what the subbar\'s branch chip opens today: bring it home, look over the changes, switch. The branch stops being a label and becomes the way to finish the work.',
        'The most useful, and the busiest: on a narrow pane the count and check leave less room for the name.',
      ],
      facts: { Keeps: 'The name, plus what\'s left to do', Loses: 'Quiet: it\'s the loudest thing in the header' },
      try: 'Try it: click a chip.',
      lane: (b, p) => h('button', { class: 'lane', type: 'button', 'data-kind': p.colour, 'aria-haspopup': 'menu', title: title(b, p), onclick: e => toggleMenu(e, b, p) },
        glyph(), h('span', { class: 'clip', text: p.words }), mark(b),
        h('span', { class: `ahead${b.ahead ? '' : ' zero'}`, title: `${b.ahead} commit${b.ahead === 1 ? '' : 's'} ahead of ${b.base}`, text: b.ahead ? `↑${b.ahead}` : 'even' })),
    },
  ];

  function toggleMenu(e, b, p) {
    const head = e.currentTarget.closest('.head');
    const open = head.querySelector('.menu');
    document.querySelectorAll('.menu').forEach(m => m.remove());
    if (open) return;
    const item = (icon, text) => h('button', { type: 'button', role: 'menuitem', onclick: () => head.querySelector('.menu')?.remove() }, h('span', { text: icon }), text);
    head.append(h('div', { class: 'menu', role: 'menu' },
      h('div', { class: 'who' }, h('code', { text: b.branch }), h('div', { text: `${b.ahead} ahead of ${b.base}. ${SAY[b.check]}.` })),
      item('↩', 'Bring it home'), item('⇡', 'Bring it home and push'), item('◇', 'Look over the changes'), item('⎘', 'Copy the branch name')));
  }
  document.addEventListener('click', e => { if (!e.target.closest('.o-pill .lane, .menu')) document.querySelectorAll('.menu').forEach(m => m.remove()); });

  function headFor(opt, b) {
    const p = parse(b.branch);
    if (opt.head) return opt.head(b, p);
    return h('div', { class: 'head' }, tab(b), h('div', { class: 'spacer' }), opt.lane(b, p), plus(), zoom());
  }

  function legend() {
    return h('div', { class: 'legend' }, ...['feat', 'fix', 'perf', 'refactor', 'other'].map(k =>
      h('span', { 'data-kind': k }, glyph(), k === 'other' ? 'docs, test, chore' : k)));
  }

  function render() {
    const root = document.getElementById('mocks');
    root.replaceChildren(...OPTIONS.map(opt => {
      const dl = h('dl', {}, ...Object.entries(opt.facts).flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
      const sayBox = h('div', { class: 'say' });
      sayBox.append(h('h2', { text: opt.name }, opt.pick ? h('span', { class: 'pick', text: 'Recommended' }) : null));
      for (const para of opt.say) { const el = h('p'); el.innerHTML = para; sayBox.append(el); } // trusted copy, written above
      if (opt.try) sayBox.append(h('p', { class: 'try', text: opt.try }));
      return h('section', { class: `mock o-${opt.id}`, id: opt.id, 'aria-labelledby': `${opt.id}-h` },
        sayBox, dl,
        h('div', { class: 'stage' }, ...BRANCHES.map(b => pane(headFor(opt, b), b)), opt.legend ? legend() : null));
    }));
    root.querySelectorAll('h2').forEach((el, i) => { el.id = `${OPTIONS[i].id}-h`; });
    fitMiddles();
  }

  // Middle ellipsis: keep as many letters from both ends as fit.
  function fitMiddles() {
    document.querySelectorAll('[data-mid]').forEach(el => {
      const full = el.dataset.mid;
      el.textContent = full;
      if (el.scrollWidth <= el.clientWidth) return;
      let lo = 2, hi = full.length - 1;
      while (lo < hi) {
        const k = Math.ceil((lo + hi) / 2);
        el.textContent = full.slice(0, Math.ceil(k / 2)) + '…' + full.slice(full.length - Math.floor(k / 2));
        if (el.scrollWidth <= el.clientWidth) lo = k; else hi = k - 1;
      }
      el.textContent = full.slice(0, Math.ceil(lo / 2)) + '…' + full.slice(full.length - Math.floor(lo / 2));
    });
  }

  // ------------------------------------------------------------ the width slider
  const range = document.getElementById('width');
  const out = document.getElementById('widthOut');
  const presets = document.querySelectorAll('.presets button');
  function setWidth(w) {
    range.value = w;
    out.value = `${w}px`;
    document.documentElement.style.setProperty('--w', `${w}px`);
    presets.forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.w) === Number(w))));
    fitMiddles();
  }
  range.addEventListener('input', () => setWidth(range.value));
  presets.forEach(b => b.addEventListener('click', () => setWidth(b.dataset.w)));

  render();
  const asked = Number(new URLSearchParams(location.search).get('w')); // ?w=860 opens at that width
  document.fonts.ready.then(() => setWidth(asked >= 180 && asked <= 900 ? asked : range.value));
})();
