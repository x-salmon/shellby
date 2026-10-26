// ci: the crab's moods, work poses and flourishes move exactly as recorded, now that the panel shares his animations (shared/crab-anim.css)
// End-to-end check that the desktop crab moves the same in every mood and work
// pose as the recorded baseline (test/fixtures/crab-anim.json). His part
// animations live in src/renderer/shared/crab-anim.css, shared with the
// panel's Painter and Wardrobe, so a change there must never move him.
//
// For each set of body classes (idle, working, every work pose, asking,
// success and error with each flourish, sleeping, and the moods, habits and
// scene bits around them that share his parts) it reads, for
// him, his sprite, his shadow and each part of him: the resting transform,
// opacity and pivot, and every animation on it (keyframes, duration, delay,
// easing, iterations, direction, fill). Those decide every frame he can draw,
// so the same description is the same picture at every moment, on any PC.
// Keyframe names are left out: only what they do counts.
//
// It also saves a screenshot of each at three fixed moments (animations
// paused at a set time, the description read at the same moments), through scripts/lib/shot.js, so two runs can be
// compared pixel for pixel:
//   node scripts/e2e-crab-anim.js [shotDir]               compare with the baseline
//   node scripts/e2e-crab-anim.js [shotDir] --save        record the baseline
//   node scripts/e2e-crab-anim.js [shotDir] --before=dir  ...and compare the PNGs with an earlier run's
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { capturePng } = require('./lib/shot');
const { POSES } = require('../src/main/work-pose');
const { NAMES: FLOURISHES } = require('../src/main/flourish');
const { BITS } = require('../src/main/voice');
const { SCENE_BITS } = require('../src/main/scenes');
const { panelBooted } = require('./lib/boot');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9411;
const HOOK = Number(process.env.E2E_HOOK_PORT) || 48111;
const BASELINE = path.join(ROOT, 'test', 'fixtures', 'crab-anim.json');
const args = process.argv.slice(2);
const SAVE = args.includes('--save');
const BEFORE = (args.find(a => a.startsWith('--before=')) || '').slice('--before='.length) || null;
const OUT = args.find(a => !a.startsWith('--')) || fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-crab-anim-'));
const wait = ms => new Promise(r => setTimeout(r, ms));

// Every mood and pose the shared stylesheet draws, and the moods around them
// that move the same parts (so a rule that changed places in the cascade shows up).
// Each flourish (src/main/flourish.js) is tried on a win and on a miss, since
// it only plays on its own; his habits and scene bits share keyframes with him.
const LOOKS = [...new Set([
  'state-idle', 'state-working', ...POSES.filter(p => p !== 'busy').map(p => `state-working work-${p}`),
  'state-working tool-swap work-read', 'state-asking', 'state-success', 'state-error', 'state-sleeping',
  ...FLOURISHES.flatMap(f => [`state-success flourish-${f}`, `state-error flourish-${f}`]),
  'state-learned', 'state-unlocked', 'state-levelup', 'state-petted', 'state-cheer', 'state-refreshed',
  'state-idle walking', 'state-idle walking walk-fast', 'state-idle walking cursor-near',
  'state-idle flying', 'state-idle landed', 'state-idle landed landed-hard', 'state-working dropping', 'state-idle ci-red',
  'state-idle focus-focus', 'state-idle focus-break', 'state-idle molt-out', 'state-idle molt-bare', 'state-idle molt-in',
  'state-idle tossing', ...[...BITS, ...SCENE_BITS].map(b => `state-idle bit-${b}`), 'state-idle on-call',
  'state-working planning', 'state-sleeping limited',
])];
const MOMENTS = [0.1, 0.45, 1.2]; // seconds into every animation, for the screenshots

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || `eval failed: ${expr}`);
    return r?.result?.value;
  };
  return { send, ev, close: () => ws.close() };
}

// In the crab's window: hold his body classes still (his own repaints can't
// change them while we look), and describe him.
const SETUP = `(() => {
  const setClass = Object.getOwnPropertyDescriptor(Element.prototype, 'className').set;
  window.__look = cls => {
    Object.defineProperty(document.body, 'className', { configurable: true, get: () => cls, set() {} });
    setClass.call(document.body, cls);
  };
  const KEEP = ['transform', 'opacity', 'filter', 'offset', 'easing', 'composite'];
  const frames = a => a.effect.getKeyframes().map(k => Object.fromEntries(Object.entries(k).filter(([p]) => KEEP.includes(p))));
  const timing = a => { const t = a.effect.getTiming(); return { duration: t.duration, delay: t.delay, iterations: t.iterations, direction: t.direction, fill: t.fill, easing: t.easing }; };
  window.__describe = () => {
    const els = [['crab', document.getElementById('crab')], ['sprite', document.getElementById('sprite')], ['shadow', document.getElementById('shadow')]];
    const seen = {};
    for (const g of document.querySelectorAll('#sprite svg > g')) {
      const cls = g.getAttribute('class') || '';
      if (/\\b(acc|sticker)\\b/.test(cls)) continue; // what he wears depends on the day, not on his moves
      const k = cls.replace(/\\s+/g, '.');
      seen[k] = (seen[k] || 0) + 1;
      els.push([k + '#' + seen[k], g]);
    }
    const out = {};
    for (const [k, el] of els) {
      if (!el) continue;
      const cs = getComputedStyle(el);
      out[k] = {
        transform: cs.transform, opacity: cs.opacity, origin: cs.transformOrigin,
        animations: el.getAnimations().filter(a => a.animationName).map(a => ({ frames: frames(a), timing: timing(a) }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      };
    }
    return out;
  };
  // Every animation paused at one moment, transitions done: the same picture
  // every run. shared/framecap.js would go on stepping them, so it stops
  // seeing them first (it walks document.getAnimations()).
  const all = Document.prototype.getAnimations.bind(document);
  document.getAnimations = () => [];
  window.__freeze = s => {
    for (const a of all()) {
      if (a instanceof CSSTransition) { a.finish(); continue; }
      a.pause();
      a.currentTime = s * 1000;
    }
  };
  return true;
})()`;

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-crab-anim-data-'));
  const app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`, '--force-prefers-no-reduced-motion'], {
    stdio: 'ignore',
    env: {
      // calm: a PC warmed up by the run would have him fan himself (shared/health.css)
      ...process.env, SHELLBY_USER_DATA: data, SHELLBY_MOTION_TEST: '1', SHELLBY_TODAY: '2026-06-03', SHELLBY_FAKE_HEALTH: 'calm',
      SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: String(HOOK),
    },
  });
  try {
    let list = [];
    for (let i = 0; i < 60 && !(list.some(t => t.url.endsWith('panel.html')) && list.some(t => t.url.endsWith('critter.html'))); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    const panel = await connect(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    const critter = await connect(list.find(t => t.url.endsWith('critter.html')).webSocketDebuggerUrl);
    await panelBooted(panel.ev);
    await panel.ev("shellby.setSettings({ onboarded: true, skin: 'classic', scale: 1 }).then(r => { SB.state.settings = r.settings; })");
    await panel.ev('shellby.setWardrobeOptions({ seasonalAuto: false })');
    await panel.ev("shellby.dev.life({ what: 'call', on: false })");
    await wait(1200);
    check(await critter.ev("!!document.querySelector('#sprite svg .part-claw')"), 'the crab is drawn');
    check(await critter.ev(SETUP), 'the look can be held still');

    const got = {};
    fs.mkdirSync(OUT, { recursive: true });
    const send = (m, p) => critter.send(m, p);
    let shotsSame = 0, shotsDiff = 0;
    for (const look of LOOKS) {
      await critter.ev(`__look(${JSON.stringify(look)})`);
      await wait(100);
      got[look] = {};
      for (const [i, s] of MOMENTS.entries()) {
        await critter.ev(`__freeze(${s})`);
        await wait(120);
        got[look][s] = await critter.ev('__describe()');
        const png = await capturePng(send, { clip: await critter.ev("(() => { const r = document.getElementById('self').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()") });
        if (!png) continue;
        const name = `${look.replace(/\s+/g, '_')}-${i}.png`;
        fs.writeFileSync(path.join(OUT, name), png);
        if (BEFORE && fs.existsSync(path.join(BEFORE, name))) {
          if (fs.readFileSync(path.join(BEFORE, name)).equals(png)) shotsSame++;
          else { shotsDiff++; console.log(`      differs: ${name}`); }
        }
      }
    }

    fs.writeFileSync(path.join(OUT, 'described.json'), JSON.stringify(got, null, 1));
    if (SAVE) {
      fs.writeFileSync(BASELINE, `${JSON.stringify(got, null, 1)}\n`);
      console.log(`saved the baseline for ${LOOKS.length} looks to ${path.relative(ROOT, BASELINE)}`);
    } else {
      const want = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
      for (const look of LOOKS) {
        if (!want[look]) { check(false, `${look}: in the baseline`); continue; }
        const off = new Set();
        for (const s of MOMENTS) {
          const a = want[look][s] || {}, b = got[look][s] || {};
          for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[p]) !== JSON.stringify(b[p])) off.add(p);
        }
        check(!off.size, `${look}: moves as recorded${off.size ? ` (not: ${[...off].join(', ')})` : ''}`);
      }
    }
    if (BEFORE) check(shotsDiff === 0 && shotsSame > 0, `screenshots the same as ${BEFORE} (${shotsSame} same, ${shotsDiff} different)`);
    console.log(`screenshots in ${OUT}`);
    panel.close(); critter.close();
  } catch (e) {
    console.error(e);
    fails++;
  } finally {
    app.kill();
    await wait(800);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* still closing */ }
  }
  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
