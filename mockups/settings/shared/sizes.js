// Shows a prototype at the size you'd really use it: the 460px panel, a
// window, or the whole screen. The layouts inside respond to the panel's own
// width (container queries on .phone), so each size gets its own arrangement.
(function () {
  'use strict';
  const SIZES = Object.freeze([
    ['panel', 'Panel', '460 × 700'],
    ['window', 'Window', '1280 × 800'],
    ['full', 'Full screen', 'the whole window'],
  ]);
  const STORE = 'shellby-mockup-size';
  const valid = v => SIZES.some(([id]) => id === v);

  const fromUrl = new URLSearchParams(location.search).get('size');
  let saved = null;
  try { saved = localStorage.getItem(STORE); } catch { /* file:// may refuse storage; the URL still works */ }
  let size = valid(fromUrl) ? fromUrl : valid(saved) ? saved : 'panel';

  const bar = document.createElement('div');
  bar.className = 'sizer';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Prototype size');
  bar.innerHTML = `${SIZES.map(([id, name, dims]) =>
    `<button type="button" data-size="${id}" title="${dims}">${name}</button>`).join('')}<button type="button" class="fs" data-fs title="Hide the browser too (F11 works as well)" aria-label="Browser full screen">⛶</button>`;

  function apply(next, { announce = true } = {}) {
    size = next;
    document.documentElement.dataset.size = size;
    bar.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
    try { localStorage.setItem(STORE, size); } catch { /* see above */ }
    const url = new URL(location.href);
    url.searchParams.set('size', size);
    history.replaceState(history.state, '', url);
    // Let the prototype re-measure (the rail's marker, his speech bubble) once the new layout has settled.
    if (announce) requestAnimationFrame(() => requestAnimationFrame(() => dispatchEvent(new Event('resize'))));
  }

  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.size) { apply(b.dataset.size); return; }
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().then(() => { if (size !== 'full') apply('full'); });
  });

  apply(size, { announce: false });
  document.body.prepend(bar);
})();
