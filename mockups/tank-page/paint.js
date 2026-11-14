/* Mockup painter: the real decor and crab (data.js), laid out with the app's own
   geometry (src/main/tank/index.js: SAND 12, rows 9/5/1 up from the bottom,
   floats at 16/24/32). One canvas pixel is one art pixel; CSS scales it. */
/* global window, document, matchMedia, location, requestAnimationFrame */
'use strict';
(function () {
  const { decor, crab } = window.TANK_DATA;
  const ART = new Map(decor.map(d => [d.id, d]));
  const SAND = 12;
  const ROW_DEPTH = [9, 5, 1];
  const FLOAT_Y = [16, 24, 32];
  const WATER = {
    day: { top: '#3fa3b3', low: '#145463', rays: 0.1 },
    dusk: { top: '#7a5a73', low: '#1f3446', rays: 0.04 },
    night: { top: '#163b4f', low: '#06141c', rays: 0 },
  };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || /[?&]still/.test(location.search);

  const frameOf = (a, t) => {
    if (!a.frames || !a.frames.length || still) return a.pixels;
    const all = [a.pixels, ...a.frames];
    return all[Math.floor(t * (a.fps || 3)) % all.length];
  };

  function sprite(ctx, palette, rows, x, top, flip, alpha = 1) {
    ctx.globalAlpha = alpha;
    const w = rows[0].length;
    rows.forEach((line, r) => {
      for (let c = 0; c < line.length; c++) {
        const col = palette[line[c]];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x + (flip ? w - 1 - c : c), top + r, 1, 1);
      }
    });
    ctx.globalAlpha = 1;
  }

  /** Where each piece stands, in art pixels: { id, x, y, w, h }. */
  function boxes(scene) {
    return scene.pieces.map(p => {
      const a = ART.get(p.id);
      const w = a.pixels[0].length, h = a.pixels.length;
      const base = a.layer === 'float' ? FLOAT_Y[p.row ?? 0] + h : a.layer === 'back' ? scene.h - SAND + 1 : scene.h - ROW_DEPTH[p.row ?? 1];
      return { ...p, a, w, h, top: base - h + 1, depth: a.layer === 'back' ? 0 : a.layer === 'float' ? 5 : 1 + (p.row ?? 1) };
    });
  }

  function paint(canvas, scene, t = 0) {
    const { w, h } = scene;
    if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    const water = WATER[scene.light || 'day'];
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, water.top); g.addColorStop(1, water.low);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    const back = scene.back && ART.get(scene.back);
    if (back && back.pixels.length > 1) {
      const bw = back.pixels[0].length, bh = back.pixels.length;
      for (let y = h - SAND - bh * 3; y < h - SAND; y += bh) for (let x = 0; x < w; x += bw) sprite(ctx, back.palette, back.pixels, x, y, false, 0.55);
    }
    if (water.rays) { // a couple of soft shafts of light
      ctx.fillStyle = `rgba(255,255,255,${water.rays})`;
      for (let i = 0; i < 4; i++) { const x0 = (i * 61 + 13) % w; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + 8, 0); ctx.lineTo(x0 + 26, h - SAND); ctx.lineTo(x0 + 14, h - SAND); ctx.fill(); }
    }
    const floor = ART.get(scene.floor || 'soft-sand');
    const fw = floor.pixels[0].length, fh = floor.pixels.length;
    for (let y = h - SAND; y < h; y += fh) for (let x = 0; x < w; x += fw) sprite(ctx, floor.palette, floor.pixels.slice(0, Math.min(fh, h - y)), x, y, false);

    const list = boxes(scene).sort((a, b) => a.depth - b.depth || a.x - b.x);
    const crabRows = crab.pixels;
    const cw = crabRows[0].length, chh = crabRows.length;
    const drawCrab = () => {
      if (!scene.crab) return;
      const cy = h - ROW_DEPTH[1] - chh + 1 - (scene.crab.lift || 0);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(scene.crab.x + 3, h - ROW_DEPTH[1] + 1, cw - 6, 1);
      sprite(ctx, crab.palette, crabRows, scene.crab.x, cy, scene.crab.flip, scene.crab.alpha ?? 1);
    };
    let crabDone = false;
    for (const p of list) {
      if (!crabDone && p.depth > 2) { drawCrab(); crabDone = true; }
      sprite(ctx, p.a.palette, frameOf(p.a, t + p.x * 0.07), p.x, p.top, p.flip, p.ghost ? 0.4 : 1);
      if (p.id === 'air-stone' && !still) { // bubbles rise from each air stone
        ctx.fillStyle = 'rgba(205,234,254,.85)';
        for (let i = 0; i < 6; i++) {
          const y = p.top - ((t * (scene.busy ? 30 : 12) + i * 9) % (p.top - 2));
          ctx.fillRect(p.x + 2 + Math.round(Math.sin(t * 3 + i) * 1), Math.round(y), 1, 1);
        }
      }
    }
    if (!crabDone) drawCrab();
    if (scene.light === 'night') { ctx.fillStyle = 'rgba(3,10,20,.25)'; ctx.fillRect(0, 0, w, h); }
  }

  /** Paints every canvas[data-scene], and keeps them moving unless motion is off. */
  function run(scenes) {
    const canvases = [...document.querySelectorAll('canvas[data-scene]')];
    const draw = t => canvases.forEach(c => paint(c, scenes[c.dataset.scene], t));
    draw(0);
    if (still) return;
    let last = 0;
    const loop = now => { if (now - last > 100) { last = now; draw(now / 1000); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  /** A single piece on its own canvas (tray tiles, collection cards). */
  function piece(canvas, id, { silhouette = false } = {}) {
    const a = ART.get(id);
    canvas.width = a.pixels[0].length; canvas.height = a.pixels.length;
    const ctx = canvas.getContext('2d');
    const pal = silhouette ? Object.fromEntries(Object.keys(a.palette).map(k => [k, '#2c4a54'])) : a.palette;
    sprite(ctx, pal, a.pixels, 0, 0, false);
  }

  window.TankMock = { ART, boxes, paint, run, piece, crabSize: [crab.pixels[0].length, crab.pixels.length] };
})();
