// ci: a blocked step's Try again counts down in the tab you're in, and in one you come back to
// Regression check: Try again's countdown only started when the blocked turn
// ended in the conversation on screen, and switching tabs stopped it for good.
// A turn blocked out of sight now starts counting when you come to it, and a
// countdown holds (rather than stops) while you're in another tab.
// No Claude account needed: results are rendered straight into the feed.
//   node scripts/e2e-blocked-retry.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { panelBooted } = require('./lib/boot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9533;
const POLL_MS = 100;
const wait = ms => new Promise(r => setTimeout(r, ms));

// A tool no deny rule of yours names, so nothing blocks the countdown.
const BLOCKED = "{ kind: 'result', ok: true, denials: [{ toolName: 'E2eBlockedTool', toolUseId: 'tu_e2e', summary: 'e2e step' }] }";

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const app = spawn(require('electron') /* its binary, on any platform */, [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_E2E: '1', SHELLBY_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-')), SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47993' },
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
    const ev = expr => new Promise(r => { const i = ++id; p.set(i, m => r(m.result?.result?.value)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })); });
    const until = async (expr, ms = 5000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await ev(expr)) return true; await wait(POLL_MS); }
      return false;
    };
    await panelBooted(ev);
    await ev("shellby.setSettings({ onboarded: true }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");

    // The tab on screen: its blocked turn counts down at once.
    await ev(`(() => { const t = SB.activeTab(); window.__a = t.id; t.render({ kind: 'text', text: 'first' }); t.render(${BLOCKED}); })()`);
    const stripA = "SB.state.tabs.get(window.__a).el.querySelector('.turn-denied')";
    check(await until(`${stripA}?.classList.contains('counting')`), 'a block in the tab on screen counts down');
    check(await until(`/\\ds$/.test(${stripA}?.querySelector('.denied-secs')?.textContent || '')`), 'with its seconds on Try again');

    // Another tab, not on screen, ends with a block: no countdown until you come to it.
    const b = await ev('SB.newTab({ focus: false, reuse: false }).then(t => { window.__b = t.id; return t.id; })');
    check(!!b && b !== await ev('window.__a'), 'a second conversation opened out of sight');
    await ev(`SB.state.tabs.get(window.__b).render(${BLOCKED})`);
    const stripB = "SB.state.tabs.get(window.__b).el.querySelector('.turn-denied')";
    await wait(600);
    check(await ev(`!!${stripB} && !${stripB}.classList.contains('counting')`), 'a block out of sight waits to count');

    // The first tab's countdown holds while you're away, rather than stopping.
    await ev('SB.activate(window.__b)');
    check(await until(`${stripB}?.classList.contains('counting')`), 'coming to it starts its countdown');
    check(await until(`${stripA}?.classList.contains('counting') && ${stripA}.classList.contains('held')`), "the tab you left holds its countdown");

    // ...and goes on when you're back, until Cancel puts back the quiet line.
    await ev('SB.activate(window.__a)');
    check(await until(`${stripA}?.classList.contains('counting') && !${stripA}.classList.contains('held')`), 'and it goes on when you come back');
    await ev(`${stripA}.querySelector('.denied-acts .ghost').click()`);
    check(await until(`!${stripA} && !!SB.state.tabs.get(window.__a).el.querySelector('.turn-denials')`), 'Cancel puts back the quiet line');
    await ev('SB.activate(window.__b)');
    await ev(`${stripB}.querySelector('.denied-acts .ghost').click()`);
    check(await until(`!${stripB}`), "and the other tab's Cancel does too");
  } catch (e) {
    check(false, e.message);
  } finally {
    app.kill();
  }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
