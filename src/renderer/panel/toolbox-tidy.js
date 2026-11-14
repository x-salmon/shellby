/* Shellby panel — Toolbox, wide. With room (a big window, full screen), a list
   of skills, agents and commands gets a rail down its left (where they come
   from, and the orders: the two pickers, which it stands in for) and a pane on
   its right with the open row's details, one row at a time. toolbox.js draws
   the list and calls show() on every render; init gives this file the pieces
   of a row it needs. */
'use strict';
(function () {
  const { h, $ } = SB;
  const WIDE_PX = 900; // the panel's own 460 and a half-screen window stay one column
  /** @type {any} */
  let ctx = null;
  let wide = false;

  function init(c) {
    ctx = c;
    // A hidden view measures 0, so this also fires as the Toolbox opens.
    new ResizeObserver(([e]) => {
      const now = e.contentRect.width >= WIDE_PX;
      if (now === wide) return;
      wide = now;
      if (SB.state.view === 'toolbox') ctx.render();
    }).observe($('toolboxView'));
  }

  // A button per option of a picker; pressing one picks it there, so toolbox.js's own
  // change handler does the rest. The keyboard stays on it through the redraw.
  function railButton(sel, o) {
    const n = /\((\d+)\)$/.exec(o.textContent);
    return h('button', {
      type: 'button', class: 'tool-rail-btn', 'aria-pressed': String(sel.value === o.value), dataset: { sel: sel.id, v: o.value },
      onclick: () => {
        sel.value = o.value;
        sel.dispatchEvent(new Event('change'));
        [...$('toolRail').querySelectorAll('.tool-rail-btn')].find(b => b.dataset.sel === sel.id && b.dataset.v === o.value)?.focus();
      },
    }, h('span', { text: o.textContent.replace(/\s*\(\d+\)$/, '') }), n ? h('small', { text: n[1] }) : null);
  }

  // A redraw of a box of buttons keeps the keyboard on the same one (by its place in the box).
  const focusAt = box => [...box.querySelectorAll('button')].indexOf(/** @type {any} */ (document.activeElement));
  const refocus = (box, at) => { if (at >= 0) /** @type {HTMLElement | undefined} */ (box.querySelectorAll('button')[at])?.focus({ preventScroll: true }); };
  function keep(box, draw) {
    const at = focusAt(box);
    draw();
    refocus(box, at);
  }

  function rail() {
    const src = $('toolSource');
    const sort = $('toolSort');
    const parts = [h('p', { class: 'tool-rail-h', text: 'From' })];
    for (const c of src.children) {
      if (c.tagName === 'OPTGROUP') parts.push(h('p', { class: 'tool-rail-h', text: 'Plugins' }), ...[...c.children].map(o => railButton(src, o)));
      else parts.push(railButton(src, c));
    }
    parts.push(h('p', { class: 'tool-rail-h', text: 'Order' }), ...[...sort.options].map(o => railButton(sort, o)));
    keep($('toolRail'), () => $('toolRail').replaceChildren(...parts));
  }

  // Closing goes through toolbox.js, which owns which row is open (it may be folded away or
  // past the first page), and puts the keyboard back on that row when it's in the list.
  const close = () => ctx.close();

  function paneFor(t, items) {
    if (!t) {
      const used = items.filter(x => (ctx.usageOf(x)?.uses || 0) > 0).length;
      return [h('div', { class: 'tool-pane-empty' },
        h('p', { text: 'Pick one to see where it lives, what it costs and what to do about it.' }),
        h('p', { class: 'muted small', text: `${items.length} shown${ctx.hasUsage() ? `, ${used} used lately` : ''}.` }))];
    }
    return [
      h('div', { class: 'tool-pane-head' },
        h('span', { class: `kind-glyph k-${t.kind}`, 'aria-hidden': 'true', text: ctx.glyph(t) }),
        h('div', { class: 'tool-pane-title' },
          h('h3', {}, h('code', { text: ctx.name(t) })),
          h('p', { class: 'muted small', text: `${ctx.noun(t)}, ${ctx.sourceLabel(t.source)}` })),
        h('button', { class: 'icon-btn tool-pane-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: close }, '✕')),
      t.description ? h('p', { class: 'tool-pane-desc', text: t.description }) : null,
      h('div', { class: 'tool-pane-acts' }, ctx.actions(t)),
      ctx.detail(t, 'toolPaneDetail'),
    ];
  }

  /** null: not a list (or one being edited), so no rail or pane. */
  function show(list) {
    const on = !!list && wide;
    $('toolboxView').classList.toggle('tidy-wide', on);
    $('toolRail').hidden = $('toolPane').hidden = !on;
    if (!on) return;
    rail();
    // Rebuilt with the list; the keyboard stays on the same button in it.
    keep($('toolPane'), () => $('toolPane').replaceChildren(...paneFor(list.open, list.items).filter(Boolean)));
  }

  // Esc in the pane closes it, back on its row.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !wide || !$('toolPane').contains(/** @type {Node} */ (e.target))) return;
    e.preventDefault();
    close();
  });

  SB.toolboxTidy = { init, show, keep, focusAt, refocus, isWide: () => wide };
})();
