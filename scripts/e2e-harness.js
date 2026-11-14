// ci: other agents' CLIs: Gemini CLI from the palette, its note, a streamed reply, a permission card, Claude-only chips refused
// End-to-end check of a conversation on another agent's CLI (harness/), against
// the dev app over CDP with the fake ACP agent (test/fixtures/fake-acp.js)
// standing in for Gemini CLI, OpenCode and Codex:
//   1. the palette offers a new conversation in each of them
//   2. one opens with a note saying which agent runs it
//   3. a message gets that agent's reply, written as it comes
//   4. its permission prompt is a card here, and Allow reaches the agent
//   5. Claude Code's own model chip is refused for it, in plain words
//   node scripts/e2e-harness.js [screenshotDir]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { savePng } = require('./lib/shot');
const { panelBooted } = require('./lib/boot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9493;
const HOOK = Number(process.env.E2E_HOOK_PORT) || 48133;
const OUT = process.argv[2] || null;
const wait = ms => new Promise(r => setTimeout(r, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  const shot = async name => { if (!OUT) return; await savePng(send, path.join(OUT, `${name}.png`)); };
  return { ev, shot, close: () => ws.close() };
}

(async () => {
  let fails = 0;
  let feedText = async () => '';
  const check = async (ok, label) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (ok) return;
    fails++;
    // What the conversation showed, so a failure on CI says why.
    console.log(`      feed: ${String(await feedText().catch(() => '')).replace(/\s+/g, ' ').slice(-400)}`);
  };
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-harness-'));
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ tideEvents: false, onboarded: true }));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: {
      ...process.env, SHELLBY_E2E: '1', SHELLBY_USER_DATA: data, SHELLBY_HOOK_PORT: String(HOOK),
      SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'),
      SHELLBY_FAKE_ACP: path.join(ROOT, 'test', 'fixtures', 'fake-acp.js'),
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
    feedText = () => ev('SB.activeTab()?.el.textContent || ""');
    const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await wait(60); } return false; };
    await panelBooted(ev);
    await ev("SB.setView('chat')");

    // ---- 1. the palette
    await check(await until("SB.harnesses.length === 3 && SB.harnesses.every(h => h.installed)", 5000), 'Gemini CLI, OpenCode and Codex are offered (the fake stands in for all three)');
    await ev("document.getElementById('paletteBtn').click()");
    await ev("const i = document.getElementById('paletteInput'); i.value = 'gemini'; i.dispatchEvent(new Event('input', { bubbles: true }))");
    await check(await until("[...document.querySelectorAll('#paletteList *')].some(e => /New conversation in Gemini CLI/.test(e.textContent))", 3000), 'the palette finds "New conversation in Gemini CLI"');
    await panel.shot('1-palette');
    await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");

    // ---- 2. it opens, saying which agent runs it
    await ev("SB.newTabOn(SB.harnesses.find(h => h.id === 'gemini'))");
    await check(await until("/Gemini CLI.*runs this conversation/.test(SB.activeTab().el.textContent)", 4000), 'a new tab says Gemini CLI runs it');

    // ---- 3. a reply, written as it comes
    await ev("document.getElementById('input').value = ''; SB.send('hello from shellby')");
    await check(await until("[...SB.activeTab().el.querySelectorAll('.msg.assistant')].some(m => m.textContent.includes('echo: hello from shellby'))", 8000), "the agent's reply shows");
    await check(await until('!SB.activeTab().busy', 5000), 'and the turn ends');
    await panel.shot('3-reply');

    // ---- 4. a permission card
    await ev("SB.send('tool')");
    await check(await until("!!SB.activeTab().el.querySelector('.btn.allow')", 8000), 'its permission prompt is a card with Allow');
    await check(await ev("/Run your tests/.test(SB.activeTab().el.textContent)"), 'in the same plain words as a Claude card');
    await panel.shot('4-card');
    await ev("[...SB.activeTab().el.querySelectorAll('.btn.allow')].pop().click()");
    await check(await until("[...SB.activeTab().el.querySelectorAll('.msg.assistant')].some(m => m.textContent.includes('ALLOWED'))", 8000), 'Allow reaches the agent');
    await until('!SB.activeTab().busy', 5000);

    // ---- 5. Claude Code's model chip is refused for it
    const err = await ev("shellby.setTabModel(SB.state.activeTab, 'claude-opus-5-5').then(r => r?.error || '', e => String(e?.message || e))");
    await check(/only works in a Claude Code conversation/.test(String(err)), `picking a Claude model is refused for it (${String(err).slice(0, 80)})`);
  } catch (e) {
    await check(false, `the run itself: ${e.message}`);
  } finally {
    panel?.close();
    app.kill();
    await wait(1500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* still held */ }
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
