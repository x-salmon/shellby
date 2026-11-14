// Shared bits for the Us mockups: the app's chrome round the page, and the
// real beach (beach-paint.js) with the real classic crab (sprite.js).
'use strict';
(function () {
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    tool: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    pulse: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
    note: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/>',
  };
  const icon = (name, size = 26) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

  // The panel's own frame: title bar, the Shellby screen's tabs, the bottom nav.
  function chrome() {
    const main = document.querySelector('main');
    const top = document.createElement('header');
    top.className = 'app-top';
    top.innerHTML = `
      <span class="app-crab" data-crab="2"></span>
      <span class="app-pill"><i></i>Ask</span>
      <nav class="app-tabs">${['Outfits', 'Trophies', 'Crew', 'Stickers', 'Finds', 'Bugdex', 'Tank', 'Us'].map(t => `<span class="${t === 'Us' ? 'on' : ''}">${t}</span>`).join('')}</nav>
      <span class="app-icons">${icon('search')}${icon('gear')}</span>`;
    const bottom = document.createElement('footer');
    bottom.className = 'app-nav';
    bottom.innerHTML = [['Shellby', null], ['Chat', 'chat'], ['Toolbox', 'tool'], ['Automate', 'bolt'], ['Health', 'pulse'], ['History', 'list'], ['Projects', 'folder'], ['Notes', 'note']]
      .map(([n, i]) => `<span class="${n === 'Shellby' ? 'on' : ''}">${i ? icon(i) : '<span class="app-crab" data-crab="1.4"></span>'}${n}</span>`).join('');
    document.body.prepend(top);
    document.body.append(bottom);
  }

  // The crab as an image the painter can draw, once.
  let crabP = null;
  function crab() {
    crabP ||= new Promise(resolve => {
      const svg = window.ShellbySprite.build(window.SKIN, {});
      const [, , w, h] = (svg.getAttribute('viewBox') || '0 0 22 13').split(' ').map(Number);
      svg.setAttribute('width', w); svg.setAttribute('height', h);
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const img = new Image();
      img.onload = () => resolve({ img, w: Math.ceil(w), h: Math.ceil(h), svg });
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    });
    return crabP;
  }

  // Every element with data-crab="<px per art pixel>" gets him as crisp SVG.
  async function crabs() {
    const { svg, w, h } = await crab();
    document.querySelectorAll('[data-crab]').forEach(el => {
      const k = Number(el.dataset.crab);
      const copy = svg.cloneNode(true);
      copy.setAttribute('width', w * k); copy.setAttribute('height', h * k);
      if (el.dataset.flip) copy.style.transform = 'scaleX(-1)';
      el.replaceChildren(copy);
    });
  }

  /**
   * Paints the beach into a canvas.
   * opts: k (screen px per art px), time, from (first art column), cols, top
   * and rows (art rows to show), crabX (where he sits), hearts, pops.
   */
  async function beach(canvas, opts = {}) {
    const v = window.BEACH;
    const { k = 6, time = 'night', from = 0, cols = v.world.width, top = 0, rows = v.world.height, crabX = v.crab.x, hearts = true, pops = [], orbAt } = opts;
    const c = await crab();
    canvas.width = cols * k; canvas.height = rows * k;
    canvas.style.width = `${cols * k}px`; canvas.style.height = `${rows * k}px`;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.scale(k, k);
    ctx.translate(-from, -top);
    const scene = { ...v, crab: { ...v.crab, x: crabX }, paintWidth: Math.max(v.world.width, from + cols), orbX: Math.round(orbAt ?? from + cols * 0.78) };
    window.SB.beachPaint.paint(ctx, scene, { time, t: 0, x0: from, x1: from + cols, still: true, hearts, pops, crab: { img: c.img, w: c.w, h: c.h, hop: 0 } });
  }

  // data-pin='{"on":"canvasId","x":198,"y":83}' puts an element's left/top on
  // that art pixel, measured in its offset parent (its own CSS centres it).
  function pins() {
    document.querySelectorAll('[data-pin]').forEach(el => {
      const p = JSON.parse(el.dataset.pin);
      const cv = document.getElementById(p.on);
      const o = JSON.parse(cv.dataset.beach || '{}');
      const k = o.k || 6;
      const box = cv.getBoundingClientRect();
      const parent = el.offsetParent.getBoundingClientRect();
      el.style.left = `${box.left - parent.left + (p.x - (o.from || 0)) * k}px`;
      el.style.top = `${box.top - parent.top + (p.y - (o.top || 0)) * k}px`;
    });
  }

  async function paintAll() {
    await Promise.all([...document.querySelectorAll('canvas[data-beach]')].map(cv => beach(cv, JSON.parse(cv.dataset.beach || '{}'))));
    pins();
    await crabs();
    document.body.dataset.ready = '1';
  }

  window.Kit = { chrome, beach, crab, crabs, pins, paintAll, icon };
  window.addEventListener('DOMContentLoaded', () => { chrome(); paintAll(); });
})();
