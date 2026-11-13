// A rail down the side: nine areas that are always there, a filter for what
// you've changed, group headings that stick, and a peek at any area's groups.
(function (PAH) {
  'use strict';
  const { RAIL, RAIL_ICONS, RAIL_ITEMS, DEFAULTS, SKINS, scene } = PAH;
  const { esc, row, isChanged, isOff, shown, showDefault } = PAH.ui;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PEEK_OPEN_MS = 280;
  const PEEK_CLOSE_MS = 220;
  const TOAST_MS = 2600;
  const FLASH_MS = 1500;
  const SIZE_SCALE = Object.freeze({ Small: 0.75, Medium: 1, Large: 1.25, Huge: 1.5 });

  const state = { ...DEFAULTS };
  const ui = { area: 'code', filter: 'all', query: '', pendingPower: false, flash: null, seen: new Set(), spy: null, peek: null };

  const $ = sel => document.querySelector(sel);
  const rail = $('#rail');
  const scroll = $('#scroll');
  const peek = $('#peek');
  const q = $('#q');
  const toastEl = $('#toast');
  const byKey = Object.fromEntries(RAIL.map(a => [a.key, a]));
  const byId = Object.fromEntries(RAIL_ITEMS.map(i => [i.id, i]));
  const itemsIn = key => RAIL_ITEMS.filter(i => i.rail === key);
  const changedIn = key => itemsIn(key).filter(i => isChanged(i, state));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // ---------------------------------------------------------------- changing things
  function set(id, value, { confirmed = false } = {}) {
    if (id === 'power' && value === 'Autonomous' && !confirmed && state.power !== 'Autonomous') { ui.pendingPower = true; render(); return; }
    state[id] = value;
    // The Mode switch and the Work mode toggle are one setting seen from two places.
    if (id === 'appMode') state.workMode = value === 'Work mode';
    if (id === 'workMode') state.appMode = value ? 'Work mode' : 'Claude Code';
    render();
  }

  // Put a handful of settings back, with a way to change your mind.
  function resetAll(items, what) {
    const before = Object.fromEntries(items.map(i => [i.id, state[i.id]]));
    for (const i of items) state[i.id] = i.def;
    state.workMode = state.appMode === 'Work mode';
    render();
    toast(what, () => { Object.assign(state, before); render(); });
  }

  // ---------------------------------------------------------------- icons
  function icon(key) {
    if (RAIL_ICONS[key] === 'him') return scene.portrait(SKINS[state.skin]);
    const rows = RAIL_ICONS[key];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`);
    svg.setAttribute('class', 'px');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.style.width = `${rows[0].length * 2}px`;
    svg.style.height = `${rows.length * 2}px`;
    rows.forEach((line, y) => [...line].forEach((c, x) => {
      if (c === '.') return;
      const r = document.createElementNS(svg.namespaceURI, 'rect');
      Object.entries({ x, y, width: 1, height: 1, class: c === 'o' ? 'px-o' : 'px-l' }).forEach(([k, v]) => r.setAttribute(k, v));
      svg.appendChild(r);
    }));
    return svg;
  }

  // ---------------------------------------------------------------- the rail
  let railSkin = null;
  function buildRail() {
    rail.innerHTML = `<span class="rail-mark" aria-hidden="true"></span>${RAIL.map((a, i) =>
      `<button type="button" class="rail-btn" data-rail="${a.key}" tabindex="-1" aria-keyshortcuts="Alt+${i + 1}"><span class="g" data-icon="${a.key}"></span><span class="nm">${esc(a.name)}</span><span class="badge" hidden></span></button>`).join('')}`;
  }

  function matches(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return RAIL_ITEMS.filter(it => {
      if (!shown(it, state)) return false;
      const a = byKey[it.rail];
      const hay = `${it.label} ${it.help || ''} ${it.kw || ''} ${it.group} ${a.name} ${a.title}`.toLowerCase();
      const tokens = hay.split(/[^a-z0-9%]+/).filter(Boolean);
      return words.every(w => tokens.some(t => t.startsWith(w) || (t.length >= 4 && w.startsWith(t))));
    });
  }

  function renderRail(found) {
    if (railSkin !== state.skin) {
      railSkin = state.skin;
      rail.querySelectorAll('[data-icon]').forEach(el => el.replaceChildren(icon(el.dataset.icon)));
    }
    const current = ui.query ? null : ui.area;
    for (const b of rail.querySelectorAll('.rail-btn')) {
      const a = byKey[b.dataset.rail];
      const hits = found ? found.filter(f => f.rail === a.key).length : 0;
      const n = found ? hits : changedIn(a.key).length;
      if (a.key === current) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      b.tabIndex = a.key === (current || ui.area) ? 0 : -1;
      b.classList.toggle('match', hits > 0);
      b.classList.toggle('dim', !!found && !hits);
      b.setAttribute('aria-label', `${a.title}${n ? `, ${found ? plural(n, 'result') : `${n} changed`}` : ''}`);
      const badge = b.querySelector('.badge');
      badge.hidden = !n;
      badge.textContent = n;
      badge.classList.toggle('hits', !!found);
    }
    renderToc(current);
    const mark = rail.querySelector('.rail-mark');
    const on = current && rail.querySelector(`[data-rail="${current}"]`);
    mark.hidden = !on;
    if (on) { mark.style.height = `${on.offsetHeight}px`; mark.style.transform = `translateY(${on.offsetTop}px)`; }
  }

  // In a wide panel the rail has room to list the current area's groups under it.
  const isWide = () => rail.offsetWidth > 120;
  function renderToc(current) {
    rail.querySelector('.toc')?.remove();
    if (!current || !isWide()) return;
    const toc = document.createElement('div');
    toc.className = 'toc';
    toc.innerHTML = byKey[current].groups.map(grp => {
      const vis = grp.items.filter(i => shown(i, state));
      const ch = vis.some(i => isChanged(i, state));
      return `<button type="button" data-toc="${esc(grp.as)}" tabindex="-1">${ch ? '<i class="dot"></i>' : ''}<span>${esc(grp.as)}</span><span class="n">${vis.length}</span></button>`;
    }).join('');
    rail.querySelector(`[data-rail="${current}"]`).after(toc);
    markToc();
  }
  function markToc() {
    rail.querySelectorAll('[data-toc]').forEach(b => b.classList.toggle('on', b.dataset.toc === ui.spy));
  }

  // In a full-screen panel: everything you've changed, from every area, in one column.
  function renderAside() {
    const aside = $('#aside');
    if (getComputedStyle(aside).display === 'none') return;
    const all = RAIL_ITEMS.filter(i => isChanged(i, state));
    const areas = RAIL.filter(a => all.some(i => i.rail === a.key));
    aside.innerHTML = `<h4>Changed${all.length ? ` <span class="pill coral">${all.length}</span>` : ''}</h4><p>Everything you've moved off how Shellby came, in every area.</p>
      ${all.length ? areas.map(a => `<div class="ch-area"><button type="button" data-go="${a.key}">${esc(a.name)}</button><ul class="ch-list">${all.filter(i => i.rail === a.key).map(i =>
        `<li><span class="ch-t"><button type="button" class="ch-name" data-find="${i.id}">${esc(i.label)}</button><span class="ch-v"><b>${esc(showDefault(state[i.id]))}</b> · was ${esc(showDefault(i.def))}</span></span><button type="button" class="undo" data-reset-one="${i.id}" title="Back to ${esc(showDefault(i.def))}" aria-label="Reset ${esc(i.label)}">↺</button></li>`).join('')}</ul></div>`).join('')
        + `<button type="button" class="btn all" data-reset-every>Put all ${all.length} back</button>`
        : '<div class="empty"><b>Nothing yet.</b><p>Change anything, anywhere, and it shows up here with a way back.</p></div>'}`;
  }

  // ---------------------------------------------------------------- one area
  function chips(key) {
    const visible = itemsIn(key).filter(i => shown(i, state));
    const counts = { all: visible.length, changed: visible.filter(i => isChanged(i, state)).length, off: visible.filter(i => isOff(i, state)).length };
    const names = { all: 'All', changed: 'Changed', off: 'Off' };
    const tips = { all: 'Every setting here', changed: "What you've moved off the default", off: "Switches you haven't turned on" };
    return `<div class="chips" role="group" aria-label="Show">${Object.keys(names).map(f =>
      `<button type="button" data-filter="${f}" aria-pressed="${ui.filter === f}" title="${tips[f]}"${f === 'changed' && counts.changed ? ' class="hot"' : ''}>${names[f]} <b>${counts[f]}</b></button>`).join('')}</div>`;
  }

  function emptyFilter(key) {
    if (ui.filter === 'changed') return `<div class="empty"><b>Nothing changed here.</b><p>Everything in ${esc(byKey[key].name)} is how Shellby came. Changes get a coral dot, and their count shows on the rail.</p><button type="button" class="link" data-filter="all">Show all of ${esc(byKey[key].name)}</button></div>`;
    return `<div class="empty"><b>Every switch here is on.</b><p>You've tried everything ${esc(byKey[key].name)} has.</p><button type="button" class="link" data-filter="all">Show all of ${esc(byKey[key].name)}</button></div>`;
  }

  const keepRow = item => ui.filter === 'all' || (ui.filter === 'changed' ? isChanged(item, state) : isOff(item, state));

  function powerWarning() {
    return `<div class="warn" role="alert"><b>Autonomous mode skips every permission check.</b>
      <p>Shellby and his helper agents can edit, run or delete anything your Windows account can, without asking. That includes running scripts it writes for itself.</p>
      <div class="warn-actions"><button type="button" class="btn danger" data-power="yes">I understand, enable it</button><button type="button" class="btn" data-power="no">Cancel</button></div></div>`;
  }

  function renderArea(key) {
    const a = byKey[key];
    const seen = new Set();
    const groups = a.groups.map(grp => {
      const items = grp.items.filter(i => shown(i, state) && keepRow(i));
      if (!items.length) return '';
      const rows = items.map(it => {
        seen.add(it.id);
        const enter = ui.seen.size > 0 && !ui.seen.has(it.id) && !REDUCED;
        return row(it, state, { enter, flash: ui.flash === it.id }) + (it.id === 'power' && ui.pendingPower ? powerWarning() : '');
      }).join('');
      const dots = items.filter(i => isChanged(i, state)).length;
      return `<section class="grp" data-grp="${esc(grp.as)}"><h4 class="sticky"><span>${esc(grp.as)}</span><span class="cnt">${dots ? `<i class="dot" title="${dots} changed"></i>` : ''}${items.length}</span></h4><div class="card">${rows}</div></section>`;
    }).join('');
    ui.seen = seen;
    const n = changedIn(key).length;
    const reset = ui.filter === 'changed' && n ? `<button type="button" class="link" data-reset-area="${key}">Put these ${n} back</button>` : '';
    const work = key === 'look' && state.workMode ? '<p class="note">Work mode is holding his pals, mischief and climbing. They come back when you switch it off, in Claude.</p>' : '';
    const him = key === 'look' ? `<span class="him" data-him style="--s:${SIZE_SCALE[state.size]}"></span>` : '';
    return `<header class="area-head">${him}<div><h3>${esc(a.title)}</h3><p>${esc(a.what)}</p></div></header>
      <div class="chip-row">${chips(key)}${reset}</div>${work}
      ${groups || emptyFilter(key)}`;
  }

  // ---------------------------------------------------------------- search
  function renderSearch(found) {
    if (!found.length && matches(ui.query, { hidden: true }).length) return `<div class="empty"><b>Those are switched off for now.</b><p>Settings for "${esc(ui.query)}" appear once you turn on the switch above them. Clear the search and look in ${esc([...new Set(matches(ui.query, { hidden: true }).map(f => byKey[f.rail].name))].join(' or '))}.</p></div>`;
    if (!found.length) return `<div class="empty"><b>Nothing matches "${esc(ui.query)}".</b><p>Try a word for what you want him to do, like "quieter", "phone" or "climb".</p></div>`;
    const areas = RAIL.filter(a => found.some(f => f.rail === a.key));
    const more = matches(ui.query, { hidden: true }).length;
    const tucked = more ? ` ${plural(more, 'more')} appear${more === 1 ? 's' : ''} once you turn on the switch above ${more === 1 ? 'it' : 'them'}.` : '';
    return `<p class="hint">${plural(found.length, 'setting')} in ${plural(areas.length, 'area')}. They glow on the rail.${tucked}</p>${areas.map(a =>
      `<section class="grp"><h4 class="sticky"><button type="button" class="go" data-go="${a.key}">${esc(a.name)} ›</button><span class="cnt">${found.filter(f => f.rail === a.key).length}</span></h4>
        <div class="card">${found.filter(f => f.rail === a.key).map(it => row(it, state, { crumb: esc(it.group) })).join('')}</div></section>`).join('')}`;
  }

  // ---------------------------------------------------------------- drawing
  function render() {
    const found = ui.query ? matches(ui.query) : null;
    renderRail(found);
    const focus = document.activeElement;
    const keep = scroll.contains(focus) ? { id: focus.dataset.id, v: focus.dataset.v, action: focus.dataset.action, filter: focus.dataset.filter } : null;
    const top = scroll.scrollTop;
    scroll.innerHTML = found ? renderSearch(found) : renderArea(ui.area);
    scroll.querySelectorAll('[data-portrait]').forEach(el => el.appendChild(scene.portrait(SKINS[el.dataset.portrait])));
    scroll.querySelectorAll('[data-him]').forEach(el => el.appendChild(scene.portrait(SKINS[state.skin])));
    scroll.scrollTop = top;
    if (keep) {
      const sel = keep.id ? `[data-id="${keep.id}"]${keep.v ? `[data-v="${CSS.escape(keep.v)}"]` : ''}` : keep.action ? `[data-action="${keep.action}"]` : keep.filter ? `[data-filter="${keep.filter}"]` : null;
      if (sel) scroll.querySelector(sel)?.focus({ preventScroll: true });
    }
    spy();
    markToc();
    renderAside();
    if (ui.peek) fillPeek(ui.peek);
  }

  // ---------------------------------------------------------------- moving around
  function open(key, { filter = 'all', group = null, push = true } = {}) {
    const same = key === ui.area && !ui.query;
    ui.area = key;
    ui.filter = filter;
    ui.pendingPower = false;
    if (ui.query) { ui.query = ''; q.value = ''; }
    if (!same) ui.seen = new Set();
    if (push && location.hash !== `#${key}`) history.pushState(null, '', `#${key}`);
    render();
    if (group) toGroup(group);
    else if (!same) scroll.scrollTop = 0;
  }

  function toGroup(title) {
    const sec = [...scroll.querySelectorAll('[data-grp]')].find(s => s.dataset.grp === title);
    if (sec) scroll.scrollTo({ top: sec.offsetTop - scroll.offsetTop - 4, behavior: REDUCED ? 'auto' : 'smooth' });
  }

  function find(id) {
    const it = byId[id];
    open(it.rail);
    ui.flash = id;
    render();
    scroll.querySelector(`[data-row="${id}"]`)?.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
    setTimeout(() => { ui.flash = null; }, FLASH_MS);
  }

  // Which group is under the sticky heading right now.
  function spy() {
    if (ui.query) { ui.spy = null; return; }
    const line = scroll.getBoundingClientRect().top + 40;
    let cur = null;
    for (const s of scroll.querySelectorAll('[data-grp]')) if (s.getBoundingClientRect().top <= line) cur = s.dataset.grp;
    ui.spy = cur;
  }

  // ---------------------------------------------------------------- the peek
  let peekOpenT = 0;
  let peekCloseT = 0;
  function fillPeek(key) {
    const a = byKey[key];
    const b = rail.querySelector(`[data-rail="${key}"]`);
    peek.innerHTML = `<b class="pk-t">${esc(a.title)}</b><p>${esc(a.what)}</p><ul>${a.groups.map(grp => {
      const vis = grp.items.filter(i => shown(i, state));
      const ch = vis.filter(i => isChanged(i, state)).length;
      const here = key === ui.area && !ui.query && grp.as === ui.spy;
      return `<li><button type="button" class="pk-g${here ? ' here' : ''}" data-peek-go="${key}" data-peek-grp="${esc(grp.as)}" tabindex="-1">${ch ? '<i class="dot"></i>' : ''}<span>${esc(grp.as)}</span><span class="cnt">${here ? 'here' : vis.length}</span></button></li>`;
    }).join('')}</ul>`;
    const max = rail.clientHeight - peek.offsetHeight - 6;
    peek.style.transform = `translateY(${Math.max(6, Math.min(b.offsetTop - rail.scrollTop, max))}px)`;
  }

  function showPeek(key) {
    clearTimeout(peekCloseT);
    ui.peek = key;
    peek.hidden = false;
    fillPeek(key);
    rail.querySelectorAll('.rail-btn').forEach(b => b.classList.toggle('peeking', b.dataset.rail === key));
  }
  function hidePeek() {
    clearTimeout(peekOpenT);
    ui.peek = null;
    peek.hidden = true;
    rail.querySelectorAll('.peeking').forEach(b => b.classList.remove('peeking'));
  }
  const laterHide = () => { clearTimeout(peekOpenT); clearTimeout(peekCloseT); peekCloseT = setTimeout(hidePeek, PEEK_CLOSE_MS); };

  // ---------------------------------------------------------------- toast
  let toastT = 0;
  let undoFn = null;
  function toast(text, undo = null) {
    undoFn = undo;
    toastEl.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" data-undo>Undo</button>' : ''}`;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => { toastEl.classList.remove('on'); undoFn = null; }, undo ? TOAST_MS * 1.6 : TOAST_MS);
  }
  toastEl.addEventListener('click', e => {
    if (!e.target.closest('[data-undo]') || !undoFn) return;
    undoFn();
    undoFn = null;
    toastEl.classList.remove('on');
  });

  // ---------------------------------------------------------------- events
  rail.addEventListener('click', e => {
    const t = e.target.closest('[data-toc]');
    if (t) { toGroup(t.dataset.toc); return; }
    const b = e.target.closest('.rail-btn');
    if (!b) return;
    hidePeek();
    peekMuted = b.dataset.rail; // you've gone there: no peek over it until you move on
    open(b.dataset.rail);
  });
  let peekMuted = null;
  rail.addEventListener('pointerover', e => {
    const b = e.target.closest('.rail-btn');
    if (!b || e.pointerType === 'touch' || isWide()) return; // a wide rail lists the groups itself
    if (e.relatedTarget?.closest?.('.rail-btn') === b) return; // still on the same icon
    if (peekMuted === b.dataset.rail) return;
    peekMuted = null;
    clearTimeout(peekCloseT);
    clearTimeout(peekOpenT);
    if (ui.peek) showPeek(b.dataset.rail);
    else peekOpenT = setTimeout(() => showPeek(b.dataset.rail), PEEK_OPEN_MS);
  });
  rail.addEventListener('pointerleave', () => { peekMuted = null; laterHide(); });
  rail.addEventListener('scroll', () => ui.peek && fillPeek(ui.peek));
  peek.addEventListener('pointerenter', () => clearTimeout(peekCloseT));
  peek.addEventListener('pointerleave', laterHide);
  peek.addEventListener('click', e => {
    const b = e.target.closest('[data-peek-go]');
    if (!b) return;
    hidePeek();
    open(b.dataset.peekGo, { group: b.dataset.peekGrp });
  });

  rail.addEventListener('keydown', e => {
    const btns = [...rail.querySelectorAll('.rail-btn')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight' && !isWide()) { e.preventDefault(); showPeek(btns[i].dataset.rail); peek.querySelector('.pk-g')?.focus(); return; }
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: btns.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    if (ui.peek) hidePeek();
    btns[(to + btns.length) % btns.length].focus();
  });
  peek.addEventListener('keydown', e => {
    const gs = [...peek.querySelectorAll('.pk-g')];
    const i = gs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); gs[(i + (e.key === 'ArrowDown' ? 1 : -1) + gs.length) % gs.length].focus(); }
    if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); const key = ui.peek; hidePeek(); rail.querySelector(`[data-rail="${key}"]`).focus(); }
  });

  scroll.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.find) find(d.find);
    else if (d.go) open(d.go);
    else if (d.filter) { ui.filter = d.filter; render(); }
    else if (d.id && d.v !== undefined) set(d.id, d.v);
    else if (d.resetOne) { const it = byId[d.resetOne]; resetAll([it], `${it.label}: back to ${showDefault(it.def)}.`); }
    else if (d.resetArea) { const items = changedIn(d.resetArea); resetAll(items, `Put ${plural(items.length, 'setting')} back.`); }
    else if (d.power) { ui.pendingPower = false; if (d.power === 'yes') set('power', 'Autonomous', { confirmed: true }); else render(); }
    else if (d.action) { const it = byId[d.action]; toast(it.buttons ? it.buttons[+d.i][1] : it.toast); }
  });
  scroll.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('.tog')) set(t.dataset.id, t.checked);
    else if (t.matches('.sel')) set(t.dataset.id, t.value);
    else if (t.matches('.field')) set(t.dataset.id, t.value);
  });
  scroll.addEventListener('input', e => { if (e.target.matches('.field')) state[e.target.dataset.id] = e.target.value; });
  scroll.addEventListener('scroll', () => { spy(); markToc(); if (ui.peek === ui.area) fillPeek(ui.peek); }, { passive: true });

  $('#aside').addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.find) find(d.find);
    else if (d.go) open(d.go);
    else if (d.resetOne) { const it = byId[d.resetOne]; resetAll([it], `${it.label}: back to ${showDefault(it.def)}.`); }
    else if ('resetEvery' in d) { const items = RAIL_ITEMS.filter(i => isChanged(i, state)); resetAll(items, `Put ${plural(items.length, 'setting')} back.`); }
  });

  // A new size moves the rail's marker and may open or close the wide layouts.
  let resizeT = 0;
  addEventListener('resize', () => { cancelAnimationFrame(resizeT); resizeT = requestAnimationFrame(() => { hidePeek(); render(); }); });

  q.addEventListener('input', () => { ui.query = q.value.trim(); hidePeek(); scroll.scrollTop = 0; render(); });
  q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const first = matches(ui.query)[0]; if (first) find(first.id); }
    if (e.key === 'Escape' && ui.query) { e.stopPropagation(); ui.query = ''; q.value = ''; render(); }
  });

  // / or Ctrl+K to search, Alt+1 to 9 for an area, Esc to close things.
  document.addEventListener('keydown', e => {
    const typing = e.target.matches('input, select, textarea');
    if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && e.ctrlKey)) { e.preventDefault(); q.focus(); q.select(); return; }
    if (e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); open(RAIL[+e.key - 1].key); rail.querySelector('[aria-current]')?.focus(); return; }
    if (e.key === 'Escape') {
      if (ui.peek) hidePeek();
      else if (ui.pendingPower) { ui.pendingPower = false; render(); }
    }
  });

  // The area is in the address, so Back and Forward step through where you've been.
  const fromHash = () => (byKey[location.hash.slice(1)] ? location.hash.slice(1) : null);
  addEventListener('popstate', () => open(fromHash() || 'code', { push: false }));

  buildRail();
  ui.area = fromHash() || 'code';
  render();
})(window.PAH);
