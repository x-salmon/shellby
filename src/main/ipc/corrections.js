// Learning from corrections: the review comments the panel sends (they never
// pass through main otherwise), the learned-rule card's buttons, and the list
// in Toolbox → Memory. The wiring (wiring/corrections.js) checks every id and
// project against what it knows, so the panel can't aim a write anywhere else.

const { ID, PATH, list, num, obj, opt, text } = require('../ipc-args');

const MAX_COMMENTS = 50;
const RULE = opt(text(10_000)); // ruleText cuts at 1,000; longer only reads as none
const isId = s => typeof s === 'string' && s.length > 0 && s.length <= 80;
const ruleText = s => (typeof s === 'string' && s.length <= 1000 ? s : '');

/**
 * @param {import('../ipc-guard').GuardedIpc} ipcMain  main's, behind ipc-guard.js
 * @param d  what main shares with its IPC (main.js ipcDeps)
 */
function registerCorrectionsIpc(ipcMain, d) {
  // A review just went: each comment is one correction, the review one occasion.
  ipcMain.handle('corrections:comments', async (_e, { tabId, comments, batch } = {}) => {
    if (!d.isStr(tabId) || !Array.isArray(comments) || !isId(batch)) return false;
    for (const c of comments.slice(0, MAX_COMMENTS)) {
      if (!c || !d.isStr(c.body)) continue;
      await d.noteCorrection(tabId, { kind: 'comment', text: c.body.slice(0, 4000), files: d.isStr(c.file) ? [c.file] : [], batch });
    }
    if (d.manager?.tabs.has(tabId) && comments.some(c => c && d.isStr(c.body))) d.questDone?.('comment');
    if (d.manager?.tabs.has(tabId)) d.reviewComments?.(tabId, comments.slice(0, MAX_COMMENTS)); // review mastery (wiring/review.js)
    return true;
  }, [obj({ tabId: ID, comments: list(obj(), 500), batch: ID })]);
  ipcMain.handle('lesson:state', (_e, id) => (isId(id) ? d.lessonState(id) : null), [ID]);
  ipcMain.handle('lesson:preview', (_e, { id, rule } = {}) => (isId(id) ? d.lessonPreview(id, ruleText(rule)) : { ok: false }), [obj({ id: ID, rule: RULE })]);
  ipcMain.handle('lesson:add', (_e, { id, rule, added } = {}) => (isId(id) && typeof added === 'string' ? d.addLesson(id, ruleText(rule), added) : { ok: false }), [obj({ id: ID, rule: RULE, added: text(10_000) })]);
  ipcMain.handle('lesson:dismiss', (_e, id) => (isId(id) ? d.dismissLesson(id) : { ok: false }), [ID]);
  ipcMain.handle('lesson:draft', (_e, id) => (isId(id) ? d.draftLesson(id) : { ok: false }), [ID]);
  ipcMain.handle('learned:list', () => d.learnedView());
  ipcMain.handle('learned:change', (_e, { root, index, was, text } = {}) => d.changeLearned({ root, index, was, text: text == null ? null : ruleText(text) }),
    [obj({ root: PATH, index: num({ int: true, min: 0 }), was: text(10_000), text: RULE })]);
}

module.exports = { registerCorrectionsIpc };
