/* Shellby panel — the Trophies page as a rail and pages (html/trophies.html .tr-layout):
   his level and a list of pages on the left (a row of chips on a narrow panel), one
   page beside it. Every section is still filled by its own module (xp.js, quests.js,
   week-card.js, logbook.js, review-mastery.js, wardrobe.js); this only says which page
   shows, keeps a count on each page's button, and hides a page with nothing on it.
   A jump to a section on a page (SB.reveal: the Logbook's own cards, a quest chapter,
   Ctrl+K) opens that page; the level card is in the rail, so a jump to it stays put. */
'use strict';
(function () {
  const { $ } = SB;
  const PREF = 'trophies.page';
  const HOME = 'today';
  const NAV_GAP = 12; // .tr-nav's margin-bottom in the narrow layout (trophies-rail.css)
  const view = $('trophiesView');
  const nav = $('trNav');
  const pages = () => /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-tr-page]')]);
  const buttons = () => /** @type {HTMLButtonElement[]} */ ([...nav.querySelectorAll('[data-tr-go]')]);
  const pageOf = name => pages().find(p => p.dataset.trPage === name);
  // The page you asked for, and the one showing: they differ while yours has nothing on it
  // yet (its section fills a moment after start) or any more (just the crab hides the sheet).
  // Today stands in, and yours comes back once it has something.
  let wanted = HOME;
  let shown = '';

  // A page is worth a button while something on it shows: a section can be hidden (no week
  // yet, just the crab) or a room-locked card (Review mastery before its chapter).
  const hasContent = page => [...page.children].some(el => !(/** @type {HTMLElement} */ (el).hidden) && !el.classList.contains('room-locked'));

  // Every write here is to the subtree the observer below watches, so each one happens only
  // when the value really changes: an unchanged write still counts as a mutation, and would
  // have this run again every frame.
  const setHidden = (el, on) => { if (el.hidden !== on) el.hidden = on; };
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  const setCurrent = (el, on) => { if (on !== el.hasAttribute('aria-current')) { if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); } };

  function apply() {
    const page = pageOf(wanted);
    const name = page && hasContent(page) ? wanted : HOME;
    for (const p of pages()) setHidden(p, p.dataset.trPage !== name);
    for (const b of buttons()) setCurrent(b, b.dataset.trGo === name);
    shown = name;
    return name;
  }

  function show(name, { remember = false } = {}) {
    wanted = pageOf(name) ? name : HOME;
    if (remember) SB.pref.set(PREF, wanted);
    return apply();
  }

  const compact = n => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : n.toLocaleString());
  const textOf = id => ($(id)?.textContent || '').trim();

  // The short count beside each page's name: what's waiting there, or what it holds.
  function counts() {
    const open = document.querySelectorAll('#xpBountyList li:not(.done)').length;
    const all = document.querySelectorAll('#xpBountyList li').length;
    const daily = SB.state.xp?.daily || [];
    const tier = $('rmCard')?.dataset.tier;
    return {
      today: all ? (open ? `${open} open` : 'all done') : '',
      character: $('xpSheet')?.hidden ? '' : textOf('xpClassIcon'),
      week: $('xpWeek')?.hidden || $('xpWeekPlan')?.hidden ? '' : textOf('xpWeekHours'),
      history: daily.length ? `${compact(daily.reduce((n, d) => n + d.xp, 0))} XP` : '',
      logbook: '',
      mastery: tier && tier !== '0' ? `Tier ${tier}` : '',
      trophies: (view.querySelector('.tr-count')?.textContent || '').trim(),
      ways: String(document.querySelectorAll('#xpWays li').length || ''),
    };
  }

  function refresh() {
    const n = counts();
    for (const b of buttons()) {
      const page = pageOf(b.dataset.trGo);
      setHidden(b, !page || !hasContent(page));
      const badge = b.querySelector('.tr-n');
      if (badge) setText(badge, n[b.dataset.trGo] || '');
      const waiting = b.dataset.trGo === HOME && /open$/.test(n.today);
      if (b.classList.contains('waiting') !== waiting) b.classList.toggle('waiting', waiting);
    }
    apply();
  }

  // The sections fill in their own time (each module renders on its own data), so the
  // buttons follow what they draw, once a frame at most.
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; refresh(); });
  };
  new MutationObserver(later).observe(view, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'data-tier'] });

  // A new page starts at its top: the whole view in the wide layout (the rail stays put),
  // the page list's row in the narrow one (the level card above it scrolls away).
  function toTop() {
    const above = view.getBoundingClientRect().top - view.querySelector('.tr-pages').getBoundingClientRect().top;
    const chips = getComputedStyle(nav).flexDirection === 'row' ? nav.offsetHeight + NAV_GAP : 0;
    if (above > 0) view.scrollTop -= above + chips;
  }

  const go = b => {
    show(b.dataset.trGo, { remember: true });
    toTop();
  };

  nav.addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-tr-go]'));
    if (b) go(b);
  });

  // Arrow keys walk the list, Home and End jump to its ends.
  nav.addEventListener('keydown', e => {
    const list = buttons().filter(b => !b.hidden);
    const at = list.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
    if (at < 0) return;
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : step ? (at + step + list.length) % list.length : -1;
    if (to < 0) return;
    e.preventDefault();
    list[to].focus();
    go(list[to]);
  });

  // A jump to a section opens its page first, so it lands on something you can see.
  const reveal = SB.reveal;
  SB.reveal = id => {
    const page = /** @type {HTMLElement | null} */ ($(id)?.closest('[data-tr-page]'));
    if (page && page.dataset.trPage !== shown) show(page.dataset.trPage);
    return reveal(id);
  };

  /** Ask for a page by name (today, character, week, history, logbook, mastery, trophies, ways).
      Returns the page showing: Today while the one asked for has nothing on it yet. */
  SB.trophyPage = name => show(name);

  show(SB.pref(PREF, HOME));
  const render = SB.views.trophies.render;
  SB.views.trophies.render = () => { render(); refresh(); };
})();
