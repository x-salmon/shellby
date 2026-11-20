// Engineer mode's IPC (wiring/engineer.js): the chip turns it on for one
// conversation, and the decision card's buttons answer Claude. Each message to
// Claude goes from one of these, pressed by you.
// Kept out of main.js, which only wires it up.
const { ID, obj, opt, text, str } = require('../ipc-args');
const { MAX_NOTE } = require('../engineer');

const WHAT = str({ max: 10, re: /^(approve|pick|return|close)$/ });
const OPTION = v => Number.isInteger(v) && v >= 0 && v < 10;
const OFF = { ok: false, error: "Engineer mode isn't ready yet." };

/**
 * @param {import('../ipc-guard').GuardedIpc} ipcMain  main's, behind ipc-guard.js
 * @param d  what main shares with its IPC (main.js ipcDeps)
 */
function registerEngineerIpc(ipcMain, d) {
  ipcMain.handle('engineer:set', (_e, { tabId, on } = {}) => (d.engineer ? d.engineer.set(tabId, !!on) : OFF),
    [obj({ tabId: ID, on: v => typeof v === 'boolean' })]);
  ipcMain.handle('engineer:act', (_e, { tabId, id, what, option, note } = {}) => (d.engineer ? d.engineer.act(tabId, id, { what, option, note }) : OFF),
    [obj({ tabId: ID, id: ID, what: WHAT, option: opt(OPTION), note: opt(text(MAX_NOTE)) })]);
}

module.exports = { registerEngineerIpc };
