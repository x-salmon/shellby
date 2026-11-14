// 3. Ledger: All as a table you work through. Every column sorts, the health
// line and the usual questions (new, pinned, unused) are filters with counts,
// the keyboard does everything, and a totals line says what's shown and what
// it costs. In the panel the table folds to the name and the column you
// sorted by; wide, every column shows and a row opens in a side panel.
(function () {
  'use strict';
  const T = window.TB;
  const { esc, tok, glyph } = T;
  const P = () => window.AK_PARTS;

  // Columns, and the order each one sorts in. 'name', 'used' and 'unused' are today's three.
  const COLS = [
    { key: 'name', label: 'Name', sort: 'name' },
    { key: 'from', label: 'From', sort: 'from' },
    { key: 'used', label: 'Used lately', sort: 'used', num: true },
    { key: 'last', label: 'Last used', sort: 'last', num: true },
    { key: 'list', label: 'Every conversation', sort: 'heavy', num: true, title: 'What its name and description cost in every conversation' },
    { key: 'each', label: 'Each use', sort: 'each', num: true, title: 'What reading the whole file costs each time Claude uses it' },
  ];
  const EXTRA = {
    from: (a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name),
    last: (a, b) => (a.lastUsed ?? 999) - (b.lastUsed ?? 999) || a.name.localeCompare(b.name),
    heavy: (a, b) => b.listTokens - a.listTokens,
    each: (a, b) => b.useTokens - a.useTokens,
  };
  const SHOW = [['new', 'New'], ['pinned', 'Pinned'], ['unused', 'Not used lately']];
  const MOBILE_COL = { name: 'used', from: 'used', used: 'used', unused: 'list', last: 'last', heavy: 'list', each: 'each' };

  function mount(phone) {
    const ak = window.AK.create(phone);
    const { body, off } = window.AK_FRAME(phone, ak);
    const st = { sort: 'name', dir: 1, cursor: 0 };
    body.innerHTML = `
      <div class="lg">
        <div class="lg-tools">
          <input type="search" class="field" placeholder="Search name, description or plugin" aria-label="Search skills, agents and commands">
          <select class="field lg-source" aria-label="Where they come from"></select>
          <div class="lg-facets" role="group" aria-label="Show only"></div>
        </div>
        <div class="lg-wrap">
          <div class="scroll lg-scroll" tabindex="-1">
            <table class="lg-table">
              <thead><tr></tr></thead>
              <tbody></tbody>
            </table>
            <div class="lg-parked"></div>
          </div>
          <aside class="lg-side" aria-label="Details"></aside>
        </div>
        <footer class="lg-foot" role="status"></footer>
        <div class="lg-batch"></div>
      </div>`;
    const $ = s => body.querySelector(s);
    const root = $('.lg');
    const search = $('.lg-tools input');

    function rows() {
      const base = ak.list();
      const by = EXTRA[st.sort];
      const out = by ? [...base].sort(by) : base;
      return st.dir < 0 ? [...out].reverse() : out;
    }

    function drawTools() {
      const s = ak.sources();
      const opt = ([v, name, n]) => `<option value="${v}">${esc(name)} (${n})</option>`;
      $('.lg-source').innerHTML = s.main.map(opt).join('') + `<optgroup label="One plugin">${s.plugins.map(opt).join('')}</optgroup>`;
      $('.lg-source').value = ak.st.source;
      const all = ak.st.items;
      const n = { new: all.filter(t => t.isNew).length, pinned: all.filter(ak.isPinned).length, unused: all.filter(ak.isIdle).length };
      const health = ak.health();
      $('.lg-facets').innerHTML = SHOW.map(([k, l]) => `<button type="button" class="fc" data-only="${k}" aria-pressed="${ak.st.only === k}">${l} <span>${n[k]}</span></button>`).join('')
        + health.map(p => `<button type="button" class="fc ${p.tone}" data-only="${p.key}" aria-pressed="${ak.st.only === p.key}" title="${esc(p.title)}">${esc(p.text)}</button>`).join('');
    }

    function drawHead() {
      const mob = MOBILE_COL[st.sort] || 'used';
      $('.lg-table thead tr').innerHTML = `<th class="c-pick"><span class="sr">Pick</span></th>${COLS.map(c => {
        const on = st.sort === c.sort || (c.sort === 'used' && st.sort === 'unused');
        const arrow = on ? (st.sort === 'unused' || st.dir < 0 ? '↑' : '↓') : '';
        return `<th class="c-${c.key}${c.num ? ' num' : ''}${c.key === mob ? ' mob' : ''}" aria-sort="${on ? (st.dir > 0 ? 'descending' : 'ascending') : 'none'}"><button type="button" data-col="${c.sort}" ${c.title ? `title="${esc(c.title)}"` : ''}>${c.label}<i aria-hidden="true">${arrow}</i></button></th>`;
      }).join('')}<th class="c-acts"><span class="sr">Actions</span></th>`;
    }

    function drawBody() {
      const list = rows();
      ak.prune(list.filter(ak.isOwn));
      st.cursor = Math.min(st.cursor, Math.max(0, list.length - 1));
      const maxL = Math.max(1, ...list.map(t => t.listTokens));
      const maxU = Math.max(1, ...list.map(t => t.uses));
      const mob = MOBILE_COL[st.sort] || 'used';
      const page = list.slice(0, ak.st.shown);
      $('.lg-table tbody').innerHTML = page.map((t, i) => {
        const pickedIt = ak.st.picked.has(t.id);
        return `<tr class="${ak.isIdle(t) ? 'idle' : ''}${ak.st.open === t.id ? ' open' : ''}${pickedIt ? ' picked' : ''}${i === st.cursor ? ' cur' : ''}" data-row="${esc(t.id)}" data-i="${i}">
          <td class="c-pick">${ak.isOwn(t) ? `<input type="checkbox" data-k="pick" aria-label="Pick ${esc(ak.label(t))}" ${pickedIt ? 'checked' : ''}>` : ''}</td>
          <td class="c-name"><button type="button" class="lg-open" data-k="open">${glyph(t.kind, 20)}<span><span class="lg-n"><code>${esc(ak.label(t))}</code>${t.isNew ? '<span class="new">new</span>' : ''}${ak.isPinned(t) ? '<span class="pinned" title="Pinned">★</span>' : ''}${t.hides.length ? '<span class="tag amber">hides a copy</span>' : ''}</span><small>${t.desc ? esc(t.desc) : '<em>No description</em>'}</small></span></button></td>
          <td class="c-from"><span class="tag${ak.isPlugin(t.source) ? ' plug' : ''}">${esc(ak.sourceLabel(t.source))}</span></td>
          <td class="c-used num${mob === 'used' ? ' mob' : ''}">${t.uses ? `<span class="lg-bar" style="--w:${Math.round((t.uses / maxU) * 100)}"></span>${t.uses}` : '<span class="muted">0</span>'}</td>
          <td class="c-last num${mob === 'last' ? ' mob' : ''}">${t.lastUsed != null ? esc(T.ago(t.lastUsed)) : '<span class="muted">not lately</span>'}</td>
          <td class="c-list num${mob === 'list' ? ' mob' : ''}"><span class="lg-bar sand" style="--w:${Math.round((t.listTokens / maxL) * 100)}"></span>${t.listTokens}</td>
          <td class="c-each num${mob === 'each' ? ' mob' : ''}">${tok(t.useTokens)}</td>
          <td class="c-acts">${P().acts(ak, t)}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="8" class="lg-empty">Nothing matches. <button type="button" class="link" data-reset>Clear the filters</button></td></tr>`;
      if (list.length > page.length) $('.lg-table tbody').insertAdjacentHTML('beforeend', `<tr><td colspan="8" class="lg-more">Showing ${page.length} of ${list.length}. <button type="button" class="btn ghost" data-more>Show all</button></td></tr>`);
      $('.lg-parked').innerHTML = P().parked(ak, 20);
      const used = list.filter(t => t.uses).length;
      $('.lg-foot').innerHTML = `<span><b>${list.length}</b> shown</span><span><b>${used}</b> used lately</span><span><b>${tok(T.total(list.map(t => t.listTokens)))}</b> tokens in every conversation</span><span class="gap"></span><span class="lg-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Space</kbd> pick <kbd>Enter</kbd> open <kbd>U</kbd> use <kbd>P</kbd> pin</span><button type="button" class="btn quiet" data-a="import">Import…</button>`;
      root.classList.toggle('picking', ak.st.picked.size > 0);
      $('.lg-batch').innerHTML = P().batchBar(ak);
    }

    function drawSide() {
      const t = ak.st.open && ak.byId(ak.st.open);
      root.classList.toggle('side-open', !!t);
      $('.lg-side').innerHTML = t ? `
        <button type="button" class="btn quiet lg-close" data-close aria-label="Close">✕</button>
        <div class="lg-sh">${glyph(t.kind, 30)}<div><h4><code>${esc(ak.label(t))}</code></h4><p class="muted">${esc(ak.KIND_NAMES[t.kind])}, ${esc(ak.sourceLabel(t.source))}</p></div></div>
        <p class="lg-desc">${t.desc ? esc(t.desc) : '<em>No description.</em>'}</p>
        <div class="lg-sacts">${P().acts(ak, t)}</div>${P().detail(ak, t)}` : '';
    }

    const draw = () => P().keepFocus(body, () => { drawTools(); drawHead(); drawBody(); drawSide(); });
    const unsub = ak.on(draw);
    draw();

    // Clicking a column sorts by it; again flips it. The three orders today keep their meaning.
    function sortBy(col) {
      if (st.sort === col || (col === 'used' && st.sort === 'unused')) {
        if (col === 'used') { st.sort = st.sort === 'used' ? 'unused' : 'used'; st.dir = 1; } else st.dir = -st.dir;
      } else { st.sort = col; st.dir = 1; }
      ak.set({ sort: ['name', 'used', 'unused'].includes(st.sort) ? st.sort : 'name' });
    }

    let wait;
    search.addEventListener('input', () => { clearTimeout(wait); wait = setTimeout(() => ak.set({ q: search.value }), 120); });
    $('.lg-source').addEventListener('change', e => ak.set({ source: e.target.value }));
    body.addEventListener('click', e => {
      if (e.target.matches('input[data-k="pick"]')) {
        ak.pick(ak.byId(e.target.closest('[data-row]').dataset.row), e.target.checked, e.shiftKey, rows().filter(ak.isOwn));
        return;
      }
      if (P().handle(ak, e)) return;
      const b = e.target.closest('button');
      if (!b) return;
      const ds = b.dataset;
      const tr = b.closest('[data-row]');
      if (tr) st.cursor = Number(tr.dataset.i);
      if (ds.col) sortBy(ds.col);
      else if ('only' in ds) ds.only === 'mcp' ? ak.actions.openMcp() : ak.set({ only: ak.st.only === ds.only ? null : ds.only });
      else if (ds.k === 'open') ak.toggleOpen(tr.dataset.row);
      else if ('close' in ds) ak.toggleOpen(ak.st.open);
      else if ('more' in ds) ak.set({ shown: Infinity });
      else if ('reset' in ds) { search.value = ''; ak.set({ q: '', only: null, source: 'all' }); }
    });

    // The keyboard does it all: a cursor row, and single keys for what you do most.
    function onKey(e) {
      if (e.target.matches('input, select')) {
        if (e.key === 'ArrowDown' && e.target === search) { e.preventDefault(); focusCursor(); }
        return;
      }
      const list = rows();
      const t = list[st.cursor];
      const k = e.key.toLowerCase();
      if (k === 'arrowdown' || k === 'j') st.cursor = Math.min(list.length - 1, st.cursor + 1);
      else if (k === 'arrowup' || k === 'k') st.cursor = Math.max(0, st.cursor - 1);
      else if (k === 'enter' && t && !e.target.closest('button')) ak.toggleOpen(t.id);
      else if (k === ' ' && t && ak.isOwn(t) && !e.target.matches('button')) ak.pick(t, !ak.st.picked.has(t.id), e.shiftKey, list.filter(ak.isOwn));
      else if (k === 'u' && t) ak.actions.use(t);
      else if (k === 'p' && t) ak.actions.pin(t);
      else if (k === '/') { e.preventDefault(); search.focus(); return; }
      else if (k === 'escape' && ak.st.open) ak.toggleOpen(ak.st.open);
      else return;
      e.preventDefault();
      draw();
      focusCursor();
    }
    function focusCursor() {
      const tr = body.querySelector(`tr[data-i="${st.cursor}"]`);
      tr?.querySelector('.lg-open')?.focus({ preventScroll: true });
      tr?.scrollIntoView({ block: 'nearest' });
    }
    body.addEventListener('keydown', onKey);
    return () => { unsub(); off(); clearTimeout(wait); body.removeEventListener('keydown', onKey); };
  }

  T.register({
    id: 'ledger', name: 'Ledger', line: 'A table where every column sorts', mount,
    notes: {
      pitch: [
        'All as a table you work through. Every number is a column: how often Claude used it lately, when it last did, what it costs in every conversation and what it costs each use. Press a heading to sort by it, and again to flip it. Today’s three orders are still there: Name is A to Z, and Used lately flips between Most used and Unused first.',
        'The health line and the usual questions become one row of filters with counts: New, Pinned, Not used lately, and the three that need a look. The keyboard does everything, from moving and picking to opening, using and pinning. A totals line at the bottom always says what’s shown and what it costs.',
        'In the panel the table folds down to the name and the column you sorted by. Wider, every column shows and a row opens in a panel at the side.',
      ],
      tryIt: [
        'Press the <b>Every conversation</b> heading: the costliest first. Press it again for the cheapest.',
        'Press <b>Not used lately</b>, then <b>Yours (…)</b> in the source menu: what you could clean up, with the total cost in the footer.',
        'Click a row, then use <b>↓</b>, <b>Space</b> to pick, <b>U</b> to use and <b>P</b> to pin, without the mouse.',
        'In the panel, sort by <b>Last used</b>: the one column on the right becomes “2 days ago”.',
      ],
      mapTitle: 'Everything All does today',
      map: [
        ['Search', 'The first field; it searches plugin names too'],
        ['Where from', 'The menu next to it'],
        ['Order', 'Column headings, now any column'],
        ['Health line', 'Filters with counts, beside New, Pinned and Not used'],
        ['Groups', 'Gone: sort by From to keep each source together'],
        ['Select all, Pick unused', 'Not used lately, then Space or Shift+click'],
        ['Import', 'The end of the totals line'],
        ['Pin … Remove', 'The floating bar once something is picked'],
        ['Use, star, Chat as', 'The last column; U and P from the keyboard'],
        ['Row details', 'A side panel, or a sheet in the panel'],
        ['Parked', 'Under the table, with Restore'],
        ['150 at a time', 'Still pages'],
      ],
      tradeoff: 'It’s the most capable and the least friendly. It’s a spreadsheet, and it shows its numbers before it shows what anything is for. Plugins don’t fold away any more, so 132 skills are 132 rows unless you filter.',
    },
  });
})();
