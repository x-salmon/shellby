// ci: the crab card: Share, the preview, the 1200x630 PNG, the Show-Off trophy, every moment card
// End-to-end check of the shareable crab card against the dev app over CDP
// (throwaway profile: the card is saved inside it and the clipboard is left alone).
// Dresses Shellby, clicks "Share" in the Wardrobe, and checks the preview, the saved
// PNG (1200x630) and the Show-Off trophy. Then every moment card (moment-card.js
// MOMENT_KINDS), the beach and the Tank's 📸, each by the size in its saved PNG.
//   node scripts/e2e-card.js [out.png]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EVENT_NAMES } = require('../src/main/channels');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9346;
const wait = ms => new Promise(r => setTimeout(r, ms));

// A moment for each kind of moment card, as its caller would pass it. A kind
// moment-card.js lists with nothing here fails, so a new card gets checked.
const ART = { pixels: ['..aaaa..', '.abbbba.', 'abbccbba', 'abccccba', 'abbccbba', '.abbbba.', '..aaaa..'], palette: { a: '#ffc15e', b: '#ff7a5c', c: '#fff1a8' } };
const MOMENTS = {
  shiny: { eyebrow: '✨ A sparkly find', title: 'Sea Glass', sub: 'Dug up today', art: ART, accent: '#fff1a8', glints: true, stats: [['odds', '1/512'], ['finds before it', '40'], ['his level', 'Lv 12']] },
  medal: { eyebrow: '🎃 Tide event medal', title: 'The Haunting 2026', sub: 'Every goal, while it was on.', art: ART, accent: '#ffc15e', glints: true, badge: 'Only this year’s, for good', stats: [['goals', '4/4'], ['days to spare', '3']] },
  board: { eyebrow: "🫙 The friends' board · October", title: 'Top crab!', sub: '🥇 me: 12   🥈 @octocat: 9', art: ART, accent: '#ffc15e', stats: [['bugs this month', 12], ['crabs on the board', 2]] },
  egg: { eyebrow: '🥚 An egg, for you', title: 'Hatch my crab’s egg', sub: 'EGG-1234-ABCD', art: ART, accent: '#ffb3c6', glints: true, badge: 'Get Shellby, then paste the code', stats: [['to hatch it', 'paste the code']] },
  // The rest are built from what their celebration hands over (moment-card.js FROM).
  trophy: { achievement: { id: 'show-off', name: 'Show-Off', icon: '📸', description: 'Share your crab card' }, rewards: [{ name: 'Pearls', ...ART }] },
  level: { level: 25, title: 'Reef Warden', rank: { name: 'Coral', color: '#ff7a5c' } },
  molt: { was: { name: 'Snail Shell', ...ART }, now: { name: 'Barnacle Shell', ...ART }, count: 1, badge: 'I' },
  catch: { id: 'nullfish', name: 'Nullfish', rarity: 'legendary', pixels: ART.pixels, palette: ART.palette, habitat: 'The Shallows' },
  streak: { days: 30 },
};
// Moments that need the page's own data: JS evaluated there.
const PAGE_MOMENTS = {
  // The sticker seeded in the profile (below).
  sticker: "({ id: 'abcdefabcdef' })",
  // The Painter's call (crab-painter.md): the skin he's in now.
  skin: "({ skin: SB.state.skin, name: 'Classic', author: 'Shellby' })",
};
// PNG width and height from its IHDR chunk.
const ihdr = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-'));
  // One sticker, for its card: a project shipped six times, so a vinyl one. And a Discord
  // webhook set up for notifications, on and confirmed (as wiring/channels.js channelPlace
  // writes it) but with every event off, so the sheet offers Post to Discord
  // (never pressed here: nothing leaves the PC).
  const shipped = Date.now() - 86400000;
  const webhook = 'https://discord.com/api/webhooks/1/e2e';
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
    stickers: { card: 'names', projects: { abcdefabcdef: { name: 'tide-pool', firstShipAt: shipped, lastShipAt: shipped, ships: 6 } } },
    channels: { provider: 'discord', target: webhook, enabled: true, events: Object.fromEntries(EVENT_NAMES.map(e => [e, false])) },
    channelsConfirmed: `discord|${webhook}|tell|`,
  }));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], { stdio: 'ignore', env: { ...process.env, SHELLBY_USER_DATA: profile, SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '47961' } });
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
    const until = async (expr, ms = 6000) => { for (let t = 0; t < ms; t += 200) { if (await ev(expr)) return true; await wait(200); } return false; };
    await wait(3000);

    // Dress him up first.
    await ev(`(async () => {
      SB.applyWardrobe(await shellby.setWardrobeOptions({ unlockAll: true }));
      const r = await shellby.setOutfit({ hat: 'wizard-hat', held: 'coffee-mug', effect: 'sparkles' });
      SB.applyWardrobe(r.view);
    })()`);
    await wait(800);
    await ev("SB.setView('wardrobe')");
    await wait(600);

    const btn = await ev("!!document.querySelector('#wardrobeView [data-share-card]')");
    check(btn, 'Wardrobe has a Share button');
    await ev("document.querySelector('#wardrobeView [data-share-card]').click()");
    const shown = await (async () => { for (let i = 0; i < 30; i++) { if (await ev("!document.getElementById('cardSheet').hidden")) return true; await wait(200); } return false; })();
    check(shown, 'preview sheet opens');
    const img = JSON.parse(await ev("JSON.stringify((i => ({ w: i.naturalWidth, h: i.naturalHeight }))(document.getElementById('cardImg')))"));
    check(img.w === 1200 && img.h === 630, `preview is 1200x630 (${img.w}x${img.h})`);

    const dir = path.join(profile, 'Shellby');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^shellby-crab-\d.*\.png$/.test(f)) : [];
    check(files.length === 1, `card saved in the test profile (${files.join(', ') || 'none'})`);
    if (files[0]) {
      const buf = fs.readFileSync(path.join(dir, files[0]));
      check(buf.readUInt32BE(16) === 1200 && buf.readUInt32BE(20) === 630, 'saved PNG is 1200x630');
      const out = process.argv[2] || path.join(os.tmpdir(), 'shellby-card.png');
      fs.copyFileSync(path.join(dir, files[0]), out);
      console.log(`card: ${out}`);
    }
    const note = await ev("document.getElementById('cardPath').textContent");
    check(/^Pictures[\\/]Shellby[\\/]shellby-crab-/.test(note), `note names the file (${note})`);
    // Getting it into a post: Discord offered with a webhook set up, the alt text a click away.
    check(await ev("!document.getElementById('cardDiscord').hidden"), 'Post to Discord is offered (a Discord webhook is set up)');
    check(/alt text/.test(await ev("document.getElementById('cardHint').textContent")), 'the hint says X and Bluesky take the alt text');
    await ev("document.getElementById('cardAlt').click()");
    check(/^Alt text copied/.test(await ev("document.getElementById('cardHint').textContent")), 'Copy alt text says so');

    await wait(600);
    const trophy = await ev("(SB.state.wardrobe.achievements.find(a => a.id === 'show-off') || {}).done");
    check(trophy === true, 'sharing earns the Show-Off trophy');

    // Junk sent straight to the bridge is refused.
    const bad = await ev("shellby.saveCard(new Uint8Array([1, 2, 3])).then(r => r.ok)");
    check(bad === false, 'non-PNG bytes are refused');

    // Wide (shellby-<kind>-<stamp>.png, 1200x630) or Square (shellby-<kind>-square-<stamp>.png, 1080x1080).
    const savedAs = (kind, size = 'wide') => (fs.existsSync(dir) ? fs.readdirSync(dir)
      .filter(f => f.startsWith(`shellby-${kind}-${size === 'square' ? 'square-' : ''}`) && /-\d{8}-\d{6}\.png$/.test(f) && (size === 'square' || !f.includes('-square-'))) : []);
    const newest = async (kind, size, before) => {
      for (let i = 0; i < 40; i++) {
        const files = savedAs(kind, size);
        const buf = files.length > before ? fs.readFileSync(path.join(dir, files[files.length - 1])) : null;
        if (buf?.length >= 24) return ihdr(buf); // not while main is still writing it
        await wait(150);
      }
      return null;
    };
    const showSize = s => (s ? `${s.w}x${s.h}` : 'not saved');
    // The sheet's size switch: Square draws and saves it again at 1080x1080, and stays picked for that kind.
    const bothSizes = async (kind, label) => {
      const before = savedAs(kind, 'square').length;
      const offered = await ev("!document.getElementById('cardSizes').hidden");
      await ev("document.querySelector('#cardSizes [data-size=\"square\"]').click()");
      const sq = await newest(kind, 'square', before);
      check(offered && sq?.w === 1080 && sq?.h === 1080, `${label}, Square from the switch, is a 1080x1080 PNG (${showSize(sq)})`);
      check(await ev("document.querySelector('#cardSizes [data-size=\"square\"]').getAttribute('aria-checked') === 'true' && document.getElementById('cardImg').classList.contains('square')"), `${label}: the switch and the preview say Square`);
      await ev("document.querySelector('#cardSizes [data-size=\"wide\"]').click()"); // back to Wide for next time
      await newest(kind, 'wide', savedAs(kind, 'wide').length);
    };
    // 🎞 Clip: four seconds recorded, saved beside the card as MP4 (or WebM where Chromium can't make
    // MP4), checked by its container's magic number and a duration the page can read.
    const clipOf = async kind => {
      const clips = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(`shellby-${kind}-`) && /\.(mp4|webm)$/.test(f)) : []);
      const type = await ev('SB.momentClip.pickType()?.[1] || null');
      check(type === 'mp4', `this Chromium records MP4 (${type})`);
      await ev("document.getElementById('cardClip').click()");
      let file = null;
      for (let i = 0; i < 60 && !file; i++) { file = clips()[0] || null; if (!file) await wait(250); }
      await wait(300);
      const buf = file ? fs.readFileSync(path.join(dir, file)) : Buffer.alloc(0);
      const magic = file?.endsWith('.mp4') ? buf.subarray(4, 8).toString('latin1') === 'ftyp' : buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
      check(!!file && magic && buf.length < 5 * 1024 * 1024, `the ${kind} clip is saved as a real ${type} (${file || 'none'}, ${buf.length} bytes)`);
      const duration = await ev(`(async () => {
        const v = document.getElementById('cardVideo');
        if (v.hidden || !v.src) return null;
        const t = document.createElement('video'); t.muted = true; t.src = v.src;
        await new Promise((r, j) => { t.onloadedmetadata = r; t.onerror = j; });
        if (!Number.isFinite(t.duration)) { t.currentTime = 1e6; await new Promise(r => { t.ondurationchange = r; setTimeout(r, 3000); }); }
        return t.duration;
      })()`);
      check(duration > 2 && duration < 8, `the clip plays in the sheet, about four seconds long (${duration})`);
      const parts = await ev("JSON.stringify([document.getElementById('cardImg').hidden, document.getElementById('cardCopy').hidden, document.querySelector('#cardSheet .card-box').className])");
      check(parts === JSON.stringify([true, true, 'card-box clipping']), `a clip: no Copy, Show file first (${parts})`);
      check(await ev("(v => v.controls === matchMedia('(prefers-reduced-motion: reduce)').matches)(document.getElementById('cardVideo'))"), 'with motion turned down the clip waits for its play button, otherwise it plays');
      await ev("document.getElementById('cardClip').click()"); // 🖼 Picture: back to the card
      check(await ev("!document.getElementById('cardImg').hidden && document.getElementById('cardVideo').hidden"), '🖼 Picture goes back to the card');
    };

    await bothSizes('crab', 'the crab card');
    check(await ev("document.getElementById('cardClip').hidden"), 'the crab card has no clip');
    // How many cards he's counted as shared (Show-Off's stat), from the profile's settings once written.
    const shares = async () => { await wait(1200); try { return JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).stats?.cardsShared ?? 0; } catch { return null; } };
    const sharesBefore = await shares();

    await ev("document.getElementById('cardClose').click()");
    await wait(300);
    check(await ev("document.getElementById('cardSheet').hidden"), 'close hides the sheet');

    // Every moment card, in both sizes; 🎞 Clip on the ones that move (moment-clip.js CLIP_KINDS), and one clip made.
    const kinds = await ev('SB.momentCard.MOMENT_KINDS.slice()');
    const clipKinds = await ev('SB.momentClip.CLIP_KINDS.slice()');
    let clipped = false;
    check(Array.isArray(kinds) && kinds.length > 0, `moment-card.js lists its kinds (${(kinds || []).join(', ')})`);
    for (const kind of kinds || []) {
      const m = PAGE_MOMENTS[kind] || (MOMENTS[kind] && JSON.stringify(MOMENTS[kind]));
      if (!m) { check(false, `a ${kind} moment to draw (add one to MOMENTS)`); continue; }
      const before = savedAs(kind).length;
      await ev(`SB.momentCard.share(${JSON.stringify(kind)}, ${m}).then(() => true)`);
      const size = await newest(kind, 'wide', before);
      check(size?.w === 1200 && size?.h === 630, `the ${kind} card is a 1200x630 PNG (${showSize(size)})`);
      await bothSizes(kind, `the ${kind} card`);
      const offersClip = await ev("!document.getElementById('cardClip').hidden");
      check(offersClip === clipKinds.includes(kind), `the ${kind} card ${clipKinds.includes(kind) ? 'offers' : "doesn't offer"} 🎞 Clip`);
      if (offersClip && !clipped) {
        clipped = true;
        await clipOf(kind);
      }
      await ev("document.getElementById('cardClose').click()");
    }
    // A size switch draws the card again but isn't another share.
    const sharesAfter = await shares();
    check(sharesAfter - sharesBefore === kinds.length, `each moment counts once for Show-Off, whatever its sizes (${sharesAfter - sharesBefore} of ${kinds.length})`);

    // A celebration's 📸 makes its moment's card; Settings → Share buttons on celebrations off hides it,
    // and a trophy's card stays on the Trophies page.
    const streakBefore = savedAs('streak').length;
    await ev("SB.clearCelebrations(); SB.celebrate({ eyebrow: 'Streak', icon: '🔥', title: '7 days in a row', card: { kind: 'streak', m: { days: 7 } } })");
    check(await until("!!document.querySelector('.celebrate .cel-share')"), 'a celebration has its 📸');
    await ev("document.querySelector('.celebrate .cel-share').click()");
    const fromCel = await newest('streak', 'wide', streakBefore);
    check(fromCel?.w === 1200, `and it makes the streak card, not the crab card (${showSize(fromCel)})`);
    await ev("document.getElementById('cardClose').click()");
    await ev("shellby.setSettings({ shareButtons: false }).then(r => { SB.state.settings = r.settings; SB.clearCelebrations(); SB.celebrate({ title: 'Quiet', card: { kind: 'streak', m: { days: 7 } } }); })");
    check(await until("!!document.querySelector('.celebrate')") && !(await ev("!!document.querySelector('.celebrate .cel-share')")), 'with Share buttons off, no 📸 on a celebration');
    await ev("SB.clearCelebrations(); SB.setView('trophies')");
    check(await until("!!document.querySelector('#trophyList .trophy.done .trophy-share')"), 'but a trophy you have keeps its 📸 on Trophies');
    await ev("shellby.setSettings({ shareButtons: true }).then(r => { SB.state.settings = r.settings; })");

    // The week and Wrapped cards come in both sizes too.
    for (const [kind, call] of [['week', 'SB.weekCard.share()'], ['wrapped', "SB.wrappedCard.share({ year: 2026, card: { tiles: [['XP', '12,345'], ['days together', '120'], ['tasks', '300']] } })"]]) {
      const before = savedAs(kind).length;
      await ev(`${call}.then(() => true)`);
      const size = await newest(kind, 'wide', before);
      check(size?.w === 1200 && size?.h === 630, `the ${kind} card is a 1200x630 PNG (${showSize(size)})`);
      await bothSizes(kind, `the ${kind} card`);
      await ev("document.getElementById('cardClose').click()");
    }

    // The beach: as big as his beach needs, so the saved PNG is checked against the picture drawn.
    const beachBefore = savedAs('beach').length;
    const beachDrawn = await ev('SB.beachCard.render().then(r => ({ w: r.canvas.width, h: r.canvas.height }))');
    await ev('SB.beachCard.share().then(() => true)');
    const beachFiles = savedAs('beach');
    const beach = beachFiles.length > beachBefore ? ihdr(fs.readFileSync(path.join(dir, beachFiles[beachFiles.length - 1]))) : null;
    check(beach && beach.w === beachDrawn?.w && beach.h === beachDrawn?.h && beach.h > 120, `the beach card is the beach as drawn (${beach ? `${beach.w}x${beach.h}` : 'not saved'})`);
    await ev("document.getElementById('cardClose').click()");

    // His tank (tank.js): plain sand while it's empty, the real tank once there's something in it.
    const tankBox = "(r => { const d = r.canvas.getContext('2d').getImageData(48, 48, 470, 470).data; let s = 0; for (let i = 0; i < d.length; i += 97) s = (s * 31 + d[i]) >>> 0; return { n: r.data.tankPieces, s }; })";
    const plain = await ev(`SB.crabCard.render().then(${tankBox})`);
    check(plain?.n === 0, 'an empty tank: the card looks as it always has');
    const placed = await ev("shellby.saveTank({ size: 'nano', style: { substrate: 'gravel', backdrop: null, light: 'day' }, placed: [{ ref: 'castle-keep', x: 30, row: 0, z: 0, flip: false }, { ref: 'kelp', x: 6, row: 0, z: 0, flip: false }, { ref: 'rock-round', x: 50, row: 2, z: 0, flip: false }] }).then(r => r.view.pieces.length)");
    check(placed === 3, 'three pieces in his tank');
    const decorated = await ev(`SB.crabCard.render().then(${tankBox})`);
    check(decorated?.n === 3 && decorated.s !== plain.s, `the crab card paints his tank (${decorated?.n} pieces)`);
    const tankPng = path.join(os.tmpdir(), 'shellby-card-tank.png');
    const tankUrl = await ev('SB.crabCard.render().then(r => r.canvas.toDataURL("image/png"))');
    if (typeof tankUrl === 'string') { fs.writeFileSync(tankPng, Buffer.from(tankUrl.split(',')[1], 'base64')); console.log(`card with his tank: ${tankPng}`); }

    // The profile card only shows it once you choose (Tank → On your cards).
    await ev("SB.setView('tank')");
    await wait(1200);
    // The Tank's 📸 makes his tank card, and that's the "Share the tank" quest.
    check(await ev("!!document.querySelector('#tankView #tkCard:not([hidden])')"), 'the Tank has a 📸');
    await ev("document.getElementById('tkCard').click()");
    let tankCard = [];
    for (let i = 0; i < 30 && !tankCard.length; i++) { tankCard = savedAs('tank'); if (!tankCard.length) await wait(200); }
    const tankSize = tankCard[0] ? ihdr(fs.readFileSync(path.join(dir, tankCard[0]))) : null;
    check(tankSize?.w === 1200 && tankSize?.h === 630, `the Tank's 📸 saves his tank card (${tankCard[0] || 'none'})`);
    check(await ev("document.getElementById('cardTitle').textContent") === 'His tank card', 'the sheet calls it his tank card');
    await ev("document.getElementById('cardClose').click()");
    check(!(await ev("SB.profileCard.build().includes('id=\"tkw\"')")), 'the profile card keeps it off until you choose');
    await ev("document.getElementById('tkShare').click()");
    const svgOk = async () => ev("(s => s.includes('id=\"tkw\"') && s.length < 256 * 1024 && !/<(image|use|script|foreignObject)\\b|href=/.test(s))(SB.profileCard.build())");
    let shows = false;
    for (let i = 0; i < 20 && !shows; i++) { shows = await svgOk(); if (!shows) await wait(250); }
    check(shows, 'then the profile card shows him in it, as plain SVG');
    const svgFile = path.join(os.tmpdir(), 'shellby-profile-tank.svg');
    fs.writeFileSync(svgFile, await ev('SB.profileCard.build()') || '');
    // ...and as GitHub would show it: an image, drawn.
    const drawn = await ev(`new Promise(r => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = 480; c.height = 200;
      c.getContext('2d').drawImage(i, 0, 0); r(c.toDataURL('image/png')); }; i.onerror = () => r(null); i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SB.profileCard.build()); })`);
    check(typeof drawn === 'string', 'the profile card with his tank loads as an image');
    if (drawn) fs.writeFileSync(svgFile.replace(/\.svg$/, '.png'), Buffer.from(drawn.split(',')[1], 'base64'));
    console.log(`profile card with his tank: ${svgFile} (and .png)`);
  } catch (e) {
    check(false, e.message);
  } finally {
    app.kill();
  }
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
