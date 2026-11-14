// Pages from the panel (wiring/pages.js): the shelf, a page's view, its data,
// History and access, and the bridge calls the panel passes on from a page's
// frame. The panel names the page by which frame a call came from; main
// decides whether it's allowed (pages/rights.js).
// Kept out of main.js, which only wires it up.
const { either, list, obj, opt, str, text } = require('../ipc-args');

const PAGE_ID = str({ max: 60, re: /^(?:[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?|draft-[a-z0-9]{8})$/ });
const METHOD = str({ max: 20, re: /^[a-z.]+$/ });
const KEY = str({ max: 100 });
const META = obj({ enabled: opt(v => typeof v === 'boolean'), pinned: opt(v => typeof v === 'boolean'), notifyOn: opt(v => typeof v === 'boolean') });
const OPS = obj({ set: opt(obj()), remove: opt(list(KEY, 200)), append: opt(obj()) });
const VERSION = v => Number.isInteger(v) && v > 0 && v < 1e6;
const AGENTS = str({ max: 10, re: /^(any|shellby|none)$/ });
const TAB = str({ max: 100 });

/**
 * @param {import('../ipc-guard').GuardedIpc} ipcMain  main's, behind ipc-guard.js
 * @param d  what main shares with its IPC (main.js ipcDeps)
 */
function registerPagesIpc(ipcMain, d) {
  ipcMain.handle('pages:list', () => d.pages.list());
  ipcMain.handle('pages:view', (_e, id) => d.pages.view(id), [PAGE_ID]);
  ipcMain.handle('pages:drafts', (_e, tab) => d.pages.draftsOf(tab), [TAB]);
  // A page's bridge call; args are bounded by the panel's 256 KB message cap and checked again in rights.js.
  ipcMain.handle('pages:call', (_e, id, method, args) => d.pages.call(id, method, args), [PAGE_ID, METHOD, list(() => true, 10)]);
  ipcMain.handle('pages:data', (_e, id) => d.pages.data(id), [PAGE_ID]);
  ipcMain.handle('pages:write', (_e, id, ops) => d.pages.writeYou(id, ops), [PAGE_ID, OPS]);
  ipcMain.handle('pages:activity', (_e, id) => d.pages.activity(id), [PAGE_ID]);
  ipcMain.handle('pages:files', (_e, id, n) => d.pages.files(id, n ?? undefined), [PAGE_ID, opt(VERSION)]);
  ipcMain.handle('pages:set', (_e, id, patch) => d.pages.setMeta(id, patch), [PAGE_ID, META]);
  ipcMain.handle('pages:agents', (_e, id, agents) => d.pages.setAgents(id, agents), [PAGE_ID, AGENTS]);
  ipcMain.handle('pages:agree', (_e, id, version) => d.pages.agree(id, version), [PAGE_ID, VERSION]);
  ipcMain.handle('pages:addHost', (_e, id, host) => d.pages.addHost(id, host), [PAGE_ID, str({ max: 253 })]);
  ipcMain.handle('pages:revert', (_e, id, n) => d.pages.revert(id, n), [PAGE_ID, VERSION]);
  ipcMain.handle('pages:remove', (_e, id) => d.pages.remove(id), [PAGE_ID]);
  ipcMain.handle('pages:save', (_e, id) => d.pages.saveDraft(id), [PAGE_ID]);
  ipcMain.handle('pages:broken', (_e, id, message) => d.pages.broken(id, message), [PAGE_ID, either(text(500), v => v === null)]);
  ipcMain.handle('pages:offAll', () => d.pages.offAll());
  const NUM = v => Number.isFinite(v) && v >= 0 && v < 100_000;
  ipcMain.handle('pages:thumb', (_e, id, rect) => d.pages.thumb(id, rect), [PAGE_ID, obj({ x: NUM, y: NUM, width: NUM, height: NUM })]);
  ipcMain.handle('pages:ask', (_e, id, prompt, mode) => d.pages.ask(id, prompt, mode), [PAGE_ID, text(2000), str({ max: 10, re: /^(ask|plan)$/ })]);
  ipcMain.handle('pages:build', (_e, describe) => d.pages.build(describe), [text(2000)]);
  ipcMain.handle('pages:change', (_e, id, o) => d.pages.change(id, o || {}), [PAGE_ID, opt(obj({ ask: opt(text(2000)), error: opt(text(500)), pointed: opt(obj({ text: opt(text(200)), selector: opt(text(200)) })) }))]);
}

module.exports = { registerPagesIpc };
