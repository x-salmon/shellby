// 1. Tidy: today's list, with the chrome taken out. One line to find things
// (search, where from, order), the health line as tinted counts, group
// headings that say what each source costs and how much of it Claude uses,
// checkboxes and Use only where your pointer or keyboard is, and the picked
// bar floating at the bottom. Wide: sources become a rail and the opened row
// a pane on the right.
(function () {
  'use strict';
  const T = window.TB;
  const { esc, tok, glyph } = T;
  const P = () => window.AK_PARTS;

  function mount(phone) {
    const ak = window.AK.create(phone);
    const { body, off } = window.AK_FRAME(phone, ak);
    body.innerHTML = `
      <div class="td">
        <nav class="td-rail" aria-label="Where they come from"></nav>
        <section class="td-main">
          <div class="td-find">
            <label class="td-search"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><input type="search" placeholder="Search" aria-label="Search skills, agents and commands"></label>
            <select class="field td-source" aria-label="Where they come from"></select>
            <select class="field td-sort" aria-label="Order">${ak.SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          </div>
          <div class="td-health" role="status"></div>
          <div class="td-cols" aria-hidden="true"><span></span><span>Name</span><span>Used lately</span><span title="What its name and description cost in every conversation">Every conversation</span><span></span></div>
          <div class="scroll td-scroll"><ul class="td-list"></ul><div class="td-parked"></div></div>
          <div class="td-batch"></div>
        </section>
        <aside class="td-insp" aria-live="polite"></aside>
      </div>`;
    const $ = s => body.querySelector(s);
    const search = $('.td-find input');
    const root = $('.td');

    function drawRail() {
      const s = ak.sources();
      const opt = ([v, name, n]) => `<option value="${v}">${esc(name)} (${n})</option>`;
      $('.td-source').innerHTML = s.main.map(opt).join('') + (s.plugins.length ? `<optgroup label="One plugin">${s.plugins.map(opt).join('')}</optgroup>` : '');
      $('.td-source').value = ak.st.source;
      $('.td-sort').value = ak.st.sort;
      const item = ([v, name, n]) => `<button type="button" data-src="${esc(v)}" aria-current="${ak.st.source === v}"><span>${esc(name)}</span><small>${n}</small></button>`;
      $('.td-rail').innerHTML = `<p class="td-rail-h">From</p>${s.main.map(item).join('')}<p class="td-rail-h">Plugins</p>${s.plugins.map(item).join('')}
        <p class="td-rail-h">Order</p>${ak.SORTS.map(([v, l]) => `<button type="button" data-sort="${v}" aria-current="${ak.st.sort === v}"><span>${l}</span></button>`).join('')}`;
    }

    function drawHealth() {
      const parts = ak.health();
      const ownShown = ak.list().filter(ak.isOwn);
      const idle = ownShown.filter(ak.isIdle);
      $('.td-health').innerHTML = parts.map(p => `<button type="button" class="hp ${p.tone}" data-only="${p.key}" aria-pressed="${ak.st.only === p.key}" title="${esc(p.title)}">${esc(p.text)}</button>`).join('')
        + (ak.st.only ? '<button type="button" class="link" data-only="">Show all</button>' : '')
        + `<span class="gap"></span>${idle.length ? `<button type="button" class="btn quiet" data-a="pick-unused" title="Your own ones Claude hasn’t reached for lately">Pick unused (${idle.length})</button>` : ''}<button type="button" class="btn quiet" data-a="import" title="Add skills, agents and commands from a Shellby tools file">Import…</button>`;
    }

    function row(t, max, grouped) {
      const open = ak.st.open === t.id;
      const pickedIt = ak.st.picked.has(t.id);
      const w = Math.max(3, Math.round((t.listTokens / max) * 100));
      return `<li class="td-row${ak.isIdle(t) ? ' idle' : ''}${open ? ' open' : ''}${pickedIt ? ' picked' : ''}" data-row="${esc(t.id)}">
        <span class="td-lead">${glyph(t.kind, 22)}${ak.isOwn(t) ? `<input type="checkbox" data-k="pick" aria-label="Pick ${esc(ak.label(t))}" ${pickedIt ? 'checked' : ''}>` : ''}</span>
        <button type="button" class="td-open" data-k="open" aria-expanded="${open}">
          <span class="td-name"><code>${esc(ak.label(t))}</code>${t.isNew ? '<span class="new">new</span>' : ''}${ak.isPinned(t) ? '<span class="pinned" title="Pinned">★</span>' : ''}${grouped ? '' : `<span class="tag">${esc(ak.sourceLabel(t.source))}</span>`}${t.hides.length ? '<span class="tag amber">hides a copy</span>' : ''}</span>
          <span class="td-desc">${t.desc ? esc(t.desc) : '<em>No description, so Claude never picks it</em>'}</span>
        </button>
        <span class="td-use">${t.uses ? `<b>${t.uses}</b><small>${t.lastUsed === 0 ? 'today' : T.ago(t.lastUsed)}</small>` : '<small>not lately</small>'}</span>
        <span class="td-cost"><b>${t.listTokens}</b><i style="--w:${w}%"></i></span>
        <span class="td-acts">${P().acts(ak, t)}</span>
        ${open ? `<div class="td-detail">${P().detail(ak, t)}</div>` : ''}
      </li>`;
    }

    function drawList() {
      const items = ak.list();
      ak.prune(items.filter(ak.isOwn));
      const max = ak.maxList();
      let html;
      if (!items.length) html = `<li class="td-empty">${ak.st.q ? `Nothing matches “${esc(ak.st.q)}”. <button type="button" class="link" data-get-more>Look in Get more</button>` : 'Nothing here.'}</li>`;
      else if (ak.isGrouped()) {
        html = ak.groups(items).map(g => {
          const own = g.src === 'user' || g.src === 'project';
          return `<li class="td-group${g.folded ? ' folded' : ''}">
            <button type="button" class="td-gh" data-src="${esc(g.src)}" aria-expanded="${!g.folded}">
              <svg class="chev" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
              <b>${esc(g.name)}</b>${g.plugin ? '<span class="tag">plugin</span>' : ''}
              <span class="td-gh-n">${g.rows.length}</span>
              <span class="td-gh-meta">${g.used ? `${g.used} used lately` : '<span class="warn">none used lately</span>'}, ${tok(g.tokens)} tokens</span>
            </button>
            ${own && !g.folded ? `<button type="button" class="link td-gh-all" data-select-group="${esc(g.src)}">Select all ${g.rows.length}</button>` : ''}
          </li>${g.folded ? '' : g.rows.map(t => row(t, max, true)).join('')}`;
        }).join('');
      } else {
        const page = items.slice(0, ak.st.shown);
        html = page.map(t => row(t, max, false)).join('')
          + (items.length > page.length ? `<li class="td-more">Showing ${page.length} of ${items.length}. <button type="button" class="btn ghost" data-more>Show all</button></li>` : '');
      }
      $('.td-list').innerHTML = html;
      $('.td-parked').innerHTML = P().parked(ak, 20);
      root.classList.toggle('picking', ak.st.picked.size > 0);
      $('.td-batch').innerHTML = P().batchBar(ak);
    }

    function drawInsp() {
      const t = ak.st.open && ak.byId(ak.st.open);
      $('.td-insp').innerHTML = t
        ? `<div class="td-insp-head">${glyph(t.kind, 34)}<div><h4><code>${esc(ak.label(t))}</code></h4><p class="muted">${esc(ak.KIND_NAMES[t.kind])}, ${esc(ak.sourceLabel(t.source))}</p></div></div>
           <p class="td-insp-desc">${t.desc ? esc(t.desc) : '<em>No description.</em>'}</p>
           <div class="td-insp-acts">${P().acts(ak, t)}</div>${P().detail(ak, t)}`
        : `<div class="td-insp-empty">${T.crab(4, '#7fd6c2')}<p>Pick a row to see where it lives, what it costs and what to do about it.</p>
           <p class="muted">${ak.list().length} shown. ${ak.list().filter(t => t.uses).length} used lately.</p></div>`;
    }

    const draw = () => P().keepFocus(body, () => { drawRail(); drawHealth(); drawList(); drawInsp(); });
    const unsub = ak.on(draw);
    draw();

    let wait;
    search.addEventListener('input', () => { clearTimeout(wait); wait = setTimeout(() => ak.set({ q: search.value }), 120); });
    $('.td-source').addEventListener('change', e => ak.set({ source: e.target.value }));
    $('.td-sort').addEventListener('change', e => ak.set({ sort: e.target.value }));
    body.addEventListener('click', e => {
      if (e.target.matches('input[data-k="pick"]')) {
        const t = ak.byId(e.target.closest('[data-row]').dataset.row);
        ak.pick(t, e.target.checked, e.shiftKey, ak.list().filter(ak.isOwn));
        return;
      }
      if (P().handle(ak, e)) return;
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.a === 'pick-unused') { ak.list().filter(t => ak.isOwn(t) && ak.isIdle(t)).forEach(t => ak.st.picked.add(t.id)); ak.set({}); }
      else if ('only' in b.dataset) b.dataset.only === 'mcp' ? ak.actions.openMcp() : ak.set({ only: ak.st.only === b.dataset.only || !b.dataset.only ? null : b.dataset.only });
      else if (b.dataset.sort) ak.set({ sort: b.dataset.sort });
      else if (b.closest('.td-rail') && b.dataset.src) ak.set({ source: b.dataset.src });
      else if (b.classList.contains('td-gh')) ak.toggleFold(b.dataset.src);
      else if (b.dataset.selectGroup) { ak.list().filter(t => t.source === b.dataset.selectGroup && ak.isOwn(t)).forEach(t => ak.st.picked.add(t.id)); ak.set({}); }
      else if (b.dataset.k === 'open') ak.toggleOpen(b.closest('[data-row]').dataset.row);
      else if ('more' in b.dataset) ak.set({ shown: Infinity });
      else if ('getMore' in b.dataset) ak.toast('Opens Get more, searching the marketplaces');
    });
    return () => { unsub(); off(); clearTimeout(wait); };
  }

  T.register({
    id: 'tidy', name: 'Tidy', line: 'Today’s list, minus the clutter', mount,
    notes: {
      pitch: [
        'The least change. It’s the list you know, in the same order with the same groups, but most of what sits around it goes. Search, where from and order share one line. The health line is three tinted counts. Each group heading says what that source costs every conversation and how much of it Claude actually uses, so “ruflo-core: none used lately, 345 tokens” reads before you open it.',
        'Rows lose their noise. Checkboxes and Use appear only on the row your pointer or keyboard is on, and pinned ones keep a star by the name. Every number lines up in two columns, uses and cost. Picking things brings up a bar at the bottom rather than pushing the list down.',
        'Wider, the sources move into a rail on the left and an opened row gets a pane on the right instead of growing in place.',
      ],
      tryIt: [
        'Open <b>anthropic-skills</b>: twenty skills, three used lately. Then point at a row in <b>Yours</b> and tick a few; <b>Shift</b> picks a range.',
        'Press <b>2 without a description</b>, pick both, then <b>Park</b>. They move to Parked at the bottom, with <b>Undo</b> in the toast.',
        'Change the order to <b>Unused first</b>. The groups give way to one list, costliest idle ones at the top.',
        'Switch to <b>Window</b> or <b>Full screen</b> and open a row: the details sit in the right pane.',
      ],
      mapTitle: 'Everything All does today',
      map: [
        ['Search', 'The first field on the find line'],
        ['Where from', 'A menu on the find line; the rail when wide'],
        ['Order', 'A menu on the find line; the rail when wide'],
        ['Health line', 'Tinted counts under it. The server one opens MCP'],
        ['Groups', 'Same order, folded plugins, now with cost and use'],
        ['Select all', 'In the Yours and This project headings'],
        ['Pick unused, Import', 'Quiet buttons at the end of the health line'],
        ['Pin … Remove', 'The floating bar once something is picked'],
        ['Use, star, Chat as', 'On the row; shown on hover and focus'],
        ['Row details', 'In place in the panel; the right pane when wide'],
        ['Parked', 'Last, under the list, with Restore'],
        ['150 at a time', 'Still pages, when it’s one long list'],
      ],
      tradeoff: 'It fixes the clutter but not the scale. 171 rows are still 171 rows, and turning off a plugin you never use still happens in Get more, not here.',
    },
  });
})();
