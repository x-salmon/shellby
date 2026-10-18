// ci: Shellby Wrapped: due on January 2nd, the slides, the card PNG, milestone pieces in the tray, and Wrapped week with friends
// End-to-end check of Shellby Wrapped (docs/WRAPPED.md) against the dev app over CDP,
// on a throwaway profile. Fills a year through the e2e-only dev-seed action, moves
// main's clock to New Year's Day (nothing yet) and then January 2nd (the sheet opens
// by itself), steps through every slide, makes the card (a 1200x630 PNG), checks the
// year is marked shown and the Year One trophy brings its snowglobe, and that the
// tank's Milestones shelf has every milestone piece, locked ones with their progress.
//   node scripts/e2e-wrapped.js [out.png]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { savePng } = require('./lib/shot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9467;
const YEAR = 2026;
const wait = ms => new Promise(r => setTimeout(r, ms));
// Counts come from source, never hardcoded.
const MILESTONES = require('../src/wardrobe/milestones.json').decor;

// Wrapped week (docs/plans/community-events.md §5): January 4th 2027 (SHELLBY_TODAY)
// with two friends whose calling cards carry their 2026 (and one whose card is from
// 2025, which counts as nothing). The 🎁 banner on the Us page counts them, the
// friends' slide follows the card with you and them side by side, its card saves,
// and sharing the Wrapped card that week brings the Wrapped Week 2026 trim.
const FRIENDS = [
  { login: 'pip', wrapped: { year: YEAR, xp: 4200, days: 180, levels: 9, bugs: 61, nemesis: 'off-by-one-octopus' } },
  { login: 'reefbuddy', wrapped: { year: YEAR, xp: 900, days: 40, levels: 2, bugs: 7, nemesis: 'nullfish' } },
  { login: 'lastyear', wrapped: { year: YEAR - 1, xp: 99999, days: 365, levels: 50, bugs: 999, nemesis: 'nullfish' } },
];
async function wrappedWeek(check) {
  let fails = 0; // what threw; check() counts its own
  const ok = check;
  const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-')));
  const card = f => ({ login: f.login, skin: 'classic', level: 12, outfit: {}, wrapped: f.wrapped });
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    onboarded: true, wander: false,
    friends: { list: FRIENDS.map((f, i) => ({ login: f.login, cardId: `gist${i}`, card: card(f), addedAt: 1, checkedAt: Date.now() })) },
  }));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_E2E: '1', SHELLBY_TODAY: `${YEAR + 1}-01-04`, SHELLBY_USER_DATA: profile, SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '48067' },
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
    const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
    const until = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await ev(expr)) return true; await wait(200); } return false; };
    await until('!!window.SB && !!SB.wrapped');
    await ev(`shellby.gameAct('wrapped', 'dev-seed', { year: ${YEAR} })`);
    const shared = FRIENDS.filter(f => f.wrapped.year === YEAR);

    // The banner: Wrapped week, with how many friends shared.
    const v = await ev(`SB.wrapped.refresh()`);
    ok(v?.week?.year === YEAR && v.week.friendsShared === shared.length, `Wrapped week ${YEAR}, ${shared.length} friends shared (${JSON.stringify(v?.week)})`);
    await ev(`SB.wrapped.close(); SB.setView('us')`);
    await wait(400);
    const banner = await ev(`(b => b && !b.hidden && b.textContent)(document.querySelector('[data-wrapped-week="us"]'))`);
    ok(/Wrapped week/.test(banner || '') && banner.includes(`${shared.length} friends have shared`), `the Us page's banner (${banner})`);
    ok(await ev(`!document.querySelector('[data-wrapped-week="trophies"]').hidden`), 'and on Trophies');

    // The slides: the friends' one after the card.
    const view = await ev(`shellby.getGame('wrapped', ${YEAR})`);
    const ids = view.slides.map(s => s.id);
    ok(ids.at(-1) === 'friends' && ids.at(-2) === 'card', `the friends' slide follows the card (${ids.slice(-2).join(', ')})`);
    const fr = view.slides.at(-1);
    ok(fr.people.length === shared.length + 1 && fr.people[0].me, `you and the ${shared.length} who shared that year (${fr.people.map(x => x.login).join(', ')})`);
    ok(fr.supers.some(s => s.what === 'Most days together' && s.login === 'pip'), 'with who did most');
    ok(fr.people.filter(x => !x.me).every(x => x.nemesis?.art?.pixels?.length), "each friend's nemesis portrait");
    await ev(`document.querySelector('[data-open-wrapped]').click()`);
    ok(await until("!document.getElementById('wrappedSheet').hidden"), 'Open Wrapped opens it');
    for (let i = 0; i < ids.length - 1; i++) { await ev("document.getElementById('wrappedNext').click()"); await wait(80); }
    ok((await ev("document.querySelectorAll('#wrappedSlide .wr-friend').length")) === shared.length + 1, 'the slide shows everyone side by side');
    await savePng(send, path.join(os.tmpdir(), 'shellby-wrapped-friends.png'));

    // Its card, and the card slide's own share: the year's trim.
    const pngs = () => { const dir = path.join(profile, 'Shellby'); return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.png')) : []; };
    await ev("document.querySelector('#wrappedSlide [data-wrapped-card]').click()");
    ok(await until("!document.getElementById('cardSheet').hidden"), "the friends' card opens in the share sheet");
    ok((await ev("(i => i.naturalWidth + 'x' + i.naturalHeight)(document.getElementById('cardImg'))")) === '1200x630', 'a 1200x630 card');
    ok(pngs().length === 1, `saved (${pngs().join(', ')})`);
    await ev("document.getElementById('cardClose').click()");
    const before = await ev(`shellby.wardrobeView().then(w => w.achievements.find(a => a.id === 'wrapped-week-${YEAR}')?.done)`);
    ok(before === false, 'the Wrapped Week trim waits for the Wrapped card itself');
    await ev(`SB.wrapped.open(${YEAR})`);
    await until("!document.getElementById('wrappedSheet').hidden");
    for (let i = 0; i < ids.length - 2; i++) { await ev("document.getElementById('wrappedNext').click()"); await wait(80); }
    ok(await ev("!!document.getElementById('wrappedShareYear')"), "the card slide has Show my year to friends");
    await ev("document.querySelector('#wrappedSlide [data-wrapped-card]').click()");
    await until("!document.getElementById('cardSheet').hidden");
    ok(await until("shellby.wardrobeView().then(w => w.achievements.find(a => a.id === 'wrapped-week-" + YEAR + "')?.done)"), `sharing the Wrapped card this week earns Wrapped Week ${YEAR}`);
    ws.close();
  } catch (e) {
    console.log('FAIL ', e?.stack || e);
    fails++;
  } finally {
    app.kill();
    await wait(800);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still held */ }
  }
  return fails;
}

(async () => {
  const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-')));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
    stdio: 'ignore',
    env: { ...process.env, SHELLBY_E2E: '1', SHELLBY_USER_DATA: profile, SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '48067' },
  });
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
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
    const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
    const until = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await ev(expr)) return true; await wait(200); } return false; };
    await until('!!window.SB && !!SB.wrapped');

    // A year to show, then New Year's Day: not yet.
    const seeded = await ev(`shellby.gameAct('wrapped', 'dev-seed', { year: ${YEAR} })`);
    check(!!seeded, 'the e2e seed is allowed in a test run');
    const ny = await ev(`shellby.gameAct('wrapped', 'dev-clock', { at: new Date(${YEAR + 1}, 0, 1, 12).getTime() })`);
    check(ny?.due === null, `nothing due on New Year's Day (${JSON.stringify(ny?.due)})`);
    await wait(600);
    check(await ev("document.getElementById('wrappedSheet').hidden"), 'the sheet stays shut on the 1st');

    // January 2nd, just after midnight: main says it's due and the sheet opens by itself.
    const jan2 = await ev(`shellby.gameAct('wrapped', 'dev-clock', { at: new Date(${YEAR + 1}, 0, 2, 0, 30).getTime() })`);
    check(jan2?.due === YEAR, `${YEAR} is due on January 2nd (${JSON.stringify(jan2?.due)})`);
    check(await until("!document.getElementById('wrappedSheet').hidden"), 'the Wrapped sheet opens by itself');
    check((await ev("document.getElementById('wrappedTitle').textContent")) === `Shellby Wrapped ${YEAR}`, 'titled with the year');

    // Every slide, from the view main sends.
    const view = await ev(`shellby.getGame('wrapped', ${YEAR})`);
    const ids = view.slides.map(s => s.id);
    check(ids[0] === 'year' && ids.at(-1) === 'card', `starts with the year and ends with the card (${ids.join(', ')})`);
    check(['shipped', 'bugdex', 'fixes'].every(x => ids.includes(x)), 'the seeded pushes, catches and held fix have their slides');
    const seen = [];
    for (let i = 0; i < ids.length; i++) {
      seen.push(await ev("document.getElementById('wrappedSlide').dataset.slide"));
      if (i < ids.length - 1) await ev("document.getElementById('wrappedNext').click()");
      await wait(120);
    }
    check(JSON.stringify(seen) === JSON.stringify(ids), 'Next steps through every slide in order');
    check((await ev("document.getElementById('wrappedCount').textContent")) === `${ids.length} of ${ids.length}`, 'the count reaches the end');
    await ev("document.getElementById('wrappedPrev').click()");
    check((await ev("document.getElementById('wrappedSlide').dataset.slide")) === ids.at(-2), 'Back goes back');
    await ev("document.getElementById('wrappedNext').click()");

    const shot = process.argv[2] || path.join(os.tmpdir(), 'shellby-wrapped.png');
    await savePng(send, shot);

    // The card.
    await ev("document.querySelector('#wrappedSlide [data-wrapped-card]').click()");
    check(await until("!document.getElementById('cardSheet').hidden"), 'the card opens in the share sheet');
    const img = await ev("(i => ({ w: i.naturalWidth, h: i.naturalHeight }))(document.getElementById('cardImg'))");
    check(img?.w === 1200 && img?.h === 630, `the card is 1200x630 (${img?.w}x${img?.h})`);
    const dir = path.join(profile, 'Shellby');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^shellby-.*\.png$/.test(f)) : [];
    check(files.length === 1, `the card is saved in the test profile (${files.join(', ') || 'none'})`);
    if (files[0]) {
      const buf = fs.readFileSync(path.join(dir, files[0]));
      check(buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630, 'the saved PNG is 1200x630');
    }
    await ev("document.getElementById('cardClose').click()");

    // Shown once: not due again, still on Trophies, and the Year One snowglobe is his.
    await wait(800);
    const after = await ev("shellby.getGame('wrapped')");
    check(after?.due === null, 'not due again once seen');
    check(after?.available?.some(a => a.year === YEAR && a.shown), 'still there to open again');
    await ev("SB.setView('trophies')");
    check(await until("!!document.getElementById('wrappedOpen') && !document.getElementById('wrappedOpen').hidden"), 'Trophies has the 🎁 button');

    // The tank's Milestones shelf: every piece, the snowglobe earned, the rest locked with progress.
    const tray = await ev("shellby.getTank().then(v => v.tray.filter(t => t.milestone).map(t => ({ ref: t.ref, category: t.category, locked: !!t.locked, progress: t.progress, frames: t.frames.length })))");
    check(tray?.length === MILESTONES.length, `the Milestones shelf has all ${MILESTONES.length} pieces (${tray?.length})`);
    check(tray?.every(t => t.category === 'milestone'), 'all on the Milestones shelf');
    check(tray?.some(t => t.ref === 'wrapped-snowglobe-1' && !t.locked), 'Year One brings the snowglobe');
    check(tray?.filter(t => t.locked).every(t => t.progress && t.progress.goal >= 1), 'locked pieces carry their progress');
    check(tray?.filter(t => t.frames).length === MILESTONES.filter(m => m.frames).length, 'animated pieces keep their frames');
    await ev("SB.setView('tank')");
    await wait(600);
    await ev("document.getElementById('tkDecorate').click()");
    await wait(300);
    await ev("document.querySelector('#tkShelves [data-shelf=\"milestone\"]')?.click()");
    await wait(300);
    const tiles = await ev("({ all: document.querySelectorAll('#tkItems .tk-ms').length, locked: document.querySelectorAll('#tkItems .tk-ms-locked').length })");
    check(tiles?.all === MILESTONES.length && tiles.locked === MILESTONES.length - 1, `the tray paints them, locked ones as silhouettes (${JSON.stringify(tiles)})`);
    await ev("document.getElementById('tkCancel').click()");
  } catch (e) {
    console.log('FAIL ', e?.stack || e);
    fails++;
  } finally {
    app.kill();
    await wait(800);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still held */ }
  }
  const threw = await wrappedWeek(check); // after the await: check() has counted its own by then
  fails += threw;
  console.log(fails ? `${fails} check(s) failed` : 'all good');
  process.exit(fails ? 1 : 0);
})();
