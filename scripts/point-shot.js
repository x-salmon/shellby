// Renders docs/img/screenshot-point.png: Point at it on a made-up dev server.
// A small tide-forecast site (the "tidepool" project the other captures use)
// is served on localhost, Shellby's own picker (src/main/pages/page-side/picker.js)
// runs over it in an isolated world as the dev-server window runs it, two parts
// are picked and the box says what should change. Nothing in it is real data.
//
//   npx electron scripts/point-shot.js [outDir]
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pickerSource } = require('../src/main/pages/protocol');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(ROOT, 'docs', 'img'));
const VIEW = { width: 1440, height: 810 };   // CSS pixels: a full-screen browser's page
const OUT_SIZE = { width: 1920, height: 1080 }; // saved at 1920×1080
const WORLD_ID = 1012;                        // the picker's world, as in src/main/devpoint.js
const SETTLE_MS = 900;
const ASK = 'Match the button to the cards\' teal';
const wait = ms => new Promise(r => setTimeout(r, ms));

const SITE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>tidepool</title><style>
*{box-sizing:border-box;margin:0}
body{font:16px/1.5 "Segoe UI",system-ui,sans-serif;color:#0f2a33;background:linear-gradient(180deg,#f3efe6 0%,#f7f4ee 55%,#e8f1ef 100%);height:100vh;overflow:hidden}
nav{display:flex;align-items:center;gap:2.2rem;padding:1.3rem 4rem}
.logo{display:flex;align-items:center;gap:.55rem;font-weight:800;font-size:1.3rem;letter-spacing:-.02em}
.logo i{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#1f8a87,#0f4c5c);display:inline-block;position:relative}
.logo i:after{content:"";position:absolute;left:6px;right:6px;bottom:9px;height:6px;border-radius:6px;border-top:3px solid #f3efe6}
nav a{color:#3d5a63;text-decoration:none;font-weight:600;font-size:.95rem}
nav .sp{flex:1}
nav .in{padding:.5rem 1.1rem;border-radius:10px;border:1.5px solid #c9d6d4;color:#0f2a33}
main{display:grid;grid-template-columns:1fr 1.05fr;gap:3.5rem;padding:3.6rem 4rem 0;align-items:center}
.eyebrow{display:inline-flex;gap:.5rem;align-items:center;font-size:.8rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#1f8a87}
.eyebrow:before{content:"";width:8px;height:8px;border-radius:50%;background:#1f8a87;box-shadow:0 0 0 4px rgba(31,138,135,.18)}
h1{font-size:4.1rem;line-height:1.02;letter-spacing:-.045em;margin:.9rem 0 1.1rem;font-weight:800}
h1 em{font-style:normal;color:#1f8a87}
.lede{font-size:1.15rem;color:#4a6670;max-width:31ch}
.ctas{display:flex;gap:.8rem;margin-top:1.9rem}
.btn{padding:.95rem 1.5rem;border-radius:12px;font-weight:700;font-size:1rem;border:0;font-family:inherit}
.btn.go{background:#0f4c5c;color:#fff;box-shadow:0 10px 24px -10px rgba(15,76,92,.7)}
.btn.map{background:transparent;border:1.5px solid #c9d6d4;color:#0f2a33}
.chart{background:#fff;border-radius:22px;padding:1.5rem 1.6rem 1.2rem;box-shadow:0 30px 60px -30px rgba(15,42,51,.35),0 0 0 1px rgba(15,42,51,.05)}
.chart h2{font-size:1rem;display:flex;justify-content:space-between;align-items:baseline}
.chart h2 span{font-size:.85rem;color:#7a9097;font-weight:600}
.chart svg{display:block;width:100%;height:auto;margin-top:.6rem}
.legend{display:flex;gap:1.6rem;margin-top:.5rem;font-size:.88rem;color:#4a6670}
.legend b{color:#0f2a33}
.stations{display:grid;grid-template-columns:repeat(4,1fr);gap:1.1rem;padding:3.4rem 4rem 0}
.station{background:#fff;border-radius:16px;padding:1rem 1.15rem;box-shadow:0 0 0 1px rgba(15,42,51,.06),0 14px 30px -22px rgba(15,42,51,.35)}
.station h3{font-size:.98rem;display:flex;justify-content:space-between}
.station h3 small{font-weight:600;color:#7a9097;font-size:.78rem}
.station .low{font-size:1.65rem;font-weight:800;letter-spacing:-.03em;margin-top:.25rem;color:#1f8a87}
.station .low span{font-size:.9rem;color:#4a6670;font-weight:600;letter-spacing:0;margin-left:.35rem}
.station svg{display:block;width:100%;height:26px;margin-top:.35rem}
</style></head><body>
<nav><span class="logo"><i></i>tidepool</span><a href="#">Forecast</a><a href="#">Stations</a><a href="#">API</a><a href="#">Pricing</a><span class="sp"></span><a class="in" href="#">Sign in</a></nav>
<main>
  <section>
    <span class="eyebrow">Monterey Bay · Today</span>
    <h1>Catch the <em>low tide</em> before it turns.</h1>
    <p class="lede">Tide charts for every station on the bay, and a little forecast API for your own apps.</p>
    <div class="ctas"><button class="btn go">See today's tides</button><button class="btn map">Station map</button></div>
  </section>
  <section class="chart">
    <h2>Monterey Harbor <span>Sat 14 Nov · ft above MLLW</span></h2>
    <svg viewBox="0 0 600 220" aria-label="Today's tide curve">
      <defs><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f8a87" stop-opacity=".35"/><stop offset="1" stop-color="#1f8a87" stop-opacity="0"/></linearGradient></defs>
      <g stroke="#e6ecea" stroke-width="1"><line x1="0" y1="40" x2="600" y2="40"/><line x1="0" y1="100" x2="600" y2="100"/><line x1="0" y1="160" x2="600" y2="160"/></g>
      <path d="M0,120 C40,60 90,30 140,34 C200,40 240,150 300,176 C350,196 380,150 420,96 C460,46 520,52 560,92 C580,112 595,124 600,128 L600,220 L0,220 Z" fill="url(#sea)"/>
      <path d="M0,120 C40,60 90,30 140,34 C200,40 240,150 300,176 C350,196 380,150 420,96 C460,46 520,52 560,92 C580,112 595,124 600,128" fill="none" stroke="#1f8a87" stroke-width="3.5" stroke-linecap="round"/>
      <line x1="232" y1="10" x2="232" y2="210" stroke="#0f4c5c" stroke-width="1.5" stroke-dasharray="4 5"/>
      <circle cx="232" cy="122" r="7" fill="#0f4c5c" stroke="#fff" stroke-width="3"/>
      <circle cx="140" cy="34" r="5" fill="#fff" stroke="#1f8a87" stroke-width="3"/>
      <circle cx="306" cy="178" r="5" fill="#fff" stroke="#1f8a87" stroke-width="3"/>
      <g font-size="13" fill="#7a9097" font-family="Segoe UI"><text x="0" y="216">00:00</text><text x="140" y="216">06:00</text><text x="285" y="216">12:00</text><text x="430" y="216">18:00</text><text x="560" y="216">24:00</text></g>
      <text x="244" y="26" font-size="13" font-weight="700" fill="#0f4c5c" font-family="Segoe UI">now · 3.4 ft, falling</text>
    </svg>
    <div class="legend"><span>High <b>5.1 ft</b> 06:42</span><span>Low <b>0.3 ft</b> 13:18</span><span>High <b>4.6 ft</b> 19:55</span></div>
  </section>
</main>
<div class="stations">
  <article class="station"><h3>Santa Cruz <small>12 mi</small></h3><div class="low">13:02<span>0.4 ft low</span></div><svg viewBox="0 0 100 26"><path d="M0,14 C15,2 25,2 40,14 S65,26 80,14 S95,4 100,6" fill="none" stroke="#1f8a87" stroke-width="2"/></svg></article>
  <article class="station"><h3>Moss Landing <small>7 mi</small></h3><div class="low">13:11<span>0.2 ft low</span></div><svg viewBox="0 0 100 26"><path d="M0,12 C15,2 28,3 42,15 S66,25 80,13 S95,5 100,7" fill="none" stroke="#1f8a87" stroke-width="2"/></svg></article>
  <article class="station"><h3>Monterey <small>here</small></h3><div class="low">13:18<span>0.3 ft low</span></div><svg viewBox="0 0 100 26"><path d="M0,13 C14,3 27,2 41,14 S65,26 81,13 S95,4 100,6" fill="none" stroke="#1f8a87" stroke-width="2"/></svg></article>
  <article class="station"><h3>Pacific Grove <small>3 mi</small></h3><div class="low">13:24<span>0.5 ft low</span></div><svg viewBox="0 0 100 26"><path d="M0,14 C16,3 28,3 43,15 S67,25 82,13 S96,5 100,8" fill="none" stroke="#1f8a87" stroke-width="2"/></svg></article>
</div>
</body></html>`;

// Runs in the picker's world. Staging only: the shadow root is opened so this
// script can type into the box the way a person would; the app keeps it closed.
const STAGE = `(function () {
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) { const r = attach.call(this, { ...init, mode: 'open' }); window.__shotRoot = r; return r; };
  ${pickerSource()}
  const picker = shellbyPicker({ askBox: true, post: function () {} });
  picker.set(true);
  const fire = (el, type, shift) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, shiftKey: !!shift, view: window }));
  const cta = document.querySelector('.btn.go');
  const card = document.querySelectorAll('.station')[1];
  if (!cta || !card) throw new Error('the demo site is missing a part to pick');
  fire(cta, 'mousemove'); fire(cta, 'click', true);
  fire(card, 'mousemove'); fire(card, 'click');
  const input = window.__shotRoot && window.__shotRoot.querySelector('input');
  if (!input) throw new Error('the picker showed no box');
  input.value = ${JSON.stringify(ASK)};
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(SITE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  // Shown, because a hidden window stops painting, but never focused and not in the taskbar.
  const win = new BrowserWindow({ ...VIEW, useContentSize: true, show: false, focusable: false, skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true } });
  win.showInactive();
  let failed = false;
  try {
    await win.loadURL(url);
    await win.webContents.insertCSS('::-webkit-scrollbar { display: none; }');
    await wait(SETTLE_MS);
    await win.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code: STAGE }]);
    await wait(SETTLE_MS);
    const img = (await win.webContents.capturePage()).resize({ ...OUT_SIZE, quality: 'best' });
    fs.mkdirSync(OUT, { recursive: true });
    const file = path.join(OUT, 'screenshot-point.png');
    fs.writeFileSync(file, img.toPNG());
    console.log(`${path.relative(ROOT, file)} ${img.getSize().width}×${img.getSize().height}`);
  } catch (err) {
    failed = true;
    console.error('point-shot failed:', err && err.message ? err.message : err);
  } finally {
    server.close();
    win.destroy();
    app.exit(failed ? 1 : 0);
  }
});
