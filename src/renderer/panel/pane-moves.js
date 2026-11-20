/* Shellby panel — a conversation going somewhere else: dropped on a pane or
   on a strip (where a dragged tab would land, and the preview of it), split
   off into a pane of its own (Ctrl+\), moved into the next pane with
   Ctrl+Alt+arrows, or its pane closed into the one beside it. shared/panes.js
   decides the grid that comes of it, pane-room.js whether this window has
   room for it, and tab-panes.js lays the panes out once it's decided. */
'use strict';
(function () {
  const { api, state, $ } = SB;
  const P = SB.panes;
  const EDGES = new Set(['left', 'right', 'top', 'bottom']);
  const OUT = 24;   // px past the window's edge before letting go pops the tab out
  const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

  const activeOf = paneId => P.byId(state.grid, paneId)?.active ?? null;
  const focusedPane = () => SB.focusedPane();
  const panes = () => SB.paneEls; // paneId -> { el, head, strip, slot }, the panes on screen (tab-panes.js)

  // ------------------------------------------------------------ from pane to pane

  // Drop `tabId` on pane `target` (`zone`: see panes.place; 'strip' with
  // `before`, the tab to land in front of) and focus it there, growing the
  // window first if a new pane needs it. -> placed?
  SB.placeTab = async (tabId, target, zone, before = null) => {
    SB.unzoom();
    const was = state.grid;
    let next = P.place(was, tabId, target, zone, before);
    if (next === was) return false;
    let room = { ok: true, space: null };
    if (EDGES.has(zone)) {
      room = SB.roomFor(next);
      if (!room.ok) { SB.toast(SB.NO_ROOM); return false; }
      if (room.want) {
        await api.fitPanel(room.want);
        // The grid may have changed while the window grew (a tab closed, say): place it on that one.
        if (state.grid !== was) {
          if ((next = P.place(state.grid, tabId, target, zone, before)) === state.grid) return false;
          if (!(room = SB.roomFor(next)).ok) { SB.toast(SB.NO_ROOM); return false; }
        }
      }
    }
    const sizes = P.placeSizes(state.grid, state.paneSizes, tabId, target, zone);
    state.paneSizes = room.space ? SB.atLeastMin(next, sizes, room.space) : sizes;
    state.grid = next;
    SB.activate(tabId);
    return true;
  };

  // A pane's ×: the pane goes and its tabs move into the pane beside it
  // (panes.merge), so no conversation closes by accident. That pane keeps the
  // tab it shows, and takes the focus if the closed one had it.
  SB.closePane = (paneId) => {
    if (P.isToolPane(P.byId(state.grid, paneId))) return SB.tools.close(activeOf(paneId));
    const { grid, into } = P.merge(state.grid, paneId);
    if (!into) return;
    const hadFocus = focusedPane() === paneId;
    state.grid = grid;
    if (hadFocus) SB.activate(P.byId(grid, into).active);
    else { SB.renderPanes(); SB.renderTabStrip(); }
  };

  // The split shortcut and button. The focused pane's tab goes into a pane of
  // its own when its pane holds others; otherwise a new conversation does.
  // Beside the focused pane while there's room for another column, then below
  // one. ('new' stands in for a new conversation while the room is measured:
  // an id in no pane, so place treats it as a tab coming from off screen.)
  SB.splitPane = async () => {
    if (SB.solo || !state.activeTab || !(await SB.chatShowing())) return;
    SB.unzoom();
    const here = P.paneWith(state.grid, state.activeTab);
    const take = here && here.tabs.length > 1 ? state.activeTab : null;
    const moving = take || 'new';
    const spots = [...new Set([here?.id, ...P.paneIds(state.grid)].filter(Boolean))];
    const fits = zone => id => P.zones(state.grid, id, moving).includes(zone) && SB.roomFor(P.place(state.grid, moving, id, zone)).ok;
    const side = spots.find(fits('right'));
    const below = !side && spots.find(fits('bottom'));
    if (!side && !below) {
      return SB.toast(P.count(state.grid) >= P.MAX_COLS * P.MAX_ROWS ? 'Twelve is as many as there are. Close a pane first.' : SB.NO_ROOM);
    }
    const target = side || below;
    const zone = side ? 'right' : 'bottom';
    if (take) return SB.placeTab(take, target, zone);
    const fresh = (await SB.newTab({ focus: false, reuse: false }))?.id;
    // Refused after all (the room went while the window grew): the tab made for it goes again.
    if (fresh && !(await SB.placeTab(fresh, target, zone))) SB.closeTab(fresh);
  };

  // Ctrl+Alt+arrow: this conversation moves into the pane that way, where it
  // joins that pane's tabs, or at the left or right edge takes a column of its
  // own (panes.moveToward decides; placeTab checks the room). From another view
  // the chat is shown and settled first, as for Split. -> moved?
  SB.paneDir = key => DIRS[key] || null;
  SB.movePane = async (tabId, dir) => {
    if (SB.solo || !(await SB.chatShowing())) return false;
    const to = P.moveToward(state.grid, tabId, dir);
    if (to) return SB.placeTab(tabId, to.target, to.zone); // which toasts when the room's not there
    // At the left or right edge with something to leave behind (other tabs in
    // its pane, or a pane it shares a column with), but no fifth column: say so.
    const own = P.paneWith(state.grid, tabId);
    const at = own && P.find(state.grid, own.id);
    if ((dir === 'left' || dir === 'right') && at && !P.neighbor(state.grid, own.id, dir) && (own.tabs.length > 1 || state.grid[at.c].length > 1)) {
      SB.toast(state.grid.length >= P.MAX_COLS ? 'Four columns is as many as there are. Close a pane first.' : SB.NO_ROOM);
    }
    return false;
  };

  // ------------------------------------------------------------ where a dragged tab lands

  // What letting go here would do: reorder the top strip or a pane's own
  // strip, join a pane (on its strip, where it's dropped; in its middle, at
  // the end), split one, pop the tab out (well outside the window), or
  // nothing. For tab-strip.js's drag.
  SB.dropAt = (x, y, dragId) => {
    const w = window.innerWidth, ht = window.innerHeight;
    if (x < -OUT || y < -OUT || x > w + OUT || y > ht + OUT) return SB.solo ? null : { kind: 'out' };
    x = Math.min(Math.max(x, 0), w - 1);
    y = Math.min(Math.max(y, 0), ht - 1);
    if (y < $('tabstrip').getBoundingClientRect().bottom) return { kind: 'strip' }; // hidden while split: a zero rect
    if (state.view !== 'chat') return null;
    const inside = r => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height;
    for (const pane of state.grid.flat()) {
      const p = panes().get(pane.id);
      if (!p) continue;
      if (P.isToolPane(pane)) { if (inside(p.el.getBoundingClientRect())) return null; continue; } // takes no conversations
      // Its header is its strip (hidden, a zero rect, with one pane): its own
      // tab moves along it, any other joins the pane there.
      if (inside(p.head.getBoundingClientRect())) {
        const before = stripBefore(p.strip, x, dragId);
        if (pane.tabs.includes(dragId)) return { kind: 'strip', pane: pane.id, before };
        return { kind: 'join', target: pane.id, before, rect: barAt(p.strip, before) };
      }
      const r = p.el.getBoundingClientRect();
      if (!inside(r)) continue;
      // Only where the panes would still fit on this screen.
      const allowed = P.zones(state.grid, pane.id, dragId).filter(z => z === 'center' || SB.roomFor(P.place(state.grid, dragId, pane.id, z)).ok);
      const zone = P.zoneAt(r, x, y, allowed);
      if (!allowed.includes(zone)) return null; // the middle of the pane already showing it
      return { kind: 'pane', target: pane.id, zone, rect: P.previewRect(zone, r, p.el.parentElement.getBoundingClientRect()) };
    }
    return null;
  };

  // The tab to land in front of on a pane's strip: the first, other than the
  // one being dragged, whose midpoint is right of the pointer. null: the end.
  function stripBefore(strip, x, dragId) {
    for (const el of strip.children) {
      if (el.dataset.tabId === dragId) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left + r.width / 2) return el.dataset.tabId;
    }
    return null;
  }

  // Where on a strip a tab joining it lands, for the drop preview: a thin bar
  // in front of `before`, or after the strip's last tab.
  function barAt(strip, before) {
    const s = strip.getBoundingClientRect();
    const tabs = [...strip.children];
    const at = tabs.find(el => el.dataset.tabId === before);
    const last = tabs.at(-1)?.getBoundingClientRect();
    const left = at ? at.getBoundingClientRect().left : last ? last.right : s.left;
    return { left: Math.max(s.left, left - 2), top: s.top, width: 4, height: s.height };
  }

  // A tab dragged along its own pane's strip, while split: it moves as the
  // pointer goes, as on the top strip (tab-strip.js); the layout keeps the order.
  SB.reorderInPane = (tabId, before) => {
    const pane = P.paneWith(state.grid, tabId);
    const next = pane && P.join(state.grid, tabId, pane.id, before);
    if (!next || next === state.grid) return;
    state.grid = next;
    SB.renderTabStrip();
    SB.savePanes();
  };

  // The preview of where it will land (a pane's half, or a bar on a strip), or none.
  SB.showDrop = (drop) => {
    const hint = $('dropHint');
    hint.hidden = drop?.kind !== 'pane' && drop?.kind !== 'join';
    if (hint.hidden) return;
    const r = drop.rect;
    Object.assign(hint.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
})();
