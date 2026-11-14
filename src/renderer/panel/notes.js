/* Shellby panel — Notes: things you'd like to do, per project plus a General
   list, each one a click away from Plan, Build or Ask (see src/main/notes.js).
   The list on the left groups what Claude answered, what's under way and what
   hasn't started; the note you pick opens beside it (notes-detail.js) with
   Claude's answer and its next step. A narrow panel shows one at a time.
   Ticked-off notes fold away under "Done"; a long list gets a find box. A
   project's open notes show in its Next up too (backlog.js). */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const L = window.ShellbyNotesLogic;
  const GENERAL = 'general';
  const FILTER_FROM = 10;  // notes in a list before the find box shows
  // The list and the open note side by side from here up; notes.css has the same width.
  const WIDE = window.matchMedia('(min-width: 820px)');
  const input = /** @type {HTMLTextAreaElement} */ ($('noteInput'));
  const filterBox = /** @type {HTMLInputElement} */ ($('notesFilter'));
  /** @type {string | null} */
  let scope = null;        // the list on show: GENERAL or a project key (null until first render)
  let editing = null;      // id of the note being edited
  let doneOpen = false;    // the Done fold, open or shut
  let filter = '';
  let show = 'open';       // the chip picked over the list (notes-logic.js chips)
  let reading = false;     // a narrow panel showing the open note instead of the list
  let order = [];          // ids in the order the list shows them, for J/K
  const picked = new Map(); // list -> id of the note open beside it

  const RUN = {
    plan: { label: 'Plan', done: 'Planned' },
    build: { label: 'Build', done: 'Built' },
    ask: { label: 'Ask', done: 'Asked' },
  };

  const view = () => state.notes;
  const project = () => view()?.projects.find(p => p.key === scope) || null;
  const listNow = () => (scope === GENERAL ? view()?.general : project()?.notes) || [];
  const listName = () => (scope === GENERAL ? 'General' : project()?.name || 'this project');
  const current = () => listNow().find(n => n.id === picked.get(scope)) || null;

  // Opens on the project you're working in, or General when you aren't in one.
  function pickScope() {
    const v = view();
    if (scope === GENERAL || v.projects.some(p => p.key === scope)) return;
    scope = v.current || GENERAL;
  }

  function apply(r) {
    if (r?.view) state.notes = r.view;
    else if (r && !('ok' in r)) state.notes = r;
    if (r?.ok === false) SB.toast(r.error || "Couldn't do that.");
    render();
  }

  function renderScope() {
    const v = view();
    const count = n => (n.length ? ` (${n.filter(x => !x.done).length})` : '');
    $('notesScope').replaceChildren(
      h('option', { value: GENERAL, text: `General${count(v.general)}` }),
      ...v.projects.map(p => h('option', { value: p.key, text: `${p.name}${p.key === v.current ? ' · here' : ''}${count(p.notes)}` })));
    /** @type {HTMLSelectElement} */ ($('notesScope')).value = scope || GENERAL;
    $('notesWhere').textContent = scope === GENERAL
      ? "General notes run where you pick when you start one."
      : `Runs in ${SB.tildify(project()?.root || '')}`;
  }

  function render() {
    if (!view()) { api.listNotes().then(v => { state.notes = v; render(); }); return; }
    pickScope();
    renderScope();
    const notes = listNow();
    filterBox.hidden = notes.length <= FILTER_FROM;
    if (filterBox.hidden) { filter = ''; filterBox.value = ''; }
    const want = filter.trim().toLowerCase();
    const matching = want ? notes.filter(n => n.text.toLowerCase().includes(want)) : notes;
    const chips = L.chips(matching);
    if (!chips.some(c => c.key === show)) show = 'open';
    const groups = show === 'open' ? L.grouped(matching) : [{ key: show, label: '', notes: L.shown(matching, show) }];
    const done = matching.filter(n => n.done);
    const doneShown = doneOpen || !!want;
    order = [...groups.flatMap(g => g.notes), ...(doneShown ? done : [])].map(n => n.id);
    pickOpen(notes);
    const kept = focusNow();
    renderChips(chips);
    renderList(notes, groups, want);
    renderDone(done, want, doneShown);
    renderDetail(notes);
    refocus(kept);
  }

  // Every render redraws the list and the open note, which would drop the
  // keyboard back to the top of the page. What had it is found again by its
  // data-focus (and its note, in the list); a row that left the list hands it
  // to the open note's row.
  function focusNow() {
    const el = /** @type {HTMLElement | null} */ (document.activeElement?.closest?.('#notesView [data-focus]') || null);
    if (!el) return null;
    return { focus: el.dataset.focus, id: /** @type {HTMLElement | null} */ (el.closest('[data-note-id]'))?.dataset.noteId || null, inDetail: !!el.closest('#noteDetail') };
  }

  function refocus(kept) {
    if (!kept || (document.activeElement && document.activeElement !== document.body)) return;
    const inRow = id => document.querySelector(`#notesSplit [data-note-id="${CSS.escape(id)}"] [data-focus="${kept.focus}"]`);
    const el = kept.inDetail
      ? $('noteDetail').querySelector(`[data-focus="${kept.focus}"]`)
      : (kept.id && inRow(kept.id)) || (picked.get(scope) && document.querySelector(`#notesSplit [data-note-id="${CSS.escape(picked.get(scope))}"] .note-open`));
    /** @type {HTMLElement | null} */ (el)?.focus({ preventScroll: true });
  }

  // Which note is open: the one you picked while it's still there; on a wide
  // panel, else the first one listed. A narrow one opens a note only when you pick it.
  function pickOpen(notes) {
    const id = picked.get(scope);
    if (notes.some(n => n.id === id) && (order.includes(id) || !WIDE.matches)) return;
    const first = WIDE.matches ? order[0] : null;
    if (first) picked.set(scope, first); else picked.delete(scope);
    if (!first) reading = false;
  }

  function renderChips(chips) {
    const box = $('notesChips');
    box.hidden = chips.length < 2;
    box.replaceChildren(...chips.map(c => h('button', {
      class: `notes-chip${c.key === show ? ' on' : ''}`, type: 'button', 'aria-pressed': String(c.key === show),
      onclick: () => { show = c.key; render(); },
    }, c.label, h('span', { class: 'notes-chip-n', text: String(c.count) }))));
  }

  function renderList(notes, groups, want) {
    const list = $('noteList');
    if (!notes.length) {
      list.replaceChildren(scope === GENERAL
        ? empty('Nothing here yet', "Jot down an idea that isn't tied to one project.")
        : empty(`Nothing noted for ${listName()} yet`, 'What would you like to do here?'));
      return;
    }
    if (!groups.some(g => g.notes.length)) {
      list.replaceChildren(want
        ? empty('No note matches that', 'Try fewer words, or clear the search.')
        : empty('All done here', 'Nice. Ticked-off notes wait under Done.'));
      return;
    }
    // Headings only when there's more than one kind of note to tell apart.
    const heads = groups.length > 1;
    list.replaceChildren(...groups.flatMap(g => [
      heads ? h('li', { class: 'note-group', role: 'presentation', text: g.label }) : null,
      ...g.notes.map(row),
    ]).filter(Boolean));
  }

  function empty(title, hint) {
    return h('li', { class: 'note-empty' },
      h('p', { class: 'note-empty-title', text: title }),
      h('p', { class: 'note-empty-hint', text: hint }));
  }

  function renderDone(done, searching, isOpen) {
    const box = $('notesDone');
    box.hidden = !done.length;
    if (!done.length) return box.replaceChildren();
    box.replaceChildren(
      h('div', { class: 'notes-done-head' },
        h('button', { class: 'link-btn notes-done-toggle', type: 'button', 'aria-expanded': String(isOpen),
          onclick: () => { doneOpen = !doneOpen; render(); } }, `${isOpen ? '▾' : '▸'} Done · ${done.length}`),
        // Not while finding: the list on show is only the matches, and Clear takes every done note.
        searching ? null : h('button', { class: 'link-btn notes-clear', type: 'button', title: 'Clear every ticked-off note from this list', onclick: clearDone }, 'Clear')),
      // replaceChildren writes a null as the text "null", so a shut fold adds nothing.
      ...(isOpen ? [h('ul', { class: 'note-list' }, ...done.map(row))] : []));
  }

  function row(n) {
    const on = n.id === picked.get(scope);
    return h('li', { class: `note${n.done ? ' done' : ''}${n.pinned && !n.done ? ' pinned' : ''}${on ? ' on' : ''}`, 'data-note-id': n.id },
      h('input', { type: 'checkbox', class: 'note-check', 'data-focus': 'check', checked: n.done, 'aria-label': n.done ? 'Not done yet' : 'Done',
        title: n.done ? 'Mark as not done' : 'Mark as done', onchange: e => setDone(n, e.target.checked) }),
      h('button', { class: 'note-open', type: 'button', 'data-focus': 'open', 'aria-current': on ? 'true' : null, onclick: () => open(n.id) },
        h('span', { class: 'note-text', text: n.text }),
        meta(n)));
  }

  function meta(n) {
    const last = n.runs?.[0];
    const verdict = L.lastAnswer(n)?.verdict;
    return h('span', { class: 'note-meta' },
      n.pinned && !n.done ? h('span', { class: 'note-tag note-pin', text: 'Pinned' }) : null,
      n.from === 'claude' ? h('span', { class: 'note-tag note-from', title: 'Claude noted this in a conversation. Plan, Build and Ask open it as a draft for you to read first', text: 'From Claude' }) : null,
      verdict ? h('span', { class: `note-tag note-verdict v-${verdict}`, title: 'What Claude said when you asked', text: L.VERDICT[verdict] }) : null,
      h('span', { class: last ? 'note-last' : null, text: last ? `${RUN[last.kind].done} ${SB.relTime(last.at)}` : `added ${SB.relTime(n.createdAt)}` }));
  }

  function renderDetail(notes) {
    const el = $('noteDetail');
    const n = current();
    const narrow = !WIDE.matches;
    $('notesSplit').classList.toggle('reading', narrow && reading && !!n);
    if (!n) {
      return SB.noteDetail.empty(el, notes.length
        ? 'Pick a note to see what Claude said about it, and what to do next.'
        : "Things you'd like to do. When you're ready, have Claude plan one, build it, or tell you whether it's worth doing.");
    }
    SB.noteDetail.render(el, n, {
      narrow,
      editing: editing === n.id,
      editor: () => editor(n),
      onBack: () => { reading = false; render(); focusRow(n.id); },
      onEdit: () => startEdit(n.id),
      onRun: (a, anchor) => run(n, a.kind, anchor, a.version),
      onDone: done => setDone(n, done),
      onPin: () => setPinned(n, !n.pinned),
      onMenu: anchor => openMenu(n, anchor),
      onOpenRun: openRun,
    });
  }

  // A note picked in the list opens beside it (a narrow panel swaps to it).
  // The list redraws, so the keyboard stays on the row it was on.
  function open(id) {
    const inList = !!document.activeElement?.closest('#noteList, #notesDone');
    picked.set(scope, id);
    editing = null;
    reading = true;
    render();
    if (!WIDE.matches) $('noteDetail').querySelector('.nd-text')?.focus();
    else if (inList) focusRow(id);
  }

  const focusRow = id => /** @type {HTMLElement | null} */ (document.querySelector(`#notesSplit [data-note-id="${CSS.escape(id)}"] .note-open`))?.focus();

  const openRun = r => SB.openHistory(r.tabId).then(() => SB.setView('chat'));

  // ------------------------------------------------------------ editing

  function editor(n) {
    const area = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'field area note-edit', rows: '3', maxlength: '2000', 'aria-label': 'Edit note' }));
    area.value = n.text;
    const save = async () => {
      if (editing !== n.id) return;
      editing = null;
      if (area.value.trim() && area.value !== n.text) apply(await api.updateNote({ scope, id: n.id, text: area.value }));
      else render();
    };
    area.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
      // Esc cancels the edit rather than leaving the screen.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = null; render(); }
    });
    area.addEventListener('blur', save);
    requestAnimationFrame(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); });
    return area;
  }

  function startEdit(id) { editing = id; render(); }

  // Ticking off the open note opens the next one down, as a mail app does.
  async function setDone(n, done) {
    const from = scope;
    const moveOn = done && picked.get(from) === n.id;
    const next = moveOn ? L.neighbour(order.filter(id => id === n.id || listNow().some(x => x.id === id && !x.done)), n.id) : null;
    const r = await api.updateNote({ scope: from, id: n.id, done });
    // Only once it's saved: a refusal leaves the note open where it was.
    if (moveOn && r && r.ok !== false) { if (next) picked.set(from, next); else picked.delete(from); }
    apply(r);
    if (done && r?.ok !== false) SB.toast('Done.', { action: 'Undo', onAction: () => setDone(n, false) });
  }

  async function setPinned(n, pinned) {
    apply(await api.updateNote({ scope, id: n.id, pinned }));
  }

  // ------------------------------------------------------------ run, move, delete

  // A General note isn't tied to a folder, so it asks where to run first.
  function run(n, kind, anchor, version) {
    if (scope !== GENERAL) return start(n, kind, null, version);
    const v = view();
    const here = v.projects.find(p => p.key === v.current);
    SB.openMenu($('noteMenu'), anchor, () => [
      h('div', { class: 'menu-label', text: `${RUN[kind].label} it in` }),
      SB.menuItem(here ? `${here.name} (where you're working)` : "Where you're working", SB.tildify(v.cwd), () => start(n, kind, 'here', version)),
      ...v.projects.filter(p => p.key !== v.current).map(p => SB.menuItem(p.name, SB.tildify(p.root), () => start(n, kind, p.key, version))),
    ]);
  }

  async function start(n, kind, where, version) {
    const r = await api.runNote({ scope, id: n.id, kind, ...(where ? { where } : {}), ...(version ? { version } : {}) });
    if (r?.needsClaude) return SB.claudeUpsell('notes');
    if (!r?.ok) return SB.toast(r?.error || "Couldn't start that.");
    state.notes = r.view;
    SB.setView('chat');
    if (version === 'claude') SB.toast("Claude's version is in the box. Read it, then send.");
    else if (r.draft) SB.toast('Claude wrote this note. Read it in the box, then send.');
  }

  function openMenu(n, anchor) {
    const others = [
      scope !== GENERAL && { key: GENERAL, name: 'General' },
      ...view().projects.filter(p => p.key !== scope).map(p => ({ key: p.key, name: p.name })),
    ].filter(Boolean);
    SB.openMenu($('noteMenu'), anchor, () => [
      others.length ? h('div', { class: 'menu-label', text: 'Move to' }) : null,
      ...others.map(o => SB.menuItem(o.name, async () => {
        const r = await api.moveNote({ from: scope, id: n.id, to: o.key });
        apply(r);
        if (r?.ok) SB.toast(`Moved to ${o.name}`, { action: 'Show', onAction: () => { scope = o.key; picked.set(o.key, n.id); render(); } });
      })),
      others.length ? h('div', { class: 'menu-sep' }) : null,
      SB.menuItem('Delete', null, () => remove(n), { tone: 'danger-hover' }),
    ]);
  }

  // Delete and Clear done both say what went, with an Undo that puts it back where it was.
  async function remove(n) {
    const from = scope;
    const r = await api.deleteNote({ scope: from, id: n.id });
    apply(r);
    if (r?.removed?.length) SB.toast('Note deleted.', { action: 'Undo', onAction: () => restore(from, r.removed) });
  }

  async function clearDone() {
    const from = scope;
    const r = await api.clearDoneNotes({ scope: from });
    apply(r);
    const n = r?.removed?.length || 0;
    if (n) SB.toast(`Cleared ${n} done ${n === 1 ? 'note' : 'notes'}.`, { action: 'Undo', onAction: () => restore(from, r.removed) });
  }

  async function restore(from, removed) {
    apply(await api.restoreNotes({ scope: from, removed }));
  }

  // ------------------------------------------------------------ adding

  // A new note opens beside the list, ready for Ask, Plan or Build.
  async function addNote() {
    const text = input.value;
    if (!text.trim()) return input.focus();
    const r = await api.addNote({ scope, text });
    if (!r?.ok) return SB.toast(r?.error || "Couldn't save that.");
    input.value = '';
    if (r.note?.id && WIDE.matches) { picked.set(scope, r.note.id); show = 'open'; }
    apply(r);
    input.focus();
  }

  // ------------------------------------------------------------ keys

  // J and K walk the list; P, B and A run the open note (P plans it as written:
  // Claude's version is its own button); X ticks it off; E edits it. Those act
  // only on a note you can see, so not from a narrow panel's list. Never while
  // you're typing, a menu is open, or a sheet covers the page.
  const typing = el => !!el?.closest?.('textarea, input, select, [contenteditable="true"]');
  const RUN_KEYS = { p: 'plan', b: 'build', a: 'ask' };

  function step(by) {
    if (!order.length) return;
    const i = order.indexOf(picked.get(scope));
    const id = order[Math.min(Math.max(i < 0 ? 0 : i + by, 0), order.length - 1)];
    picked.set(scope, id);
    editing = null;
    render();
    if (WIDE.matches) focusRow(id);
  }

  function onKey(e) {
    if (state.view !== 'notes' || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
    if (document.querySelector('.popover:not([hidden]), .card-sheet:not([hidden])')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const n = current();
    const seen = n && (WIDE.matches || reading) ? n : null;
    if (k === 'Escape' && reading && !WIDE.matches && n) { reading = false; render(); focusRow(n.id); }
    else if (k === 'j' || k === 'k') step(k === 'j' ? 1 : -1);
    else if (!seen) return;
    else if (k === 'e') startEdit(seen.id);
    else if (k === 'x') setDone(seen, !seen.done);
    else if (RUN_KEYS[k]) /** @type {HTMLElement | null} */ ($('noteDetail').querySelector(`.note-run[data-focus="${RUN_KEYS[k]}"]`))?.click();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  // Capture, so Esc on a narrow panel goes back to the list before it leaves the screen.
  document.addEventListener('keydown', onKey, true);

  $('noteAdd').addEventListener('submit', e => { e.preventDefault(); addNote(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); }
  });
  $('notesScope').addEventListener('change', e => { scope = /** @type {HTMLSelectElement} */ (e.target).value; editing = null; filter = ''; filterBox.value = ''; reading = false; render(); });
  filterBox.addEventListener('input', () => { filter = filterBox.value; render(); });
  // Growing or shrinking past the breakpoint swaps between one pane and two.
  WIDE.addEventListener('change', () => { if (state.view === 'notes') render(); });

  /** Notes, on one list (Next up's "Open in Notes"). */
  SB.openNotes = key => { scope = key; editing = null; filter = ''; filterBox.value = ''; reading = false; SB.setView('notes'); };

  // Fresh each visit: the folder you're working in may have changed.
  // refresh: a push from main. It waits while you're editing a note, so typing isn't lost.
  SB.views.notes = {
    render: () => api.listNotes().then(v => { state.notes = v; render(); }),
    refresh: () => { if (!editing) render(); },
  };
})();
