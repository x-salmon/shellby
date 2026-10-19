// ci: Shellby on your phone: turned on, a phone paired, a task from it allowed, diffed and undone
// End-to-end check of Shellby on your phone (wiring/pocket.js) on the real app,
// with a stand-in Tailscale (test/fixtures/fake-tailscale.js) and the fake CLI:
//   1. turning it on asks in the confirmation window, then serves the app
//   2. a code from Settings pairs a "phone"; a wrong one doesn't, and nothing
//      gets in through Tailscale as someone else, or from another Host
//   3. the phone starts a task: it runs in Ask first, in its own copy, marked 📱
//   4. its permission prompt reaches the phone's stream, and Allow from there answers it
//   5. the turn's diff and its Undo, named by the turn, never by a path
//   6. turned off, the port is closed
//   node scripts/e2e-pocket.js [screenshotDir]
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { savePng } = require('./lib/shot');
const { DNS, LOGIN } = require('../test/fixtures/fake-tailscale');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9377;
const HOOK = Number(process.env.E2E_HOOK_PORT) || 47986;
const POCKET = Number(process.env.E2E_SPARE_PORT) || 47987;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-pocket-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const BASE = `http://127.0.0.1:${POCKET}`;

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  return { ev, send, close: () => ws.close() };
}

// A request as it would arrive through `tailscale serve`, with its own Host and who it's from.
function viaTailnet(route, login, headers = {}) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: POCKET, path: route, agent: false, headers: { Host: DNS, 'Tailscale-User-Login': login, ...headers } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0));
    req.end();
  });
}

const api = (route, { token, body, method } = {}) => fetch(`${BASE}/pocket/v1/${route}`, {
  method: method || (body ? 'POST' : 'GET'),
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async r => ({ status: r.status, json: await r.json().catch(() => null), headers: r.headers }));

// The phone's live stream: every view it's sent, read as it comes.
function stream(token) {
  const views = [];
  const items = [];
  const ctrl = new AbortController();
  (async () => {
    try {
      const r = await fetch(`${BASE}/pocket/v1/events`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
      const reader = r.body.getReader();
      const text = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += text.decode(value, { stream: true });
        let at;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (!data) continue;
          if (name === 'view') views.push(JSON.parse(data));
          else items.push({ name, data: JSON.parse(data) });
        }
      }
    } catch { /* closed */ }
  })();
  return { views, items, last: () => views.at(-1), close: () => ctrl.abort() };
}

const untilTrue = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* not yet */ } await wait(150); } return false; };

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const data = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-pocket-data-')));
  const repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-pocket-repo-')));
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'user.name', 'e2e');
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  git('add', '.');
  git('commit', '-qm', 'first');

  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: {
      ...process.env, SHELLBY_E2E: '1', SHELLBY_USER_DATA: data, SHELLBY_HOOK_PORT: String(HOOK), SHELLBY_POCKET_PORT: String(POCKET),
      SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'),
      SHELLBY_FAKE_TAILSCALE: path.join(ROOT, 'test', 'fixtures', 'fake-tailscale.js'),
    },
  });
  let phone = null;
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    const panel = await connect(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    await wait(3000);
    await panel.ev("shellby.setSettings({ onboarded: true }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");
    await panel.ev(`shellby.setFolder(${JSON.stringify(repo)}).then(SB.folderChanged)`);
    await wait(500);

    // ---- 1. on, after a yes in the confirmation window
    const pressInDialog = async label => {
      let dlg = null;
      for (let i = 0; i < 40 && !dlg; i++) {
        try { dlg = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.url.endsWith('dialog.html')); } catch { /* not yet */ }
        if (!dlg) await wait(250);
      }
      if (!dlg) return null;
      const d = await connect(dlg.webSocketDebuggerUrl);
      await untilTrue(() => d.ev("document.activeElement?.tagName === 'BUTTON'"), 8000);
      const seen = await d.ev("({ title: document.getElementById('title').textContent, message: document.getElementById('message').textContent })");
      await d.ev(`{ const b = [...document.querySelectorAll('#actions button')].find(b => b.textContent === ${JSON.stringify(label)}); setTimeout(() => b.click(), 0); true; }`);
      d.close();
      return seen;
    };
    await panel.ev('window.__pocketOn = shellby.setPocket({ enabled: true }); true');
    const asked = await pressInDialog('Put him on my phone');
    check(asked?.title === 'Put Shellby on your phone?', `turning it on asks first (${asked?.title})`);
    check(new RegExp(LOGIN).test(asked?.message || ''), 'the question names the Tailscale login it is for');
    const on = await panel.ev('window.__pocketOn');
    check(on?.enabled === true && on?.server?.status === 'listening', `it's on and listening (${on?.server?.status})`);
    check(on?.url === `https://${DNS}/`, `Tailscale serves it on the tailnet (${on?.url})`);

    const page = await fetch(`${BASE}/`);
    check(page.status === 200 && /script-src 'self'/.test(page.headers.get('content-security-policy') || ''), 'the app is served, with its CSP');
    check((await fetch(`${BASE}/sw.js`)).status === 200 && (await fetch(`${BASE}/manifest.webmanifest`)).status === 200, 'its service worker and manifest are there');
    check((await fetch(`${BASE}/../package.json`)).status === 404, 'nothing outside the app is');

    // ---- 2. pairing
    const v = await panel.ev('shellby.newPocketCode()');
    const code = v?.code?.text;
    check(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code || ''), `Settings shows a code (${code})`);
    const wrong = await api('pair', { body: { code: 'AAAA-AAAA' } });
    check(wrong.status === 403 && !wrong.json?.token, 'a wrong code pairs nothing');
    const paired = await api('pair', { body: { code, name: 'e2e phone' } });
    const token = paired.json?.token;
    check(paired.status === 200 && typeof token === 'string', 'the right code pairs the phone');
    check((await api('pair', { body: { code } })).status === 403, 'the code works once');
    check((await api('hello', { token })).json?.paired === true, 'the phone is paired now');
    check((await api('events')).status === 401, 'the stream needs the token');
    check(await viaTailnet('/', LOGIN) === 200, 'through Tailscale, the login it was turned on with gets in');
    check(await viaTailnet('/', 'someone@else.com') === 403, 'through Tailscale, anyone else is turned away');
    check(await viaTailnet('/', LOGIN, { 'Tailscale-Funnel-Request': '?1' }) === 403, 'a Funnel request is turned away');
    const settings = await panel.ev('shellby.getPocket()');
    check(settings?.devices?.length === 1 && settings.devices[0].name === 'e2e phone', 'Settings lists the phone');

    // ---- 3. a task from the phone
    phone = stream(token);
    check(await untilTrue(() => phone.views.length > 0), 'the phone gets the view as soon as it connects');
    const first = phone.last();
    check(first?.projects?.some(p => p.key.toLowerCase() === repo.toLowerCase()), 'the folder you are in is a project the phone can pick');
    const started = await api('task', { token, body: { project: first.projects[0].key, text: 'editask notes.txt' } });
    const tabId = started.json?.tabId;
    check(started.json?.ok === true && !!tabId, `a task starts from the phone (${JSON.stringify(started.json)})`);
    const tab = () => phone.last()?.tabs?.find(t => t.id === tabId);
    check(await untilTrue(() => tab()?.fromPhone && tab()?.mode === 'ask'), `it runs in Ask first, marked as the phone's (${tab()?.mode})`);
    check(await untilTrue(() => !!tab()?.copy), 'in its own copy of the repo');
    check(await untilTrue(() => panel.ev(`/📱/.test(SB.state.tabs.get(${JSON.stringify(tabId)})?.title || '')`)), 'the desk has it too, marked 📱');

    // ---- 4. its prompt, on the phone, answered from it
    const promptOf = () => phone.last()?.prompts?.find(p => p.tabId === tabId);
    check(await untilTrue(() => !!promptOf()), 'its permission prompt reaches the phone');
    const p = promptOf();
    check(p?.deskOnly === null, `the phone may answer it (${p?.deskOnly})`);
    check((await api('answer', { token, body: { tabId, requestId: p.requestId, decision: 'always' } })).json?.ok === false, 'Always allow is refused when Claude Code offers none');
    const allowed = await api('answer', { token, body: { tabId, requestId: p.requestId, decision: 'allow' } });
    check(allowed.json?.ok === true, 'Allow from the phone answers it');
    check(await untilTrue(() => tab()?.ready?.after), 'the turn ends with changes to review');

    // ---- 5. its diff and its undo
    const after = tab().ready.after;
    const diff = await api(`diff?tab=${encodeURIComponent(tabId)}&after=${encodeURIComponent(after)}`, { token });
    check(diff.json?.ok === true && /notes\.txt/.test(diff.json.patch || ''), 'the phone reads the turn’s diff');
    const bad = await api(`diff?tab=${encodeURIComponent(tabId)}&after=nope`, { token });
    check(bad.json?.ok === false, 'a turn that isn’t this conversation’s has no diff');
    const undone = await api('undo', { token, body: { tabId, after } });
    check(undone.json?.ok === true, `Undo from the phone takes the turn back (${JSON.stringify(undone.json)})`);
    check(await untilTrue(() => !tab()?.ready), 'and it is no longer waiting for review');

    // A screenshot of Settings, to look at by eye.
    await panel.ev("document.querySelectorAll('.celebrate .cel-close').forEach(b => b.click()); true");
    await panel.ev("SB.setView('settings'); SB.jumpToSettingByName('On your phone'); true");
    await wait(900);
    await savePng(panel.send, path.join(OUT, 'pocket-settings.png'));

    // ---- 6. off
    phone.close();
    const off = await panel.ev('shellby.setPocket({ enabled: false })');
    check(off?.enabled === false && off?.server?.status === 'off', 'turned off, it stops');
    check(await untilTrue(async () => { try { await fetch(`${BASE}/pocket/v1/hello`); return false; } catch { return true; } }, 4000), 'and the port is closed');
    panel.close();
  } catch (err) {
    console.log('FAIL ', err.stack || err);
    fails++;
  } finally {
    phone?.close();
    app.kill();
    await wait(800);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* still held */ }
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* still held */ }
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  console.log(`screenshots: ${OUT}`);
  process.exit(fails ? 1 : 0);
})();
