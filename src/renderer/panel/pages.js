/* Shellby panel — Pages: small apps built with Claude that live in Shellby
   (docs/plans/shellby-pages.md, wiring/pages.js in main).

   The shelf: every page as a tile, pinned ones first, with what changed last
   and its state (off, wants to be added, needs your OK, didn't load). Search
   finds pages by name and by what's on them. Right-click (or ⋯) for Open,
   Open beside the chat, Change with Claude, Pin, its data, History, Turn
   off and Delete. Empty, it offers starters: prompts, never files.

   One page open: pages-host.js draws it; the drawer beside it has its data
   (editable, with who wrote each key), its History (Go back to this one), its
   activity, and its settings (who may write, Tell me when it changes). */
'use strict';
(function () {
  const { h, api, state, $ } = SB;

  const STARTERS = [
    ['Print queue', "A queue for my 3D printer: what's printing, what's next and what failed, with the filament and time for each."],
    ["Agents' checklist", 'A checklist my helper crabs tick off as they go, each tick signed with who did it and when.'],
    ['Dependency radar', 'A board of outdated dependencies across my projects that a routine can fill each morning, newest first.'],
    ['Reading list', "A reading list: links and books with a note each, a done tick, and what I've read this month."],
    ['Release radar', 'Upcoming releases of the tools I use, with the date and what changed, that agents can add to.'],
    ['Gym log', 'A gym log: sets, reps and weight per exercise, with my best for each.'],
  ];
  const WHO = { you: 'You', page: 'The page', agent: '', routine: '', terminal: 'A terminal', pc: 'Another PC' };
  const AGENT_WORDS = { any: 'Any conversation', shellby: "Only Shellby's own", none: 'Nobody (read-only)' };

  /** @type {any[]} */
  let list = [];
  let on = true;
  /** @type {string | null} */
  let openId = null;
  /** @type {string | null} */
  let drawer = null;   // 'data' | 'history' | 'activity' | 'settings' | null
  let query = '';
  let confirmDelete = false;
  const dataCache = new Map(); // id -> { at, text } for search

  const host = SB.pageHost.create({
    onBack: () => close(),
    onMenu: (anchor, v) => SB.openMenu($('pagesMenu'), anchor, () => menuFor(v, true)),
    onSaved: id => { openId = id; },
  });
  $('pgOpenMain').append(host.el);

  const fail = r => { if (r?.ok === false && r.error) SB.toast(r.error); return r; };
  const whoText = w => (w ? WHO[w.kind] || w.name || 'Someone' : 'Someone');

  // ------------------------------------------------------------ the shelf
  function stateChip(p) {
    if (p.wants) return h('span', { class: 'chip amber', text: 'Wants to be added' });
    if (!p.enabled) return h('span', { class: 'chip', text: 'Off' });
    if (p.needsOk) return h('span', { class: 'chip amber', text: 'Needs your OK' });
    if (p.broken) return h('span', { class: 'chip danger', text: "Didn't load" });
    return null;
  }

  function tile(p, hit) {
    const t = h('div', {
      class: `pg-tile${p.enabled && !p.wants ? '' : ' off'}`, role: 'listitem', tabindex: '0', dataset: { id: p.id },
      'aria-label': `${p.name}${p.pinned ? ', pinned' : ''}`,
      onclick: () => open(p.id),
      onkeydown: e => { if (e.key === 'Enter') open(p.id); else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); menuAt(t, p); } },
      oncontextmenu: e => { e.preventDefault(); menuAt(t, p); },
    },
    h('div', { class: 'pg-mini', 'aria-hidden': 'true' },
      p.thumb ? h('img', { class: 'pg-thumb', src: p.thumb, alt: '' }) : h('span', { class: 'pg-mini-icon', text: p.icon || '▦' }),
      p.pinned ? h('span', { class: 'pg-pin', text: '★' }) : null),
    h('div', { class: 'pg-tile-body' },
      h('div', { class: 'pg-tile-name' }, h('b', { text: p.name }), stateChip(p)),
      h('div', { class: 'pg-tile-desc muted small', text: hit || p.description || `${p.keys.length} ${p.keys.length === 1 ? 'key' : 'keys'} of data` }),
      p.lastChange?.at ? h('div', { class: 'pg-tile-when faint small', text: `${p.lastChange.text}, ${SB.relTime(p.lastChange.at)}` }) : null),
    h('button', { type: 'button', class: 'icon-btn pg-tile-more', 'aria-label': `More for ${p.name}`, 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); menuAt(/** @type {HTMLElement} */ (e.currentTarget), p); } },
      SB.icon('M3.5 8h.01M8 8h.01M12.5 8h.01', { width: 2.4 })));
    return t;
  }

  async function dataText(p) {
    const c = dataCache.get(p.id);
    if (c && c.at === p.updatedAt) return c.text;
    const d = await api.pages.data(p.id).catch(() => null);
    const text = JSON.stringify(d?.values || {}).toLowerCase();
    dataCache.set(p.id, { at: p.updatedAt, text });
    return text;
  }

  async function matches() {
    const q = query.trim().toLowerCase();
    if (!q) return list.map(p => ({ p, hit: null }));
    const out = [];
    for (const p of list) {
      if (`${p.name} ${p.description}`.toLowerCase().includes(q)) { out.push({ p, hit: null }); continue; }
      const text = await dataText(p);
      const i = text.indexOf(q);
      if (i >= 0) out.push({ p, hit: `On it: …${text.slice(Math.max(0, i - 24), i + q.length + 32).replace(/["{}[\]]/g, ' ').replace(/\s+/g, ' ').trim()}…` });
    }
    return out;
  }

  async function renderShelf() {
    $('pgOff').hidden = on;
    $('pgNew').hidden = !on;
    $('pgSearch').hidden = !on || list.length < 2;
    $('pgCount').textContent = list.length ? `${list.length} ${list.length === 1 ? 'page' : 'pages'}` : '';
    const found = await matches();
    $('pgGrid').replaceChildren(...found.map(f => tile(f.p, f.hit)));
    $('pgGrid').hidden = !found.length;
    const empty = $('pgEmpty');
    empty.hidden = !on || list.length > 0 && found.length > 0;
    if (!empty.hidden) {
      empty.replaceChildren(list.length
        ? h('p', { class: 'muted', text: `Nothing on your pages matches "${query.trim()}".` })
        : h('div', { class: 'pg-first' },
          h('h3', { text: 'A page is a small app Claude builds for you' }),
          h('p', { class: 'muted', text: 'A print queue, a reading list, a board your helper crabs post to. It lives here, keeps its own data, and any conversation can add to it.' }),
          h('div', { class: 'pg-starters' }, ...STARTERS.slice(0, 3).map(([name, text]) => h('button', { type: 'button', class: 'pg-starter', onclick: () => newPage(text) }, h('b', { text: name }), h('span', { class: 'muted small', text })))),
          h('button', { type: 'button', class: 'btn primary', text: 'Describe your own', onclick: () => newPage('') })));
    }
  }

  // ------------------------------------------------------------ menus
  function menuAt(anchor, p) { SB.openMenu($('pagesMenu'), anchor, () => menuFor(p, false)); }

  function menuFor(p, inside) {
    const M = SB.menuItem;
    const live = p.enabled && !p.wants && !p.draft;
    return [
      inside ? null : M('Open', () => open(p.id)),
      live ? M('Open beside the chat', () => SB.tools?.openPage(p.id)) : null,
      live ? M('Change with Claude', () => api.pages.change(p.id, {}).then(fail)) : null,
      p.draft ? null : M(p.pinned ? 'Unpin' : 'Pin', () => api.pages.set(p.id, { pinned: !p.pinned }).then(fail).then(load)),
      p.draft ? null : M('Its data', () => { open(p.id); showDrawer('data'); }),
      p.draft ? null : M('History', () => { open(p.id); showDrawer('history'); }),
      p.draft ? null : M('Activity', () => { open(p.id); showDrawer('activity'); }),
      p.draft ? null : M('Settings for this page', () => { open(p.id); showDrawer('settings'); }),
      p.draft || p.wants ? null : M(p.enabled ? 'Turn off' : 'Turn on', () => api.pages.set(p.id, { enabled: !p.enabled }).then(fail).then(load)),
      M('Delete…', () => { open(p.id); confirmDelete = true; showDrawer('settings'); }, { tone: 'danger' }),
    ].filter(Boolean);
  }

  // ------------------------------------------------------------ one page
  async function open(id) {
    openId = id;
    confirmDelete = false;
    if (state.view !== 'pages') SB.setView('pages');
    $('pgShelf').hidden = true;
    $('pgOpen').hidden = false;
    await host.show(id);
    if (drawer) drawDrawer();
  }

  async function close() {
    await host.snapshot();
    openId = null;
    drawer = null;
    $('pgOpen').hidden = true;
    $('pgShelf').hidden = false;
    $('pgDrawer').hidden = true;
    load();
  }

  function showDrawer(which) {
    drawer = drawer === which && !confirmDelete ? null : which;
    drawDrawer();
  }

  async function drawDrawer() {
    const box = $('pgDrawer');
    box.hidden = !drawer || !openId;
    if (box.hidden) return;
    const tabs = [['data', 'Data'], ['history', 'History'], ['activity', 'Activity'], ['settings', 'Settings']];
    $('pgDrawerTabs').replaceChildren(...tabs.map(([k, label]) => h('button', {
      type: 'button', role: 'tab', class: 'pg-dtab', 'aria-selected': String(k === drawer), text: label, onclick: () => { drawer = k; drawDrawer(); },
    })), h('button', { type: 'button', class: 'icon-btn pg-dclose', 'aria-label': 'Close the drawer', onclick: () => { drawer = null; drawDrawer(); } }, SB.icon('M4.5 4.5l7 7M11.5 4.5l-7 7')));
    const id = openId;
    const body = $('pgDrawerBody');
    if (drawer === 'data') body.replaceChildren(await dataPane(id));
    else if (drawer === 'history') body.replaceChildren(await historyPane(id));
    else if (drawer === 'activity') body.replaceChildren(await activityPane(id));
    else body.replaceChildren(await settingsPane(id));
  }

  async function dataPane(id) {
    const d = await api.pages.data(id).catch(() => null);
    const keys = Object.keys(d?.values || {});
    const rows = keys.map(k => {
      const area = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'field area pg-json', rows: '3', spellcheck: 'false', 'aria-label': `Value of ${k}` }));
      area.value = JSON.stringify(d.values[k], null, 1);
      const by = d.by?.[k];
      return h('div', { class: 'pg-key' },
        h('div', { class: 'pg-key-head' }, h('code', { text: k }), h('span', { class: 'faint small', text: by ? `${whoText(by.who)}, ${SB.relTime(by.at)}` : '' })),
        area,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn slim-btn', text: 'Save', onclick: async () => {
            let value;
            try { value = JSON.parse(area.value); } catch { SB.toast("That isn't JSON."); return; }
            fail(await api.pages.write(id, { set: { [k]: value } }));
            drawDrawer();
          } }),
          h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Remove', onclick: async () => { fail(await api.pages.write(id, { remove: [k] })); drawDrawer(); } })));
    });
    return h('div', { class: 'pg-dpane' },
      h('p', { class: 'muted small', text: keys.length ? 'What the page, you and your agents have written. Each key says who wrote it last.' : 'Nothing here yet. The page, you and your agents write here.' }),
      ...rows);
  }

  async function historyPane(id) {
    const v = await api.pages.view(id).catch(() => null);
    const versions = v?.versions || [];
    return h('div', { class: 'pg-dpane' },
      h('p', { class: 'muted small', text: 'Every save of its files; data isn\'t versioned. Going back makes a new version, so nothing is lost.' }),
      h('ol', { class: 'pg-versions' }, ...versions.map(x => h('li', { class: x.n === v.version ? 'now' : '' },
        h('div', {}, h('b', { text: `Version ${x.n}` }), x.n === v.version ? h('span', { class: 'chip', text: 'Running' }) : null),
        h('div', { class: 'small', text: x.why || '' }),
        h('div', { class: 'faint small', text: `${whoText(x.who)}, ${SB.relTime(x.at)}` }),
        x.n === v.version ? null : h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Go back to this one', onclick: async () => { fail(await api.pages.revert(id, x.n)); await host.show(id); drawDrawer(); } })))));
  }

  async function activityPane(id) {
    const a = await api.pages.activity(id).catch(() => []);
    return h('div', { class: 'pg-dpane' },
      h('p', { class: 'muted small', text: a.length ? 'The last 200 writes to its data.' : 'No writes yet.' }),
      h('ul', { class: 'pg-activity' }, ...a.map(x => h('li', {}, h('b', { text: whoText(x.who) }), ' ', x.text, h('span', { class: 'faint small', text: ` · ${SB.relTime(x.at)}` })))));
  }

  async function settingsPane(id) {
    const v = await api.pages.view(id).catch(() => null);
    if (!v) return h('p', { class: 'muted', text: 'This page is gone.' });
    const radio = h('div', { class: 'pg-radios', role: 'radiogroup', 'aria-label': 'Who may write' }, ...Object.entries(AGENT_WORDS).map(([k, label]) => h('label', { class: 'pg-radio' },
      h('input', { type: 'radio', name: 'pgAgents', value: k, checked: v.agents === k, onchange: async () => { fail(await api.pages.agents(id, k)); drawDrawer(); } }), label)));
    const notify = v.access?.notify ? h('label', { class: 'pg-check' },
      h('input', { type: 'checkbox', checked: v.notifyOn, onchange: e => api.pages.set(id, { notifyOn: /** @type {HTMLInputElement} */ (e.target).checked }).then(fail) }), 'Tell me when it changes') : null;
    const del = confirmDelete
      ? h('div', { class: 'pg-card bad' }, h('span', { class: 'pg-card-text', text: `Delete ${v.name}? Its files, data and History go too.` }),
        h('button', { type: 'button', class: 'btn danger slim-btn', text: 'Delete', onclick: async () => { const r = fail(await api.pages.remove(id)); if (r?.ok !== false) close(); } }),
        h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Keep it', onclick: () => { confirmDelete = false; drawDrawer(); } }))
      : h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Delete…', onclick: () => { confirmDelete = true; drawDrawer(); } });
    return h('div', { class: 'pg-dpane' },
      h('h4', { text: 'Who may write' }), h('p', { class: 'muted small', text: "Conversations write with write_page. Shellby's own means its tabs, helpers and routines; any adds terminals and editors." }), radio,
      notify,
      h('h4', { text: 'What it can do' }),
      v.words?.length ? h('ul', { class: 'pg-rights' }, ...v.words.map(w => h('li', { class: `pg-right ${w.kind}`, text: w.text }))) : h('p', { class: 'muted small', text: 'Nothing beyond its own data.' }),
      v.added?.web?.length ? h('p', { class: 'small', text: `Added by you: ${v.added.web.join(', ')}` }) : null,
      h('h4', { text: 'This page' }),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', class: 'btn slim-btn', text: v.enabled ? 'Turn off' : 'Turn on', onclick: async () => { fail(await api.pages.set(id, { enabled: !v.enabled })); await host.show(id); drawDrawer(); } }),
        h('button', { type: 'button', class: 'btn slim-btn', text: v.pinned ? 'Unpin' : 'Pin', onclick: async () => { fail(await api.pages.set(id, { pinned: !v.pinned })); drawDrawer(); } }),
        del));
  }

  // ------------------------------------------------------------ new page
  function newPage(text) {
    const sheet = $('pgNewSheet');
    const box = /** @type {HTMLTextAreaElement} */ ($('pgNewText'));
    box.value = text || '';
    $('pgStarters').replaceChildren(h('span', { class: 'muted small', text: 'Or start from' }),
      ...STARTERS.map(([name, t]) => h('button', { type: 'button', class: 'chip', text: name, onclick: () => { box.value = t; box.focus(); } })));
    sheet.hidden = false;
    box.focus();
  }
  const closeNew = () => { $('pgNewSheet').hidden = true; };
  async function build() {
    const text = /** @type {HTMLTextAreaElement} */ ($('pgNewText')).value.trim();
    if (!text) { SB.toast('Say what the page is for.'); return; }
    const r = fail(await api.pages.build(text));
    if (r?.ok === false) return;
    closeNew();
    SB.setView('chat');
  }
  $('pgNew').addEventListener('click', () => newPage(''));
  $('pgNewClose').addEventListener('click', closeNew);
  $('pgBuild').addEventListener('click', build);
  $('pgNewText').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); build(); }
    if (e.key === 'Escape') { e.preventDefault(); closeNew(); }
  });
  $('pgNewSheet').addEventListener('mousedown', e => { if (e.target === e.currentTarget) closeNew(); });

  let searchTimer = 0;
  $('pgSearch').addEventListener('input', e => {
    query = /** @type {HTMLInputElement} */ (e.target).value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderShelf, 120);
  });

  // ------------------------------------------------------------ keeping up
  async function load() {
    const r = await api.pages.list().catch(() => null);
    on = !!r?.on;
    list = r?.pages || [];
    state.pages = list;
    SB.refreshTabList?.(); // its Pinned pages row (tab-overview.js)
    if (!openId) renderShelf();
  }

  api.pages.onChanged(ev => {
    if (state.view === 'settings' && ev?.kind !== 'data') renderSettings();
    if (ev?.kind === 'data' || ev?.kind === 'refused' || ev?.kind === 'ask') {
      if (openId === ev.id && drawer && ev.kind === 'data') drawDrawer();
      return; // the frames have it (pages-bridge.js)
    }
    if (ev?.kind === 'saved' && openId === ev.draft) openId = ev.id;
    if (ev?.kind === 'removed' && openId === ev.id) close();
    if (state.view === 'pages') {
      if (openId && (ev?.id === openId || ev?.id === null)) { host.refresh(); if (drawer) drawDrawer(); } else load();
    } else load();
  });

  // ------------------------------------------------------------ Settings › Pages
  // Every page's access in one list: what it can do, who may write, on or off.
  async function renderSettings() {
    const box = $('pgSetList');
    if (!box) return;
    const r = await api.pages.list().catch(() => null);
    const pages = r?.pages || [];
    if (!pages.length) { box.replaceChildren(h('li', { class: 'muted small', text: 'No pages yet.' })); return; }
    const views = await Promise.all(pages.map(p => api.pages.view(p.id).catch(() => null)));
    box.replaceChildren(...views.filter(Boolean).map(v => h('li', { class: 'pg-set-row' },
      h('div', { class: 'pg-set-name' }, h('span', { text: v.icon || '▦', 'aria-hidden': 'true' }), h('b', { text: v.name }), stateChip(v)),
      h('div', { class: 'small muted', text: [
        v.words.length ? v.words.map(w => w.text).join('; ') : 'Nothing beyond its own data',
        v.added?.web?.length ? `added by you: ${v.added.web.join(', ')}` : '',
        `agents: ${AGENT_WORDS[v.agents] || 'any'}`,
      ].filter(Boolean).join(' · ') }),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Open', onclick: () => open(v.id) }),
        v.wants ? null : h('button', { type: 'button', class: 'btn ghost slim-btn', text: v.enabled ? 'Turn off' : 'Turn on', onclick: async () => { fail(await api.pages.set(v.id, { enabled: !v.enabled })); renderSettings(); } })))));
  }
  $('pgSetOpen')?.addEventListener('click', () => SB.setView('pages'));
  $('pgSetOff')?.addEventListener('click', async () => { fail(await api.pages.offAll()); SB.toast('Every page is off. Turn one back on from its page.'); renderSettings(); });
  SB.renderPagesSettings = renderSettings;
  SB.onSettingsOpen?.(renderSettings);

  /** Open a page by id (Ctrl+K, a link, a notification). */
  SB.openPage = id => open(id);
  SB.newPage = text => newPage(text || '');

  SB.views.pages = {
    render: () => { if (openId) host.show(openId); else load(); },
    refresh: () => load(),
  };
  load();
})();
