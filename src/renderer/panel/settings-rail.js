/* Shellby panel — the Settings rail: nine areas down the side of Settings,
   the sections of the one you're in (a wide panel) or a peek at them (a narrow
   one), and the jumps to a setting from the palette, the tray and links. */
'use strict';
(function () {
  const { h, state, $ } = SB;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------ Settings rail

  // Nine areas down the side instead of five tabs along the top, each named for
  // what it holds, so you can always see where everything lives. In a wide panel
  // the rail opens out with names and lists the sections of the area you're in;
  // in a narrow one, resting on an icon peeks at them. Settings reopens on the
  // last area you looked at; the first time, Claude users start on Claude and
  // just-the-crab users on Look.
  const settingsView = $('settingsView');
  const settingsMain = $('settingsMain');
  const tabBar = $('settingsRail');
  const peek = $('settingsPeek');
  const tabs = [...tabBar.querySelectorAll('[role="tab"]')];
  const allGroups = () => [...settingsView.querySelectorAll('.setting-group[data-nav]')];
  const tabOf = group => group.closest('.settings-panel')?.dataset.tab;
  const tabIndex = tab => tabs.findIndex(b => b.dataset.tab === tab);
  const panelOf = tab => settingsView.querySelector(`.settings-panel[data-tab="${tab}"]`);
  const headingOf = g => g.querySelector('h3')?.textContent.trim() || g.dataset.nav;
  // Where things were before the rail: links, Sync and older callers may still say these.
  const OLD_TABS = Object.freeze({ shellby: 'look', around: 'look', connect: 'accounts', general: 'system' });
  const areaOf = tab => OLD_TABS[tab] || tab;
  let currentTab = null;

  // Each area's icon: # draws in the line colour, o in the accent.
  const RAIL_ICONS = Object.freeze({
    look: ['##.......##', '#o.......o#', '.#..#.#..#.', '..#######..', '.###o#o###.', '.#########.', '#.#.#.#.#.#'],
    games: ['..#####..', '..#...#..', '.#######.', '.#.....#.', '.#..o..#.', '.#.ooo.#.', '.#..o..#.', '.#.....#.', '.#######.'],
    claude: ['....#....', '....#....', '.#..#..#.', '..#.#.#..', '####o####', '..#.#.#..', '.#..#..#.', '....#....', '....#....'],
    code: ['......o....', '..#...o.#..', '.#...o...#.', '#....o....#', '.#...o...#.', '..#.o...#..', '....o......'],
    limits: ['#########', '.#.....#.', '..#ooo#..', '...#o#...', '....#....', '...#.#...', '..#...#..', '.#.ooo.#.', '#########'],
    alerts: ['....#....', '...###...', '..#...#..', '..#...#..', '..#...#..', '.#.....#.', '#########', '.........', '....o....'],
    apps: ['####.oooo', '#..#.o..o', '#..#.o..o', '####.oooo', '.........', '####.####', '#..#.#..#', '#..#.#..#', '####.####'],
    accounts: ['...###...', '..#...#..', '..#...#..', '...###...', '.........', '..#####..', '.#.....#.', '#.......#', '#########'],
    system: ['....#....', '.#.###.#.', '..#...#..', '.#..o..#.', '##.ooo.##', '.#..o..#.', '..#...#..', '.#.###.#.', '....#....'],
  });
  const SVG = 'http://www.w3.org/2000/svg';
  function railIcon(rows) {
    const svg = document.createElementNS(SVG, 'svg');
    Object.entries({ viewBox: `0 0 ${rows[0].length} ${rows.length}`, width: rows[0].length * 2, height: rows.length * 2, 'shape-rendering': 'crispEdges' })
      .forEach(([k, v]) => svg.setAttribute(k, String(v)));
    rows.forEach((line, y) => [...line].forEach((c, x) => {
      if (c === '.') return;
      const r = document.createElementNS(SVG, 'rect');
      Object.entries({ x, y, width: 1, height: 1, class: c === 'o' ? 'px-o' : 'px-l' }).forEach(([k, v]) => r.setAttribute(k, String(v)));
      svg.appendChild(r);
    }));
    return svg;
  }
  for (const b of tabs) b.querySelector('.rail-ico')?.appendChild(railIcon(RAIL_ICONS[b.dataset.tab]));

  const isWide = () => tabBar.offsetWidth > 120; // the labelled rail (nav.css, wide panels)

  // The marker behind the chosen area slides to the next one.
  function placeMark() {
    const b = tabs[tabIndex(currentTab)];
    if (!b || !b.offsetHeight) return;
    tabBar.style.setProperty('--mark-y', `${b.offsetTop}px`);
    tabBar.style.setProperty('--mark-h', `${b.offsetHeight}px`);
    // It only slides once has-mark is on, so the first placement lands in place.
    if (!tabBar.classList.contains('has-mark')) {
      void tabBar.offsetWidth;
      tabBar.classList.add('has-mark');
    }
  }

  // In a wide panel, the sections of the area you're in, under its name, with
  // the one you're reading lit as you scroll. Right on the area's name reaches
  // them from the keyboard (tocKeys). Rebuilt only when the list itself changes,
  // so a Settings render doesn't pull a button out from under the pointer.
  const visibleGroups = tab => [...panelOf(tab).querySelectorAll('.setting-group[data-nav]')].filter(g => !g.hidden);
  function renderToc() {
    const old = tabBar.querySelector('.rail-toc');
    const b = tabs[tabIndex(currentTab)];
    if (!b || !isWide() || settingsView.classList.contains('searching')) { old?.remove(); return; }
    const groups = visibleGroups(currentTab);
    const key = `${currentTab}:${groups.map(g => g.dataset.nav).join('|')}`;
    if (old?.dataset.key === key && old.previousElementSibling === b) { spy(); return; }
    old?.remove();
    const toc = h('div', { class: 'rail-toc', role: 'group', 'aria-label': `Sections in ${b.querySelector('.rail-name').textContent}`, dataset: { key } },
      ...groups.map(g => h('button', { type: 'button', tabindex: '-1', dataset: { nav: g.dataset.nav }, onclick: () => SB.jumpToSetting(g) }, headingOf(g))));
    b.after(toc);
    spy();
  }
  // The section you're reading: the last one whose top has passed the top of
  // the column. One you were sent to stays lit until you scroll yourself: near
  // the end of a short area it can't reach the top, so where it sits wouldn't say.
  let sentTo = null;
  let reading = null;
  function spy() {
    if (!currentTab) return;
    const line = settingsMain.getBoundingClientRect().top + 60;
    const groups = visibleGroups(currentTab);
    let here = null;
    for (const g of groups) if (g.getBoundingClientRect().top <= line) here = g.dataset.nav;
    reading = sentTo && groups.some(g => g.dataset.nav === sentTo) ? sentTo : here || groups[0]?.dataset.nav || null;
    for (const t of tabBar.querySelector('.rail-toc')?.children || []) t.classList.toggle('on', /** @type {HTMLElement} */ (t).dataset.nav === reading);
  }
  settingsMain.addEventListener('scroll', spy, { passive: true });
  for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart']) {
    settingsMain.addEventListener(type, () => { if (sentTo) { sentTo = null; spy(); } }, { passive: true });
  }

  // The list goes in (or out) before the marker is measured, or the marker
  // lands where the area's name was before the list above it went.
  const relayout = () => { renderToc(); placeMark(); };
  new ResizeObserver(relayout).observe(settingsView);
  document.fonts.ready.then(relayout);

  function showTab(tab, { focus = false } = {}) {
    tab = areaOf(tab);
    if (tabIndex(tab) < 0) return;
    const changed = tab !== currentTab;
    // The new area's page comes in from the side its place on the rail is on.
    if (changed && currentTab) settingsView.dataset.dir = tabIndex(tab) > tabIndex(currentTab) ? 'next' : 'prev';
    currentTab = tab;
    for (const b of tabs) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    for (const p of settingsView.querySelectorAll('.settings-panel')) p.hidden = p.dataset.tab !== tab;
    if (changed) { settingsMain.scrollTop = 0; sentTo = null; }
    hidePeek();
    relayout();
  }

  SB.showSettingsTab = tab => showTab(tab);
  SB.settingsTab = () => currentTab;
  SB.settingsScroller = settingsMain;
  // /model, /output-style: the setting itself, in view and focused.
  SB.showSetting = id => {
    const el = $(id);
    const group = el?.closest('.setting-group');
    if (!el || !group) return;
    SB.setView('settings');
    showTab(tabOf(group));
    if (group.tagName === 'DETAILS') group.open = true;
    requestAnimationFrame(() => { group.scrollIntoView({ block: 'center' }); el.focus(); });
  };

  // The extras fold to one line each. The line says On or Off, read from the
  // body each section already shows only while its feature is on.
  for (const fold of settingsView.querySelectorAll('.setting-fold[data-fold-on]')) {
    const body = $(fold.dataset.foldOn);
    const label = fold.querySelector('.fold-state');
    if (!body || !label) continue;
    const sync = () => {
      label.textContent = body.hidden ? 'Off' : 'On';
      label.classList.toggle('on', !body.hidden);
    };
    new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  }

  // ---- the peek: resting on an icon in the narrow rail shows that area's sections

  const PEEK_OPEN_MS = 280;
  const PEEK_CLOSE_MS = 220;
  let peekOpenT = 0;
  let peekCloseT = 0;
  let peekMuted = null; // the area you just clicked: no peek over it until you move off it
  function showPeek(tab) {
    clearTimeout(peekCloseT);
    clearTimeout(peekOpenT); // a hover's late open would rebuild it under the keyboard's focus
    const b = tabs[tabIndex(tab)];
    const groups = visibleGroups(tab);
    peek.replaceChildren(
      h('b', { class: 'peek-name', text: b.querySelector('.rail-name').textContent }),
      h('p', { class: 'peek-what', text: b.dataset.what || '' }),
      h('div', { class: 'peek-list' }, ...groups.map(g => h('button', {
        type: 'button', tabindex: '-1', class: tab === currentTab && g.dataset.nav === reading ? 'here' : null,
        onclick: () => { hidePeek(); SB.jumpToSetting(g); },
      }, headingOf(g)))));
    peek.hidden = false;
    const top = b.getBoundingClientRect().top - settingsView.getBoundingClientRect().top;
    const room = settingsView.clientHeight - peek.offsetHeight - 6;
    peek.style.setProperty('--peek-y', `${Math.max(6, Math.min(top, room))}px`);
    peek.dataset.tab = tab;
    for (const t of tabs) t.classList.toggle('peeking', t === b);
  }
  function hidePeek() {
    clearTimeout(peekOpenT);
    clearTimeout(peekCloseT);
    peek.hidden = true;
    delete peek.dataset.tab;
    for (const t of tabs) t.classList.remove('peeking');
  }
  const laterHide = () => { clearTimeout(peekOpenT); clearTimeout(peekCloseT); peekCloseT = setTimeout(hidePeek, PEEK_CLOSE_MS); };

  tabBar.addEventListener('pointerover', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[role="tab"]'));
    if (!b || e.pointerType === 'touch' || isWide() || settingsView.classList.contains('searching')) return;
    if (/** @type {HTMLElement | null} */ (e.relatedTarget)?.closest?.('[role="tab"]') === b) return; // still on the same icon
    if (peekMuted === b.dataset.tab) return;
    peekMuted = null;
    clearTimeout(peekCloseT);
    clearTimeout(peekOpenT);
    if (!peek.hidden) showPeek(b.dataset.tab);
    else peekOpenT = setTimeout(() => showPeek(b.dataset.tab), reducedMotion() ? 0 : PEEK_OPEN_MS);
  });
  tabBar.addEventListener('pointerleave', () => { peekMuted = null; laterHide(); });
  peek.addEventListener('pointerenter', () => clearTimeout(peekCloseT));
  peek.addEventListener('pointerleave', laterHide);
  // Tab, or a click elsewhere, takes the keyboard away from an open peek: it closes.
  peek.addEventListener('focusout', e => {
    if (!peek.contains(/** @type {Node | null} */ (e.relatedTarget))) hidePeek();
  });

  // Up and Down within a list of sections (the peek, or the wide rail's), and
  // Left or Esc back to the area's name.
  function listKeys(e, items, back, onBack = () => {}) {
    const i = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    if (e.key === 'ArrowLeft' || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onBack();
      back?.focus();
    }
  }
  peek.addEventListener('keydown', e => {
    const back = tabs[tabIndex(peek.dataset.tab)];
    listKeys(e, [...peek.querySelectorAll('button')], back, hidePeek);
  });

  for (const b of tabs) b.addEventListener('click', () => { peekMuted = b.dataset.tab; showTab(b.dataset.tab); });
  // A setting that talks about one in another area links straight to it.
  settingsView.addEventListener('click', e => {
    const link = /** @type {HTMLElement} */ (e.target).closest('[data-jump-setting]');
    if (link) SB.showSetting(/** @type {HTMLElement} */ (link).dataset.jumpSetting);
  });
  // Up and Down walk the rail, the usual way for a vertical tab list; Right goes
  // into the area's sections: the peek in the narrow rail, the list in the wide one.
  tabBar.addEventListener('keydown', e => {
    const toc = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.rail-toc'));
    if (toc) { listKeys(e, [...toc.querySelectorAll('button')], tabs[tabIndex(currentTab)]); return; }
    const i = tabs.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (i < 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (isWide()) {
        if (tabs[i].dataset.tab !== currentTab) showTab(tabs[i].dataset.tab);
        /** @type {HTMLElement | null} */ (tabBar.querySelector('.rail-toc .on') || tabBar.querySelector('.rail-toc button'))?.focus();
        return;
      }
      showPeek(tabs[i].dataset.tab);
      /** @type {HTMLElement | null} */ (peek.querySelector('button'))?.focus();
      return;
    }
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    showTab(tabs[(next + tabs.length) % tabs.length].dataset.tab, { focus: true });
  });

  // While searching (settings-search.js), the rail counts what each area found
  // and dims the ones with nothing. null puts it back.
  SB.markSettingsRail = counts => {
    for (const b of tabs) {
      const n = counts ? counts[b.dataset.tab] || 0 : 0;
      const badge = b.querySelector('.rail-count');
      b.classList.toggle('match', !!counts && n > 0);
      b.classList.toggle('dim', !!counts && !n);
      badge.hidden = !n;
      badge.textContent = n ? String(n) : '';
    }
    if (counts) hidePeek();
    relayout();
  };

  // main.js points here by section name (the tray's update item, the "update
  // ready" notification), and the palette by section.
  SB.jumpToSettingByName = name => {
    const group = allGroups().find(g => g.dataset.nav === name);
    if (group) SB.jumpToSetting(group);
  };

  SB.jumpToSetting = group => {
    if (state.view !== 'settings') SB.setView('settings');
    showTab(tabOf(group));
    if (group.tagName === 'DETAILS') group.open = true;
    sentTo = group.dataset.nav || null;
    spy();
    requestAnimationFrame(() => {
      group.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      // A brief glow says which section you were sent to.
      group.classList.remove('arrived');
      void group.offsetWidth;
      group.classList.add('arrived');
    });
  };
  settingsView.addEventListener('animationend', e => {
    const el = /** @type {HTMLElement} */ (e.target);
    el.classList.remove('arrived');
    // The slide is for a change of area only: coming back to Settings just fades in.
    if (el.classList.contains('settings-panel')) delete settingsView.dataset.dir;
  });

  const renderSettings = SB.views.settings.render;
  SB.views.settings.render = () => {
    renderSettings();
    if (!currentTab) showTab(SB.isCrabOnly() ? 'look' : 'claude');
    else renderToc(); // what shows in an area can change with what's switched on
  };
})();
