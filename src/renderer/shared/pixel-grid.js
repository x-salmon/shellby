/* The Painter's pure parts (panel/painter.js): a pixel grid you paint on, and
   everything done to it. No DOM, so node:test runs it, and main uses the same
   checks when it saves (ipc/wardrobe.js), so the strip under the canvas and
   what main says can never disagree.

   A drawing is a plain, never-changed object; every edit returns a new one (or
   the same one when nothing changed), so undo keeps whole drawings, not diffs:
   a 40×32 grid is 1,280 characters.
     { mode, w, h, frames: [[row, ...], ...], frame, palette: { ch: '#rrggbb' },
       parts: { ch: part }, anchors: null | { head: [x, y], ... }, pivot: null | [x, y] }
   Rows are always w characters, '.' for see-through. A crab (mode 'skin') has
   one frame and a part for each colour; tank decor and effects can have up to
   four pictures (frames); an accessory has a pivot, the pixel that sits on its
   anchor. `anchors` stays null until you move one, so a skin whose anchors
   were never touched leaves them out and keeps up with the defaults. */
(function (root) {
  'use strict';
  const S = typeof module !== 'undefined' && module.exports ? (require('./sprite'), globalThis.ShellbySprite) : root.ShellbySprite;

  const EMPTY = '.';
  // The characters a colour can be, in the order they're handed out.
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const PARTS = ['shell', 'body', 'claw', 'eyes', 'stalks', 'legs', 'extra'];
  // Part view: each part in a colour of its own, the swatch's edge too.
  const PART_COLOURS = { shell: '#2fa894', body: '#ff7657', claw: '#ffc93c', eyes: '#f3e6cc', stalks: '#9d7bff', legs: '#4f8bff', extra: '#8d99ae' };
  const PART_LABEL = { shell: 'Shell', body: 'Body', claw: 'Claw', eyes: 'Eyes', stalks: 'Stalks', legs: 'Legs', extra: 'Extra' };
  const HEX = /^#[0-9a-f]{6}$/i;
  // Must match sprite.js and src/main/wardrobe/catalog.js DEFAULT_ANCHORS (test/pixel-grid.test.js).
  const ANCHOR_NAMES = ['head', 'face', 'neck', 'claw', 'shellTop'];
  const ANCHOR_LABEL = { head: 'Head', face: 'Face', neck: 'Neck', claw: 'Claw', shellTop: 'Shell top' };
  const ANCHOR_RANGE = [-16, 48];
  const PIVOT_RANGE = [-16, 32];
  const CLASSIC = { w: 22, h: 13 };

  // What each kind of thing can be: catalog.js LIMITS for packs, skins.js for skins.
  const MODES = {
    skin: { label: 'Crab', w: 40, h: 32, palette: 32, frames: 1, start: [22, 13], parts: true, packPrefix: 'skin' },
    accessory: { label: 'Accessory', w: 16, h: 16, palette: 16, frames: 1, start: [8, 8], parts: false, packPrefix: 'acc' },
    effect: { label: 'Effect', w: 8, h: 8, palette: 16, frames: 4, start: [5, 5], parts: false, packPrefix: 'fx' },
    decor: { label: 'Tank decor', w: 32, h: 32, palette: 16, frames: 4, start: [12, 10], parts: false, packPrefix: 'decor' },
  };
  const UNDO_STEPS = 200;

  const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
  const frameRows = doc => doc.frames[doc.frame] || doc.frames[0];
  const withFrame = (doc, rows) => ({ ...doc, frames: doc.frames.map((f, i) => (i === doc.frame ? rows : f)) });
  const pad = (row, w) => (row.length >= w ? row.slice(0, w) : row + EMPTY.repeat(w - row.length));
  const blankRows = (w, h) => Array.from({ length: h }, () => EMPTY.repeat(w));
  const inside = (doc, x, y) => x >= 0 && y >= 0 && x < doc.w && y < doc.h;

  // ------------------------------------------------------------ making one

  /** A new, empty drawing in a mode, at its starting size (or w × h). */
  function blank(mode = 'skin', w, h) {
    const m = MODES[mode] || MODES.skin;
    const cw = clampInt(w ?? m.start[0], 1, m.w), ch = clampInt(h ?? m.start[1], 1, m.h);
    return { mode: MODES[mode] ? mode : 'skin', w: cw, h: ch, frames: [blankRows(cw, ch)], frame: 0, palette: {}, parts: {}, anchors: null, pivot: mode === 'accessory' ? [Math.floor(cw / 2), ch - 1] : null };
  }

  // Rows from a file: text only, '.' for anything not in the palette, all one width.
  function cleanRows(rows, palette, w, h) {
    const out = (Array.isArray(rows) ? rows : []).slice(0, h).map(r => [...pad(typeof r === 'string' ? r : '', w)].map(c => (palette[c] ? c : EMPTY)).join(''));
    while (out.length < h) out.push(EMPTY.repeat(w));
    return out;
  }
  function cleanPalette(p, max) {
    const out = {};
    for (const [k, v] of Object.entries(p && typeof p === 'object' ? p : {})) {
      if (k.length === 1 && k !== EMPTY && HEX.test(v) && Object.keys(out).length < max) out[k] = v.toLowerCase();
    }
    return out;
  }

  /** A skin (from a file, built in, or a pack's) as a drawing. */
  function fromSkin(skin) {
    const palette = cleanPalette(skin.palette, MODES.skin.palette);
    const src = Array.isArray(skin.pixels) ? skin.pixels.filter(r => typeof r === 'string') : [];
    const w = clampInt(Math.max(1, ...src.map(r => r.length)), 1, MODES.skin.w), h = clampInt(src.length || 1, 1, MODES.skin.h);
    const parts = {};
    for (const [k, v] of Object.entries(skin.parts || {})) if (palette[k] && PARTS.includes(v)) parts[k] = v;
    let anchors = null;
    if (skin.anchors && typeof skin.anchors === 'object') {
      anchors = effectiveAnchors({ anchors: null });
      for (const n of ANCHOR_NAMES) {
        const a = skin.anchors[n];
        if (Array.isArray(a) && a.length === 2 && a.every(Number.isInteger)) anchors[n] = [a[0], a[1]];
      }
    }
    return { mode: 'skin', w, h, frames: [cleanRows(src, palette, w, h)], frame: 0, palette, parts, anchors, pivot: null };
  }

  /** A drawing as the skin file Shellby saves. meta: { id, name, author, description, basedOn }. */
  function toSkin(doc, meta = {}) {
    const palette = {}, parts = {};
    for (const [k, v] of Object.entries(doc.palette)) { palette[k] = v; if (doc.parts[k]) parts[k] = doc.parts[k]; }
    return {
      id: meta.id,
      name: String(meta.name || '').trim(),
      author: String(meta.author || '').trim(),
      description: String(meta.description || '').trim(),
      palette, parts,
      pixels: [...frameRows(doc)],
      ...(doc.anchors ? { anchors: Object.fromEntries(ANCHOR_NAMES.map(n => [n, [...doc.anchors[n]]])) } : {}),
      ...(meta.basedOn ? { basedOn: meta.basedOn } : {}),
    };
  }

  /** An accessory, effect or piece of decor (pack format) as a drawing. */
  function fromItem(mode, item) {
    const m = MODES[mode];
    const src = mode === 'effect' ? item.sprites?.[0] || {} : item;
    const palette = cleanPalette(src.palette, m.palette);
    const rows = Array.isArray(src.pixels) ? src.pixels.filter(r => typeof r === 'string') : [];
    const w = clampInt(Math.max(1, ...rows.map(r => r.length)), 1, m.w), h = clampInt(rows.length || 1, 1, m.h);
    const more = m.frames > 1 && Array.isArray(src.frames) ? src.frames.slice(0, m.frames - 1) : [];
    const pv = Array.isArray(item.pivot) && item.pivot.length === 2 ? [clampInt(item.pivot[0], ...PIVOT_RANGE), clampInt(item.pivot[1], ...PIVOT_RANGE)] : null;
    return { mode, w, h, frames: [rows, ...more].map(f => cleanRows(f, palette, w, h)), frame: 0, palette, parts: {}, anchors: null, pivot: mode === 'accessory' ? pv || [Math.floor(w / 2), h - 1] : null };
  }

  /**
   * A drawing as a pack item. meta: { id, name, description }; settings: the
   * mode's own (accessory: slot; effect: motion, count, speed, fps; decor:
   * category, layer, fps).
   */
  function toItem(doc, meta = {}, settings = {}) {
    const palette = { ...doc.palette };
    const pixels = [...doc.frames[0]];
    const frames = doc.frames.slice(1).map(f => [...f]);
    const base = { id: meta.id, name: String(meta.name || '').trim(), ...(meta.description ? { description: String(meta.description).trim() } : {}) };
    if (doc.mode === 'accessory') return { ...base, slot: settings.slot || 'hat', pivot: [...(doc.pivot || [0, 0])], palette, pixels };
    if (doc.mode === 'effect') {
      return {
        ...base, motion: settings.motion || 'fall', count: clampInt(settings.count ?? 10, 1, 24), speed: Math.max(0.25, Math.min(3, Number(settings.speed) || 1)),
        ...(frames.length ? { fps: clampInt(settings.fps ?? 4, 1, 12) } : {}),
        sprites: [{ palette, pixels, ...(frames.length ? { frames } : {}) }],
      };
    }
    const style = settings.category === 'substrate' || settings.category === 'backdrop';
    return {
      ...base, category: settings.category || 'structure',
      ...(style ? {} : { layer: settings.layer || 'floor' }),
      palette, pixels,
      ...(frames.length && !style ? { frames, fps: clampInt(settings.fps ?? 2, 1, 8) } : {}),
    };
  }

  // ------------------------------------------------------------ painting

  const at = (doc, x, y) => (inside(doc, x, y) ? frameRows(doc)[y][x] : null);

  /** The cells a brush covers with its top-left at (x, y): 1 or 2 pixels square. */
  const brushCells = (x, y, size = 1) => (size >= 2 ? [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] : [[x, y]]);

  /** Paint cells (any outside the grid are ignored) with ch, or '.' to erase. Same doc back if nothing changed. */
  function paint(doc, cells, ch) {
    if (ch !== EMPTY && !doc.palette[ch]) return doc;
    const rows = [...frameRows(doc)];
    let changed = false;
    for (const [x, y] of cells) {
      if (!inside(doc, x, y) || rows[y][x] === ch) continue;
      rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1);
      changed = true;
    }
    return changed ? withFrame(doc, rows) : doc;
  }

  /** Flood fill, four ways, from (x, y): every connected cell of that colour becomes ch. */
  function fill(doc, x, y, ch) {
    const from = at(doc, x, y);
    if (from === null || from === ch) return doc;
    const seen = new Set();
    const cells = [];
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const k = cy * doc.w + cx;
      if (seen.has(k) || at(doc, cx, cy) !== from) continue;
      seen.add(k);
      cells.push([cx, cy]);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    return paint(doc, cells, ch);
  }

  /** The cells of a straight line, both ends in (Bresenham). */
  function lineCells(x0, y0, x1, y1) {
    const cells = [];
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    for (;;) {
      cells.push([x, y]);
      if (x === x1 && y === y1) return cells;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  // Anchors and pivot shift with the drawing when it moves or the grid grows on the left or top.
  function shifted(doc, dx, dy) {
    const out = {};
    if (doc.anchors) out.anchors = Object.fromEntries(ANCHOR_NAMES.map(n => [n, [clampInt(doc.anchors[n][0] + dx, ...ANCHOR_RANGE), clampInt(doc.anchors[n][1] + dy, ...ANCHOR_RANGE)]]));
    if (doc.pivot) out.pivot = [clampInt(doc.pivot[0] + dx, ...PIVOT_RANGE), clampInt(doc.pivot[1] + dy, ...PIVOT_RANGE)];
    return out;
  }

  /**
   * Nudge the whole drawing (every frame) by dx, dy, to re-centre it. Null if a
   * painted pixel would fall off the grid: nothing is ever lost by a move.
   */
  function move(doc, dx, dy) {
    if (!dx && !dy) return doc;
    const b = bounds(doc);
    if (!b) return doc;
    if (b.x0 + dx < 0 || b.y0 + dy < 0 || b.x1 + dx > doc.w || b.y1 + dy > doc.h) return null;
    const frames = doc.frames.map(rows => Array.from({ length: doc.h }, (_, y) => {
      const src = rows[y - dy];
      if (src === undefined) return EMPTY.repeat(doc.w);
      return Array.from({ length: doc.w }, (_, x) => src[x - dx] ?? EMPTY).join('');
    }));
    return { ...doc, frames, ...shifted(doc, dx, dy) };
  }

  /**
   * Add (delta 1) or trim (delta -1) a row or column on one edge: 'top',
   * 'bottom', 'left' or 'right'. Never scales. Null past the mode's limits.
   */
  function resize(doc, edge, delta) {
    const m = MODES[doc.mode];
    const horizontal = edge === 'left' || edge === 'right';
    const w = doc.w + (horizontal ? delta : 0), h = doc.h + (horizontal ? 0 : delta);
    if (w < 1 || h < 1 || w > m.w || h > m.h || !['top', 'bottom', 'left', 'right'].includes(edge) || Math.abs(delta) !== 1) return null;
    const frames = doc.frames.map(rows => {
      if (edge === 'top') return delta > 0 ? [EMPTY.repeat(w), ...rows] : rows.slice(1);
      if (edge === 'bottom') return delta > 0 ? [...rows, EMPTY.repeat(w)] : rows.slice(0, -1);
      if (edge === 'left') return rows.map(r => (delta > 0 ? EMPTY + r : r.slice(1)));
      return rows.map(r => (delta > 0 ? r + EMPTY : r.slice(0, -1)));
    });
    const dx = edge === 'left' ? delta : 0, dy = edge === 'top' ? delta : 0;
    return { ...doc, w, h, frames, ...shifted(doc, dx, dy) };
  }

  /** The painted area over every frame: { x0, y0, x1, y1 } (x1, y1 past the end), or null when empty. */
  function bounds(doc) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const rows of doc.frames) {
      rows.forEach((r, y) => {
        for (let x = 0; x < r.length; x++) {
          if (r[x] === EMPTY) continue;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
        }
      });
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

  /** Every cell of one colour in the frame on show. */
  function cellsOf(doc, ch) {
    const out = [];
    frameRows(doc).forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === ch) out.push([x, y]); });
    return out;
  }

  /** The colours painted anywhere, in any frame. */
  function used(doc) {
    const s = new Set();
    for (const rows of doc.frames) for (const r of rows) for (const c of r) if (c !== EMPTY) s.add(c);
    return s;
  }

  // ------------------------------------------------------------ the palette

  /** The next character free for a new colour, or null when every one is taken. */
  function nextChar(palette) {
    for (const c of CHARS) if (!palette[c]) return c;
    return null;
  }

  /** Add a colour (and its part, for a crab). -> { doc, ch }, or null when the palette is full. */
  function addColour(doc, hex, part) {
    const m = MODES[doc.mode];
    if (!HEX.test(hex) || Object.keys(doc.palette).length >= m.palette) return null;
    const ch = nextChar(doc.palette);
    if (!ch) return null;
    const parts = m.parts ? { ...doc.parts, [ch]: PARTS.includes(part) ? part : 'body' } : doc.parts;
    return { doc: { ...doc, palette: { ...doc.palette, [ch]: hex.toLowerCase() }, parts }, ch };
  }

  const setColour = (doc, ch, hex) => (doc.palette[ch] && HEX.test(hex) && doc.palette[ch] !== hex.toLowerCase() ? { ...doc, palette: { ...doc.palette, [ch]: hex.toLowerCase() } } : doc);
  const setPart = (doc, ch, part) => (doc.palette[ch] && PARTS.includes(part) && doc.parts[ch] !== part ? { ...doc, parts: { ...doc.parts, [ch]: part } } : doc);

  /** Take a colour off the palette. Only one nothing is painted with: null otherwise. */
  function removeColour(doc, ch) {
    if (!doc.palette[ch]) return doc;
    if (used(doc).has(ch)) return null;
    const palette = { ...doc.palette }, parts = { ...doc.parts };
    delete palette[ch];
    delete parts[ch];
    return { ...doc, palette, parts };
  }

  // ------------------------------------------------------------ frames

  /** A new frame after the one on show, a copy of it, and shown. Null at the mode's limit. */
  function addFrame(doc) {
    if (doc.frames.length >= MODES[doc.mode].frames) return null;
    const frames = [...doc.frames];
    frames.splice(doc.frame + 1, 0, [...frameRows(doc)]);
    return { ...doc, frames, frame: doc.frame + 1 };
  }
  function removeFrame(doc) {
    if (doc.frames.length < 2) return null;
    const frames = doc.frames.filter((_, i) => i !== doc.frame);
    return { ...doc, frames, frame: Math.min(doc.frame, frames.length - 1) };
  }
  const showFrame = (doc, i) => (i >= 0 && i < doc.frames.length && i !== doc.frame ? { ...doc, frame: i } : doc);

  // ------------------------------------------------------------ anchors and the pivot

  /** Every anchor, where you put it or where classic has it. */
  function effectiveAnchors(doc) {
    const d = S?.DEFAULT_ANCHORS || { head: [15, -1], face: [15, 0], neck: [15, 4], claw: [21, 6], shellTop: [7, 0] };
    return Object.fromEntries(ANCHOR_NAMES.map(n => [n, [...(doc.anchors?.[n] || d[n])]]));
  }

  /** Put one anchor at (x, y), snapped to whole pixels inside the validator's range. */
  function setAnchor(doc, name, x, y) {
    if (!ANCHOR_NAMES.includes(name)) return doc;
    const all = effectiveAnchors(doc);
    const pt = [clampInt(x, ...ANCHOR_RANGE), clampInt(y, ...ANCHOR_RANGE)];
    if (doc.anchors && all[name][0] === pt[0] && all[name][1] === pt[1]) return doc;
    return { ...doc, anchors: { ...all, [name]: pt } };
  }
  const resetAnchors = doc => (doc.anchors ? { ...doc, anchors: null } : doc);

  function setPivot(doc, x, y) {
    if (doc.mode !== 'accessory') return doc;
    const pt = [clampInt(x, ...PIVOT_RANGE), clampInt(y, ...PIVOT_RANGE)];
    return doc.pivot && doc.pivot[0] === pt[0] && doc.pivot[1] === pt[1] ? doc : { ...doc, pivot: pt };
  }

  // ------------------------------------------------------------ undo

  /**
   * Undo and redo over whole drawings, up to `limit` steps back. record(before)
   * right before a change; undo(now) and redo(now) hand back the drawing to
   * show, or null when there's nothing to go back (or forward) to.
   */
  function history(limit = UNDO_STEPS) {
    let past = [], future = [];
    return {
      record(before) { past.push(before); if (past.length > limit) past = past.slice(past.length - limit); future = []; },
      undo(now) { if (!past.length) return null; future.push(now); return past.pop(); },
      redo(now) { if (!future.length) return null; past.push(now); return future.pop(); },
      clear() { past = []; future = []; },
      get canUndo() { return past.length > 0; },
      get canRedo() { return future.length > 0; },
      get size() { return past.length; },
    };
  }

  // ------------------------------------------------------------ names and ids

  /** Lowercase letters, digits and dashes, for an id. */
  const slug = (text, max = 29) => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

  /** A new id from a name: "frosty-k3x9". rnd() is Math.random by default. */
  function newId(name, rnd = Math.random, fallback = 'crab') {
    const tail = Array.from({ length: 4 }, () => 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(rnd() * 32) % 32]).join('');
    return `${slug(name) || fallback}-${tail}`;
  }

  // ------------------------------------------------------------ checks

  /**
   * What's wrong, or worth knowing, about a drawing, for the strip under the canvas:
   *   [{ id, level: 'block' | 'warning' | 'note', text, cells: [[x, y]], blocks: 'save' | 'share' | null }]
   * A 'block' stops saving (or sharing, when blocks is 'share'). A warning
   * stops sharing, unless it's in onPurpose ("That's on purpose"). A note never
   * stops anything. meta: { name, author }.
   * Legs that touch are a note: sprite.components joins pixels corner to corner,
   * and every shipped crab's legs touch that way, classic's included.
   */
  function checks(doc, meta = {}, onPurpose = []) {
    const out = [];
    const ok = new Set(onPurpose);
    const warn = (id, text, cells = []) => out.push({ id, level: 'warning', text, cells, blocks: ok.has(id) ? null : 'share', onPurpose: ok.has(id) });
    const b = bounds(doc);
    if (!b) out.push({ id: 'empty', level: 'block', text: 'Nothing painted yet.', cells: [], blocks: 'save' });
    if (doc.mode === 'skin') {
      const pal = Object.keys(doc.palette);
      const painted = used(doc);
      const loose = pal.filter(c => !doc.parts[c] && painted.has(c));
      if (loose.length) out.push({ id: 'no-part', level: 'block', text: `${loose.length === 1 ? 'A colour has' : `${loose.length} colours have`} no part, so ${loose.length === 1 ? 'it' : 'they'} wouldn't move with him.`, cells: loose.flatMap(c => cellsOf(doc, c)), blocks: 'save' });
      if (b) {
        const has = part => pal.some(c => doc.parts[c] === part && painted.has(c));
        if (!has('eyes')) warn('no-eyes', 'No eyes: he\'d look odd blinking at nothing.');
        if (!has('legs')) warn('no-legs', 'No legs: he walks and scuttles on them.');
        else {
          const parts = Object.fromEntries(pal.map(c => [c, doc.parts[c]]));
          const shapes = S ? S.components(frameRows(doc), parts, 'legs') : [];
          // A note, not a warning: every crab Shellby ships has its legs joined
          // corner to corner, so they step as one, and that reads fine at 1×.
          if (shapes.length < 2) out.push({ id: 'legs-touch', level: 'note', text: 'His legs touch (corners count), so they step together. Leave a clear pixel between them and they take turns.', cells: shapes.flat(), blocks: null });
        }
        const far = Object.entries(effectiveAnchors(doc)).filter(([, [x, y]]) => Math.max(b.x0 - x, x - (b.x1 - 1), 0) > 4 || Math.max(b.y0 - y, y - (b.y1 - 1), 0) > 4);
        if (far.length) warn('anchors', `${far.map(([n]) => ANCHOR_LABEL[n]).join(', ')} ${far.length === 1 ? 'is' : 'are'} off the drawing: hats would float. Move ${far.length === 1 ? 'it' : 'them'} with Wear your outfit.`, far.map(([, p]) => p));
        if (b.x1 - b.x0 > CLASSIC.w * 1.5 || b.y1 - b.y0 > CLASSIC.h * 1.5) out.push({ id: 'big', level: 'note', text: 'Much bigger than classic: he\'ll be big on the desk.', cells: [], blocks: null });
      }
    }
    if (doc.mode === 'accessory' && b && doc.pivot) {
      const [x, y] = doc.pivot;
      if (x < b.x0 - 1 || x > b.x1 || y < b.y0 - 1 || y > b.y1) warn('pivot', 'The pivot is off the drawing: it would hang in the air.', [doc.pivot]);
    }
    if (!String(meta.name || '').trim()) out.push({ id: 'name', level: 'block', text: 'Give it a name to share it.', cells: [], blocks: 'share' });
    if (doc.mode === 'skin' && !String(meta.author || '').trim()) out.push({ id: 'author', level: 'block', text: 'Say who made it to share it.', cells: [], blocks: 'share' });
    return out;
  }
  /** Whether checks() lets you save, and share. */
  const verdict = list => ({ save: !list.some(c => c.blocks === 'save'), share: !list.some(c => c.blocks) });

  const api = {
    EMPTY, CHARS, PARTS, PART_COLOURS, PART_LABEL, ANCHOR_NAMES, ANCHOR_LABEL, ANCHOR_RANGE, MODES, UNDO_STEPS, CLASSIC,
    blank, fromSkin, toSkin, fromItem, toItem, rows: frameRows, at, brushCells, paint, fill, lineCells, move, resize, bounds,
    cellsOf, used, nextChar, addColour, setColour, setPart, removeColour, addFrame, removeFrame, showFrame,
    effectiveAnchors, setAnchor, resetAnchors, setPivot, history, slug, newId, checks, verdict,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShellbyPixelGrid = api;
})(typeof window !== 'undefined' ? window : globalThis);
