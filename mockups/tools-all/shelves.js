// 2. Shelves: most of 171 came in a handful of plugins, so the list is laid
// out by where things come from. Each source is a shelf that says how much of
// it Claude uses and what it costs; a plugin shelf shows what's used and
// folds the rest, and can be turned off from here. A strip across the top is
// the whole toolbox by source. Rows open in a drawer.
(function () {
  'use strict';
  const T = window.TB;
  const { esc, tok, glyph } = T;
  const P = () => window.AK_PARTS;
  const SRC_TINT = { user: 'var(--glass)', project: '#a7d47a', cli: 'var(--sand-dim)' };
  const PLUGIN_TINTS = ['#b3a6ff', '#8fc7ff', '#f29bc4', '#ffc15e', '#d9b98a', '#7fb0a6'];

  function mount(phone) {
    const ak = window.AK.create(phone);
    const { body, off } = window.AK_FRAME(phone, ak);
    const st = { off: new Set(), unfolded: new Set(), flash: null };
    body.innerHTML = `
      <div class="sh">
        <header class="sh-top">
          <p class="sh-lede"></p>
          <div class="sh-strip" role="group" aria-label="Jump to a shelf"></div>
          <div class="sh-find">
            <input type="search" class="field" placeholder="Search every shelf" aria-label="Search skills, agents and commands">
            <select class="field" aria-label="Order">${ak.SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          </div>
          <div class="sh-health" role="status"></div>
        </header>
        <div class="scroll sh-scroll"><div class="sh-grid"></div><div class="sh-parked"></div></div>
        <aside class="sh-drawer" aria-label="Details"></aside>
        <div class="sh-batch"></div>
      </div>`;
    const $ = s => body.querySelector(s);
    const root = $('.sh');
    const search = $('.sh-find input');
    const tint = (src, i) => SRC_TINT[src] || PLUGIN_TINTS[i % PLUGIN_TINTS.length];

    // Every shelf, whatever the search, so the strip and the lede stay whole.
    const allGroups = () => {
      const saved = { q: ak.st.q, only: ak.st.only, source: ak.st.source };
      Object.assign(ak.st, { q: '', only: null, source: 'all' });
      const g = ak.groups();
      Object.assign(ak.st, saved);
      return g;
    };

    function drawTop() {
      const gs = allGroups();
      const on = gs.filter(g => !st.off.has(g.src));
      const n = T.total(on.map(g => g.rows.length));
      const used = T.total(on.map(g => g.used));
      const carried = T.total(on.map(g => g.tokens));
      $('.sh-lede').innerHTML = `<b>${n}</b> things Claude can reach for, from <b>${gs.length}</b> places. <b>${used}</b> used lately; together they cost <b>${tok(carried)}</b> tokens in every conversation.`;
      $('.sh-strip').innerHTML = gs.map((g, i) => {
        const offIt = st.off.has(g.src);
        return `<button type="button" class="sh-seg${offIt ? ' off' : ''}" data-jump="${esc(g.src)}" style="flex:${g.rows.length};--t:${tint(g.src, i)};--u:${Math.round((g.used / g.rows.length) * 100)}%" title="${esc(g.name)}: ${g.rows.length}, ${g.used} used lately${offIt ? ' (off)' : ''}"><span class="sr">${esc(g.name)}</span></button>`;
      }).join('');
      const parts = ak.health();
      $('.sh-health').innerHTML = parts.map(p => `<button type="button" class="hp ${p.tone}" data-only="${p.key}" aria-pressed="${ak.st.only === p.key}" title="${esc(p.title)}">${esc(p.text)}</button>`).join('')
        + (ak.st.only ? '<button type="button" class="link" data-only="">Show all</button>' : '')
        + '<span class="gap"></span><button type="button" class="btn quiet" data-a="import">Import…</button>';
      $('.sh-find select').value = ak.st.sort;
    }

    function tile(t) {
      const pickedIt = ak.st.picked.has(t.id);
      return `<li class="sh-tile${ak.isIdle(t) ? ' idle' : ''}${ak.st.open === t.id ? ' open' : ''}${pickedIt ? ' picked' : ''}" data-row="${esc(t.id)}">
        ${ak.isOwn(t) ? `<input type="checkbox" data-k="pick" aria-label="Pick ${esc(ak.label(t))}" ${pickedIt ? 'checked' : ''}>` : ''}
        <button type="button" class="sh-open" data-k="open" title="${esc(t.desc || 'No description')}">${glyph(t.kind, 20)}<code>${esc(ak.label(t))}</code>${t.isNew ? '<span class="new">new</span>' : ''}${ak.isPinned(t) ? '<span class="pinned" title="Pinned">★</span>' : ''}${t.hides.length ? '<span class="dot amber" title="Hides another copy"></span>' : ''}${ak.isOwn(t) && !t.desc ? '<span class="dot amber" title="No description"></span>' : ''}</button>
        <span class="sh-n">${t.uses ? `${t.uses}×` : ''}</span>
        <span class="sh-acts">${P().acts(ak, t)}</span>
      </li>`;
    }

    function drawShelves() {
      const items = ak.list();
      ak.prune(items.filter(ak.isOwn));
      const filtering = !!(ak.st.q.trim() || ak.st.only);
      const gs = ak.groups(items);
      const all = allGroups();
      $('.sh-grid').innerHTML = gs.length ? gs.map(g => {
        const i = all.findIndex(a => a.src === g.src);
        const whole = all[i];
        const own = g.src === 'user' || g.src === 'project';
        const offIt = st.off.has(g.src);
        const showAll = filtering || !g.plugin || st.unfolded.has(g.src);
        const rows = showAll ? g.rows : g.rows.filter(t => t.uses);
        const hidden = g.rows.length - rows.length;
        const idleOwn = g.rows.filter(t => ak.isOwn(t) && ak.isIdle(t)).length;
        const pct = Math.round((whole.used / whole.rows.length) * 100);
        return `<section class="shelf${offIt ? ' off' : ''}${st.flash === g.src ? ' flash' : ''}" id="shelf-${esc(g.src.replace(/\W/g, '-'))}" style="--t:${tint(g.src, i)}" aria-label="${esc(g.name)}">
          <header>
            <div class="shelf-title"><b>${esc(g.name)}</b>${g.plugin ? '<span class="tag">plugin</span>' : ''}<span class="shelf-n">${filtering ? `${g.rows.length} of ${whole.rows.length}` : whole.rows.length}</span></div>
            <div class="shelf-use" title="${whole.used} of ${whole.rows.length} used in the last ${ak.d.LOOKBACK} days"><span class="meter"><i style="width:${Math.max(pct, whole.used ? 4 : 0)}%"></i></span><span>${offIt ? 'Off for new conversations' : whole.used ? `${whole.used} of ${whole.rows.length} used lately` : '<span class="warn">None used lately</span>'}</span><span class="muted">${tok(whole.tokens)} tokens</span></div>
            <div class="shelf-acts">
              ${g.plugin ? `<button type="button" class="btn ${offIt ? 'primary' : 'ghost'}" data-plugin="${esc(g.src)}">${offIt ? 'Turn on' : `Turn off, save ${tok(whole.tokens)}`}</button>` : ''}
              ${own && !offIt ? `<button type="button" class="link" data-select-group="${esc(g.src)}">Select all</button>${idleOwn ? `<button type="button" class="link" data-pick-idle="${esc(g.src)}">Pick ${idleOwn} unused</button>` : ''}` : ''}
            </div>
          </header>
          ${offIt ? '' : `<ul class="shelf-tiles">${rows.map(tile).join('')}</ul>
          ${hidden ? `<button type="button" class="shelf-more" data-unfold="${esc(g.src)}">${rows.length ? `${hidden} more, not used lately` : `Show all ${hidden}, none used lately`}</button>` : ''}
          ${!filtering && g.plugin && st.unfolded.has(g.src) ? `<button type="button" class="shelf-more" data-fold="${esc(g.src)}">Fold the unused away</button>` : ''}`}
        </section>`;
      }).join('') : `<p class="sh-empty">Nothing on any shelf matches “${esc(ak.st.q)}”. <button type="button" class="link" data-get-more>Look in Get more</button></p>`;
      $('.sh-parked').innerHTML = P().parked(ak, 20);
      root.classList.toggle('picking', ak.st.picked.size > 0);
      $('.sh-batch').innerHTML = P().batchBar(ak);
    }

    function drawDrawer() {
      const t = ak.st.open && ak.byId(ak.st.open);
      root.classList.toggle('drawer-open', !!t);
      $('.sh-drawer').innerHTML = t ? `
        <button type="button" class="btn quiet sh-close" data-close aria-label="Close">✕</button>
        <div class="sh-dh">${glyph(t.kind, 34)}<div><h4><code>${esc(ak.label(t))}</code></h4><p class="muted">${esc(ak.KIND_NAMES[t.kind])}, ${esc(ak.sourceLabel(t.source))}</p></div></div>
        <p class="sh-desc">${t.desc ? esc(t.desc) : '<em>No description.</em>'}</p>
        <div class="sh-dacts">${P().acts(ak, t)}</div>
        ${P().detail(ak, t)}` : '';
    }

    const draw = () => P().keepFocus(body, () => { drawTop(); drawShelves(); drawDrawer(); st.flash = null; });
    const unsub = ak.on(draw);
    draw();

    function togglePlugin(src) {
      const was = st.off.has(src);
      const g = allGroups().find(x => x.src === src);
      if (was) st.off.delete(src); else st.off.add(src);
      ak.toast(was ? `${g.name} is on again for new conversations` : `${g.name} is off. New conversations start ${tok(g.tokens)} tokens lighter.`, was ? null : () => { st.off.delete(src); draw(); });
      draw();
    }

    let wait;
    search.addEventListener('input', () => { clearTimeout(wait); wait = setTimeout(() => ak.set({ q: search.value }), 120); });
    $('.sh-find select').addEventListener('change', e => ak.set({ sort: e.target.value }));
    body.addEventListener('click', e => {
      if (e.target.matches('input[data-k="pick"]')) {
        ak.pick(ak.byId(e.target.closest('[data-row]').dataset.row), e.target.checked, e.shiftKey, ak.list().filter(ak.isOwn));
        return;
      }
      if (P().handle(ak, e)) return;
      const b = e.target.closest('button');
      if (!b) return;
      const ds = b.dataset;
      if ('only' in ds) ds.only === 'mcp' ? ak.actions.openMcp() : ak.set({ only: ak.st.only === ds.only || !ds.only ? null : ds.only });
      else if (ds.jump) {
        st.flash = ds.jump;
        if (ak.st.q || ak.st.only) { search.value = ''; ak.set({ q: '', only: null }); } else draw();
        body.querySelector(`#shelf-${CSS.escape(ds.jump.replace(/\W/g, '-'))}`)?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      } else if (ds.plugin) togglePlugin(ds.plugin);
      else if (ds.unfold) { st.unfolded.add(ds.unfold); draw(); }
      else if (ds.fold) { st.unfolded.delete(ds.fold); draw(); }
      else if (ds.selectGroup) { ak.list().filter(t => t.source === ds.selectGroup && ak.isOwn(t)).forEach(t => ak.st.picked.add(t.id)); ak.set({}); }
      else if (ds.pickIdle) { ak.list().filter(t => t.source === ds.pickIdle && ak.isOwn(t) && ak.isIdle(t)).forEach(t => ak.st.picked.add(t.id)); ak.set({}); }
      else if (ds.k === 'open') ak.toggleOpen(b.closest('[data-row]').dataset.row);
      else if ('close' in ds) ak.toggleOpen(ak.st.open);
      else if ('getMore' in ds) ak.toast('Opens Get more, searching the marketplaces');
    });
    const esc_ = e => { if (e.key === 'Escape' && ak.st.open) ak.toggleOpen(ak.st.open); };
    phone.addEventListener('keydown', esc_);
    return () => { unsub(); off(); clearTimeout(wait); phone.removeEventListener('keydown', esc_); };
  }

  T.register({
    id: 'shelves', name: 'Shelves', line: 'One shelf per place they come from', mount,
    notes: {
      pitch: [
        'Of 171, 92 came in fourteen plugins, and Claude used 14 of those lately. So this lays All out by where things come from. Each source is a shelf, and each shelf says what it costs every conversation and how much of it Claude used lately, with a meter you can read from across the room.',
        'A plugin shelf shows only what’s been used and folds the rest behind one line (“18 more, not used lately”). A plugin you never use can be turned off right on its shelf, and the button says what that saves. Today that lives in Get more.',
        'The strip at the top is the whole toolbox by source. Each slice is as wide as its count, and the bright part is what’s used. Press a slice to jump to its shelf. Rows are small tiles that open a drawer.',
      ],
      tryIt: [
        'Look at the strip. Then press <b>Turn off, save 345</b> on <b>ruflo-core</b>, which brought twelve and none get used: the lede drops by twelve and its slice goes hatched. <b>Undo</b> is in the toast.',
        'On <b>example-skills</b>, press <b>11 more, not used lately</b>, then fold them away again.',
        'Search <b>design</b>. Shelves without a match disappear, and the rest say how many of theirs match, like “7 of 12”.',
        'On <b>Yours</b>, press <b>Pick … unused</b>, then <b>Park</b> in the bar.',
      ],
      mapTitle: 'Everything All does today',
      map: [
        ['Search', 'Under the strip; it filters every shelf'],
        ['Where from', 'The strip and the shelves themselves'],
        ['Order', 'Next to search; it orders the tiles on each shelf'],
        ['Health line', 'Tinted counts; amber dots on the tiles they mean'],
        ['Groups', 'Shelves: yours first, plugins fold what’s unused'],
        ['Select all, Pick unused', 'On the Yours and This project shelves'],
        ['Import', 'The end of the health line'],
        ['Pin … Remove', 'The floating bar once something is picked'],
        ['Use, star, Chat as', 'On a tile when you point at it; in the drawer'],
        ['Row details', 'A drawer: bottom sheet in the panel, right side when wide'],
        ['Parked', 'Last, under the shelves, with Restore'],
        ['Turning a plugin off', 'New here: on its shelf, saying what it saves'],
      ],
      tradeoff: 'Finding one thing by name is a search away rather than a scroll, since nothing is in one A to Z run any more. And tiles show less of each one than a row does: the description waits for the drawer.',
    },
  });
})();
