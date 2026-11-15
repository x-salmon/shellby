// Point at your dev server: a Shellby window showing a running dev server,
// where you click the part you want changed, say what should change, and it
// goes to Claude in that project with a picture of it.
//
// The picker (pages/page-side/picker.js) runs in an isolated world: it shares
// the page's DOM but none of its scripts, and what you picked comes back as
// the script's own result, so the page can't fake a pick or read one. Only a
// localhost origin is ever loaded (shots.js localOrigin); the window can't
// leave it, open others, download, or ask for any permission. Links elsewhere
// open in your browser.
const crypto = require('crypto');
const { localOrigin } = require('./shots');
const pointing = require('./pointing');
const { pickerSource } = require('./pages/protocol');

const WORLD_ID = 1012;            // the picker's own isolated world
const PARTITION = 'dev-point';    // in memory: nothing the dev server sets outlives Shellby
const WIDTH = 1280;
const HEIGHT = 860;
const CAPTURE_TIMEOUT_MS = 10000;
const REPAINT_MS = 80;            // the overlay is gone before the picture
const POINT_KEY = 'F2';

/** The picker started in its world: resolves with what it posts, or a cancel. Pure. */
function pickScript(source) {
  return `(function () {
${source}
return new Promise(function (resolve) {
  if (window.__shellbyPoint) window.__shellbyPoint.cancel();
  var picker = shellbyPicker({ askBox: true, post: function (m) { window.__shellbyPoint = null; resolve(m); } });
  window.__shellbyPoint = { cancel: function () { picker.set(false); window.__shellbyPoint = null; resolve({ type: 'point-cancel' }); } };
  picker.set(true);
});
})()`;
}
const CANCEL_SCRIPT = 'window.__shellbyPoint ? (window.__shellbyPoint.cancel(), true) : false';

/** A title that says how to use it. Pure. */
const titleFor = (project, picking) => `${project || 'Dev server'}: ${picking ? 'click what should change (Shift+click for more, Esc to stop)' : `press ${POINT_KEY} or Point at it`}`;

const wait = ms => new Promise(r => setTimeout(r, ms));
const within = (p, ms) => Promise.race([p, wait(ms).then(() => null)]);

/**
 * deps: { electron: { BrowserWindow, Menu, session }, picturesDir, openExternal(url), onPicked({ root, text, files }), log? }
 * -> { open({ id, url, root, project }), closeAll() }
 */
function createDevPoint(deps) {
  const { electron } = deps;
  /** @type {Map<string, { win: any, picking: boolean, root: string, project: string }>} */
  const open = new Map();
  let locked = false;
  /** @type {string | null} */
  let source = null;

  function lock(ses) {
    if (locked) return;
    locked = true;
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', e => e.preventDefault());
  }

  const external = url => { if (/^https?:\/\//i.test(String(url))) deps.openExternal(url); };

  function menuFor(entry) {
    return electron.Menu.buildFromTemplate([
      { label: 'Point at it', accelerator: POINT_KEY, click: () => pick(entry) },
      { label: 'Reload', accelerator: 'F5', click: () => entry.win.webContents.reload() },
      { label: 'Open in browser', click: () => external(entry.win.webContents.getURL()) },
    ]);
  }

  /** Point, or stop pointing if you already are. */
  async function pick(entry) {
    const wc = entry.win.webContents;
    if (entry.picking) { await wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: CANCEL_SCRIPT }]).catch(() => null); return; }
    entry.picking = true;
    entry.win.setTitle(titleFor(entry.project, true));
    // A new document or a closed window ends the pick: that world is gone with the page.
    // A route change inside the page (same document) keeps it.
    /** @type {any} */
    let onNav = null;
    /** @type {any} */
    let onGone = null;
    const gone = new Promise(resolve => {
      const end = () => resolve({ type: 'point-cancel' });
      onNav = (e, _url, sameDoc, mainFrame) => {
        const main = e?.isMainFrame ?? mainFrame;
        const same = e?.isSameDocument ?? sameDoc;
        if (main && !same) end();
      };
      onGone = end;
      wc.on('did-start-navigation', onNav);
      wc.once('destroyed', onGone);
    });
    try {
      if (!source) source = pickerSource();
      const m = await Promise.race([wc.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: pickScript(source) }], true), gone]).catch(() => null);
      if (m?.type !== 'pointed' || entry.win.isDestroyed()) return;
      await send(entry, m);
    } finally {
      if (!wc.isDestroyed()) { wc.removeListener('did-start-navigation', onNav); wc.removeListener('destroyed', onGone); }
      entry.picking = false;
      if (!entry.win.isDestroyed()) entry.win.setTitle(titleFor(entry.project, false));
    }
  }

  async function send(entry, m) {
    const wc = entry.win.webContents;
    const picks = pointing.cleanPicks(m.picks);
    if (!picks.length) return;
    const view = pointing.cleanRect({ x: 0, y: 0, width: m.view?.width, height: m.view?.height });
    const rect = view && pointing.cropRect(picks, view, { zoom: wc.getZoomFactor?.() || 1 });
    /** @type {string | null} */
    let picture = null;
    if (rect) {
      await wait(REPAINT_MS);
      const img = await within(wc.capturePage(rect).catch(() => null), CAPTURE_TIMEOUT_MS);
      if (img && !img.isEmpty()) picture = pointing.savePicture(deps.picturesDir, img.toPNG(), crypto.randomUUID());
    }
    const text = pointing.devMessage({ ask: m.ask, picks, url: wc.getURL(), hasPicture: !!picture });
    deps.onPicked({ root: entry.root, text, files: picture ? [picture] : [] });
  }

  /** Open (or bring back) the window for a dev server, pointing straight away. */
  function show({ id, url, root, project }) {
    const origin = localOrigin(url);
    if (!origin || typeof root !== 'string' || !root) return { ok: false, error: "That dev server isn't on this PC." };
    const had = open.get(id);
    if (had && !had.win.isDestroyed()) {
      if (had.win.isMinimized()) had.win.restore();
      had.win.show();
      if (!had.picking) pick(had);
      return { ok: true };
    }
    const ses = electron.session.fromPartition(PARTITION, { cache: false });
    lock(ses);
    const win = new electron.BrowserWindow({
      width: WIDTH, height: HEIGHT, show: false, title: titleFor(project, false), autoHideMenuBar: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, session: ses, webSecurity: true, spellcheck: false },
    });
    const entry = { win, picking: false, root, project: String(project || '') };
    open.set(id, entry);
    win.setMenu(menuFor(entry));
    const wc = win.webContents;
    const sameOrigin = target => { try { return new URL(target).origin === origin; } catch { return false; } };
    for (const ev of ['will-navigate', 'will-redirect']) {
      wc.on(ev, (e, target) => {
        const to = target ?? e?.url;
        if (!sameOrigin(to)) { e.preventDefault(); if (ev === 'will-navigate') external(to); }
      });
    }
    wc.on('will-attach-webview', e => e.preventDefault());
    wc.setWindowOpenHandler(({ url: to }) => { external(to); return { action: 'deny' }; });
    // The page sets its own title; the window keeps saying how to point.
    win.on('page-title-updated', e => e.preventDefault());
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => { if (open.get(id) === entry) open.delete(id); });
    let first = true;
    wc.on('did-finish-load', () => { if (first) { first = false; pick(entry); } });
    wc.loadURL(url).catch(err => deps.log?.info?.(`dev point: couldn't load ${origin}: ${err.message}`));
    return { ok: true };
  }

  function closeAll() {
    for (const { win } of open.values()) { try { if (!win.isDestroyed()) win.destroy(); } catch { /* gone */ } }
    open.clear();
  }

  return { open: show, closeAll };
}

module.exports = { createDevPoint, pickScript, titleFor, WORLD_ID, POINT_KEY };
