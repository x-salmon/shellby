// Community news (wiring/news.js, news.js): what's current, and closing a
// card. The panel also hears `news` with the same { on, items, contest }.
// Credits (credits.js): the Made by list on About.

const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/; // news.js ID_RE

/**
 * @param {Pick<import('electron').IpcMain, 'handle' | 'on'>} ipcMain  main's, behind ipc-guard.js
 * @param d  what main shares with its IPC (main.js `shared`)
 */
function registerNewsIpc(ipcMain, d) {
  ipcMain.handle('news:get', () => d.newsView());
  ipcMain.handle('news:dismiss', (_e, id) => (typeof id === 'string' && ID_RE.test(id) ? d.dismissNews(id) : d.newsView()));
  ipcMain.handle('credits:get', () => d.creditsView?.() || { groups: [], mine: null });
}

module.exports = { registerNewsIpc };
