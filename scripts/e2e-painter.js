// ci: the Painter: start from classic, paint, see him move, keep a draft, save, wear, try on the desk, share to a mock gallery
// End-to-end for the Painter (Shellby's screen → 🎨 Paint) over the Chrome
// DevTools Protocol, on the fake CLI, with a mock GitHub
// (test/fixtures/mock-github.js) and a mock gallery index:
//   1. the tab on every row of his screen; the start screen lists your skins,
//      a blank crab and the open pack wishes
//   2. start from classic, add a colour, paint with the mouse: the drawing and
//      the preview change; undo and redo
//   3. a pose plays his work moves on your drawing (with what he holds)
//   4. the draft is kept, and is first on the start screen to carry on with
//   5. checks: a colour with no part blocks saving, and Show me points at it
//   6. Save and wear: in Settings → Look (by you, with Edit), and on the
//      desktop crab; Try him on the desk puts a draft on him for a minute
//   7. Share against the mock GitHub: the pull request, the wish line, the
//      wish told, the contest page; In review, then In the gallery
//   8. an accessory, saved as a pack of your own and worn
// Checks state, not animation, so it passes with the motion turned down.
// Screenshots go to the temp profile, or E2E_SHOTS=<dir>. E2E_REDUCED=1 turns
// the motion down, as CI's runners have it (Play once is checked then).
// Sharing needs a GitHub sign-in, which needs the OS to encrypt the token: a
// Linux box without a keyring skips that part and says so.
//   node scripts/e2e-painter.js
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { savePng } = require('./lib/shot');
const { startMockGitHub } = require('../test/fixtures/mock-github');
const { POSES } = require('../src/main/work-pose');

const PORT = Number(process.env.E2E_CDP_PORT) || 9412;
const HOOK = Number(process.env.E2E_HOOK_PORT) || 48112;
const ROOT = path.join(__dirname, '..');
const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = ms => new Promise(r => setTimeout(r, ms));
const PAINT = '#1a7a4c'; // a colour classic doesn't have, to find him by on the desktop

async function list() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return []; }
}
async function target(suffix, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const t = (await list()).find(x => x.url.endsWith(suffix));
    if (t) return t;
    await wait(500);
  }
  throw new Error(`${suffix} never appeared`);
}

async function cdp(wsUrl, shots) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || `eval failed: ${expr}`);
    return r?.result?.value;
  };
  const shot = name => savePng(send, path.join(shots, `${name}.png`));
  const mouse = async (type, x, y, button = 'left') => send('Input.dispatchMouseEvent', { type, x, y, button, buttons: type === 'mouseReleased' ? 0 : button === 'left' ? 1 : 2, clickCount: 1 });
  const key = async (k, mods = 0) => {
    const code = { z: 90, y: 89, b: 66, e: 69 }[k] || 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: code, modifiers: mods, text: mods ? undefined : k });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code, modifiers: mods });
  };
  return { ev, shot, mouse, key, send, close: () => ws.close() };
}

let fails = 0;
function check(cond, what) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}`);
  if (!cond) fails++;
}

// The gallery's index.json, as the registry serves it.
function startGallery() {
  const state = { packs: [] };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/index.json')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ format: 1, packs: state.packs })); return; }
    res.writeHead(404); res.end();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ state, base: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(c => server.close(c)) })));
}

const apps = [];
async function launch(profile, env) {
  const app = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`, ...(process.env.E2E_REDUCED ? ['--force-prefers-reduced-motion'] : [])], { stdio: 'ignore', env: { ...env, SHELLBY_USER_DATA: profile } });
  apps.push(app);
  const shots = process.env.E2E_SHOTS || profile;
  const panel = await cdp((await target('panel.html')).webSocketDebuggerUrl, shots);
  const critter = await cdp((await target('critter.html')).webSocketDebuggerUrl, shots);
  const until = async (expr, what, ms = 15000, page = panel) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await page.ev(expr)) return true; await wait(150); }
    check(false, `timed out waiting for ${what}`);
    await page.shot(`timeout-${what.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`);
    return false;
  };
  await until('!!window.SB && !!SB.state.version && !!SB.painter && SB.state.skins.length > 0', 'panel boot', 30000);
  return { app, panel, critter, until };
}
async function quit(app, ms = 20000) {
  if (app.exitCode !== null || app.signalCode !== null) return;
  const gone = new Promise(r => app.once('exit', r));
  app.kill();
  await Promise.race([gone, wait(ms)]);
  const end = Date.now() + ms;
  while (Date.now() < end && (await list()).length) await wait(250);
}

(async () => {
  const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-painter-')));
  const mock = await startMockGitHub({ login: 'crabfan' });
  const gallery = await startGallery();
  mock.state.wishes = [
    { number: 42, title: 'Pack wish: A lighthouse keeper crab', body: '### What kind?\n\nShell or skin\n\n### The idea\n\nStripes!', labels: ['pack wish'] },
    { number: 41, title: 'Pack wish: A tiny anchor', body: '### What kind?\n\nAccessory or outfit\n\n### The idea\n\nTo hold.', labels: ['pack wish'] },
  ];
  // GitHub access the shell running this has would leak into Shellby's own.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GH_TOKEN|GITHUB_TOKEN|GITHUB_PERSONAL_ACCESS_TOKEN)$/.test(k)));
  Object.assign(env, {
    SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: String(HOOK), SHELLBY_MOTION_TEST: '1',
    SHELLBY_GITHUB_WEB: mock.base, SHELLBY_GITHUB_API: mock.base, SHELLBY_GITHUB_CLIENT_ID: 'e2e-client', SHELLBY_REGISTRY_URL: gallery.base,
  });
  try {
    const { panel, critter, until } = await launch(profile, env);
    await panel.ev("shellby.setSettings({ onboarded: true, skin: 'classic' }).then(r => { SB.state.settings = r.settings; })");

    // ---------------------------------------------------------------- 1. the start screen
    console.log('the start screen');
    check(await panel.ev('!document.querySelector(\'.shellby-tabs [data-goto="paint"]\')'), 'Paint has no tab of its own');
    await panel.ev("SB.setView('wardrobe')");
    check(await panel.ev("!!document.querySelector('#wardrobeView .wd-make [data-goto=\"paint\"]')"), 'Outfits has 🎨 Paint');
    await panel.ev("document.querySelector('#wardrobeView .wd-make').scrollIntoView({ block: 'center' })");
    await panel.shot('painter-0-outfits');
    await panel.ev("document.querySelector('#wardrobeView .wd-make [data-goto=\"paint\"]').click()");
    await until("SB.state.view === 'paint' && !document.getElementById('ptStart').hidden", 'the Painter');
    // The tiles come from main (skins, drafts, wishes), a moment after the screen.
    await until("!!document.querySelector('#ptFrom [data-skin=\"classic\"]') && !!document.querySelector('#ptFrom [data-blank=\"skin\"]')", 'Start from: classic, and a blank crab');
    check(true, 'Start from: classic, and a blank crab');
    check(await panel.ev("[...document.querySelectorAll('#ptFrom [data-skin]')].filter(b => b.disabled).every(b => /locked/.test(b.textContent))"), 'a locked skin shows, but can\'t be a starting point');
    await until("document.querySelectorAll('#ptWishes li').length === 1", 'the pack wishes');
    check(await panel.ev("document.querySelector('#ptWishes li').textContent.includes('A lighthouse keeper crab')"), 'a crab wish, its "Pack wish:" taken off (the accessory one waits on the Accessory tab)');
    await panel.shot('painter-1-start');

    // ---------------------------------------------------------------- 2. painting
    console.log('painting');
    await panel.ev("document.querySelector('#ptFrom [data-skin=\"classic\"]').click()");
    await until("!document.getElementById('ptEditor').hidden && !!document.querySelector('#ptCrab svg')", 'the editor');
    const id = await panel.ev('SB.painter.current().id');
    check(/^my-classic-[a-z0-9]{4}$/.test(id) && await panel.ev("document.getElementById('ptName').value") === 'My Classic', `a copy of your own, named for it (${id})`);
    check(await panel.ev("SB.painter.current().doc.w === 22 && SB.painter.current().doc.h === 13"), 'at classic\'s size');
    // A new colour, for his claw.
    await panel.ev("document.querySelector('#ptPalette .pt-swatch.add').click()");
    await until("!!document.querySelector('#ptSwatchEdit input[type=\"color\"]')", 'the new-colour row');
    await panel.ev(`(() => { const c = document.querySelector('#ptSwatchEdit input[type="color"]'); c.value = '${PAINT}'; c.dispatchEvent(new Event('input')); const s = document.querySelector('#ptSwatchEdit select'); s.value = 'claw'; s.dispatchEvent(new Event('change')); [...document.querySelectorAll('#ptSwatchEdit button')].find(b => b.textContent === 'Add').click(); })()`);
    const ch = await panel.ev(`Object.entries(SB.painter.current().doc.palette).find(([, v]) => v === '${PAINT}')?.[0]`);
    check(!!ch && await panel.ev(`SB.painter.current().doc.parts[${JSON.stringify(ch)}] === 'claw'`), 'the colour knows its part');
    const previewBefore = await panel.ev("document.querySelector('#ptCrab svg').innerHTML");
    // Paint the top of his claw with the mouse: a press, and a drag along the row.
    const cellXY = (x, y) => `(() => { document.getElementById('ptCanvas').scrollIntoView({ block: 'center' }); const r = document.getElementById('ptCanvas').getBoundingClientRect(); const d = SB.painter.current().doc; return [r.left + (${x} + 0.5) * r.width / d.w, r.top + (${y} + 0.5) * r.height / d.h]; })()`;
    const [x0, y0] = await panel.ev(cellXY(19, 6));
    const [x1] = await panel.ev(cellXY(21, 6));
    await panel.mouse('mouseMoved', x0, y0);
    await panel.mouse('mousePressed', x0, y0);
    await panel.mouse('mouseMoved', x1, y0);
    await panel.mouse('mouseReleased', x1, y0);
    const row6 = await panel.ev('SB.painter.current().doc.frames[0][6]');
    check(row6.slice(19, 22) === ch.repeat(3), `the stroke painted three pixels (${row6})`);
    check(await panel.ev("document.querySelector('#ptCrab svg').innerHTML") !== previewBefore, 'the preview changed with it');
    check(await panel.ev(`!!document.querySelector('#ptCrab svg rect[fill="${PAINT}"]')`), '...in the new colour');
    await panel.key('z', 2); // Ctrl
    check((await panel.ev('SB.painter.current().doc.frames[0][6]')).slice(19, 22) !== ch.repeat(3), 'Ctrl+Z takes the stroke back');
    await panel.key('y', 2);
    check((await panel.ev('SB.painter.current().doc.frames[0][6]')).slice(19, 22) === ch.repeat(3), 'Ctrl+Y puts it back');
    // Right-click is the eyedropper.
    const [sx, sy] = await panel.ev(cellXY(2, 6)); // his shell
    await panel.mouse('mousePressed', sx, sy, 'right');
    await panel.mouse('mouseReleased', sx, sy, 'right');
    check(await panel.ev("SB.painter.current().doc.frames[0][6][2] === document.querySelector('#ptPalette [aria-selected=\"true\"]').dataset.ch"), 'right-click picks the colour under it');
    await panel.ev(`document.querySelector('#ptPalette [data-ch="${ch}"]').click()`);

    // ---------------------------------------------------------------- 3. seeing him move
    console.log('seeing him move');
    const ways = POSES.filter(p => p !== 'busy').length; // 'busy' is Working's own scuttle
    const chips = await panel.ev("[...document.querySelectorAll('#ptPoses button')].map(b => b.textContent.trim())");
    check(chips.length === 4 + ways && chips.every(Boolean), `pose chips: four moods and ${ways} ways of working, each named (got ${JSON.stringify(chips)})`);
    await panel.ev("document.querySelector('#ptPoses [data-pose=\"read\"]').click()");
    check(await panel.ev("document.getElementById('ptStage').classList.contains('state-working') && document.getElementById('ptStage').classList.contains('work-read')"), 'Reading: his work-read moves, from the same stylesheet as the desk');
    check(await panel.ev("!!document.querySelector('#ptCrab .acc-held')"), '...with the scroll in his claw');
    check(await panel.ev("getComputedStyle(document.querySelector('#ptCrab .part-claw')).animationName") === 'read-claw' || await panel.ev("matchMedia('(prefers-reduced-motion: reduce)').matches"), 'his claw runs read-claw');
    if (await panel.ev("matchMedia('(prefers-reduced-motion: reduce)').matches")) {
      // Motion turned down (as on CI): the pose holds still, and Play once plays its moves by script.
      check(await panel.ev("!document.getElementById('ptPlayOnce').hidden"), 'motion down: a Play once button');
      await panel.ev("document.getElementById('ptPlayOnce').click()");
      check(await panel.ev("document.querySelector('#ptCrab .part-claw').getAnimations().some(a => !a.animationName && a.playState === 'running')"), '...that plays his claw\'s reading moves once');
    }
    await panel.ev("document.querySelector('#ptPoses [data-pose=\"sleeping\"]').click()");
    check(await panel.ev("document.getElementById('ptStage').classList.contains('state-sleeping')"), 'Sleeping tucks him in');
    await panel.ev("document.querySelector('#ptPoses [data-pose=\"idle\"]').click()");
    await panel.ev("document.getElementById('ptWear').click()");
    check(await panel.ev("document.querySelectorAll('#ptCrab .pt-anchor').length") === 5, 'Wear your outfit shows his five anchors to drag');
    await panel.shot('painter-2-painting');

    // ---------------------------------------------------------------- 4. the draft
    console.log('the draft');
    await panel.ev("document.getElementById('ptAuthor').value = 'Crab Fan'; document.getElementById('ptAuthor').dispatchEvent(new Event('input'))");
    await until(`shellby.painterDrafts().then(l => l.some(d => d.id === ${JSON.stringify(id)} && d.author === 'Crab Fan'))`, 'the draft kept, a second after the change');
    check(fs.existsSync(path.join(profile, 'painter', 'drafts', `${id}.json`)), 'in painter\\drafts\\<id>.json');
    await panel.ev("document.getElementById('ptBack').click()");
    await until(`!!document.querySelector('#ptDrafts [data-draft=${JSON.stringify(id)}]')`, 'the draft, first on the start screen');
    await panel.ev(`document.querySelector('#ptDrafts [data-draft=${JSON.stringify(id)}]').click()`);
    await until(`SB.painter.current()?.id === ${JSON.stringify(id)}`, 'the draft open again');
    check((await panel.ev('SB.painter.current().doc.frames[0][6]')).slice(19, 22) === ch.repeat(3), 'with the stroke still there');

    // ---------------------------------------------------------------- 5. checks
    console.log('checks');
    await panel.ev(`(() => { const sel = [...document.querySelectorAll('#ptPalette .pt-swatch')].find(b => b.dataset.ch === ${JSON.stringify(ch)}); sel.click(); })()`);
    check(await panel.ev("!document.querySelector('#ptChecks .pt-check.block')") && await panel.ev("!document.getElementById('ptSave').disabled"), 'nothing blocks saving');
    check(await panel.ev("[...document.querySelectorAll('#ptChecks .pt-check')].map(li => li.dataset.check).join()") === 'legs-touch', 'only a note: his legs step together, like classic\'s');

    // ---------------------------------------------------------------- 6. save and wear
    console.log('save and wear');
    await panel.ev("document.getElementById('ptSaveWear').click()");
    await until(`SB.state.settings.skin === ${JSON.stringify(id)}`, 'wearing it');
    check(fs.existsSync(path.join(profile, 'skins', `${id}.json`)), 'saved to the skins folder');
    check(!fs.existsSync(path.join(profile, 'painter', 'drafts', `${id}.json`)), 'the draft goes once it\'s a skin');
    await until(`!!document.querySelector('#sprite svg rect[fill="${PAINT}"]')`, 'the desktop crab in it', 10000, critter);
    check(true, 'the desktop crab wears it');
    await panel.ev("SB.setView('settings'); document.querySelector('[data-tab=\"shellby\"]')?.click?.()");
    await until(`[...document.querySelectorAll('#skinGrid .skin-cell')].some(c => c.textContent.includes('My Classic') && c.textContent.includes('by Crab Fan') && c.querySelector('.skin-edit'))`, 'Settings → Look: your skin, by you, with Edit');
    check(true, 'Settings → Look shows it, by you, with Edit');
    await panel.shot('painter-3-look');
    // Try a draft on the desk: on him for a minute, then his own again.
    await panel.ev(`[...document.querySelectorAll('#skinGrid .skin-cell')].find(c => c.textContent.includes('My Classic')).querySelector('.skin-edit').click()`);
    await until(`SB.state.view === 'paint' && SB.painter.current()?.id === ${JSON.stringify(id)} && SB.painter.current().saved`, 'Edit opens your own skin');
    await panel.ev('shellby.setSettings({ skin: \'classic\' }).then(r => { SB.state.settings = r.settings; })');
    await until(`!document.querySelector('#sprite svg rect[fill="${PAINT}"]')`, 'classic again', 10000, critter);
    await panel.ev("document.getElementById('ptDesk').click()");
    await until(`!!document.querySelector('#sprite svg rect[fill="${PAINT}"]')`, 'Try him on the desk', 10000, critter);
    check(/On the desk/.test(await panel.ev("document.getElementById('ptDesk').textContent")), 'Try him on the desk: on him, with a countdown');
    await panel.ev("document.getElementById('ptDesk').click()");
    await until(`!document.querySelector('#sprite svg rect[fill="${PAINT}"]')`, 'taken off again', 10000, critter);
    check(true, '...and off again when you say');

    // ---------------------------------------------------------------- 7. share
    console.log('share');
    await panel.ev("document.getElementById('ptShareBtn').click()");
    check(await panel.ev("/Sign in to GitHub/.test(document.getElementById('ptShare').textContent) && !!document.querySelector('#ptShare button')"), 'signed out: Share explains, and offers a file instead');
    await panel.ev("[...document.querySelectorAll('#ptShare button')].find(b => b.textContent === 'Close').click()");
    // Signing in keeps the token encrypted by the OS, or not at all: a Linux box
    // with no keyring (Xvfb) can't, so there the sharing below is left to Windows.
    const canSign = await panel.ev('SB.state.github?.encryption !== false');
    if (!canSign) console.log('SKIP  sharing to the mock gallery: this machine can\'t encrypt a GitHub token (no keyring), so Shellby won\'t sign in');
    else {
      // Sign in (the mock approves at once) with publishing on.
      mock.approve();
      await panel.ev("SB.setView('settings')");
      await wait(400);
      // Ticked before signing in, publishing joins what the sign-in asks for once main
      // has said yes (github.js), so sign in only after the tick has taken.
      await panel.ev("document.getElementById('ghPublish').click()");
      await until("document.getElementById('ghPublish').checked", 'publishing ticked for the sign-in');
      await panel.ev("document.getElementById('ghSignIn').click()");
      await until("SB.state.github?.signedIn && SB.canPublish()", 'signed in to the mock GitHub with publishing on', 20000);
      await panel.ev(`SB.painter.edit(${JSON.stringify(id)})`);
      await until(`SB.painter.current()?.id === ${JSON.stringify(id)}`, 'back in the Painter');
      await panel.ev("document.getElementById('ptShareBtn').click()");
      await until("!!document.getElementById('ptShareGo')", 'the share sheet');
      check(await panel.ev("/@crabfan/.test(document.getElementById('ptShare').textContent)"), 'it says who it goes out as');
      await panel.ev("document.getElementById('ptShareGo').click()");
      // The confirm window main opens, as for any pack: Publish.
      let dlg = null;
      for (let i = 0; i < 60 && !dlg; i++) { dlg = (await list()).find(t => t.url.includes('dialog.html')); if (!dlg) await wait(250); }
      check(!!dlg, 'publishing asks first, in its own window');
      if (dlg) {
        const d = await cdp(dlg.webSocketDebuggerUrl, profile);
        await wait(400);
        await d.ev("{ const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Publish'); setTimeout(() => b.click(), 0); true; }");
        d.close();
      }
      await until("/Pull request opened/.test(document.getElementById('toast').textContent)", 'the pull request', 20000);
      const pr = mock.state.pulls[0];
      check(pr && /Add pack: My Classic v1\.0\.0/.test(pr.title), `a pull request to the gallery (${pr?.title})`);
      const file = [...mock.state.files.entries()].find(([k]) => k.includes(`packs/skin-${id}/pack.json`));
      const shared = file && JSON.parse(Buffer.from(file[1].content, 'base64').toString('utf8'));
      check(shared?.skins?.[0]?.id === id && shared.author === 'Crab Fan', 'the pack: your skin, wrapped, credited to you');
      check(fs.existsSync(path.join(profile, 'wardrobe', `skin-${id}.json`)), 'installed as a pack of yours (what publishing takes)');
      check(await panel.ev(`SB.state.skins.filter(s => s.name === 'My Classic').length`) === 1, '...and still shows once among your skins');
      await until("/In review/.test(document.getElementById('ptStatus').textContent)", 'In review');
      check(true, 'the skin says In review');
      await panel.shot('painter-4-shared');
      // The gallery takes it: next time the Painter looks (at most hourly), In the gallery.
      gallery.state.packs = [{ id: `skin-${id}`, version: '1.0.0', by: 'crabfan' }];
      await panel.ev("document.getElementById('ptBack').click()");
      await until(`/In the gallery/.test(document.querySelector('#ptFrom [data-skin=${JSON.stringify(id)}]')?.textContent || '')`, 'In the gallery');
      check(true, 'and In the gallery once the registry lists it');
    }

    // A wish: the pull request names it, and the wish is told (after asking).
    if (!canSign) await panel.ev("document.getElementById('ptBack').click()");
    await until("document.querySelectorAll('#ptWishes li').length === 1", 'the wish again');
    await panel.ev("[...document.querySelectorAll('#ptWishes li button')].find(b => b.textContent === 'Make this').click()");
    await until("SB.painter.current()?.wish?.number === 42", 'a crab for the wish');
    check(await panel.ev("document.getElementById('ptName').value") === 'A lighthouse keeper crab', 'named after the wish');
    const [lx, ly] = await panel.ev(cellXY(10, 6));
    await panel.mouse('mousePressed', lx, ly);
    await panel.mouse('mouseReleased', lx, ly);
    await panel.ev("document.getElementById('ptAuthor').value = 'Crab Fan'; document.getElementById('ptAuthor').dispatchEvent(new Event('input'))");
    if (canSign) {
      // One pixel on a blank crab: no eyes, no legs, hats floating. Each warning stops
      // Share until it's marked as meant, as you would for a crab drawn that way.
      check(await panel.ev(`(() => { for (let i = 0; i < 20; i++) {
        const b = [...document.querySelectorAll('#ptChecks .pt-check.warning .link-btn')].find(x => x.textContent === 'That’s on purpose');
        if (!b) return true; b.click(); } return false; })()`), 'its warnings marked as on purpose');
      await panel.ev("document.getElementById('ptShareBtn').click()");
      await until("!!document.getElementById('ptShareGo') && !document.getElementById('ptShareGo').disabled", 'the share sheet for the wish');
      await panel.ev("document.getElementById('ptShareGo').click()");
      for (const want of ['Publish', 'Comment']) {
        let w = null;
        for (let i = 0; i < 80 && !w; i++) { w = (await list()).find(t => t.url.includes('dialog.html')); if (!w) await wait(250); }
        if (!w) { check(false, `the ${want} question`); continue; }
        const d = await cdp(w.webSocketDebuggerUrl, profile);
        await wait(400);
        await d.ev(`{ const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(want)}); setTimeout(() => b.click(), 0); true; }`);
        d.close();
        await wait(800);
      }
      await until('true', 'settle', 500);
      const wishPr = mock.state.pulls[1];
      check(/For x-salmon\/shellby#42/.test(wishPr?.body || ''), 'the pull request says which wish it\'s for');
      const end = Date.now() + 8000;
      while (Date.now() < end && !mock.state.comments.length) await wait(200);
      check(mock.state.comments[0]?.number === 42 && /pull\/2/.test(mock.state.comments[0].body), 'and the wish hears about it, from your account');
    }

    // ---------------------------------------------------------------- 8. an accessory
    console.log('an accessory');
    await panel.ev("document.getElementById('ptBack').click()");
    await until("!document.getElementById('ptStart').hidden", 'the start screen');
    await panel.ev("document.querySelector('#ptModes [data-mode=\"accessory\"]').click()");
    await until("!!document.querySelector('#ptFrom [data-blank=\"accessory\"]')", 'the Accessory tab');
    await panel.ev("document.querySelector('#ptFrom [data-blank=\"accessory\"]').click()");
    await until("SB.painter.current()?.mode === 'accessory'", 'a blank accessory');
    const [ax, ay] = await panel.ev(cellXY(2, 6));
    const [bx] = await panel.ev(cellXY(5, 6));
    await panel.mouse('mousePressed', ax, ay);
    await panel.mouse('mouseMoved', bx, ay);
    await panel.mouse('mouseReleased', bx, ay);
    await panel.ev("document.getElementById('ptName').value = 'Brim'; document.getElementById('ptName').dispatchEvent(new Event('input'))");
    check(await panel.ev("!!document.querySelector('#ptCrab .acc-hat')"), 'tried on your crab as you paint');
    await panel.ev("document.getElementById('ptSaveWear').click()");
    await until("Object.values(SB.state.wardrobe?.outfit || {}).some(k => /^acc-brim-[a-z0-9]{4}\\/brim-[a-z0-9]{4}$/.test(String(k)))", 'wearing the brim');
    check(true, 'saved as a pack of your own, and worn');
    check(!/null/.test(await panel.ev("document.getElementById('ptSwatchEdit').textContent")), 'the colour row has nothing odd in it');
    await panel.shot('painter-5-accessory');

    // ---------------------------------------------------------------- 9. an effect and some decor
    console.log('an effect and some decor');
    const blankOf = async m => {
      await panel.ev("document.getElementById('ptBack').click()");
      await until("!document.getElementById('ptStart').hidden", 'the start screen');
      await panel.ev(`document.querySelector('#ptModes [data-mode="${m}"]').click()`);
      await until(`!!document.querySelector('#ptFrom [data-blank="${m}"]')`, `the ${m} tab`);
      await panel.ev(`document.querySelector('#ptFrom [data-blank="${m}"]').click()`);
      await until(`SB.painter.current()?.mode === '${m}'`, `a blank ${m}`);
    };
    const dab = async (x, y) => { const [px, py] = await panel.ev(cellXY(x, y)); await panel.mouse('mousePressed', px, py); await panel.mouse('mouseReleased', px, py); };
    await blankOf('effect');
    await dab(2, 2);
    check(await panel.ev("SB.painter.current().doc.w === 5 && !document.getElementById('ptFrames').hidden"), 'an effect: 5 × 5 to start, with pictures to add');
    await panel.ev("[...document.querySelectorAll('#ptFrames button')].find(b => b.textContent === '+').click()");
    await dab(1, 1);
    check(await panel.ev("SB.painter.current().doc.frames.length === 2 && SB.painter.current().doc.frame === 1"), 'a second picture, painted on its own');
    check(await panel.ev("document.querySelector('#ptFx .fx-layer')?.dataset.motion === 'fall'"), 'falling round him in the preview');
    await blankOf('decor');
    await dab(3, 8);
    check(await panel.ev("!!document.querySelector('#ptCrab .pt-decor-piece svg')"), 'decor: the piece beside him for size');
    await panel.ev("document.getElementById('ptName').value = 'Pebble'; document.getElementById('ptName').dispatchEvent(new Event('input'))");
    await panel.ev("document.getElementById('ptSave').click()");
    await until(`shellby.painterItems('decor').then(l => l.some(i => i.mine && i.name === 'Pebble'))`, 'the pebble among your decor');
    check(true, 'saved as decor of your own, for his tank');
    await panel.shot('painter-6-decor');
  } catch (e) {
    console.error(e);
    fails++;
  } finally {
    for (const a of apps) await quit(a);
    await mock.close();
    await gallery.close();
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
