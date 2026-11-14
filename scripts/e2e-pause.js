// ci: pause: Pause beside Stop, Pausing… until the step ends, Continue, Stop while paused, parking
// End-to-end check of Pause against the dev app over CDP, driven by the fake
// Claude CLI (test/fixtures/fake-claude.js): no account, no usage. Pause holds
// Claude at the end of his step (main's session/pause.js); the busy line says
// what it waits for, then Paused with a Continue button; what you type meanwhile
// goes in on Continue; Stop still ends it; a turn with no step says it finished first;
// a long pause parks (SHELLBY_PARK_AFTER_MS brings that forward from ~55 minutes).
//   node scripts/e2e-pause.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9453;
// Long enough that the checks on a held pause run before it parks.
const PARK_MS = 6000;
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-')), SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '48153', SHELLBY_PARK_AFTER_MS: String(PARK_MS) },
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
    const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await wait(150); } return false; };
    const type = async text => ev(`(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })(SB.$('input'))`);
    const said = text => `[...SB.activeTab().el.querySelectorAll('.msg.assistant')].some(e => e.textContent.includes(${JSON.stringify(text)}))`;
    const button = () => ev("(b => b.hidden ? 'hidden' : `${b.textContent}${b.disabled ? ' (disabled)' : ''}`)(document.getElementById('pauseBtn'))");
    const line = () => ev("document.getElementById('statusText').textContent");
    await until('!!SB.activeTab?.()', 15000);
    await ev("shellby.setSettings({ onboarded: true }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");
    await wait(500);

    // 1. Pause beside Stop while he works; pressed, it waits for the step he's on.
    check(await button() === 'hidden', 'no Pause with nothing running');
    await type('steps 4 700');
    check(await until('SB.activeTab().busy'), 'the turn is running');
    check(await until("document.getElementById('pauseBtn').textContent === 'Pause' && !document.getElementById('pauseBtn').hidden"), `Pause shows beside Stop (${await button()})`);
    await ev("document.getElementById('pauseBtn').click()");
    check(await until("SB.activeTab().pause?.phase === 'pausing'"), 'pressed, it is pausing');
    check(await button() === 'Pausing… (disabled)', `the button says it's in hand (${await button()})`);
    check(/^Pausing after this step… waiting for /.test(await line()), `the line says what it waits for ("${await line()}")`);

    // 2. Once the step is done, he's held: Continue shows, and nothing more runs.
    check(await until("SB.activeTab().pause?.phase === 'paused'"), 'paused once the step ended');
    check(await button() === 'Continue', `Pause became Continue (${await button()})`);
    check(/^Paused\. Nothing more runs until you continue/.test(await line()), `the line says it's paused ("${await line()}")`);
    check(!(await ev("document.getElementById('stopBtn').hidden")), 'Stop is still there');
    check(await until("/Paused/.test(document.querySelector('.tab.active .ti')?.title || '')"), 'the tab strip shows it paused');
    await wait(2500); // unpaused, the remaining steps would have run by now
    check(await ev('SB.activeTab().busy') && !(await ev(said('steps done'))), 'nothing more ran while paused');

    // 3. What you type while paused goes in when you continue, in the same turn.
    await type('also add tests');
    check(await ev('SB.activeTab().queue.length') === 1, 'typed while paused: queued');
    await ev("document.getElementById('pauseBtn').click()");
    check(await until(said('steered: also add tests')), 'Continue: Claude read it at once');
    check(await until('!SB.activeTab().busy && !SB.activeTab().pause'), 'and the turn ran to its end');
    check(await button() === 'hidden', 'the button goes with the turn');

    // 4. Stop while paused ends the turn and the pause.
    await type('steps 4 700');
    await until('SB.activeTab().busy');
    await ev("document.getElementById('pauseBtn').click()");
    check(await until("SB.activeTab().pause?.phase === 'paused'"), 'paused again');
    await ev("document.getElementById('stopBtn').click()");
    check(await until('!SB.activeTab().busy && !SB.activeTab().pause'), 'Stop ends a paused turn');
    check(!(await ev(said('steps done'))), 'and the rest never ran');

    // 5. A turn that ends before any step: Pause had nothing to stop at, and says so.
    await type('wait 1500 no steps here');
    await until('SB.activeTab().busy');
    await ev("document.getElementById('pauseBtn').click()");
    check(await until("!SB.activeTab().busy && !SB.activeTab().pause"), 'the turn finished on its own');
    check(await until("/finished before there was a step to pause at/.test(document.getElementById('toast').textContent)", 3000), 'it says it finished before it could pause');

    // 6. Left paused, it parks: he reads his step, the turn ends "paused", and Continue carries on.
    await type('steps 4 700');
    await until('SB.activeTab().busy');
    await ev("document.getElementById('pauseBtn').click()");
    check(await until("SB.activeTab().pause?.phase === 'paused'"), 'paused for the long haul');
    check(await until("SB.activeTab().pause?.phase === 'parked'", PARK_MS + 10000), 'it parked');
    check(await until('!SB.activeTab().busy'), 'and the turn ended');
    check(await until(`!!SB.activeTab().el.querySelector('[title^="You paused it"]')`), 'the footer says paused');
    check(!(await ev(said('paused you in Shellby'))) && !(await ev(said('steps done'))), 'his note to himself is not shown, and nothing more ran');
    check(await button() === 'Continue' && !(await ev("document.getElementById('stopBtn').hidden")), `Continue and Stop stay (${await button()})`);
    check(/^Paused\. Continue picks up/.test(await line()), `the line says how to carry on ("${await line()}")`);
    await ev("document.getElementById('pauseBtn').click()");
    check(await until(said('Continue where you left off')), 'Continue carries on in a new turn');
    check(await until('!SB.activeTab().busy && !SB.activeTab().pause'), 'and the pause is over');

    // 7. Stop on a parked pause ends it without sending anything.
    await type('steps 4 700');
    await until('SB.activeTab().busy');
    await ev("document.getElementById('pauseBtn').click()");
    check(await until("SB.activeTab().pause?.phase === 'parked'", PARK_MS + 15000), 'parked again');
    const before = await ev("SB.activeTab().el.querySelectorAll('.msg.user').length");
    await ev("document.getElementById('stopBtn').click()");
    check(await until('!SB.activeTab().pause'), 'Stop ends a parked pause');
    check(await button() === 'hidden' && await ev("document.getElementById('status').hidden"), 'its line and buttons go');
    await wait(1000);
    check(!(await ev('SB.activeTab().busy')) && await ev("SB.activeTab().el.querySelectorAll('.msg.user').length") === before, 'and nothing was sent');
  } catch (e) {
    check(false, e.message);
  } finally {
    app.kill();
  }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
