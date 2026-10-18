/* Shellby panel — Shellby Wrapped: last year in slides (docs/WRAPPED.md). Main
   (wiring/yearbook.js) keeps the yearbook and says when a year is due, on the
   first launch on or after January 2nd; this shows that year one slide at a
   time and ends on the card (wrapped-card.js). Years you missed wait behind the
   🎁 button on Trophies. It reads everything through api.getGame / api.onGame. */
'use strict';
(function () {
  const { api, h, $ } = SB;
  const AUTO_MS = 6500; // a slide's time on screen when it moves by itself (never with motion turned down)
  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sheet = $('wrappedSheet');
  let view = null;      // the year on show (game view 'wrapped', with a year)
  let years = [];       // every year with a Wrapped, newest first
  let week = null;      // Wrapped week, January 2nd to 8th: { year, dayOf, friendsShared, sharing, open }, else null
  let at = 0;
  let timer = null;

  // Pixel art ({ pixels, palette }) on a small canvas, `px` device pixels a pixel.
  function pixelArt(art, box) {
    const c = document.createElement('canvas');
    if (!art?.pixels?.length) return c;
    const w = Math.max(...art.pixels.map(r => r.length)), ht = art.pixels.length;
    const px = Math.max(2, Math.floor(box / Math.max(w, ht)));
    c.width = w * px;
    c.height = ht * px;
    const g = c.getContext('2d');
    art.pixels.forEach((row, y) => [...row].forEach((ch, x) => {
      const col = art.palette?.[ch];
      if (ch === '.' || !HEX.test(col || '')) return;
      g.fillStyle = col;
      g.fillRect(x * px, y * px, px, px);
    }));
    return c;
  }

  // When in the day and week: 24 hours and 7 days, each cell as bright as it was busy.
  function heatmap(heat) {
    const row = (counts, label) => {
      const top = Math.max(1, ...counts);
      return h('div', { class: 'wr-heat-row', role: 'img', 'aria-label': label },
        ...counts.map(n => h('i', { style: `--heat: ${(n / top).toFixed(3)}` })));
    };
    return h('div', { class: 'wr-heat' },
      row(heat.hours, 'Busy hours, midnight to 11 PM'),
      h('div', { class: 'wr-heat-axis small muted', 'aria-hidden': 'true' }, h('span', { text: '12a' }), h('span', { text: '12p' }), h('span', { text: '11p' })),
      row(heat.weekdays, 'Busy days, Sunday to Saturday'),
      h('div', { class: 'wr-heat-axis wr-heat-days small muted', 'aria-hidden': 'true' }, ...WEEKDAYS.map(d => h('span', { text: d }))));
  }

  function slideBody(sl) {
    const parts = [h('p', { class: 'wr-eyebrow', text: sl.eyebrow }), h('h3', { class: 'wr-title', text: sl.title })];
    if (sl.big) parts.push(h('p', { class: 'wr-big' }, h('b', { text: sl.big }), sl.unit ? h('span', { text: ` ${sl.unit}` }) : null));
    if (sl.nemesis?.art) parts.push(h('div', { class: 'wr-art', 'aria-hidden': 'true' }, pixelArt(sl.nemesis.art, 96)));
    if (sl.heat) parts.push(heatmap(sl.heat));
    if (sl.lines?.length) parts.push(h('ul', { class: 'wr-lines' }, ...sl.lines.map(l => h('li', { text: l }))));
    if (sl.pieces?.length) {
      parts.push(h('ul', { class: 'wr-pieces', 'aria-label': 'New tank pieces' },
        ...sl.pieces.map(p => h('li', { title: p.name }, pixelArt(p.art, 40), h('span', { class: 'sr-only', text: p.name })))));
    }
    if (sl.id === 'card') {
      parts.push(h('div', { class: 'row wrap wr-card-row' },
        h('button', { type: 'button', class: 'btn primary', 'data-wrapped-card': '', onclick: shareCard }, '📸 Make the card'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => SB.setView('tank') }, 'See his tank')));
      // Wrapped week: your year on your calling card for friends (numbers and a bug, never a project).
      if (week && week.year === view.year) parts.push(shareYearTick());
    }
    if (sl.id === 'friends') parts.push(...friendsBody(sl));
    return parts;
  }

  // ------------------------------------------------------------ Wrapped week (January 2nd to 8th)

  function shareYearTick() {
    const box = h('input', { type: 'checkbox', id: 'wrappedShareYear', checked: SB.state.settings?.shareWrapped === true });
    box.addEventListener('change', async () => {
      const r = await api.setSettings({ shareWrapped: box.checked }).catch(() => null);
      if (r?.settings) SB.state.settings = r.settings;
      refreshYears();
    });
    return h('div', { class: 'wr-share-year' },
      h('label', { class: 'toggle' }, box, h('span', { class: 'switch' }), 'Show my year to friends'),
      h('p', { class: 'small muted', text: 'Until January 8th, your calling card carries this year\'s XP, days together, levels, bugs and nemesis, so friends with Visiting crabs see you side by side. Never a project name.' }));
  }

  // You and up to five friends who shared, side by side, and who did most.
  function friendsBody(sl) {
    const n = v => Number(v || 0).toLocaleString();
    return [
      h('ul', { class: 'wr-friends', 'aria-label': 'You and your friends' }, ...sl.people.map(p => h('li', { class: `wr-friend${p.me ? ' me' : ''}` },
        p.nemesis?.art ? h('span', { 'aria-hidden': 'true', title: `Nemesis: ${p.nemesis.name}` }, pixelArt(p.nemesis.art, 40)) : null,
        h('b', { text: p.me ? 'You' : `@${p.login}` }),
        h('small', { text: `${n(p.days)} days` }), h('small', { text: `${n(p.xp)} XP` }), h('small', { text: `${n(p.bugs)} bugs` })))),
      sl.supers?.length ? h('ul', { class: 'wr-supers' }, ...sl.supers.map(s => h('li', {}, `${s.what}: `, h('b', { text: s.login })))) : null,
      h('div', { class: 'row wrap wr-card-row' },
        h('button', { type: 'button', class: 'btn primary', 'data-wrapped-card': '', onclick: () => shareFriends(sl) }, '📸 Make a card of us')),
    ];
  }

  function shareFriends(sl) {
    if (!view || !SB.wrappedCard?.shareFriends) return;
    stopAuto();
    sheet.hidden = true;
    SB.wrappedCard.shareFriends(view, sl);
  }

  // The 🎁 banner on the Us page and Trophies, all week.
  function renderWeek() {
    for (const box of document.querySelectorAll('[data-wrapped-week]')) {
      if (!week) { box.hidden = true; box.replaceChildren(); continue; }
      const friends = week.friendsShared ? `${week.friendsShared} friend${week.friendsShared === 1 ? ' has' : 's have'} shared theirs` : 'Show yours to friends from the card';
      box.hidden = false;
      box.replaceChildren(h('div', { class: 'ww-card' },
        h('span', { class: 'ww-emoji', 'aria-hidden': 'true', text: '🎁' }),
        h('div', { class: 'ww-text' },
          h('h3', { text: 'Wrapped week: share your year' }),
          h('p', { text: `${week.year} with Shellby, until January 8th. ${friends}.` })),
        week.open ? h('button', { type: 'button', class: 'btn primary slim-btn', dataset: { openWrapped: String(week.year) }, onclick: () => open(week.year) }, 'Open Wrapped') : null));
    }
  }

  function render() {
    if (!view) return;
    const list = view.slides;
    at = Math.max(0, Math.min(at, list.length - 1));
    const sl = list[at];
    $('wrappedTitle').textContent = `Shellby Wrapped ${view.year}`;
    $('wrappedSlide').dataset.slide = sl.id;
    $('wrappedSlide').replaceChildren(...slideBody(sl));
    $('wrappedCount').textContent = `${at + 1} of ${list.length}`;
    $('wrappedPrev').disabled = at === 0;
    $('wrappedNext').textContent = at === list.length - 1 ? 'Done' : 'Next';
    $('wrappedDots').replaceChildren(...list.map((_, i) => h('i', { class: i < at ? 'done' : i === at ? 'on' : '' })));
    const others = years.filter(y => y.year !== view.year);
    $('wrappedYears').hidden = !others.length;
    $('wrappedYears').replaceChildren(...others.slice(0, 4).map(y => h('button', {
      type: 'button', class: 'btn ghost slim-btn', onclick: () => open(y.year), 'aria-label': `Shellby Wrapped ${y.year}${y.shown ? '' : ', not seen yet'}`,
    }, String(y.year), y.shown ? null : h('i', { class: 'dot-badge', 'aria-hidden': 'true' }))));
  }

  // It moves on by itself, unless motion is turned down or you've taken the wheel.
  function autoplay() {
    clearTimeout(timer);
    timer = null;
    if (still() || sheet.hidden || !view || at >= view.slides.length - 1) return;
    timer = setTimeout(() => { at += 1; render(); autoplay(); }, AUTO_MS);
  }
  const stopAuto = () => { clearTimeout(timer); timer = null; };

  function go(step) {
    stopAuto();
    if (!view) return;
    if (at + step >= view.slides.length) return close();
    at = Math.max(0, at + step);
    render();
  }

  async function refreshYears() {
    const list = await api.getGame('wrapped').catch(() => null);
    years = list?.available || [];
    week = list?.week || null;
    trophiesButton();
    renderWeek();
    return list;
  }

  /** Open a year's Wrapped (the one due, or the newest, when none is named). */
  let opening = null; // the load-time check and main's "due" can both arrive at once
  function open(year) {
    if (!opening) opening = openYear(year).finally(() => { opening = null; });
    return opening;
  }
  async function openYear(year) {
    const list = await refreshYears();
    const y = year ?? list?.due ?? years[0]?.year;
    if (y == null) return SB.toast('No Wrapped yet. Your first one opens on January 2nd.');
    if (!sheet.hidden && view?.year === y) return;
    const v = await api.getGame('wrapped', y).catch(() => null);
    if (!v?.slides?.length) return SB.toast("Couldn't open that year.");
    view = v;
    at = 0;
    sheet.hidden = false;
    render();
    $('wrappedNext').focus();
    autoplay();
    if (!v.shown) api.gameAct('wrapped', 'shown', { year: v.year }).then(refreshYears).catch(() => {});
  }

  function close() {
    stopAuto();
    sheet.hidden = true;
  }

  function shareCard() {
    if (!view || !SB.wrappedCard) return;
    stopAuto();
    sheet.hidden = true; // the share sheet takes its place
    SB.wrappedCard.share(view);
  }

  // A 🎁 next to 📸 on Trophies while there's a year to open (or open again).
  function trophiesButton() {
    const head = document.querySelector('#trophiesView .view-head');
    if (!head) return;
    let btn = $('wrappedOpen');
    if (!years.length) { if (btn) btn.hidden = true; return; }
    if (!btn) {
      btn = h('button', { type: 'button', class: 'btn ghost slim-btn wr-open', id: 'wrappedOpen', onclick: () => open() }, '🎁');
      const share = head.querySelector('[data-share-card]');
      if (share) share.before(btn); else head.append(btn);
    }
    const fresh = years.some(y => !y.shown);
    btn.hidden = false;
    btn.title = fresh ? `Shellby Wrapped ${years.find(y => !y.shown).year} is waiting` : `Shellby Wrapped ${years[0].year}`;
    btn.setAttribute('aria-label', btn.title);
    btn.classList.toggle('fresh', fresh);
  }

  $('wrappedClose').addEventListener('click', close);
  $('wrappedPrev').addEventListener('click', () => go(-1));
  $('wrappedNext').addEventListener('click', () => go(1));
  sheet.addEventListener('click', e => { if (e.target === sheet) close(); });
  sheet.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowRight' && !e.target.closest('.wr-years')) go(1);
    else if (e.key === 'ArrowLeft' && !e.target.closest('.wr-years')) go(-1);
  });
  sheet.addEventListener('pointerdown', stopAuto);

  // Main says a year is due (January 2nd, or the first launch after it).
  api.onGame?.(msg => { if (msg?.what === 'wrapped' && msg.event === 'due') open(msg.view?.due); });
  // ...and the panel asks once when it loads, in case that was before it was listening.
  refreshYears().then(list => { if (list?.due != null) open(list.due); });
  // Wrapped week comes and goes, and friends share theirs as it goes on: a look every hour.
  setInterval(() => { if (!document.hidden) refreshYears(); }, 60 * 60 * 1000);

  SB.wrapped = { open, close, refresh: refreshYears };
})();
