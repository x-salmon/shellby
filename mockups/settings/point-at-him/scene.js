// The beach: his real sprite (src/skins) drawn part by part the way
// src/renderer/shared/sprite.js layers it, the four things on the sand, and
// everything that moves. app.js owns the settings and tells this what to show.
(function (PAH) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const VB = Object.freeze({ w: 64, h: 36 });
  const FEET = 31;                       // the sand line his feet stand on
  const PIVOT = Object.freeze({ x: 11, y: 13 }); // his feet's centre, in sprite cells
  const WALK = Object.freeze({ min: 8, max: 19, speed: 5, stepEvery: 0.16 });
  const SIZE = Object.freeze({ Small: 0.8, Medium: 1, Large: 1.2, Huge: 1.4 });
  const ZOOM = Object.freeze({ min: 1.2, max: 1.75, ms: 520, tallAspect: 1.2, tallMax: 1.3 });
  const PET = Object.freeze({ turns: 4, windowMs: 900 });
  const PINCH = Object.freeze({ reach: 5, restMs: 2500 });
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Which sprite parts each pointable area covers, and the order you step through them.
  const CRAB_TARGETS = Object.freeze({ shell: ['shell'], eyes: ['stalks', 'eyes'], body: ['body'], claw: ['claw'], legs: ['legs'] });
  const HIT_ORDER = ['shell', 'body', 'legs', 'claw', 'eyes']; // small parts last, so they win the pointer
  const ORDER = ['shell', 'eyes', 'body', 'claw', 'legs', 'bucket', 'bottle', 'jar', 'buoy', 'sign'];

  const OBJECTS = Object.freeze({
    buoy: { x: 51, y: 6, palette: { a: '#ffc15e', t: '#9d9482', r: '#ff5a4a', w: '#f3e6cc', d: '#0f5672' },
      pixels: ['..a..', '..t..', '.rwr.', 'rrwrr', 'wwwww', 'rrwrr', '.rrr.', 'ddddd'] },
    bottle: { x: 4, y: 22, palette: { k: '#a86f3a', g: '#2f8f7a', G: '#6fd3b8', w: '#e8fff8', p: '#f3e6cc' },
      pixels: ['..k..', '.kkk.', '.gGg.', '.gGg.', 'gGGGg', 'gwppg', 'gwppg', 'gGGGg', 'ggggg'] },
    bucket: { x: 39, y: 24, palette: { s: '#8a5a2b', g: '#9aa7ad', y: '#f5b82e', Y: '#c98a1a', w: '#ffe08a' },
      pixels: ['.....g.', '....gg.', '....s..', 'yyyysyy', 'YwyyyyY', '.yyyyy.', '.yyyyy.', '..YYY..'] },
    jar: { x: 47, y: 25, palette: { L: '#c9a46b', j: '#5fbfae', J: '#1d4a4f' },
      pixels: ['.LLLLL.', 'LLLLLLL', '.jJJJj.', 'jJJJJJj', 'jJJJJJj', 'jJJJJJj', 'jJJJJJj', '.jjjjj.'] },
    sign: { x: 56, y: 22, palette: { P: '#a8743f', w: '#f3e6cc', t: '#6b4423' },
      pixels: ['PPPPPP.', 'PwwwwPP', 'PPPPPP.', '..t....', '..t....', '..t....', '..t....', '.ttt...'] },
  });
  const PAL_X = [31, 1, 45, 12, 22]; // nearer the front than him, clear of the bottle and jar
  const PAL_FEET = FEET + 3.4;
  const PAL_SCALE = 0.34;

  // ---------------------------------------------------------------- drawing
  function make(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // Cells as one-high rects, a run of one colour merged (as sprite.js does).
  function paint(parent, cells) {
    const rows = new Map();
    for (const c of cells) { if (!rows.has(c[1])) rows.set(c[1], []); rows.get(c[1]).push(c); }
    for (const [y, row] of rows) {
      row.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < row.length;) {
        let j = i + 1;
        while (j < row.length && row[j][0] === row[j - 1][0] + 1 && row[j][2] === row[i][2]) j++;
        make('rect', { x: row[i][0], y, width: j - i, height: 1, fill: row[i][2] }, parent);
        i = j;
      }
    }
  }

  // His one-pixel ink line, the same rule as sprite.js's inkRings.
  const INK = '#141225';
  const INK_DEPTH = 0.78;
  const N4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];
  const rgb = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const lum = c => { const [r, g, b] = rgb(c); return 0.299 * r + 0.587 * g + 0.114 * b; };
  const sink = c => '#' + rgb(c).map((v, i) => Math.round(v + (rgb(INK)[i] - v) * INK_DEPTH).toString(16).padStart(2, '0')).join('');

  function inkRings(layers) {
    const filled = new Set();
    for (const l of layers) for (const [x, y] of l.cells) filled.add(x + ',' + y);
    const has = (x, y) => filled.has(x + ',' + y);
    const out = new Map();
    for (const l of layers) {
      const own = new Map(l.cells.map(([x, y, c]) => [x + ',' + y, c]));
      const ring = new Map();
      for (const [x, y] of l.cells) {
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
          if (has(nx, ny) || ring.has(k)) continue;
          if ((has(nx - 1, ny) && has(nx + 1, ny)) || (has(nx, ny - 1) && has(nx, ny + 1))) continue;
          const near = N4.map(([ex, ey]) => own.get((nx + ex) + ',' + (ny + ey))).filter(Boolean);
          ring.set(k, [nx, ny, sink(near.reduce((a, b) => (lum(b) < lum(a) ? b : a)))]);
        }
      }
      out.set(l.name, [...ring.values()]);
    }
    return out;
  }

  // Splits a skin's grid into its parts' cells, legs into alternating a/b groups.
  function partsOf(skin) {
    const cells = {};
    const push = (name, cell) => (cells[name] || (cells[name] = [])).push(cell);
    skin.pixels.forEach((row, y) => [...row].forEach((ch, x) => {
      const colour = skin.palette[ch];
      const part = skin.parts[ch];
      if (colour && part) push(part, [x, y, colour]);
    }));
    // Each leg is a diagonal run; alternate them so they scuttle.
    const legs = (cells.legs || []).slice().sort((a, b) => a[0] - b[0]);
    const groups = [];
    for (const c of legs) {
      const g = groups.find(gr => gr.some(([x, y]) => Math.abs(x - c[0]) <= 1 && Math.abs(y - c[1]) <= 1));
      if (g) g.push(c); else groups.push([c]);
    }
    groups.forEach((g, i) => g.forEach(c => push(i % 2 ? 'legs-b' : 'legs-a', c)));
    delete cells.legs;
    return cells;
  }

  const boxOf = cells => cells.reduce((b, [x, y]) => ({
    x0: Math.min(b.x0, x), y0: Math.min(b.y0, y), x1: Math.max(b.x1, x + 1), y1: Math.max(b.y1, y + 1),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

  /** Draws the crab's art only: one <g class="art art-KEY"> per pointable area. */
  function drawCrab(parent, skin, withEyes = true) {
    const cells = partsOf(skin);
    const names = Object.keys(cells);
    const rings = inkRings(names.map(n => ({ name: n, cells: cells[n] })));
    const arts = {};
    const order = ['legs', 'shell', 'body', 'eyes', 'claw'];
    for (const key of order) {
      const art = make('g', { class: `art art-${key}` }, parent);
      arts[key] = art;
      const own = key === 'legs' ? ['legs-a', 'legs-b'] : CRAB_TARGETS[key];
      for (const part of own) {
        if (!cells[part]) continue;
        const g = make('g', { class: `part part-${part}` }, art);
        paint(make('g', { class: 'ink' }, g), rings.get(part));
        if (part === 'eyes' && withEyes) drawEyes(g, cells.eyes, skin);
        else paint(g, cells[part]);
      }
    }
    return { arts, cells };
  }

  // Each eye is a 2x2 white with a one-cell pupil that can look around.
  function drawEyes(parent, cells, skin) {
    const white = skin.palette.w || '#ffffff';
    const dark = skin.palette.e || INK;
    const eyes = [];
    for (const c of cells) {
      const e = eyes.find(b => Math.abs(b.x - c[0]) <= 1 && Math.abs(b.y - c[1]) <= 1);
      if (e) { e.x = Math.min(e.x, c[0]); e.y = Math.min(e.y, c[1]); } else eyes.push({ x: c[0], y: c[1] });
    }
    const blink = make('g', { class: 'blink' }, parent);
    for (const e of eyes) {
      make('rect', { x: e.x, y: e.y, width: 2, height: 2, fill: white }, blink);
      make('rect', { class: 'pupil', x: e.x + 1, y: e.y + 1, width: 1, height: 1, fill: dark, 'data-x': e.x, 'data-y': e.y }, blink);
    }
  }

  function drawObject(parent, key) {
    const o = OBJECTS[key];
    const cells = [];
    o.pixels.forEach((row, y) => [...row].forEach((ch, x) => { if (o.palette[ch]) cells.push([x, y, o.palette[ch]]); }));
    const art = make('g', { class: `art art-${key}` }, parent);
    paint(make('g', { class: 'ink' }, art), inkRings([{ name: key, cells }]).get(key));
    paint(art, cells);
    return { art, cells };
  }

  // ---------------------------------------------------------------- the scene
  const s = {
    svg: null, world: null, crabPos: null, crab: null, overlay: null, on: {},
    arts: {}, hits: {}, marks: {}, boxes: {}, skin: null,
    x: 16, target: null, rest: 1, flip: 1, size: 1, walking: false, held: false, stepT: 0, jumpT: -1,
    view: { k: 1, tx: 0, ty: 0 }, tween: null,
    weather: 'Clear', drops: [], hoverKey: null, focusKey: 'shell',
    pet: { dir: 0, turns: 0, t0: 0, lastX: 0 }, lastPinch: 0, bubbleT: 0,
    flags: { mischief: false, pinch: false, prints: false },
  };

  function layer(name) { return make('g', { class: `layer-${name}` }, s.world); }

  function drawBeach() {
    const defs = make('defs', {}, s.svg);
    defs.innerHTML = `
      <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a2a33"/><stop offset="1" stop-color="#155366"/></linearGradient>
      ${['hov:#f3e6cc', 'sel:#7fd6c2', 'warn:#ff7a5c', 'match:#ffc15e'].map(p => { const [id, c] = p.split(':'); return `
      <filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
        <feMorphology in="SourceAlpha" operator="dilate" radius="0.75" result="d"/>
        <feFlood flood-color="${c}"/><feComposite in2="d" operator="in" result="o"/>
        <feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>`; }).join('')}`;
    s.world = make('g', { class: 'world' }, s.svg);
    const bg = layer('bg');
    make('rect', { x: -40, y: -70, width: 144, height: 90, fill: 'url(#sea)' }, bg); // reaches far past the frame for tall stages
    const waves = make('g', { class: 'waves' }, bg);
    [[6, 4], [20, 9], [33, 3], [44, 13], [10, 15], [27, 16], [55, 10], [2, 11],
      // further along the shore, for when the stage is wider than the scene
      [-34, 6], [-22, 13], [-12, 3], [-28, 16], [68, 5], [80, 12], [92, 4], [98, 15], [74, 17], [-6, 9],
      [4, -4], [24, -9], [41, -3], [58, -12], [-16, -7], [76, -5], [14, -16], [47, -20], [-30, -14], [88, -18], [30, -26], [64, -24]].forEach(([x, y], i) =>
      make('rect', { x, y, width: 3 + (i % 3), height: 0.5, fill: '#2a7486', opacity: 0.55 }, waves));
    make('rect', { x: -40, y: 19, width: 144, height: 0.8, fill: '#b8f4de', opacity: 0.35, class: 'foam' }, bg);
    make('rect', { x: -40, y: 19.8, width: 144, height: 70, fill: '#8f7853' }, bg);
    make('rect', { x: -40, y: 19.8, width: 144, height: 1.6, fill: '#76623f' }, bg);
    const grain = make('g', {}, bg);
    for (let i = 0; i < 420; i++) {
      const x = ((i * 37) % 144) - 40, y = 22 + ((i * 53) % 36);
      make('rect', { x, y, width: 1, height: 0.5, fill: i % 3 ? '#a38c66' : '#7e6947' }, grain);
    }
    s.sun = make('g', { class: 'sun', hidden: '' }, bg);
    paint(s.sun, [[3, 2], [4, 2], [5, 2], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [3, 4], [4, 4], [5, 4]].map(([x, y]) => [x, y, '#ffc15e']));
    s.window = make('g', { class: 'window', hidden: '' }, bg);
    make('rect', { x: 10, y: 3, width: 11, height: 9, fill: '#1d3b44', stroke: '#b3a892', 'stroke-width': 0.6 }, s.window);
    make('rect', { x: 10.3, y: 3.3, width: 10.4, height: 1.6, fill: '#2a5a66' }, s.window);
    make('rect', { x: 19, y: 3.6, width: 1, height: 1, fill: '#ff7a5c' }, s.window);
    make('rect', { x: 17.6, y: 3.6, width: 1, height: 1, fill: '#b3a892' }, s.window);
    [6.2, 7.8, 9.4].forEach((y, i) => make('rect', { x: 11.2, y, width: 6 - i * 1.5, height: 0.6, fill: '#3d7f8c' }, s.window));
    s.prints = layer('prints');
    s.objects = layer('objects');
    s.helpers = layer('helpers');
    s.crabPos = make('g', { class: 'crab' }, s.world);
    s.pals = layer('pals');
    s.weatherG = layer('weather');
  }

  function buildCrab(skin) {
    s.skin = skin;
    s.crabPos.innerHTML = '';
    const { arts, cells } = drawCrab(s.crabPos, skin);
    Object.assign(s.arts, arts);
    // His things: headphones, shades and a keyboard, off until a setting asks.
    s.phones = make('g', { class: 'kit', hidden: '' }, s.crabPos);
    paint(s.phones, [[12, -1, '#2b2b3a'], [13, -2, '#2b2b3a'], [14, -2, '#2b2b3a'], [15, -2, '#2b2b3a'], [16, -2, '#2b2b3a'], [17, -2, '#2b2b3a'], [18, -1, '#2b2b3a'],
      [12, 0, '#ff5a4a'], [12, 1, '#ff5a4a'], [18, 0, '#ff5a4a'], [18, 1, '#ff5a4a']]);
    s.shades = make('g', { class: 'kit', hidden: '' }, s.crabPos);
    paint(s.shades, [[13, 0, '#111'], [14, 0, '#111'], [15, 0, '#111'], [16, 0, '#111'], [17, 0, '#111'], [13, 1, '#111'], [14, 1, '#333'], [16, 1, '#111'], [17, 1, '#333']]);
    s.keys = make('g', { class: 'kit keyboard', hidden: '' }, s.crabPos);
    make('rect', { x: 18, y: 11.4, width: 7, height: 1.6, fill: '#2a3b44' }, s.keys);
    for (let i = 0; i < 6; i++) make('rect', { x: 18.5 + i * 1.05, y: 11.8, width: 0.7, height: 0.7, fill: '#b3a892', class: 'key' }, s.keys);
    // Hit areas, a little bigger than each part, and the coral "changed" dots.
    for (const key of HIT_ORDER) {
      const own = key === 'legs' ? ['legs-a', 'legs-b'] : CRAB_TARGETS[key];
      const b = boxOf(own.flatMap(p => cells[p] || []));
      s.boxes[key] = b;
      addHit(s.crabPos, key, b, 0.5);
    }
    for (const key of Object.keys(CRAB_TARGETS)) addMark(s.crabPos, key, s.boxes[key]);
    applyClasses();
    placeCrab();
  }

  function buildObjects() {
    for (const key of Object.keys(OBJECTS)) {
      const o = OBJECTS[key];
      const g = make('g', { class: `obj obj-${key}`, transform: `translate(${o.x} ${o.y})` }, s.objects);
      const { art, cells } = drawObject(g, key);
      s.arts[key] = art;
      s.boxes[key] = boxOf(cells);
      if (key === 'jar') {
        s.bug = make('g', { class: 'bug' }, art);
        paint(s.bug, [[2, 4, '#ffc15e'], [3, 4, '#ffc15e'], [4, 4, '#3a2a10'], [2, 5, '#3a2a10'], [4, 5, '#3a2a10']]);
      }
      addHit(g, key, s.boxes[key], 1);
      addMark(g, key, s.boxes[key]);
    }
  }

  function addHit(parent, key, b, pad) {
    const r = make('rect', {
      class: 'hit', 'data-key': key, x: b.x0 - pad, y: b.y0 - pad, width: b.x1 - b.x0 + pad * 2, height: b.y1 - b.y0 + pad * 2,
      role: 'button', tabindex: key === s.focusKey ? 0 : -1, 'aria-label': PAH.areaLabel ? PAH.areaLabel(key) : key,
    }, parent);
    s.hits[key] = r;
  }

  function addMark(parent, key, b) {
    s.marks[key] = make('rect', { class: 'mark', x: b.x1, y: b.y0 - 1.6, width: 1, height: 1, fill: '#ff7a5c', stroke: INK, 'stroke-width': 0.25, hidden: '' }, parent);
  }

  // ---------------------------------------------------------------- state -> picture
  const cls = { hover: null, sel: null, match: new Set(), changed: new Set(), warn: false };

  function applyClasses() {
    for (const [key, art] of Object.entries(s.arts)) {
      art.classList.toggle('hover', cls.hover === key);
      art.classList.toggle('sel', cls.sel === key);
      art.classList.toggle('match', cls.match.has(key));
    }
    s.arts.claw?.classList.toggle('warn', cls.warn);
    for (const [key, m] of Object.entries(s.marks)) m.toggleAttribute('hidden', !cls.changed.has(key) || !!cls.sel);
  }

  function placeCrab() {
    const lift = s.jumpT >= 0 ? -Math.sin(Math.PI * s.jumpT) * 6 : 0;
    const k = s.size;
    s.crabPos.setAttribute('transform',
      `translate(${s.x.toFixed(2)} ${FEET - PIVOT.y + lift}) translate(${PIVOT.x} ${PIVOT.y}) scale(${k * s.flip} ${k}) translate(${-PIVOT.x} ${-PIVOT.y})`);
  }

  function applyView() {
    const { k, tx, ty } = s.view;
    s.world.setAttribute('transform', `translate(${tx} ${ty}) scale(${k})`);
  }

  // The area's box in world units, wherever he's standing.
  function worldBox(key) {
    const hit = s.hits[key];
    const m = s.world.getCTM().inverse().multiply(hit.getCTM());
    const b = hit.getBBox();
    const pts = [[b.x, b.y], [b.x + b.width, b.y + b.height]].map(([x, y]) => {
      const p = s.svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(m);
    });
    return { x: Math.min(pts[0].x, pts[1].x), y: Math.min(pts[0].y, pts[1].y), w: Math.abs(pts[1].x - pts[0].x), h: Math.abs(pts[1].y - pts[0].y) };
  }

  function zoomTo(key) {
    let next = { k: 1, tx: 0, ty: 0 };
    if (key) {
      const b = worldBox(key);
      // A tall stage (the wide layouts) already shows him big, and only 64 units across: zoom gently.
      const tall = s.svg.clientWidth / Math.max(1, s.svg.clientHeight) < ZOOM.tallAspect;
      const k = Math.max(ZOOM.min, Math.min(tall ? ZOOM.tallMax : ZOOM.max, VB.w * 0.42 / b.w, VB.h * 0.5 / b.h));
      next = { k, tx: VB.w / 2 - k * (b.x + b.w / 2), ty: VB.h * 0.52 - k * (b.y + b.h / 2) };
    }
    if (REDUCED) { s.view = next; applyView(); return; }
    s.tween = { from: { ...s.view }, to: next, t0: performance.now() };
  }

  // A point in his own sprite cells, in stage pixels (for bubbles and particles).
  function stagePoint(el, x, y) {
    const p = s.svg.createSVGPoint(); p.x = x; p.y = y;
    const q = p.matrixTransform(el.getScreenCTM());
    const r = s.overlay.getBoundingClientRect();
    return { x: q.x - r.left, y: q.y - r.top };
  }

  function spawn(glyph, kind, at) {
    const span = document.createElement('span');
    span.className = `fx fx-${kind}`;
    span.textContent = glyph;
    span.style.left = `${at.x}px`;
    span.style.top = `${at.y}px`;
    span.style.setProperty('--drift', `${(Math.random() * 30 - 15).toFixed(0)}px`);
    s.overlay.appendChild(span);
    span.addEventListener('animationend', () => span.remove());
    if (REDUCED) setTimeout(() => span.remove(), 1200);
  }

  // ---------------------------------------------------------------- the loop
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    walk(dt);
    if (s.jumpT >= 0) { s.jumpT += dt / 0.7; if (s.jumpT >= 1) s.jumpT = -1; }
    placeCrab();
    if (s.tween) {
      const t = Math.min(1, (now - s.tween.t0) / ZOOM.ms);
      const e = 1 - Math.pow(1 - t, 3);
      const { from, to } = s.tween;
      s.view = { k: from.k + (to.k - from.k) * e, tx: from.tx + (to.tx - from.tx) * e, ty: from.ty + (to.ty - from.ty) * e };
      applyView();
      if (t === 1) s.tween = null;
    }
    weather(dt);
    if (s.bubble && !s.bubble.hidden) placeBubble();
    requestAnimationFrame(frame);
  }

  function walk(dt) {
    const moving = s.walking && !s.held && !REDUCED;
    if (!moving) { s.crabPos.classList.remove('walking'); return; }
    if (s.target === null) {
      s.rest -= dt;
      s.crabPos.classList.remove('walking');
      if (s.rest > 0) return;
      s.target = WALK.min + Math.random() * (WALK.max - WALK.min);
    }
    const d = s.target - s.x;
    s.flip = d < 0 ? -1 : 1;
    s.x += Math.sign(d) * Math.min(Math.abs(d), WALK.speed * dt);
    s.crabPos.classList.add('walking');
    s.stepT += dt;
    if (s.stepT >= WALK.stepEvery) {
      s.stepT = 0;
      s.on.step?.();
      if (s.flags.prints) footprint();
    }
    if (Math.abs(d) < 0.05) { s.target = null; s.rest = 0.8 + Math.random() * 2; }
  }

  function footprint() {
    const x = s.x + PIVOT.x + (Math.random() * 6 - 3) * s.size;
    const r = make('rect', { x: x.toFixed(1), y: (FEET + 0.4 + Math.random()).toFixed(1), width: 0.9, height: 0.45, fill: '#5e4d33', class: 'print' }, s.prints);
    setTimeout(() => r.remove(), 3200);
  }

  function weather(dt) {
    if (s.weather !== 'Rain' && s.weather !== 'Snow') return;
    const snow = s.weather === 'Snow';
    for (const d of s.drops) {
      if (!REDUCED) {
        d.y += (snow ? 4 : 30) * dt;
        d.x += (snow ? Math.sin(d.y / 2 + d.p) * 0.06 : -0.12);
        if (d.y > FEET + 2) { d.y = -2; d.x = Math.random() * VB.w; }
      }
      d.el.setAttribute('x', d.x.toFixed(2));
      d.el.setAttribute('y', d.y.toFixed(2));
    }
  }

  // ---------------------------------------------------------------- pointer
  function svgPoint(evt) {
    const p = s.svg.createSVGPoint(); p.x = evt.clientX; p.y = evt.clientY;
    return p.matrixTransform(s.crabPos.getScreenCTM().inverse()); // in his own cells
  }

  function onMove(evt) {
    const p = svgPoint(evt);
    // His pupils follow the cursor (p is already in his own, possibly mirrored, cells).
    const gx = p.x < 15.5 ? 0 : 1;
    const gy = p.y < 0.5 ? 0 : 1;
    s.crabPos.querySelectorAll('.pupil').forEach(el => {
      el.setAttribute('x', +el.dataset.x + gx);
      el.setAttribute('y', +el.dataset.y + gy);
    });
    if (s.hoverKey === 'shell') petting(evt.clientX);
    if (s.flags.mischief && s.flags.pinch) pinch(p);
  }

  function petting(x) {
    const now = performance.now();
    const dx = x - s.pet.lastX;
    s.pet.lastX = x;
    if (Math.abs(dx) < 2) return;
    const dir = Math.sign(dx);
    if (now - s.pet.t0 > PET.windowMs) { s.pet.turns = 0; s.pet.t0 = now; }
    if (dir !== s.pet.dir) { s.pet.turns++; s.pet.dir = dir; }
    if (s.pet.turns >= PET.turns) {
      s.pet.turns = 0; s.pet.t0 = now;
      spawn('♥', 'heart', stagePoint(s.crabPos, 6, -1));
      s.on.pet?.();
    }
  }

  function pinch(p) {
    const b = s.boxes.claw;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    if (Math.hypot(p.x - cx, p.y - cy) > PINCH.reach) return;
    const now = performance.now();
    if (now - s.lastPinch < PINCH.restMs) return;
    s.lastPinch = now;
    api.snap();
    s.on.pinch?.();
  }

  function setHover(key) {
    s.hoverKey = key;
    cls.hover = key;
    applyClasses();
    s.on.hover?.(key);
  }

  function wire() {
    s.svg.addEventListener('pointermove', onMove);
    s.svg.addEventListener('pointerover', e => {
      const hit = e.target.closest('.hit');
      if (hit) setHover(hit.dataset.key);
    });
    s.svg.addEventListener('pointerout', e => {
      const hit = e.target.closest('.hit');
      if (hit && !hit.contains(e.relatedTarget)) setHover(null);
    });
    s.svg.addEventListener('pointermove', e => {
      if (s.hoverKey) s.on.tagMove?.(s.hoverKey, e);
    });
    s.svg.addEventListener('click', e => {
      const hit = e.target.closest('.hit');
      if (hit) s.on.select?.(hit.dataset.key);
    });
    s.svg.addEventListener('focusin', e => {
      const hit = e.target.closest('.hit');
      if (hit) { cls.hover = hit.dataset.key; applyClasses(); }
    });
    s.svg.addEventListener('focusout', () => { cls.hover = null; applyClasses(); });
    s.svg.addEventListener('keydown', e => {
      const hit = e.target.closest('.hit');
      if (!hit) return;
      const i = ORDER.indexOf(hit.dataset.key);
      const go = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (go) { e.preventDefault(); api.focus(ORDER[(i + go + ORDER.length) % ORDER.length]); }
      else if (e.key === 'Home') { e.preventDefault(); api.focus(ORDER[0]); }
      else if (e.key === 'End') { e.preventDefault(); api.focus(ORDER[ORDER.length - 1]); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.on.select?.(hit.dataset.key); }
    });
  }

  function placeBubble() {
    const head = stagePoint(s.crabPos, 15, -2.5);
    const w = s.overlay.clientWidth;
    const half = s.bubble.offsetWidth / 2 + 6;
    s.bubble.style.left = `${Math.min(w - half, Math.max(half, head.x))}px`;
    s.bubble.style.top = `${Math.max(s.bubble.offsetHeight + 10, head.y)}px`;
  }

  // ---------------------------------------------------------------- the API app.js uses
  const api = {
    ORDER,
    flags: s.flags, // app.js sets mischief, pinch and prints here

    init(svg, overlay, on) {
      s.svg = svg; s.overlay = overlay; s.on = on;
      drawBeach();
      buildObjects();
      s.bubble = document.createElement('div');
      s.bubble.className = 'bubble';
      s.bubble.hidden = true;
      s.bubble.setAttribute('aria-live', 'polite');
      overlay.appendChild(s.bubble);
      wire();
      applyView();
      requestAnimationFrame(frame);
    },
    setSkin(skin) { if (skin !== s.skin) buildCrab(skin); },
    setSize(label) { s.size = SIZE[label] || 1; },
    setWalking(on) { s.walking = on; },
    setHeld(on) { s.held = on; },
    setPals(n) {
      s.pals.innerHTML = '';
      PAL_X.slice(0, n).forEach((x, i) => {
        const flip = i % 2 ? -1 : 1;
        const left = flip < 0 ? x + 22 * PAL_SCALE : x;
        const g = make('g', { class: 'pal', transform: `translate(${left} ${PAL_FEET - 13 * PAL_SCALE}) scale(${flip * PAL_SCALE} ${PAL_SCALE})`, style: `animation-delay:${i * -0.4}s` }, s.pals);
        drawCrab(g, s.skin, true);
      });
    },
    helpers(side) {
      s.helpers.innerHTML = '';
      const base = s.x + PIVOT.x;
      [1, 2].forEach(i => {
        const x = side === 'Left' ? base - 11 * s.size - i * 7 : base + 11 * s.size + (i - 1) * 7;
        const g = make('g', { class: 'helper', transform: `translate(${x} ${FEET - 13 * 0.4 + 2.2}) scale(0.4)`, style: `animation-delay:${i * 0.12}s` }, s.helpers);
        drawCrab(g, s.skin, true);
      });
      setTimeout(() => { s.helpers.innerHTML = ''; }, 2800);
    },
    setKit({ phones, shades, keys }) {
      s.phones?.toggleAttribute('hidden', !phones);
      s.shades?.toggleAttribute('hidden', !shades);
      s.keys?.toggleAttribute('hidden', !keys);
    },
    setWeather(kind) {
      if (kind === s.weather) return;
      s.weather = kind;
      s.weatherG.innerHTML = '';
      s.drops = [];
      s.sun.toggleAttribute('hidden', kind !== 'Sun');
      if (kind !== 'Rain' && kind !== 'Snow') return;
      const n = kind === 'Rain' ? 46 : 34;
      for (let i = 0; i < n; i++) {
        const el = kind === 'Rain'
          ? make('rect', { width: 0.18, height: 1.3, fill: '#8ecae6', opacity: 0.7 }, s.weatherG)
          : make('rect', { width: 0.5, height: 0.5, fill: '#f3f7ff', opacity: 0.9 }, s.weatherG);
        s.drops.push({ el, x: Math.random() * VB.w, y: Math.random() * (FEET + 2) - 2, p: Math.random() * 6 });
      }
    },
    setWindow(on) { s.window.toggleAttribute('hidden', !on); },
    setBug(on) { s.bug?.toggleAttribute('hidden', !on); },
    setClaw(power) {
      s.arts.claw?.classList.toggle('raised', power !== 'Ask first' && power !== 'Plan only');
      cls.warn = power === 'Autonomous';
      applyClasses();
    },
    setChanged(key, on) { if (on) cls.changed.add(key); else cls.changed.delete(key); applyClasses(); },
    setMatches(keys) { cls.match = new Set(keys); applyClasses(); },
    highlight(key) { cls.hover = key; applyClasses(); },
    select(key) {
      cls.sel = key;
      s.held = !!key;
      applyClasses();
      zoomTo(key);
    },
    focus(key) {
      s.focusKey = key;
      for (const [k, h] of Object.entries(s.hits)) h.setAttribute('tabindex', k === key ? 0 : -1);
      s.hits[key]?.focus();
    },
    hop() { if (!REDUCED) s.jumpT = 0; },
    snap() { restart(s.arts.claw, 'snap'); },
    tap() {
      restart(s.arts.claw, 'tap');
      const keys = s.keys?.querySelectorAll('.key');
      if (keys?.length) restart(keys[Math.floor(Math.random() * keys.length)], 'lit');
    },
    bob(key) { restart(s.arts[key], 'bob'); },
    burst(glyph, kind, n = 1) {
      for (let i = 0; i < n; i++) setTimeout(() => spawn(glyph, kind, stagePoint(s.crabPos, 8 + Math.random() * 8, -1)), i * 110);
    },
    say(text, ms) {
      s.bubble.textContent = text;
      s.bubble.hidden = false;
      placeBubble();
      restart(s.bubble, 'pop');
      clearTimeout(s.bubbleT);
      s.bubbleT = setTimeout(() => { s.bubble.hidden = true; }, ms || Math.max(1600, text.length * 70));
    },
    /** A small picture of one area, for the list and the panel heading. */
    icon(key, skin) {
      const svg = make('svg', { class: 'icon', 'aria-hidden': 'true', 'shape-rendering': 'crispEdges' });
      let b;
      if (OBJECTS[key]) { drawObject(svg, key); b = s.boxes[key]; }
      else {
        const { arts, cells } = drawCrab(svg, skin || s.skin);
        for (const [k, a] of Object.entries(arts)) if (k !== key) a.remove();
        const own = key === 'legs' ? ['legs-a', 'legs-b'] : CRAB_TARGETS[key];
        b = boxOf(own.flatMap(p => cells[p] || []));
      }
      const side = Math.max(b.x1 - b.x0, b.y1 - b.y0) + 2;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      svg.setAttribute('viewBox', `${cx - side / 2} ${cy - side / 2} ${side} ${side}`);
      return svg;
    },
    /** The whole crab, small, for the skin picker. */
    portrait(skin) {
      const svg = make('svg', { class: 'portrait', viewBox: '-1 -1 24 15', 'aria-hidden': 'true', 'shape-rendering': 'crispEdges' });
      drawCrab(svg, skin);
      return svg;
    },
  };

  function restart(el, name) {
    if (!el) return;
    el.classList.remove(name);
    void el.getBoundingClientRect();
    el.classList.add(name);
  }

  PAH.scene = api;
})(window.PAH);
