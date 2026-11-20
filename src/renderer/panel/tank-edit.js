/* Shellby panel — decorating his tank: the draft you work on. Everything that
   changes it is here: a piece put in from the tray (a press, Enter, or a drag
   onto the glass), moved with the mouse or the arrow keys, flipped, sent back
   or forward, put away, a style or the light picked, a bigger tank tried, and
   undo and redo. tank.js makes one editor (SB.tankEditor) with what it needs
   to draw and say things, and asks it what's going on: editing(), draft(),
   selected(), drag(). Done and Cancel stay with tank.js, which saves the
   draft. Loaded before tank.js. */
'use strict';
(function () {
  const { state, $ } = SB;
  const MAX_HISTORY = 100;
  const DRAG_START = 4;      // css px before a press becomes a drag
  const TALL = 10;           // pieces this tall go to the back row by default

  /**
   * @typedef {object} TankEditorContext
   * @property {any} stage              the stage element (classes: editing, dragging; data-dragged)
   * @property {any} hits               the layer of buttons over the glass
   * @property {any} canvas             the glass itself
   * @property {() => any} view         the tank, from main
   * @property {() => any} scene        the resolved scene (tank-paint.js), pieces and world
   * @property {(ref: string) => any} trayItem
   * @property {(id: string) => number} capacityOf
   * @property {(uid: number) => any} pieceOf
   * @property {(p: any) => string} rowName
   * @property {(why: string) => string} reason
   * @property {(n: number, one: string, many?: string) => string} plural
   * @property {(text: string, opts?: { quiet?: boolean }) => void} say
   * @property {() => number} unit      css px per art pixel
   * @property {() => void} refit       size the canvas again if the tank's size changed
   * @property {() => void} size
   * @property {() => void} redraw      the next frame paints
   * @property {() => void} renderAll
   * @property {() => void} renderHits
   * @property {() => void} renderTools
   * @property {() => void} renderTray
   * @property {() => void} renderTitle
   * @property {() => void} renderSettings
   * @property {(uid: number | string) => any} hitFor   the button over a piece (a data-uid, as a number or as read back)
   * @property {(uid: number) => void} moveHit
   * @property {(btn: any) => void} tag
   */

  /** @param {TankEditorContext} ctx */
  SB.tankEditor = function (ctx) {
    const { stage, hits, canvas, scene, trayItem, capacityOf, pieceOf, rowName, reason, plural, say, hitFor } = ctx;

    /** @type {any} */
    let draft = null;          // the layout being decorated (null while watching)
    /** @type {any[]} */
    let history = [];
    /** @type {any[]} */
    let future = [];
    /** @type {number | null} */
    let selected = null;       // uid of the piece picked in the editor
    /** @type {any} */
    let drag = null;           // { kind: 'piece' | 'new', ... }

    const clone = o => JSON.parse(JSON.stringify(o));
    const editing = () => !!draft;

    // ------------------------------------------------------------ changes

    // One step to undo, unless it changed nothing (an arrow key against the glass).
    /** @param {(d: any) => void} change  @param {{ announce?: string | null, keepFocus?: boolean }} [opts] */
    function commit(change, { announce = null, keepFocus = true } = {}) {
      const before = clone(draft);
      change(draft);
      if (JSON.stringify(before) === JSON.stringify(draft)) return;
      history.push(before);
      if (history.length > MAX_HISTORY) history.shift();
      future = [];
      afterChange(keepFocus);
      if (announce) say(announce);
    }

    function afterChange(keepFocus = true) {
      const focused = keepFocus && /** @type {HTMLElement | null} */ (document.activeElement?.closest?.('.tk-hit'))?.dataset.uid;
      if (selected && !pieceOf(selected)) selected = null;
      ctx.refit();
      ctx.renderHits();
      ctx.renderTools();
      ctx.renderTray();
      ctx.renderTitle();
      if (focused && hitFor(focused)) hitFor(focused).focus({ preventScroll: true });
      ctx.redraw();
    }

    function start() {
      if (editing()) return;
      draft = clone(ctx.view().layout);
      history = [];
      future = [];
      selected = null;
      stage.classList.add('editing');
      ctx.renderAll();
      $('tkTray').querySelector('.tk-item:not([disabled])')?.focus();
      say('Decorating. Pick something from the tray, then press Done.');
    }

    function stop() {
      draft = null;
      selected = null;
      drag = null;
      stage.classList.remove('editing');
      ctx.renderAll();
    }

    function undo() {
      if (!history.length) return;
      future.push(clone(draft));
      draft = history.pop();
      afterChange(false);
      say('Undone.');
    }
    function redo() {
      if (!future.length) return;
      history.push(clone(draft));
      draft = future.pop();
      afterChange(false);
      say('Redone.');
    }

    function select(uid) {
      selected = uid;
      ctx.renderHits();
      ctx.renderTools();
      hitFor(uid)?.focus({ preventScroll: true });
    }

    // Somewhere for a new piece: in its row, where it overlaps the least,
    // starting from the middle.
    function freeSpot(item, row) {
      const { world, pieces } = scene();
      const same = pieces.filter(p => p.layer === item.layer && (item.layer === 'back' || p.row === row));
      const span = Math.max(0, world.w - item.w);
      let best = Math.round(span / 2), bestHit = Infinity;
      for (let i = 0; i <= span; i += 2) {
        const x = Math.round(span / 2 + (i % 4 === 0 ? i / 2 : -i / 2));
        if (x < 0 || x > span) continue;
        const hit = same.reduce((n, p) => n + Math.max(0, Math.min(x + item.w, p.x + p.w) - Math.max(x, p.x)), 0);
        if (hit < bestHit) { best = x; bestHit = hit; if (!hit) break; }
      }
      return best;
    }
    const defaultRow = item => (item.layer === 'float' ? 1 : item.layer === 'back' || item.h >= TALL ? 0 : 2);

    function canAdd(item) {
      if (!item || item.locked) return 'locked';
      if (draft.placed.length >= capacityOf(draft.size)) return 'full';
      const used = draft.placed.filter(p => p.ref === item.ref).length;
      if (item.max !== null && used >= item.max) return 'not-enough';
      return null;
    }

    /** @param {string} ref  @param {{ x: number, row: number } | null} [at] where it was dropped, else the first good spot */
    function add(ref, at = null) {
      const item = trayItem(ref);
      const why = canAdd(item);
      if (why === 'full') return say(`His tank is full: ${plural(capacityOf(draft.size), 'piece')}. Put something away, or try a bigger tank.`);
      if (why) return say(`${item?.name || 'That'} can’t go in: ${reason(why)}.`);
      const row = at ? at.row : defaultRow(item);
      const uid = draft.placed.reduce((m, p) => Math.max(m, p.uid), 0) + 1;
      const x = at ? at.x : freeSpot(item, row);
      commit(d => { d.placed.push({ uid, ref, x, row, z: topZ(d, row) + 1, flip: false }); }, { keepFocus: false, announce: `${item.name} in, ${rowName({ ...item, row })}.` });
      select(uid);
    }
    const topZ = (d, row) => d.placed.filter(p => p.row === row).reduce((m, p) => Math.max(m, p.z), 0);

    function nudge(uid, fn, words) {
      const p = pieceOf(uid);
      if (!p) return;
      const item = trayItem(p.ref);
      commit(d => {
        const q = d.placed.find(x => x.uid === uid);
        fn(q, item, scene().world);
        q.x = Math.max(0, Math.min(q.x, scene().size.w - (item?.w || 1)));
      }, { announce: words });
    }
    const moveBy = (uid, dx) => nudge(uid, q => { q.x += dx; }, null);
    const rowBy = (uid, dr) => nudge(uid, (q, item) => {
      if (item?.layer === 'back') return;
      q.row = Math.max(0, Math.min(2, q.row + dr));
    }, null);
    const flip = uid => nudge(uid, q => { q.flip = !q.flip; }, 'Flipped.');
    // Back or forward among the pieces in its row: the row is renumbered 0, 1, 2…
    // in paint order, with this one moved to the very back or the very front.
    function restack(uid, dz) {
      const p = pieceOf(uid);
      if (!p) return;
      commit(d => {
        const row = d.placed.filter(x => x.row === p.row).sort((a, b) => a.z - b.z || a.x - b.x || a.uid - b.uid);
        const me = row.find(x => x.uid === uid);
        const others = row.filter(x => x !== me);
        (dz > 0 ? [...others, me] : [me, ...others]).forEach((x, i) => { x.z = i; });
      }, { announce: dz > 0 ? 'Brought forward.' : 'Sent back.' });
    }
    function putAway(uid) {
      const p = pieceOf(uid);
      if (!p) return;
      const name = trayItem(p.ref)?.name || 'It';
      commit(d => { d.placed = d.placed.filter(x => x.uid !== uid); }, { keepFocus: false, announce: `${name} put away.` });
      selected = null;
      ctx.renderTools();
      (hits.querySelector('.tk-hit:not(.tk-hit-crab)') || $('tkDone')).focus({ preventScroll: true });
    }

    // ------------------------------------------------------------ the keyboard

    hits.addEventListener('keydown', e => {
      const btn = e.target.closest('.tk-hit');
      if (!btn || btn.classList.contains('tk-hit-crab')) return;
      const uid = Number(btn.dataset.uid);
      if (!editing()) {
        // Watching: arrow keys walk along what's in the tank.
        const all = [...hits.querySelectorAll('.tk-hit')];
        const i = all.indexOf(btn);
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        all[Math.max(0, Math.min(all.length - 1, to))].focus({ preventScroll: true });
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return; // leave the app's shortcuts alone
      const step = e.shiftKey ? 8 : 1;
      const act = {
        ArrowLeft: () => moveBy(uid, -step), ArrowRight: () => moveBy(uid, step),
        ArrowUp: () => rowBy(uid, -1), ArrowDown: () => rowBy(uid, 1),
        f: () => flip(uid), F: () => flip(uid),
        '[': () => restack(uid, -1), ']': () => restack(uid, 1),
        Delete: () => putAway(uid), Backspace: () => putAway(uid),
        Enter: () => select(uid), ' ': () => select(uid),
        Escape: () => { selected = null; ctx.renderHits(); ctx.renderTools(); },
      }[e.key];
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      if (selected !== uid && e.key.startsWith('Arrow')) selected = uid;
      act();
    });

    document.addEventListener('keydown', e => {
      if (state.view !== 'tank' || !editing() || !(e.ctrlKey || e.metaKey) || /** @type {HTMLElement | null} */ (e.target)?.closest?.('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });

    // ------------------------------------------------------------ dragging

    function artAt(e) {
      const r = canvas.getBoundingClientRect();
      const u = ctx.unit();
      return { ax: (e.clientX - r.left) / u, ay: (e.clientY - r.top) / u, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
    }
    // The row nearest the piece's foot, with the pointer at its middle.
    function rowAt(item, ay) {
      const { world } = scene();
      if (item.layer === 'back') return 0;
      const lines = item.layer === 'float' ? world.floatY : world.rows;
      const foot = ay + item.h / 2;
      let best = 0;
      lines.forEach((y, i) => { if (Math.abs(y - foot) < Math.abs(lines[best] - foot)) best = i; });
      return best;
    }

    hits.addEventListener('pointerdown', e => {
      const btn = e.target.closest('.tk-hit');
      if (!editing() || !btn || btn.classList.contains('tk-hit-crab') || e.button !== 0) return;
      const p = pieceOf(Number(btn.dataset.uid));
      if (!p) return;
      const { ax } = artAt(e);
      drag = { kind: 'piece', uid: p.uid, startX: e.clientX, startY: e.clientY, grab: ax - p.x, moved: false, id: e.pointerId, before: clone(draft) };
    });

    $('tkTray').addEventListener('pointerdown', e => {
      const btn = e.target.closest('.tk-item[data-ref]');
      if (!editing() || !btn || btn.disabled || e.button !== 0 || btn.dataset.style) return;
      drag = { kind: 'new', ref: btn.dataset.ref, startX: e.clientX, startY: e.clientY, moved: false, id: e.pointerId, over: false, x: 0, row: 0 };
    });

    document.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!(e.buttons & 1)) return endDrag(e, false);
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_START) return;
      if (!drag.moved) { drag.moved = true; stage.classList.add('dragging'); ctx.tag(null); }
      const { ax, ay, inside } = artAt(e);
      const sc = scene();
      if (drag.kind === 'piece') {
        const q = draft.placed.find(p => p.uid === drag.uid);
        const item = trayItem(q.ref);
        q.x = Math.round(Math.max(0, Math.min(sc.size.w - item.w, ax - drag.grab)));
        q.row = rowAt(item, ay);
        ctx.moveHit(q.uid);
      } else {
        const item = trayItem(drag.ref);
        drag.over = inside;
        drag.x = Math.round(Math.max(0, Math.min(sc.size.w - item.w, ax - item.w / 2)));
        drag.row = rowAt(item, ay);
      }
      ctx.redraw();
    });

    function endDrag(e, dropped = true) {
      const d = drag;
      drag = null;
      stage.classList.remove('dragging');
      if (!d) return;
      if (!d.moved) {
        // A press without a drag: a tray item goes in at the first good spot.
        if (d.kind === 'new' && dropped) add(d.ref);
        return;
      }
      stage.dataset.dragged = '1';
      setTimeout(() => { delete stage.dataset.dragged; }, 0);
      if (d.kind === 'piece') {
        // The move is one step to undo, from where it started.
        history.push(d.before);
        if (history.length > MAX_HISTORY) history.shift();
        future = [];
        selected = d.uid;
        afterChange(false);
        hitFor(d.uid)?.focus({ preventScroll: true });
      } else if (dropped && d.over) {
        add(d.ref, { x: d.x, row: d.row });
      } else {
        ctx.redraw();
      }
    }
    document.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id) endDrag(e, true); });
    document.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) endDrag(e, false); });

    // ------------------------------------------------------------ the tray and the tools

    $('tkItems').addEventListener('click', e => {
      const b = e.target.closest('.tk-item');
      if (!b || b.disabled || !b.dataset.style) return; // pieces go in on pointerup or Enter, see below
      const role = b.dataset.style, ref = b.dataset.ref;
      commit(d => { d.style[role] = ref; }, { keepFocus: false, announce: `${trayItem(ref).name} it is.` });
      [...$('tkItems').querySelectorAll('.tk-item')].find(x => x.dataset.ref === ref)?.focus();
    });
    // The keyboard's way in: Enter or Space on a piece in the tray.
    $('tkItems').addEventListener('keydown', e => {
      const b = e.target.closest('.tk-item');
      if (!b || b.dataset.style || !(e.key === 'Enter' || e.key === ' ')) return;
      e.preventDefault();
      if (!b.disabled) add(b.dataset.ref);
    });
    $('tkSizes').addEventListener('click', e => {
      const b = e.target.closest('[data-size]');
      if (!b || b.disabled || b.dataset.size === draft.size) return;
      const next = ctx.view().sizes.find(s => s.id === b.dataset.size);
      const over = draft.placed.length - next.cap;
      commit(d => {
        d.size = next.id;
        if (over > 0) d.placed = d.placed.slice(0, next.cap); // the newest go back in the tray
      }, { keepFocus: false, announce: over > 0 ? `The ${next.name.toLowerCase()} holds ${next.cap}: ${plural(over, 'piece')} went back in the tray.` : `Trying the ${next.name.toLowerCase()}.` });
      ctx.size();
      $('tkSizes').querySelector(`[data-size="${next.id}"]`)?.focus();
    });
    $('tkLight').addEventListener('click', e => {
      const b = e.target.closest('[data-light]');
      if (!b || b.dataset.light === draft.style.light) return;
      commit(d => { d.style.light = b.dataset.light; }, { keepFocus: false });
      ctx.renderSettings();
    });

    $('tkUndo').addEventListener('click', undo);
    $('tkRedo').addEventListener('click', redo);
    $('tkFlip').addEventListener('click', () => selected && flip(selected));
    $('tkBack').addEventListener('click', () => selected && restack(selected, -1));
    $('tkForward').addEventListener('click', () => selected && restack(selected, 1));
    $('tkAway').addEventListener('click', () => selected && putAway(selected));

    return {
      editing, start, stop, undo, redo, select, add,
      draft: () => draft, selected: () => selected, drag: () => drag,
      history: () => history, future: () => future,
    };
  };
})();
