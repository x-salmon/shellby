const { ID } = require('../ipc-args');

// Moving a conversation between Shellby and a terminal (wiring/handoff.js).
// Kept out of main.js, which only wires it up.

/**
 * @param {import('../ipc-guard').GuardedIpc} ipcMain  main's, behind ipc-guard.js
 * @param d  what main shares (main.js `shared`); d.handoff is wireHandoff's
 */
function registerHandoffIpc(ipcMain, d) {
  // A tab, or a History row that may not be open.
  ipcMain.handle('handoff:terminal', (_e, id) => (d.isStr(id) ? d.handoff.continueInTerminal(id) : { ok: false, error: 'Which conversation?' }));
  ipcMain.handle('handoff:pickup', (_e, tabId) => (d.isStr(tabId) ? d.handoff.pickUp(tabId) : { ok: false, error: 'Which conversation?' }));
  // An outside session, by its Claude Code id. force: you've said it's closed there.
  ipcMain.handle('handoff:bring', (_e, { id, force } = {}) => d.handoff.bringIn({ id: d.isStr(id) ? id : null, force: force === true }));
  // Claude Code's background sessions (wiring/bg-sessions.js), by agent view's id.
  ipcMain.handle('bg:list', async () => { await d.bgSessions.refresh(); return d.bgSessions.view(); });
  ipcMain.handle('bg:logs', (_e, id) => d.bgSessions.logs(id), [ID]);
  ipcMain.handle('bg:open', (_e, id) => d.bgSessions.open(id), [ID]);
  ipcMain.handle('bg:stop', (_e, id) => d.bgSessions.stop(id), [ID]);
  ipcMain.handle('bg:respawn', (_e, id) => d.bgSessions.respawn(id), [ID]);
  ipcMain.handle('bg:remove', (_e, id) => d.bgSessions.remove(id), [ID]);
  // A cloud session in a terminal: { kind: teleport | cloud | ultraplan | pr, value?, tabId? } (handoff.js cloudArgs checks the rest).
  ipcMain.handle('handoff:cloud', (_e, { kind, value, tabId } = {}) => (['teleport', 'cloud', 'ultraplan', 'pr'].includes(kind)
    ? d.handoff.openCloud({ kind, value: d.isStr(value) ? value : null, tabId: d.isStr(tabId) ? tabId : null })
    : { ok: false, error: 'Which kind of cloud session?' }));
}

module.exports = { registerHandoffIpc };
