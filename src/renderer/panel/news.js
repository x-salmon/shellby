/* Shellby panel — community news (src/main/news.js, wiring/news.js): a dim
   card at the top of the Us page and on About, one item at a time, with ✕.
   A contest links to its rules; a winner or a featured pack has Get it (the
   usual shellby://install path, with its checksum and the "Install pack?"
   question). Never a toast or a notification. Main sends { on, items,
   contest }; nothing here is ever put in as HTML. */
'use strict';
(function () {
  const { h, api, state } = SB;
  const HOUR = 3600000;
  const EYEBROW = { contest: '🎨 Crab contest', winner: '🏆 Contest winner', event: '🌊 Community event', featured: '✨ Featured pack', note: '🦀 News' };

  const view = () => state.news;

  function card(it, more) {
    return h('article', { class: `nw-card nw-${it.kind}`, dataset: { newsId: it.id }, 'aria-label': `Community news: ${it.title}` },
      h('div', { class: 'nw-text' },
        h('p', { class: 'nw-eyebrow', text: more ? `${EYEBROW[it.kind]} · ${more} more` : EYEBROW[it.kind] }),
        h('h3', { class: 'nw-title', text: it.title }),
        it.body ? h('p', { class: 'nw-body', text: it.body }) : null,
        h('div', { class: 'nw-actions' },
          it.pack ? h('button', { type: 'button', class: 'btn slim-btn', dataset: { newsGet: it.pack }, onclick: () => getIt(it) }, 'Get it') : null,
          it.url ? h('button', { type: 'button', class: 'btn ghost slim-btn', onclick: () => api.openExternal(it.url) }, it.kind === 'contest' ? 'The rules and entries' : 'Read more') : null)),
      h('button', { type: 'button', class: 'icon-btn nw-close', 'aria-label': `Close "${it.title}"`, title: "Close (it won't come back)", onclick: () => dismiss(it) },
        SB.icon('M4.5 4.5l7 7M11.5 4.5l-7 7', { width: 1.5 })));
  }

  async function getIt(it) {
    if (!it.pack) return;
    await api.installFromRegistry(it.pack); // the usual "Install pack?" confirmation, and its checksum
  }

  async function dismiss(it) {
    apply(await api.dismissNews(it.id).catch(() => null));
  }

  function render() {
    const v = view();
    const list = v?.on ? v.items || [] : [];
    for (const box of document.querySelectorAll('[data-news]')) {
      box.hidden = !list.length;
      box.replaceChildren(...(list.length ? [card(list[0], list.length - 1)] : []));
    }
  }

  function apply(v) {
    if (!v || typeof v !== 'object') return;
    state.news = v;
    render();
  }

  const refresh = () => api.getNews().then(apply).catch(() => {});
  api.onNews(apply);
  // "Today" moves on by itself: a look every hour while the panel's up.
  setInterval(() => { if (!document.hidden) refresh(); }, HOUR);
  refresh();
  SB.news = { refresh, render, current: () => view() || null };
})();
