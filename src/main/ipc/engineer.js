// Engineer mode's IPC (wiring/engineer.js): the chip turns it on for one
// conversation, the cards' buttons answer Claude, and the note under the box
// shows and changes the project's settings. Each message to Claude goes from
// one of these, pressed by you.
// Kept out of main.js, which only wires it up.
const { ID, obj, opt, text, str } = require('../ipc-args');
const { MAX_NOTE } = require('../engineer');
const { MAX_ALLOW } = require('../engineer-gate');

const WHAT = str({ max: 12, re: /^(approve|pick|return|close|critic|spike-first|amend-yes|amend-no|spike-yes|spike-no|spike-stop)$/ });
const OPTION = v => Number.isInteger(v) && v >= 0 && v < 10;
const BOOL = v => typeof v === 'boolean';
// The commands you let Claude run before a decision: checked again by engineer-gate.js readAllow.
const ALLOW = v => Array.isArray(v) && v.length <= MAX_ALLOW && v.every(c => typeof c === 'string' && c.length <= 200);
const OFF = { ok: false, error: "Engineer mode isn't ready yet." };

/**
 * @param {import('../ipc-guard').GuardedIpc} ipcMain  main's, behind ipc-guard.js
 * @param d  what main shares with its IPC (main.js ipcDeps)
 */
function registerEngineerIpc(ipcMain, d) {
  ipcMain.handle('engineer:set', (_e, { tabId, on } = {}) => (d.engineer ? d.engineer.set(tabId, !!on) : OFF),
    [obj({ tabId: ID, on: BOOL })]);
  ipcMain.handle('engineer:act', (_e, { tabId, id, what, option, note } = {}) => (d.engineer ? d.engineer.act(tabId, id, { what, option, note }) : OFF),
    [obj({ tabId: ID, id: ID, what: WHAT, option: opt(OPTION), note: opt(text(MAX_NOTE)) })]);
  ipcMain.handle('engineer:project', (_e, { tabId } = {}) => (d.engineer ? d.engineer.projectFor(tabId) : OFF),
    [obj({ tabId: ID })]);
  ipcMain.handle('engineer:project-set', (_e, { tabId, on, allow } = {}) => (d.engineer ? d.engineer.setProject(tabId, { on, allow }) : OFF),
    [obj({ tabId: ID, on: opt(BOOL), allow: opt(ALLOW) })]);
}

module.exports = { registerEngineerIpc };
