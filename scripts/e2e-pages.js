// ci: pages: build a draft over MCP, save it, open it, agents write, a hostile page stays in, break and go back
// Pages end to end (docs/plans/shellby-pages.md), against the dev app with the
// fake Claude CLI, whose "mcp <tool> <json>" calls the in-app MCP server:
//   - create_page from a chat makes a draft that opens beside it, and runs
//   - Save to my pages puts it on the shelf; the Pages screen opens it
//   - write_page from a conversation reaches the page (its onChange writes back)
//   - a hostile page can't reach Shellby's DOM, top.location, storage or the
//     network, even with the save checks dodged
//   - a call it wasn't given shows a refusal in its header
//   - a version that throws shows the broken card; Go back brings the last one
// Screenshots go in [dir] (default %TEMP%\shellby-e2e-pages).
//   node scripts/e2e-pages.js [--shots <dir>]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { panelBooted } = require('./lib/boot');
const { savePng } = require('./lib/shot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9389;
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : path.join(os.tmpdir(), 'shellby-e2e-pages');
const wait = ms => new Promise(r => setTimeout(r, ms));

const INDEX = '<!doctype html><html><head><meta charset="utf-8"><title>Print queue</title><link rel="stylesheet" href="style.css"><script src="shellby.js"></script><script src="app.js"></script></head><body><h1>Print queue</h1><ul id="rows"></ul></body></html>';
const STYLE = 'body { font: 15px system-ui; color: #eee; background: #1d2a22; margin: 16px; } li { padding: 4px 0; }';
const APP = [
  "async function draw() { const rows = (await shellby.data.get('rows')) || [];",
  "  document.getElementById('rows').replaceChildren(...rows.map(r => { const li = document.createElement('li'); li.textContent = r.name; return li; }));",
  '  await shellby.data.set({ seen: rows.length }); }',
  "shellby.data.onChange(c => { if (!c.keys.includes('seen')) draw(); });",
  "window.addEventListener('DOMContentLoaded', draw);",
].join('\n');
// Dodges the save checks on purpose: they're there to explain, the sandbox is what stops it.
const ESCAPE = [
  'const out = {};',
  "const t = (k, fn) => { try { fn(); out[k] = 'reached'; } catch { out[k] = 'blocked'; } };",
  "t('parent', () => window.parent.document.body.innerHTML);",
  "t('top', () => window.top.location.href);",
  "t('storage', () => window.localStorage.length);",
  "t('cookie', () => document.cookie);",
  "const f = window['fe' + 'tch'];",
  "f('https://example.com/').then(() => { out.fetch = 'reached'; }, () => { out.fetch = 'blocked'; })",
  '  .finally(() => shellby.data.set({ escape: out }));',
  "shellby.read(['us', 'age'].join('')).catch(() => {});",
].join('\n');

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-')), SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47989' },
  });
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    const ws = new WebSocket(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    await new Promise(r => { ws.onopen = r; });
    let id = 0; const p = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
    const until = async (expr, ms = 10_000) => { for (let t = 0; t < ms; t += 150) { if (await ev(expr)) return true; await wait(150); } return false; };
    const shot = name => savePng(send, path.join(SHOTS, `${name}.png`));
    const tool = async (name, args) => {
      const before = await ev('SB.activeTab().items?.length ?? 0');
      await ev(`shellby.sendTask(SB.state.activeTab, ${JSON.stringify(`mcp ${name} ${JSON.stringify(args)}`)})`);
      await until(`!SB.activeTab().busy && (SB.activeTab().items?.length ?? 0) > ${before}`);
      await wait(300);
    };
    const data = pageId => ev(`shellby.pages.data(${JSON.stringify(pageId)}).then(d => d.values)`);

    await panelBooted(ev);
    await ev("shellby.setSettings({ onboarded: true, mode: 'smart', rooms: null }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");
    await ev('shellby.fitPanel?.({ width: 1500, height: 900 })');

    // ---- a draft from the chat, beside it
    await tool('create_page', { name: 'Print queue', description: "What's next on the printer", files: { 'index.html': INDEX, 'style.css': STYLE, 'app.js': APP } });
    check(await until("!!document.querySelector('.pg-host.pane iframe.pg-frame')"), 'create_page from a chat opens its draft beside it');
    const draftId = await ev("shellby.pages.list().then(() => [...document.querySelectorAll('.pg-host.pane')].length && SB.state.grid && JSON.stringify(SB.state.grid))");
    check(!!draftId, 'the draft is in a pane of its own');
    check(await until("[...document.querySelectorAll('.pg-host.pane .pg-chip')].some(c => !c.hidden && c.textContent === 'Draft')"), 'it says Draft');
    check(!(await ev("!!document.querySelector('.pg-host.pane .pg-card.bad')")), 'and it loads (no broken card)');
    check((await ev('shellby.pages.list().then(r => r.pages.length)')) === 0, "a draft isn't on the shelf");
    await shot('1-draft-beside-chat');

    await ev("[...document.querySelectorAll('.pg-host.pane button')].find(b => b.textContent === 'Save to my pages').click()");
    check(await until("shellby.pages.list().then(r => r.pages.some(p => p.id === 'print-queue'))"), 'Save to my pages puts it on the shelf as print-queue');

    // ---- the shelf, and the page full size
    await ev("SB.setView('pages')");
    check(await until("!!document.querySelector('#pgGrid .pg-tile[data-id=\"print-queue\"]')"), 'the shelf shows its tile');
    await shot('2-shelf');
    await ev("document.querySelector('#pgGrid .pg-tile[data-id=\"print-queue\"]').click()");
    check(await until("!!document.querySelector('#pgOpen:not([hidden]) iframe.pg-frame')"), 'clicking the tile opens it full size');

    // ---- an agent writes; the page sees it (its onChange writes "seen" back)
    await ev("SB.setView('chat')");
    await tool('write_page', { id: 'print-queue', append: { rows: [{ name: 'Benchy' }, { name: 'Cable clip' }] } });
    await ev("SB.openPage('print-queue')");
    check(await until("shellby.pages.data('print-queue').then(d => d.values.seen === 2)"), 'write_page reaches the page, which draws the two rows');
    const activity = await ev("shellby.pages.activity('print-queue')");
    check(activity?.some(a => a.who?.kind === 'agent' && /added 2 to rows/.test(a.text)), 'the activity list signs the write with the conversation');
    await shot('3-page-with-rows');

    // ---- a hostile page
    await ev("SB.setView('chat')");
    await tool('create_page', { name: 'Escape', files: { 'index.html': '<!doctype html><script src="shellby.js"></script><script src="app.js"></script>', 'app.js': ESCAPE } });
    await ev("[...document.querySelectorAll('.pg-host.pane button')].find(b => b.textContent === 'Save to my pages')?.click()");
    await until("shellby.pages.list().then(r => r.pages.some(p => p.id === 'escape'))");
    await ev("SB.openPage('escape')");
    check(await until("shellby.pages.data('escape').then(d => !!d.values.escape?.fetch)"), 'the hostile page ran and reported');
    const esc = (await data('escape'))?.escape || {};
    for (const k of ['parent', 'top', 'storage', 'cookie', 'fetch']) check(esc[k] === 'blocked', `a page can't reach ${k}`);
    check(await until("[...document.querySelectorAll('#pgOpen .pg-card.warn')].some(c => /usage/.test(c.textContent))"), 'a call it was not given shows a refusal in its header');
    await shot('4-refused');

    // ---- broken, and back
    await ev("SB.setView('chat')");
    await tool('update_page', { id: 'print-queue', why: 'Break it', files: { 'index.html': INDEX, 'style.css': STYLE, 'app.js': "throw new Error('boom');" } });
    await ev("SB.openPage('print-queue')");
    check(await until("/boom/.test(document.querySelector('#pgOpen .pg-card.bad')?.textContent || '')"), 'a version that throws shows the broken card with its error');
    await shot('5-broken');
    await ev("[...document.querySelectorAll('#pgOpen .pg-card.bad button')].find(b => /Go back/.test(b.textContent)).click()");
    check(await until("shellby.pages.view('print-queue').then(v => v.version === 3)"), 'Go back to the last version makes version 3 from version 1');
    check(await until("!document.querySelector('#pgOpen .pg-card.bad')"), 'and the broken card goes');

    // ---- the drawer
    await ev("document.querySelector('#pgOpen .pg-more').click()");
    await ev("[...document.querySelectorAll('#pagesMenu .menu-item')].find(b => /Its data/.test(b.textContent))?.click()");
    check(await until("!!document.querySelector('#pgDrawer:not([hidden]) .pg-key code')"), 'Its data opens the drawer with the keys');
    await shot('6-data-drawer');
  } catch (e) {
    console.log(`FAIL  ${e.stack || e.message}`);
    fails++;
  } finally {
    app.kill();
  }
  console.log(fails ? `\n${fails} failed. Screenshots: ${SHOTS}` : `\nAll passed. Screenshots: ${SHOTS}`);
  process.exit(fails ? 1 : 0);
})();
