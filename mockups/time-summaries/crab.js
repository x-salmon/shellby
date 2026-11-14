// The real classic crab (sprite.js + the skin from the Us mockups) into every
// element with data-crab="<px per art pixel>".
'use strict';
window.addEventListener('DOMContentLoaded', () => {
  const svg = window.ShellbySprite.build(window.SKIN, {});
  const [, , w, h] = (svg.getAttribute('viewBox') || '0 0 22 13').split(' ').map(Number);
  document.querySelectorAll('[data-crab]').forEach(el => {
    const k = Number(el.dataset.crab);
    const copy = svg.cloneNode(true);
    copy.setAttribute('width', w * k);
    copy.setAttribute('height', h * k);
    copy.style.imageRendering = 'pixelated';
    if (el.dataset.flip) copy.style.transform = 'scaleX(-1)';
    el.replaceChildren(copy);
  });
});
