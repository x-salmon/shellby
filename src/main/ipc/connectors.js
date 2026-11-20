// Settings → Connectors: one MCP gateway for every agent (connectors/).
// The panel sends a gateway once to save it and never gets it back: only its
// site's host, whether there's a key and the key's last four, and the switches.
const { bool, obj, opt, str, text } = require('../ipc-args');
const { cleanSwitches } = require('../connectors/gateway');

const NONE = { saved: false, host: null, hint: null, preset: null, on: false, claude: true, agents: true, canEncrypt: false, presets: [] };

/**
 * @param {import('../ipc-guard').GuardedIpc} ipcMain  main's, behind ipc-guard.js
 * @param {any} d
 */
function registerConnectorsIpc(ipcMain, d) {
  const view = () => d.connectors?.view() || NONE;
  ipcMain.handle('connectors:view', () => view());
  // Saving a gateway leaves it off until you turn it on.
  ipcMain.handle('connectors:save', (_e, raw) => {
    const r = d.connectors ? d.connectors.save(raw) : { ok: false, error: 'Not available in this run.' };
    return { ...r, view: view() };
  }, [obj({ url: text(2000), key: opt(text(4000)), header: opt(text(64)), preset: opt(str({ max: 40 })) })]);
  ipcMain.handle('connectors:clear', () => {
    d.connectors?.clear();
    d.config.set({ connectors: { ...cleanSwitches(d.config.get('connectors')), on: false } });
    return { ok: true, view: view() };
  });
  // The switches: on, and which agents get it. New conversations pick it up; open ones keep what they started with.
  ipcMain.handle('connectors:switches', (_e, raw) => {
    const next = cleanSwitches({ ...cleanSwitches(d.config.get('connectors')), ...raw });
    if (next.on && !view().saved) return { ok: false, error: 'Save a gateway first.', view: view() };
    d.config.set({ connectors: next });
    return { ok: true, view: view() };
  }, [obj({ on: opt(bool), claude: opt(bool), agents: opt(bool) })]);
  ipcMain.handle('connectors:test', () => (d.connectors ? d.connectors.test() : { ok: false, error: 'Not available in this run.' }));
}

module.exports = { registerConnectorsIpc };
