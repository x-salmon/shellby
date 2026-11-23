// Shellby as a Mac app: the menu bar (without an Edit menu, Cmd+C and Cmd+V do
// nothing in his windows), the Dock, shellby:// links (they arrive as an event,
// not on the command line) and his windows on every Space.
//
// Windows needs none of this: wire() returns at once there. The menu template
// is pure (menuTemplate) and tested on any platform.
'use strict';

/**
 * The app menu. Cmd+W isn't a menu item: the panel's own Ctrl+W (Cmd+W on a
 * Mac, renderer/shared/mac-keys.js) closes a conversation, not the window.
 * @param {{ name: string, showPanel: () => void, openSettings: () => void, newConversation: () => void, quit: () => void, help: () => void }} act
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function menuTemplate(act) {
  return [
    {
      label: act.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: act.openSettings },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        // Through Shellby's own quit, which asks about dev servers and stops his tasks in order.
        { label: `Quit ${act.name}`, accelerator: 'Cmd+Q', click: act.quit },
      ],
    },
    {
      label: 'File',
      submenu: [{ label: 'New Conversation', click: act.newConversation }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Speech', submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }] },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
        { label: 'Show Shellby', click: act.showPanel },
        { role: 'front' },
      ],
    },
    { role: 'help', submenu: [{ label: 'Shellby Help', click: act.help }] },
  ];
}

/**
 * d: what main shares. Call once, before the app is ready, so a link that
 * opened Shellby isn't missed.
 * @param {any} d
 * @param {{ app: Electron.App, Menu: typeof Electron.Menu, onLink: (url: string) => void }} electron
 */
function wire(d, { app, Menu, onLink }) {
  if (process.platform !== 'darwin') return;

  // Before ready: a link that launched him arrives straight away.
  app.on('open-url', (e, url) => {
    e.preventDefault();
    onLink(url);
  });

  app.whenReady().then(() => {
    const act = {
      name: app.getName(),
      showPanel: () => d.showPanel(),
      openSettings: () => { d.showPanel({ focusInput: false }); d.send(d.panel, 'panel:view', 'settings'); },
      newConversation: () => { d.showPanel(); d.send(d.panel, 'tab:new-request'); },
      quit: () => (d.quit ? d.quit() : app.quit()),
      help: () => require('./safe-open').openSafe('https://getshellby.com/'),
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(act)));
    app.dock?.setMenu(Menu.buildFromTemplate([
      { label: 'New Conversation', click: act.newConversation },
      { label: 'Settings…', click: act.openSettings },
    ]));
  });

  // The Dock icon clicked with nothing open: the panel, as the tray icon does on Windows.
  app.on('activate', () => { if (d.booted) d.showPanel(); });
}

/**
 * His windows (the crab, the floor strip): on every Space, so switching desktops
 * doesn't leave him behind, but not over a fullscreen app's Space.
 * @param {Electron.BrowserWindow} win
 */
function everySpace(win) {
  if (process.platform !== 'darwin' || !win || win.isDestroyed()) return;
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
  win.setHiddenInMissionControl?.(true);
}

module.exports = { wire, menuTemplate, everySpace };
