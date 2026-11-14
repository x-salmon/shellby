// 2. Triage: every tool on one chart, how often Claude uses it against how
// much it carries. The four corners are four decisions, each with its button.
(function () {
  'use strict';
  const T = window.TB;
  const { esc, tok, ago, total, glyph, KINDS } = T;

  const HEAVY = 600; // tokens carried
  const USED = 4; // uses in six weeks
  const QUADS = [
    { id: 'dead', name: 'Dead weight', when: 'Heavy, and Claude hardly uses them', color: 'var(--amber)' },
    { id: 'never', name: 'Rarely picked', when: 'Light, but Claude rarely reaches for them', color: 'var(--sand-dim)' },
    { id: 'handy', name: 'Light and handy', when: 'Cheap to carry and used often', color: 'var(--glass)' },
    { id: 'worth', name: 'Worth the weight', when: 'Heavy, and used enough to earn it', color: 'var(--coral)' },
  ];
  const PANEL_VB = Object.freeze({ w: 420, h: 270, l: 40, r: 12, t: 14, b: 30 });
  let VB = PANEL_VB;
  const MAX_U = 128;
  const MIN_T = 30;
  const MAX_T = 14000;

  const quadOf = it => {
    const used = total(it.uses) >= USED;
    const heavy = it.tokens >= HEAVY;
    if (heavy) return used ? 'worth' : 'dead';
    return used ? 'handy' : 'never';
  };
  const jit = id => [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7) / 997;
  const X = u => VB.l + (Math.log1p(u) / Math.log1p(MAX_U)) * (VB.w - VB.l - VB.r);
  const Y = t => VB.t + (1 - Math.log(t / MIN_T) / Math.log(MAX_T / MIN_T)) * (VB.h - VB.t - VB.b);

  function mount(phone) {
    const d = T.clone();
    const pts = d.items.filter(it => it.tokens > 0 && Array.isArray(it.uses)).map(it => ({ ...it, q: quadOf(it) }));
    const st = { quad: 'dead', sel: null, parked: new Set(), sharpened: new Set() };
    const carried = () => d.BASELINE.tokens + total(d.memory.map(m => m.tokens)) + total(d.items.filter(it => !st.parked.has(it.id)).map(it => it.tokens));
    let shown = carried();

    phone.innerHTML = `
      <div class="bar"><h3>Toolbox</h3><span class="tr-total muted"><b class="tr-num"></b> tokens carried</span></div>
      <div class="tr">
        <figure class="tr-fig">
          <figcaption><b>What’s pulling its weight</b><span class="muted">Each dot is something Claude carries into every conversation.</span></figcaption>
          <svg class="tr-chart" viewBox="0 0 ${VB.w} ${VB.h}" role="group" aria-label="Uses against weight"></svg>
        </figure>
        <section class="tr-side">
          <div class="tr-quads" role="tablist" aria-label="Corners"></div>
          <div class="tr-body scroll"></div>
        </section>
      </div>`;
    const $ = s => phone.querySelector(s);

    function chart() {
      const svg = $('.tr-chart');
      const wide = phone.clientWidth >= 900;
      VB = wide ? { ...PANEL_VB, l: 56, b: 40, w: Math.max(420, Math.round(svg.parentElement.clientWidth - 56)), h: Math.max(270, Math.round(svg.parentElement.clientHeight - 80)) } : PANEL_VB;
      svg.setAttribute('viewBox', `0 0 ${VB.w} ${VB.h}`);
      svg.classList.toggle('px', wide);
      const midX = X(USED - 0.5);
      const midY = Y(HEAVY);
      const R = VB.w - VB.r;
      const B = VB.h - VB.b;
      const zone = (id, x, y, w, h) => `<rect class="tr-zone z-${id}${st.quad === id ? ' on' : ''}" data-quad="${id}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
      const label = (id, x, y, anchor) => `<text class="tr-zl${st.quad === id ? ' on' : ''}" x="${x}" y="${y}" text-anchor="${anchor}">${QUADS.find(q => q.id === id).name}</text>`;
      const xt = [0, 1, 4, 16, 64, 128].map(u => `<text class="tr-tick" x="${X(u)}" y="${B + 14}" text-anchor="middle">${u}</text>`).join('');
      const yt = [50, 200, 600, 2000, 6000].map(t => `<text class="tr-tick" x="${VB.l - 6}" y="${Y(t) + 3}" text-anchor="end">${tok(t)}</text>`).join('');
      const dots = pts.map(p => {
        const x = X(total(p.uses)) + (total(p.uses) === 0 ? jit(p.id) * 26 : (jit(p.id) - 0.5) * 6);
        const y = Y(p.tokens) + (jit(p.id + 'y') - 0.5) * 8;
        const parked = st.parked.has(p.id);
        const big = p.tokens >= HEAVY || st.sel === p.id;
        return `<g class="tr-dot${parked ? ' parked' : ''}${st.sel === p.id ? ' sel' : ''}${p.q === st.quad ? '' : ' dim'}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(`${p.name}, ${tok(p.tokens)} tokens, ${total(p.uses)} uses`)}" style="--k:${KINDS[p.kind].color}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
          <circle r="${st.sel === p.id ? 8 : 5.5}"/>${big ? `<text x="${x > R - 90 ? -10 : 10}" y="4" text-anchor="${x > R - 90 ? 'end' : 'start'}">${esc(p.name)}</text>` : ''}</g>`;
      }).join('');
      $('.tr-chart').innerHTML = `
        ${zone('dead', VB.l, VB.t, midX - VB.l, midY - VB.t)}${zone('worth', midX, VB.t, R - midX, midY - VB.t)}
        ${zone('never', VB.l, midY, midX - VB.l, B - midY)}${zone('handy', midX, midY, R - midX, B - midY)}
        <line class="tr-split" x1="${midX}" y1="${VB.t}" x2="${midX}" y2="${B}"/><line class="tr-split" x1="${VB.l}" y1="${midY}" x2="${R}" y2="${midY}"/>
        ${label('dead', VB.l + 8, VB.t + 16, 'start')}${label('worth', R - 8, VB.t + 16, 'end')}
        ${label('never', VB.l + 8, midY + 15, 'start')}${label('handy', R - 8, midY + 15, 'end')}
        ${xt}${yt}
        <text class="tr-axis" x="${(VB.l + R) / 2}" y="${VB.h - 2}" text-anchor="middle">Uses in the last six weeks</text>
        <text class="tr-axis" transform="translate(10 ${(VB.t + B) / 2}) rotate(-90)" text-anchor="middle">Tokens carried</text>
        ${dots}`;
    }

    function quads() {
      $('.tr-quads').innerHTML = QUADS.map(q => {
        const n = pts.filter(p => p.q === q.id && !st.parked.has(p.id)).length;
        return `<button type="button" role="tab" aria-selected="${st.quad === q.id}" data-quad="${q.id}" style="--q:${q.color}"><b>${n}</b><span>${q.name}</span></button>`;
      }).join('');
    }

    function action(p) {
      if (st.parked.has(p.id)) return `<button type="button" class="btn quiet" data-act="restore" data-id="${esc(p.id)}">Bring back</button>`;
      if (p.status === 'needs-auth') return `<button type="button" class="btn" data-act="signin" data-id="${esc(p.id)}">Sign in</button><button type="button" class="btn quiet" data-act="park" data-id="${esc(p.id)}">Park</button>`;
      if (p.q === 'never' && p.desc.split(' ').length < 5 && !st.sharpened.has(p.id)) return `<button type="button" class="btn" data-act="sharpen" data-id="${esc(p.id)}">Sharpen</button>`;
      if (p.q === 'dead' || p.q === 'never') return `<button type="button" class="btn" data-act="park" data-id="${esc(p.id)}">Park</button>`;
      if (p.q === 'handy') return `<button type="button" class="btn quiet" data-act="pin" data-id="${esc(p.id)}">Pin</button>`;
      return '';
    }

    function body() {
      const q = QUADS.find(x => x.id === st.quad);
      const list = pts.filter(p => p.q === st.quad).sort((a, b) => b.tokens - a.tokens);
      const live = list.filter(p => !st.parked.has(p.id));
      const save = total(live.map(p => p.tokens));
      const advice = {
        dead: `These carry ${tok(save)} tokens into every conversation for almost no use. Park them: they stay installed, and come back with one click.`,
        never: 'Claude chooses a skill from its description alone. Short or vague ones never get picked. Sharpen them, or park the ones you don’t need.',
        handy: 'Cheap and busy. Pin the ones you start with so they’re on the start screen.',
        worth: 'Heavy, but Claude uses them every week. Nothing to do here.',
      }[st.quad];
      $('.tr-body').innerHTML = `
        <p class="tr-advice" style="--q:${q.color}"><b>${q.when}.</b> ${advice}</p>
        ${(st.quad === 'dead' || st.quad === 'never') && live.length > 1 ? `<button type="button" class="btn amber tr-all" data-act="park-all">Park all ${live.length}, save ${tok(save)}</button>` : ''}
        <ul class="tr-list">${list.map(p => `<li class="${st.parked.has(p.id) ? 'parked' : ''}${st.sel === p.id ? ' sel' : ''}" data-id="${esc(p.id)}">
          ${glyph(p.kind, 24)}
          <span class="tr-n"><b>${esc(p.name)}</b><small>${st.parked.has(p.id) ? 'Parked' : `${tok(p.tokens)} tokens, ${total(p.uses) ? `${total(p.uses)} ${total(p.uses) === 1 ? 'use' : 'uses'}, last ${ago(p.lastUsed)}` : 'never used'}`}${st.sharpened.has(p.id) ? ', description sharpened' : ''}</small></span>
          <span class="tr-a">${action(p)}</span></li>`).join('') || '<li class="muted">Nothing here.</li>'}</ul>`;
    }

    function all() {
      chart(); quads(); body();
      const now = carried();
      T.countTo($('.tr-num'), shown, now);
      shown = now;
    }

    function park(ids) {
      const fresh = ids.filter(id => !st.parked.has(id));
      fresh.forEach(id => st.parked.add(id));
      const saved = total(pts.filter(p => fresh.includes(p.id)).map(p => p.tokens));
      all();
      T.toast(phone, `Parked ${fresh.length}, saving ${tok(saved)} tokens a conversation`, () => { fresh.forEach(id => st.parked.delete(id)); all(); });
    }

    phone.addEventListener('click', e => {
      const t = e.target.closest('[data-act],[data-quad],[data-id]');
      if (!t) return;
      const p = pts.find(x => x.id === t.dataset.id);
      switch (t.dataset.act) {
        case 'park': park([p.id]); return;
        case 'park-all': park(pts.filter(x => x.q === st.quad && !st.parked.has(x.id)).map(x => x.id)); return;
        case 'restore': st.parked.delete(p.id); all(); return;
        case 'sharpen': st.sharpened.add(p.id); all(); T.toast(phone, `Claude rewrote ${p.name}’s description. It’s in your editor to check.`); return;
        case 'signin': T.toast(phone, 'Opened Linear’s sign-in page in your browser'); return;
        case 'pin': T.toast(phone, `Pinned ${p.name} to the start screen`); return;
      }
      if (t.dataset.quad) { st.quad = t.dataset.quad; st.sel = null; all(); return; }
      if (p) { st.sel = st.sel === p.id ? null : p.id; st.quad = p.q; all(); phone.querySelector(`.tr-list li[data-id="${CSS.escape(p.id)}"]`)?.scrollIntoView({ block: 'nearest' }); }
    });
    const onResize = () => chart();
    addEventListener('resize', onResize);
    phone.addEventListener('keydown', e => {
      const g = e.target.closest('.tr-dot');
      if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    });

    all();
    return () => removeEventListener('resize', onResize);
  }

  T.register({
    id: 'triage',
    name: 'Triage',
    line: 'Usage against weight, four decisions',
    mount,
    notes: {
      pitch: [
        'Lean today is twelve lists of numbers. This puts every tool on one chart: across, how often Claude used it in six weeks; up, how many tokens it carries into every conversation. Where a dot lands says what to do with it.',
        'Each corner comes with its own advice and its own button. Heavy and unused means park it. Light and rarely picked usually means a vague description, since Claude chooses skills by their description alone.',
      ],
      tryIt: [
        'Start in <b>Dead weight</b>. claude-in-chrome carries 5.2k tokens for one use in six weeks. Press <b>Park all</b> and watch the dots fade and the total drop.',
        'Pick <b>Rarely picked</b>. csv-cleaner offers <b>Sharpen</b> instead of Park, because its description is the problem.',
        'Click any dot on the chart. Its corner opens and its row lights up. The corner shading is clickable too.',
        'Switch to <b>Window</b>: the chart gets the room and the corner list sits beside it.',
      ],
      map: [
        ['Lean', 'Becomes the chart. Its long lists of per-item numbers become four sorted corners.'],
        ['Tools', 'Still the place to browse and edit (mockup 1 or 5). Triage is the clean-up view, opened from a “Trim” button there.'],
        ['MCP status', 'Shows in the corner list: linear offers Sign in before Park.'],
        ['Idle', 'Is a place on the chart, not an amber word repeated down a list.'],
      ],
      tradeoff: 'A chart is a second way to read the same list, and it only covers things that cost tokens. Mods, snippets and hooks don’t show. It works best as a view inside one of the other mockups, not on its own.',
    },
  });
})();
