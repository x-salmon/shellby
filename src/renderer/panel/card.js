/* Shellby panel — the shareable crab card: a PNG of Shellby as he's dressed
   right now, with trophies and task count, Wide (1200x630) or Square
   (1080x1080). Drawn on a canvas from the same pixel data as everything else;
   main saves it and copies it to the clipboard. Also the kit every other card
   is drawn with (SB.cardKit), and the share sheet they all end in (present). */
'use strict';
(function () {
  const { api, state, $ } = SB;
  const W = 1200, H = 630;
  // Wide suits X, Bluesky and LinkedIn; Square suits Discord, Mastodon and Instagram.
  const SIZES = Object.freeze({
    wide: Object.freeze({ w: W, h: H, label: 'Wide', for: 'X, Bluesky' }),
    square: Object.freeze({ w: 1080, h: 1080, label: 'Square', for: 'Discord, Instagram' }),
  });
  // The tank's box on a wide card, and how far a square card moves the words down under it.
  const TANK = Object.freeze({ x: 48, y: 48, w: 470, h: 470 });
  const SQUARE_TANK = Object.freeze({ x: 56, y: 40, w: 968, h: 400 });
  const SQUARE_DROP = 430;
  const C = {
    abyss: '#061316', reef: '#11232a', line: '#214049', sand: '#f3e6cc', sandDim: '#b3a892',
    sandFaint: '#7d7566', glass: '#7fd6c2', coral: '#ff7a5c', amber: '#ffc15e',
  };
  const REPO = 'https://github.com/x-salmon/shellby';

  // The title is the most impressive trophy earned (first match wins).
  const TITLE_ORDER = ['centurion', 'fleet', 'inventor', 'quarter-century', 'loyal', 'keep-your-cool', 'all-hands',
    'spring-cleaning', 'multitasker', 'night-owl', 'early-bird', 'tinkerer', 'planner', 'ten-tasks', 'crew-boss',
    'toolmaker', 'clockwork', 'careful', 'check-up', 'special-delivery', 'first-task'];

  function cardData() {
    const v = state.wardrobe || {};
    const done = (v.achievements || []).filter(a => a.done);
    const byId = new Map(done.map(a => [a.id, a]));
    const top = TITLE_ORDER.map(id => byId.get(id)).find(Boolean) || done[0] || null;
    const o = v.outfit || {};
    const named = [...(state.outfit?.accessories || []).map(a => a.name), state.outfit?.effect?.name].filter(Boolean);
    return {
      title: top ? top.name : 'Fresh out of the shell',
      // His temperament, and the Claude-free side of things (together.js / life.js).
      temperament: state.life?.temperament?.name || null,
      together: state.life?.bond?.days || 0,
      finds: state.life?.finds?.total || 0,
      titleIcon: top ? top.icon : '🐚',
      wearing: named,
      tasks: v.stats?.tasksCompleted ?? 0,
      helpers: v.stats?.helpersSpawned ?? 0,
      days: v.stats?.activeDays ?? 0,
      trophies: done.length,
      trophiesAll: (v.achievements || []).length,
      badges: done.map(a => a.icon),
      season: v.season?.wearing ? v.season : null,
      code: SB.outfitCode?.() || null,
      hasOutfit: !!(o && Object.values(o).some(Boolean)),
      login: state.github?.signedIn ? state.github.login : null,
      // Your own shipping (not friends' swaps), minus anything you keep off your card.
      shipped: (state.stickers?.projects || []).filter(p => !p.from).length,
      stickers: (state.stickers?.projects || []).filter(p => !p.hidden && !p.from).sort((a, b) => b.ships - a.ships).slice(0, 5),
    };
  }

  // ------------------------------------------------------------ drawing helpers

  function svgImage(svg, width, height) {
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fitText(ctx, text, maxWidth, font) {
    ctx.font = font;
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  // ------------------------------------------------------------ shared by every card (week-card.js too)

  const loadFonts = () => Promise.all(['64px "Pixelify Sans"', '600 15px "Martian Mono"', '20px "Atkinson Hyperlegible"', '700 20px "Atkinson Hyperlegible"']
    .map(f => document.fonts.load(f).catch(() => null)));

  /** A card's canvas: size 'wide' (the default) or 'square'. -> { canvas, ctx, w, h } */
  function newCanvas(size = 'wide') {
    const { w, h } = SIZES[size] || SIZES.wide;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx, w, h };
  }

  // Water: deep gradient with two soft lights, like the panel. Any size: it reads the canvas.
  function drawWater(ctx) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0f3039');
    bg.addColorStop(1, C.abyss);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    for (const [x, y, r, col] of [[180, 120, 420, 'rgba(127,214,194,.10)'], [w - 100, h + 10, 460, 'rgba(255,122,92,.08)']]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // His real tank (tank.js), when there's something in it: painted still
  // (tank-paint.js) with him in the middle row, scaled up by a whole number and
  // standing at the bottom of the box. A wide tank is cropped around its
  // biggest piece and him beside it, so he stays big enough to see. Returns
  // where its water ends.
  const CROP_W = 78; // art px: the most of a tank's width the card shows
  async function drawDecorated(ctx, box, v) {
    const P = SB.tankPaint;
    const { world } = v;
    const k = Math.max(1, Math.floor(Math.min(box.w / Math.min(world.w, CROP_W), box.h / world.h)));
    const cropW = Math.min(world.w, Math.floor(box.w / k));
    const svg = SB.sprite(state.skin, { fit: true });
    const [, , vw, vh] = (svg.getAttribute('viewBox') || '0 0 22 13').split(' ').map(Number);
    const w = Math.ceil(vw), h = Math.ceil(vh);
    const { x0, crabX } = P.framing(v, cropW, w);
    let crab = null;
    try {
      crab = { img: await svgImage(svg, w, h), w, h, x: crabX, flip: false };
    } catch { /* the tank still stands without him */ }
    const pic = P.still({ world, style: v.style, pieces: v.pieces }, crab);
    const dx = box.x + Math.round((box.w - cropW * k) / 2), dy = box.y + box.h - world.h * k;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(pic, x0, 0, cropW, world.h, dx, dy, cropW * k, world.h * k);
    return dy + world.sandTop * k;
  }

  // Today's tank: plain sand and him, big. Returns where the sand starts.
  async function drawPlain(ctx, tank) {
    ctx.fillStyle = 'rgba(127,214,194,.035)';
    for (let x = tank.x + 24; x < tank.x + tank.w; x += 24) ctx.fillRect(x, tank.y, 1, tank.h);
    // sand
    const sandY = tank.y + tank.h - 70;
    ctx.fillStyle = '#7a6a4b';
    ctx.fillRect(tank.x, sandY, tank.w, 70);
    ctx.fillStyle = '#a8946c';
    ctx.fillRect(tank.x, sandY, tank.w, 10);
    ctx.fillStyle = 'rgba(201,180,138,.55)';
    for (let i = 0; i < 90; i++) ctx.fillRect(tank.x + ((i * 53) % tank.w), sandY + 16 + ((i * 29) % 48), 4, 4);

    // The crab, as dressed now (fit frames hats and held items too).
    const svg = SB.sprite(state.skin, { fit: true });
    const [, , vw, vh] = (svg.getAttribute('viewBox') || '0 0 22 13').split(' ').map(Number);
    const P = Math.floor(Math.min(360 / vw, 300 / vh));
    const crab = await svgImage(svg, vw * P, vh * P);
    const cx = tank.x + (tank.w - vw * P) / 2;
    const cy = sandY + 14 - vh * P;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(tank.x + tank.w / 2, sandY + 18, vw * P * 0.42, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(crab, Math.round(cx), Math.round(cy));
    return sandY;
  }

  // What's in his tank, or null when it's empty (or can't be had).
  const decorated = () => (api.getTank ? api.getTank().then(v => (v?.pieces?.length ? v : null), () => null) : Promise.resolve(null));

  // Shellby's tank on the left (or across the top of a square card, tank:
  // SQUARE_TANK): his decorated tank (or plain sand) with the crab as dressed
  // now, his effect around him, and up to five stickers ({ art: { palette,
  // pixels } }) on the glass. Returns how many pieces of decor are in the picture.
  async function drawTank(ctx, glassStickers, tank = TANK) {
    const v = await decorated();
    ctx.save();
    roundRect(ctx, tank.x, tank.y, tank.w, tank.h, 26);
    ctx.fillStyle = 'rgba(6,19,22,.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(127,214,194,.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();
    const sandY = v ? await drawDecorated(ctx, tank, v) : await drawPlain(ctx, tank);

    // His equipped effect, scattered around him (snow, sparkles, bats...).
    const fx = state.outfit?.effect;
    if (fx?.sprites?.length) {
      const spots = [[0.12, 0.14], [0.82, 0.1], [0.9, 0.42], [0.07, 0.5], [0.3, 0.06], [0.62, 0.22], [0.2, 0.32], [0.74, 0.58]];
      for (let i = 0; i < spots.length; i++) {
        const s = SB.Sprite.poster([fx.sprites[i % fx.sprites.length]]);
        const pad = fx.ink ? 2 : 0; // the ink line, one pixel all round
        const sw = Math.max(...s.pixels.map(r => r.length)) + pad, sh = s.pixels.length + pad;
        const k = Math.max(5, Math.round(30 / Math.max(sw, sh)));
        const img = await svgImage(SB.Sprite.grid(s.pixels, s.palette, { ink: !!fx.ink }), sw * k, sh * k);
        ctx.drawImage(img, Math.round(tank.x + spots[i][0] * tank.w), Math.round(tank.y + spots[i][1] * (sandY - tank.y)));
      }
    }

    // Stickers slapped on the tank glass (on top of everything in it).
    const tilt = [-8, 5, -3, 7, -6];
    for (let i = 0; i < Math.min(5, glassStickers.length); i++) {
      const art = glassStickers[i].art;
      const n = Math.max(...art.pixels.map(r => r.length));
      const k = Math.floor(64 / n);
      const img = await svgImage(SB.Sprite.grid(art.pixels, art.palette), n * k, art.pixels.length * k);
      const sx = tank.x + 30 + i * ((tank.w - 60 - n * k) / Math.max(1, 4)), sy = tank.y + 24 + (i % 2) * 14;
      ctx.save();
      ctx.translate(sx + (n * k) / 2, sy + (art.pixels.length * k) / 2);
      ctx.rotate((tilt[i] * Math.PI) / 180);
      ctx.shadowColor = 'rgba(0,0,0,.4)';
      ctx.shadowOffsetY = 3;
      ctx.drawImage(img, -(n * k) / 2, -(art.pixels.length * k) / 2);
      ctx.restore();
    }
    ctx.restore();
    return v ? v.pieces.length : 0;
  }

  // Stat tiles in a row: [[number, label, accent colour], ...].
  function drawTiles(ctx, tiles, x0, colW, ty, th = 128) {
    const gap = 14, tw = (colW - gap * (tiles.length - 1)) / tiles.length;
    tiles.forEach(([num, label, col], i) => {
      const x = x0 + i * (tw + gap);
      roundRect(ctx, x, ty, tw, th, 16);
      ctx.fillStyle = 'rgba(17,35,42,.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(127,214,194,.12)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(x, ty + 18, 4, th - 36);
      ctx.fillStyle = C.sand;
      ctx.fillText(fitText(ctx, num, tw - 36, '500 46px "Martian Mono"'), x + 22, ty + th * 0.55);
      ctx.fillStyle = C.sandDim;
      ctx.fillText(fitText(ctx, label, tw - 36, '17px "Atkinson Hyperlegible"'), x + 22, ty + th * 0.8);
    });
  }

  // The footer along the bottom, whatever the card's size. The tagline goes
  // beside the link only when it fits whole.
  async function drawFooter(ctx) {
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const right = w - 56;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(6,19,22,.85)';
    ctx.fillRect(0, h - 64, w, 64);
    ctx.fillStyle = 'rgba(127,214,194,.18)';
    ctx.fillRect(0, h - 64, w, 1);
    const mini = await svgImage(SB.sprite(state.skin, { plain: true }), 22 * 2, 13 * 2);
    ctx.drawImage(mini, 48, h - 45);
    ctx.fillStyle = C.sand;
    ctx.font = '600 24px "Pixelify Sans"';
    ctx.fillText('Shellby', 104, h - 23);
    ctx.fillStyle = C.glass;
    ctx.font = '600 15px "Martian Mono"';
    ctx.textAlign = 'right';
    ctx.fillText('github.com/x-salmon/shellby', right, h - 25);
    const linkW = ctx.measureText('github.com/x-salmon/shellby').width;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.sandDim;
    const tagline = fitText(ctx, 'the pixel hermit crab that runs Claude Code on your desktop', right - linkW - 32 - 210, '17px "Atkinson Hyperlegible"');
    if (!tagline.endsWith('…')) ctx.fillText(tagline, 210, h - 25);
  }

  // ------------------------------------------------------------ the crab card

  /** The crab card, size 'wide' or 'square' (his tank across the top, the words under it). */
  async function render(cardSize = 'wide') {
    await loadFonts();
    // Fresh numbers: the panel's wardrobe view only refreshes when something unlocks.
    SB.applyWardrobe(await api.wardrobeView());
    SB.applyStickers?.(await api.getStickers());
    if (!SB.outfitCode?.()) await new Promise(r => setTimeout(r, 50));
    const d = cardData();
    const sq = cardSize === 'square';
    const { canvas, ctx, w: CW } = newCanvas(cardSize);
    drawWater(ctx);
    // His tank, with his best stickers on the glass.
    d.tankPieces = await drawTank(ctx, d.stickers, sq ? SQUARE_TANK : TANK);

    // ---- right column (on a square card, under the tank: the same rows, moved down)
    const x0 = sq ? 56 : 568, right = CW - 56, colW = right - x0;
    if (sq) ctx.translate(0, SQUARE_DROP);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.coral;
    ctx.font = '600 15px "Martian Mono"';
    const lv = state.xp ? ` · LV ${state.xp.level} ${state.xp.title.toUpperCase()}` : '';
    const whose = d.login ? `@${d.login.toUpperCase()}'S SHELLBY` : 'MY SHELLBY';
    ctx.fillText(fitText(ctx, d.season ? `${whose}${lv} · ${d.season.emoji} ${d.season.name.toUpperCase()}` : `${whose}${lv}`, colW, ctx.font), x0, 92);

    ctx.fillStyle = C.sand;
    // Shrink a long title before resorting to an ellipsis.
    let size = 54;
    ctx.font = `600 ${size}px "Pixelify Sans"`;
    while (size > 36 && ctx.measureText(`${d.titleIcon} ${d.title}`).width > colW) ctx.font = `600 ${--size}px "Pixelify Sans"`;
    ctx.fillText(fitText(ctx, `${d.titleIcon} ${d.title}`, colW, ctx.font), x0, 150);

    ctx.fillStyle = C.sandDim;
    const worn = d.wearing.length ? `wearing ${d.wearing.join(', ')}` : 'wearing nothing but a shell';
    const wearing = d.temperament ? `A ${d.temperament.toLowerCase()} crab, ${worn}` : worn.replace(/^w/, 'W');
    ctx.fillText(fitText(ctx, wearing, colW, '20px "Atkinson Hyperlegible"'), x0, 188);

    // Three stat tiles.
    const tiles = [
      // No tasks yet (just the crab, say): show the days you've had him instead of a zero.
      d.tasks || !d.together
        ? [d.tasks.toLocaleString(), d.tasks === 1 ? 'task done' : 'tasks done', C.coral]
        : [d.together.toLocaleString(), d.together === 1 ? 'day together' : 'days together', C.coral],
      [`${d.trophies}/${d.trophiesAll}`, 'trophies', C.amber],
      d.shipped
        ? [d.shipped.toLocaleString(), d.shipped === 1 ? 'project shipped' : 'projects shipped', C.glass]
        : d.helpers || !d.finds
          ? [d.helpers.toLocaleString(), d.helpers === 1 ? 'helper crab sent' : 'helper crabs sent', C.glass]
          : [d.finds.toLocaleString(), d.finds === 1 ? 'find dug up' : 'finds dug up', C.glass],
    ];
    drawTiles(ctx, tiles, x0, colW, 226);

    // Trophy badges.
    const by = 392;
    ctx.fillStyle = C.sandFaint;
    ctx.font = '600 13px "Martian Mono"';
    ctx.fillText(d.badges.length ? 'TROPHY SHELF' : 'TROPHY SHELF · EMPTY FOR NOW', x0, by);
    const badge = 52;
    const perRow = Math.floor((colW + 10) / (badge + 10));
    d.badges.slice(0, perRow).forEach((icon, i) => {
      const bx = x0 + (i % perRow) * (badge + 10), byy = by + 16 + Math.floor(i / perRow) * (badge + 10);
      roundRect(ctx, bx, byy, badge, badge, 12);
      ctx.fillStyle = 'rgba(255,193,94,.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,193,94,.28)';
      ctx.stroke();
      ctx.fillStyle = '#fff'; // colour emoji take their alpha from fillStyle
      ctx.font = '28px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(icon, bx + badge / 2, byy + 36);
      ctx.textAlign = 'left';
    });
    if (d.badges.length > perRow) {
      ctx.fillStyle = C.sandDim;
      ctx.font = '600 15px "Martian Mono"';
      ctx.textAlign = 'right';
      ctx.fillText(`+${d.badges.length - perRow} more`, right, by);
      ctx.textAlign = 'left';
    }

    // The outfit code: anyone with Shellby can paste it to wear this look.
    if (d.code) {
      const cy = by + 16 + badge + 46;
      ctx.fillStyle = C.sandFaint;
      ctx.font = '600 13px "Martian Mono"';
      ctx.fillText('WEAR MY LOOK', x0, cy);
      ctx.fillStyle = C.glass;
      ctx.font = '500 26px "Martian Mono"';
      ctx.fillText(d.code, x0, cy + 34);
    }

    await drawFooter(ctx);
    return { canvas, data: d };
  }

  // ------------------------------------------------------------ share flow

  const sheet = $('cardSheet');
  const HINT_MS = 10000;
  let last = null;
  let hintTimer = null;
  let showing = null; // what the sheet shows: { spec, size }, so the size switch can draw it again

  // The size you last picked for a kind of card (this PC's own), Wide until you pick.
  const sizeKey = kind => `shellby.cardSize.${kind}`;
  const pickedSize = (kind, sizes) => { const s = SB.pref(sizeKey(kind)); return sizes.includes(s) ? s : sizes[0]; };
  const rememberSize = (kind, size) => SB.pref.set(sizeKey(kind), size);

  const postText = d => `Meet my Shellby 🦀 ${d.tasks} task${d.tasks === 1 ? '' : 's'} done and ${d.trophies}/${d.trophiesAll} trophies. A pixel hermit crab that runs Claude Code on my desktop.${d.code ? ` Wear my look: ${d.code}` : ''}`;

  // The size switch above the preview: only for a card that comes in more than one size.
  function renderSizes() {
    const sizes = showing?.spec.sizes || ['wide'];
    $('cardSizes').hidden = sizes.length < 2;
    for (const b of document.querySelectorAll('#cardSizes [data-size]')) {
      b.hidden = !sizes.includes(b.dataset.size);
      b.setAttribute('aria-checked', String(b.dataset.size === showing?.size));
    }
    $('cardImg').classList.toggle('square', showing?.size === 'square');
  }

  /**
   * Draw a card, save it (main copies it to the clipboard too) and show it in
   * the share sheet. spec: { kind, draw: size => { canvas, data }, title, alt,
   * post: data => text, buttons: selector of the buttons to disable meanwhile,
   * sizes: the sizes it comes in (default ['wide']), size: one to use this time }.
   * The size you pick is remembered per kind. again: the same card in another
   * size, which main saves but doesn't count as another share.
   */
  async function present(spec, { again = false } = {}) {
    const { kind, draw, title, alt, post, buttons } = spec;
    const sizes = spec.sizes?.length ? spec.sizes.filter(s => SIZES[s]) : ['wide'];
    const size = sizes.includes(spec.size) ? spec.size : pickedSize(kind, sizes);
    const btns = document.querySelectorAll(`${buttons}, #cardSizes button`);
    btns.forEach(b => { b.disabled = true; });
    try {
      const { canvas, data } = await draw(size);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const r = await api.saveCard(bytes, kind, { size, again });
      if (!r?.ok) return SB.toast(r?.error || "Couldn't save the card.");
      // data: URL, not blob: (the panel's CSP only allows 'self' and data: images).
      last = { url: canvas.toDataURL('image/png'), bytes, post: post(data), alt, path: r.path, copied: r.copied !== false, discord: !!r.discord };
      showing = { spec: { ...spec, sizes }, size };
      $('cardTitle').textContent = title;
      $('cardImg').alt = alt;
      $('cardImg').src = last.url;
      $('cardPath').textContent = r.name;
      $('cardDiscord').hidden = !last.discord;
      hint();
      renderSizes();
      sheet.hidden = false;
      if (!again) $('cardCopy').focus();
      if (r.copied === false) SB.toast("Saved, but another app is holding the clipboard. Try Copy in a moment.");
    } catch (e) {
      console.warn('[shellby] card failed', e);
      SB.toast("Couldn't draw the card.");
    } finally {
      btns.forEach(b => { b.disabled = false; });
    }
  }

  // Another size: drawn and saved again, and remembered for this kind of card.
  async function switchSize(size) {
    if (!showing || size === showing.size || !showing.spec.sizes.includes(size)) return;
    rememberSize(showing.spec.kind, size);
    await present({ ...showing.spec, size }, { again: true });
    document.querySelector(`#cardSizes [data-size="${size}"]`)?.focus();
  }

  // kind 'tank': the same card from the Tank's 📸, saved as his tank card (the "Share the tank" quest).
  const share = ({ kind = 'crab' } = {}) => present({
    kind, draw: render, buttons: '[data-share-card]', post: postText, sizes: ['wide', 'square'],
    title: kind === 'tank' ? 'His tank card' : 'Your crab card',
    alt: kind === 'tank' ? "Your Shellby card: his tank with him in it as he's dressed now, with your trophies and task count"
      : "Your Shellby card: your crab as he's dressed now, with your trophies and task count",
  });

  function close() {
    sheet.hidden = true;
    showing = null;
    clearTimeout(hintTimer);
  }

  // The line under the buttons: how to get the picture into a post. `now`, for
  // ten seconds after a post opened in the browser: the one thing left to do.
  function hint(now) {
    clearTimeout(hintTimer);
    const el = $('cardHint');
    el.classList.toggle('now', !!now);
    el.textContent = now || (last?.discord
      ? 'X and Bluesky let you add the alt text when you attach the picture.'
      : 'For Discord: Copy again, then paste it in Discord. X and Bluesky let you add the alt text when you attach the picture.');
    if (now) hintTimer = setTimeout(() => hint(), HINT_MS);
  }

  // Before a post opens: the card on the clipboard, copied again if the first copy didn't take.
  async function readyToPaste() {
    if (!last.copied) last.copied = !!(await api.copyCard(last.bytes))?.ok;
    return last.copied;
  }

  async function postOn(url) {
    if (!last) return;
    const copied = await readyToPaste();
    api.openExternal(url);
    hint(copied ? 'Your card is on the clipboard: press Ctrl+V in the post.' : "Couldn't copy it: Show file, then drag it into your post.");
  }

  document.querySelectorAll('[data-share-card]').forEach(b => b.addEventListener('click', () => share({ kind: b.dataset.kind })));
  $('cardClose').addEventListener('click', close);
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  $('cardCopy').addEventListener('click', async () => {
    if (!last) return;
    const r = await api.copyCard(last.bytes);
    last.copied = !!r?.ok;
    SB.toast(r?.ok ? 'Copied. Paste it anywhere.' : "Couldn't copy the card.");
  });
  // The words a screen reader says for it: X and Bluesky take them when you attach the picture.
  $('cardAlt').addEventListener('click', () => {
    if (!last?.alt) return;
    api.copyText(last.alt);
    hint('Alt text copied: paste it in the image description when you attach the card.');
  });
  $('cardDiscord').addEventListener('click', async () => {
    if (!last?.path) return;
    const btn = $('cardDiscord');
    btn.disabled = true;
    try {
      const r = await api.postCardToDiscord(last.path, withLink(last.post));
      if (r?.ok) SB.toast('Posted to Discord.');
      else if (!r?.canceled) SB.toast(r?.error || "Couldn't post it to Discord.", { ms: 6000 });
    } finally { btn.disabled = false; }
  });
  $('cardReveal').addEventListener('click', () => api.revealCard());
  $('cardSizes').addEventListener('click', e => { const b = e.target.closest('[data-size]'); if (b) switchSize(b.dataset.size); });
  // A moment card's post already ends with the link (moment-card.js postFor); the others get it here.
  const withLink = text => (text.includes(REPO) ? text : `${text} ${REPO}`);
  $('cardX').addEventListener('click', () => last && postOn(`https://x.com/intent/post?text=${encodeURIComponent(withLink(last.post))}`));
  $('cardBsky').addEventListener('click', () => last && postOn(`https://bsky.app/intent/compose?text=${encodeURIComponent(withLink(last.post))}`));

  SB.crabCard = { render, share };
  SB.cardKit = { W, H, C, SIZES, TANK, SQUARE_TANK, SQUARE_DROP, svgImage, roundRect, fitText, loadFonts, newCanvas, drawWater, drawTank, drawTiles, drawFooter, present };
})();
