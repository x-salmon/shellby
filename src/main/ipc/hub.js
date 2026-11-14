// The hub's screen, Your PCs (wiring/hub.js): the roster, adding and removing a
// PC, renaming one, starting a task on one, and trying the unreachable ones again.
// Kept out of main.js, which only wires it up.
const { ID, obj, opt, str, text } = require('../ipc-args');

// The modes a task on another PC may start in (pcs.js): never Autonomous from here.
const MODE = /^(ask|smart|acceptEdits|plan)$/;

/**
 * @param {import('../ipc-guard').GuardedIpc} ipcMain  main's, behind ipc-guard.js
 * @param d  what main shares with its IPC (main.js ipcDeps)
 */
function registerHubIpc(ipcMain, d) {
  ipcMain.handle('hub:view', () => d.hub.hubView());
  ipcMain.handle('hub:add', (_e, req) => d.hub.addPc(req), [obj({ address: str({ max: 300 }), code: str({ max: 32 }), name: opt(text(40)) })]);
  ipcMain.handle('hub:remove', (_e, id) => d.hub.removePc(id), [ID]);
  ipcMain.handle('hub:rename', (_e, id, name) => d.hub.renamePc(id, name), [ID, str({ max: 40 })]);
  ipcMain.handle('hub:task', (_e, id, req) => d.hub.startOn(id, req), [ID, obj({ project: str({ max: 600 }), text: str({ max: 4000 }), mode: opt(str({ re: MODE })) })]);
  ipcMain.handle('hub:retry', () => d.hub.retryAll());
}

module.exports = { registerHubIpc };
