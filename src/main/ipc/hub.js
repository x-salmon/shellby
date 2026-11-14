// The hub's screen, Your PCs (wiring/hub.js): the roster, adding and removing a
// PC, renaming one, starting a task on one, and trying the unreachable ones again.
// Kept out of main.js, which only wires it up.
const { ID, obj, opt, str, text } = require('../ipc-args');

// The modes a task on another PC may start in (pcs.js): never Autonomous from here.
const MODE = /^(ask|smart|acceptEdits|plan)$/;
const TAB = str({ re: /^[\w-]{1,100}$/ });
const DECISION = /^(allow|always|deny)$/;
// A question's answers: up to 4 questions, each answered in words.
const answersOk = v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 4
  && Object.entries(v).every(([q, a]) => q.length <= 300 && typeof a === 'string' && a.length <= 2000);

/**
 * @param {import('../ipc-guard').GuardedIpc} ipcMain  main's, behind ipc-guard.js
 * @param d  what main shares with its IPC (main.js ipcDeps)
 */
function registerHubIpc(ipcMain, d) {
  ipcMain.handle('hub:view', (_e, focus) => d.hub.hubView(focus), [opt(ID)]);
  ipcMain.handle('hub:add', (_e, req) => d.hub.addPc(req), [obj({ address: str({ max: 300 }), code: str({ max: 32 }), name: opt(text(40)) })]);
  ipcMain.handle('hub:remove', (_e, id) => d.hub.removePc(id), [ID]);
  ipcMain.handle('hub:rename', (_e, id, name) => d.hub.renamePc(id, name), [ID, str({ max: 40 })]);
  ipcMain.handle('hub:task', (_e, id, req) => d.hub.startOn(id, req), [ID, obj({ project: str({ max: 600 }), text: str({ max: 4000 }), mode: opt(str({ re: MODE })) })]);
  ipcMain.handle('hub:retry', () => d.hub.retryAll());
  // Acting on a conversation there (pcs-talk.js): each goes through that PC's own phone rules.
  ipcMain.handle('hub:answer', (_e, id, req) => d.hub.answerOn(id, req), [ID, obj({ tabId: TAB, requestId: str({ max: 100 }), decision: str({ re: DECISION }), answers: opt(answersOk), read: opt(v => v === true) })]);
  ipcMain.handle('hub:reply', (_e, id, req) => d.hub.replyOn(id, req), [ID, obj({ tabId: TAB, text: str({ max: 4000 }) })]);
  ipcMain.handle('hub:open', (_e, id, tabId) => d.hub.openConvo(id, tabId), [ID, TAB]);
  ipcMain.handle('hub:close', () => d.hub.closeConvo());
  ipcMain.handle('hub:convo', (_e, known) => d.hub.convoView(known), [opt(v => Number.isSafeInteger(v) && Number(v) >= 0)]);
}

module.exports = { registerHubIpc };
