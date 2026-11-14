// ci: Your PCs, the hub: this PC's row with its own facts, the narrow and wide roster, adding a PC refused for a non-Tailscale address, answering another PC's prompts and replying in its conversation
// End-to-end check of the hub's screen (Your PCs, pcs.js), against the dev app
// over CDP with the fake CLI. Pairing with another PC needs a second PC on a
// tailnet (a real .ts.net certificate), so that's covered by the unit tests
// (test/hub-*.test.js); here:
//   1. Ctrl+K finds Your PCs, and it opens on this PC's own row
//   2. the row has this PC's facts: its Windows, Shellby's version, its agents
//   3. narrow, the roster keeps its key columns; wide, it shows them all
//   4. adding a PC with an address that isn't a Tailscale one is refused, saying why
//   5. another PC's prompts (Allow, a plan read before it's approved) and one of its
//      conversations open on the hub, with a reply that survives redraws
//   node scripts/e2e-hub.js [screenshotDir]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { savePng } = require('./lib/shot');
const { panelBooted } = require('./lib/boot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9497;
const HOOK = Number(process.env.E2E_HOOK_PORT) || 48137;
const OUT = process.argv[2] || null;
const wait = ms => new Promise(r => setTimeout(r, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  const shot = async name => { if (OUT) await savePng(send, path.join(OUT, `${name}.png`)); };
  return { ev, send, shot, close: () => ws.close() };
}

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-hub-'));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ tideEvents: false, onboarded: true }));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_E2E: '1', SHELLBY_USER_DATA: data, SHELLBY_HOOK_PORT: String(HOOK), SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js') },
  });
  let panel = null;
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    panel = await connect(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    const { ev } = panel;
    const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await wait(80); } return false; };
    await panelBooted(ev);

    // ---- 1. Ctrl+K finds it, and it opens on this PC
    await ev("document.getElementById('paletteBtn').click()");
    await ev("const i = document.getElementById('paletteInput'); i.value = 'your pcs'; i.dispatchEvent(new Event('input', { bubbles: true }))");
    check(await until("[...document.querySelectorAll('#paletteList *')].some(e => /Your PCs/.test(e.textContent))", 3000), 'Ctrl+K finds Your PCs');
    // Enter on it, as a person would: the palette closes and the screen opens.
    await ev("document.getElementById('paletteInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
    check(await until("SB.state.view === 'pcs' && document.getElementById('paletteSheet').hidden", 3000), 'Enter on it opens Your PCs and closes the palette');
    check(await until("document.querySelectorAll('#pcsRoster tbody tr').length === 1", 5000), 'the roster opens with this PC on it');
    const row = await ev("document.querySelector('#pcsRoster tbody tr').textContent");
    check(/this PC, the hub/.test(row), `it is marked as this PC (${row.slice(0, 80)})`);
    check(/Windows (10|11)/.test(row), 'with its Windows');
    check(await until("/Only this PC so far/.test(document.getElementById('pcsSummary').textContent)", 2000), 'and says only this PC is on it so far');

    // ---- 2. this PC's facts in the detail
    const facts = await ev("document.getElementById('pcsDetail').textContent");
    check(/Shellby\s*\d+\.\d+\.\d+/.test(facts), 'the detail names its Shellby version');
    check(/Claude Code/.test(facts), 'and Claude Code among its agents');
    check(await ev("!!document.querySelector('#pcsDetail .btn.primary')"), 'and offers a new conversation here');

    // ---- 3. narrow, then wide
    check(await ev("[...document.querySelectorAll('#pcsRoster thead th')].filter(th => getComputedStyle(th).display !== 'none').length") <= 5, 'narrow: the key columns only');
    await panel.shot('1-narrow');
    await panel.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
    check(await until("[...document.querySelectorAll('#pcsRoster thead th')].filter(th => getComputedStyle(th).display !== 'none').length === 10", 3000), 'wide: every column of the roster');
    await panel.shot('2-wide');
    await panel.send('Emulation.clearDeviceMetricsOverride');

    // ---- 4. adding a PC
    await ev("document.getElementById('pcsAddBtn').click()");
    check(await until("!document.getElementById('pcsAdd').hidden", 2000), 'Add a PC opens its form');
    await ev("document.getElementById('pcsAddress').value = 'evil.example.com'; document.getElementById('pcsCode').value = 'ABCD-EFGH'; document.getElementById('pcsAdd').requestSubmit()");
    check(await until("!document.getElementById('pcsAddError').hidden && /Tailscale address/.test(document.getElementById('pcsAddError').textContent)", 4000), 'an address that isn\'t a Tailscale one is refused, saying why');
    await panel.shot('3-add-refused');
    check(await ev("document.querySelectorAll('#pcsRoster tbody tr').length === 1"), 'and nothing was added');
    await ev("document.getElementById('pcsAddCancel').click()");

    // ---- 5. another PC's prompts and conversation, the panel's half: main's half
    // (hub/convo.js, wiring/hub.js) is the unit tests'. The hub's calls are
    // stood in for in the page, with a PC that has a prompt, a plan and a conversation.
    const stubbed = await ev(`(() => {
      const api = SB.hubApi;
      const real = api.hubView;
      const calls = window.__hubCalls = [];
      const remote = { id: 'p-fake', name: 'Travel laptop', kind: 'pc', state: 'online', live: true, error: null, seenAt: Date.now(),
        working: 1, waiting: 2, cpu: 20, gpu: null, hot: null, ram: null, diskFreeGb: 40, power: 'battery 64%', os: 'Windows 11', version: '0.98.1',
        agents: [{ id: 'gemini', name: 'Gemini CLI' }], projects: [{ key: 'C:\\\\code\\\\app', name: 'app' }], moreProjects: 0, limits: null,
        tabs: [{ id: 't1', title: 'Write the migration', folder: 'app', standing: 'asking', busy: true, pending: 1, agent: 'Gemini CLI', mode: 'acceptEdits', canReply: true }],
        prompts: [
          { tabId: 't1', requestId: 'r1', title: 'Write the migration', toolName: 'Bash', label: 'Run a command', detail: 'npm run migrate', ask: 'Run the migration?', warnings: [], helper: '', deskOnly: '', always: 'Always allow Bash(npm run migrate)', questions: [], plan: '', planText: '' },
          { tabId: 't1', requestId: 'r2', title: 'Write the migration', toolName: 'ExitPlanMode', label: 'A plan', detail: '', ask: '', warnings: [], helper: '', deskOnly: '', always: '', questions: [], plan: 'A plan', planText: Array.from({ length: 80 }, (_, i) => 'Step ' + (i + 1)).join('\\n') },
        ] };
      try {
        api.hubView = async () => { const v = await real(); return { ...v, rows: [...v.rows, remote], summary: '2 PCs, 2 reachable' }; };
        api.hubRetry = async () => ({ ok: true });
        api.hubConvo = async () => ({ pcId: 'p-fake', tabId: 't1', state: 'online', error: null, loaded: true, typing: 'Writing the down migration',
          items: [{ k: 'user', text: 'Write the migration for the new table' }, { k: 'tool', name: 'Write', label: 'Wrote a file', detail: 'db/001.sql', sub: false, agent: '' }, { k: 'text', text: 'The up migration is written.', sub: false }] });
        for (const n of ['hubAnswer', 'hubReply', 'hubOpen', 'hubClose']) api[n] = async (...args) => { calls.push([n, ...args]); return { ok: true }; };
      } catch { return false; }
      return api.hubView !== real;
    })()`);
    check(stubbed, "the hub's calls can be stood in for in the page");
    if (stubbed) {
      await ev("SB.views.pcs.render()");
      check(await until("!!document.querySelector('#pcsRoster tr[data-id=\"p-fake\"]')", 3000), 'the other PC is on the roster');
      await ev("document.querySelector('#pcsRoster tr[data-id=\"p-fake\"]').click()");
      check(await until("/2 waiting on you/.test(document.querySelector('#pcsDetail .pcs-waiting h3')?.textContent || '')", 3000), "its prompts lead its detail: '2 waiting on you'");
      check(await ev("/Always allow Bash\\(npm run migrate\\)/.test(document.querySelector('#pcsDetail .pcs-waiting').textContent)"), 'with its always-allow, as the desk words it');
      await ev("[...document.querySelectorAll('#pcsDetail .pcs-waiting button')].find(b => b.textContent === 'Allow').click()");
      check(await until("JSON.stringify(window.__hubCalls).includes('\"decision\":\"allow\"')", 2000), 'Allow answers it on that PC');
      check(await ev("JSON.stringify(window.__hubCalls[0]) === JSON.stringify(['hubAnswer', 'p-fake', { tabId: 't1', requestId: 'r1', decision: 'allow' }])"), 'with that prompt, and nothing else');
      check(await ev("[...document.querySelectorAll('#pcsDetail button')].find(b => b.textContent === 'Approve').disabled"), "a plan can't be approved before it's read");
      await panel.shot('4-waiting');
      await ev("(() => { const p = document.querySelector('#pcsDetail .pcs-plan'); p.scrollTop = p.scrollHeight; p.dispatchEvent(new Event('scroll')); })()");
      check(await until("![...document.querySelectorAll('#pcsDetail button')].find(b => b.textContent === 'Approve').disabled", 2000), 'read to the end, it can be');
      await ev("window.__plan = document.querySelector('#pcsDetail .pcs-plan'); SB.views.pcs.render()");
      await wait(300);
      check(await ev("document.querySelector('#pcsDetail .pcs-plan') === window.__plan && window.__plan.scrollTop > 0"), 'a redraw leaves the plan where you were reading it');
      await ev("[...document.querySelectorAll('#pcsDetail button')].find(b => b.textContent === 'Approve').click()");
      check(await until("window.__hubCalls.some(c => c[0] === 'hubAnswer' && c[2].requestId === 'r2' && c[2].read === true)", 2000), 'and approving says it was read');

      // The conversation, open on the hub
      await ev("document.querySelector('#pcsDetail .pcs-convo-btn').click()");
      check(await until("!!document.querySelector('#pcsDetail .pcs-convo') && /up migration is written/.test(document.querySelector('.pcs-log').textContent)", 3000), 'a conversation there opens on the hub, with its steps');
      check(await ev("window.__hubCalls.some(c => c[0] === 'hubOpen' && c[1] === 'p-fake' && c[2] === 't1')"), 'watching that one conversation');
      check(await ev("/Writing the down migration/.test(document.querySelector('.pcs-log').textContent)"), 'and the reply as it is typed');
      check(await ev("/In Auto-edit/.test(document.querySelector('.pcs-send').textContent)"), 'the reply box says the mode it goes in');
      await ev("(() => { const b = document.querySelector('.pcs-convo textarea'); b.focus(); b.value = 'Add the down migration too'; })()");
      await ev("SB.views.pcs.render()");
      await wait(300);
      check(await ev("document.activeElement === document.querySelector('.pcs-convo textarea') && document.activeElement.value === 'Add the down migration too'"), 'a redraw keeps what you were typing, and where');
      await panel.shot('5-conversation');
      await ev("document.querySelector('.pcs-convo form').requestSubmit()");
      check(await until("window.__hubCalls.some(c => c[0] === 'hubReply' && c[2].tabId === 't1' && c[2].text === 'Add the down migration too')", 2000), 'the reply goes to that conversation');
      check(await until("document.querySelector('.pcs-convo textarea').value === ''", 2000), 'and the box empties');
      await ev("[...document.querySelectorAll('.pcs-convo-head button')][0].click()");
      check(await until("!document.querySelector('#pcsDetail .pcs-convo') && window.__hubCalls.some(c => c[0] === 'hubClose')", 2000), 'Back closes it, and stops watching');
    }
  } catch (e) {
    check(false, `the run itself: ${e.message}`);
  } finally {
    panel?.close();
    app.kill();
    await wait(1500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* still held */ }
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
