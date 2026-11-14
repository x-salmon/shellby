/* Five tide-gauge directions, each painted in art pixels over the real tank
   (../tank-page/paint.js). `left` is the reading tankGauges sends: 0..100 in
   tenths of the 5-hour window. Today's gauge is copied from
   src/renderer/panel/tank-gauges-more.js for side-by-side. */
/* global window */
'use strict';
(function () {
  const LOW_AT = 20;
  const BRASS = { lit: '#e8c46a', mid: '#c9a24a', dark: '#7d6230' };

  function px(ctx, color, x, y, w = 1, h = 1, a = 1) {
    ctx.globalAlpha = a; ctx.fillStyle = color; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
  }

  // 3×5 digits for the plaque in direction 3.
  const DIGITS = {
    0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 2: ['111', '001', '111', '100', '111'],
    3: ['111', '001', '011', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'],
    6: ['111', '100', '111', '101', '111'], 7: ['111', '001', '010', '010', '010'], 8: ['111', '101', '111', '101', '111'],
    9: ['111', '101', '111', '001', '111'],
  };
  function digits(ctx, text, x, y, color) {
    [...String(text)].forEach((d, i) => DIGITS[d].forEach((row, r) => [...row].forEach((on, c) => { if (on === '1') px(ctx, color, x + i * 4 + c, y + r); })));
  }

  // ------------------------------------------------------------- today
  function today(ctx, world, left) {
    const top = 6, x = 5, bottom = world.sandTop - 3, span = bottom - top;
    const fill = Math.round(span * left / 100);
    px(ctx, '#e8f6ff', x - 1, top - 1, 3, span + 2, 0.35);
    for (let q = 1; q < 4; q++) px(ctx, '#e8f6ff', x + 2, top + Math.round(span * q / 4), 1, 1, 0.35);
    px(ctx, left <= LOW_AT ? '#ff9f43' : '#5ec8f2', x, bottom - fill, 1, fill, 0.85);
    if (fill) px(ctx, '#ffffff', x, bottom - fill, 1, 1, 0.7);
  }

  // ------------------------------------------------- 1. the tide staff
  // A harbour depth staff planted in the sand: painted bands, one per tenth,
  // with a cork float riding the level and foam where it sits.
  function staff(ctx, world, left, t) {
    const x = 4, top = 7, bottom = world.sandTop - 2, span = bottom - top;
    const level = bottom - Math.round(span * left / 100);
    const low = left <= LOW_AT;
    px(ctx, '#3b2e20', x - 1, top - 2, 5, world.sandTop - top + 5, 0.55); // shadow / outline
    for (let i = 0; i < 10; i++) {
      const y1 = bottom - Math.round(span * (i + 1) / 10), y0 = bottom - Math.round(span * i / 10);
      const under = y1 >= level;
      const face = i % 2 ? '#efe6cf' : (low && under ? '#ff7a50' : '#c8463d');
      const a = under ? 1 : 0.32; // above the tide the paint is dull and dry
      px(ctx, face, x, y1, 2, y0 - y1, a);
      px(ctx, '#000000', x + 2, y1, 1, y0 - y1, 0.25 + (under ? 0 : 0.15));
    }
    px(ctx, '#7a5c3a', x, bottom, 3, world.sandTop - bottom + 3); // planted in the sand
    px(ctx, BRASS.mid, x - 1, top - 2, 5, 2); px(ctx, BRASS.lit, x - 1, top - 2, 3, 1); // cap
    px(ctx, '#ffffff', x - 1, bottom - Math.round(span / 2), 1, 1, 0.6); // half mark
    // foam ring at the level, a little ripple either side
    const wob = Math.round(Math.sin(t * 2.2));
    px(ctx, low ? '#ffd2b8' : '#ffffff', x - 1, level, 5, 1, 0.85);
    px(ctx, '#ffffff', x - 3 + wob, level, 1, 1, 0.45); px(ctx, '#ffffff', x + 5 - wob, level, 1, 1, 0.45);
    // cork float on a short line
    const fy = level - 1 + (Math.sin(t * 2.2) > 0.5 ? 0 : 1) - 1;
    px(ctx, '#d8d2c0', x + 3, level, 2, 1, 0.6);
    px(ctx, low ? '#ff9f43' : '#e85d4a', x + 5, fy, 3, 1);
    px(ctx, '#fff6d8', x + 5, fy + 1, 3, 1);
    px(ctx, '#ffffff', x + 6, fy - 1, 1, 1, 0.9); // the float's little flag
  }

  // ------------------------------------------------------ 2. low tide
  // The tank's own water goes out. 100% is a full tank; at 0% the surface
  // sits half-way down, with salt crust where the high-water mark was.
  const LOW_DEPTH = 30;
  function lowTide(ctx, world, left, t) {
    const low = left <= LOW_AT;
    const surface = 1 + Math.round((1 - left / 100) * LOW_DEPTH);
    if (surface > 1) {
      const g = ctx.createLinearGradient(0, 0, 0, surface);
      g.addColorStop(0, 'rgba(198,226,232,0.70)'); g.addColorStop(1, 'rgba(170,210,220,0.55)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, world.w, surface);
      for (let x = 0; x < world.w; x++) if ((x * 7) % 5 < 3) px(ctx, '#f4f8f4', x, 1, 1, 1, 0.55); // salt crust
      for (const [dx, len] of [[22, 3], [57, 2], [91, 4], [128, 2], [146, 3]]) px(ctx, '#e8f6ff', dx, 2, 1, Math.min(len, surface - 3), 0.5); // drips
    }
    // the surface: a moving lip and a darker band beneath it
    for (let x = 0; x < world.w; x++) {
      const up = Math.sin(x * 0.35 + t * 2) > 0.55 ? 1 : 0;
      px(ctx, low ? '#ffb27a' : '#ffffff', x, surface - up, 1, 1, 0.85);
    }
    px(ctx, '#06141c', 0, surface + 1, world.w, 1, 0.25);
    // a scale etched on the left glass so it can still be read exactly
    for (let i = 0; i <= 10; i++) {
      const y = 1 + Math.round((i / 10) * LOW_DEPTH);
      const w = i % 5 === 0 ? 3 : 1;
      px(ctx, i >= 8 ? '#ff9f43' : '#ffffff', 0, y, w, 1, 0.55);
    }
    // the bottle (when one's waiting) rides the real surface
    const bx = 60, by = surface - 1;
    px(ctx, '#3f8f63', bx + 1, by, 4, 1); px(ctx, '#3f8f63', bx + 1, by + 2, 4, 1);
    px(ctx, '#6fcf97', bx, by + 1, 1, 1); px(ctx, '#6fcf97', bx + 4, by + 1, 2, 1);
    px(ctx, '#fff6d8', bx + 1, by + 1, 3, 1); px(ctx, '#a87a45', bx + 6, by + 1, 1, 1);
  }

  // --------------------------------------------------- 3. brass tube
  function tubeColor(left) {
    if (left <= LOW_AT) return { liquid: '#ff7a50', lit: '#ffc0a3' };
    if (left <= 40) return { liquid: '#f2c14e', lit: '#fff0b8' };
    return { liquid: '#46b8e8', lit: '#bfeaff' };
  }
  function brassTube(ctx, world, left, t, still) {
    const x = 3, top = 9, bottom = world.sandTop - 5, span = bottom - top;
    const fill = Math.round(span * left / 100);
    const c = tubeColor(left);
    // glass body
    px(ctx, '#06141c', x + 1, top, 3, span + 1, 0.6);
    px(ctx, '#d6eef5', x, top, 1, span + 1, 0.55); px(ctx, '#d6eef5', x + 4, top, 1, span + 1, 0.35);
    // liquid with a highlight and a concave meniscus
    if (fill) {
      px(ctx, c.liquid, x + 1, bottom - fill + 1, 3, fill);
      px(ctx, c.lit, x + 1, bottom - fill + 2, 1, fill - 1, 0.55);
      px(ctx, c.lit, x + 1, bottom - fill + 1, 1, 1); px(ctx, c.lit, x + 3, bottom - fill + 1, 1, 1);
      px(ctx, '#06141c', x + 2, bottom - fill + 1, 1, 1, 0.5);
      if (!still) for (let i = 0; i < 2; i++) { // a couple of rising bubbles
        const by = bottom - ((t * 6 + i * 11) % Math.max(1, fill - 2));
        px(ctx, '#ffffff', x + 2 + i, Math.round(by), 1, 1, 0.7);
      }
    }
    // tenths on the right, the half mark longer
    for (let i = 1; i < 10; i++) {
      const y = bottom - Math.round(span * i / 10);
      px(ctx, '#e8f6ff', x + 5, y, i === 5 ? 2 : 1, 1, i === 5 ? 0.8 : 0.45);
    }
    // brass cap, collar and suction-cup foot
    px(ctx, BRASS.dark, x - 1, top - 3, 7, 3); px(ctx, BRASS.mid, x - 1, top - 3, 7, 2); px(ctx, BRASS.lit, x, top - 3, 4, 1);
    px(ctx, BRASS.dark, x - 1, bottom + 1, 7, 2); px(ctx, BRASS.mid, x - 1, bottom + 1, 7, 1);
    px(ctx, BRASS.dark, x - 2, bottom + 3, 9, 1);
    // the reading on a plaque by the cap
    const text = String(left), px0 = x + 7, py0 = top - 4, wd = text.length * 4 + 1;
    px(ctx, BRASS.dark, px0, py0, wd + 2, 7); px(ctx, '#0b1d24', px0 + 1, py0 + 1, wd, 5);
    digits(ctx, text, px0 + 2, py0 + 1, c.lit);
  }

  // ------------------------------------------------- 4. pearl strand
  function pearls(ctx, world, left, t, still) {
    const cx = 6, base = world.sandTop - 6, lit = Math.round(left / 10);
    const low = lit <= 2;
    const pulse = still ? 1 : 0.65 + 0.35 * Math.sin(t * 4);
    px(ctx, '#3f8f63', cx, base - 40, 1, 42, 0.7); // the strand
    px(ctx, '#6fcf97', cx - 1, base - 41, 3, 1, 0.8);
    for (let i = 0; i < 10; i++) {
      const y = base - i * 4;
      if (i < lit) {
        const body = low ? '#ffb199' : '#eef4f7', shade = low ? '#e0684a' : '#9fbccb';
        const a = low ? pulse : 1;
        px(ctx, body, cx - 1, y, 3, 1, a); px(ctx, body, cx, y - 1, 1, 3, a);
        px(ctx, body, cx - 1, y - 1, 1, 1, 0.55 * a); px(ctx, body, cx + 1, y - 1, 1, 1, 0.55 * a);
        px(ctx, shade, cx + 1, y + 1, 1, 1, 0.8 * a); px(ctx, shade, cx - 1, y + 1, 1, 1, 0.45 * a);
        px(ctx, shade, cx + 1, y, 1, 1, a); px(ctx, shade, cx, y + 1, 1, 1, a);
        px(ctx, '#ffffff', cx, y - 1, 1, 1, a);
        if (low) px(ctx, '#ff7a50', cx - 2, y - 2, 5, 5, 0.18 * pulse); // glow
      } else {
        px(ctx, '#9fc6d4', cx, y - 1, 1, 1, 0.4); px(ctx, '#9fc6d4', cx, y + 1, 1, 1, 0.4);
        px(ctx, '#9fc6d4', cx - 1, y, 1, 1, 0.4); px(ctx, '#9fc6d4', cx + 1, y, 1, 1, 0.4);
      }
    }
    // the clam they came from
    const cy = world.sandTop - 2;
    px(ctx, '#7d8fa8', cx - 4, cy, 9, 2); px(ctx, '#a8b8cc', cx - 3, cy, 7, 1);
    px(ctx, '#5a6a82', cx - 4, cy + 2, 9, 1);
    px(ctx, '#f3e6cc', cx - 1, cy - 1, 3, 1, 0.6);
  }

  // ------------------------------------------------- 5. the sand timer
  const BULB_TOP = [3, 3, 3, 2, 1, 0];   // inner half-widths, top bulb rows 1..6
  const BULB_BOT = [0, 1, 2, 3, 3, 3];   // bottom bulb rows 8..13
  const CELLS = BULB_TOP.reduce((s, h) => s + h * 2 + 1, 0);
  function fillRows(rows, n, fromBottom) {
    // which cells hold sand: rows fill from the bulb's floor, centre out
    const order = fromBottom ? rows.map((h, i) => ({ h, i })).reverse() : rows.map((h, i) => ({ h, i }));
    const out = new Map();
    for (const { h, i } of order) {
      const w = h * 2 + 1, take = Math.min(w, n);
      n -= take; out.set(i, take);
    }
    return out;
  }
  function hourglass(ctx, world, left, t, still) {
    const x = 4, cx = x + 4, foot = world.h - 2, y0 = foot - 14;
    const low = left <= LOW_AT;
    const topSand = Math.round(CELLS * left / 100);
    const SAND = ['#f3d58a', '#d8b663'], WARN = ['#ff9f43', '#d9772a'];
    px(ctx, '#000000', x + 1, foot + 1, 8, 1, 0.25); // shadow
    const bulb = (rows, rowY, fill, [sand, sandDk]) => rows.forEach((h, i) => {
      const y = rowY + i, w = h * 2 + 1;
      px(ctx, '#dff3f7', cx - h, y, w, 1, 0.16);
      px(ctx, '#dff3f7', cx - h - 1, y, 1, 1, 0.55); px(ctx, '#dff3f7', cx + h + 1, y, 1, 1, 0.3);
      const n = fill.get(i) || 0;
      if (n) px(ctx, i === rows.length - 1 || n < w ? sand : sandDk, cx - Math.floor(n / 2), y, n, 1);
    });
    bulb(BULB_TOP, y0 + 1, fillRows(BULB_TOP, topSand, true), low ? WARN : SAND);
    bulb(BULB_BOT, y0 + 8, fillRows(BULB_BOT, CELLS - topSand, true), SAND);
    const sand = low ? WARN[0] : SAND[0];
    px(ctx, '#dff3f7', cx, y0 + 7, 1, 1, 0.4); // neck
    if (!still && left > 0 && left < 100) { // a thin stream while the window runs
      const fallTo = y0 + 8 + BULB_BOT.length - 1 - Math.ceil((CELLS - topSand) / 5);
      for (let y = y0 + 7; y <= fallTo; y++) if ((y + Math.floor(t * 8)) % 2) px(ctx, sand, cx, y, 1, 1, 0.9);
    } else if (left > 0 && left < 100) px(ctx, sand, cx, y0 + 7, 1, 3, 0.9);
    // frame: brass plates and dark posts
    px(ctx, BRASS.mid, x, y0, 9, 1); px(ctx, BRASS.lit, x + 1, y0, 6, 1);
    px(ctx, BRASS.mid, x, y0 + 14, 9, 1); px(ctx, BRASS.dark, x, y0 + 15, 9, 1);
    px(ctx, '#6b4f2a', x, y0 + 1, 1, 13); px(ctx, '#6b4f2a', x + 8, y0 + 1, 1, 13);
  }

  window.TideMock = { today, staff, lowTide, brassTube, pearls, hourglass, LOW_AT };
})();
