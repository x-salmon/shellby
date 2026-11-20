// ci: engineer: the chip, its tools from the next start, changes held back, the decision card, approve, build, check, restored
// End-to-end check of Engineer mode against the dev app over CDP, driven by the
// fake Claude CLI (test/fixtures/fake-claude.js): `mcp <tool> <json>` plays
// Claude calling one of the crab's tools, `edit <file> <words>` a Write.
//   1. The Engineer chip under the box is off; on, it says what it means, and
//      the conversation's next process has decide and check_decision.
//   2. With nothing approved, a change is held back: the file isn't written.
//   3. decide puts the decision on a card: the options, Claude's pick, the
//      test plan. Send it back needs a note.
//   4. Approve sends Claude the answer; the weighing folds away, and the same
//      change now goes through.
//   5. check_decision puts how it went on the same card.
//   6. Closed and brought back: the card as it ended, and the chip still on.
//   7. Off again: the tools go with it.
//   node scripts/e2e-engineer.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { savePng } = require('./lib/shot');
const { panelBooted } = require('./lib/boot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9531;
const SHOTS = process.env.E2E_SHOTS || null; // a folder: screenshots of the card waiting and done
const wait = ms => new Promise(r => setTimeout(r, ms));

const DECISION = {
  title: 'Greet in a text file',
  goal: 'a.txt says hi.',
  constraints: ['No dependencies'],
  options: [
    { name: 'Plain file', summary: 'Write a.txt directly.', pros: ['Simple'], cons: ['Nothing to reuse'] },
    { name: 'Template', summary: 'Render a.txt from a template.', pros: ['Reusable'], cons: ['More moving parts'] },
  ],
  choice: 'Plain file',
  why: 'One file, one line.',
  test_plan: ['a.txt exists and says hi'],
  risks: ['None worth naming'],
};
const OUTCOME = { followed: true, summary: 'Wrote a.txt.', tests: [{ check: 'a.txt exists and says hi', result: 'passed' }] };

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
  // A plain folder, not a git project: no copy of it is made before the first change.
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-e2e-engineer-')));
  const work = path.join(base, 'proj');
  fs.mkdirSync(work);
  const file = path.join(work, 'a.txt');
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_USER_DATA: path.join(base, 'userdata'), SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '48131' },
  });
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) { list = await targets(); await wait(500); }
    const panel = await cdp(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    const { ev } = panel;
    const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await wait(150); } return false; };
    const idle = () => until('SB.activeTab() && !SB.activeTab().busy');
    const say = async text => { await ev(`SB.send(${JSON.stringify(text)})`); await until('SB.activeTab().busy', 3000); await idle(); };
    const lastReply = () => ev("[...SB.activeTab().el.querySelectorAll('.msg.assistant, .assistant')].at(-1)?.textContent || ''");
    const card = "[...SB.activeTab().el.querySelectorAll('.eng-card')].at(-1)";
    const shot = async name => { if (SHOTS) { await ev("[...document.querySelectorAll('button')].filter(b => /^Dismiss all/.test(b.textContent.trim()) && b.offsetParent).forEach(b => b.click())"); await wait(400); fs.mkdirSync(SHOTS, { recursive: true }); await savePng(panel.send, path.join(SHOTS, `engineer-${name}.png`)); } };

    await panelBooted(ev);
    await ev("shellby.setSettings({ onboarded: true }).then(r => { SB.state.settings = r.settings; SB.setView('chat'); })");
    await ev(`shellby.setFolder(${JSON.stringify(work)}).then(SB.folderChanged)`);
    await wait(500);
    await ev('SB.newTab()');
    await wait(300);

    // 1. The chip, and the tools it brings.
    check(await ev("!SB.$('engChip').hidden && SB.$('engChip').getAttribute('aria-pressed') === 'false' && SB.$('engNote').hidden"), 'the Engineer chip is there, off');
    await say('mcp tools');
    check(!/decide/.test(await lastReply()), 'off, Claude has no decide tool');
    await ev("SB.$('engChip').click()");
    check(await until("SB.$('engChip').getAttribute('aria-pressed') === 'true' && !SB.$('engNote').hidden"), 'on, it says so above the box');
    check(/decision on a card/.test(await ev("SB.$('engNote').textContent")), 'the line says Claude decides on a card first');
    await say('mcp tools');
    check(/decide,check_decision/.test(await lastReply()), 'the next process has decide and check_decision');

    // 2. Held back with nothing approved.
    await say('edit a.txt hi');
    check(!fs.existsSync(file), 'a change with nothing approved is held back: the file is not written');

    // 3. The card.
    await say(`mcp decide ${JSON.stringify(DECISION)}`);
    check(await until(`${card}?.classList.contains('phase-proposed')`), 'decide puts a card in the conversation, waiting for you');
    check(await ev(`${card}.querySelectorAll('.eng-option').length === 2 && /Claude's pick/.test(${card}.querySelector('.eng-option.chosen').textContent)`), "both options are on it, Claude's pick marked");
    check(await ev(`/a.txt exists and says hi/.test(${card}.querySelector('.eng-plan').textContent)`), 'the test plan is on it');
    if (SHOTS) await ev(`${card}.scrollIntoView({ block: 'start' })`);
    await shot('proposed');
    await ev(`[...${card}.querySelectorAll('.eng-actions button')].find(b => /Send it back/.test(b.textContent)).click()`);
    await wait(300);
    check(await ev(`${card}.classList.contains('phase-proposed')`), 'Send it back with no note sends nothing');
    check(!fs.existsSync(file), 'still nothing written');

    // 4. Approve.
    await ev(`${card}.querySelector('.eng-note-input').value = 'Keep it short'`);
    await ev(`[...${card}.querySelectorAll('.eng-actions button')].find(b => /^Approve/.test(b.textContent)).click()`);
    check(await until("[...SB.activeTab().el.querySelectorAll('.user, .msg.user')].some(m => /Approved: Greet in a text file/.test(m.textContent))"), 'Approve goes to Claude as your message');
    await idle();
    check(await until(`${card}?.classList.contains('phase-approved') && !!${card}.querySelector('details.eng-weighed')`), 'the card says approved, the weighing folded away');
    check(await ev(`/Keep it short/.test(${card}.textContent)`), 'your note stays on it');
    check(await ev(`[...${card}.querySelectorAll('.eng-actions button')].some(b => b.textContent === 'Close this decision')`), 'while it is being built, it can be closed');
    await say('edit a.txt hi');
    check(fs.existsSync(file), 'approved, the same change goes through');

    // 5. Checked.
    await say(`mcp check_decision ${JSON.stringify(OUTCOME)}`);
    check(await until(`${card}?.classList.contains('phase-checked')`), 'check_decision puts how it went on the card');
    check(await ev(`/Built as decided/.test(${card}.textContent) && /passed/.test(${card}.querySelector('.eng-tests').textContent)`), 'built as decided, each check with how it went');
    check(await ev("SB.activeTab().el.querySelectorAll('.eng-card').length === 1"), 'one card for the decision, moved along as it went');
    await shot('checked');

    // 6. Closed and brought back.
    const tabId = await ev('SB.activeTab().id');
    await wait(500); // History writes what it holds every moment or so
    await ev(`SB.closeTab(${JSON.stringify(tabId)}, { quiet: true })`);
    await wait(800);
    await ev('SB.reopenClosed()');
    check(await until(`SB.activeTab()?.id === ${JSON.stringify(tabId)} && ${card}?.classList.contains('phase-checked')`), 'brought back, the card is as it ended');
    check(await until("SB.$('engChip').getAttribute('aria-pressed') === 'true'"), 'and Engineer mode is still on');

    // 7. Off again.
    await ev("SB.$('engChip').click()");
    check(await until("SB.$('engChip').getAttribute('aria-pressed') === 'false' && SB.$('engNote').hidden"), 'off again');
    await say('mcp tools');
    check(!/decide/.test(await lastReply()), 'and the tools go with it');
    panel.close();
  } catch (e) {
    check(false, e.message);
  } finally {
    app.kill();
    await wait(500);
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* still held by the app on its way out */ }
  }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
