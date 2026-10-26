// ci: Claude Code's own commands done here: /tasks, /workflows, /loops, /wellbeing, /chrome, /mobile, /context's bar, /insights, /subtask, schedules
// End-to-end check of Claude Code's commands that Shellby now does itself
// instead of sending you to a terminal, against the dev app over CDP with the
// fake CLI (test/fixtures/fake-claude.js):
//   1. /tasks: says nothing runs, then, with a command in the background, goes to the tray
//   2. /workflows, /autofix-pr, /ultraplan and /subtask on their own say what they need
//   3. /loops and /daemon open Routines, /wellbeing Time, /chrome its setting
//   4. /mobile: a QR code in a sheet that Escape closes
//   5. /context: a bar of what fills the window, biggest first, the table folded under it
//   6. /insights: the report's button (not pressed: it would open your browser)
//   7. /subtask <task>: the words sent ask for a forked helper, in plain sight
//   8. a wake-up and a schedule read in words
// Nothing here opens a terminal or a browser: /ultraplan is only tried without words.
//   node scripts/e2e-native-commands.js [screenshotDir]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { savePng } = require('./lib/shot');
const { panelBooted } = require('./lib/boot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9473;
const HOOK = Number(process.env.E2E_HOOK_PORT) || 47973;
const OUT = process.argv[2] || null;
const wait = ms => new Promise(r => setTimeout(r, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  const shot = async name => { if (!OUT) return; await ev('SB.clearCelebrations?.()'); await savePng(send, path.join(OUT, `${name}.png`)); };
  return { ev, shot, close: () => ws.close() };
}

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-nativecmd-')));
  const data = path.join(base, 'userdata');
  const claudeConfig = path.join(base, 'claude');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ tideEvents: false }));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: {
      ...process.env, SHELLBY_E2E: '1', SHELLBY_USER_DATA: data, CLAUDE_CONFIG_DIR: claudeConfig,
      SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: String(HOOK),
    },
  });
  let panel = null;
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    panel = await connect(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    const ev = panel.ev;
    const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await wait(60); } return false; };
    const idle = () => until('!SB.activeTab().busy', 10000);
    const toastSays = re => until(`${re}.test(document.getElementById('toast').textContent)`, 4000);
    // As you'd type it: in the chat already (setView puts focus back in the box a moment later),
    // and with any toast that holds for its button out of the way (your Enter would let it go).
    const typed = async text => {
      if (await ev("SB.state.view !== 'chat'")) { await ev("SB.setView('chat')"); await wait(200); }
      await ev("document.querySelector('#toast .toast-close')?.click()");
      await ev(`SB.send(${JSON.stringify(text)})`);
      await wait(150);
    };
    const feedText = () => ev('SB.activeTab().el.textContent');

    await panelBooted(ev);
    await ev("shellby.setSettings({ onboarded: true }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");
    await wait(400);

    // ---- 1. /tasks
    await typed('/tasks');
    check(await toastSays(/Nothing is running in the background here/), '/tasks with nothing running says so');
    await ev("SB.send('bg 6000')");
    check(await until("!document.getElementById('jobs').hidden", 8000), 'a command left running shows in the tray');
    await typed('/tasks');
    check(await until("document.getElementById('jobs').contains(document.activeElement)", 3000), '/tasks goes to the tray');
    await idle();

    // ---- 2. the ones that need something first
    await typed('/workflows');
    check(await toastSays(/No workflow runs in this conversation yet/), '/workflows with no runs points at Ultracode');
    await typed('/autofix-pr');
    check(await toastSays(/Settings → Connections → GitHub/), '/autofix-pr without GitHub says where to turn it on');
    await typed('/ultraplan');
    check(await toastSays(/Say what to plan/), '/ultraplan on its own asks what to plan, and opens nothing');
    await typed('/subtask');
    check(await toastSays(/Say what the helper should do/), '/subtask on its own asks for the task');
    check(!(await ev("[...SB.activeTab().el.querySelectorAll('.msg.user')].some(m => /^\\/(workflows|autofix-pr|ultraplan|subtask)/.test(m.textContent))")), 'none of them reached Claude');

    // ---- 3. screens
    await typed('/loops');
    check(await until("SB.state.view === 'routines'"), '/loops opens Routines');
    await typed('/daemon');
    check(await until("SB.state.view === 'routines'"), '/daemon opens Routines');
    await typed('/wellbeing');
    check(await until("SB.state.view === 'time'"), '/wellbeing opens Time');
    await typed('/chrome');
    check(await until("SB.state.view === 'settings' && document.getElementById('chromeToggle').getClientRects().length > 0"), "/chrome opens Let Claude use Chrome");

    // ---- 4. /mobile
    await typed('/mobile');
    check(await until("!!document.querySelector('.card-sheet canvas.mobile-qr')"), '/mobile shows a QR code');
    check(await ev("document.querySelector('canvas.mobile-qr').width >= 21 * 5"), 'drawn at full size');
    check(await ev("document.activeElement?.closest('.card-sheet') !== null"), 'focus moves into the sheet');
    await panel.shot('4-mobile');
    await ev("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    check(await until("!document.querySelector('canvas.mobile-qr')"), 'Escape closes it');

    // ---- 5. /context
    await ev("SB.newTab({ reuse: false })");
    await wait(400);
    await ev("SB.send('/context')");
    check(await until("!!SB.activeTab().el.querySelector('.ctxu-card')"), "/context's answer is a card");
    check(await ev("/^Context 2% full · \\S+ of \\S+ tokens$/.test(SB.activeTab().el.querySelector('.ctxu-head b').textContent)"), 'it says how full the window is');
    check(await ev("SB.activeTab().el.querySelectorAll('.ctxu-seg').length === 11"), 'every category is a piece of the bar');
    check(await ev("SB.activeTab().el.querySelector('.ctxu-legend li .ctxu-name').textContent === 'MCP tools (deferred)'"), 'the biggest comes first');
    check(await ev("SB.activeTab().el.querySelector('.ctxu-seg:last-child').classList.contains('free')"), 'free space comes last');
    check(await ev("!SB.activeTab().el.querySelector('.ctxu-more').open && /mcp__context7__query-docs/.test(SB.activeTab().el.querySelector('.ctxu-more').textContent)"), "Claude Code's full table is folded under it");
    check(!(await ev("[...SB.activeTab().el.querySelectorAll('.msg.assistant:not(.ctxu-table)')].some(m => /Context Usage/.test(m.textContent))")), 'the table is not also printed as a reply');
    await idle();
    await panel.shot('5-context');

    // ---- 6. /insights
    await ev("SB.send('/insights')");
    check(await until("[...SB.activeTab().el.querySelectorAll('.ctxu-actions button')].some(b => b.textContent === 'Open the latest insights report')"), "the report's link gets a button");
    check(fs.existsSync(path.join(claudeConfig, 'usage-data', 'report.html')), 'the report it opens is in usage-data');
    await idle();

    // ---- 7. /subtask <task>
    await ev("SB.send('/subtask find the slow query')");
    check(await until("[...SB.activeTab().el.querySelectorAll('.msg.user')].some(m => /forked helper/.test(m.textContent) && /The task: find the slow query/.test(m.textContent))"), '/subtask sends the task to a forked helper, in plain sight');
    await idle();

    // ---- 8. schedules in words
    await ev("SB.send('schedules')");
    await idle();
    const said = await feedText();
    check(/Will pick this up again/.test(said) && /in 20 min: watching CI/.test(said), 'a wake-up says when and why');
    check(/Scheduled/.test(said) && /weekdays at 09:00: check the build/.test(said), 'a schedule says when, in words');
    await panel.shot('8-schedules');
  } catch (err) {
    console.log('FAIL  crashed:', err?.stack || err);
    fails++;
  } finally {
    panel?.close();
    try { app.kill(); } catch { /* gone */ }
    await wait(1500);
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* still held */ }
  }
  console.log(fails ? `\n${fails} check(s) failed` : '\nall native command checks passed');
  process.exit(fails ? 1 : 0);
})();
