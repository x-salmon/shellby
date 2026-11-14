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
  const WHO = { you: 'You', page: 'The page', agent: '', routine: '', terminal: 'A terminal', pc: '' };
  const AGENT_WORDS = { any: 'Any conversation', shellby: "Only Shellby's own", none: 'Nobody (read-only)' };
  // Where it goes (sync/pages.js): the page Everywhere or This PC only; its data goes with it or stays.
  const WHERE_WORDS = { everywhere: 'Everywhere', here: 'This PC only' };
  const mb = n => `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
  const kb = n => (n >= 1024 * 1024 ? mb(n) : n ? `${Math.max(1, Math.round(n / 1024))} KB` : '0 KB');

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
  const whoText = w => (w ? WHO[w.kind] || w.name || (w.kind === 'pc' ? 'Another PC' : 'Someone') : 'Someone');
  // A page from another PC you haven't looked at here (sync/pages.js): new, or a new version waiting.
  const arrived = p => (p.arrived && !p.arrived.quiet ? p.arrived : null);
  const fromName = p => p.arrived?.from?.name || p.sync?.pending?.from?.name || 'another PC';

  // ------------------------------------------------------------ the shelf
  function stateChip(p) {
    if (p.wants) return h('span', { class: 'chip amber', text: 'Wants to be added' });
    const a = arrived(p);
    if (a?.kind === 'new') return h('span', { class: 'chip amber', text: `From ${fromName(p)}` });
    if (a?.kind === 'changed') return h('span', { class: 'chip amber', text: `New version from ${fromName(p)}` });
    if (!p.enabled) return h('span', { class: 'chip', text: 'Off' });
    if (p.needsOk) return h('span', { class: 'chip amber', text: 'Needs your OK' });
    if (p.broken) return h('span', { class: 'chip danger', text: "Didn't load" });
    return null;
  }

  /** The tile's second line while something from another PC waits on it. */
  function arrivedLine(p) {
    const a = arrived(p);
    if (!a) return null;
    return a.kind === 'new' ? 'Off: look before it runs' : 'Your version still runs';
  }

  /** "2 pages came from your laptop", above the shelf, with Look at them. */
  function arrivalsNotice() {
    const came = list.filter(p => arrived(p));
    if (!came.length) return null;
    const names = [...new Set(came.map(fromName))];
    const from = names.length === 1 ? names[0] : 'your other PCs';
    const fresh = came.filter(p => p.arrived.kind === 'new').length;
    const changed = came.length - fresh;
    const rows = came.map(p => h('div', { class: 'pg-arrive-row' },
      h('span', { class: 'pg-arrive-icon', 'aria-hidden': 'true', text: p.icon || '▦' }),
      h('span', { text: `${p.name}, ${p.arrived.kind === 'new' ? 'new' : 'changed there'}` }),
      h('span', { class: 'pg-arrive-when faint small', text: SB.relTime(p.arrived.at) })));
    const line = fresh && changed ? 'The new one stays off, and the changed one keeps its old version, until you\'ve looked here.'
      : fresh ? `${fresh === 1 ? 'It stays' : 'They stay'} off until you've looked here.` : `${changed === 1 ? 'Your version keeps' : 'Your versions keep'} running until you've looked here.`;
    return h('div', { class: 'pg-card warn pg-arrive', role: 'status' },
      h('div', { class: 'pg-arrive-body' },
        h('h3', { text: `${came.length} ${came.length === 1 ? 'page' : 'pages'} came from ${from}` }),
        ...rows,
        h('p', { class: 'muted small', text: line })),
      h('div', { class: 'row wrap' }, h('button', { type: 'button', class: 'btn slim-btn', text: came.length === 1 ? 'Look at it' : 'Look at them', onclick: () => open(came[0].id) })));
  }

  function tile(p, hit) {
    const t = h('div', {
      class: `pg-tile${p.enabled && !p.wants && arrived(p)?.kind !== 'new' ? '' : ' off'}`, role: 'listitem', tabindex: '0', dataset: { id: p.id },
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
      h('div', { class: 'pg-tile-desc muted small', text: hit || arrivedLine(p) || p.description || `${p.keys.length} ${p.keys.length === 1 ? 'key' : 'keys'} of data` }),
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
    const notice = query.trim() ? null : arrivalsNotice();
    $('pgArrivals').replaceChildren(...(notice ? [notice] : []));
    $('pgArrivals').hidden = !notice;
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
      p.draft || p.wants ? null : M('Where it goes', () => whereSheet(p.id)),
      p.draft || p.wants || arrived(p)?.kind === 'new' ? null : M(p.enabled ? 'Turn off' : 'Turn on', () => api.pages.set(p.id, { enabled: !p.enabled }).then(fail).then(load)),
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
    const lost = v?.sync?.lost;
    const pend = v?.pendingVersion;
    // Changed here and on another PC: the later save won, and this PC's is kept as a version (sync/pages.js).
    const clash = lost && versions.some(x => x.n === lost.n) ? h('div', { class: 'pg-card quiet pg-clash' }, h('span', { text: pend
      ? `Changed here and on ${lost.from?.name || 'another PC'}. ${lost.from?.name || 'Its'} version was later, so it's the one waiting; the one from this PC keeps running and is kept below.`
      : `Changed here and on ${lost.from?.name || 'another PC'}. ${lost.from?.name || 'Its'} version was later, so that's the one showing. The one from this PC is kept below.` })) : null;
    const label = x => (x.n === v.version ? 'Showing now' : pend && x.n === pend.n ? 'Waiting from ' + (x.pc || 'another PC') : lost && x.n === lost.n ? 'Kept from this PC' : `Version ${x.n}`);
    return h('div', { class: 'pg-dpane' },
      h('p', { class: 'muted small', text: 'Every save of its files; data isn\'t versioned. Going back makes a new version, so nothing is lost.' }),
      clash,
      h('ol', { class: 'pg-versions' }, ...versions.map(x => h('li', { class: `${x.n === v.version ? 'now' : ''}${lost && x.n === lost.n ? ' kept' : ''}` },
        h('div', {}, h('b', { text: label(x) }), x.n === v.version ? h('span', { class: 'chip', text: 'Running' }) : null),
        h('div', { class: 'small', text: x.why || '' }),
        h('div', { class: 'faint small', text: `${x.pc || (v.sync?.on ? 'This PC' : '')}${x.pc || v.sync?.on ? ', ' : ''}${whoText(x.who)}, ${SB.relTime(x.at)}` }),
        x.n === v.version ? null
          // From another PC and not looked at here: only Turn it on (the sheet) runs it.
          : x.unseen ? h('span', { class: 'chip', text: 'Waiting for a look' })
          : h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Go back to this one', onclick: async () => { fail(await api.pages.revert(id, x.n)); await host.show(id); drawDrawer(); } })))),
      clash ? h('p', { class: 'muted small', text: 'Its data wasn\'t part of this: data merges key by key, so both PCs\' writes are here.' }) : null);
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
    const travels = v.sync?.on && v.sync.where === 'everywhere';
    const del = confirmDelete
      ? h('div', { class: 'pg-card bad' }, h('span', { class: 'pg-card-text', text: `Delete ${v.name}? Its files, data and History go too${travels ? ', here and on your other PCs' : ''}.` }),
        h('button', { type: 'button', class: 'btn danger slim-btn', text: 'Delete', onclick: async () => { const r = fail(await api.pages.remove(id)); if (r?.ok !== false) close(); } }),
        h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Keep it', onclick: () => { confirmDelete = false; drawDrawer(); } }))
      : h('button', { type: 'button', class: 'btn ghost slim-btn', text: 'Delete…', onclick: () => { confirmDelete = true; drawDrawer(); } });
    return h('div', { class: 'pg-dpane' },
      h('h4', { text: 'Who may write' }), h('p', { class: 'muted small', text: "Conversations write with write_page. Shellby's own means its tabs, helpers and routines; any adds terminals and editors." }), radio,
      notify,
      h('h4', { text: 'What it can do' }),
      v.words?.length ? h('ul', { class: 'pg-rights' }, ...v.words.map(w => h('li', { class: `pg-right ${w.kind}`, text: w.text }))) : h('p', { class: 'muted small', text: 'Nothing beyond its own data.' }),
      v.added?.web?.length ? h('p', { class: 'small', text: `Added by you: ${v.added.web.join(', ')}` }) : null,
      v.sync ? h('h4', { text: 'Where it goes' }) : null,
      v.sync ? h('p', { class: 'small', text: whereText(v.sync) }) : null,
      v.sync ? h('button', { type: 'button', class: 'btn slim-btn', text: 'Change where it goes', onclick: () => whereSheet(id) }) : null,
      h('h4', { text: 'This page' }),
      h('div', { class: 'row wrap' },
        h('button', { type: 'button', class: 'btn slim-btn', text: v.enabled ? 'Turn off' : 'Turn on', onclick: async () => { fail(await api.pages.set(id, { enabled: !v.enabled })); await host.show(id); drawDrawer(); } }),
        h('button', { type: 'button', class: 'btn slim-btn', text: v.pinned ? 'Unpin' : 'Pin', onclick: async () => { fail(await api.pages.set(id, { pinned: !v.pinned })); drawDrawer(); } }),
        del));
  }

  // ------------------------------------------------------------ where it goes
  /** "Everywhere", "Everywhere, data stays here", "This PC only" or "Too big, stays here". */
  function whereText(s) {
    if (s.where === 'here') return WHERE_WORDS.here;
    if (s.fits === false) return 'Too big, stays here';
    return s.data === 'here' ? `${WHERE_WORDS.everywhere}, data stays here` : WHERE_WORDS.everywhere;
  }

  /** The sheet: the page Everywhere / This PC only, its data Goes with it / Stays on this PC, and what it takes of the budget. */
  async function whereSheet(id) {
    const v = await api.pages.view(id).catch(() => null);
    if (!v?.sync) return;
    const sheet = $('pgWhereSheet');
    const s = v.sync;
    const opt = (group, value, current, title, sub, dim) => h('button', {
      type: 'button', class: `pg-opt${value === current ? ' on' : ''}${dim ? ' dim' : ''}`, role: 'radio', 'aria-checked': String(value === current),
      onclick: async () => { fail(await api.pages.where(id, { [group]: value })); whereSheet(id); if (openId === id) { host.refresh(); if (drawer) drawDrawer(); } else load(); },
    }, h('span', { class: 'pg-opt-radio', 'aria-hidden': 'true' }), h('b', { text: title }), h('span', { text: sub }));
    const here = s.where === 'here';
    $('pgWhereTitle').textContent = `Where ${v.name} goes`;
    $('pgWhereBody').replaceChildren(
      h('div', { class: 'pg-grp', text: 'The page' }),
      h('div', { role: 'radiogroup', 'aria-label': 'The page' },
        opt('where', 'everywhere', s.where, 'Everywhere', 'Goes to your other PCs, switched off until you look at it there.'),
        opt('where', 'here', s.where, 'This PC only', 'Stays here. Your other PCs never see it.')),
      h('div', { class: 'pg-grp', text: 'Its data' }),
      h('div', { role: 'radiogroup', 'aria-label': 'Its data' },
        opt('data', 'with', s.data, 'Goes with it', 'One set of data, merged key by key.', here),
        opt('data', 'here', s.data, 'Stays on this PC', 'Each PC keeps its own.', here)),
      h('p', { class: 'muted small pg-where-note', text: here ? 'It never leaves this PC.'
        : s.fits === false ? `Too big: it comes to ${mb(s.bytes)}, and ${mb(Math.max(0, s.budget - s.others))} of the ${mb(s.budget)} your pages share is left. It stays on this PC.`
          : s.on ? `Takes ${kb(s.bytes)} of the ${mb(s.budget)} your pages share.` : 'Pages go to your other PCs once Sync between PCs is on (Settings › Accounts) and pages are allowed to travel (Settings › Claude › Pages).' }));
    sheet.hidden = false;
  }
  const closeWhere = () => { $('pgWhereSheet').hidden = true; };
  $('pgWhereClose').addEventListener('click', closeWhere);
  $('pgWhereDone').addEventListener('click', closeWhere);
  $('pgWhereSheet').addEventListener('mousedown', e => { if (e.target === e.currentTarget) closeWhere(); });
  $('pgWhereSheet').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeWhere(); } });

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
  // On your other PCs: its own switch, the budget bar, when it last synced, and which pages travel (sync/pages.js).
  async function renderSyncSettings() {
    const box = $('pgSyncTravel');
    if (!box) return;
    const v = await api.pages.sync().catch(() => null);
    if (!v) return;
    const toggle = /** @type {HTMLInputElement} */ ($('pgSyncToggle'));
    toggle.checked = v.on;
    const live = v.on && v.able;
    $('pgSyncNote').textContent = !v.signedIn ? 'Needs Sync between PCs: sign in with GitHub in Settings › Accounts. Through the same private gist, in its own file. Each page arrives switched off.'
      : !v.able ? 'Needs Sync between PCs on, in Settings › Accounts. Through the same private gist, in its own file. Each page arrives switched off.'
        : 'Through the same private gist as Sync between PCs, in its own file. Each page arrives switched off.';
    const bar = $('pgSyncBar');
    bar.hidden = !live;
    if (live) {
      /** @type {HTMLElement} */ ($('pgSyncUsed')).style.width = `${Math.min(100, Math.round(v.used / v.budget * 100))}%`;
      $('pgSyncUsedText').textContent = `${kb(v.used)} of ${mb(v.budget)}`;
      $('pgSyncLast').textContent = v.lastSyncAt ? `Last synced ${SB.relTime(v.lastSyncAt)}` : 'Not synced yet';
    }
    const rows = v.pages.map(p => h('div', { class: 'pg-srow' },
      h('span', { class: 'pg-srow-icon', 'aria-hidden': 'true', text: p.icon || '▦' }),
      h('span', { class: 'pg-srow-name', text: p.name }),
      p.where === 'everywhere' && p.fits === false
        ? h('span', { class: 'chip amber', text: 'Too big, stays here' })
        : h('span', { class: 'pg-srow-end muted small', text: p.where === 'waiting' ? 'Not added yet' : whereText({ where: p.where, data: p.data, fits: p.fits }) })));
    box.replaceChildren(...(rows.length ? rows : [h('p', { class: 'muted small', text: 'No pages yet.' })]));
    $('pgSyncWhich').hidden = !live || !rows.length;
  }
  $('pgSyncToggle')?.addEventListener('change', async e => {
    const r = await api.setSettings({ pagesSync: /** @type {HTMLInputElement} */ (e.target).checked });
    if (r?.settings) state.settings = r.settings;
    renderSyncSettings();
  });

  // Every page's access in one list: what it can do, who may write, on or off.
  async function renderSettings() {
    const box = $('pgSetList');
    if (!box) return;
    renderSyncSettings();
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
  SB.showPageDrawer = which => { if (openId) showDrawer(which); };

  SB.views.pages = {
    render: () => { if (openId) host.show(openId); else load(); },
    refresh: () => load(),
  };
  load();
})();
