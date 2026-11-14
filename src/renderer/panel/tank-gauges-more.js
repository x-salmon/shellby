/* Shellby panel — three more of his tank's live decor (src/main/tank/gauges.js
   decides what they show): the tide gauge, a depth staff planted on the left of
   the tank (how much of the 5-hour usage window is left), the Sunken Chest glinting for a
   minute when a PR of yours merges, and a message in a bottle bobbing at the
   surface while a recap or a weekly card waits unread. tank-gauges.js calls
   in from its own painting and words; nothing here runs on a timer. Loaded
   after tank-gauges.js. */
'use strict';
(function () {
  // The tide staff: a harbour depth post planted in the sand on the left of the
  // tank, beside the glass's highlight. Ten painted bands, one per tenth of the
  // window (tideOf moves in tenths), with a cork float riding the level.
  const STAFF = { x: 4, top: 7, sink: 2, bands: 10, lowAt: 20 };
  const STAFF_INK = {
    red: '#c8463d', white: '#efe6cf', warn: '#ff7a50', wood: '#7a5c3a', edge: '#3b2e20',
    cap: '#c9a24a', capLit: '#e8c46a', foam: '#ffffff', foamLow: '#ffd2b8',
    cork: '#e85d4a', corkLow: '#ff9f43', corkBelly: '#fff6d8', line: '#d8d2c0',
  };
  const DRY = 0.32; // bands above the tide: faded, used up
  const CHEST = 'sunken-chest';
  const GLINT = [[4, 1], [1, 2], [7, 3], [6, 1]]; // where on the chest the glint lands, in turn
  const BOTTLE = { glass: '#6fcf97', dark: '#3f8f63', paper: '#fff6d8', cork: '#a87a45' };

  const clampLeft = left => Math.max(0, Math.min(100, Number(left) || 0));

  /**
   * Where the staff's parts go for a reading, in art pixels: the rows it spans,
   * the waterline's row, whether it's running low, and each band from the
   * bottom up ({ y, h, red, wet }).
   */
  function staffOf(world, left) {
    const pct = clampLeft(left);
    const bottom = world.sandTop - STAFF.sink, span = bottom - STAFF.top;
    const rowAt = f => bottom - Math.round(span * f);
    const level = rowAt(pct / 100);
    const bands = Array.from({ length: STAFF.bands }, (_, i) => {
      const y = rowAt((i + 1) / STAFF.bands);
      return { y, h: rowAt(i / STAFF.bands) - y, red: i % 2 === 0, wet: y >= level };
    });
    return { bottom, span, level, half: rowAt(0.5), low: pct <= STAFF.lowAt, bands };
  }

  function px(ctx, color, x, y, w, h, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function tide(ctx, world, tg, t, still) {
    if (!tg) return;
    const s = staffOf(world, tg.left), x = STAFF.x, k = STAFF_INK;
    px(ctx, k.edge, x - 1, STAFF.top - 2, 5, world.sandTop - STAFF.top + 5, 0.55); // its outline
    for (const b of s.bands) {
      const paint = b.red ? (s.low && b.wet ? k.warn : k.red) : k.white;
      px(ctx, paint, x, b.y, 2, b.h, b.wet ? 1 : DRY);
      px(ctx, '#000000', x + 2, b.y, 1, b.h, b.wet ? 0.25 : 0.4); // the shaded side
    }
    px(ctx, k.wood, x, s.bottom, 3, world.sandTop - s.bottom + 3); // planted in the sand
    px(ctx, k.cap, x - 1, STAFF.top - 2, 5, 2);
    px(ctx, k.capLit, x - 1, STAFF.top - 2, 3, 1);
    px(ctx, k.foam, x - 1, s.half, 1, 1, 0.6); // the half mark
    // Foam round the staff at the level, with a ripple either side.
    const sway = still ? 0 : Math.sin(t * 2.2);
    const wob = Math.round(sway);
    px(ctx, s.low ? k.foamLow : k.foam, x - 1, s.level, 5, 1, 0.85);
    px(ctx, k.foam, x - 3 + wob, s.level, 1, 1, 0.45);
    px(ctx, k.foam, x + 5 - wob, s.level, 1, 1, 0.45);
    // The cork float on its short line, bobbing a pixel.
    const fy = s.level - 2 + (sway > 0.5 ? 0 : 1);
    px(ctx, k.line, x + 3, s.level, 2, 1, 0.6);
    px(ctx, s.low ? k.corkLow : k.cork, x + 5, fy, 3, 1);
    px(ctx, k.corkBelly, x + 5, fy + 1, 3, 1);
    px(ctx, k.foam, x + 6, fy - 1, 1, 1, 0.9); // its flag
    ctx.globalAlpha = 1;
  }

  // A four-point sparkle hopping round each chest.
  function glint(ctx, scene, t, still) {
    const [dx, dy] = GLINT[still ? 0 : Math.floor(t * 3) % GLINT.length];
    ctx.fillStyle = '#ffffff';
    for (const p of scene.pieces) {
      if (p.ref !== CHEST) continue;
      const x = p.x + (p.flip ? p.w - 1 - dx : dx), y = p.y - p.h + 1 + dy;
      ctx.globalAlpha = 0.95;
      ctx.fillRect(x, y, 1, 1);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1);
      ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // A bottle on its side, bobbing at the surface a third of the way in.
  function bottle(ctx, world, t, still) {
    const x = Math.round(world.w / 3), y = 2 + (still ? 0 : Math.round(Math.sin(t * 1.6)));
    ctx.fillStyle = BOTTLE.dark;
    ctx.fillRect(x + 1, y, 4, 1);
    ctx.fillRect(x + 1, y + 2, 4, 1);
    ctx.fillStyle = BOTTLE.glass;
    ctx.fillRect(x, y + 1, 1, 1);
    ctx.fillRect(x + 4, y + 1, 2, 1);
    ctx.fillStyle = BOTTLE.paper;
    ctx.fillRect(x + 1, y + 1, 3, 1);
    ctx.fillStyle = BOTTLE.cork;
    ctx.fillRect(x + 6, y + 1, 1, 1);
  }

  function over(ctx, scene, gg, t, still) {
    tide(ctx, scene.world, gg.tide, t, still);
    if (gg.chest) glint(ctx, scene, t, still);
    if (gg.bottle) bottle(ctx, scene.world, t, still);
  }

  function words(gg) {
    const parts = [];
    if (gg.tide) parts.push(`The tide gauge shows ${gg.tide.left}% of your 5-hour window left.`);
    if (gg.chest) parts.push('The chest is glinting: a pull request of yours just merged.');
    if (gg.bottle) parts.push(gg.bottle === 'week' ? 'A message in a bottle: your weekly card is ready.' : 'A message in a bottle: there’s a recap of while you were away.');
    return parts.join(' ');
  }

  const api = { over, words, staffOf, STAFF };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else SB.tankGaugesMore = api;
})();
