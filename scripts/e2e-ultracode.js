// ci: ultracode: the chip, the estimate on Send, the ask before the first run, the card, its crabs, Stop, restored
// End-to-end check of Ultracode against the dev app over CDP, driven by the fake
// Claude CLI (test/fixtures/fake-claude.js plays Claude Code 2.1.299's Workflow
// run): no account, no usage (5-hour readings come from dev:usage, SHELLBY_FORECAST_TEST).
//   1. The Ultracode chip under the box is off; on, it says what it means, and
//      typing puts what a run usually costs on the Send button itself (a labelled
//      rough guess before any has run), with where your window would end under
//      the box; past the limit the button turns to a warning and the banner
//      offers the reset.
//   2. The first message asks in the confirm window (Cancel keeps it in the box),
//      then goes with the word "ultracode" on the end, where you can see it.
//   3. The run's card: phases, agents running and done, the clock, the cost "at
//      least", a few helper crabs out at once, and how it ended.
//   4. Stop ends a run that would go on forever; no second ask.
//   5. Closed and brought back, the conversation shows its cards again.
//   node scripts/e2e-ultracode.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { savePng } = require('./lib/shot');
const { panelBooted } = require('./lib/boot');
const { answerDialog } = require('./lib/dialog');
const { DEFAULTS } = require('../src/main/usage/runcost');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9487;
const SHOTS = process.env.E2E_SHOTS || null; // a folder: screenshots of the card running and done
const wait = ms => new Promise(r => setTimeout(r, ms));

async function cdp(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
  const send = (method, params = {}) => new Promise(r => {
    const i = ++id;
    pending.set(i, m => r(m.result));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r?.result?.value);
  return { ev, send, close: () => ws.close() };
}

const targets = async () => { try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return []; } };

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-')), SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '48087', SHELLBY_FORECAST_TEST: '1' },
  });
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) { list = await targets(); await wait(500); }
    const panel = await cdp(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    const { ev } = panel;
    const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await wait(150); } return false; };
    const type = text => ev(`(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })(SB.$('input'))`);
    const typeOnly = text => ev(`(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); })(SB.$('input'))`);
    const card = (sel = '.ultra-card') => `[...SB.activeTab().el.querySelectorAll(${JSON.stringify(sel)})].at(-1)`;
    // The first task's trophy card would sit over the card: put it away first.
    const shot = async name => { if (SHOTS) { await ev("[...document.querySelectorAll('button')].filter(b => /^Dismiss all/.test(b.textContent.trim()) && b.offsetParent).forEach(b => b.click())"); await wait(400); fs.mkdirSync(SHOTS, { recursive: true }); await savePng(panel.send, path.join(SHOTS, `ultracode-${name}.png`)); } };

    // The confirm window: what it says, then press `label` (lib/dialog.js).
    const answer = label => answerDialog(PORT, { press: label });

    await panelBooted(ev);
    await ev("shellby.setSettings({ onboarded: true }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");
    await wait(500);

    // 1. The chip.
    check(await ev("!SB.$('ultraChip').hidden && SB.$('ultraChip').getAttribute('aria-pressed') === 'false' && SB.$('ultraNote').hidden"), 'the Ultracode chip is there, off, with no warning');
    await ev("SB.$('ultraChip').click()");
    check(await ev("SB.$('ultraChip').getAttribute('aria-pressed') === 'true' && !SB.$('ultraNote').hidden"), 'on, it says so');
    check(/many agents/.test(await ev("SB.$('ultraNote').textContent")), 'the warning says it can use many agents and tokens');
    // What a run usually costs sits on the Send button and under the box (src/main/usage/runcost.js):
    // nothing has run yet, so a rough guess, said as one. Nothing to dismiss: no banner.
    const [lo, hi] = DEFAULTS.ultracode;
    const mid = Math.round((lo + hi) / 2);
    const reading = (pct, extra = '') => ev(`SB.api.devUsage({ pct: ${pct}, resetsAt: Date.now() + 3 * 3600e3 })`).then(() => typeOnly(`Audit the repo ${extra}`));
    await typeOnly('Audit the repo');
    check(await until(`SB.$('sendBtn').classList.contains('wide') && SB.$('sendBtn').textContent.trim() === 'Send · ~${mid}% of your window'`), `with the chip on, the Send button carries what a run usually costs: "Send · ~${mid}% of your window"`);
    const hint = await ev("SB.$('costHint').hidden ? '(hidden)' : SB.$('costHint').textContent");
    check(hint === `a rough guess: about ${mid}% of your 5-hour window`, `the line under the box says it is a rough guess, with no window reading to end from (${hint})`);
    check(await ev(`SB.$('costHint').title.startsWith("An Ultracode run hasn't run here yet; a rough guess is ${lo} to ${hi}% of your 5-hour window")`), 'the whole sentence, range and all, is its tooltip');
    check(await ev(`!SB.$('ultraEst').hidden && SB.$('ultraEst').textContent === 'Nothing like it has run here yet; a rough guess is ${lo} to ${hi}% of your 5-hour window.'`), 'the strip says what runs like this took');
    check(await ev("SB.$('outlook').hidden"), 'nothing to dismiss: no banner');
    // With a current reading: where the window would end and when it resets, and the small meter shows both.
    const now = 30;
    await reading(now, 'again');
    check(await until(`new RegExp('^a rough guess: about ${mid}% of your 5-hour window · it would end about ${Math.round(now + (lo + hi) / 2)}% full · resets ').test(SB.$('costHint').textContent)`), 'with a reading, the line says where it would end and when the window resets');
    check(await ev(`SB.$('costHint').querySelector('.mini .now')?.style.width === '${now}%'`), 'the small meter shows your window now');
    check(await ev(`SB.$('ultraEst').textContent.endsWith(' Yours is ${now}% full.')`), 'and the strip says how full yours is');
    // For a look (E2E_SHOTS): the button, the line and the strip at a 4K full screen and at the panel's own width.
    if (SHOTS) {
      for (const [width, height, name] of [[2560, 1440, 'wide'], [460, 700, 'narrow']]) {
        await panel.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await wait(400);
        await shot(`estimate-${name}`);
      }
      await panel.send('Emulation.clearDeviceMetricsOverride');
      await wait(300);
    }
    // Past the limit: the button turns to a warning, and the banner offers to send after the reset instead.
    await reading(90, 'once more');
    check(await until("SB.$('sendBtn').classList.contains('over') && /^Send anyway · ~/.test(SB.$('sendBtn').textContent.trim())"), 'past the limit the Send button turns to a warning');
    check(await until("!SB.$('outlook').hidden && [...SB.$('outlook').querySelectorAll('button')].some(b => b.textContent === 'Send after the reset')"), 'and the banner offers to send after the reset');
    check(await ev("/past your limit|past the share you keep/.test(SB.$('costHint').textContent)"), 'the line under the box says it would pass the limit');
    await reading(10, 'please');
    check(await until("!SB.$('sendBtn').classList.contains('over') && SB.$('outlook').hidden"), 'back under it, the warning goes');
    await ev("SB.$('ultraChip').click()");
    check(await ev("SB.$('ultraChip').getAttribute('aria-pressed') === 'false' && SB.$('ultraNote').hidden"), 'off again, the warning strip goes');
    check(await until("!SB.$('sendBtn').classList.contains('wide') && SB.$('costHint').hidden"), 'and so does the estimate');
    await typeOnly('');
    // The send waits on the confirm window, so a message in the feed means none was asked.
    await type('Is ultracode worth it?');
    check(await until("[...SB.activeTab().el.querySelectorAll('.msg.user')].some(e => /Is ultra\\W?code worth it\\?$/.test(e.textContent.trim()))"), 'off, the word typed in a message sends at once, with no ask');
    check(!(await targets()).some(x => x.url.endsWith('dialog.html')), 'and no confirm window');
    check(await until('!SB.activeTab().busy'), 'and starts no run');
    check(await ev("SB.activeTab().el.querySelectorAll('.ultra-card').length === 0"), 'no run card either');
    await ev("SB.$('ultraChip').click()");

    // 2. The ask before the first one.
    await type('Audit the repo');
    const asked = await answer('Cancel');
    check(!!asked && /Ultracode/.test(asked.title) && /\$\d/.test(asked.detail), `the confirm window says what to expect (${asked?.detail})`);
    check(asked?.focused === 'Cancel', 'Cancel is the default');
    check(await until("SB.$('input').value === 'Audit the repo' && !SB.activeTab().busy"), 'Cancel keeps the message in the box, unsent');
    await type('Audit the repo');
    await answer('Send with Ultracode');
    check(await until("[...SB.activeTab().el.querySelectorAll('.msg.user')].some(e => /Audit the repo\\s+ultracode$/.test(e.textContent.trim()))"), 'it went with the word ultracode on the end, in plain sight');

    // 3. The card.
    check(await until(`!!${card()}`), 'the run has a card');
    check(/Ultracode run: audit/.test(await ev(`${card()}.textContent`)), 'named for its script');
    let mostCrabs = 0;
    const end = Date.now() + 15000;
    while (Date.now() < end && !(await ev(`${card()}.classList.contains('status-completed')`))) {
      mostCrabs = Math.max(mostCrabs, await ev('SB.activeTab().crew || 0'));
      await wait(100);
    }
    check(await ev(`${card()}.classList.contains('status-completed')`), 'it finishes');
    check(mostCrabs > 0 && mostCrabs <= 3, `its agents walked out as helper crabs, a few at once (${mostCrabs})`);
    const done = await ev(`${card()}.textContent`);
    check(/0 running · 7 done/.test(done), 'all seven agents done');
    check(/Scout.*Fix/.test(done), 'its phases');
    check(/at least \$/.test(done), `what it cost, at the least (${await ev(`${card()}.querySelector('.ultra-cost').textContent`)})`);
    check(/all 4 are fixed/.test(done), 'how it went');
    check(await ev(`!${card()}.querySelector('.ultra-stop')`), 'no Stop once it has ended');
    check(await until('(SB.activeTab().crew || 0) === 0'), 'every crab home');
    check(await ev("SB.activeTab().el.querySelectorAll('.ultra-card').length === 1"), 'one card, updated in place');
    await shot('done');

    // 4. Stop, with no second ask.
    await type('Audit forever');
    check(await until(`${card()}?.classList.contains('status-running') && /7 running/.test(${card()}.textContent)`), 'a second run, no second ask');
    check(/\+4 more/.test(await ev(`${card()}.textContent`)), 'the agents past the few out as crabs are "+N more"');
    await shot('running');
    await ev(`${card()}.querySelector('.ultra-stop').click()`);
    check(await until(`${card()}.classList.contains('status-stopped')`), 'Stop ends it');

    // 5. Closed and brought back.
    const tabId = await ev('SB.activeTab().id');
    await wait(500); // History writes what it holds every moment or so
    await ev(`SB.closeTab(${JSON.stringify(tabId)}, { quiet: true })`);
    await wait(800);
    await ev('SB.reopenClosed()');
    check(await until(`SB.activeTab()?.id === ${JSON.stringify(tabId)} && SB.activeTab().el.querySelectorAll('.ultra-card').length === 2`), 'brought back, both cards are there');
    check(await ev("[...SB.activeTab().el.querySelectorAll('.ultra-card')].map(c => c.className.match(/status-\\w+/)[0]).join() === 'status-completed,status-stopped'"), 'each as it ended');
    check(await ev("SB.$('ultraChip').getAttribute('aria-pressed') === 'false'"), 'and Ultracode starts off again');
    panel.close();
  } catch (e) {
    check(false, e.message);
  } finally {
    app.kill();
  }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
