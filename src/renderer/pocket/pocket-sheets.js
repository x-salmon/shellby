/* Shellby on your phone — the sheets: one at a time over the screen, let go
   with a tap on the scrim, a drag down on the grab or Escape, and the
   yes-or-no one (confirmSheet) every screen asks before something that can't
   be undone. pocket.js hands in what it shares with the other screens. */
'use strict';
(function (root) {
  root.PocketSheets = ({ S, h, reduced, sheetRoot, actButton }) => {
    function openSheet(spec) {
      closeSheet(true);
      const scrim = h('div', { class: 'scrim', onclick: () => closeSheet() });
      const panel = h('div', { class: `sheet${spec.tall ? ' tall' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.label || 'Sheet' });
      const grab = h('div', { class: 'grab', 'aria-hidden': 'true' });
      const close = () => closeSheet();
      const built = spec.build(close);
      panel.append(grab, built.el);
      sheetRoot.replaceChildren(scrim, panel);
      document.body.classList.add('sheet-open');
      requestAnimationFrame(() => { scrim.classList.add('in'); panel.classList.add('in'); });
      S.sheet = { panel, scrim, update: built.update || null, back: document.activeElement };
      // Drag it down to let it go.
      let y0 = null, dy = 0;
      grab.addEventListener('pointerdown', e => { y0 = e.clientY; dy = 0; grab.setPointerCapture(e.pointerId); panel.classList.add('dragging'); });
      grab.addEventListener('pointermove', e => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${dy}px)`; });
      const end = () => { if (y0 == null) return; y0 = null; panel.classList.remove('dragging'); panel.style.transform = ''; if (dy > 90) closeSheet(); };
      grab.addEventListener('pointerup', end);
      grab.addEventListener('pointercancel', end);
      setTimeout(() => panel.querySelector('button, textarea, input, a')?.focus({ preventScroll: true }), 50);
    }

    function closeSheet(now = false) {
      const sh = S.sheet;
      if (!sh) return;
      S.sheet = null;
      document.body.classList.remove('sheet-open');
      sh.panel.classList.remove('in');
      sh.scrim.classList.remove('in');
      const gone = () => { if (!S.sheet) sheetRoot.replaceChildren(); };
      if (now || reduced()) gone(); else setTimeout(gone, 260);
      sh.back?.focus?.({ preventScroll: true });
    }

    function confirmSheet({ title, text, yes, danger = false, then }) {
      return new Promise(resolve => {
        openSheet({ label: title, build: close => {
          const el = h('div', { class: 'confirm' },
            h('h2', { class: 'sheet-title', text: title }),
            text ? h('p', { text }) : null,
            h('div', { class: 'btns' },
              h('button', { type: 'button', class: 'btn big', text: 'Cancel', onclick: () => { close(); resolve(false); } }),
              actButton({ label: yes, cls: `${danger ? 'danger' : 'go'} big`, run: async () => { await then(); close(); resolve(true); } })));
          return { el };
        } });
      });
    }

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.sheet) closeSheet(); });

    return { openSheet, closeSheet, confirmSheet };
  };
})(window);
