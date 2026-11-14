// Shellby Pages — the full-screen deck. Static mockups only: none of this ships.
// Each .screen is one mockup at 2560 x 1440 (a 4K monitor at 150%). The deck
// shows one at a time, scales it to the window, steps through all 49 across
// the seven files, and fills in the parts every screen shares: the title bar
// (<header class="tb" data-mode="Ask first">) and the rail
// (<nav class="rail" data-on="pages" data-sub="print" data-pages="print,radar">).
(function () {
  'use strict';

  const W = 2560;
  const H = 1440;
  const IDLE_MS = 2600;
  const FILES = Object.freeze([
    { file: '1-shelf.html', name: 'The shelf', from: 1, to: 7 },
    { file: '2-running.html', name: 'Running a page', from: 8, to: 14 },
    { file: '3-building.html', name: 'Building with Claude', from: 15, to: 21 },
    { file: '4-agents.html', name: 'Agents and pages', from: 22, to: 28 },
    { file: '5-access.html', name: 'Access and safety', from: 29, to: 35 },
    { file: '6-phone.html', name: 'On your phone', from: 36, to: 42 },
    { file: '7-sync.html', name: 'Other PCs', from: 43, to: 49 },
  ]);
  const LAST = FILES[FILES.length - 1].to;

  // The pages on the shelf, for the rail. id -> [name, swatch colour].
  const PAGES = Object.freeze({
    print: ['Print queue', '#ece6d9'],
    radar: ['Release radar', '#0f1630'],
    deps: ['Dependency radar', '#f6f6f2'],
    read: ['Reading list', '#1d2a22'],
    dinner: ['Dinner plan', '#3b1f2b'],
    gym: ['Gym log', '#18181b'],
    standup: ['Standup notes', '#2b3a55'],
    drive: ['Drive space', '#d9d2c4'],
    checklist: ['Agents\' checklist', '#14171c'],
  });
  const DEFAULT_PAGES = 'print,radar,deps,read,dinner';
  const RAIL = Object.freeze([
    ['beach', 'Beach', '<span class="px-crab"></span>', ''],
    ['chat', 'Chat', '💬', '3'],
    ['routines', 'Routines', '⟳', '4'],
    ['workflows', 'Workflows', '⧉', ''],
    ['pages', 'Pages', '▦', ''],
    ['notes', 'Notes', '✎', ''],
    ['history', 'History', '⌚', ''],
  ]);

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const here = location.pathname.split('/').pop();
  const fileIdx = FILES.findIndex(f => f.file === here);
  const stage = document.querySelector('.stage');
  const screens = [...document.querySelectorAll('.stage > .screen')];

  function fillTitlebars() {
    document.querySelectorAll('header.tb').forEach(tb => {
      const mode = tb.dataset.mode || 'Ask first';
      tb.innerHTML = `<span class="px-crab" aria-hidden="true"></span><span class="word">Shellby</span><span class="mode">${esc(mode)}</span>`
        + '<span class="jump"><span>⌕</span>Jump to a conversation, page or screen<kbd>Ctrl K</kbd></span>'
        + '<span class="winbtns" aria-hidden="true"><span>─</span><span>▢</span><span>✕</span></span>';
    });
  }

  function railSubs(rail) {
    const ids = (rail.dataset.pages ?? DEFAULT_PAGES).split(',').map(s => s.trim()).filter(Boolean);
    const live = (rail.dataset.live ?? 'print').split(',');
    const off = (rail.dataset.off ?? '').split(',');
    return ids.filter(id => PAGES[id]).map(id => {
      const [name, colour] = PAGES[id];
      const cls = ['sub', rail.dataset.sub === id ? 'on' : '', off.includes(id) ? 'off' : ''].join(' ').trim();
      const dot = live.includes(id) ? '<span class="dot live"></span>' : '';
      return `<span class="${cls}"><span class="sw" style="background:${colour}"></span>${esc(name)}${dot}</span>`;
    }).join('');
  }

  function fillRails() {
    document.querySelectorAll('nav.rail').forEach(rail => {
      if (rail.children.length) return; // a screen that drew its own
      const on = rail.dataset.on || 'pages';
      const waiting = rail.dataset.waiting || '1';
      const items = RAIL.map(([key, name, glyph, n]) => {
        const count = key === 'beach' && waiting !== '0' ? `<span class="n hot">${esc(waiting)}</span>` : n ? `<span class="n">${n}</span>` : '';
        const item = `<span class="item${key === on ? ' on' : ''}"><i class="g">${glyph}</i>${name}${count}</span>`;
        return key === 'pages' ? `${item}<span class="subs">${railSubs(rail)}</span>` : item;
      }).join('');
      rail.setAttribute('aria-label', 'Shellby');
      rail.innerHTML = `${items}<span class="gap"></span><span class="item${on === 'settings' ? ' on' : ''}"><i class="g">⚙</i>Settings</span>`
        + `<span class="who"><span class="px-crab" aria-hidden="true"></span>${esc(rail.dataset.who || 'Shellby is resting')}</span>`;
    });
  }

  function fit() {
    const s = Math.min(innerWidth / W, innerHeight / H);
    stage.style.setProperty('--fit', String(s));
  }

  // ---------------------------------------------------------------- the bar
  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.innerHTML = '<span class="num"></span><span class="txt"><b></b><span class="feat"></span><p></p></span>'
    + '<span class="acts"><button type="button" data-go="-1" aria-label="Previous (←)">←</button>'
    + '<button type="button" data-go="1" aria-label="Next (→)">→</button>'
    + '<button type="button" data-notes aria-pressed="false" title="Notes (N)">Notes</button>'
    + '<button type="button" data-fs title="Full screen (F)">⛶</button>'
    + '<a href="index.html" title="Every screen (Esc)">All 49</a></span>';
  document.body.append(hud);

  let current = null;
  let idleTimer = 0;

  function wake() {
    hud.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => hud.classList.add('idle'), IDLE_MS);
  }

  function show(n) {
    const target = screens.find(s => Number(s.dataset.n) === n) || screens[0];
    if (!target) return;
    screens.forEach(s => s.classList.toggle('on', s === target));
    current = Number(target.dataset.n);
    hud.querySelector('.num').textContent = `${current} / ${LAST}`;
    hud.querySelector('.txt b').textContent = target.dataset.title || '';
    hud.querySelector('.txt .feat').textContent = fileIdx >= 0 ? FILES[fileIdx].name : '';
    hud.querySelector('.txt p').textContent = target.dataset.note || '';
    document.title = `${current}. ${target.dataset.title || ''} · Shellby Pages`;
    history.replaceState(null, '', `#${current}`);
    wake();
  }

  function go(step) {
    const n = current + step;
    if (screens.some(s => Number(s.dataset.n) === n)) { show(n); return; }
    const f = FILES.find(x => n >= x.from && n <= x.to);
    if (f) location.href = `${f.file}#${n}`;
  }

  function toggleNotes() {
    const on = hud.classList.toggle('pinned');
    hud.querySelector('[data-notes]').setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('shellby-pages-notes', on ? '1' : '0'); } catch { /* file:// may refuse storage */ }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }

  hud.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.go) go(Number(b.dataset.go));
    else if ('notes' in b.dataset) toggleNotes();
    else if ('fs' in b.dataset) toggleFullscreen();
  });

  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); go(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(-1); }
    else if (k === 'n' || k === 'N') toggleNotes();
    else if (k === 'f' || k === 'F') toggleFullscreen();
    else if (k === 'Escape' && !document.fullscreenElement) location.href = 'index.html';
  });
  addEventListener('mousemove', wake, { passive: true });
  addEventListener('resize', fit);
  addEventListener('hashchange', () => show(Number(location.hash.slice(1))));

  fillTitlebars();
  fillRails();
  fit();
  try { if (localStorage.getItem('shellby-pages-notes') !== '0') toggleNotes(); } catch { toggleNotes(); }
  show(Number(location.hash.slice(1)) || Number(screens[0]?.dataset.n));
})();
