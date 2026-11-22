// Conversations in windows of their own. Dragged out of the panel (or sent out
// with its button), a tab gets a window showing the same panel page with just
// that conversation (the renderer's SB.solo), so it can be snapped, maximized
// or put on another screen. It's a whole panel: what you open there (a new
// conversation, one from History, a screen) opens there, with its own tabs and
// panes. The panel drops its tabs while they're out; closing the window hands
// them back. Never saved: a restart brings every conversation back into the
// panel. Kept out of main.js, which only wires it up.
const { BrowserWindow, app, ipcMain } = require('electron');
const path = require('path');
const { askingWindow } = require('../asking');
const { attachContextMenu } = require('../context-menu');
const { clampToDisplays } = require('../desktop/placement');
const windowRoutes = require('./window-routes');

const PANEL_DEFAULT = { width: 460, height: 700 };
const MIN = { width: 400, height: 420 };
// Dropped outside the panel: the window's title bar lands under the pointer.
const GRAB = { x: 120, y: 18 };
// From the button: a step down and right of the panel, so it's plainly a new window.
const STEP = 36;
const MAX_QUEUED = 20;
const MAX_FILES = 20;
// Closed from the taskbar or with Alt+F4: how long its page has to hand over what was typed.
const CARRY_WAIT_MS = 800;

/**
 * Typed-but-unsent words that travel with a conversation between windows:
 * the box, its attachments, and the queue behind a running turn (with the ids
 * main's steering knows them by). Anything else is dropped. Pure.
 */
function cleanCarry(c, { maxText = 50000, isStr = s => typeof s === 'string' && s.length > 0 && s.length < 10000 } = {}) {
  if (!c || typeof c !== 'object') return null;
  const files = a => (Array.isArray(a) ? a.filter(isStr).slice(0, MAX_FILES) : []);
  return {
    draft: typeof c.draft === 'string' ? c.draft.slice(0, maxText) : '',
    attachments: files(c.attachments),
    turnId: isStr(c.turnId) && c.turnId.length <= 64 ? c.turnId : null,
    queue: (Array.isArray(c.queue) ? c.queue : []).slice(0, MAX_QUEUED)
      .filter(m => m && typeof m.text === 'string' && isStr(m.id) && m.id.length <= 64)
      .map(m => ({ id: m.id, text: m.text.slice(0, maxText), attachments: files(m.attachments), ...(m.taken === true ? { taken: true } : {}) })),
  };
}

/** d: what main shares (main.js `shared`). */
function wirePopouts(d) {
  const popouts = new Map();  // tabId -> the BrowserWindow it's out in
  const windows = new Map();  // BrowserWindow -> its id, as its page knows itself (SB.solo)
  const carries = new Map();  // tabId -> cleanCarry(), on its way between windows

  const isPoppedOut = tabId => popouts.has(tabId);
  // The window a tab's live items go to.
  const tabWindow = tabId => popouts.get(tabId) || d.panel;
  const others = () => [...windows.keys()].filter(w => !w.isDestroyed());
  const windowOf = wc => others().find(w => w.webContents === wc) || null;
  // For ipc-guard.js: a popped-out window is the panel's own page, with its bridge.
  const isPopout = wc => !!windowOf(wc);
  const idsIn = win => [...popouts].filter(([, w]) => w === win).map(([id]) => id);
  const popoutTabs = wc => idsIn(windowOf(wc));

  function setCarry(tabId, carry) {
    const c = cleanCarry(carry, { maxText: d.PANEL_MAX_TEXT, isStr: d.isStr });
    if (c) carries.set(tabId, c); else carries.delete(tabId);
  }
  function takeCarry(tabId) {
    const c = carries.get(tabId) || null;
    carries.delete(tabId);
    return c;
  }

  // Named for the tab it opened with; another while that one's still up gets a number.
  function newWindowId(tabId) {
    const taken = new Set(windows.values());
    let id = tabId;
    for (let n = 2; taken.has(id); n++) id = `${tabId}~${n}`;
    return id;
  }

  function popOut(tabId, { x, y } = {}) {
    if (!d.manager.tabs.has(tabId)) return false;
    const from = popouts.get(tabId);
    if (from && idsIn(from).length < 2) { showPopout(tabId); return true; } // alone in its window already
    const size = d.config.get('panelSize') || PANEL_DEFAULT;
    const at = Number.isFinite(x) && Number.isFinite(y)
      ? { x: Math.round(x) - GRAB.x, y: Math.round(y) - GRAB.y }
      : (() => { const [px, py] = (from || d.panel).getPosition(); return { x: px + STEP, y: py + STEP }; })();
    const bounds = clampToDisplays({ ...at, ...size }, d.workAreas(), 0);
    const win = new BrowserWindow({
      ...bounds, minWidth: MIN.width, minHeight: MIN.height,
      show: false, frame: false, backgroundColor: '#0c1719', title: d.manager.tabs.get(tabId).title || 'Shellby', icon: d.ICON, webPreferences: d.webPreferences,
    });
    d.secureWindow(win);
    const id = newWindowId(tabId);
    windows.set(win, id);
    popouts.set(tabId, win);
    const unmenu = attachContextMenu(win, ipcMain);
    win.loadFile(path.join(d.RENDERER, 'panel', 'panel.html'), { query: { popout: id } });
    win.webContents.on('did-finish-load', () => {
      win.webContents.setZoomFactor(d.config.get('panelZoom') || 1); // the panel's zoom (ipc/files.js)
      sendCalm(win);
    });
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    win.on('focus', () => sendCalm(win));
    win.on('blur', () => sendCalm(win));
    win.on('resized', () => d.resizedByYou?.(win)); // its room, as the panel's (wiring/panel.js)
    // Closed any way but its ×: its page hands over what was typed first (popout:home), then it closes.
    win.on('close', e => {
      if (win.goingHome || app.isQuitting || !idsIn(win).length) return;
      e.preventDefault();
      if (win.askedHome) return; // asked already: its answer, or the wait, closes it
      win.askedHome = true;
      d.send(win, 'popout:closing');
      setTimeout(() => { win.goingHome = true; if (!win.isDestroyed()) win.close(); }, CARRY_WAIT_MS);
    });
    win.on('closed', () => {
      unmenu();
      const ids = idsIn(win);
      windows.delete(win);
      if (!ids.length) return; // closed with its last conversation: nothing to hand back
      for (const t of ids) popouts.delete(t);
      for (const t of ids) if (app.isQuitting || !handBack(t)) carries.delete(t);
      if (app.isQuitting) return;
      sendTabs();
      if (win.backToPanel && d.manager.tabs.has(win.backToPanel)) d.showPanel({ tabId: win.backToPanel });
    });
    if (from) sendTabs(); // its old window lets it go
    return true;
  }

  // The panel gets a conversation back, as it stands. -> still open?
  function handBack(tabId) {
    if (!d.manager.tabs.has(tabId)) return false;
    const summary = d.manager.summary.find(t => t.id === tabId);
    d.send(d.panel, 'tab:returned', { summary, items: d.history.load(tabId), carry: takeCarry(tabId) });
    return true;
  }

  function showWindow(win) {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    // As the panel does (wiring/panel.js): from a notification click, Windows
    // leaves a window behind the one you're in unless it's moved to the top.
    win.moveTop();
    win.focus();
  }

  function showPopout(tabId) {
    const win = popouts.get(tabId);
    if (!win || win.isDestroyed()) return;
    showWindow(win);
    d.send(win, 'tab:focus', tabId); // one of its tabs, maybe not the one up
  }

  // One conversation back into the panel, which comes forward with it. The
  // window's last one takes the window with it.
  function popIn(tabId) {
    const win = popouts.get(tabId);
    if (!win || win.isDestroyed()) return;
    if (idsIn(win).length < 2) { win.backToPanel = tabId; win.goingHome = true; win.close(); return; }
    popouts.delete(tabId);
    handBack(tabId);
    sendTabs();
    d.showPanel({ tabId });
  }

  // Its own ×: every conversation in it, back into the panel. front: the one that was up.
  function closeHome(wc, front) {
    const win = windowOf(wc);
    if (!win) return;
    win.backToPanel = popouts.get(front) === win ? front : idsIn(win)[0] || null;
    win.goingHome = true;
    win.close();
  }

  // The conversation itself closed: its window goes too when it was the last one there.
  function closePopout(tabId) {
    const win = popouts.get(tabId);
    if (!win) return;
    popouts.delete(tabId);
    carries.delete(tabId);
    if (!win.isDestroyed() && !idsIn(win).length) win.destroy();
  }

  // A conversation about to open (wiring/timetrack.js openTab), asked for in a
  // window of its own: it opens there. -> placed?
  function placeNewTab(tabId) {
    const win = askingWindow();
    if (!win || !windows.has(win) || popouts.has(tabId) || d.manager.tabs.has(tabId)) return false;
    popouts.set(tabId, win);
    return true;
  }
  const unplaceTab = tabId => { popouts.delete(tabId); };

  // Already open in another window than the one asking: that one comes forward
  // with it. -> did it?
  function showElsewhere(tabId) {
    if (!d.manager.tabs.has(tabId)) return false;
    const win = popouts.get(tabId) || null;
    const asker = askingWindow();
    if (win === (asker && windows.has(asker) ? asker : null)) return false;
    if (win) showPopout(tabId); else d.showPanel({ tabId });
    return true;
  }

  // Nobody's looking at it, or the screen is locked: as the panel is (wiring/windows.js panelCalm).
  function sendCalm(win) {
    if (win.isDestroyed()) return;
    const locked = d.calmReason === 'locked';
    d.send(win, 'panel:calm', { calm: locked || !win.isFocused(), deep: locked });
  }
  const calmPopouts = () => { for (const win of others()) sendCalm(win); };

  // The panel and every popped-out conversation, for what isn't one tab's:
  // the usage meter, the outlook, the zoom.
  const everyWindow = () => [d.panel, ...others()].filter(w => w && !w.isDestroyed());
  function sendEveryWindow(channel, payload) {
    for (const win of everyWindow()) d.send(win, channel, payload);
  }
  // Every window but the one that made the change, which has its answer.
  function sendOtherWindows(wc, channel, payload) {
    for (const win of everyWindow()) if (win.webContents !== wc) win.webContents.send(channel, payload);
  }
  // Someone could be looking at Shellby (Health's beat, what only redraws a screen).
  const anyWindowOpen = () => everyWindow().some(w => w.isVisible());

  // Where main.js send() delivers what's meant for the panel (window-routes.js).
  function routes(win, channel, payload) {
    if (!win || win !== d.panel || !windows.size) return [[win, payload]];
    const asker = askingWindow();
    return windowRoutes.routes(channel, payload, { panel: win, others: others(), asker: asker && windows.has(asker) ? asker : null, tabWindow });
  }

  // Every window hears about every tab, and which window each one popped out is
  // in; the panel leaves those out, and each window keeps its own.
  function sendTabs(summary = d.manager.summary) {
    for (const id of [...popouts.keys()]) if (!d.manager.tabs.has(id)) closePopout(id);
    const list = summary.map(t => (popouts.has(t.id) ? { ...t, popped: true, win: windows.get(popouts.get(t.id)) } : t));
    d.send(d.panel, 'tabs', list);
    for (const win of others()) d.send(win, 'tabs', list);
  }

  return {
    anyWindowOpen, calmPopouts, closeHome, closePopout, everyWindow, isPoppedOut, isPopout, placeNewTab, popIn, popOut, popoutTabs, popoutWindow: windowOf,
    routes, sendEveryWindow, sendOtherWindows, sendTabs, setCarry, showElsewhere, showPopout, showWindow, tabWindow, takeCarry, unplaceTab,
  };
}

module.exports = { wirePopouts, cleanCarry };
