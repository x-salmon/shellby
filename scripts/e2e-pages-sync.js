// ci: pages between PCs: a page and its data travel through the sync gist, arrive switched off, Turn it on, a new version waits
// Pages on your other PCs end to end (docs/plans/shellby-pages.md section 7,
// sync/pages.js), against the dev app over CDP with the fake Claude CLI and a
// mock GitHub (test/fixtures/mock-github.js). Two isolated profiles stand in
// for two PCs signed in to the same account, one after the other:
//   1. PC A builds a page over MCP, an agent writes to it, and it syncs: the
//      gist gets shellby-pages.json with the page, its data and no token, and
//      Settings › Pages shows it travelling.
//   2. PC B signs in and syncs: the shelf says a page came, its tile is off
//      "From <PC>", and looking at it shows the access sheet with where it came
//      from; Turn it on runs it with the data. B appends a row and changes the
//      page, then syncs.
//   3. PC A, opened again: the data arrives (the row, signed by the other PC),
//      its version keeps running while the new one waits on the tile, and Not
//      on this PC keeps it that way, quietly. A deleted page goes everywhere.
//   node scripts/e2e-pages-sync.js [--shots <dir>]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { savePng } = require('./lib/shot');
const { startMockGitHub } = require('../test/fixtures/mock-github');
const { panelBooted } = require('./lib/boot');
const { FILE } = require('../src/main/sync/pages');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9398;
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : path.join(os.tmpdir(), 'shellby-e2e-pages-sync');
const wait = ms => new Promise(r => setTimeout(r, ms));

const INDEX = '<!doctype html><html><head><meta charset="utf-8"><title>Print queue</title><script src="shellby.js"></script><script src="app.js"></script></head><body><h1>Print queue</h1><ul id="rows"></ul></body></html>';
const APP = [
  "async function draw() { const rows = (await shellby.data.get('rows')) || [];",
  "  document.getElementById('rows').replaceChildren(...rows.map(r => { const li = document.createElement('li'); li.textContent = r.name; return li; }));",
  '  await shellby.data.set({ seen: rows.length }); }',
  "shellby.data.onChange(c => { if (!c.keys.includes('seen')) draw(); });",
  "window.addEventListener('DOMContentLoaded', draw);",
].join('\n');

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  return { send, ev, close: () => ws.close() };
}

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  fs.mkdirSync(SHOTS, { recursive: true });
  const mock = await startMockGitHub({ autoApprove: true });
  const pcA = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-a-'));
  const pcB = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-b-'));
  const pagesGist = () => [...mock.state.gists.values()].find(g => g.files[FILE]);
  const pagesFile = () => JSON.parse(pagesGist().files[FILE].content);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GH_TOKEN|GITHUB_TOKEN|GITHUB_PERSONAL_ACCESS_TOKEN|GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+))$/.test(k)));

  let app = null;
  let panel = null;
  const targets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await panel.ev(expr)) return true; await wait(200); } return false; };
  const shot = name => savePng((m, p) => panel.send(m, p), path.join(SHOTS, `${name}.png`));
  const sync = async () => panel.ev('shellby.githubSync().then(r => r.ok)');
  /** One MCP tool call from the fake CLI in the active chat, and wait for its row. */
  const tool = async (name, args) => {
    const before = await panel.ev('SB.activeTab().items?.length ?? 0');
    await panel.ev(`shellby.sendTask(SB.state.activeTab, ${JSON.stringify(`mcp ${name} ${JSON.stringify(args)}`)})`);
    await until(`!SB.activeTab().busy && (SB.activeTab().items?.length ?? 0) > ${before}`);
    await wait(300);
  };

  /** Open Shellby on one "PC", signed in to the mock GitHub with sync on. */
  async function open(dir, { signIn }) {
    app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
      stdio: 'ignore',
      env: {
        ...env, SHELLBY_USER_DATA: dir, SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47998',
        SHELLBY_GITHUB_WEB: mock.base, SHELLBY_GITHUB_API: mock.base, SHELLBY_GITHUB_CLIENT_ID: 'e2e-client',
      },
    });
    let list = [];
    for (let i = 0; i < 60 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await targets(); } catch { /* starting */ }
      await wait(500);
    }
    panel = await connect(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    await panelBooted(panel.ev);
    await panel.ev("shellby.setSettings({ onboarded: true, mode: 'smart', rooms: null }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");
    await panel.ev('shellby.fitPanel?.({ width: 1400, height: 900 })');
    if (signIn) {
      await panel.ev("shellby.githubSignIn(['sync'])");
      check(await until("SB.state.github?.login === 'crabfan' || document.getElementById('ghLogin')?.textContent === '@crabfan'"), 'signed in as @crabfan');
      await until('!SB.state.github?.syncing', 15000); // the sign-in's own first sync
    }
  }

  // Quit the way a PC does, not a kill: Chromium writes the key the sign-in is encrypted with on the way out.
  async function close() {
    if (!app) return;
    panel?.close();
    const exited = new Promise(r => app.once('exit', r));
    try {
      const browser = await connect((await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl);
      browser.send('Browser.close');
    } catch { /* already gone */ }
    if (!(await Promise.race([exited.then(() => true), wait(10000)]))) app.kill();
    app = null;
    await wait(1000);
  }

  try {
    // ---- 1. PC A: a page, a write to it, a sync.
    await open(pcA, { signIn: true });
    await tool('create_page', { name: 'Print queue', description: "What's next on the printer", files: { 'index.html': INDEX, 'app.js': APP } });
    check(await until("!!document.querySelector('.pg-host.pane iframe.pg-frame')"), 'PC A: create_page opens its draft beside the chat');
    await panel.ev("[...document.querySelectorAll('.pg-host.pane button')].find(b => b.textContent === 'Save to my pages').click()");
    check(await until("shellby.pages.list().then(r => r.pages.some(p => p.id === 'print-queue'))"), 'PC A: saved to the shelf as print-queue');
    await tool('write_page', { id: 'print-queue', append: { rows: [{ name: 'Benchy' }, { name: 'Cable clip' }] } });
    check(await until("shellby.pages.data('print-queue').then(d => d.values.rows?.length === 2)"), 'PC A: an agent appended two rows');
    check(await sync(), 'PC A: synced');
    check(!!pagesGist(), `the gist has ${FILE}`);
    const fileA = pagesFile();
    const item = fileA.pages?.['print-queue'];
    check(!!item && item.manifest?.name === 'Print queue' && item.files?.['index.html'] === INDEX, 'it holds the page, its page.json and files');
    check(item?.data?.keys?.rows?.v?.length === 2 && item.data.keys.rows.op === 'append', 'and its data, key by key, with the append marked');
    check(typeof item?.from?.pc === 'string' && typeof item?.from?.name === 'string', `it says which PC it came from (${item?.from?.name})`);
    check(!JSON.stringify(fileA).includes(mock.state.token), 'no token in the pages file');
    await panel.ev("SB.setView('settings')");
    check(await until("document.getElementById('pgSyncToggle')?.checked === true && !document.getElementById('pgSyncBar').hidden"), 'PC A: Settings › Pages shows On your other PCs on, with the budget bar');
    check(await until("[...document.querySelectorAll('#pgSyncTravel .pg-srow')].some(r => /Print queue/.test(r.textContent) && /Everywhere/.test(r.textContent))"), 'PC A: Which pages travel lists it as Everywhere');
    await panel.ev("document.getElementById('pagesSettings').scrollIntoView({ block: 'start' })");
    await shot('1-settings-other-pcs');
    const nameA = item?.from?.name;
    await close();

    // ---- 2. PC B: the page arrives switched off; look, then Turn it on.
    await open(pcB, { signIn: true });
    check(await until("shellby.pages.list().then(r => r.pages.some(p => p.id === 'print-queue'))", 20000) || (await sync(), await until("shellby.pages.list().then(r => r.pages.some(p => p.id === 'print-queue'))")), 'PC B: the page came with the sync');
    const vB = await panel.ev("shellby.pages.view('print-queue')");
    check(vB?.enabled === false && vB?.agreed === null && vB?.arrived?.kind === 'new' && vB?.from === 'pc', 'PC B: it arrived switched off, with its access not agreed');
    check(vB?.arrived?.from?.name === nameA, `PC B: and says it came from ${nameA}`);
    check((await panel.ev("shellby.pages.data('print-queue').then(d => d.values.rows?.length)")) === 2, 'PC B: its data came along');
    await panel.ev("SB.setView('pages')");
    check(await until("!document.getElementById('pgArrivals').hidden && /1 page came from/.test(document.getElementById('pgArrivals').textContent)"), 'PC B: the shelf says a page came');
    check(await until(`[...document.querySelectorAll('#pgGrid .pg-tile[data-id="print-queue"] .chip')].some(c => c.textContent === 'From ${nameA}')`), 'PC B: its tile says From <PC>, off');
    await shot('2-shelf-arrival');
    await panel.ev("[...document.querySelectorAll('#pgArrivals button')].find(b => /Look at/.test(b.textContent)).click()");
    check(await until("!!document.querySelector('#pgOpen:not([hidden]) .pg-arrival')"), 'PC B: Look at it opens the access sheet');
    check(await until("/checked like a new page/.test(document.querySelector('#pgOpen .pg-arrival .pg-facts')?.textContent || '')"), 'PC B: with where it came from and its files on top');
    check(!(await panel.ev("!!document.querySelector('#pgOpen iframe.pg-frame')")), 'PC B: nothing runs behind the sheet');
    await shot('3-arrival-sheet');
    await panel.ev("[...document.querySelectorAll('#pgOpen .pg-arrival button')].find(b => b.textContent === 'Turn it on').click()");
    check(await until("!!document.querySelector('#pgOpen iframe.pg-frame')"), 'PC B: Turn it on runs it');
    check(await until("shellby.pages.data('print-queue').then(d => d.values.seen === 2)"), 'PC B: the page drew the two rows that travelled');
    check(await until("shellby.pages.view('print-queue').then(v => v.enabled && !!v.agreed && !v.arrived)"), 'PC B: it is on, agreed, and the notice is gone');
    // B adds a row and a new version, then syncs.
    await panel.ev("SB.setView('chat')");
    await tool('write_page', { id: 'print-queue', append: { rows: [{ name: 'Phone stand' }] } });
    await tool('update_page', { id: 'print-queue', why: 'A title from the laptop', files: { 'index.html': INDEX.replace('<h1>Print queue</h1>', '<h1>Print queue, v2</h1>'), 'app.js': APP } });
    check(await until("shellby.pages.view('print-queue').then(v => v.version === 2)"), 'PC B: update_page made version 2');
    check(await sync(), 'PC B: synced');
    const fileB = pagesFile();
    check(fileB.pages['print-queue'].data.keys.rows.v.length === 3 && fileB.pages['print-queue'].files['index.html'].includes('v2'), 'the gist has the third row and version 2');
    await close();

    // ---- 3. PC A again: data arrives; its version keeps running while the new one waits.
    await open(pcA, { signIn: false });
    check(await sync(), 'PC A: synced');
    check(await until("shellby.pages.data('print-queue').then(d => d.values.rows?.length === 3)"), 'PC A: the row from the other PC arrived');
    const act = await panel.ev("shellby.pages.activity('print-queue')");
    check(act?.some(a => a.who?.kind === 'pc' && /added 1 to rows/.test(a.text)), 'PC A: the activity list signs it with the other PC');
    const vA = await panel.ev("shellby.pages.view('print-queue')");
    check(vA?.version === 1 && vA?.pendingVersion?.n === 2 && vA?.arrived?.kind === 'changed', 'PC A: version 1 keeps running; version 2 waits');
    check(vA?.enabled === true, 'PC A: a change on the other PC did not switch it off here');
    await panel.ev("SB.setView('pages')");
    check(await until(`[...document.querySelectorAll('#pgGrid .pg-tile[data-id="print-queue"] .chip')].some(c => c.textContent === 'New version from ${nameA}')`), 'PC A: the tile says a new version waits');
    await panel.ev("SB.openPage('print-queue')");
    check(await until("!!document.querySelector('#pgOpen .pg-cards .pg-arrival') && !!document.querySelector('#pgOpen iframe.pg-frame')"), 'PC A: the sheet sits above the page, which still runs');
    await shot('4-new-version-waits');
    await panel.ev("[...document.querySelectorAll('#pgOpen .pg-arrival button')].find(b => b.textContent === 'Not on this PC').click()");
    check(await until("shellby.pages.view('print-queue').then(v => v.version === 1 && v.arrived?.quiet === true && !document.querySelector('#pgOpen .pg-arrival'))"), 'PC A: Not on this PC keeps version 1 and goes quiet');
    await panel.ev("document.querySelector('#pgOpen .pg-more').click()");
    await panel.ev("[...document.querySelectorAll('#pagesMenu .menu-item')].find(b => /History/.test(b.textContent))?.click()");
    check(await until("[...document.querySelectorAll('#pgDrawer .pg-versions li b')].some(b => /Waiting from/.test(b.textContent))"), 'PC A: History shows the waiting version');
    await shot('5-history-waiting');
    // Where it goes: This PC only keeps it out of the file.
    await panel.ev("document.querySelector('#pgOpen .pg-more').click()");
    await panel.ev("[...document.querySelectorAll('#pagesMenu .menu-item')].find(b => /Where it goes/.test(b.textContent))?.click()");
    check(await until("!document.getElementById('pgWhereSheet').hidden && document.querySelectorAll('#pgWhereBody .pg-opt').length === 4"), 'PC A: Where it goes offers the page and its data');
    await shot('6-where-it-goes');
    await panel.ev("[...document.querySelectorAll('#pgWhereBody .pg-opt')].find(b => /This PC only/.test(b.textContent)).click()");
    check(await until("shellby.pages.view('print-queue').then(v => v.sync.where === 'here')"), 'PC A: This PC only');
    await panel.ev("document.getElementById('pgWhereDone').click()");
    check(await sync(), 'PC A: synced');
    check(!!pagesFile().pages['print-queue'], 'the other PC\'s copy stays in the gist');
    // Deleting it here goes everywhere.
    await panel.ev("[...document.querySelectorAll('#pgWhereBody .pg-opt')].length; shellby.pages.where('print-queue', { where: 'everywhere' })");
    check((await panel.ev("shellby.pages.remove('print-queue').then(r => r.ok)")) === true, 'PC A: deleted');
    check(await sync(), 'PC A: synced');
    check(!pagesFile().pages['print-queue'] && typeof pagesFile().gone?.['print-queue'] === 'number', 'the gist drops it and keeps a marker');
    await close();
    await open(pcB, { signIn: false });
    check(await sync(), 'PC B: synced');
    check(await until("shellby.pages.list().then(r => !r.pages.some(p => p.id === 'print-queue'))"), 'PC B: the delete arrived');
  } catch (e) {
    check(false, e.stack || e.message);
  } finally {
    await close();
    await mock.close();
    for (const dir of [pcA, pcB]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
  console.log(fails ? `\n${fails} FAILED. Screenshots: ${SHOTS}` : `\nall passed. Screenshots: ${SHOTS}`);
  process.exit(fails ? 1 : 0);
})();
