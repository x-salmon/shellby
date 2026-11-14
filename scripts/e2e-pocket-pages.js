// ci: pocket pages: a page on the phone by capability, in the sandbox, its bridge decided on the PC, ask as a phone task
// Pages on your phone (docs/plans/shellby-pages.md, section 6), end to end: the
// real app with the fake CLI and the fake Tailscale, a "phone" over the API, and
// the phone app itself in a bare Chromium (scripts/lib/phone-browser.js):
//   1. three pages from a chat: one for the phone (asks for ask), one built for
//      the desk, one for the phone but turned off
//   2. the shelf over the API says which open on a phone; page-open hands out a
//      capability for the first only; every file comes with the page CSP
//      (sandbox, frame-ancestors 'self'), guard.js first, Origin "null" let in,
//      a wrong cap, a dodge and a token-less action turned away
//   3. the bridge over the API: a write signed as the page, a read it wasn't
//      given refused, an ask that starts nothing
//   4. the phone app for real: the Pages tab with the desk-only tile greyed,
//      the page in a sandboxed frame whose own bridge writes through the app,
//      a write at the desk reaching the frame, the page's ask as the phone's
//      sheet (Ask first or Plan only) starting a phone task in Plan, Change with
//      Claude from the desk-only page's screen, the pinned row on the beach
//   5. a read-only phone's page may read and not write
//   6. the PC asleep: the page's last snapshot, dated, read-only
// Screenshots go in [dir] (default %TEMP%\shellby-e2e-pocket-pages).
//   node scripts/e2e-pocket-pages.js [--shots <dir>]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { savePng } = require('./lib/shot');
const { panelBooted } = require('./lib/boot');
const { answerDialog } = require('./lib/dialog');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const PORT = Number(process.env.E2E_CDP_PORT) || 9397;
const HOOK = Number(process.env.E2E_HOOK_PORT) || 47997;
const POCKET = Number(process.env.E2E_SPARE_PORT) || 47998;
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : path.join(os.tmpdir(), 'shellby-e2e-pocket-pages');
const BASE = `http://127.0.0.1:${POCKET}`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const CAP_RE = /^\/pages\/[A-Za-z0-9_-]{43}\/index\.html$/;

// The page for the phone: draws its rows, signs where it ran (shellby-page: at
// the desk, http: on the phone), and asks Claude when a key says to.
const INDEX = '<!doctype html><html><head><meta charset="utf-8"><title>Print queue</title><link rel="stylesheet" href="style.css"><script src="shellby.js"></script><script src="app.js"></script></head><body><h1>Print queue</h1><ul id="rows"></ul></body></html>';
const STYLE = 'body { font: 15px system-ui; color: #eee; background: #1d2a22; margin: 16px; }';
const APP = [
  "async function draw() { const rows = (await shellby.data.get('rows')) || [];",
  "  document.getElementById('rows').replaceChildren(...rows.map(r => { const li = document.createElement('li'); li.textContent = String(r.name || r); return li; }));",
  "  await shellby.data.set({ seen: rows.length, where: location.protocol }); }",
  'shellby.data.onChange(c => {',
  "  if (c.keys.includes('askme')) shellby.ask('Why do these fail?', { mode: 'plan' }).catch(() => {});",
  "  else if (!c.keys.includes('seen') && !c.keys.includes('where')) draw();",
  '});',
  "window.addEventListener('DOMContentLoaded', draw);",
].join('\n');
const DESK_INDEX = '<!doctype html><html><head><meta charset="utf-8"><script src="shellby.js"></script></head><body><p>Wide</p></body></html>';

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((r, f) => { ws.onopen = r; ws.onerror = f; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  return { ev, send, close: () => ws.close() };
}

const api = (route, { token, body, method, headers = {} } = {}) => fetch(`${BASE}/pocket/v1/${route}`, {
  method: method || (body ? 'POST' : 'GET'),
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
}).then(async r => ({ status: r.status, json: await r.json().catch(() => null), headers: r.headers }));

// The phone's live stream: every view, and every page event, as they come.
function stream(token, page = null) {
  const views = [];
  const events = [];
  const ctrl = new AbortController();
  (async () => {
    try {
      const r = await fetch(`${BASE}/pocket/v1/events${page ? `?page=${encodeURIComponent(page)}` : ''}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
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
          if (name === 'view') views.push(JSON.parse(data)); else events.push({ name, data: JSON.parse(data) });
        }
      }
    } catch { /* closed */ }
  })();
  return { views, events, last: () => views.at(-1), close: () => ctrl.abort() };
}

const untilTrue = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { /* not yet */ } await wait(150); } return false; };

/** The phone app in a bare Chromium, off screen: -> { ev, send, close(), kill() } once its page answers. */
async function openPhone(url) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-phone-browser-'));
  const proc = spawn(ELECTRON, [path.join(ROOT, 'scripts', 'lib', 'phone-browser.js'), '--remote-debugging-port=0', url], {
    stdio: 'ignore', env: { ...process.env, PHONE_BROWSER_DATA: data, ELECTRON_RUN_AS_NODE: undefined },
  });
  const portFile = path.join(data, 'DevToolsActivePort');
  let port = 0;
  await untilTrue(() => { try { port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]); return port > 0; } catch { return false; } }, 30000);
  if (!port) throw new Error('the phone browser never said its port');
  let target = null;
  await untilTrue(async () => { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = list.find(t => t.type === 'page' && t.url.startsWith(url)); return !!target; }, 20000);
  if (!target) throw new Error('the phone browser never opened the app');
  const cdp = await connect(target.webSocketDebuggerUrl);
  // The target can be listed while it's still the blank first document: storage set there is lost.
  if (!await untilTrue(() => cdp.ev(`location.origin === ${JSON.stringify(new URL(url).origin)} && document.readyState === 'complete'`), 20000)) throw new Error('the phone app never loaded');
  return { ...cdp, kill: () => { try { cdp.close(); } catch { /* gone */ } proc.kill(); try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* held */ } } };
}

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  fs.mkdirSync(SHOTS, { recursive: true });
  const userData = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-pocket-pages-')));
  const app = spawn(ELECTRON, [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: {
      ...process.env, SHELLBY_E2E: '1', SHELLBY_USER_DATA: userData, SHELLBY_HOOK_PORT: String(HOOK), SHELLBY_POCKET_PORT: String(POCKET),
      SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'),
      SHELLBY_FAKE_TAILSCALE: path.join(ROOT, 'test', 'fixtures', 'fake-tailscale.js'),
    },
  });
  let phoneApi = null;
  let phone = null;
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    const panel = await connect(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    const { ev } = panel;
    const until = (expr, ms = 15000) => untilTrue(() => ev(expr), ms);
    await panelBooted(ev);
    await ev("shellby.setSettings({ onboarded: true, mode: 'smart', rooms: null }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");
    await ev('shellby.fitPanel?.({ width: 1500, height: 900 })');
    const tool = async (name, args) => {
      const before = await ev('SB.activeTab().items?.length ?? 0');
      await ev(`shellby.sendTask(SB.state.activeTab, ${JSON.stringify(`mcp ${name} ${JSON.stringify(args)}`)})`);
      await until(`!SB.activeTab().busy && (SB.activeTab().items?.length ?? 0) > ${before}`);
      await wait(300);
    };
    const data = id => ev(`shellby.pages.data(${JSON.stringify(id)}).then(d => d.values)`);
    const by = id => ev(`shellby.pages.data(${JSON.stringify(id)}).then(d => d.by)`);

    // ---- 1. three pages from a chat
    // A draft from the chat (e2e-pages.js checks the pane beside it), saved to the shelf as the Save button would.
    const make = async (args, id) => {
      await tool('create_page', args);
      const name = JSON.stringify(args.name);
      if (!await until(`shellby.pages.drafts(SB.state.activeTab).then(l => l.some(d => d.name === ${name}))`)) return false;
      await ev(`shellby.pages.drafts(SB.state.activeTab).then(l => shellby.pages.save(l.find(d => d.name === ${name}).id))`);
      return until(`shellby.pages.list().then(r => r.pages.some(p => p.id === ${JSON.stringify(id)}))`);
    };
    check(await make({ name: 'Print queue', description: "What's next on the printer", phone: true, access: { ask: true }, files: { 'index.html': INDEX, 'style.css': STYLE, 'app.js': APP } }, 'print-queue'), 'a page for the phone is on the shelf');
    await ev("shellby.pages.agree('print-queue', 1)");
    check(await make({ name: 'Drive space', description: 'A wide one', files: { 'index.html': DESK_INDEX } }, 'drive-space'), 'a page built for the desk is on the shelf');
    check(await make({ name: 'Gym log', phone: true, files: { 'index.html': DESK_INDEX } }, 'gym-log'), 'a third, for the phone, is on the shelf');
    await ev("shellby.pages.set('gym-log', { enabled: false })");
    await ev("SB.setView('pages')");

    // ---- the phone, on
    await ev('window.__pocketOn = shellby.setPocket({ enabled: true }); true');
    await answerDialog(PORT, { press: 'Put him on my phone' });
    const on = await ev('window.__pocketOn');
    check(on?.enabled === true && on?.server?.status === 'listening', `Shellby on your phone is on (${on?.server?.status})`);
    const code = (await ev('shellby.newPocketCode()'))?.code?.text;
    const paired = await api('pair', { body: { code, name: 'e2e phone' } });
    const token = paired.json?.token;
    check(paired.status === 200 && typeof token === 'string', 'the phone is paired');
    const deviceId = (await ev('shellby.getPocket()'))?.devices?.[0]?.id;

    // ---- 2. the shelf and a capability, over the API
    const shelf = await api('pages', { token, body: {} });
    const tileOf = id => shelf.json?.pages?.find(p => p.id === id);
    check(shelf.json?.ok && shelf.json.pages.length === 3, `the phone's shelf has the three pages (${shelf.json?.pages?.length})`);
    check(tileOf('print-queue')?.ready === true && tileOf('print-queue')?.phone === true, 'the phone page opens on a phone');
    check(tileOf('drive-space')?.ready === false && tileOf('drive-space')?.phone === false, 'the desk one does not');
    check(tileOf('gym-log')?.ready === false && tileOf('gym-log')?.enabled === false, 'nor the one that is off');
    const opened = await api('page-open', { token, body: { id: 'print-queue' } });
    check(opened.json?.ok === true && CAP_RE.test(opened.json.url || ''), `page-open hands out a capability URL (${opened.json?.url})`);
    const capUrl = opened.json?.url || '/pages/none/index.html';
    const capDir = capUrl.replace(/index\.html$/, '');
    const file = async (name, headers = {}) => { const r = await fetch(`${BASE}${capDir}${name}`, { headers }); return { status: r.status, csp: r.headers.get('content-security-policy') || '', xfo: r.headers.get('x-frame-options'), cache: r.headers.get('cache-control'), type: r.headers.get('content-type') || '', body: await r.text() }; };
    const index = await file('index.html');
    check(index.status === 200 && index.body.startsWith('<!doctype html><script src="guard.js" crossorigin="anonymous"></script>'), 'index.html is served with guard.js first');
    check(/sandbox allow-scripts/.test(index.csp) && /frame-ancestors 'self'/.test(index.csp) && /connect-src 'none'/.test(index.csp), 'with the page CSP: sandboxed, framed only by the app, no network');
    check(index.xfo === null && index.cache === 'no-store', 'frameable by the app, never cached');
    const every = await Promise.all(['app.js', 'style.css', 'shellby.js', 'guard.js'].map(n => file(n)));
    check(every.every(f => f.status === 200 && /sandbox/.test(f.csp) && /frame-ancestors 'self'/.test(f.csp)), 'every file of the page carries the sandbox and frame-ancestors');
    check(!/script-src/.test(every[1].csp) && /^text\/css/.test(every[1].type), 'a stylesheet is served script-free');
    check((await file('app.js', { Origin: 'null' })).status === 200, "a sandboxed frame's Origin \"null\" gets the page's own script");
    check((await file('app.js', { Origin: 'https://evil.example.com' })).status === 403, 'another Origin does not');
    check((await fetch(`${BASE}/pages/${'x'.repeat(43)}/index.html`)).status === 404, 'a capability that was never issued serves nothing');
    check((await fetch(`${BASE}${capDir}..%2Fstate.json`)).status === 404 && (await fetch(`${BASE}${capDir}data.json`)).status === 404, "nothing beyond the page's files");
    check((await api('page-open', { body: { id: 'print-queue' } })).status === 401, 'page-open needs the token');
    const desk = await api('page-open', { token, body: { id: 'drive-space' } });
    check(desk.json?.ok === false && desk.json?.desk === true, 'the desk-only page says so instead of a capability');
    check((await api('page-open', { token, body: { id: 'gym-log' } })).json?.ok === false, 'a page that is off gets none');

    // ---- 3. the bridge over the API
    const call = (method, args, id = 'print-queue') => api('page-call', { token, body: { id, method, args } });
    check((await call('data.set', [{ rows: [{ name: 'Benchy' }] }])).json?.ok === true, 'data.set from the page writes');
    check((await by('print-queue'))?.rows?.who?.kind === 'page', 'signed as the page');
    const refused = await call('read', ['usage']);
    check(refused.json?.ok === false && /wasn't given "usage"/.test(refused.json?.error || ''), `a read it was not given is refused by rights.js (${refused.json?.error})`);
    const tabsBefore = await ev('SB.state.tabs.size');
    const asked = await call('ask', ['Summarise the failed prints', { mode: 'autonomous' }]);
    check(asked.json?.ok === true && asked.json?.ask?.prompt === 'Summarise the failed prints' && asked.json?.ask?.mode === 'ask', 'an ask comes back for the phone’s sheet, never Autonomous');
    check((await ev('SB.state.tabs.size')) === tabsBefore, 'and starts nothing by itself');
    check((await call('data.get', [], 'drive-space')).json?.ok === false, 'the desk-only page has no bridge from a phone');

    // ---- 4. the phone app, for real
    phoneApi = stream(token);
    phone = await openPhone(`${BASE}/`);
    await phone.ev(`localStorage.setItem('shellby.pocket.token', ${JSON.stringify(token)}); location.hash = '#/pages'; location.reload(); true`);
    const tiles = await untilTrue(() => phone.ev("document.querySelectorAll('.pg-shelf .pg-tile').length === 3"));
    if (!tiles) console.log('      phone shows:', JSON.stringify(await phone.ev('document.body.innerText.slice(0, 300)')));
    check(tiles, 'the Pages tab shows the three tiles');
    check(await phone.ev("[...document.querySelectorAll('.dock-item')].map(a => a.textContent.trim()).join(',')") === 'Beach,Pages,Queue,More,Phone', 'Pages sits in the dock after Beach');
    check(await phone.ev("document.querySelector('.pg-tile[data-id=\"drive-space\"]').classList.contains('off') && document.querySelector('.pg-tile[data-id=\"drive-space\"] .pg-chip').textContent === 'Built for the desk'"), 'the desk-only tile is greyed with its chip');
    check(await phone.ev("!document.querySelector('.pg-tile[data-id=\"print-queue\"]').classList.contains('off')"), 'the phone page’s tile is not');
    await savePng(phone.send, path.join(SHOTS, '1-phone-shelf.png'));

    await phone.ev("location.hash = '#/page/print-queue'; true");
    check(await untilTrue(() => phone.ev("!!document.querySelector('iframe.pg-frame') && document.querySelector('iframe.pg-frame').getAttribute('sandbox') === 'allow-scripts'")), 'the page opens in an iframe with sandbox="allow-scripts"');
    check(CAP_RE.test(new URL(await phone.ev("document.querySelector('iframe.pg-frame').src")).pathname), 'from a capability URL of its own');
    check(await phone.ev("document.querySelector('.ph-name').textContent") === 'Print queue', 'under a header with its name');
    check(await untilTrue(async () => (await data('print-queue'))?.where === 'http:'), 'the page’s own bridge writes through the phone app to the PC (where: http:)');
    check(!(await phone.ev("!!document.querySelector('.pg-note')")), 'and it loaded (no note)');
    await savePng(phone.send, path.join(SHOTS, '2-phone-page.png'));

    // A write at the desk reaches the frame: the page redraws and counts the rows.
    await ev("SB.setView('chat')");
    await tool('write_page', { id: 'print-queue', append: { rows: [{ name: 'Cable clip' }] } });
    check(await untilTrue(async () => (await data('print-queue'))?.seen === 2), 'a write at the desk reaches the page in the frame (it drew 2 rows)');

    // The page asks Claude: the phone's own sheet, Plan only picked, no Autonomous, and a task in Plan once pressed.
    await ev("shellby.pages.write('print-queue', { set: { askme: 1 } })");
    check(await untilTrue(() => phone.ev("document.querySelector('.pg-ask .pg-quote')?.textContent === 'Why do these fail?'")), 'the page’s ask is the phone’s own sheet with the prompt in full');
    check(await phone.ev("[...document.querySelectorAll('.pg-modes .proj')].map(b => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '*' : '')).join(',')") === 'Ask first,Plan only*', 'Ask first or Plan only, the page’s pick marked, no Autonomous');
    await savePng(phone.send, path.join(SHOTS, '3-phone-ask-sheet.png'));
    await phone.ev("[...document.querySelectorAll('.pg-ask button')].find(b => b.textContent.trim() === 'Ask Claude').click(); true");
    // The mode it started in is the one History wrote at its first message: a page's conversation keeps
    // Ask first only until its first answer is in, then follows yours (sessions.js modeToStart), and the
    // fake CLI answers before the phone's next view goes out.
    const firstSeen = re => phoneApi.views.map(v => v?.tabs?.find(t => re.test(t.title))).find(Boolean);
    const startedIn = re => ev(`shellby.listSessions().then(l => (Array.isArray(l) ? l : l?.sessions || []).find(e => ${re}.test(e.title))?.mode ?? null)`);
    const askTab = () => firstSeen(/^Print queue: Why do these fail/);
    check(await untilTrue(() => askTab()?.fromPhone && askTab()?.mode === 'plan'), `Ask Claude starts a phone task in Plan (${askTab()?.mode})`);
    check(await untilTrue(() => phone.ev("location.hash.startsWith('#/tab/')")), 'and the phone opens the conversation');

    // Built for the desk: its own screen, and Change with Claude as a task.
    await phone.ev("location.hash = '#/page/drive-space'; true");
    check(await untilTrue(() => phone.ev("document.querySelector('.pg-desk .pg-chip')?.textContent === 'Built for the desk' && !!document.querySelector('.pg-desk-name')")), 'a desk-only page gets its own screen');
    check(!(await phone.ev("!!document.querySelector('iframe.pg-frame')")), 'and no frame');
    await savePng(phone.send, path.join(SHOTS, '4-phone-desk-only.png'));
    await phone.ev("[...document.querySelectorAll('.pg-desk button')].find(b => b.textContent.trim() === 'Change with Claude').click(); true");
    const changeTab = () => firstSeen(/^Change: Drive space/);
    check(await untilTrue(() => changeTab()?.fromPhone), 'Change with Claude starts a phone task');
    check(await untilTrue(async () => (await startedIn('/^Change: Drive space/')) === 'ask'), `in Ask first (${await startedIn('/^Change: Drive space/')})`);

    // Pinned pages on the beach, after what's waiting on you and before the conversations.
    await ev("shellby.pages.set('print-queue', { pinned: true })");
    await phone.ev("location.hash = '#/'; true");
    check(await untilTrue(() => phone.ev("document.querySelectorAll('.beach .pg-strip .pg-tile').length === 1 && document.querySelector('.beach .pg-sect')?.textContent.includes('Pinned pages')")), 'the pinned page is a row on the beach');
    check(await phone.ev("(() => { const kids = [...document.querySelector('.beach').children]; const row = kids.findIndex(k => k.classList.contains('pg-sect')); const conv = kids.findIndex(k => k.classList.contains('sect') && !k.classList.contains('pg-sect') && !k.classList.contains('asking')); return row >= 0 && conv > row; })()"), 'before the conversations');
    await savePng(phone.send, path.join(SHOTS, '5-phone-beach-pinned.png'));

    // ---- 5. a read-only phone
    await ev(`shellby.setPocket({ device: { id: ${JSON.stringify(deviceId)}, rights: 'readonly' } })`);
    check((await call('data.get', ['rows'])).json?.ok === true, 'a read-only phone’s page may still read');
    check(/only look/.test((await call('data.set', [{ rows: [] }])).json?.error || ''), 'and may not write');
    check(/only look/.test((await api('page-ask', { token, body: { id: 'print-queue', prompt: 'x', mode: 'ask' } })).json?.error || ''), 'nor ask Claude');
    check((await api('page-open', { token, body: { id: 'print-queue' } })).json?.ok === true, 'looking at a page is fine');

    // ---- 6. the PC asleep: the snapshot
    phoneApi.close();
    await ev('shellby.setPocket({ enabled: false })');
    await phone.ev("location.hash = '#/page/print-queue'; true");
    check(await untilTrue(() => phone.ev("/As it was at \\d\\d:\\d\\d\\./.test(document.querySelector('.pg-snap-note b')?.textContent || '')"), 20000), 'with the PC asleep the page shows its last snapshot, dated');
    check(await phone.ev("/Cable clip/.test(document.querySelector('.pg-snap-text')?.textContent || '') && !document.querySelector('iframe.pg-frame')"), 'its data as text, read-only, nothing running');
    await savePng(phone.send, path.join(SHOTS, '6-phone-asleep.png'));
    panel.close();
  } catch (err) {
    console.log('FAIL ', err.stack || err);
    fails++;
  } finally {
    phoneApi?.close();
    phone?.kill();
    app.kill();
    await wait(800);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* still held */ }
  }
  console.log(fails ? `\n${fails} failed. Screenshots: ${SHOTS}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(fails ? 1 : 0);
})();
