// End-to-end check of the Time page against the dev app over CDP (throwaway
// profile). Seeds tracked time for this repository, then checks the page: the
// month's total, the calendar and the picked day, its commits from git,
// rounding and rate, adding time to a day, stepping months, the wide layout,
// the switch with History, and that a timesheet PDF really renders (in the
// main process, through the same hidden window).
//   node scripts/e2e-time.js [screenshot.png]
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { panelBooted } = require('./lib/boot');
const { savePng } = require('./lib/shot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9351;
const INSPECT = 9352;
const wait = ms => new Promise(r => setTimeout(r, ms));
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function cdp(url) {
  const ws = new WebSocket(url);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  return { ws, send, ev };
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-'));
  // The project's key as Shellby works it out (gitinfo.projectOf): a git worktree is its main checkout.
  const key = (() => {
    try {
      const common = path.resolve(ROOT, execFileSync('git', ['-C', ROOT, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim());
      return (path.basename(common).toLowerCase() === '.git' ? path.dirname(common) : ROOT).toLowerCase();
    } catch { return ROOT.toLowerCase(); }
  })();
  const today = dayKey(Date.now());
  // Another day this month, unless today is the 1st.
  const other = new Date().getDate() > 1 ? dayKey(Date.now() - 24 * 60 * 60 * 1000) : null;
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    onboarded: false, crabOnly: true,
    streaks: { days: [], projects: { [key]: { name: 'shellby', lastSeen: Date.now() } } },
    timeTracking: {
      enabled: true, roundMinutes: 15, currency: 'USD',
      projects: { [key]: { name: 'shellby', client: 'Harbor Tree', rate: 100 } },
      days: { [today]: { [key]: 80 * 60 }, ...(other ? { [other]: { [key]: 2 * 3600 + 7 * 60 } } : {}) },
      notes: other ? { [other]: { [key]: 'Time tracker design' } } : {},
    },
  }));
  // A conversation in this repository today, for Shellby to write the day up from (timetrack/daywrite.js).
  const asked = Math.max(new Date().setHours(0, 1, 0, 0), Date.now() - 2 * 3600 * 1000);
  const sessions = path.join(profile, 'sessions');
  fs.mkdirSync(sessions);
  fs.writeFileSync(path.join(sessions, 'index.json'), JSON.stringify([{ id: 'e2e-day', title: 'Merge queue badge', cwd: ROOT, mode: 'default', claudeSessionId: null, createdAt: asked, updatedAt: asked + 60000 }]));
  fs.writeFileSync(path.join(sessions, 'e2e-day.jsonl'), `${JSON.stringify({ t: asked, kind: 'user', text: 'Add a badge to the merge queue tab' })}\n${JSON.stringify({ t: asked + 30000, kind: 'text', text: 'Done.' })}\n`);
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [`--inspect=${INSPECT}`, ROOT, `--remote-debugging-port=${PORT}`],
    // The fake CLI writes the day up, as it answers every other draft in e2e.
    { stdio: 'ignore', env: { ...process.env, SHELLBY_USER_DATA: profile, SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js') } });
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  try {
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    const { send, ev } = await cdp(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    await panelBooted(ev);
    await ev("SB.setView('time')");
    const ready = async () => { for (let i = 0; i < 40; i++) { if (await ev("document.querySelectorAll('#timeCal .tm-day[data-day]').length && document.querySelectorAll('#timeProjects .tm-project').length")) return true; await wait(250); } return false; };
    check(await ready(), 'the Time page shows the month and lists a project');

    const stat = () => ev("document.querySelector('#timeStats .tm-stat dd').textContent");
    check(await stat() === (other ? '3h 27m' : '1h 20m'), `the month's total (${await stat()})`);
    const cells = await ev("[...document.querySelectorAll('#timeCal .tm-day[data-day]')].map(b => b.dataset.day)");
    const monthDays = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    check(cells.length === monthDays, `a day for each day of the month (${cells.length} of ${monthDays})`);
    check(await ev(`document.querySelector('#timeCal [data-day="${today}"] .tm-d-t').textContent`) === '1:20', "today's day says its hours");
    check(await ev(`document.querySelector('#timeCal [data-day="${today}"]').getAttribute('aria-pressed')`) === 'true', 'today is picked to start with');
    check(await ev("document.querySelectorAll('#timeDay .tm-line').length") === 1, 'the picked day lists its one project');
    check(await ev("document.querySelector('#timeDay .tm-line-time').textContent") === '1:20', "the line shows today's time");
    const amount = await ev("[...document.querySelectorAll('#timeStats .tm-stat')].map(s => s.textContent).join(' ')");
    // 80 min -> 1:15, 127 min -> 2:00 at 15-minute rounding, x $100
    check((other ? /\$325\.00/ : /\$125\.00/).test(amount), `rounded and billed (${amount})`);

    if (other) {
      await ev(`document.querySelector('#timeCal [data-day="${other}"]').click()`);
      await wait(150);
      check(await ev("document.querySelector('#timeDay .tm-note').value") === 'Time tracker design', 'the picked day shows its line for the timesheet');
      // Arrow keys walk the days.
      await ev(`document.querySelector('#timeCal [data-day="${other}"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
      await wait(150);
      check(await ev("document.activeElement?.dataset?.day") === today, 'the right arrow moves to the next day');
    }
    // Some day this month has this repository's commits on it, when you made any here this month.
    const since = `${today.slice(0, 8)}01`;
    const mine = (() => { try { const me = execFileSync('git', ['-C', ROOT, 'config', '--get', 'user.email'], { encoding: 'utf8' }).trim(); return execFileSync('git', ['-C', ROOT, 'log', '--branches', '--no-merges', '-1', `--since=${since}`, `--author=${me}`, '--format=%H'], { encoding: 'utf8' }).trim(); } catch { return ''; } })();
    const commits = !mine ? 'none this month' : await ev(`(() => {
      for (const b of document.querySelectorAll('#timeCal .tm-day[data-day]:not(:disabled)')) { b.click(); if (document.querySelector('#timeDay .tm-commits')) return b.dataset.day; }
      return null;
    })()`);
    check(!!commits, `git commits show on their day (${commits})`);
    await ev(`document.querySelector('#timeCal [data-day="${today}"]').click()`);

    // Shellby writes the day up: a dashed draft, never on the timesheet until kept.
    const until = async (expr, tries = 60) => { for (let i = 0; i < tries; i++) { if (await ev(expr)) return true; await wait(250); } return false; };
    check(await until("!!document.querySelector('#timeDay [data-focus=\"write-day\"]')"), 'a day with no words of yours offers to write it up');
    await ev("document.querySelector('#timeDay [data-focus=\"write-day\"]').click()");
    check(await until("!!document.querySelector('#timeDay .tm-line.drafted .tm-draft-text')"), 'the write-up comes back as a draft on the line');
    check(await ev("document.querySelector('#timeDay .tm-draft-text').textContent") === 'Worked on shellby.', `the draft says what was written (${await ev("document.querySelector('#timeDay .tm-draft-text')?.textContent")})`);
    await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
    await wait(400);
    await savePng(send, (process.argv[2] || path.join(os.tmpdir(), 'shellby-time.png')).replace(/\.png$/, '-draft-wide.png'));
    await send('Emulation.clearDeviceMetricsOverride');
    await wait(300);
    const row = await ev(`shellby.getTime({ range: 'custom', from: '${today}', to: '${today}' }).then(v => v.summary.projects[0].days[0])`);
    check(row?.note === '' && row?.draft?.text === 'Worked on shellby.', 'a draft is not the line on the timesheet until you keep it');

    // How it was written: the day's line, the sentence, and what it came from.
    await ev("document.querySelector('#timeDay [data-focus=\"how\"]').click()");
    check(await until("!document.getElementById('timeDetail').hidden && !!document.querySelector('#timeDetail .td-sentence')"), '"How it was written" opens the day');
    check(await ev("getComputedStyle(document.querySelector('.tm-month')).display") === 'none', 'the month steps aside for it');
    check(await ev("document.querySelector('#timeDetail .td-sentence').getAttribute('aria-pressed')") === 'true', 'its first sentence is picked');
    check(await ev("document.querySelectorAll('#timeDetail .td-lane > .lit').length") >= 1, 'what the sentence came from is lit on the line');
    check(await ev("document.querySelectorAll('#timeDetail .td-evidence li').length") >= 1, 'and listed beside it');
    check(await ev("[...document.querySelectorAll('#timeDetail .td-chat')].some(c => c.textContent === 'Merge queue badge')"), "the day's conversation sits on Claude's lane");
    const shotOut = process.argv[2] || path.join(os.tmpdir(), 'shellby-time.png');
    await savePng(send, shotOut.replace(/\.png$/, '-written.png'));
    await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
    await wait(400);
    check(await ev("getComputedStyle(document.querySelector('.td-lower')).gridTemplateColumns.split(' ').length") === 2, 'a wide panel puts the evidence beside the write-up');
    await savePng(send, shotOut.replace(/\.png$/, '-written-wide.png'));
    await send('Emulation.clearDeviceMetricsOverride');
    await wait(300);
    await ev("document.querySelector('#timeDetail [data-focus=\"td-back\"]').click()");
    check(await until("document.getElementById('timeDetail').hidden && getComputedStyle(document.querySelector('.tm-month')).display !== 'none'"), 'back to the month');

    // Keep it: the draft becomes the line on the timesheet.
    await ev("document.querySelector('#timeDay [data-focus^=\"keep-draft:\"]').click()");
    check(await until("document.querySelector('#timeDay .tm-note')?.value === 'Worked on shellby.'"), 'keeping the draft makes it the line');
    check(/written by Claude, kept/.test(await ev("document.querySelector('#timeDay .tm-line-meta').textContent")), 'and says Shellby wrote it');
    check(await ev("!document.querySelector('#timeDay [data-focus=\"write-day\"]')"), 'with every line written, there is nothing left to write up');
    // Back to an empty line, so the rest of the run starts where it did.
    await ev(`shellby.addTime({ key: ${JSON.stringify(key)}, day: '${today}', minutes: 0, note: '' })`);
    await ev(`shellby.dropTimeDraft('${today}', ${JSON.stringify(key)})`);

    await ev("document.getElementById('timeRound').value = '30|up'; document.getElementById('timeRound').dispatchEvent(new Event('change'))");
    await wait(800);
    const up = await ev("[...document.querySelectorAll('#timeStats .tm-stat')].map(s => s.textContent).join(' ')");
    check((other ? /\$400\.00/ : /\$150\.00/).test(up), `rounding up to 30 minutes changes the bill (${up})`);

    // Add 45 minutes to today from the day's own form, then 15 more with its +.
    await ev(`(() => {
      const form = document.querySelector('#timeDay .tm-adder');
      const [project, minutes] = form.querySelectorAll('select');
      project.value = ${JSON.stringify(key)};
      minutes.value = '45';
      form.querySelector('.tm-add-note').value = 'Client call';
      form.requestSubmit();
    })()`);
    await wait(900);
    check(await stat() === (other ? '4h 12m' : '2h 05m'), `time added to the day counts (${await stat()})`);
    check(await ev("document.querySelector('#timeDay .tm-line-time').textContent") === '2:05', 'the day shows the added time');
    await ev("document.querySelector('#timeDay .tm-nudge .icon-btn:last-child').click()");
    await wait(900);
    check(await ev("document.querySelector('#timeDay .tm-line-time').textContent") === '2:20', 'the + adds 15 minutes');
    const bad = await ev("shellby.addTime({ key: 'c:\\\\not\\\\a\\\\project', day: '2026-01-01', minutes: 30 }).then(r => r.ok)");
    check(bad === false, 'time for an unknown project is refused');
    const future = await ev(`shellby.addTime({ key: ${JSON.stringify(key)}, day: '2999-01-01', minutes: 30 }).then(r => r.ok)`);
    check(future === false, 'time in the future is refused');

    // Back a month and home again.
    const label = await ev("document.getElementById('timeMonth').textContent");
    check(await ev("document.getElementById('timeNext').disabled"), "there's no month after this one");
    await ev("document.getElementById('timePrev').click()");
    await wait(900);
    check(await ev("document.getElementById('timeMonth').textContent") !== label && !await ev("document.getElementById('timeThisMonth').hidden"), 'the previous month opens, with the way back');
    await ev("document.getElementById('timeThisMonth').click()");
    await wait(900);
    check(await ev("document.getElementById('timeMonth').textContent") === label, 'back to this month');

    const out = process.argv[2] || path.join(os.tmpdir(), 'shellby-time.png');
    await savePng(send, out);
    // Full screen on a big monitor: the day beside the calendar.
    await send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
    await wait(400);
    check(await ev("getComputedStyle(document.querySelector('.tm-month')).gridTemplateColumns.split(' ').length") === 2, 'a wide panel puts the day beside the calendar');
    await savePng(send, out.replace(/\.png$/, '-wide.png'));
    await send('Emulation.clearDeviceMetricsOverride');
    await wait(300);

    await ev("document.querySelector('#timeView [data-goto-view=\"history\"]').click()");
    await wait(300);
    check(await ev("document.body.dataset.view") === 'history', 'Conversations goes to History');
    check(await ev("document.querySelector('[data-view-btn=\"history\"].dock-btn').getAttribute('aria-current')") === 'page', 'the History dock button stays lit on both');

    // The timesheet PDF, rendered by the main process exactly as Save PDF does.
    const targets = await (await fetch(`http://127.0.0.1:${INSPECT}/json/list`)).json();
    const main = await cdp(targets[0].webSocketDebuggerUrl);
    const pdfPath = path.join(profile, 'timesheet.pdf');
    const r = await main.ev(`(async () => { try {
      const req = process.mainModule.require;
      const { BrowserWindow, app } = req('electron');
      const { TimeTracker } = req(${JSON.stringify(path.join(ROOT, 'src', 'main', 'timetrack/service.js'))});
      const { timesheetHtml } = req(${JSON.stringify(path.join(ROOT, 'src', 'main', 'timetrack', 'timesheet.js'))});
      const tt = req(${JSON.stringify(path.join(ROOT, 'src', 'main', 'timetrack', 'index.js'))});
      const state = tt.normalize(JSON.parse(req('fs').readFileSync(${JSON.stringify(path.join(profile, 'settings.json'))}, 'utf8')).timeTracking);
      const week = tt.ranges(Date.now()).find(x => x.id === 'week');
      const html = timesheetHtml(tt.summarize(state, week), { label: 'This week', preparedBy: 'E2E' });
      const t = new TimeTracker({ config: { get: () => null }, electron: { BrowserWindow, app } });
      const pdf = await t.renderPdf(html);
      req('fs').writeFileSync(${JSON.stringify(pdfPath)}, pdf);
      return pdf.length;
    } catch (e) { return 'error: ' + (e && e.stack || e); } })()`);
    const head = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath).subarray(0, 5).toString() : '';
    check(head === '%PDF-' && r > 1000, `the timesheet renders to a PDF (${r} bytes)`);
    main.ws.close();
  } catch (e) {
    check(false, e.stack || e.message);
  } finally {
    app.kill();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exitCode = fails ? 1 : 0;
})();
