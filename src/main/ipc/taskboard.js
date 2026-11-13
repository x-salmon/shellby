// The task board on a project's page (wiring/taskboard.js): what's on it, and
// cancelling a task. Conversations do everything else through their tools.
// Kept out of main.js, which only wires it up.
const { PATH, str } = require('../ipc-args');

const TASK_ID = str({ max: 20, re: /^b-[a-z0-9]{6,12}$/ });

/**
 * @param {import('../ipc-guard').GuardedIpc} ipcMain  main's, behind ipc-guard.js
 * @param d  what main shares with its IPC (main.js ipcDeps)
 */
function registerTaskBoardIpc(ipcMain, d) {
  ipcMain.handle('taskboard:view', (_e, root) => d.taskBoard.view(root), [PATH]);
  ipcMain.handle('taskboard:cancel', (_e, id) => d.taskBoard.cancelByUser(id), [TASK_ID]);
}

module.exports = { registerTaskBoardIpc };
