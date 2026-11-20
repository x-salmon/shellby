/* Shellby panel — a pane's header, while conversations sit side by side: its
   own tab strip (tab-strip.js draws the tabs), a new conversation in it, zoom,
   its files, pop out the tab it shows and close the pane; dragged by its empty
   part onto another pane, the two trade places. Beside the strip, its lane
   (the branch of the copy its conversation works in, and how its last checks
   went); over an unfocused pane's stand-in, its tray (Claude's to-do list,
   what it left running, what you might ask next). tab-panes.js makes a header
   for each pane (SB.paneHead) and repaints the tray and lane as it redraws
   (SB.paintPaneTray, SB.paintPaneLane). Loaded before tab-panes.js. */
'use strict';
(function () {
  const { h, state } = SB;
  const P = SB.panes;
  const POP_ICON = 'M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5v3.2c0 .4-.4.8-.8.8H3.3c-.4 0-.8-.4-.8-.8V4.8c0-.4.4-.8.8-.8h3.2';
  const PLUS_ICON = 'M8 3.5v9M3.5 8h9';
  const CLOSE_ICON = 'M4.5 4.5l7 7M11.5 4.5l-7 7';
  const ZOOM_ICON = 'M3 6.5V3h3.5M13 6.5V3H9.5M3 9.5V13h3.5M13 9.5V13H9.5';
  const FILES_ICON = 'M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.5H13c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z';

  const activeOf = paneId => P.byId(state.grid, paneId)?.active ?? null;
  const panes = () => SB.paneEls; // paneId -> { el, head, strip, slot }, the panes on screen (tab-panes.js)

  // ------------------------------------------------------------ the header

  // A pane's header is its tab strip, with its own edge markers (tab-overview.js),
  // then a new conversation in this pane, its files, pop out the tab it shows, and close the pane.
  SB.paneHead = function paneHead(paneId) {
    const strip = h('div', { class: 'tabs pane-tabs', role: 'tablist', 'aria-label': 'Conversations in this pane' });
    const left = h('button', { type: 'button', class: 'tab-edge left', hidden: true });
    const right = h('button', { type: 'button', class: 'tab-edge right', hidden: true });
    const head = h('div', { class: 'pane-head', dataset: { pane: paneId }, onpointerdown: e => dragHead(e, paneId) },
      h('div', { class: 'tabs-wrap' }, strip, left, right),
      h('span', { class: 'pane-lane', hidden: true }),
      h('button', { class: 'pane-needs', type: 'button', hidden: true, title: 'Go to it (Alt+J)', onclick: () => SB.goToNeeds() }),
      h('button', { class: 'pane-btn', type: 'button', title: 'New conversation in this pane (Ctrl+T)', 'aria-label': 'New conversation in this pane', onclick: () => newTabIn(paneId) },
        SB.icon(PLUS_ICON, { width: 1.6 })),
      h('button', { class: 'pane-btn pane-zoom', type: 'button', title: 'Fill the chat with this pane, and back (Ctrl+Alt+Enter)', 'aria-label': 'Zoom this pane', 'aria-pressed': 'false', onclick: () => SB.zoomFrom(paneId) },
        SB.icon(ZOOM_ICON, { width: 1.5 })),
      h('button', { class: 'pane-btn pane-files', type: 'button', hidden: true, title: "Browse this conversation's files", 'aria-label': 'Browse files', onclick: () => { const id = activeOf(paneId); if (id) SB.viewer?.openTab(id); } },
        SB.icon(FILES_ICON, { width: 1.3 })),
      h('button', { class: 'pane-btn', type: 'button', title: 'Open in its own window', 'aria-label': 'Open in its own window', onclick: () => { const id = activeOf(paneId); if (id) SB.popOut(id); } },
        SB.icon(POP_ICON)),
      h('button', { class: 'pane-btn pane-close', type: 'button', title: 'Close this pane (its conversations move to the one beside it)', 'aria-label': 'Close this pane', onclick: () => SB.closePane(paneId) },
        SB.icon(CLOSE_ICON, { width: 1.5 })));
    SB.wireStrip(strip);
    SB.watchEdges(strip, left, right);
    return { head, strip };
  };

  // A pane's header dragged (anywhere but a tab or a button) onto another pane:
  // the two trade places (panes.swap). The drop preview covers the pane it
  // would trade with.
  function dragHead(e, paneId) {
    if (e.button !== 0 || SB.solo || P.count(state.grid) < 2 || e.target.closest('.tab, button')) return;
    const head = e.currentTarget;
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false, done = false;
    /** @type {string | null} */
    let over = null;
    const under = ev => {
      const id = /** @type {HTMLElement | null} */ (document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.pane'))?.dataset.pane;
      return id && id !== paneId && panes().has(id) ? id : null;
    };
    const move = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!moved) { moved = true; document.body.classList.add('swapping-panes'); }
      over = under(ev);
      SB.showDrop(over ? { kind: 'pane', rect: panes().get(over).el.getBoundingClientRect() } : null);
    };
    const end = ev => {
      if (done || ev.pointerId !== e.pointerId) return;
      done = true;
      head.removeEventListener('pointermove', move);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) head.removeEventListener(type, end);
      document.body.classList.remove('swapping-panes');
      SB.showDrop(null);
      if (moved && ev.type === 'pointerup' && over) SB.swapPanes(paneId, over);
    };
    head.setPointerCapture(e.pointerId);
    head.addEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) head.addEventListener(type, end);
  }

  // A strip's "+": a new conversation in that pane, after the tab it shows.
  function newTabIn(paneId) {
    const id = activeOf(paneId);
    if (id && id !== state.activeTab) SB.activate(id);
    SB.newTab();
  }

  // ------------------------------------------------------------ the tray over a stand-in

  // The tray over the box (native-strip.js, native-cli.js) is the focused
  // pane's conversation's: its to-do list, what it left running and what you
  // might ask next. Every other pane keeps its own over its stand-in, Output,
  // Stop and all, so nothing it has going vanishes when you click away. The
  // slots stay put while the pane is out of focus; each piece fills its own.
  const TRAY_KINDS = ['todos', 'jobs', 'nextPrompt'];
  const TRAY_CLASS = { todos: 'todos', jobs: 'jobs', nextPrompt: 'next-prompt' };
  const TRAY_LABEL = { todos: "Claude's to-do list", jobs: 'Running in the background' };
  // `p`: the pane's elements; `t`: the tab it shows, or null to take the tray away (the focused pane, a tool).
  SB.paintPaneTray = function paintTray(p, t) {
    let el = p.slot.querySelector('.pane-extras');
    if (!t) { el?.remove(); return; }
    if (!el) {
      el = h('div', { class: 'pane-extras' }, TRAY_KINDS.map(kind => h('div', {
        class: TRAY_CLASS[kind], dataset: { tray: kind }, hidden: true,
        ...(TRAY_LABEL[kind] ? { role: 'region', 'aria-label': TRAY_LABEL[kind] } : {}),
      })));
      p.slot.prepend(el);
    }
    SB.renderTodos?.(t);
    SB.renderJobs?.(t);
    SB.renderNextPrompt?.(t);
  };
  // Where an unfocused pane showing this tab keeps one piece of its tray, or null.
  SB.paneTrayBox = (tabId, kind) => {
    if (!TRAY_KINDS.includes(kind)) return null;
    for (const [id, p] of panes()) {
      if (activeOf(id) !== tabId) continue;
      const el = p.slot.querySelector(`.pane-extras [data-tray="${kind}"]`);
      if (el) return el;
    }
    return null;
  };

  // ------------------------------------------------------------ the lane beside the tabs

  // A pane's lane, beside its tabs: the branch of the copy its conversation
  // works in, and how its last checks went (turn-checks.js keeps them on the tab).
  // The branch reads as words with its kind as a colour (shared/branch-label.js),
  // grows into whatever room the tabs leave, and folds to the glyph in a narrow
  // pane (components.css). Hovered or focused, a card under it has the full name.
  const CHECK_MARK = { running: '…', pass: '✓', fail: '✗' };
  const CHECK_SAY = { running: 'Its checks are running', pass: 'Its last checks passed', fail: 'Its last checks failed' };
  const BRANCH_ICON = 'M4.5 2.5v8.7M4.5 10.5c0-3 7-2.5 7-6.5M3.1 12.6a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0M10.1 3.2a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0';
  SB.paintPaneLane = function paintLane(lane, t) {
    const w = t.worktree?.branch ? t.worktree : null;
    const b = w ? window.ShellbyBranchLabel.branchLabel(w.branch) : null;
    const check = t.checkRunning ? 'running' : t.checkState || '';
    lane.hidden = !b && !check;
    lane.className = check ? `pane-lane ${check}` : 'pane-lane';
    if (b) lane.dataset.kind = b.colour; else delete lane.dataset.kind;
    // "From main. Its last checks passed." Under the name in the card, and read out with it.
    const about = [b && w.base && `From ${w.base}`, check && CHECK_SAY[check]].filter(Boolean).join('. ');
    lane.tabIndex = lane.hidden ? -1 : 0;
    lane.setAttribute('aria-label', [b ? `Its own copy, on ${b.full}` : '', about].filter(Boolean).join('. '));
    lane.replaceChildren(...[
      check ? h('span', { class: 'lane-mark', 'aria-hidden': 'true', text: CHECK_MARK[check] }) : null,
      b ? SB.icon(BRANCH_ICON, { width: 1.6 }) : null,
      b ? h('span', { class: 'lane-branch', text: b.words }) : null,
      // Shown by CSS on hover and focus; aria-label above already says all of it.
      h('span', { class: 'lane-peek', 'aria-hidden': 'true' },
        b ? h('b', { class: 'peek-name' }, b.kind ? h('span', { class: 'peek-kind', text: b.kind }) : null, b.words) : null,
        b ? h('code', { class: 'peek-full', text: b.full }) : null,
        about ? h('span', { text: `${about}.` }) : null),
    ].filter(Boolean));
  };
})();
