// Renders each direction offscreen at 2560 × 1440 (a 4K screen at 150%) into shots/.
//   node_modules/electron/dist/electron.exe mockups/tank-page/shoot.js
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const W = 2560, H = 1440;
const NAMES = ['1', '2', '3', '4', '5', '6', '7', '7b', '7c']; // in page order
const SCREENS = NAMES.length;
const out = path.join(__dirname, 'shots');

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);
  try {
    for (let n = 1; n <= SCREENS; n++) {
      await win.loadFile(path.join(__dirname, 'index.html'), { search: `screen=${n}&still=1` });
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 300)))');
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
      fs.writeFileSync(path.join(out, `tank-${NAMES[n - 1]}.png`), img.toPNG());
    }
  } finally {
    win.destroy();
    app.quit();
  }
});
