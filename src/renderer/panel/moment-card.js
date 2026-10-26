/* Shellby panel — moment cards: one 1200x630 PNG for a single moment worth
   showing someone (a sparkly find, a tide event's medal, the friends' board, a
   hatched egg, a trophy, a level, a molt, a sticker, a rare catch, a streak, a
   skin you painted), in the crab card's look (card.js's kit). Each caller says
   what the moment was; this draws the big art, the words and the footer.

   Two ways in. The first four kinds are drawn from a moment the caller puts
   together ({ eyebrow, title, sub, art, stats, say, ... }). The rest are built
   here from what the panel already has when it celebrates (FROM below), so a
   celebration only says which kind and passes its event. Either way the post
   text comes from POST_TEXT, in the crab's voice, with one #Shellby and the
   link the footer shows. */
'use strict';
(function () {
  const K = SB.cardKit;
  const { W, H, C } = K;
  const { state } = SB;
  const HEX = /^#[0-9a-f]{6}$/i;
  // Every kind of moment card, in the order the e2e check draws them (main names the file after it).
  const MOMENT_KINDS = Object.freeze(['shiny', 'medal', 'board', 'egg', 'trophy', 'level', 'molt', 'sticker', 'catch', 'streak', 'skin']);
  const LINK = 'https://github.com/x-salmon/shellby';
  const TAG = '#Shellby';
  const TAGLINE = 'A pixel hermit crab that runs Claude Code on my desktop.';
  const POST_MAX = 200;
  const fmt = n => Number(n || 0).toLocaleString();
  const plural = (n, one, many) => SB.plural(n, one, many, fmt);
  // A name in a post: short enough that the post keeps its link.
  const nm = (s, n = 40) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

  // ------------------------------------------------------------ the post

  /**
   * What each kind of card says when you post it: the moment in the crab's
   * voice, from the facts its moment carries (m.say). postFor adds the
   * tagline when there's room, then #Shellby and the link.
   */
  const POST_TEXT = Object.freeze({
    shiny: s => `✨ My Shellby just ${s.bug ? 'jarred' : 'dug up'} a SPARKLY ${nm(s.name)}. 1 in ${fmt(s.odds)}, after ${plural(s.after || 0, s.bug ? 'bug' : 'find')}.`,
    medal: s => `${s.emoji || '🏅'} Finished ${nm(s.name)} with my Shellby. Every goal, while it was on.`,
    board: s => `🦀 ${nm(s.month, 20)} on the friends' board: ${s.place ? `${SB.ordinal(s.place)} of ${fmt(s.of)}` : `${fmt(s.of)} crabs`}, with ${plural(s.bugs || 0, 'bug')} Claude fixed and my Shellby jarred.`,
    egg: s => (s.baby
      ? `🐣 ${nm(s.baby, 30)} hatched! ${s.by ? `@${nm(s.by, 39)} hatched my Shellby’s egg.` : `I hatched @${nm(s.from, 39)}’s Shellby egg.`}`
      : `🥚 My Shellby laid an egg. First to hatch it gets a baby crab: install Shellby and paste ${nm(s.code, 24)}`),
    trophy: s => `🏆 My Shellby just unlocked ${nm(s.name)}.${s.of ? ` That's ${fmt(s.have)} of ${fmt(s.of)} trophies.` : ''}`,
    level: s => `⭐ My Shellby just reached level ${fmt(s.level)}${s.title ? `: ${nm(s.title, 32)}` : ''}.`,
    molt: s => `🐚 Shellby just molted into the ${nm(s.shell, 36)} 🦀 Molt ${nm(s.badge || fmt(s.n), 8)}: level 1 again, with everything he had.`,
    sticker: s => `🏷️ A new ${s.tier ? `${String(s.tier).toLowerCase()} ` : ''}sticker on my Shellby's shell${s.name ? ` for ${nm(s.name, 32)}` : ''}. Every project I ship gets one.`,
    catch: s => `🫙 My Shellby just jarred a ${s.rarity === 'legendary' ? 'LEGENDARY' : 'rare'} ${nm(s.name, 32)}. Claude fixed it, so it's in his Bugdex.`,
    streak: s => `🔥 ${fmt(s.days)} days in a row with my Shellby.`,
    skin: s => `🎨 I painted a Shellby skin: ${nm(s.name, 32)}${s.author ? ` by ${nm(s.author, 24)}` : ''}.`,
  });

  /** The whole post for a moment: always under POST_MAX characters, link included. */
  function postFor(kind, say = {}) {
    const said = (POST_TEXT[kind] || (() => 'My Shellby 🦀'))(say || {});
    const end = ` ${TAG} ${LINK}`;
    for (const text of [`${said} ${TAGLINE}`, said]) if (text.length + end.length < POST_MAX) return text + end;
    return `${said.slice(0, POST_MAX - end.length - 2).trimEnd()}…${end}`;
  }

  // ------------------------------------------------------------ drawing

  /** Pixel art (gifts.js format) on the canvas, each pixel `px` square. */
  function drawPixels(ctx, pixels, palette, x, y, px) {
    pixels.forEach((row, j) => [...row].forEach((ch, i) => {
      const c = palette?.[ch];
      if (ch === '.' || !HEX.test(c || '')) return;
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x + i * px), Math.round(y + j * px), Math.ceil(px), Math.ceil(px));
    }));
  }

  /** The biggest whole-pixel scale that fits the art in a box. */
  const scaleFor = (pixels, box) => Math.max(4, Math.floor(box / Math.max(pixels.length, ...pixels.map(r => r.length))));
  const artSize = art => ({ w: Math.max(...art.pixels.map(r => r.length)), h: art.pixels.length });

  /** Pixel art centred on (cx, cy), as big as fits `fit` (at least `min` a pixel). Returns its box. */
  function drawArtAt(ctx, art, cx, cy, fit, min = 2) {
    if (!art?.pixels?.length) return null;
    const { w, h } = artSize(art);
    const px = Math.max(min, Math.floor(fit / Math.max(w, h)));
    const x = Math.round(cx - (w * px) / 2), y = Math.round(cy - (h * px) / 2);
    drawPixels(ctx, art.pixels, art.palette, x, y, px);
    return { x, y, w: w * px, h: h * px, px };
  }

  // An SVG sprite (shared/sprite.js) as an image, scaled by a whole number to fit.
  async function spriteImage(svg, maxW, maxH) {
    const [, , vw, vh] = (svg.getAttribute('viewBox') || '0 0 22 13').split(' ').map(Number);
    const k = Math.max(1, Math.floor(Math.min(maxW / vw, maxH / vh)));
    const w = Math.round(vw * k), h = Math.round(vh * k);
    return { img: await K.svgImage(svg, w, h), w, h };
  }

  // A starfield of little four-point glints, placed the same way every time,
  // never in the card's quiet box (where its words are).
  function drawGlints(ctx, accent, quiet, n = 34) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < n * (w * h) / (W * H); i++) {
      const x = rnd() * w, y = rnd() * (h - 80), s = 2 + Math.floor(rnd() * 3);
      if (x > quiet.x0 && x < quiet.x1 && y > quiet.y0 && y < quiet.y1) continue;
      ctx.fillStyle = i % 3 ? 'rgba(255,255,255,.55)' : accent;
      ctx.fillRect(x, y - s, s / 2 + 1, s * 2 + 1);
      ctx.fillRect(x - s, y, s * 2 + 1, s / 2 + 1);
    }
  }

  // A soft halo of the accent behind the art.
  function drawHalo(ctx, box, accent) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, r = Math.max(box.w, box.h);
    const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, r * 0.62);
    halo.addColorStop(0, `${accent}55`);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(box.x - 60, box.y - 60, box.w + 120, box.h + 120);
  }

  // Tiles of pictures (a skin's poses): each one's picture over its name.
  function drawPictureTiles(ctx, tiles, x0, colW, ty, th, accent) {
    const gap = 14, tw = (colW - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach((t, i) => {
      const x = x0 + i * (tw + gap);
      K.roundRect(ctx, x, ty, tw, th, 16);
      ctx.fillStyle = 'rgba(17,35,42,.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(127,214,194,.12)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillRect(x + 18, ty + th - 4, tw - 36, 2);
      const room = { w: tw - 20, h: th - 44 };
      const k = Math.min(1, room.w / t.w, room.h / t.h);
      ctx.drawImage(t.img, Math.round(x + (tw - t.w * k) / 2), Math.round(ty + 10 + (room.h - t.h * k) / 2), Math.round(t.w * k), Math.round(t.h * k));
      ctx.fillStyle = C.sandDim;
      ctx.textAlign = 'center';
      ctx.fillText(K.fitText(ctx, t.label, tw - 20, '16px "Atkinson Hyperlegible"'), x + tw / 2, ty + th - 14);
      ctx.textAlign = 'left';
    });
  }

  // Where things go on each size of card. Wide: the art at the left, the words
  // and a row of tiles at the right. Square: the art on top (about 60% of it),
  // then the words centred, then the tiles two to a row.
  const LAYOUTS = Object.freeze({
    wide: {
      art: { x: 70, y: 70, w: 380, h: 380 }, align: 'left', x: 520, maxW: 620,
      eyebrow: 130, title: 210, sub: 258, badge: 286,
      tiles: { x: 520, y: 360, w: 620, h: 128, perRow: 4 }, quiet: { x0: 500, x1: W - 30, y0: 90, y1: 500 },
    },
    square: {
      art: { x: 300, y: 44, w: 480, h: 480 }, align: 'center', x: 540, maxW: 936,
      eyebrow: 632, title: 700, sub: 744, badge: 540,
      tiles: { x: 72, y: 774, w: 936, h: 100, perRow: 2 }, quiet: { x0: 40, x1: 1040, y0: 590, y1: 1000 },
    },
  });

  /** The art in its box: a painter of its own (m.paint), or pixel art (m.art). t: a clip's frame (0..1). */
  async function drawArt(ctx, m, box, t) {
    if (typeof m.paint === 'function') return m.paint(ctx, box, t);
    if (!m.art?.pixels?.length) return null;
    const px = scaleFor(m.art.pixels, Math.min(box.w, box.h) * 0.78);
    const { w, h } = artSize(m.art);
    return drawPixels(ctx, m.art.pixels, m.art.palette, box.x + (box.w - w * px) / 2, box.y + (box.h - h * px) / 2, px);
  }

  // Up to four tiles, as many to a row as the layout takes.
  function drawTileRows(ctx, m, T, accent) {
    const gap = 12;
    const list = m.poses?.length ? m.poses.slice(0, 4) : (m.stats || []).slice(0, 4).map(([label, value]) => [String(value), label, accent]);
    const rows = Math.ceil(list.length / T.perRow);
    for (let r = 0; r < rows; r++) {
      const row = list.slice(r * T.perRow, (r + 1) * T.perRow);
      const y = T.y + r * (T.h + gap);
      if (m.poses?.length) drawPictureTiles(ctx, row, T.x, T.w, y, T.h, accent);
      else K.drawTiles(ctx, row, T.x, T.w, y, T.h);
    }
  }

  /**
   * Draw a moment, size 'wide' (1200x630) or 'square' (1080x1080).
   *   m: { eyebrow, title, sub, art: { pixels, palette } | paint: (ctx, box, t) => Promise,
   *        accent, stats: [[label, value]] | poses: [{ label, img, w, h }], glints, badge }
   *   art: false leaves the art out (a clip draws it on each frame: moment-clip.js)
   * -> { canvas, data, box (where the art goes), accent }
   */
  async function draw(m, size = 'wide', { art = true } = {}) {
    await K.loadFonts();
    const L = LAYOUTS[size] || LAYOUTS.wide;
    const { canvas, ctx } = K.newCanvas(size);
    K.drawWater(ctx);
    const accent = HEX.test(m.accent || '') ? m.accent : C.amber;
    if (m.glints) drawGlints(ctx, accent, L.quiet);

    // The art, big, on a soft halo.
    drawHalo(ctx, L.art, accent);
    if (art) await drawArt(ctx, m, L.art);

    // The words.
    ctx.textAlign = L.align;
    ctx.fillStyle = accent;
    ctx.fillText(K.fitText(ctx, (m.eyebrow || '').toUpperCase(), L.maxW, '600 22px "Martian Mono"'), L.x, L.eyebrow);
    ctx.fillStyle = C.sand;
    ctx.fillText(K.fitText(ctx, m.title || '', L.maxW, '64px "Pixelify Sans"'), L.x, L.title);
    if (m.sub) {
      ctx.fillStyle = C.sandDim;
      ctx.fillText(K.fitText(ctx, m.sub, L.maxW, '24px "Atkinson Hyperlegible"'), L.x, L.sub);
    }
    ctx.textAlign = 'left';
    if (m.badge) {
      ctx.font = '700 20px "Atkinson Hyperlegible"';
      const bw = ctx.measureText(m.badge).width + 32;
      const bx = L.align === 'center' ? L.x - bw / 2 : L.x;
      K.roundRect(ctx, bx, L.badge, bw, 40, 20);
      ctx.fillStyle = `${accent}33`;
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillText(m.badge, bx + 16, L.badge + 27);
    }
    drawTileRows(ctx, m, L.tiles, accent);
    await K.drawFooter(ctx);
    return { canvas, data: m, box: L.art, accent };
  }

  // ------------------------------------------------------------ the new moments, from what the panel has

  const wardrobe = () => state.wardrobe || {};
  const trophyCount = () => {
    const list = wardrobe().achievements || [];
    return { have: list.filter(a => a.done).length, of: list.length };
  };
  const togetherDays = () => state.life?.bond?.days || 0;
  // His most-caught bug, for the level card.
  const topBug = () => (state.bugdex?.species || []).filter(s => s.state === 'caught').sort((a, b) => (b.caught || 0) - (a.caught || 0))[0] || null;
  // A reward as pixel art: an item's own, or an effect's fullest frame.
  const rewardArt = r => (r?.pixels ? { pixels: r.pixels, palette: r.palette } : r?.sprites ? SB.Sprite.poster(r.sprites) : null);

  // Him as he's dressed now, standing on a little shadow, as big as fits.
  async function drawCrab(ctx, box, { scale = 1, dy = 0 } = {}) {
    if (!state.skin) return null;
    const s = await spriteImage(SB.sprite(state.skin, { fit: true }), box.w * 0.9 * scale, box.h * 0.7 * scale);
    const x = Math.round(box.x + (box.w - s.w) / 2), y = Math.round(box.y + (box.h - s.h) / 2 + dy);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(box.x + box.w / 2, y + s.h - 4, s.w * 0.42, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(s.img, x, y);
    return { x, y, w: s.w, h: s.h };
  }

  // A ribbon across the bottom of the art, in his rank's colour: "LV 25".
  function drawRibbon(ctx, box, text, colour, y) {
    ctx.font = '600 34px "Pixelify Sans"';
    const tw = ctx.measureText(text).width + 64, x = box.x + (box.w - tw) / 2;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(x - 22, y); ctx.lineTo(x, y); ctx.lineTo(x, y + 52); ctx.lineTo(x - 22, y + 52); ctx.lineTo(x - 10, y + 26);
    ctx.moveTo(x + tw + 22, y); ctx.lineTo(x + tw, y); ctx.lineTo(x + tw, y + 52); ctx.lineTo(x + tw + 22, y + 52); ctx.lineTo(x + tw + 10, y + 26);
    ctx.fill();
    K.roundRect(ctx, x, y - 4, tw, 60, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(x, y + 48, tw, 8);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(text, box.x + box.w / 2, y + 38);
    ctx.textAlign = 'left';
  }

  // A big colour emoji (an icon, a flame) centred at (cx, cy).
  function drawEmoji(ctx, text, cx, cy, size) {
    ctx.fillStyle = '#fff'; // colour emoji take their alpha from fillStyle
    ctx.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, cy);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // The sticker's finish over its art (drawn at `at`): vinyl's gloss, holo's rainbow, foil's gold.
  function drawFinish(ctx, art, at, tier) {
    if (!at || !['vinyl', 'holo', 'foil'].includes(tier)) return;
    const g = ctx.createLinearGradient(at.x, at.y, at.x + at.w, at.y + at.h);
    if (tier === 'vinyl') { g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,.28)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); }
    else if (tier === 'holo') { ['#ff6b9d', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'].forEach((c, i) => g.addColorStop(i / 4, `${c}66`)); }
    else { g.addColorStop(0, 'rgba(184,134,43,.45)'); g.addColorStop(0.45, 'rgba(255,243,176,.6)'); g.addColorStop(0.55, 'rgba(242,193,78,.5)'); g.addColorStop(1, 'rgba(184,134,43,.45)'); }
    // Only over the sticker's own pixels: they're drawn again on a canvas of their own as the mask.
    const c = document.createElement('canvas');
    c.width = at.w; c.height = at.h;
    const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
    drawPixels(x, art.pixels, art.palette, 0, 0, at.px);
    x.globalCompositeOperation = 'source-atop';
    x.translate(-at.x, -at.y);
    x.fillStyle = g;
    x.fillRect(at.x, at.y, at.w, at.h);
    ctx.drawImage(c, at.x, at.y);
  }

  // Four poses for a skin's card, each a still of what the crab window animates
  // (critter.css): as he stands, waving, asleep and mid-scuttle. The same CSS
  // transforms, on the part groups shared/sprite.js already gives a pivot.
  const POSES = Object.freeze([
    { id: 'idle', label: 'idle', parts: {} },
    { id: 'wave', label: 'waving', parts: { claw: 'rotate(-40deg) translate(-1px, -2px)' } },
    { id: 'sleep', label: 'asleep', all: 'translate(0 1)', parts: { eyes: 'scaleY(.25)', stalks: 'translateY(1px)' } },
    { id: 'scuttle', label: 'scuttling', all: 'translate(0 -1)', parts: { 'legs-a': 'translateY(1px)', claw: 'rotate(-12deg)' } },
  ]);

  /** A skin in one pose, as an SVG. */
  function posed(skin, pose) {
    const svg = SB.Sprite.build(skin, { ink: true });
    for (const [part, t] of Object.entries(pose.parts)) {
      for (const g of svg.querySelectorAll(`g.part-${part}`)) g.style.transform = t;
    }
    if (pose.all) {
      const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      wrap.setAttribute('transform', pose.all);
      wrap.append(...[...svg.childNodes]);
      svg.append(wrap);
    }
    // A pixel of room all round, so a raised claw or a hop isn't cut off.
    const [x, y, w, h] = (svg.getAttribute('viewBox') || '0 0 22 13').split(' ').map(Number);
    svg.setAttribute('viewBox', `${x - 2} ${y - 2} ${w + 4} ${h + 4}`);
    return svg;
  }

  // The skin's own check: the same shape the Painter saves (palette, parts, pixels).
  const isSkin = s => !!s && Array.isArray(s.pixels) && s.pixels.length > 0 && s.pixels.every(r => typeof r === 'string')
    && s.palette && typeof s.palette === 'object';

  // A molt's shells: the old one rolled onto a shelf at the left, the new one big.
  // t (0..1, for a clip) slides the old one off and drops the new one on.
  function paintMolt(was, now) {
    return async (ctx, box, t = 1) => {
      const shelfY = box.y + box.h * 0.82;
      ctx.fillStyle = 'rgba(243,230,204,.16)';
      ctx.fillRect(box.x - 10, shelfY, box.w * 0.42, 6);
      if (was?.pixels?.length) {
        const slide = Math.min(1, t * 2); // the first half: off his back and onto the shelf
        const cx = box.x + box.w * 0.55 - slide * box.w * 0.36, cy = box.y + box.h * 0.5 + slide * (shelfY - box.h * 0.13 - box.y - box.h * 0.5);
        ctx.globalAlpha = 1 - slide * 0.35;
        drawArtAt(ctx, was, cx, cy, box.w * (0.62 - slide * 0.34));
        ctx.globalAlpha = 1;
      }
      if (now?.pixels?.length && t > 0.4) {
        const drop = Math.min(1, (t - 0.4) / 0.45); // the new one drops in, with a little bounce at the end
        const ease = drop < 1 ? 1 - (1 - drop) ** 3 : 1;
        const bounce = drop >= 1 ? 0 : Math.sin(drop * Math.PI) * 6;
        drawArtAt(ctx, now, box.x + box.w * 0.62, box.y + box.h * 0.44 - (1 - ease) * box.h * 0.7 - bounce, box.w * 0.66);
      }
    };
  }

  /**
   * Each new kind's card, from the event its celebration already has.
   * -> { m, title, alt } or null when there's no card to make (a hidden sticker, say).
   */
  const FROM = {
    // e: wardrobe:unlocked ({ achievement: { id, name, icon, description }, rewards })
    trophy(e) {
      const a = e?.achievement;
      if (!a?.name) return null;
      const t = trophyCount(), reward = (e.rewards || []).map(rewardArt).find(Boolean);
      return {
        title: `Unlocked: ${a.name}`, alt: `The ${a.name} trophy${reward ? ' and its reward' : ''}, big on a card, with your trophy count`,
        m: {
          eyebrow: '🏆 Trophy unlocked', title: `Unlocked: ${a.name}`, sub: a.description, accent: C.amber, glints: true,
          paint: async (ctx, box) => {
            drawEmoji(ctx, a.icon || '🏆', box.x + box.w * (reward ? 0.42 : 0.5), box.y + box.h * 0.46, 200);
            if (reward) {
              K.roundRect(ctx, box.x + box.w * 0.62, box.y + box.h * 0.6, box.w * 0.36, box.w * 0.36, 18);
              ctx.fillStyle = 'rgba(6,19,22,.8)';
              ctx.fill();
              drawArtAt(ctx, reward, box.x + box.w * 0.8, box.y + box.h * 0.6 + box.w * 0.18, box.w * 0.28);
            }
          },
          stats: [['trophies', `${t.have}/${t.of}`], ['his level', `Lv ${state.xp?.level || 1}`], [togetherDays() === 1 ? 'day together' : 'days together', fmt(togetherDays())]],
          say: { name: a.name, have: t.have, of: t.of },
        },
      };
    },
    // e: xp:levelup ({ level, title, rank: { name, color } })
    level(e) {
      if (!Number.isInteger(e?.level)) return null;
      const colour = HEX.test(e.rank?.color || '') ? e.rank.color : C.coral;
      const bug = topBug(), t = trophyCount();
      return {
        title: `Level ${e.level}`, alt: `Your crab as he's dressed now with a level ${e.level} ribbon, and his XP, days together, trophies and top bug`,
        m: {
          eyebrow: `⭐ Level up${e.rank?.name ? ` · ${e.rank.name} rank` : ''}`, title: `Level ${e.level}`, sub: e.title, accent: colour, glints: true,
          paint: async (ctx, box) => {
            await drawCrab(ctx, { ...box, h: box.h * 0.8 });
            drawRibbon(ctx, box, `LV ${e.level}`, colour, box.y + box.h * 0.78);
          },
          stats: [['XP', fmt(state.xp?.total || 0)], ['days together', fmt(togetherDays())], [`of ${fmt(t.of)} trophies`, fmt(t.have)], ['top bug', bug?.name || '—']],
          say: { level: e.level, title: e.title },
        },
      };
    },
    // e: { was, now, count, badge }: the shell he left, the tier shell he moved into, molts so far
    molt(e) {
      if (!e?.now?.pixels) return null;
      const stickers = state.outfit?.stickers?.length || 0;
      return {
        title: 'He molted!', alt: `The ${e.now.name || 'new'} shell beside the one he left on the shelf, with his molt count`,
        m: {
          eyebrow: `🐚 Molt ${e.badge || e.count || ''}`.trim(), title: 'He molted!', sub: e.now.name || 'A tier shell of his own', accent: '#b98cff', glints: true,
          paint: paintMolt(e.was, e.now), animated: 'molt',
          stats: [['molts so far', fmt(e.count || 1)], [stickers === 1 ? 'sticker carried over' : 'stickers carried over', fmt(stickers)], ['his level, again', 'Lv 1']],
          say: { shell: e.now.name || 'a tier shell', n: e.count || 1, badge: e.badge },
        },
      };
    },
    // e: { id } of a project in the Sticker Book. Its name only with "Shell and names"; a hidden one gets no card.
    sticker(e) {
      const p = (state.stickers?.projects || []).find(x => x.id === e?.id);
      if (!p?.art?.pixels || p.hidden || p.from) return null;
      const named = state.stickers?.card === 'names';
      const tier = p.tierName || 'Paper';
      const onShell = state.outfit?.stickers?.length || 0;
      return {
        title: 'A new sticker', alt: `${named ? `The ${p.name} sticker` : 'A sticker'}, ${tier.toLowerCase()} finish, big on a card`,
        m: {
          eyebrow: `🏷️ ${tier} sticker`, title: named ? p.name : 'A new sticker', sub: `${tier} · ${p.shells?.length ? 'on his shell' : 'in the Sticker Book'}`, accent: C.glass,
          paint: async (ctx, box) => drawFinish(ctx, p.art, drawArtAt(ctx, p.art, box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) * 0.8, 4), p.tier),
          stats: [['ships', fmt(p.ships)], ['tier', tier], [onShell === 1 ? 'sticker on his shell' : 'stickers on his shell', fmt(onShell)]],
          say: { tier, name: named ? p.name : null },
        },
      };
    },
    // e: bugdex:caught ({ id, name, rarity, pixels, palette, habitat })
    catch(e) {
      if (!e?.pixels || !['rare', 'legendary'].includes(e.rarity)) return null;
      const dex = state.bugdex, sp = dex?.species?.find(s => s.id === e.id);
      const caught = (dex?.species || []).filter(s => s.state === 'caught').length;
      return {
        title: e.name, alt: `A ${e.rarity} ${e.name} from the Bugdex, its portrait big on a card`,
        m: {
          eyebrow: e.rarity === 'legendary' ? '🫙 Legendary catch' : '🫙 Rare catch', title: e.name, sub: e.habitat ? `Lives in ${e.habitat}` : 'New to the Bugdex',
          art: { pixels: e.pixels, palette: e.palette }, accent: e.rarity === 'legendary' ? '#ffd23f' : '#9a6ad0', glints: e.rarity === 'legendary',
          stats: [['rarity', e.rarity === 'legendary' ? 'Legendary' : 'Rare'], ['caught', fmt(sp?.caught || 1)], ['Bugdex', `${caught}/${dex?.of || dex?.species?.length || caught}`]],
          say: { name: e.name, rarity: e.rarity },
        },
      };
    },
    // e: { days }: a streak of that many days in a row
    streak(e) {
      const days = Math.floor(Number(e?.days) || 0);
      if (days < 1) return null;
      const st = state.streaks || {};
      return {
        title: `${days} days in a row`, alt: `Your crab with a flame for a ${days}-day streak`,
        m: {
          eyebrow: '🔥 Streak', title: `${fmt(days)} days in a row`, sub: 'A task done every one of them', accent: '#ff9f43', glints: true,
          // The flame with the count on it, and him under it.
          paint: async (ctx, box) => {
            drawEmoji(ctx, '🔥', box.x + box.w * 0.5, box.y + box.h * 0.2, 150);
            ctx.font = '600 64px "Pixelify Sans"';
            ctx.textAlign = 'center';
            ctx.lineWidth = 8;
            ctx.strokeStyle = 'rgba(6,19,22,.85)';
            ctx.strokeText(fmt(days), box.x + box.w / 2, box.y + box.h * 0.2 + 74);
            ctx.fillStyle = C.sand;
            ctx.fillText(fmt(days), box.x + box.w / 2, box.y + box.h * 0.2 + 74);
            ctx.textAlign = 'left';
            await drawCrab(ctx, { x: box.x, y: box.y + box.h * 0.48, w: box.w, h: box.h * 0.52 });
          },
          stats: [['longest streak', fmt(Math.max(days, st.longest || 0))], ['days active', fmt(Math.max(days, wardrobe().stats?.activeDays || 0))], ['his level', `Lv ${state.xp?.level || 1}`]],
          say: { days },
        },
      };
    },
    // e: { skin, name, author } (the Painter, crab-painter.md): the skin big, four poses as tiles
    async skin(e) {
      if (!isSkin(e?.skin)) return null;
      const name = e.name || e.skin.name || 'A new skin';
      const poses = [];
      for (const p of POSES) {
        try { poses.push({ label: p.label, ...(await spriteImage(posed(e.skin, p), 220, 74)) }); } catch { /* a pose that won't draw is left out */ }
      }
      return {
        title: name, alt: `The ${name} skin, big, with four of its poses`,
        m: {
          eyebrow: '🎨 A skin I painted', title: name, sub: e.author ? `by ${e.author}` : 'for Shellby', accent: '#ff7a9c',
          paint: async (ctx, box) => {
            const s = await spriteImage(SB.Sprite.build(e.skin, { ink: true }), box.w * 0.95, box.h * 0.8);
            ctx.drawImage(s.img, Math.round(box.x + (box.w - s.w) / 2), Math.round(box.y + (box.h - s.h) / 2));
          },
          poses,
          say: { name, author: e.author },
        },
      };
    },
  };

  // ------------------------------------------------------------ share

  /**
   * Draw it, save it and show the share sheet.
   *   kind: one of MOMENT_KINDS (main names the file after it)
   *   m: the moment as drawn, or for a kind built here (FROM), what its celebration has
   *   opts: { title, alt, post } to say more than the defaults; size: 'wide' or 'square' this time
   */
  async function share(kind, m, opts = {}) {
    let built = { m, title: opts.title, alt: opts.alt };
    if (FROM[kind]) {
      built = await FROM[kind](m);
      if (!built) return SB.toast("There's no card for that one.");
    }
    const moment = built.m;
    return K.present({
      kind, draw: size => draw(moment, size), buttons: '[data-share-moment]', sizes: ['wide', 'square'], size: opts.size,
      // The sparkly reveal and the molt move: 🎞 Clip records them (moment-clip.js).
      clip: SB.momentClip?.has(kind) ? size => SB.momentClip.record(kind, moment, size) : null,
      title: opts.title || built.title || moment.title, alt: opts.alt || built.alt || moment.title,
      post: () => opts.post || postFor(kind, moment.say),
    });
  }

  /** Could this kind be made from this event? (A celebration shows its 📸 only when so.) */
  const can = (kind, e) => MOMENT_KINDS.includes(kind) && (!FROM[kind] || kind === 'skin' || !!FROM[kind](e));

  SB.momentCard = { MOMENT_KINDS, POST_TEXT, POSES, FROM, LAYOUTS, draw, drawArt, share, can, postFor, posed, drawPixels };
})();
