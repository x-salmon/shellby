// A bare Chromium for an e2e check: Electron running this file opens the one
// URL it's given in a window off every screen, with no Node in the page, and
// writes DevToolsActivePort in its data folder for the check to connect to.
//
//   electron.exe scripts/lib/phone-browser.js --remote-debugging-port=0 http://127.0.0.1:47916/
//   PHONE_BROWSER_DATA=<dir>  where its profile (storage, service worker) and DevToolsActivePort go
//
// The phone app is a web app, so a check that wants to drive it for real (the
// sandboxed frame, the bridge over postMessage, the service worker's cache)
// needs a browser, and the Electron the app already ships with is one.
// Painting stays on off screen (no occlusion count), so requestAnimationFrame
// runs: a page says "ready" from one (pages/page-side/shellby.js).
const { app, BrowserWindow } = require('electron');

const url = process.argv.find(a => /^https?:\/\//.test(a));
if (process.env.PHONE_BROWSER_DATA) app.setPath('userData', process.env.PHONE_BROWSER_DATA);
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    x: -15000, y: 0, width: 420, height: 820, show: true, focusable: false, skipTaskbar: true, thickFrame: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.loadURL(url || 'about:blank');
});
app.on('window-all-closed', () => app.quit());
