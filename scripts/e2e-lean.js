// End-to-end check of Lean Shell against the dev app over CDP, in two runs:
//   1. With the fake Claude CLI (no account, no usage): a reply lights the
//      prompt-cache dot on the context chip and its menu explains it; starting
//      a crowded conversation fresh pays the "fresh" XP.
//   2. With the REAL Claude Code CLI, read-only: Toolbox → Lean lists plugins
//      with Claude Code's own estimates, MCP servers and memory files, and the
//      bar of what every turn carries, part by part, with its "setup ~Nk/turn"
//      line, the cut on each row and the card that adds them up; "Turn off" on
//      the pretend home's output style, "Take all" (each switch asked in turn,
//      the advice drafted in a new tab) and "Turn off" on a plugin each open the
//      isolated confirm window, which is cancelled, so nothing is ever changed.
//      Screenshots go to the temp profile, the Lean tab at 2560 and at 460 wide too.
//   node scripts/e2e-lean.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { panelBooted } = require('./lib/boot');
const { answerDialog } = require('./lib/dialog');
const { savePng } = require('./lib/shot');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = ms => new Promise(r => setTimeout(r, ms));

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.result?.value;
  };
  // Guarded (lib/shot.js): a window that never paints is noted, not waited for.
  const shot = file => savePng((method, params) => send(method, params).then(r => r.result), file);
  return { ev, shot, send, close: () => ws.close() };
}

async function launch(port, env) {
  const app = spawn(ELECTRON, [ROOT, `--remote-debugging-port=${port}`], { stdio: 'ignore', env: { ...process.env, ...env } });
  const target = async (suffix, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      try {
        const t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(x => x.url.endsWith(suffix));
        if (t) return t;
      } catch { /* starting */ }
      await wait(500);
    }
    throw new Error(`${suffix} never appeared`);
  };
  return { app, target, port };
}

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const poll = async (w, expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await w.ev(expr).catch(() => false)) return true; await wait(200); } return false; };

  // ---- 1. the cache dot and the fresh-start XP, with the fake CLI
  const fake = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-'));
  fs.writeFileSync(path.join(fake, 'settings.json'), JSON.stringify({ onboarded: true, sounds: false, wander: false }));
  let run = await launch(9391, { SHELLBY_USER_DATA: fake, SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47988' });
  try {
    const panel = await cdp((await run.target('panel.html')).webSocketDebuggerUrl);
    await panelBooted(panel.ev);
    await panel.ev("SB.setView('chat')");
    const type = text => panel.ev(`(i => { i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })(SB.$('input'))`);

    await type('big 60000');
    check(await poll(panel, "SB.activeTab().context?.pct === 30 && !SB.activeTab().busy"), 'a reply fills the context meter');
    check(await poll(panel, "SB.$('ctxChip').dataset.cache === 'warm'"), 'the chip shows a warm prompt cache');
    check(await panel.ev("getComputedStyle(SB.$('ctxChip'), '::after').backgroundColor === 'rgb(127, 214, 194)'"), 'the warm dot is sea-glass, not grey');
    check(await panel.ev("/Prompt cache warm for about 5 more min/.test(SB.$('ctxChip').title)"), 'its tooltip says how long it stays warm');
    await panel.ev("SB.$('ctxChip').click()");
    check(await panel.ev("SB.$('ctxMenu').querySelector('.cache-note')?.textContent.includes('a tenth of the price')"), 'the chip menu explains the cache');
    await panel.shot(path.join(fake, 'lean-cache-menu.png'));
    await panel.ev('SB.closeMenus()');
    // Cooled: pretend the last call was ten minutes ago.
    await panel.ev("SB.activeTab().cache = { ...SB.activeTab().cache, at: Date.now() - 10 * 60 * 1000 }; SB.syncContextUi()");
    check(await panel.ev("SB.$('ctxChip').dataset.cache === 'cold' && /re-reads the whole conversation \\(60k tokens\\) at full price, once/.test(SB.$('ctxChip').title)"), 'a cooled cache says the next message re-reads it once, and nothing more');
    check(await panel.ev("getComputedStyle(SB.$('ctxChip'), '::after').backgroundColor !== 'rgb(127, 214, 194)'"), 'the cold dot is no longer sea-glass');

    // Starting fresh below the crowded mark pays nothing; past it, the fresh-start XP.
    const freshXp = "shellby.getXp().then(x => x.log.filter(e => e.kind === 'fresh').length)";
    await type('big 170000');
    check(await poll(panel, "SB.activeTab().context?.pct === 85 && !SB.activeTab().busy && !SB.$('crowded').hidden"), 'crowded at 85%');
    await panel.ev("[...SB.$('crowded').querySelectorAll('button')].find(b => b.textContent.includes('Start fresh')).click()");
    check(await poll(panel, "!SB.activeTab().busy && [...SB.activeTab().el.querySelectorAll('.msg')].some(m => m.textContent.includes('started this conversation fresh'))", 15000), 'it starts fresh with the summary');
    check(await poll(panel, `${freshXp}.then(n => n === 1)`), 'starting a crowded conversation fresh pays the fresh-start XP');
    panel.close();
  } catch (e) {
    check(false, e.message);
  } finally {
    run.app.kill();
  }

  // ---- 2. the Lean tab, against the real CLI, read-only
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-'));
  // Dev runs read memory and settings from a pretend home in the profile: one
  // file for every conversation, one rule that loads only for TypeScript, and
  // Claude Code's settings naming an output style.
  const home = path.join(real, 'claude-home', '.claude');
  fs.mkdirSync(path.join(home, 'rules'), { recursive: true });
  fs.writeFileSync(path.join(home, 'CLAUDE.md'), `# Me\n\n${'Prefer small, focused commits. '.repeat(80)}\n`);
  fs.writeFileSync(path.join(home, 'rules', 'ts.md'), `---\npaths:\n  - "**/*.ts"\n---\n# TypeScript\n\n${'Type the public API. '.repeat(40)}\n`);
  const homeSettings = path.join(home, 'settings.json');
  fs.writeFileSync(homeSettings, JSON.stringify({ outputStyle: 'Explanatory' }, null, 2));
  run = await launch(9392, { SHELLBY_USER_DATA: real, SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47989' });
  try {
    const panel = await cdp((await run.target('panel.html')).webSocketDebuggerUrl);
    await poll(panel, '!!window.SB && !!SB.state.version', 20000);
    await panel.ev(`(async () => { await shellby.setSettings({ onboarded: true, crabOnly: false }); SB.state.settings.onboarded = true; await shellby.claudeStatus(); })()`);
    await panel.ev("SB.showToolbox('lean')");
    check(await panel.ev("SB.$('toolList').textContent.includes('Asking Claude Code') || !!SB.state.lean"), 'the Lean tab says it is asking Claude Code');
    check(await poll(panel, '!!SB.state.lean', 120000), 'the report arrives');
    const info = await panel.ev(`({
      head: document.querySelector('.lean-head')?.textContent || '',
      cache: document.querySelector('.lean-cache')?.textContent || '',
      rows: document.querySelectorAll('#toolList .tool-row').length,
      idle: document.querySelectorAll('#toolList .idle-pill').length,
      labels: [...document.querySelectorAll('#toolList .lean-label')].map(l => l.textContent),
      count: document.querySelector('#toolGroups [data-group="lean"] .n').textContent,
      ask: !!document.querySelector('#setupPane .lean-ask button'),
    })`);
    console.log('lean:', JSON.stringify(info));
    check(info.rows > 0 && info.labels.includes('Plugins'), 'plugins are listed');
    check(info.labels.includes('CLAUDE.md and rules, every conversation'), 'CLAUDE.md is listed as carried by every conversation');
    check(info.labels.some(l => l.startsWith('Rules for matching files only')), 'a rule with paths: is listed apart, not counted as always carried');
    check(await panel.ev("SB.state.lean.totals.memory > 0 && SB.state.lean.totals.memoryOnDemand > 0"), 'both are sized');
    check(String(info.idle) === info.count || (info.idle === 0 && info.count === ''), 'the tab count is the idle count');
    check(info.ask, 'there is a button to ask Claude for leaner ways to keep the same features');
    await panel.shot(path.join(real, 'lean-tab.png'));

    // The bar (lean-bar.js; main's fixedcost.js): the header with the total, a row per part in the bar's order,
    // a segment per sized part, the one-liner, the cut on the style's row, and the cards beside them.
    const fixed = await panel.ev(`({
      sum: document.querySelector('#setupPane .lean-fc-sum')?.textContent || '',
      rows: [...document.querySelectorAll('#setupPane .lean-part')].map(r => r.dataset.part),
      parts: SB.state.lean.fixed.parts.map(p => p.key),
      segs: document.querySelectorAll('#setupPane .lean-fc-bar i').length,
      sized: SB.state.lean.fixed.parts.filter(p => p.tokens).length,
      keys: document.querySelectorAll('#setupPane .lean-fc-legend .lean-key').length,
      line: SB.state.lean.fixed.line,
      style: SB.state.lean.fixed.items.find(i => i.kind === 'style')?.label || '',
      styleRow: document.querySelector('#setupPane .lean-part[data-part="style"] .lean-part-name')?.textContent || '',
      memory: SB.state.lean.fixed.items.filter(i => i.kind === 'memory').length,
      rule: SB.state.lean.fixed.items.some(i => i.kind === 'rule'),
      cut: document.querySelector('#setupPane .lean-cut[data-id="style-off"] button')?.textContent || '',
      cuts: SB.state.lean.fixed.suggestions.length,
      take: document.querySelector('#setupPane .lean-take')?.textContent || '',
      now: SB.compact(Math.round(SB.state.lean.fixed.total)),
      after: SB.compact(Math.round(SB.state.lean.fixed.total - SB.state.lean.fixed.suggestions.reduce((n, s) => n + s.saves, 0))),
      cache: document.querySelector('#setupPane .lean-cache-card')?.textContent || '',
    })`);
    console.log('fixed:', JSON.stringify(fixed));
    check(/^\S+ tokens on every call · \d+% of a 200k window/.test(fixed.sum), `the bar's header gives the total and its share of the window (${fixed.sum.slice(0, 60)})`);
    check(fixed.rows.length > 0 && fixed.rows.join() === fixed.parts.join(), `a row per part, in the bar's order (${fixed.rows.join(', ')})`);
    check(fixed.segs === fixed.sized && fixed.keys === fixed.parts.length, 'a bar segment for each sized part, and every part in the legend');
    check(/^setup ~\S+\/turn$/.test(fixed.line), 'the one-line summary the turn footer shows');
    check(fixed.style === 'Output style "Explanatory"' && fixed.styleRow.startsWith('Output style: Explanatory') && fixed.memory >= 1 && !fixed.rule, 'the output style and CLAUDE.md have rows; a rule for matching files only does not');
    check(fixed.cut === 'Turn off', 'the style\'s row offers to turn it off');
    check(fixed.cuts > 0 && /^If you take (this one|all \w+)/.test(fixed.take) && fixed.take.includes(fixed.now) && fixed.take.includes(fixed.after), `the card adds the cuts up: ${fixed.now} now, ${fixed.after} after`);
    check(fixed.cache.startsWith('What the cache does') && /This week/.test(fixed.cache), 'the cache card says what the cache does and this week\'s rate');
    // The whole tab at a 4K full screen and at the panel's own width: for a look, not a check.
    const metrics = (width, height) => panel.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await metrics(2560, 1440);
    await wait(600);
    check(await panel.ev("getComputedStyle(document.querySelector('#setupPane .lean-fc')).gridTemplateColumns.split(' ').length === 2"), 'wide, the cards sit beside the rows');
    await panel.shot(path.join(real, 'lean-wide.png'));
    await metrics(460, 700);
    await wait(600);
    check(await panel.ev("getComputedStyle(document.querySelector('#setupPane .lean-fc')).gridTemplateColumns.split(' ').length === 1 && document.querySelector('#setupPane .lean-fc').scrollWidth <= document.querySelector('#setupPane').clientWidth + 1"), 'narrow, one column, nothing cut off');
    await panel.shot(path.join(real, 'lean-narrow.png'));
    await panel.send('Emulation.clearDeviceMetricsOverride');
    await wait(300);
    // Turn off -> the confirm window, focused on Cancel; cancel it, and the settings file is untouched.
    await panel.ev(`document.querySelector('#setupPane .lean-cut[data-id="style-off"] button').click()`);
    const styleAsk = await answerDialog(run.port, { press: 'Cancel', shot: path.join(real, 'lean-style-confirm.png') });
    console.log('style confirm:', JSON.stringify(styleAsk && { title: styleAsk.title, focused: styleAsk.focused }));
    check(styleAsk?.title === 'Switch off the "Explanatory" output style?' && /settings\.json/.test(styleAsk.message), 'the confirm window names the style and the file it is set in');
    check(styleAsk?.focused === 'Cancel', 'Cancel is the default');
    check(JSON.parse(fs.readFileSync(homeSettings, 'utf8')).outputStyle === 'Explanatory', 'the settings file still names the style after Cancel');
    check(await poll(panel, `!!document.querySelector('#setupPane .lean-cut[data-id="style-off"] button:not([disabled])')`), 'the cut is still on offer');
    // Take all: each switch asks in turn (Cancel moves on to the next), then the advice opens as one draft, unsent.
    const plan = await panel.ev("({ acts: SB.state.lean.fixed.suggestions.filter(s => s.action).length, drafts: SB.state.lean.fixed.suggestions.filter(s => !s.action).length, tabs: SB.state.tabs.size })");
    await panel.ev("document.querySelector('#setupPane .lean-take-btn').click()");
    let asked = 0;
    for (let i = 0; i < plan.acts; i++) {
      if (!(await answerDialog(run.port, { press: 'Cancel', ms: 15000 }))) break;
      asked++;
    }
    check(asked === plan.acts, `Take all asked ${asked} of ${plan.acts} times, each cancelled`);
    check(JSON.parse(fs.readFileSync(homeSettings, 'utf8')).outputStyle === 'Explanatory', 'the settings file is still as it was');
    if (plan.drafts) check(await poll(panel, `SB.state.tabs.size === ${plan.tabs + 1} && SB.state.view === 'chat' && SB.$('input').value.includes('edit nothing until I say so')`), `the ${plan.drafts} piece${plan.drafts === 1 ? '' : 's'} of advice opened as one draft in a new tab, unsent`);
    else check(await panel.ev(`SB.state.tabs.size === ${plan.tabs}`), 'no advice, so no draft tab');
    await panel.ev("SB.showToolbox('lean')");
    check(await poll(panel, "!!document.querySelector('#setupPane .lean-take-btn:not([disabled])')"), 'Take all is ready again');

    // Turn off -> the confirm window, focused on Cancel; cancel it.
    const pick = await panel.ev(`(() => {
      // A plugin's row (its first action is Turn off), an idle one if there is: idle skills offer Remove instead.
      const plugins = [...document.querySelectorAll('#toolList .tool-row')].filter(r => r.querySelector('.tool-actions button')?.textContent === 'Turn off');
      const row = plugins.find(r => r.classList.contains('is-idle')) || plugins[0];
      if (!row) return null;
      row.querySelector('.tool-actions button').click();
      return row.querySelector('code').textContent;
    })()`);
    if (!pick) check(false, 'no plugin to try turning off');
    else {
      // Read and photographed, then Cancel (lib/dialog.js).
      const d = await answerDialog(run.port, { press: 'Cancel', shot: path.join(real, 'lean-confirm.png') });
      console.log('confirm:', JSON.stringify(d && { title: d.title, message: d.message, focused: d.focused }));
      check(d?.title === `Turn off "${pick}"?` && /stays installed/.test(d.message), 'the confirm window says it stays installed');
      check(d?.focused === 'Cancel', 'Cancel is the default');
      check(await poll(panel, `!SB.state.lean.off.some(p => p.name === ${JSON.stringify(pick)}) && SB.state.lean.plugins.some(p => p.name === ${JSON.stringify(pick)})`), `${pick} is still on after Cancel`);
    }
    panel.close();
  } catch (e) {
    check(false, e.message);
  } finally {
    run.app.kill();
  }
  console.log(fails ? `${fails} FAILED` : `all passed (screenshots in ${fake} and ${real})`);
  process.exit(fails ? 1 : 0);
})();
