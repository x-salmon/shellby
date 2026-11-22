/* Shellby panel — conversations side by side, and in windows of their own.
   The chat view shows the panes in state.grid (shared/panes.js decides the
   shapes: up to four columns of up to three). Each pane is a group of tabs:
   a header that is its own tab strip (tab-strip.js draws the tabs; its
   buttons, tray and lane are pane-head.js), the feed of the tab it shows,
   and a slot for the box. With one pane the header hides and the top strip
   holds every conversation, as it always has. The box belongs to the focused
   pane: the one holding state.activeTab. A conversation dropped on a pane,
   split off, moved by key or left behind by a closing pane is pane-moves.js;
   room for the panes, and growing the panel to make it, is pane-room.js. A
   tab dragged out of the window (tab-strip.js) or sent out with its button
   gets a window of its own (main's wiring/popouts.js). tabs.js owns the tabs. */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const P = SB.panes;
  const input = $('input');
  const PLACEHOLDER = input.placeholder;

  // On screen: the tab a pane shows.
  SB.isShown = tabId => P.shownTabs(state.grid).includes(tabId);
  // The pane holding the conversation the box talks to.
  const focusedPane = () => P.paneWith(state.grid, state.activeTab)?.id ?? null;
  SB.focusedPane = focusedPane;
  // Where a tab that turns up goes: the focused pane, or, with the focused tab
  // just taken away under the panes (a folder change, tab-chips.js; a History
  // delete, history.js), the pane that held it, so its replacement opens there.
  // A redraw can come before the replacement does (main's tab list, a busy
  // tab), and take the tab that went out of that pane, so it's remembered.
  let lastFocused = null;
  const homePane = () => focusedPane() ?? (P.byId(state.grid, lastFocused) ? lastFocused : null);
  const activeOf = paneId => P.byId(state.grid, paneId)?.active ?? null;
  // What a pane shows: a conversation's feed, or a tool (tool-tabs.js).
  const shownEl = id => state.tabs.get(id)?.el || (P.isTool(id) ? SB.tools.elOf(id) : null);

  // ------------------------------------------------------------ panes

  const panes = new Map();   // paneId -> { el, head, strip, slot }, for the panes on screen
  let shape = '';            // P.layoutKey of the grid the pane elements were last put together for
  const box = $('composer');
  const home = $('chatView');

  const paneRow = () => $('feeds').querySelector(':scope > .pane-row') || $('feeds').appendChild(h('div', { class: 'pane-row' }));
  SB.paneStripOf = id => panes.get(id)?.strip || null;
  SB.paneEls = panes; // read by pane-layouts.js

  // A pane's element: its header (its strip), the feed of the tab it shows,
  // and the slot under it for the box. Another tab's feed left in it goes
  // back to waiting, hidden, in #feeds.
  function paneOf(pane) {
    let p = panes.get(pane.id);
    if (!p) {
      const { head, strip } = SB.paneHead(pane.id); // its buttons and lane (pane-head.js)
      const slot = h('div', { class: 'pane-slot' });
      // Shows while you're scrolled up from the end of its feed; a dot on it says more came in.
      const jump = h('button', { class: 'pane-jump', type: 'button', hidden: true, title: 'Jump to the latest', 'aria-label': 'Jump to the latest',
        onclick: () => { const t = state.tabs.get(p.el.dataset.tab); if (t) { t.el.scrollTo({ top: t.el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); t.stuck = true; t.unseen = false; SB.refreshJump(t); } } }, '↓');
      p = { el: h('div', { class: 'pane', dataset: { pane: pane.id, tab: pane.active } }, head, jump, slot), head, strip, slot, jump };
      panes.set(pane.id, p);
    }
    const t = state.tabs.get(pane.active);
    const shown = shownEl(pane.active);
    for (const el of [...p.el.children]) if (el !== p.head && el !== p.slot && el !== p.jump && el !== shown) { el.hidden = true; $('feeds').append(el); }
    if (shown && shown.parentElement !== p.el) p.el.insertBefore(shown, p.jump);
    if (shown && !t) shown.hidden = false;
    p.el.dataset.tab = pane.active;
    p.el.classList.toggle('tool', P.isTool(pane.active));
    if (t) SB.refreshJump(t);
    return p;
  }

  // The pane showing `t` puts its ↓ up while `t` is scrolled away from the end.
  SB.refreshJump = (t) => {
    for (const p of panes.values()) {
      if (p.el.dataset.tab !== t.id) continue;
      p.jump.hidden = t.stuck;
      p.jump.classList.toggle('fresh', !t.stuck && t.unseen);
    }
  };

  // A pane leaves the screen. Its feed goes back to waiting, hidden, in #feeds.
  function dropPane(id) {
    const p = panes.get(id);
    if (!p) return;
    if (p.slot.contains(box)) home.append(box);
    for (const el of [...p.el.children]) if (el !== p.head && el !== p.slot && el !== p.jump) { el.hidden = true; $('feeds').append(el); }
    p.el.remove();
    panes.delete(id);
  }

  // Every open conversation in exactly one pane: one closed leaves its pane,
  // and one that turned up (a new tab, one back from its own window, one main
  // opened) joins the focused pane. One pane holds them in the strip's own
  // order, as main keeps it; a split closing down to one keeps the order its
  // pane was left in, and main is told it at once. -> whether the panes, or a
  // pane's shown tab, changed.
  // paneCount: panes at the last settle, to see a split close down to one. Any
  // settle call site (renderTabStrip, nextShown, ...) may be the one that sees
  // it and sends the collapse layout, so no caller can assume it was its own.
  let paneCount = 1;
  SB.settlePanes = () => {
    const open = [...state.tabs.keys()];
    let next = P.settle(state.grid, open, homePane());
    const n = P.count(next);
    const closedDown = paneCount > 1 && n === 1;
    paneCount = n;
    if (closedDown && P.tabIds(next).length) SB.orderTabs(P.tabIds(next));
    else next = P.follow(next, open);
    const changed = P.layoutKey(next) !== P.layoutKey(state.grid);
    state.grid = next;
    if (closedDown) SB.savePanes({ now: true });
    return changed;
  };

  // `tabId` shows in its pane, which takes the focus; one in no pane yet joins
  // the focused pane (homePane), after the tab it shows. tabs.js calls this as
  // it activates a tab, before state.activeTab changes.
  SB.showInPane = (tabId) => {
    state.grid = P.show(state.grid, tabId, homePane());
  };

  // Lays out the panes. Their strips are drawn by tab-strip.js (renderTabStrip
  // follows every call to this that changes them).
  SB.renderPanes = () => {
    SB.settlePanes();
    lastFocused = focusedPane() ?? lastFocused;
    state.paneSizes = P.fitSizes(state.grid, state.paneSizes);
    const live = new Set(P.paneIds(state.grid));
    const shown = new Set(P.shownTabs(state.grid));
    $('feeds').dataset.panes = live.size;
    document.body.classList.toggle('panes-split', live.size > 1);
    for (const id of [...panes.keys()]) if (!live.has(id)) dropPane(id);
    SB.tools?.prune(P.toolIds(state.grid)); // a tool gone by any way (a layout, a merge) stops
    for (const t of state.tabs.values()) if (!shown.has(t.id)) t.el.hidden = true;
    const next = P.layoutKey(state.grid);
    // A tab made anew under an id already on screen (the screenshot demo) has a feed no pane holds yet.
    const loose = state.grid.flat().some(p => shownEl(p.active)?.parentElement !== panes.get(p.id)?.el);
    if (next !== shape || loose) {
      shape = next;
      // Moving a feed in the page loses its scroll; put each back after.
      const kept = new Map();
      for (const id of shown) {
        const t = state.tabs.get(id);
        if (t && !t.el.hidden && t.el.isConnected) kept.set(id, t.stuck ? null : t.el.scrollTop);
      }
      const hadFocus = document.activeElement === input;
      const nodes = [];
      state.grid.forEach((col, c) => {
        if (c) nodes.push(divider('w', c - 1));
        const colEl = h('div', { class: 'pane-col', dataset: { col: c } });
        col.forEach((pane, r) => {
          if (r) colEl.append(divider('h', c, r - 1));
          colEl.append(paneOf(pane).el);
        });
        nodes.push(colEl);
      });
      paneRow().replaceChildren(...nodes);
      for (const id of shown) { const t = state.tabs.get(id); if (t) t.el.hidden = false; }
      requestAnimationFrame(() => {
        for (const id of shown) {
          const t = state.tabs.get(id);
          if (!t) continue;
          const top = kept.get(id);
          if (top == null) t.scrollToEnd(); // a hidden feed comes back showing the latest
          else t.el.scrollTop = top;
        }
      });
      if (hadFocus) input.focus();
    }
    applySizes();
    placeBox();
    SB.refreshPaneHeads();
    SB.savePanes();
  };

  // Shares, not raw weights: a flex-grow sum under 1 leaves part of the row empty.
  function applySizes() {
    const { cols, rows } = P.shares(state.grid, state.paneSizes);
    for (const col of paneRow().querySelectorAll(':scope > .pane-col')) {
      const c = +col.dataset.col;
      col.style.flexGrow = cols[c] ?? 1;
      (state.grid[c] || []).forEach((pane, r) => { const p = panes.get(pane.id); if (p) p.el.style.flexGrow = rows[c]?.[r] ?? 1; });
    }
  }
  SB.applyPaneSizes = applySizes;

  // The layout, for the next start: a moment after it settles, only while
  // split (main keeps a popped-out window's order, and not its split). Back to one pane it goes once more,
  // at once (now) when a split closes down: main stores no layout for one
  // pane, so one pane writes nothing and starts as it always has, but takes
  // that pane's order (ipc/tabs.js panes:layout).
  /** @type {number | null} */
  let saveTimer = null;
  SB.savePanes = ({ now = false } = {}) => {
    const split = P.count(state.grid) > 1;
    if (!split && !state.panesSaved && !now) return;
    if (saveTimer) clearTimeout(saveTimer);
    const send = () => {
      state.panesSaved = split;
      api.savePaneLayout({ grid: state.grid, sizes: state.paneSizes });
    };
    if (now) send(); else saveTimer = setTimeout(send, 500);
  };

  // While there's more than one pane the box lives in the focused one, and the
  // others show their own draft in its place: a stand-in that hands the box
  // over on a click or a key. With one pane it sits where it always has.
  function placeBox() {
    const split = panes.size > 1;
    const into = split ? panes.get(focusedPane())?.slot : null;
    if (box.parentElement !== (into || home)) {
      const hadFocus = document.activeElement === input;
      SB.hideSlash?.(); // slash-menu.js and composer.js load after this file
      SB.hidePick?.();
      if (into) into.replaceChildren(box); else home.append(box);
      if (hadFocus) input.focus();
    }
    for (const [id, p] of panes) {
      if (p.slot === into) continue;
      if (!split || P.isTool(activeOf(id))) p.slot.replaceChildren(); // a tool has no conversation to type to
      else if (!p.slot.querySelector('.pane-standin')) p.slot.replaceChildren(standIn(id));
    }
  }

  // Its name for a screen reader is what it shows: the draft, the mark and the
  // queue. The title says what it's for. It speaks for whichever tab its pane shows.
  function standIn(paneId) {
    return h('button', {
      class: 'pane-standin', type: 'button', dataset: { pane: paneId },
      title: 'Type here to give this conversation a task',
      // The #feeds pointerdown below hands this pane the box and focuses it;
      // the press that follows would land on whatever is under the pointer once
      // the box has moved, and take the focus off it. Cancelling the pointerdown
      // keeps that press from happening, and with it the press that closes an
      // open menu (core.js), so that's done here.
      onpointerdown: e => { SB.closeMenus(); e.preventDefault(); },
      // Enter or Space on it. After a pointer press the box has already moved in.
      onclick: () => { const id = activeOf(paneId); if (id) SB.activate(id); },
      onkeydown: e => {
        // AltGr comes as Ctrl+Alt, and types @, { or \ on many keyboards.
        if (e.key.length !== 1 || e.metaKey || ((e.ctrlKey || e.altKey) && !e.getModifierState('AltGraph'))) return;
        const id = activeOf(paneId);
        if (!id) return;
        e.preventDefault();
        SB.activate(id);
        input.setRangeText(e.key, input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      },
    }, h('span', { class: 'standin-text' }), h('span', { class: 'standin-meta' }));
  }

  // The line between two columns (axis 'w', after column c) or two panes in
  // column c (axis 'h', after pane r). Drag it; double-click to even them out.
  /** @param {string} axis @param {number} c @param {number | null} [r] */
  function divider(axis, c, r = null) {
    return h('div', {
      class: `pane-divider ${axis === 'w' ? 'across' : 'down'}`, role: 'separator',
      'aria-orientation': axis === 'w' ? 'vertical' : 'horizontal',
      title: 'Drag to resize · double-click to even out',
      onpointerdown: e => dragDivider(e, axis, c, r),
      ondblclick: () => { state.paneSizes = P.even(state.grid, state.paneSizes, axis, c); applySizes(); SB.savePanes(); },
    });
  }

  function dragDivider(e, axis, c, r) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const across = axis === 'w';
    const ids = across ? [state.grid[c][0].id, state.grid[c + 1][0].id] : [state.grid[c][r].id, state.grid[c][r + 1].id];
    const els = across ? [...paneRow().querySelectorAll(':scope > .pane-col')].slice(c, c + 2) : ids.map(id => panes.get(id).el);
    const [aPx, bPx] = els.map(el => el.getBoundingClientRect()[across ? 'width' : 'height']);
    const s0 = P.fitSizes(state.grid, state.paneSizes);
    const [a, b] = ids.map(id => s0[axis][id]);
    const start = across ? e.clientX : e.clientY;
    const min = across ? P.MIN.width : P.MIN.height;
    const line = e.currentTarget;
    line.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-panes');
    const move = ev => {
      const [na, nb] = P.splitPair(a, b, aPx, bPx, (across ? ev.clientX : ev.clientY) - start, min);
      const s = P.setWeight(state.grid, s0, axis, c, across ? null : r, na);
      state.paneSizes = P.setWeight(state.grid, s, axis, across ? c + 1 : c, across ? null : r + 1, nb);
      applySizes();
    };
    // Lost capture ends it too: renderPanes may redraw the line away mid-drag,
    // and then no pointerup ever comes. A line no longer on the page loses it at
    // the document, so listen there as well. Whichever comes first ends it, once.
    let done = false;
    const up = ev => {
      if (done || ev.pointerId !== e.pointerId) return;
      done = true;
      line.removeEventListener('pointermove', move);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) line.removeEventListener(type, up);
      document.removeEventListener('lostpointercapture', up, true);
      document.body.classList.remove('resizing-panes');
      SB.savePanes();
    };
    line.addEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) line.addEventListener(type, up);
    document.addEventListener('lostpointercapture', up, true);
  }

  // Panes a and b trade what they hold; the conversation you're in keeps the box, in its new place.
  SB.swapPanes = (a, b) => {
    const next = P.swap(state.grid, a, b);
    if (next === state.grid) return false;
    SB.unzoom();
    state.grid = next;
    SB.renderPanes();
    SB.renderTabStrip();
    SB.savePanes();
    return true;
  };

  // Working and asking marks change all the time; the panes are updated in
  // place, so a button being pressed is never swapped out from under you.
  // tab-strip.js calls this whenever it redraws.
  SB.refreshPaneHeads = () => {
    const split = panes.size > 1;
    const here = focusedPane();
    for (const [id, p] of panes) {
      const t = state.tabs.get(activeOf(id));
      if (!t) { for (const el of [p.head, p.el]) el.classList.remove('focused', 'needs-you'); continue; } // a tool's pane
      const focused = split && id === here;
      p.head.classList.toggle('focused', focused);
      t.el.classList.toggle('focused', focused);
      p.el.classList.toggle('focused', focused);
      p.el.dataset.tab = t.id;
      const stand = p.slot.querySelector('.pane-standin');
      if (stand) {
        const text = String(t.draft || '').trim().split('\n')[0];
        stand.querySelector('.standin-text').textContent = text || 'Type to give it a task…';
        stand.classList.toggle('no-draft', !text); // not .empty: that's the empty chat's, which rises in (panel.css)
        const q = t.queue?.length || 0;
        // Working, asking or done: the same mark the strip shows (tab-strip.js tabIcon).
        stand.querySelector('.standin-meta').replaceChildren(...[SB.tabIcon(t), q ? `${q} queued` : null].filter(Boolean));
      }
      SB.paintPaneTray(p, stand ? t : null);
      SB.paintPaneLane(p.head.querySelector('.pane-lane'), t);
      // A conversation in this pane asking for your OK that you aren't looking at: its header lights up.
      p.head.classList.toggle('needs-you', split && (P.byId(state.grid, id)?.tabs || []).some(x => x !== state.activeTab && asking(x)));
    }
    SB.applyZoom();
    // Zoomed in, the others asking can't be seen: the zoomed pane's header says so, and takes you there.
    const waiting = P.tabIds(state.grid).filter(x => x !== state.activeTab && asking(x));
    for (const [id, p] of panes) {
      const pill = p.head.querySelector('.pane-needs');
      pill.hidden = !(id === state.zoomPane && waiting.length);
      if (!pill.hidden) pill.textContent = waiting.length === 1 ? `${SB.shownTitle(state.tabs.get(waiting[0])).slice(0, 30)} needs you` : `${waiting.length} need you`;
    }
    SB.offerProjectLayout();
    // Which pane you're typing to, when there's more than one it could be.
    const tab = SB.activeTab();
    input.placeholder = split && tab ? `Give "${SB.shownTitle(tab).slice(0, 40)}" a task…` : PLACEHOLDER;
    // A popped-out window is named on the taskbar for the conversation you're in.
    if (SB.solo && tab) document.title = SB.shownTitle(tab);
  };

  // ------------------------------------------------------------ what needs you

  const asking = id => { const t = state.tabs.get(id); return !!t && window.ShellbyTabSort.standing(t) === 'asking'; };

  // Alt+J, or a zoomed pane's "needs you": the next conversation asking for
  // your OK, after the one you're in, in pane order. -> went?
  SB.goToNeeds = () => {
    const ids = P.tabIds(state.grid);
    const at = ids.indexOf(state.activeTab);
    const next = [...ids.slice(at + 1), ...ids.slice(0, Math.max(0, at))].find(asking);
    if (!next) { SB.toast('Nothing is waiting on you.'); return false; }
    if (state.view !== 'chat') SB.setView('chat');
    SB.activate(next);
    return true;
  };

  // Clicking into a pane makes it the one the box talks to: on the press, so
  // the box is there to type in by the time it's let go. Not for a button or
  // link in a feed (Allow on a permission card, an answer): the box moving in
  // can scroll a feed kept at its end up under the pointer before it's let go,
  // and the click would miss. Those focus their pane as they're clicked. Not
  // for a pane's header either: its tabs and buttons do their own thing on the
  // click, which a redraw on the press would lose. Nor for the buttons in an
  // unfocused pane's tray (Output, Stop, the suggestion): the box moving in
  // takes the tray away before the click lands. They work where they are.
  const FEED_CONTROL = ':is(.feed, .pane-extras) :is(button, a[href], input, select, textarea, summary, label, [role="button"], [role="menuitem"], [role="option"])';
  const paneTo = e => {
    if (e.target.closest?.('.pane-head')) return null;
    const id = e.target.closest?.('[data-tab]')?.dataset.tab;
    return id && id !== state.activeTab && state.tabs.has(id) ? id : null;
  };
  $('feeds').addEventListener('pointerdown', e => {
    const id = paneTo(e);
    if (id && !e.target.closest(FEED_CONTROL)) SB.activate(id);
  });
  // A field there that the press put the keyboard in (an answer of your own, a
  // note on a plan) keeps it: activating hands it to the box otherwise.
  $('feeds').addEventListener('click', e => {
    const id = paneTo(e);
    if (!id || !e.target.closest(FEED_CONTROL)) return;
    const field = /** @type {HTMLElement | null} */ (document.activeElement);
    SB.activate(id);
    if (field !== document.activeElement && field?.isConnected && field.closest('.feed') && field.matches('input, textarea, select, [contenteditable]')) field.focus({ preventScroll: true });
  }, true);

  // Something on top of the chat that has the keyboard: the jump-anywhere
  // palette (#paletteSheet), a dialog sheet (.card-sheet: the shortcut list, the
  // share card and the rest) or an open menu or popover (core.js anyMenuOpen,
  // which counts the slash and @ menus too).
  SB.overlayOpen = () => !!document.querySelector('.palette-sheet:not([hidden]), .card-sheet:not([hidden])') || SB.anyMenuOpen();

  // ------------------------------------------------------------ a window of its own

  // What's typed but not sent travels with a conversation between windows,
  // queued messages with the ids main's steering knows them by.
  SB.carryOf = tab => ({ draft: tab.draft, attachments: tab.attachments, queue: tab.queue, turnId: tab.turnId || null });
  SB.takeCarry = (tab, carry) => {
    if (!carry) return;
    Object.assign(tab, { draft: carry.draft, attachments: carry.attachments, queue: carry.queue });
    if (carry.turnId) tab.turnId = carry.turnId;
    // A turn that ended on the way over would have sent the next queued message;
    // one still running hears about the queue from this window now.
    if (!tab.busy && tab.queue.length) SB.onTurnEnded(tab, { ok: tab.outcome !== 'error', interrupted: tab.outcome === 'stopped' });
    else SB.syncSteers?.(tab);
  };

  // `at`: where it was dropped, in screen pixels, so the window opens there.
  SB.popOut = async (tabId, at = {}) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    if (SB.solo && state.tabs.size < 2) return SB.toast('This conversation is already in a window of its own.');
    if (tab.isActive) tab.draft = input.value;
    const r = await api.popOutTab(tabId, { ...at, carry: SB.carryOf(tab) });
    if (!r?.ok) return SB.toast(r?.error || "Couldn't open that in its own window.");
    state.popped.add(tabId);
    SB.forgetTab(tabId);
    SB.renderTabStrip();
  };

  // From its own window back into the panel, with what's typed.
  SB.popIn = (tabId) => {
    const tab = state.tabs.get(tabId);
    if (!tab || !SB.solo) return;
    if (tab.isActive) tab.draft = input.value;
    api.popInTab(tabId, SB.carryOf(tab)); // main's next list of tabs takes it from here
  };

  // The pane that takes over from `id` if it closes: above, else below, else
  // left, else right (as merge does). Ask before the pane is removed.
  const heir = id => ['up', 'down', 'left', 'right'].reduce((got, dir) => got ?? P.neighbor(state.grid, id, dir), null);

  // The tab to show once the focused one has gone. Split: the one pane `was`
  // (the pane it was in) shows now; if that pane closed, its neighbour `heir`
  // (taken before it went) does, else the first pane's. With one pane, the
  // last tab in the strip, as it always was. It settles the grid without
  // rendering: the caller must activate the tab or render afterwards.
  function nextShown(was, heirId) {
    const split = P.count(state.grid) > 1;
    const conv = id => (state.tabs.has(id) ? id : null); // a tool's pane takes no box
    return (split && (conv(activeOf(was)) || conv(activeOf(heirId)) || P.shownTabs(state.grid).find(conv))) || [...state.tabs.keys()].pop();
  }
  // For main's tab list (tabs.js syncTabs) arriving with no tab focused: the
  // focused one taken away under the panes, its replacement not here yet.
  // Settles without rendering; the caller activates a tab or renders.
  SB.nextShown = () => { const was = homePane(); const near = heir(was); SB.settlePanes(); return nextShown(was, near); };

  // A tab leaves this window: closed, popped out, or gone from main. Split,
  // its pane shows its neighbour (a pane left with none closes) and, if it was
  // the one the box talked to, that neighbour takes the focus (nextShown).
  SB.forgetTab = (tabId) => {
    const tab = state.tabs.get(tabId);
    if (!tab) return;
    const was = P.paneWith(state.grid, tabId)?.id;
    SB.clearMerge?.(tab); // a message waiting for company here mustn't be sent to a tab that's gone (tab-queue.js)
    tab.destroy();
    state.tabs.delete(tabId);
    SB.dropHeldTabs?.(); // a list held for pacing (boot.js) may still carry this tab: main's next one will not
    const near = heir(was);
    state.grid = P.leave(state.grid, tabId);
    if (state.activeTab !== tabId) return SB.renderPanes();
    state.activeTab = null;
    const next = nextShown(was, near);
    if (next) SB.activate(next);
    else if (!SB.solo) SB.newTab();
  };

  // A popped-out conversation's window closed: it's a tab here again, in the
  // focused pane (renderTabStrip settles it there).
  api.onTabReturned(({ summary, items, carry }) => {
    if (!summary) return;
    state.popped.delete(summary.id);
    if (state.tabs.has(summary.id)) return;
    const tab = SB.ensureTab(summary);
    for (const item of items || []) tab.render(item, { replay: true });
    SB.takeCarry(tab, carry);
    SB.renderTabStrip();
  });

  $('splitBtn').addEventListener('click', () => SB.splitPane());
  $('popOutBtn').addEventListener('click', () => { if (state.activeTab) SB.popOut(state.activeTab); });
  $('maxBtn').addEventListener('click', () => api.maximize());
})();
