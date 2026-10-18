// Renders the phone app's screenshots for the docs (docs/img/screenshot-phone-*.png)
// from the preview's made-up Shellby (scripts/pocket-preview.js), at an iPhone's
// size and pixel density. Nothing in them is anyone's real data.
//
//   npx electron scripts/pocket-shots.js [outDir]
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(ROOT, 'docs', 'img'));
const PORT = 47989;
const BASE = `http://127.0.0.1:${PORT}/`;
const TOKEN = 'p'.repeat(43); // the preview's own token (pocket-preview.js)
const W = 390, H = 844;
const wait = ms => new Promise(r => setTimeout(r, ms));

// Each picture: where, what to do first, and how long to let it settle.
const SHOTS = [
  { name: 'beach', hash: '#/' },
  { name: 'ask', hash: '#/tab/flaky', scroll: 'bottom' },
  { name: 'review', hash: '#/tab/tailnet' },
  { name: 'diff', hash: '#/diff/tailnet/a1b2c3' },
  { name: 'task', hash: '#/', then: "document.querySelector('.fab').click()", settle: 900 },
];

app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.whenReady().then(async () => {
  const preview = spawn(process.execPath, [path.join(__dirname, 'pocket-preview.js'), '--port', String(PORT)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore',
  });
  // Shown, because a hidden window stops painting, but never focused and not in the taskbar.
  const win = new BrowserWindow({ width: W, height: H, useContentSize: true, show: false, focusable: false, skipTaskbar: true, webPreferences: { sandbox: true } });
  win.showInactive();
  win.webContents.setUserAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36');
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(BASE); break; } catch { await wait(150); } }
    await win.loadURL(BASE);
    await win.webContents.executeJavaScript(`localStorage.setItem('shellby.pocket.token', ${JSON.stringify(TOKEN)}); true`);
    fs.mkdirSync(OUT, { recursive: true });
    for (const s of SHOTS) {
      // A fresh page each time (the query keeps a same-page hash change from being all that happens).
      await win.loadURL(`${BASE}?shot=${s.name}${s.hash}`);
      await win.webContents.insertCSS('::-webkit-scrollbar { display: none; }');
      await wait(1600);
      if (s.scroll === 'bottom') await win.webContents.executeJavaScript("document.querySelector('.scroll').scrollTop = 1e6; true");
      if (s.then) { await win.webContents.executeJavaScript(`${s.then}; true`); await wait(s.settle || 400); }
      const img = await win.webContents.capturePage();
      const file = path.join(OUT, `screenshot-phone-${s.name}.png`);
      fs.writeFileSync(file, img.toPNG());
      console.log(`${path.relative(ROOT, file)} ${img.getSize().width}×${img.getSize().height}`);
    }
  } finally {
    preview.kill();
    win.destroy();
    app.quit();
  }
});
