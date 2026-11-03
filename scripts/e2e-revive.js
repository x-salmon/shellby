// ci: a crashed panel renderer reloads by itself and boots again
// End-to-end check of window recovery (src/main/window-revive.js) against the
// dev app over CDP (throwaway profile, the fake Claude CLI): the panel's renderer
// is crashed for real with Page.crash, and a fresh page boots in its place.
//   node scripts/e2e-revive.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { panelBooted } = require('./lib/boot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9391;
const TARGET_TRIES = 40;
const wait = ms => new Promise(r => setTimeout(r, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise(r => { ws.onopen = r; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  return { ws, send, ev };
}

async function panelTarget() {
  for (let i = 0; i < TARGET_TRIES; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const found = list.find(t => t.url.endsWith('panel.html'));
      if (found) return found;
    } catch { /* starting */ }
    await wait(500);
  }
  throw new Error('the panel never appeared');
}

(async () => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-revive-')));
  const profile = path.join(base, 'userdata');
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ onboarded: true, crabOnly: false }));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: {
      ...process.env, SHELLBY_USER_DATA: profile, CLAUDE_CONFIG_DIR: path.join(base, 'claude'),
      SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47996',
    },
  });
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  let panel = null;
  try {
    panel = await connect((await panelTarget()).webSocketDebuggerUrl);
    await panelBooted(panel.ev);
    await panel.ev('window.__beforeCrash = true');
    panel.send('Page.crash').catch(() => {});
    await wait(1500);
    panel.ws.close();
    panel = await connect((await panelTarget()).webSocketDebuggerUrl);
    await panelBooted(panel.ev);
    check(true, 'the panel booted again after its renderer crashed');
    check(await panel.ev('window.__beforeCrash') === undefined, 'it is a fresh page, not the one that crashed');
  } catch (e) {
    check(false, e.stack || e.message);
  } finally {
    app.kill();
    panel?.ws.close();
    await wait(800);
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* in use */ }
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exitCode = fails ? 1 : 0;
})();
