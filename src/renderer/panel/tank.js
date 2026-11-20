/* Shellby panel — the Tank tab of Shellby's screen: a home you decorate.
   Watching, he wanders the middle row among what you've put in. Decorating,
   you work on a draft (tank-edit.js): drag pieces in from the tray (or press
   Enter on one), move them with the mouse or the arrow keys, and press Done;
   main checks the draft (tank.js sanitize) before it's kept. The scene is one
   canvas (tank-paint.js); the buttons over it are what you can point at and
   tab to. */
'use strict';
(function () {
  const { api, state, $ } = SB;
  const P = SB.tankPaint;
  const R = SB.tankRender;    // the words and controls around the glass (tank-render.js)
  const TL = SB.tankLife;    // what he gets up to among the pieces (tank-life.js)
  const FPS = 10;            // the pixel world moves in steps, like the crab
  const WALK = 7;            // art px a second
  const HURRY = 3;           // ...and how much faster he gets out of your way when you decorate
  const DECORATING_ALPHA = 0.45;
  const TANK_SHARE = 0.5;    // of the tab's height, the most the tank takes

  const view = $('tankView'), stage = $('tkStage'), canvas = $('tkCanvas'), hits = $('tkHits');
  const ctx = canvas.getContext('2d');

  let v = null;              // the tank, from main
  let shelf = null;          // the tray's open category
  let K = 3, u = 3;          // device px and css px per art pixel
  let crab = null, crabKey = null;
  const walker = { x: 30, dir: 1, target: null, rest: 0, step: 0, hopUntil: 0, act: null, news: [], moving: null };
  // His life in it (tank-life.js): his favourite, sets on display, and what he's
  // done since main last heard (sent now and then, never every frame).
  let life = { favourite: null, sets: [] };
  const lived = { uses: {}, napped: false, n: 0 };
  const LIVED_FLUSH = 6;     // activities before main hears about them (or when you leave the tab)
  let timer = 0, lastTick = 0, dirty = true;
  let seq = 0;
  const seen = new Set();    // decor refs already reported as seen this session

  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Nobody looking (boot.js onCalm: the panel's behind your windows, you're away,
  // a game's up or the screen's locked): he holds still, like a hidden tab.
  const calm = () => document.body.classList.contains('calm');
  const plural = (n, one, many) => SB.plural(n, one, many, x => x.toLocaleString());
  const listOf = R.listOf;
  const editing = () => E.editing();
  const layout = () => E.draft() || v.layout;
  // Decorating with the light on the clock, the lights come up so you can see what you place.
  const lit = lay => (E.draft() && lay.style?.light === 'clock' ? { ...lay, style: { ...lay.style, light: 'day' } } : lay);
  const scene = () => P.resolve(lit(layout()), v);
  const trayItem = ref => v.tray.find(t => t.ref === ref);
  const capacityOf = id => (v.sizes.find(s => s.id === id) || v.size).cap;
  const pieceOf = uid => layout().placed.find(p => p.uid === uid);

  // The draft you decorate, and everything that changes it (tank-edit.js). It
  // draws and speaks through what's handed in here, and is asked what's going on.
  const E = SB.tankEditor({
    stage, hits, canvas, view: () => v, scene, trayItem, capacityOf, pieceOf, rowName: p => rowName(p), reason: r => reason(r), plural, say,
    unit: () => u, refit: () => { if (scene().size.w !== canvas.width / K) size(); }, size, redraw: () => { dirty = true; kick(); },
    renderAll, renderHits, renderTools, renderTray, renderTitle: () => renderTitle(), renderSettings: () => renderSettings(),
    hitFor: uid => hitFor(uid), moveHit, tag: btn => tag(btn),
  });

  // ------------------------------------------------------------ sizing

  function size() {
    if (!v) return;
    const { world } = scene();
    const dpr = window.devicePixelRatio || 1;
    const room = SB.tankRoom?.fit(); // the stage, less the controls above it (tank-room.js); else half the tab
    const pad = parseFloat(getComputedStyle(stage).paddingLeft) * 2 || 0;
    const cssW = room ? room.w : (stage.clientWidth || 420) - pad;
    const cssH = room ? room.h : (view.clientHeight || 600) * TANK_SHARE;
    K = Math.max(1, Math.floor(Math.min((cssW * dpr) / world.w, (cssH * dpr) / world.h)));
    u = K / dpr;
    canvas.width = world.w * K;
    canvas.height = world.h * K;
    canvas.style.width = `${world.w * u}px`;
    canvas.style.height = `${world.h * u}px`;
    hits.style.width = canvas.style.width;
    hits.style.height = canvas.style.height;
    walker.x = Math.min(walker.x, Math.max(0, world.w - (crab?.w || 22)));
    dirty = true;
  }

  // ------------------------------------------------------------ him

  async function loadCrab() {
    const key = `${state.skin?.name}|${JSON.stringify(state.outfit || {})}`;
    if (!state.skin || !SB.cardKit || key === crabKey) return;
    crabKey = key;
    const svg = SB.sprite(state.skin, { fit: true });
    const [, , w, hh] = (svg.getAttribute('viewBox') || '0 0 22 13').split(' ').map(Number);
    try {
      const img = await SB.cardKit.svgImage(svg, Math.ceil(w), Math.ceil(hh));
      if (key !== crabKey) return; // a newer outfit is on its way
      crab = { img, w: Math.ceil(w), h: Math.ceil(hh) };
    } catch {
      if (key !== crabKey) return;
      crab = null; // the tank still stands without him
      crabKey = null; // ...and he's tried again next time
    }
    dirty = true;
    keepingFocus(renderHits);
    kick();
  }

  // He wanders: picks somewhere, walks there, has a look, picks again. Now and
  // then the somewhere is a piece, so he seems to visit things. Decorating,
  // he steps over to the side and watches.
  function walk(dt, now) {
    if (!crab || !v) return;
    const { world, pieces } = scene();
    const maxX = Math.max(0, world.w - crab.w - 1);
    if (editing()) { walker.target = sideX(); walker.act = null; }
    if (walker.target === null) {
      if (now < walker.rest) return;
      if (walker.act) finishAct();
      const act = !editing() && TL ? TL.pick({ spots: TL.spotsOf(pieces), night: P.timeOf(scene().style.light) === 'night', favourite: life.favourite, news: walker.news, crabW: crab.w, maxX }) : null;
      if (act) {
        walker.act = { ...act, start: 0 };
        walker.news = walker.news.filter(u => u !== act.uid);
        walker.target = act.x;
        return;
      }
      const floorPieces = pieces.filter(p => p.layer !== 'float');
      const visit = floorPieces.length && Math.random() < 0.55 ? floorPieces[Math.floor(Math.random() * floorPieces.length)] : null;
      const x = visit ? visit.x + visit.w / 2 - crab.w / 2 : Math.random() * maxX;
      walker.target = Math.round(Math.min(maxX, Math.max(1, x)));
    }
    const d = walker.target - walker.x;
    if (Math.abs(d) < 0.5) {
      walker.x = walker.target;
      walker.target = null;
      walker.rest = now + (walker.act ? walker.act.ms : 1500 + Math.random() * 3500);
      if (walker.act) { walker.act.start = now; say(TL.describe(walker.act), { quiet: true }); SB.tankRoom?.doing(TL.describe(walker.act)); }
      return;
    }
    walker.dir = Math.sign(d);
    walker.x += walker.dir * Math.min(Math.abs(d), WALK * (editing() ? HURRY : 1) * dt);
    walker.step += dt;
    dirty = true;
  }

  function crabArt(now, still) {
    if (!crab) return null;
    const moving = walker.target !== null && !still;
    const hop = now < walker.hopUntil ? 2 : moving && Math.floor(walker.step * 4) % 2 ? 1 : 0;
    // Doing something with a piece: sitting on it, peeking out of it...
    const a = walker.act;
    const pose = !still && a?.start && TL ? TL.pose(a, now - a.start, { crabY: scene().world.crabY, crabH: crab.h }) : null;
    const dir = pose?.face || walker.dir;
    // Moving day: he scuttles in last, from the left.
    const inX = walker.moving ? -crab.w + (walker.x + crab.w) * walker.moving.crabIn : null;
    // Decorating, he's see-through, so nothing hides behind him while you place it.
    return {
      ...crab, x: still ? stillX() : inX ?? walker.x, flip: dir < 0 && !still, hop: Math.max(hop, pose?.hop || 0),
      lift: pose?.lift || 0, crop: pose ? pose.crop : null, z: !!pose?.z, front: !!pose?.front, alpha: editing() ? DECORATING_ALPHA : 1,
    };
  }

  // An activity done: it counts toward his favourite. Main hears every few.
  function finishAct() {
    const a = walker.act;
    walker.act = null;
    if (!a || !a.start || a.kind === 'look') return;
    lived.uses[a.uid] = (lived.uses[a.uid] || 0) + 1;
    if (a.kind === 'sleep') lived.napped = true;
    if (++lived.n >= LIVED_FLUSH) flushLived();
  }
  function flushLived() {
    if (!lived.n || !api.tankLived) return;
    const report = { uses: { ...lived.uses }, napped: lived.napped };
    lived.uses = {}; lived.napped = false; lived.n = 0;
    api.tankLived(report).then(r => { if (r) { life = r; renderLife(); } }).catch(() => {});
  }

  // z's over him while he sleeps, in art pixels.
  function snooze(c, now) {
    const y0 = scene().world.crabY - c.h + 1 - c.lift - 3;
    const k = Math.floor(now / 700) % 3;
    ctx.fillStyle = '#e8f4ff';
    for (let i = 0; i <= k; i++) {
      const x = Math.round(c.x + c.w - 4 + i * 3), y = y0 - i * 3;
      ctx.fillRect(x, y, 3, 1); ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x, y + 2, 3, 1);
    }
  }
  // With the motion turned down he sits by the biggest thing in the tank, or
  // off to the side while you decorate, out of your way.
  const sideX = () => Math.max(0, scene().world.w - (crab?.w || 22) - 1);
  const favX = () => { const p = life.favourite && scene().pieces.find(x => x.uid === life.favourite); return p ? p.x + p.w / 2 : null; };
  const stillX = () => (editing() ? sideX() : Math.max(0, Math.min((favX() ?? v?.focusX ?? 40) - (crab?.w || 22) / 2 + 12, sideX())));

  function pet() {
    api.critter.pet();
    if (reduced()) return; // he's petted all the same, just without the hop
    walker.hopUntil = performance.now() + 350;
    kick();
  }

  // ------------------------------------------------------------ the loop

  // Ten frames a second while you're looking (plants sway, bubbles rise, he
  // walks); one still frame when the motion is turned down or the panel is
  // calm (he doesn't get up to anything, so nothing counts toward his
  // favourite); nothing at all when the tab is hidden or you're somewhere else.
  const kick = () => { if (!timer) timer = setTimeout(tick, 0); };

  function tick() {
    timer = 0;
    if (state.view !== 'tank' || !v || document.hidden) { flushLived(); return; }
    const now = performance.now();
    const drag = E.drag();
    // Calm: the frame as it stands, where he stands (no jump to his still spot).
    if (calm() && !drag) { flushLived(); draw(now, reduced()); dirty = false; lastTick = 0; return; }
    const dt = lastTick ? Math.min(0.25, (now - lastTick) / 1000) : 0;
    lastTick = now;
    const still = reduced();
    if (!still) walk(dt, now);
    if (dirty || !still || drag) draw(now, still);
    dirty = false;
    if (!still || drag || now < walker.hopUntil) timer = setTimeout(tick, 1000 / FPS);
    else lastTick = 0;
  }

  function draw(now, still) {
    const sc = scene();
    ctx.setTransform(K, 0, 0, K, 0, 0);
    ctx.clearRect(0, 0, sc.world.w, sc.world.h);
    let ghost = null;
    const drag = E.drag();
    if (drag?.kind === 'new' && drag.over) {
      const it = trayItem(drag.ref);
      ghost = { ...it, uid: 0, x: drag.x, row: drag.row, y: P.baseline(sc.world, it.layer, drag.row), flip: false };
    }
    const c = crabArt(now, still);
    P.paint(ctx, movingScene(sc, now), { t: still ? 0 : now / 1000, still, crab: c, ghost, gauges: SB.tankGauges?.current() || null });
    if (c?.z) snooze(c, now);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const crabBtn = hits.querySelector('.tk-hit-crab');
    if (crabBtn && crab) {
      const a = crabArt(now, still);
      crabBtn.style.left = `${a.x * u}px`;
      crabBtn.style.top = `${(sc.world.crabY - crab.h + 1) * u}px`;
    }
  }

  // Moving day: the pieces hop across into the new tank one by one, then he follows.
  function movingScene(sc, now) {
    if (!walker.moving || !TL) return sc;
    const m = TL.moving(sc.pieces, now - walker.moving.start);
    walker.moving.crabIn = m.crabIn;
    if (m.done) { walker.moving = null; return sc; }
    return { ...sc, pieces: sc.pieces.filter(p => m.dy.get(p.uid) !== null).map(p => ({ ...p, y: p.y - (m.dy.get(p.uid) || 0) })) };
  }

  const renderLife = () => R.renderLife({ v, life, editing: editing() });

  // ------------------------------------------------------------ what you can point at

  const rowName = p => R.rowName(v, p);

  function renderHits() {
    if (!v) return;
    const pieces = scene().pieces;
    const selected = E.selected();
    R.renderHits({ v, hits, pieces, edit: editing(), selected, u, crab });
    SB.tankRoom?.render({ editing: editing(), u, pieces });
    SB.tankRoom?.placePicked(selected && hitFor(selected));
  }

  const tag = btn => R.tag(btn, !!E.drag());
  const hitFor = uid => hits.querySelector(`.tk-hit[data-uid="${uid}"]`);
  // A piece being dragged: its button follows it, without being rebuilt.
  function moveHit(uid) {
    const p = scene().pieces.find(x => x.uid === uid), b = hitFor(uid);
    if (!p || !b) return;
    b.style.left = `${(p.x - 1) * u}px`;
    b.style.top = `${(p.y - p.h) * u}px`;
    SB.tankRoom?.placePicked(uid === E.selected() ? b : null);
  }

  hits.addEventListener('pointerover', e => tag(e.target.closest('.tk-hit')));
  hits.addEventListener('pointerout', e => { if (!e.relatedTarget?.closest?.('.tk-hit')) tag(document.activeElement?.closest?.('.tk-hit')); });
  hits.addEventListener('focusin', e => tag(e.target.closest('.tk-hit')));
  hits.addEventListener('focusout', () => tag(null));
  hits.addEventListener('click', e => {
    const btn = e.target.closest('.tk-hit');
    if (!btn || stage.dataset.dragged) return;
    if (btn.classList.contains('tk-hit-crab')) return pet();
    if (editing()) E.select(Number(btn.dataset.uid));
  });

  // ------------------------------------------------------------ done decorating

  // Rebuilding the buttons mustn't throw away where the keyboard was.
  // The pieces, the crab, the tray's items and its shelves carry data-keep for it.
  const keepingFocus = render => SB.keepFocus($('tankView'), render, { preventScroll: true });

  let saving = 0;
  async function done() {
    const n = ++saving;
    let r;
    try {
      r = await api.saveTank(E.draft());
    } catch {
      // Keep the draft: nothing is lost, and Done can be pressed again.
      $('tkNote').textContent = 'Couldn’t save his tank just now. Your changes are still here; try Done again.';
      $('tkNote').hidden = false;
      return say($('tkNote').textContent);
    }
    if (n !== saving) return; // Done was pressed again: that answer wins
    if (!r?.ok) {
      $('tkNote').textContent = r?.error || 'Couldn’t save his tank just now.';
      $('tkNote').hidden = false;
      return say($('tkNote').textContent);
    }
    if (r?.view) v = r.view;
    E.stop();
    reactTo(r?.life);
    const dropped = r?.dropped || [];
    $('tkNote').textContent = dropped.length ? `${plural(dropped.length, 'piece')} couldn’t go in: ${listOf([...new Set(dropped.map(d => reason(d.reason)))])}.` : '';
    $('tkNote').hidden = !dropped.length;
    say(dropped.length ? $('tkNote').textContent : 'Saved. He’s having a look round.');
    document.dispatchEvent(new CustomEvent('sb:tank', { detail: v }));
    $('tkDecorate').focus();
  }
  // A new piece gets a look; a bigger tank is moving day. (Main says his line on the desktop.)
  function reactTo(l) {
    if (!l) return;
    walker.news = (l.news || []).slice(0, 3);
    walker.act = null;
    walker.target = null;
    walker.rest = 0;
    if (l.movedTo && !reduced()) walker.moving = { start: performance.now(), crabIn: 0 };
    if (l.sets?.length) SB.toast?.(`On display: ${listOf(l.sets)}.`);
    refreshLife();
  }
  const refreshLife = () => api.tankLife?.().then(r => { if (r) { life = r; renderLife(); } }).catch(() => {});

  const reason = r => ({ full: 'the tank was full', locked: 'it’s locked', 'not-enough': 'he hasn’t found enough of it', unknown: 'it isn’t installed' }[r] || 'it doesn’t go there');

  function cancel() {
    E.stop();
    say('Put back as it was.');
    $('tkDecorate').focus();
  }

  // ------------------------------------------------------------ words and controls around it

  // What he's up to is said at most every half a minute; what you did, straight away.
  let quietAt = 0;
  function say(text, { quiet = false } = {}) {
    if (quiet) { const t = performance.now(); if (t < quietAt) return; quietAt = t + 30000; }
    $('tkLive').textContent = ''; requestAnimationFrame(() => { $('tkLive').textContent = text; });
  }

  const renderTitle = () => R.renderTitle({ v, lay: layout(), names: scene().pieces.map(p => p.name), editing: editing(), canvas });
  const renderKey = () => R.renderKey({ v, editing: editing() });

  function renderTools() {
    const edit = editing();
    const draft = E.draft(), selected = E.selected();
    const p = edit && selected && pieceOf(selected);
    R.renderTools({ edit, history: E.history(), future: E.future(), item: p && trayItem(p.ref) });
    if (edit) $('tkCount').textContent = `${draft.placed.length} of ${plural(capacityOf(draft.size), 'piece')}`;
    SB.tankRoom?.placePicked(p && hitFor(selected));
  }

  function renderTray() {
    $('tkTray').hidden = !editing();
    if (!editing()) return;
    const draft = E.draft();
    shelf = R.renderTray({ v, draft, shelf, seen, capacity: capacityOf(draft.size) });
    // Seen once it’s on screen.
    const fresh = v.tray.filter(t => t.category === shelf && t.isNew && !t.locked && t.kind === 'decor' && !seen.has(t.ref)).map(t => t.ref);
    if (fresh.length) { fresh.forEach(r => seen.add(r)); api.tankSeen(fresh); }
    renderSettings();
  }

  const renderSettings = () => R.renderSettings({ v, draft: E.draft() });

  $('tkShelves').addEventListener('click', e => {
    const b = e.target.closest('[data-shelf]');
    if (!b) return;
    shelf = b.dataset.shelf;
    renderTray();
    $('tkShelves').querySelector(`[data-shelf="${shelf}"]`)?.focus();
  });

  $('tkDecorate').addEventListener('click', E.start);
  $('tkDone').addEventListener('click', done);
  $('tkCancel').addEventListener('click', cancel);

  // ------------------------------------------------------------ data in

  function badge() {
    document.querySelectorAll('.tk-badge').forEach(el => { el.hidden = !v?.news.length; });
  }

  // ------------------------------------------------------------ on your calling card (tank-share.js)

  const renderShare = () => R.renderShare({ v, state });

  // Not disabled while it saves: a disabled switch would drop keyboard focus.
  let sharing = false;
  $('tkShare').addEventListener('change', async e => {
    const on = e.target.checked;
    if (sharing) { e.target.checked = !on; return; }
    sharing = true;
    const r = await api.shareTank(on).catch(() => null);
    sharing = false;
    if (r?.view) apply(r.view);
    if (!r?.ok) { e.target.checked = !on; SB.toast('Couldn’t change that. Try again in a moment.'); return; }
    SB.toast(on ? 'His tank goes on your cards when they next update.' : 'His tank comes off your cards when they next update, in a minute or so.');
  });

  function renderAll() {
    if (!v) return;
    size();
    renderTitle();
    renderTools();
    renderHits();
    renderTray();
    renderKey();
    renderShare();
    SB.tankLayouts?.render();
    renderLife();
    dirty = true;
    kick();
  }

  // The newest answer wins: an older fetch arriving late is dropped.
  async function fetchTank() {
    const n = ++seq;
    const next = await api.getTank();
    return n === seq ? next : null;
  }

  function apply(next) {
    if (!next) return;
    v = next;
    badge();
    const draft = E.draft();
    if (draft && draft.size !== v.layout.size && !v.sizes.find(s => s.id === draft.size)?.unlocked) draft.size = v.layout.size;
    if (state.view === 'tank') keepingFocus(renderAll);
    document.dispatchEvent(new CustomEvent('sb:tank', { detail: v })); // the Health porthole and the profile card
  }

  async function open() {
    SB.tankRoom?.open();
    SB.tankGauges?.refresh();
    refreshLife();
    apply(await fetchTank());
    SB.tankLayouts?.open(); // a new season may put a saved layout up (tank-layouts.js)
    SB.tankTidy?.open();    // ...and he may have tidied (tank-tidy.js)
    await loadCrab();
    if (v && !editing() && !walker.target) walker.x = stillX();
    if (pendingPiece) showPiece();
  }

  // A milestone piece just earned (docs/TANK.md#milestones): "Put it in the tank" opens
  // the tray on the Milestones shelf with that piece picked out.
  let pendingPiece = null;
  function showPiece() {
    const ref = pendingPiece;
    pendingPiece = null;
    if (!v?.tray.some(t => t.ref === ref && !t.locked)) return;
    shelf = 'milestone';
    if (editing()) renderTray(); else E.start();
    const btn = $('tkItems').querySelector(`[data-ref="${CSS.escape(ref)}"]`);
    btn?.classList.add('tk-flash');
    btn?.focus();
  }
  api.onUnlocked?.(e => {
    const piece = (e?.rewards || []).find(r => r?.kind === 'decor' && r.packId === 'milestones');
    if (piece) SB.toast(`${e.achievement.icon} New milestone piece: ${piece.name}`, { action: 'Put it in the tank', ms: 8000, onAction: () => { pendingPiece = piece.key; if (state.view === 'tank') fetchTank().then(apply).then(showPiece); else SB.setView('tank'); } });
  });

  // New decor unlocking, a find, or a different outfit changes what's shown.
  let refetch = 0;
  const later = () => { clearTimeout(refetch); refetch = setTimeout(() => fetchTank().then(apply), state.view === 'tank' ? 500 : 4000); };
  api.onWardrobe?.(later);
  api.onUnlocked?.(later);
  api.onLife?.(later);
  api.onSkin?.(() => { crabKey = null; if (state.view === 'tank') loadCrab(); });
  const resized = new ResizeObserver(() => { if (state.view === 'tank' && v) { size(); keepingFocus(renderHits); kick(); } });
  resized.observe(stage);
  resized.observe(view); // a taller or shorter window changes his share, not the stage's width
  resized.observe($('tkBar')); // ...and so do the controls over the glass, when they change height
  document.addEventListener('visibilitychange', kick);
  // ...and the calm lifting (or falling) is the same: back to life, or one still frame.
  let wasCalm = calm();
  new MutationObserver(() => { if (calm() !== wasCalm) { wasCalm = calm(); kick(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('sb:tank-gauges', () => { dirty = true; kick(); }); // live decor changed (tank-gauges.js)
  window.addEventListener('pagehide', flushLived); // what he did while you watched, before the panel goes
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => { dirty = true; kick(); });

  SB.views.tank = { render: () => { open(); } };
  SB.tankView = () => v;
  SB.tankApply = apply;          // a saved layout went up (tank-layouts.js)
  SB.tankEditing = editing;
  api.getTank().then(next => { if (next) { v = next; badge(); document.dispatchEvent(new CustomEvent('sb:tank', { detail: v })); } });
})();
