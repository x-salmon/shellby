// ci: inline savers: the card offering Haiku before a small message, and the nudge under a repeated big read
// End-to-end check of the inline savers against the dev app over CDP, driven by
// the fake Claude CLI (test/fixtures/fake-claude.js): no account, no usage.
//   1. A small message on Opus: a card in the feed before Claude starts, with
//      the estimate on each model and a countdown; "Use Haiku for this one"
//      runs that turn on Haiku and the tab goes back to Opus; "Keep Opus" and a
//      countdown that runs out keep it, and after two in a row the tab stops asking
//   2. "Always for questions like this": that kind goes to Haiku by itself with
//      a note on the turn and Undo; "Stop suggesting" turns the setting off; a
//      tab on Sonnet is never asked
//   3. A whole read of a big generated file read in three conversations this
//      week: a card under the step, mid-turn, with the deny rule drafted and no
//      "Apply everywhere"; Apply through the confirm window writes the
//      project's .claude/settings.json and Undo takes it back; the same file
//      rests for a week; "Never for this file"; a card left unanswered folds
//      into one line when the turn ends
//   node scripts/e2e-savers.js      E2E_SHOTS=<dir> keeps screenshots at 2560x1440 and 460x700
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { panelBooted } = require('./lib/boot');
const { answerDialog } = require('./lib/dialog');
const { savePng } = require('./lib/shot');
const hotfiles = require('../src/main/usage/hotfiles');
const readNudge = require('../src/main/read-nudge');
const savers = require('../src/renderer/panel/savers-logic');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9494;
const HOOK_PORT = process.env.E2E_HOOK_PORT || '47994';
const SHOTS = process.env.E2E_SHOTS || path.join(os.tmpdir(), 'shellby-e2e-savers');
const wait = ms => new Promise(r => setTimeout(r, ms));
// A read this long is past the nudge's mark (read-nudge.js BIG_READ_TOKENS, four characters a token).
const BIG_CHARS = readNudge.BIG_READ_TOKENS * 4 + 4000;

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r?.result?.value);
  return new Promise(r => { ws.onopen = () => r({ ev, send, close: () => ws.close() }); });
}

// A project whose files Claude keeps reading, and the week's transcripts that say so (hotfiles.js reads them).
function world(base) {
  const repo = path.join(base, 'shop');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package-lock.json'), `{"name":"shop","lockfileVersion":3,"packages":{${'"node_modules/x":{"version":"1.0.0"},'.repeat(900)}"":{}}}\n`);
  fs.writeFileSync(path.join(repo, 'dist', 'panel.html'), `<!doctype html>${'<div class="built"></div>'.repeat(2000)}\n`);
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), `// The shop app: wires the screens together.\n${'module.exports = 1;\n'.repeat(2400)}`);
  try { execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'ignore' }); } catch { /* a plain folder will do */ }
  const config = path.join(base, 'claude');
  const dir = path.join(config, 'projects', hotfiles.folderOf(repo));
  fs.mkdirSync(dir, { recursive: true });
  const line = rel => JSON.stringify({ type: 'assistant', cwd: repo, timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', id: 'x', name: 'Read', input: { file_path: path.join(repo, rel) } }] } });
  for (const s of ['one', 'two', 'three']) fs.writeFileSync(path.join(dir, `${s}.jsonl`), `${[line('package-lock.json'), line('dist/panel.html'), line('src/app.js')].join('\n')}\n`);
  return { repo, config };
}

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-savers-')));
  const { repo, config } = world(base);
  const data = path.join(base, 'userdata');
  fs.mkdirSync(data, { recursive: true });
  // New conversations on Opus, so a small message earns the card; the project is where the reads happened.
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ onboarded: true, sounds: false, wander: false, model: 'opus', cwd: repo }));
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_USER_DATA: data, CLAUDE_CONFIG_DIR: config, SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: HOOK_PORT },
  });
  let panel = null;
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    panel = await connect(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    const { ev, send } = panel;
    const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await wait(150); } return false; };
    const feed = "SB.activeTab().el";
    const replies = `${feed}.querySelectorAll('.msg.assistant').length`;
    const lastReply = `([...${feed}.querySelectorAll('.msg.assistant')].at(-1)?.textContent || '')`;
    // Type and send, and remember how many replies the tab had: the next one is the answer, whatever it says.
    let seen = 0;
    const type = async text => {
      seen = await ev(replies);
      await ev(`(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })(SB.$('input'))`);
    };
    const answered = (words, ms = 15000) => until(`!SB.activeTab().busy && ${replies} > ${seen} && ${lastReply}.includes(${JSON.stringify(words)})`, ms);
    const shots = async name => {
      await ev('SB.clearCelebrations?.()');
      await send('Emulation.setDeviceMetricsOverride', { width: 460, height: 700, deviceScaleFactor: 1, mobile: false });
      await wait(150);
      await ev(`${feed}.scrollTop = ${feed}.scrollHeight`);
      await savePng(send, path.join(SHOTS, `${name}-460.png`));
      await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
      await wait(150);
      await savePng(send, path.join(SHOTS, `${name}-2560.png`));
      await send('Emulation.clearDeviceMetricsOverride');
      await wait(100);
    };
    await panelBooted(ev);
    await ev("SB.setView('chat')");
    check(await until("SB.activeTab() && SB.state.settings.model === 'opus'"), 'a conversation on Opus');

    // ---- 1. a small message: the card first, then whichever model you pick
    await type('which model is this?');
    check(await until(`${feed}.querySelector('.saver-ask') && !SB.activeTab().busy`), 'a small message earns a card before Claude starts, and nothing has gone out');
    check(await ev(`${feed}.querySelector('.msg.user.pending')?.textContent.includes('which model is this?') && !${feed}.querySelector('.msg.user:not(.pending)')`), 'the message waits in the feed, dimmed, above the card');
    check(await ev(`(c => c.querySelector('.saver-title').textContent === 'Quick one. Haiku could take it.' && /about [\\d.]+% of your 5-hour window/.test(c.querySelector('.saver-text').textContent) && /Nothing has gone out yet/.test(c.textContent))(${feed}.querySelector('.saver-ask'))`), 'it names Haiku, says "about" and that nothing has gone out');
    check(await ev(`(c => /Opus/.test(c.querySelectorAll('.saver-name')[0].textContent) && /this tab/.test(c.querySelectorAll('.saver-name')[0].textContent) && c.querySelectorAll('.saver-name')[1].textContent === 'Haiku' && c.querySelectorAll('.saver-bar').length === 2 && c.querySelector('.saver-bar.lit'))(${feed}.querySelector('.saver-ask'))`), 'a bar for Opus (this tab) and a lit one for Haiku');
    check(await ev(`/^Opus in \\d s if you don't pick$/.test(${feed}.querySelector('.saver-wait-text').textContent)`), 'the countdown says Opus if you do nothing');
    check(await ev(`(c => c.querySelector('.saver-cheaper').textContent === 'Use Haiku for this one' && c.querySelector('.saver-keep').textContent === 'Keep Opus' && /^Always for questions like this/.test(c.querySelector('.saver-always-btn').textContent))(${feed}.querySelector('.saver-ask'))`), 'the three choices, worded for this message');
    await ev(`${feed}.querySelector('.saver-cheaper').click()`);
    check(await until(`!${feed}.querySelector('.saver-ask') && !${feed}.querySelector('.msg.user.pending') && ${feed}.querySelector('.msg.user')`), '"Use Haiku for this one" sends it');
    check(await answered('model:haiku'), 'and that turn ran on Haiku');
    check(await ev(`${feed}.querySelector('.msg.user .model-tag')?.textContent.includes('on Haiku · this one')`), 'the message says so');
    check(await until("SB.activeTab().model === 'opus'"), 'the tab is back on Opus');
    await type('which model is this?');
    check(await until(`${feed}.querySelector('.saver-ask')`), 'the next small message asks again');
    await shots('model-card'); // should the countdown run out meanwhile, Opus is kept either way
    await ev(`${feed}.querySelector('.saver-keep')?.click()`);
    check(await answered('model:opus'), '"Keep Opus" sends it on Opus');
    check(await ev(`!${feed}.querySelector('.saver-ask') && ![...${feed}.querySelectorAll('.msg.user')].at(-1).querySelector('.model-tag')`), 'with no note on the message');
    await type('which model is this?');
    check(await until(`${feed}.querySelector('.saver-ask')`), 'once more it asks');
    check(await until(`${feed}.querySelector('.saver-fold')?.textContent.startsWith('Kept Opus: nothing was picked in time')`, savers.COUNTDOWN_MS + 5000), 'left alone, the countdown keeps Opus and the card folds to a line');
    check(await answered('model:opus'), 'and the message went on Opus');
    await type('which model is this?');
    check(await answered('model:opus'), 'after two keeps in a row the tab sends straight away');
    check(await ev(`${feed}.querySelectorAll('.saver-ask').length === 0 && ${feed}.querySelectorAll('.msg.user').length === 4`), 'with no card this time');

    // ---- 2. always, undo, off, and a tab on Sonnet
    await ev('SB.newTab()');
    check(await until(`${feed}.querySelectorAll('.msg').length === 0`), 'a new tab');
    await type('which model is this?');
    check(await until(`${feed}.querySelector('.saver-ask')`), 'a new tab asks afresh');
    await ev(`${feed}.querySelector('.saver-always-btn').click()`);
    check(await until(`!${feed}.querySelector('.saver-always').hidden && ${feed}.querySelector('.saver-always-yes').textContent === 'Always use Haiku for questions like this'`), 'the always button opens its choices');
    await ev(`${feed}.querySelector('.saver-always-yes').click()`);
    check(await answered('model:haiku'), '"Always for questions like this" sends it on Haiku');
    check(await until("SB.state.settings.modelAlways?.question === 'haiku'"), 'and keeps the choice in Settings');
    check(await ev(`${feed}.querySelector('.msg.user .model-tag')?.textContent.includes('on Haiku · always for questions like this') && ${feed}.querySelector('.model-tag-undo')`), 'the message says so, with Undo');
    await ev('SB.newTab()');
    await type('why is the sky blue?');
    check(await answered('echo: why is the sky blue?'), 'the next question goes without asking');
    check(await ev(`${feed}.querySelectorAll('.saver-ask').length === 0 && ${feed}.querySelector('.msg.user .model-tag')?.textContent.includes('always for questions like this')`), 'straight to Haiku, with the note on the turn');
    check(await until("SB.activeTab().model === 'opus'"), 'and the tab is back on Opus after it');
    await ev(`${feed}.querySelector('.model-tag-undo').click()`);
    check(await until(`SB.state.settings.modelAlways?.question === undefined && ${feed}.querySelector('.model-tag-undone')`), 'Undo on the note forgets the choice');
    await type('which model is this?');
    check(await until(`${feed}.querySelector('.saver-ask')`), 'and the card asks again');
    await ev(`${feed}.querySelector('.saver-always-btn').click(); ${feed}.querySelector('.saver-off').click()`);
    check(await answered('model:opus'), '"Stop suggesting" sends it on Opus');
    check(await until("SB.state.settings.modelSuggest === false"), 'and turns the setting off');
    await type('which model is this?');
    check(await answered('model:opus'), 'with it off, no card');
    check(await ev(`${feed}.querySelectorAll('.saver-ask').length === 0`), 'none at all');
    await ev("shellby.setSettings({ modelSuggest: true }).then(r => { SB.state.settings = r.settings; })");
    await ev('SB.newTab()');
    await ev("SB.chooseModel('sonnet')");
    check(await until("SB.activeTab().modelAsked === 'sonnet'"), 'a tab put on Sonnet');
    await type('which model is this?');
    check(await answered('model:sonnet'), 'a tab already on Sonnet is never asked');
    check(await ev(`${feed}.querySelectorAll('.saver-ask').length === 0`), 'no card there');

    // ---- 3. a repeated big read: the Lean tab's one-tap fix, under the step, mid-turn
    await ev('SB.newTab()');
    await type(`bigread package-lock.json ${BIG_CHARS} wait 14000`); // long enough to look, screenshot and apply before the reply folds it
    check(await until(`${feed}.querySelector('.nudge-card')`, 15000), 'a big read of a file read in three conversations this week gets a card under the step');
    check(await ev('SB.activeTab().busy'), 'while the turn is still running');
    check(await ev(`(c => /3rd conversation this week/.test(c.querySelector('.nudge-mark b').textContent) && c.querySelector('.nudge-mark code').textContent === 'package-lock.json' && /never changed it/.test(c.querySelector('.nudge-mark').textContent))(${feed}.querySelector('.nudge-card'))`), 'it counts the conversations and names the file');
    check(await ev(`(c => /A deny rule keeps it out/.test(c.textContent) && c.querySelector('.lean-diff') && /Read\\(\\.\\/package-lock\\.json\\)/.test(c.querySelector('.lean-diff').textContent))(${feed}.querySelector('.nudge-card'))`), 'with the deny rule drafted and its diff');
    check(await ev(`(c => c.querySelector('.nudge-apply').textContent === 'Apply to this project' && c.querySelector('.nudge-not') && c.querySelector('.nudge-never') && !/Apply everywhere/.test(c.textContent) && /Saves about [\\d.]+k a conversation/.test(c.querySelector('.saver-fine').textContent))(${feed}.querySelector('.nudge-card'))`), 'Apply to this project, Not this one, Never for this file, and what it saves; no "everywhere"');
    check(await ev(`${feed}.querySelector('.tool.hot .t-detail')?.textContent.includes('package-lock.json') && ${feed}.querySelector('.tool.hot').nextElementSibling.classList.contains('saver-host')`), 'the card sits under its Read step, which is marked');
    await shots('read-nudge');
    const settingsFile = path.join(repo, '.claude', 'settings.json');
    await ev(`${feed}.querySelector('.nudge-apply').click()`);
    const dlg = await answerDialog(PORT, { press: 'Add the rule' });
    check(!!dlg && /package-lock\.json/.test(dlg.title) && /Read\(\.\/package-lock\.json\)/.test(dlg.detail || ''), 'Apply asks in the confirm window, showing the rule');
    check(await until(`${feed}.querySelector('.saver-fold')?.textContent.includes('Added Read(./package-lock.json) to settings.json')`), 'confirmed, the card folds to a line saying what went in');
    check(fs.existsSync(settingsFile) && JSON.parse(fs.readFileSync(settingsFile, 'utf8')).permissions.deny.includes('Read(./package-lock.json)'), "the project's .claude/settings.json has the rule");
    check(await answered('read package-lock.json whole'), 'the turn carried on around it');
    await ev(`${feed}.querySelector('.nudge-undo').click()`);
    check(await until(`${feed}.querySelector('.saver-fold')?.textContent.includes('settings.json is back as it was')`), 'Undo on the line puts the file back');
    check(!fs.existsSync(settingsFile), 'there was none before, so there is none now');
    await type(`bigread package-lock.json ${BIG_CHARS}`);
    check(await answered('read package-lock.json whole'), 'the same file read again');
    await wait(1500); // room for a card that must not come
    check(await ev(`${feed}.querySelectorAll('.nudge-card').length === 0 && ${feed}.querySelectorAll('.saver-fold').length === 1`), 'is not nudged about twice in a week');
    await type(`bigread dist/panel.html ${BIG_CHARS} wait 4000`);
    check(await until(`${feed}.querySelector('.nudge-card .nudge-mark code')?.textContent === 'dist/panel.html'`, 15000), 'another generated file gets its own card');
    await ev(`${feed}.querySelector('.nudge-never').click()`);
    check(await until(`${feed}.querySelectorAll('.nudge-card').length === 0`), '"Never for this file" takes it away');
    check(await answered('read dist/panel.html whole'), 'and the turn ends');
    check(await ev(`${feed}.querySelectorAll('.saver-fold').length === 1`), 'with nothing to fold');
    await type(`bigread src/app.js ${BIG_CHARS} wait 3000`);
    check(await until(`${feed}.querySelector('.nudge-card .nudge-mark code')?.textContent === 'src/app.js' && /A line in CLAUDE\\.md/.test(${feed}.querySelector('.nudge-card').textContent)`, 15000), 'a file that is not generated gets a CLAUDE.md line instead');
    check(await answered('read src/app.js whole'), 'left alone until the turn ends');
    check(await until(`${feed}.querySelectorAll('.nudge-card').length === 0 && [...${feed}.querySelectorAll('.saver-fold')].some(f => /Claude read src\\/app\\.js again/.test(f.textContent) && /Lean tab/.test(f.textContent))`), 'an unanswered card folds into one line once the reply is in');
    check(await ev("SB.state.tabs.size >= 5 && !document.querySelector('.error-block')"), 'no errors along the way');
    console.log(`screenshots in ${SHOTS}`);
  } catch (e) {
    check(false, e.stack || e.message);
  } finally {
    panel?.close();
    app.kill();
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* a handle still open */ }
  }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
