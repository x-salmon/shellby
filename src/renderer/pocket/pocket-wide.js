/* Shellby on any screen, and on any of your PCs.

   On a wide screen (a tablet on its side or a computer's browser) the beach
   stays on the left and the conversation you pick opens beside it. The beach
   is mounted once and kept while you move between conversations, so its
   scroll and anything half-typed never go.

   The top bar names this PC and, with others in the hub, links to each one's
   own Shellby (pcSwitch): you pair with each, and each keeps its own rules.

   The two halves are one screen to pocket.js: update() reaches both, and
   tabId and feed() are the open conversation's, so the stream and keeping
   the screen awake work as they do on a phone. The width matches pocket.css's
   "a wide screen" block (test/pocket-wide.test.js). */
'use strict';
window.PocketWide = function PocketWide({ S, D, h, live, show, wake, beachScreen, tabScreen, remount }) {
  const WIDE = window.matchMedia?.('(min-width: 1000px)');
  const wide = () => !!WIDE?.matches;

  function pickPane() {
    const el = h('div', { class: 'screen wide-empty' },
      D.crab({ px: 4, state: S.view?.crab?.state || 'idle', label: '' }),
      h('p', { class: 'muted', text: 'Pick a conversation to open it here.' }));
    return { el, update() {}, title: 'Shellby' };
  }

  function wideScreen(tabId) {
    const old = S.screen?.beach ? S.screen : null;
    const beach = old?.beach || beachScreen();
    const pane = tabId ? tabScreen(tabId) : pickPane();
    const el = old?.el || h('div', { class: 'wide' }, h('div', { class: 'wide-list' }, beach.el), h('div', { class: 'wide-pane' }));
    el.lastChild.replaceChildren(pane.el);
    const screen = {
      el, beach, tabId: pane.tabId || null, title: pane.title,
      update() { beach.update(); pane.update(); },
      feed: pane.feed ? () => pane.feed() : null,
    };
    if (!old) { show(screen); return; }
    // Already up: only the right side changes, and the list marks the one now open.
    S.screen = screen;
    document.title = `${screen.title} · Shellby`;
    beach.update();
    wake.sync(!!screen.tabId);
  }

  // Turning a tablet, or resizing the window across the line: the same place, laid out again.
  WIDE?.addEventListener?.('change', remount);

  // This PC, and the hub's other PCs beside it (pocket/view.js phonePcs). Each
  // opens that PC's own Shellby: it keeps its own pairing and its own rules.
  function pcSwitch(pc) {
    const here = h('span', { class: `pc ${live() ? 'on' : 'off'}`, role: 'status', 'aria-label': live() ? `Connected to ${pc}` : `Not connected to ${pc}` }, h('i'), h('span', { text: pc }));
    // The PC checked them already; a link is only ever https on your tailnet all the same.
    const others = (S.view?.pcs || []).filter(p => /^https:\/\/[a-z0-9.-]+\.ts\.net(:\d+)?$/.test(p?.url || '') && p.url !== location.origin);
    if (!others.length) return here;
    return h('nav', { class: 'pcs', 'aria-label': 'Your PCs' }, here,
      ...others.map(p => h('a', { class: 'pc other', href: `${p.url}/`, 'aria-label': `Open Shellby on ${p.name}` }, h('i'), h('span', { text: p.name }))));
  }

  return {
    wide, pcSwitch,
    // A conversation: beside the beach when there's room, on its own otherwise.
    tab: tabId => (wide() ? wideScreen(tabId) : show(tabScreen(tabId))),
    // The beach, beside an empty pane when there's room for one.
    beach: () => (wide() ? wideScreen(null) : show(beachScreen())),
  };
};
