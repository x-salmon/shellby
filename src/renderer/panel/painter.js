/* Shellby panel — the Painter (🎨 Paint on Shellby's screen; docs/plans/crab-painter.md).
   Start from a crab you have, paint, watch him do every pose, save, wear,
   share: no JSON, no text editor. The same screen paints accessories, effects
   and tank decor.

   The drawing and everything done to it is ../shared/pixel-grid.js (pure, and
   the checks main runs too). This file is the screen: the canvas and its
   tools, the palette (each colour knows the part it moves with), the preview
   (sprite.js at 4×, moved by ../shared/crab-anim.css), the checks strip, and
   the drafts kept a second after every change (main's painter.js). Main checks
   everything again before it saves or shares (src/main/wiring/painter.js). */
'use strict';
(function () {
  const { h, api, state, $ } = SB;
  const G = window.ShellbyPixelGrid;
  const DRAFT_MS = 1000;    // a draft is kept this long after the last change
  const MAX_SCALE = 24;     // the canvas never gets chunkier than this
  const GRID_FROM = 8;      // a 1-pixel grid line from this scale up
  const FLASH_MS = 1600;    // "Show me"
  const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const SLOTS = [['hat', 'Hat'], ['face', 'Face'], ['neck', 'Neck'], ['held', 'Held'], ['shell', 'On his shell']];
  const MOTIONS = [['fall', 'Falls'], ['rise', 'Rises'], ['float', 'Floats'], ['orbit', 'Circles him'], ['twinkle', 'Twinkles'], ['burst', 'Bursts']];
  const CATEGORIES = [['structure', 'Structure'], ['plant', 'Plant'], ['rock', 'Rock'], ['treasure', 'Treasure'], ['bubbler', 'Bubbler'], ['substrate', 'Floor tile'], ['backdrop', 'Back wall tile']];
  const LAYERS = [['floor', 'On the floor'], ['back', 'Against the glass'], ['float', 'In the water']];
  const DEFAULTS = { skin: {}, accessory: { slot: 'hat' }, effect: { motion: 'fall', count: 10, speed: 1, fps: 4 }, decor: { category: 'structure', layer: 'floor', fps: 2 } };
  const START_TEXT = {
    skin: ['Paint a crab', 'Start from one you have and make him yours. Watch him do every pose as you paint, then wear him, or share him with everyone.'],
    accessory: ['Paint an accessory', 'A hat, glasses, something to hold. Up to 16 × 16, tried on your crab as you paint.'],
    effect: ['Paint an effect', 'Snowflakes, bubbles, sparks: up to 8 × 8, with up to four pictures to flip between.'],
    decor: ['Paint some tank decor', 'A castle, a plant, a treasure chest for his tank. Up to 32 × 32, with up to four pictures.'],
  };

  const canvas = $('ptCanvas');
  const ctx = canvas.getContext('2d');

  let mode = SB.pref('painter.mode', 'skin');
  if (!G.MODES[mode]) mode = 'skin';
  let cur = null;           // the drawing open: a draft (main's painter.js cleanDraft shape)
  let hist = G.history();
  let tool = 'pencil', brush = 1, colour = null, partView = false;
  let K = 8;                // css px per cell
  let stroke = null;        // { base, start, last } while the pointer is down
  let hover = null;         // the cell under the pointer
  let flash = null;         // { cells, until } for "Show me"
  let draftTimer = 0;
  let editing = null;       // { ch, base } while a colour picker is open on a swatch
  let adding = null;        // { hex, part } while a new colour is being picked
  let drafts = [], gallery = {}, wishes = [], items = [], news = null;

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const doc = () => cur.doc;
  const prefix = m => G.MODES[m].packPrefix;
  const packIdOf = (m, id) => `${prefix(m)}-${id}`.slice(0, 40).replace(/-+$/, '');
  const statusOf = (m, id) => gallery[packIdOf(m, id)]?.state || null;
  const kindLabel = m => G.MODES[m].label.toLowerCase();
  const settings = () => ({ ...DEFAULTS[cur.mode], ...cur.settings });
  const meta = () => ({ id: cur.id, name: cur.name, author: cur.author, description: cur.description, basedOn: cur.basedOn || '' });
  const checksNow = () => G.checks(doc(), meta(), cur.onPurpose);
  // replaceChildren would write a skipped (null) child out as the text "null".
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
  const inField = el => !!el?.closest?.('input, textarea, select, [contenteditable="true"]');

  // The preview, and saving and sharing, are files of their own (painter-preview.js,
  // painter-share.js); this is what they get to see and do of the drawing.
  const V = SB.paintPreview({
    cur: () => cur, doc, settings, meta, fill, reduced,
    commit: (next, o) => commit(next, o), record: before => hist.record(before), afterChange: () => afterChange(), stroking: () => !!stroke,
  });
  const T = SB.paintTiles({
    mode: () => mode, items: () => items, statusOf, contestNow: () => contestNow(), fill,
    startBlank: o => startBlank(o), startFromSkin: s => startFromSkin(s), startFromItem: it => startFromItem(it), openDraft: d => openDraft(d), throwAway: d => throwAway(d),
  });
  const S = SB.paintShare({
    cur: () => cur, doc, settings, meta, fill, checksNow, login: () => login(), contestNow: k => contestNow(k), statusOf,
    showMe: c => showMe(c), pendingDraft: () => pendingDraft(),
    forgetDraft: async id => { clearTimeout(draftTimer); draftTimer = 0; await api.deleteDraft(id).catch(() => {}); drafts = drafts.filter(d => d.id !== id); $('ptKept').textContent = 'Saved'; },
    shared: r => { gallery = { ...gallery, [r.packId]: { state: 'review', url: r.url, version: r.version } }; renderStatus(); },
  });

  // ------------------------------------------------------------ the start screen

  async function refresh() {
    const [d, g, w, it] = await Promise.all([
      api.painterDrafts().catch(() => []),
      api.painterGallery().catch(() => ({})),
      api.packWishes(mode).catch(() => []),
      mode === 'skin' ? Promise.resolve([]) : api.painterItems(mode).catch(() => []),
    ]);
    drafts = d; gallery = g || {}; wishes = w; items = it;
    news = (await api.getNews?.().catch(() => null)) || news;
  }

  function renderStart() {
    $('ptStart').hidden = false;
    $('ptEditor').hidden = true;
    const [title, sub] = START_TEXT[mode];
    $('ptStartTitle').textContent = title;
    $('ptStartSub').textContent = sub;
    document.querySelectorAll('#ptModes [data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    T.renderContest();
    // Drafts first: what you were in the middle of.
    const mine = drafts.filter(d => d.mode === mode);
    $('ptDraftsBlock').hidden = !mine.length;
    fill($('ptDrafts'), ...mine.map(T.draftTile));
    $('ptFromTitle').textContent = mode === 'skin' ? 'Start from' : `Start from (${kindLabel(mode)})`;
    fill($('ptFrom'), T.blankTile(), ...(mode === 'skin' ? T.skinTiles() : T.itemTiles()));
    $('ptWishesBlock').hidden = !wishes.length;
    fill($('ptWishes'), ...wishes.map(w => h('li', {},
      h('span', { class: 'pt-wish-title', text: w.title, title: w.title }),
      h('a', { class: 'pt-wish-n', 'data-href': w.url, href: '#', text: `#${w.number}` }),
      h('button', { type: 'button', class: 'btn slim-btn', onclick: () => startBlank({ wish: w }) }, 'Make this'))));
  }

  // The month's contest (the news feed's, docs/plans/community-events.md): one line, and a way in.
  function contestNow(kind = mode) {
    const c = news?.contest;
    const month = c?.contest?.month;
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const kinds = Array.isArray(c.contest.kinds) && c.contest.kinds.length ? c.contest.kinds : ['skin'];
    if (!kinds.includes(kind)) return null;
    const monthName = new Date(`${month}-01T12:00:00`).toLocaleDateString([], { month: 'long' });
    return { month, monthName, title: c.title || `${monthName} contest`, theme: c.contest.theme || '', body: c.body || '', url: c.url || '' };
  }
  async function throwAway(d) {
    await api.deleteDraft(d.id);
    drafts = drafts.filter(x => x.id !== d.id);
    renderStart();
    SB.toast(`Threw away the draft of ${d.name || 'Untitled'}.`, { action: 'Undo', onAction: async () => { await api.saveDraft(d); drafts = await api.painterDrafts(); renderStart(); } });
  }

  // ------------------------------------------------------------ starting a drawing

  const tailOf = id => (/-([a-z0-9]{4})$/.exec(id) || [])[1] || G.newId('', Math.random).slice(-4);
  const login = () => (state.github?.signedIn && state.github.login) || '';

  function begin(d) {
    cur = { onPurpose: [], settings: {}, wish: null, basedOn: '', saved: false, guide: false, description: '', ...d };
    hist = G.history();
    stroke = null; flash = null; editing = null; adding = null;
    S.close();
    tool = 'pencil';
    const pal = Object.keys(cur.doc.palette);
    colour = pal[0] || null;
    V.reset();
    openEditor();
  }

  // A blank crab starts with classic's colours (each already knowing its part)
  // and his outline faintly behind; anything else starts with one colour.
  function startBlank({ wish = null, name = '' } = {}) {
    const m = wish ? wish.kind : mode;
    let d = G.blank(m);
    if (m === 'skin') {
      const classic = state.skins.find(s => s.id === 'classic');
      if (classic) d = { ...d, palette: { ...classic.palette }, parts: { ...classic.parts } };
    } else {
      d = G.addColour(d, m === 'decor' ? '#c9a227' : '#ff7a5c', 'extra').doc;
    }
    const title = name || wish?.title || '';
    begin({ id: G.newId(title, Math.random, m === 'skin' ? 'crab' : prefix(m)), mode: m, name: title, author: login(), doc: d, wish: wish ? { number: wish.number, title: wish.title } : null, guide: m === 'skin' });
    if (wish) SB.toast(`Making #${wish.number}: ${wish.title}. Sharing it tells the wish.`);
  }

  async function startFromSkin(s) {
    if (s.locked) return SB.toast(`${s.name} is still locked, so it can't be a starting point.`);
    const r = await api.readSkin(s.id).catch(() => null);
    if (!r?.ok) return SB.toast(r?.error || "Couldn't open that one.");
    const d = G.fromSkin(r.skin);
    // Your own: edit it, under its own id. Anyone else's (or an id the gallery
    // wouldn't take): a copy of your own, named for it until you rename it.
    if (r.source === 'user' && ITEM_ID.test(r.skin.id)) {
      const draft = drafts.find(x => x.id === r.skin.id);
      if (draft) return openDraft(draft);
      return begin({ id: r.skin.id, mode: 'skin', name: r.skin.name, author: r.skin.author === 'unknown' ? login() : r.skin.author, description: r.skin.description || '', basedOn: r.skin.basedOn || '', doc: d, saved: true });
    }
    const name = (r.source === 'user' ? r.skin.name : `My ${r.skin.name}`).slice(0, 40);
    begin({ id: G.newId(name), mode: 'skin', name, author: login(), doc: d, basedOn: r.basedOn || '' });
  }

  function startFromItem(it) {
    if (it.locked || !it.item) return SB.toast(`${it.name} is still locked, so it can't be a starting point.`);
    const d = G.fromItem(mode, it.item);
    const id = it.key.split('/').pop();
    const s = mode === 'accessory' ? { slot: it.item.slot } : mode === 'effect' ? { motion: it.item.motion, count: it.item.count, speed: it.item.speed, fps: it.item.fps || 4 } : { category: it.item.category, layer: it.item.layer || 'floor', fps: it.item.fps || 2 };
    if (it.mine) {
      const draft = drafts.find(x => x.id === id);
      if (draft) return openDraft(draft);
      return begin({ id, mode, name: it.name, author: login(), description: it.item.description || '', settings: s, doc: d, saved: true });
    }
    const name = `My ${it.name}`.slice(0, 40);
    begin({ id: G.newId(name, Math.random, prefix(mode)), mode, name, author: login(), settings: s, doc: d, basedOn: it.source === 'user' ? it.packId : '' });
  }

  function openDraft(d) {
    mode = d.mode;
    begin({ ...d, doc: d.doc });
  }

  // ------------------------------------------------------------ the editor

  function openEditor() {
    mode = cur.mode;
    try { window.localStorage.setItem('painter.mode', mode); } catch { /* this session only */ }
    $('ptStart').hidden = true;
    $('ptEditor').hidden = false;
    $('ptName').value = cur.name;
    $('ptAuthor').value = cur.author;
    $('ptDesc').value = cur.description;
    $('ptName').placeholder = mode === 'skin' ? 'Name him' : 'Name it';
    renderEditor();
    V.resetPreviewFx();
    V.renderPreview();
    $('ptName').focus({ preventScroll: true });
  }

  function renderEditor() {
    if (!cur) return;
    const m = G.MODES[cur.mode];
    document.querySelectorAll('#ptTools [data-tool]').forEach(b => {
      b.hidden = b.dataset.tool === 'pivot' && cur.mode !== 'accessory';
      b.setAttribute('aria-checked', String(b.dataset.tool === tool));
    });
    document.querySelectorAll('#ptTools [data-brush]').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.brush) === brush)));
    $('ptUndo').disabled = !hist.canUndo;
    $('ptRedo').disabled = !hist.canRedo;
    $('ptSize').textContent = `${doc().w}×${doc().h}`;
    $('ptPartView').hidden = !m.parts;
    $('ptPartView').setAttribute('aria-pressed', String(partView && m.parts));
    $('ptGuide').hidden = cur.mode !== 'skin';
    $('ptGuide').setAttribute('aria-pressed', String(!!cur.guide));
    $('ptSaveWear').hidden = cur.mode === 'decor';
    $('ptSaveWear').textContent = cur.mode === 'skin' ? 'Save and wear' : 'Save and wear it';
    $('ptCard').hidden = cur.mode !== 'skin' || !SB.momentCard?.share;
    $('ptWearRow').hidden = cur.mode !== 'skin' && cur.mode !== 'accessory';
    $('ptDesk').hidden = cur.mode !== 'skin';
    $('ptPoses').hidden = cur.mode === 'decor' || cur.mode === 'effect';
    $('ptPlayOnce').hidden = !reduced() || cur.mode === 'decor' || cur.mode === 'effect';
    canvas.dataset.tool = tool;
    renderStatus();
    renderSettings();
    renderFrames();
    renderPalette();
    sizeCanvas();
    paint();
    renderChecks();
    V.renderPoses();
  }

  function renderStatus() {
    const s = statusOf(cur.mode, cur.id);
    fill($('ptStatus'), ...[T.pill(s)].filter(Boolean));
    $('ptCredit').hidden = !cur.basedOn;
    if (cur.basedOn) $('ptCredit').textContent = `Based on the gallery pack ${cur.basedOn}: it says so when you share it (CC BY 4.0 asks for the credit).`;
    $('ptWishNote').hidden = !cur.wish;
    if (cur.wish) $('ptWishNote').textContent = `Made for pack wish #${cur.wish.number}: ${cur.wish.title}.`;
  }

  // Each mode's own settings: an accessory's slot, an effect's motion, decor's kind and place.
  function renderSettings() {
    const s = settings();
    const sel = (key, label, opts) => h('label', { class: 'field-label' }, label,
      h('select', { class: 'field slim', onchange: e => setSetting(key, e.target.value) }, opts.map(([v, t]) => h('option', { value: v, text: t, selected: s[key] === v ? true : null }))));
    const num = (key, label, min, max, step = 1) => h('label', { class: 'field-label' }, label,
      h('input', { type: 'number', class: 'field slim', min, max, step, value: String(s[key]), onchange: e => setSetting(key, Number(e.target.value)) }));
    const out = [];
    if (cur.mode === 'accessory') out.push(sel('slot', 'Where it goes', SLOTS));
    if (cur.mode === 'effect') out.push(sel('motion', 'How it moves', MOTIONS), num('count', 'How many', 1, 24), num('speed', 'Speed', 0.25, 3, 0.25));
    if (cur.mode === 'decor') {
      out.push(sel('category', 'What it is', CATEGORIES));
      if (s.category !== 'substrate' && s.category !== 'backdrop') out.push(sel('layer', 'Where it stands', LAYERS));
    }
    if ((cur.mode === 'effect' || cur.mode === 'decor') && doc().frames.length > 1) out.push(num('fps', 'Pictures a second', 1, cur.mode === 'effect' ? 12 : 8));
    fill($('ptSettings'), ...out);
  }

  function setSetting(key, value) {
    cur.settings = { ...cur.settings, [key]: value };
    keep();
    if (key === 'category') renderSettings();
    V.resetPreviewFx();
    V.renderPreview();
  }

  function renderFrames() {
    const m = G.MODES[cur.mode];
    const box = $('ptFrames');
    box.hidden = m.frames < 2;
    if (m.frames < 2) return;
    const d = doc();
    fill(box,
      h('span', { text: 'Pictures' }),
      ...d.frames.map((_, i) => h('button', { type: 'button', class: 'pt-frame', 'aria-pressed': String(i === d.frame), title: `Picture ${i + 1}`, onclick: () => commit(G.showFrame(d, i), { record: false }) }, String(i + 1))),
      d.frames.length < m.frames ? h('button', { type: 'button', class: 'pt-frame', title: 'Add a picture, a copy of this one', 'aria-label': 'Add a picture', onclick: () => commit(G.addFrame(doc())) }, '+') : null,
      d.frames.length > 1 ? h('button', { type: 'button', class: 'pt-frame', title: 'Remove this picture', 'aria-label': 'Remove this picture', onclick: () => commit(G.removeFrame(doc())) }, '−') : null);
  }

  // ------------------------------------------------------------ the palette

  function renderPalette() {
    const d = doc();
    const m = G.MODES[cur.mode];
    const swatch = (ch, hex, part) => h('button', {
      type: 'button', role: 'option', class: `pt-swatch${ch === G.EMPTY ? ' eraser' : ''}`, 'aria-selected': String(colour === ch),
      style: part ? `--part:${G.PART_COLOURS[part]}` : null,
      title: ch === G.EMPTY ? 'See-through (the eraser)' : `${hex}${part ? ` · ${G.PART_LABEL[part]}` : ''}`,
      dataset: { ch },
      onclick: () => { colour = ch; editing = null; adding = null; if (tool === 'eraser' || tool === 'picker' || tool === 'move' || tool === 'pivot') tool = 'pencil'; renderEditor(); },
    }, h('i', { style: ch === G.EMPTY ? null : `background:${hex}` }), ch === G.EMPTY ? 'none' : part ? G.PART_LABEL[part] : '');
    const pal = Object.entries(d.palette);
    const full = pal.length >= m.palette;
    fill($('ptPalette'),
      swatch(G.EMPTY, null, null),
      ...pal.map(([ch, hex]) => swatch(ch, hex, m.parts ? d.parts[ch] || null : null)),
      full ? null : h('button', { type: 'button', class: 'pt-swatch add', title: `Add a colour (up to ${m.palette})`, 'aria-label': 'Add a colour', onclick: startAdding }, '+'));
    renderSwatchEdit();
  }

  function partSelect(value, onchange) {
    return h('select', { class: 'field slim', 'aria-label': 'Moves with', onchange: e => onchange(e.target.value) },
      ...G.PARTS.map(p => h('option', { value: p, text: G.PART_LABEL[p], selected: p === value ? true : null })));
  }

  // Under the palette: the picked colour's colour and part, or a new colour being added.
  function renderSwatchEdit() {
    const box = $('ptSwatchEdit');
    const m = G.MODES[cur.mode];
    const d = doc();
    if (adding) {
      fill(box,
        h('span', { text: 'New colour' }),
        h('input', { type: 'color', value: adding.hex, 'aria-label': 'Colour', oninput: e => { adding.hex = e.target.value; } }),
        m.parts ? h('span', { text: 'moves with' }) : null,
        m.parts ? partSelect(adding.part, v => { adding.part = v; }) : null,
        h('button', { type: 'button', class: 'btn slim-btn', onclick: addTheColour }, 'Add'),
        h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: () => { adding = null; renderSwatchEdit(); } }, 'Cancel'));
      return;
    }
    if (!colour || colour === G.EMPTY || !d.palette[colour]) { fill(box, ); return; }
    const inUse = G.used(d).has(colour);
    fill(box,
      h('input', {
        type: 'color', value: d.palette[colour], 'aria-label': 'Change this colour',
        oninput: e => { editing ||= { ch: colour, base: doc() }; commit(G.setColour(doc(), editing.ch, e.target.value), { record: false, quiet: true }); },
        onchange: () => { if (editing && editing.base !== doc()) hist.record(editing.base); editing = null; renderEditor(); },
      }),
      m.parts ? h('span', { text: 'moves with' }) : null,
      m.parts ? partSelect(d.parts[colour] || '', v => commit(G.setPart(doc(), colour, v))) : null,
      inUse ? null : h('button', { type: 'button', class: 'btn ghost slim-btn', title: 'Nothing is painted with it', onclick: () => { const next = G.removeColour(doc(), colour); if (next) { colour = null; commit(next); } } }, 'Remove'));
  }

  function startAdding() {
    const d = doc();
    adding = { hex: d.palette[colour] || '#ff7a5c', part: (G.MODES[cur.mode].parts && d.parts[colour]) || 'body' };
    renderSwatchEdit();
    $('ptSwatchEdit').querySelector('input[type="color"]')?.focus();
  }

  function addTheColour() {
    const r = G.addColour(doc(), adding.hex, adding.part);
    if (!r) return SB.toast(`That's every colour a ${kindLabel(cur.mode)} can have.`);
    adding = null;
    colour = r.ch;
    if (tool === 'eraser') tool = 'pencil';
    commit(r.doc);
  }

  // ------------------------------------------------------------ the canvas

  function sizeCanvas() {
    const d = doc();
    const wrap = $('ptCanvasWrap');
    const availW = Math.max(120, (wrap.clientWidth || 400) - 22);
    const availH = Math.max(160, Math.min(window.innerHeight * 0.5, 460));
    K = Math.max(2, Math.min(MAX_SCALE, Math.floor(Math.min(availW / d.w, availH / d.h))));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(d.w * K * dpr);
    canvas.height = Math.round(d.h * K * dpr);
    canvas.style.width = `${d.w * K}px`;
    canvas.style.height = `${d.h * K}px`;
  }

  let guideSkin = null;
  function paint(now = performance.now()) {
    if (!cur) return;
    const d = doc();
    const c = canvas.width / d.w;
    const at = v => Math.round(v * c);
    const cell = (x, y, fill) => { ctx.fillStyle = fill; ctx.fillRect(at(x), at(y), at(x + 1) - at(x), at(y + 1) - at(y)); };
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // See-through: a soft checker, finer when the cells are big.
    const fine = K >= GRID_FROM;
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        if (fine) {
          const hx = (at(x) + at(x + 1)) / 2, hy = (at(y) + at(y + 1)) / 2;
          ctx.fillStyle = '#1a282c'; ctx.fillRect(at(x), at(y), at(x + 1) - at(x), at(y + 1) - at(y));
          ctx.fillStyle = '#213238'; ctx.fillRect(at(x), at(y), Math.round(hx - at(x)), Math.round(hy - at(y)));
          ctx.fillRect(Math.round(hx), Math.round(hy), at(x + 1) - Math.round(hx), at(y + 1) - Math.round(hy));
        } else cell(x, y, (x + y) % 2 ? '#1a282c' : '#213238');
      }
    }
    // Classic, faintly behind: something to paint over.
    if (cur.mode === 'skin' && cur.guide) {
      guideSkin ||= state.skins.find(s => s.id === 'classic') || null;
      if (guideSkin) {
        ctx.globalAlpha = 0.22;
        guideSkin.pixels.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (guideSkin.palette[r[x]] && x < d.w && y < d.h) cell(x, y, guideSkin.palette[r[x]]); });
        ctx.globalAlpha = 1;
      }
    }
    const shown = stroke?.preview || d;
    const rows = G.rows(shown);
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) {
        const ch = r[x];
        if (ch === G.EMPTY) continue;
        if (partView && G.MODES[shown.mode].parts) cell(x, y, G.PART_COLOURS[shown.parts[ch]] || '#ff3b6b');
        else cell(x, y, shown.palette[ch] || '#ff00ff');
      }
    });
    if (fine) {
      ctx.fillStyle = 'rgba(243, 230, 204, .07)';
      for (let x = 1; x < d.w; x++) ctx.fillRect(at(x), 0, 1, canvas.height);
      for (let y = 1; y < d.h; y++) ctx.fillRect(0, at(y), canvas.width, 1);
    }
    // The accessory's pivot: the pixel that sits on its spot.
    if (cur.mode === 'accessory' && d.pivot) {
      const [px, py] = d.pivot;
      ctx.strokeStyle = '#ff7a5c'; ctx.lineWidth = Math.max(1, Math.round(c / 6));
      ctx.strokeRect(at(px) + ctx.lineWidth / 2, at(py) + ctx.lineWidth / 2, at(px + 1) - at(px) - ctx.lineWidth, at(py + 1) - at(py) - ctx.lineWidth);
    }
    // Where the brush lands.
    if (hover && !stroke && tool !== 'move' && tool !== 'fill') {
      ctx.strokeStyle = 'rgba(243, 230, 204, .8)'; ctx.lineWidth = 1;
      const cells = tool === 'pencil' || tool === 'eraser' ? G.brushCells(hover[0], hover[1], brush) : [hover];
      for (const [x, y] of cells) if (x < d.w && y < d.h) ctx.strokeRect(at(x) + 0.5, at(y) + 0.5, at(x + 1) - at(x) - 1, at(y + 1) - at(y) - 1);
    }
    // "Show me": the pixels a check is about, pulsing.
    if (flash && now < flash.until) {
      const a = reduced() ? 0.7 : 0.35 + 0.35 * Math.abs(Math.sin(now / 160));
      ctx.fillStyle = `rgba(255, 193, 94, ${a})`;
      for (const [x, y] of flash.cells) if (x >= 0 && y >= 0 && x < d.w && y < d.h) cell(x, y, ctx.fillStyle);
      requestAnimationFrame(t => paint(t));
    } else if (flash) { flash = null; }
  }

  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const d = doc();
    return [Math.floor(((e.clientX - r.left) / r.width) * d.w), Math.floor(((e.clientY - r.top) / r.height) * d.h)];
  }
  const inGrid = ([x, y]) => x >= 0 && y >= 0 && x < doc().w && y < doc().h;

  function pick([x, y]) {
    const ch = G.at(doc(), x, y);
    if (ch === null) return;
    colour = ch;
    if (tool === 'picker') tool = ch === G.EMPTY ? 'eraser' : 'pencil';
    renderEditor();
  }

  const inkOf = () => (tool === 'eraser' ? G.EMPTY : colour);

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (!cur || (e.button !== 0 && e.button !== 2)) return;
    e.preventDefault();
    const at = cellAt(e);
    if (e.button === 2) { pick(at); return; } // right-click is always the eyedropper
    canvas.setPointerCapture(e.pointerId);
    const base = doc();
    if (tool === 'picker') { pick(at); return; }
    if (tool === 'pivot') { commit(G.setPivot(base, at[0], at[1])); return; }
    if (tool === 'fill') {
      if (!inGrid(at)) return;
      const ch = colour ?? G.EMPTY;
      if (ch !== G.EMPTY && !base.palette[ch]) return SB.toast('Pick a colour first.');
      commit(G.fill(base, at[0], at[1], ch));
      return;
    }
    stroke = { base, start: at, last: at, preview: null };
    if (tool === 'pencil' || tool === 'eraser') {
      if (tool === 'pencil' && (colour === null || (colour !== G.EMPTY && !base.palette[colour]))) { stroke = null; return SB.toast('Pick a colour first.'); }
      setDoc(G.paint(base, G.brushCells(at[0], at[1], brush), inkOf()));
    }
    if (tool === 'line') stroke.preview = G.paint(base, G.brushCells(at[0], at[1], brush), colour ?? G.EMPTY);
    paint();
  });

  canvas.addEventListener('pointermove', e => {
    if (!cur) return;
    const at = cellAt(e);
    const moved = !hover || hover[0] !== at[0] || hover[1] !== at[1];
    hover = inGrid(at) ? at : null;
    if (!stroke) { if (moved) paint(); return; }
    if (!moved && tool !== 'move') return;
    const { base, start, last } = stroke;
    if (tool === 'pencil' || tool === 'eraser') {
      // A fast stroke skips cells: join them with a line, so it never breaks up.
      const cells = G.lineCells(last[0], last[1], at[0], at[1]).flatMap(([x, y]) => G.brushCells(x, y, brush));
      setDoc(G.paint(doc(), cells, inkOf()));
    } else if (tool === 'line') {
      stroke.preview = G.paint(base, G.lineCells(start[0], start[1], at[0], at[1]).flatMap(([x, y]) => G.brushCells(x, y, brush)), colour ?? G.EMPTY);
    } else if (tool === 'move') {
      const next = G.move(base, at[0] - start[0], at[1] - start[1]);
      if (next) setDoc(next); // pushing a pixel off the edge: it stops at the edge
    }
    stroke.last = at;
    paint();
  });

  function endStroke() {
    if (!stroke) return;
    const { base, preview } = stroke;
    stroke = null;
    if (preview) setDoc(preview);
    if (doc() !== base) { hist.record(base); afterChange(); }
    paint();
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', () => { if (!stroke) { hover = null; paint(); } });

  // ------------------------------------------------------------ changes, undo and drafts

  // During a stroke: the drawing changes, the preview follows, nothing is recorded yet.
  function setDoc(next) {
    if (!next || next === doc()) return;
    cur.doc = next;
    V.renderPreview();
  }

  /** One change: recorded for undo (unless record is false), kept as a draft, everything redrawn. */
  function commit(next, { record = true, quiet = false } = {}) {
    if (!next || next === doc()) return false;
    if (record) hist.record(doc());
    cur.doc = next;
    if (quiet) { paint(); V.renderPreview(); keep(); return true; }
    afterChange();
    return true;
  }

  function afterChange() {
    keep();
    renderEditor();
    V.renderPreview();
  }

  function undo() { const back = hist.undo(doc()); if (back) { cur.doc = back; afterChange(); } }
  function redo() { const fwd = hist.redo(doc()); if (fwd) { cur.doc = fwd; afterChange(); } }

  // The draft, a second after the last change (closing the panel or a crash loses nothing).
  function keep() {
    clearTimeout(draftTimer);
    $('ptKept').textContent = '';
    draftTimer = setTimeout(flushDraft, DRAFT_MS);
  }
  async function flushDraft() {
    clearTimeout(draftTimer);
    draftTimer = 0;
    if (!cur) return;
    const r = await api.saveDraft({ ...cur, doc: doc() }).catch(() => null);
    if (r?.ok) {
      $('ptKept').textContent = 'Draft kept';
      drafts = [r.draft, ...drafts.filter(d => d.id !== r.draft.id)];
    }
  }
  const pendingDraft = () => draftTimer !== 0;

  // The name gives a new drawing its id, until it's saved (then the id stays).
  function rename(name) {
    cur.name = name;
    if (!cur.saved) {
      const id = `${G.slug(name) || (cur.mode === 'skin' ? 'crab' : prefix(cur.mode))}-${tailOf(cur.id)}`;
      if (id !== cur.id) {
        const old = cur.id;
        cur.id = id;
        if (drafts.some(d => d.id === old)) { api.deleteDraft(old); drafts = drafts.filter(d => d.id !== old); }
      }
    }
    keep();
    renderChecks();
  }
  $('ptName').addEventListener('input', e => rename(e.target.value));
  $('ptAuthor').addEventListener('input', e => { cur.author = e.target.value; keep(); renderChecks(); });
  $('ptDesc').addEventListener('input', e => { cur.description = e.target.value; keep(); });

  // ------------------------------------------------------------ checks

  function renderChecks() {
    if (!cur) return;
    const list = checksNow();
    const verdict = G.verdict(list);
    const why = c => (c.blocks === 'save' ? 'stops Save' : c.blocks === 'share' ? 'stops Share' : c.onPurpose ? 'on purpose' : '');
    fill($('ptChecks'), ...list.map(c => h('li', { class: `pt-check ${c.onPurpose ? 'purpose' : c.level}`, dataset: { check: c.id } },
      h('span', { class: 'pt-check-text', text: c.text }),
      why(c) ? h('span', { class: 'pt-check-why', text: why(c) }) : null,
      c.cells.length ? h('button', { type: 'button', class: 'link-btn', onclick: () => showMe(c) }, 'Show me') : null,
      c.level === 'warning' ? h('button', { type: 'button', class: 'link-btn', onclick: () => onPurpose(c.id) }, c.onPurpose ? 'Not on purpose' : 'That’s on purpose') : null)));
    $('ptSave').disabled = !verdict.save;
    $('ptSaveWear').disabled = !verdict.save;
  }

  function showMe(c) {
    flash = { cells: c.cells, until: performance.now() + FLASH_MS };
    paint();
    if (c.id === 'anchors') V.wearOutfit();
  }

  function onPurpose(id) {
    const on = cur.onPurpose.includes(id);
    cur.onPurpose = on ? cur.onPurpose.filter(x => x !== id) : [...cur.onPurpose, id];
    keep();
    renderChecks();
    if (S.open) S.renderShare();
  }

  // ------------------------------------------------------------ the menu, resize and the rest

  $('ptMenuBtn').addEventListener('click', e => SB.openMenu($('ptMenu'), e.currentTarget, () => [
    SB.menuItem('Open the web Pack Studio', 'For packs with several things in them', () => api.openPackStudio()),
    cur ? SB.menuItem('Put his anchors back', 'Where classic has his head, claw…', () => commit(G.resetAnchors(doc()))) : null,
    cur ? SB.menuItem('Back to everything you can paint', 'Your drawing is kept', back) : null,
    cur && !cur.saved ? SB.menuItem('Throw this drawing away', 'The draft goes', async () => { const d = { ...cur, doc: doc() }; await api.deleteDraft(cur.id).catch(() => {}); drafts = drafts.filter(x => x.id !== d.id); cur = null; await open(); SB.toast(`Threw away ${d.name || 'the drawing'}.`); }) : null,
  ]));

  $('ptResizeBtn').addEventListener('click', e => SB.openMenu($('ptMenu'), e.currentTarget, () => {
    const one = (edge, delta, label) => SB.menuItem(label, '', () => { const next = G.resize(doc(), edge, delta); if (next) commit(next); else SB.toast(delta > 0 ? `That's as big as a ${kindLabel(cur.mode)} gets.` : 'That\'s as small as it gets.'); });
    return [
      one('top', 1, 'Add a row at the top'), one('bottom', 1, 'Add a row at the bottom'),
      one('left', 1, 'Add a column on the left'), one('right', 1, 'Add a column on the right'),
      one('top', -1, 'Trim the top row'), one('bottom', -1, 'Trim the bottom row'),
      one('left', -1, 'Trim the left column'), one('right', -1, 'Trim the right column'),
    ];
  }));

  function setTool(t) {
    if (t === 'pivot' && cur?.mode !== 'accessory') return;
    tool = t;
    if (t === 'pencil' && colour === G.EMPTY) colour = Object.keys(doc().palette)[0] || null;
    renderEditor();
  }
  document.querySelectorAll('#ptTools [data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  document.querySelectorAll('#ptTools [data-brush]').forEach(b => b.addEventListener('click', () => { brush = Number(b.dataset.brush); renderEditor(); }));
  $('ptUndo').addEventListener('click', undo);
  $('ptRedo').addEventListener('click', redo);
  $('ptPartView').addEventListener('click', () => { partView = !partView; renderEditor(); });
  $('ptGuide').addEventListener('click', () => { cur.guide = !cur.guide; keep(); renderEditor(); });
  document.querySelectorAll('#ptModes [data-mode]').forEach(b => b.addEventListener('click', async () => {
    mode = b.dataset.mode;
    try { window.localStorage.setItem('painter.mode', mode); } catch { /* this session only */ }
    await refresh();
    renderStart();
  }));

  async function back() {
    if (pendingDraft()) await flushDraft();
    cur = null;
    V.stop();
    await open();
  }
  $('ptBack').addEventListener('click', back);

  // B E G I L M (P) pick a tool, [ ] the brush, Ctrl+Z / Ctrl+Y undo and redo,
  // and the arrow keys nudge the drawing with Move.
  const KEYS = { b: 'pencil', e: 'eraser', g: 'fill', i: 'picker', l: 'line', m: 'move', p: 'pivot' };
  document.addEventListener('keydown', e => {
    if (state.view !== 'paint' || !cur || $('ptEditor').hidden || inField(e.target) || SB.anyMenuOpen?.()) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      return;
    }
    if (e.altKey) return;
    if (KEYS[k] && !e.target.closest?.('.pt-anchor')) { e.preventDefault(); setTool(KEYS[k]); return; }
    if (e.key === '[' || e.key === ']') { e.preventDefault(); brush = e.key === '[' ? 1 : 2; renderEditor(); return; }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step && tool === 'move' && !e.target.closest?.('.pt-anchor')) {
      e.preventDefault();
      const next = G.move(doc(), step[0], step[1]);
      if (next) commit(next); else SB.announce?.('It can\'t go further that way.');
    }
  });

  // ------------------------------------------------------------ the view

  async function open() {
    await refresh();
    if (cur) { openEditor(); S.renderShare(); return; }
    renderStart();
  }

  // Editing your own skin from Settings → Look.
  async function edit(id) {
    mode = 'skin';
    SB.setView('paint');
    await refresh();
    const s = state.skins.find(x => x.id === id);
    if (s) startFromSkin(s);
  }

  api.onNews?.(n => { news = n; if (state.view === 'paint' && !cur) T.renderContest(); });
  api.onSkin?.(() => { guideSkin = null; if (state.view === 'paint' && cur && cur.mode !== 'skin') V.renderPreview(); });
  window.addEventListener('pagehide', () => { if (pendingDraft()) flushDraft(); });
  new ResizeObserver(() => { if (state.view === 'paint' && cur) { sizeCanvas(); paint(); } }).observe($('ptCanvasWrap'));

  SB.views.paint = { render: () => { open(); } };
  SB.painter = { edit, open, current: () => cur, statusOf };
})();
