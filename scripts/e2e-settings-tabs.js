// ci: Settings' rail of nine areas: what's in each, the keys, the peek, the wide rail, search counts, jumps by name
// End-to-end check of the Settings rail against the dev app over CDP: each area
// shows only its own sections, the arrow keys walk the rail, resting on an icon
// peeks at an area's sections, a wide panel lists the sections of the area
// you're in, a search counts what each area found, jumps by name (the tray, the
// palette) land in the right area, and just-the-crab starts on Look.
//   node scripts/e2e-settings-tabs.js [screenshotDir]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9351;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-settings-tabs-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// A panel this wide gets the labelled rail (nav.css: @container settings, 720px).
const WIDE = { width: 1280, height: 800 };

function newProfile(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ onboarded: true, notifications: false, ...extra }));
  return dir;
}

async function launch(profile) {
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`],
    { stdio: 'ignore', env: { ...process.env, SHELLBY_USER_DATA: profile } });
  let list = [];
  for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
    await wait(500);
  }
  const ws = new WebSocket(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
  // A call that never answers fails by name instead of running into e2e-ci's five-minute limit.
  const send = (method, params = {}, ms = 30000) => new Promise((r, reject) => {
    const i = ++id;
    const t = setTimeout(() => { pending.delete(i); reject(new Error(`${method} got no answer in ${ms / 1000}s`)); }, ms);
    pending.set(i, m => { clearTimeout(t); pending.delete(i); r(m.result); });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
  // Booted (boot.js marks it), not a fixed wait: under a full e2e run the panel's
  // scripts can take longer than any guess to load.
  for (let t = 0; t < 30000 && !(await ev("performance.getEntriesByName('shellby:panel-ready').length > 0")); t += 150) await wait(150);
  return { app, send, ev };
}

// What each area holds, from the panel's own pieces: the areas in settings.html's
// order, and each one's sections (their data-nav, as the jumps and Ctrl+K use
// them) in settings-<area>.html's order. The checks are that the app shows just those.
const HTML = path.join(ROOT, 'src', 'renderer', 'panel', 'html');
const read = f => fs.readFileSync(path.join(HTML, f), 'utf8');
const AREAS = Object.fromEntries([...read('settings.html').matchAll(/role="tab" id="setTab-([a-z]+)"/g)].map(([, area]) =>
  [area, [...read(`settings-${area}.html`).matchAll(/<[a-z]+ class="setting-group\b[^>]*\bdata-nav="([^"]+)"/g)].map(m => m[1])]));
const FIRST = Object.keys(AREAS)[0];
const LAST = Object.keys(AREAS).at(-1);

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  // Screenshots are for a person to look at, not something checked, so one that
  // doesn't come (a hidden or unpainted window on a CI runner) is noted and skipped.
  const shot = async (panel, name) => {
    try {
      const s = await panel.send('Page.captureScreenshot', { format: 'png' }, 10000);
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.data, 'base64'));
    } catch (e) {
      console.log(`(no screenshot for ${name}: ${e.message})`);
    }
  };
  const selected = panel => panel.ev("document.querySelector('#settingsRail [aria-selected=\"true\"]')?.dataset.tab");
  const shown = panel => panel.ev(`[...document.querySelectorAll('#settingsView .setting-group[data-nav]')]
    .filter(g => g.offsetParent !== null).map(g => g.dataset.nav)`);
  // Waits for a condition in the panel rather than a fixed time: a window kept
  // off-screen for e2e gets few frames.
  const until = async (panel, expr, ms = 6000) => {
    for (let t = 0; t < ms; t += 100) { if (await panel.ev(expr)) return true; await wait(100); }
    return false;
  };
  const center = (panel, sel) => panel.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const hover = async (panel, sel) => {
    const p = await center(panel, sel);
    await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  };

  // ---- with Claude
  let run = await launch(newProfile({ crabOnly: false }));
  try {
    const panel = run;
    await panel.ev("SB.setView('settings')");
    await wait(500);
    check(await selected(panel) === 'claude', 'Settings opens on Claude');
    check(await panel.ev("document.querySelectorAll('#modelSelect optgroup').length >= 2 && document.getElementById('modelSelect').offsetParent !== null"),
      'the model picker in Claude lists the models by family');

    for (const [area, navs] of Object.entries(AREAS)) {
      await panel.ev(`document.getElementById('setTab-${area}').click()`);
      await wait(300);
      const got = await shown(panel);
      check(JSON.stringify(got) === JSON.stringify(navs), `${area} shows ${navs.join(', ')} (got ${JSON.stringify(got)})`);
      await shot(panel, `area-${area}`);
    }
    check(await panel.ev("[...document.querySelectorAll('#settingsRail [role=tab] .rail-ico svg')].length") === Object.keys(AREAS).length, 'every area on the rail has its icon');
    // the extras start folded to one line that says whether each is on
    await panel.ev("document.getElementById('setTab-look').click()");
    await wait(200);
    check(await panel.ev("[...document.querySelectorAll('#settingsView .setting-fold')].every(f => !f.open)"), 'the extras start folded');
    check(await panel.ev("document.querySelector('#musicGroup .fold-state').textContent") === 'Off', 'a folded extra says Off');
    await panel.ev("document.getElementById('npEnabled').click()");
    await wait(600);
    check(await panel.ev("document.querySelector('#musicGroup .fold-state').textContent") === 'On', 'and On once it is turned on');
    await panel.ev("document.getElementById('npEnabled').click()");
    await wait(300);
    const all = Object.values(AREAS).flat();
    const every = await panel.ev("[...document.querySelectorAll('#settingsView .setting-group[data-nav]')].map(g => g.dataset.nav)");
    check(new Set(all).size === all.length && every.length === all.length && all.every(n => every.includes(n)),
      `every section lives in exactly one area (${all.length} in ${Object.keys(AREAS).length} areas; the page has ${every.length})`);

    // keyboard: from the last area, Down wraps to the first, End goes to the last
    await panel.ev(`document.getElementById('setTab-${LAST}').click(); document.getElementById('setTab-${LAST}').focus()`);
    await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await wait(200);
    check(await selected(panel) === FIRST, 'ArrowDown wraps from the last area to the first');
    check(await panel.ev("document.activeElement.id") === `setTab-${FIRST}`, 'and focus moves with it');
    await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End', windowsVirtualKeyCode: 35 });
    await wait(200);
    check(await selected(panel) === LAST, 'End goes to the last area');

    // leaving and coming back keeps the area
    await panel.ev("SB.setView('health'); SB.setView('settings')");
    await wait(300);
    check(await selected(panel) === LAST, 'Settings reopens on the last area you looked at');

    // the marker sits behind the chosen area, and every area's name fits
    check(await panel.ev(`(() => {
      const rail = document.getElementById('settingsRail');
      const b = rail.querySelector('[aria-selected="true"]');
      const near = (v, want) => Math.abs(parseFloat(rail.style.getPropertyValue(v)) - want) < 1;
      return rail.classList.contains('has-mark') && near('--mark-y', b.offsetTop) && near('--mark-h', b.offsetHeight);
    })()`), 'the marker sits behind the chosen area');
    check(await panel.ev("[...document.querySelectorAll('#settingsRail .rail-name')].every(n => n.scrollWidth <= n.clientWidth + 1)"), 'every area name fits without clipping');

    // the narrow rail: resting on an icon peeks at that area's sections, and one opens there
    // (a trophy card from the first visits would sit over it)
    await panel.ev("document.querySelectorAll('.cel-close').forEach(b => b.click())");
    await hover(panel, '#setTab-accounts');
    check(await until(panel, "!document.getElementById('settingsPeek').hidden"), 'resting on Accounts opens a peek');
    const peekList = await panel.ev("[...document.querySelectorAll('#settingsPeek .peek-list button')].map(b => b.textContent)");
    check(peekList.includes('GitHub') && peekList.includes('Other computers'), `the peek lists Accounts' sections (${peekList.join(', ')})`);
    await shot(panel, 'peek-accounts');
    await panel.ev("[...document.querySelectorAll('#settingsPeek .peek-list button')].find(b => b.textContent === 'Other computers').click()");
    check(await until(panel, "document.querySelector('#settingsRail [aria-selected=\"true\"]')?.dataset.tab === 'accounts' && document.getElementById('settingsPeek').hidden"),
      'picking a section in the peek opens its area and closes the peek');
    await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 300 });

    // a jump by name (the tray's update item) switches area and scrolls there
    await panel.ev("document.getElementById('setTab-look').click(); SB.setView('chat'); SB.jumpToSettingByName('GitHub')");
    // With motion on, the jump scrolls smoothly on the next frame, and a window
    // kept off-screen for e2e gets few frames: it took 2.7 s to land once, past a
    // fixed wait. So wait for it to arrive at the top (block: 'start'), up to 8 s.
    const githubAt = () => panel.ev(`(() => {
      const r = document.getElementById('githubGroup').getBoundingClientRect();
      const v = document.getElementById('settingsMain').getBoundingClientRect();
      return { group: Math.round(r.top), view: [Math.round(v.top), Math.round(v.bottom)] };
    })()`);
    const atTop = g => g.group >= g.view[0] - 1 && g.group < g.view[0] + (g.view[1] - g.view[0]) / 3;
    let github = await githubAt();
    for (let i = 0; i < 40 && !atTop(github); i++) { await wait(200); github = await githubAt(); }
    check(await selected(panel) === 'accounts', 'jumping to GitHub opens Accounts');
    check(atTop(github), `and GitHub scrolls to the top of the column (its top at ${github.group}, the column ${github.view.join('–')})`);

    // the palette still finds every section, wherever it lives
    const pal = await panel.ev("(SB.openPalette(), [...document.querySelectorAll('#paletteList .pal-title')].map(e => e.textContent))");
    check(all.every(n => pal.includes(`Settings › ${n}`)), 'Ctrl+K lists every section, not just the open area');
    await panel.ev("const i = document.getElementById('paletteInput'); i.value = 'desk lighting'; i.dispatchEvent(new Event('input'))");
    await wait(100);
    await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await wait(1000);
    check(await selected(panel) === 'apps', 'picking Desk lighting in the palette opens Apps');
    check(await panel.ev("document.getElementById('rgbGroup').open"), 'and unfolds Desk lighting');
    await shot(panel, 'jump-desk-lighting');

    // searching counts what each area found on the rail, and dims the rest
    await panel.ev("{ const s = document.getElementById('settingsSearch'); s.value = 'github'; s.dispatchEvent(new Event('input')); }");
    await wait(300);
    const counts = await panel.ev(`Object.fromEntries([...document.querySelectorAll('#settingsRail [role=tab]')].map(b => [b.dataset.tab, b.classList.contains('dim') ? 0 : Number(b.querySelector('.rail-count').textContent || 0)]))`);
    check(counts.accounts > 0 && Object.values(counts).some(n => n === 0), `a search counts its matches on the rail and dims the areas with none (${JSON.stringify(counts)})`);
    await shot(panel, 'search-github');
    await panel.ev("{ const s = document.getElementById('settingsSearch'); s.value = ''; s.dispatchEvent(new Event('input')); }");
    const left = "[...document.querySelectorAll('#settingsRail [role=tab]')].filter(b => !b.querySelector('.rail-count').hidden || b.classList.contains('dim') || b.classList.contains('match')).map(b => b.dataset.tab)";
    const cleared = await until(panel, `${left}.length === 0`);
    check(cleared, `clearing the search clears the rail${cleared ? '' : ` (still marked: ${(await panel.ev(left)).join(', ')})`}`);

    // a setting that talks about one elsewhere links straight to it
    check(await panel.ev("[...document.querySelectorAll('#settingsView [data-jump-setting]')].every(a => document.getElementById(a.dataset.jumpSetting))"),
      'every link between settings points at one that exists');
    await panel.ev("document.getElementById('setTab-system').click(); document.querySelector('#notifyGroup [data-jump-setting]').click()");
    // It focuses the setting on the next frame, which a busy desktop can hold back past a fixed wait.
    let landed = false;
    for (let i = 0; i < 30 && !landed; i++) {
      await wait(100);
      landed = await selected(panel) === 'alerts' && await panel.ev('document.activeElement.id') === 'chEnabled';
    }
    check(landed, "Notifications' phone link focuses Tell me when I'm away in Alerts");

    // the autonomous-mode warning lives in Claude
    await panel.ev("document.getElementById('setTab-system').click(); SB.chooseMode('autonomous')");
    await wait(600);
    check(await selected(panel) === 'claude' && await panel.ev("document.getElementById('autonomousConfirm').offsetParent !== null"),
      'asking for Autonomous shows its warning in Claude');
    await panel.ev("document.getElementById('autonomousNo').click()");

    // update news reaches System too
    await panel.ev("SB.state.updates = { state: 'ready', version: '99.0.0' }; SB.views.settings.render()");
    await wait(200);
    check(await panel.ev("!document.getElementById('updateTabDot').hidden"), 'a ready update puts a dot on System');
    await panel.ev("document.getElementById('setTab-system').click()");
    await wait(200);
    await shot(panel, 'update-dot');

    // a wide panel: the rail shows names and lists the sections of the area you're in.
    // An off-screen window under a metrics override gets no frames, so an area's
    // slide-in would sit at its first, see-through frame: reduced motion skips it.
    await panel.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await panel.send('Emulation.setDeviceMetricsOverride', { ...WIDE, deviceScaleFactor: 1, mobile: false });
    try {
      await panel.ev("document.getElementById('setTab-code').click()");
      check(await until(panel, "document.getElementById('settingsRail').offsetWidth > 120 && !!document.querySelector('#settingsRail .rail-toc')"), 'a wide panel opens the rail out with the sections of the area you are in');
      const toc = await panel.ev("[...document.querySelectorAll('#settingsRail .rail-toc button')].map(b => b.dataset.nav)");
      check(JSON.stringify(toc) === JSON.stringify(AREAS.code), `the list is Code's sections (${toc.join(', ')})`);
      await panel.ev("[...document.querySelectorAll('#settingsRail .rail-toc button')].find(b => b.dataset.nav === 'Dev servers').click()");
      check(await until(panel, "document.querySelector('#settingsRail .rail-toc .on')?.dataset.nav === 'Dev servers'", 8000),
        'picking Dev servers there scrolls to it, and the list lights it');
      await shot(panel, 'wide-code');
      // going down the rail: Code's list goes before the marker is measured
      await panel.ev("document.getElementById('setTab-accounts').click()");
      check(await until(panel, `(() => {
        const rail = document.getElementById('settingsRail');
        const b = document.getElementById('setTab-accounts');
        return Math.abs(parseFloat(rail.style.getPropertyValue('--mark-y')) - b.offsetTop) < 1 && rail.querySelector('.rail-toc')?.previousElementSibling === b;
      })()`), 'moving down the wide rail, the marker lands on the new area, its list under it');
      await panel.ev("document.getElementById('setTab-accounts').focus()");
      await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      check(await until(panel, "!!document.activeElement.closest('#settingsRail .rail-toc')"), 'Right on an area reaches its sections from the keyboard');
      await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
      check(await until(panel, "document.activeElement.id === 'setTab-accounts'"), 'and Left goes back to the area');
      await hover(panel, '#setTab-games');
      await wait(500);
      check(await panel.ev("document.getElementById('settingsPeek').hidden"), 'the wide rail never peeks: it lists the sections itself');
    } finally {
      await panel.send('Emulation.clearDeviceMetricsOverride');
      await panel.send('Emulation.setEmulatedMedia', { features: [] });
    }
  } catch (e) {
    check(false, e.message);
  } finally {
    run.app.kill();
    await wait(1500);
  }

  // ---- just the crab
  run = await launch(newProfile({ crabOnly: true }));
  try {
    await run.ev("SB.setView('settings')");
    await wait(400);
    check(await selected(run) === 'look', 'just-the-crab opens Settings on Look');
  } catch (e) {
    check(false, e.message);
  } finally {
    run.app.kill();
  }

  console.log(`\nscreenshots in ${OUT}`);
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
