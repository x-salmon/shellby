// Community news (news.js), wired up: the gallery's news.json fetched 30 s
// after boot and then at most once a day, through the registry's own fetch
// (registry.js: a timeout, a 64 KB cap, nothing off the site). A failed fetch
// keeps the last good copy. The panel reads it as news:get and hears `news`
// ({ on, items, contest }); closing an item marks it seen, which syncs.
// Never a toast, a notification or anything on the desktop: the Us page and
// About show it quietly, and the Painter reads the current contest.
// Off (Settings → Shellby → Community news) means no fetch at all.
// See docs/plans/community-events.md §2.
const { app } = require('electron');
const news = require('../news');
const { fetchRegistryNews } = require('../registry');
const { isTestRun } = require('../test-desktop');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 6 * 60 * 60 * 1000;  // after a failed fetch, not again for a while
const FIRST_MS = 30 * 1000;           // after boot, once the panel and the rest have settled
const TEST_FIRST_MS = 2 * 1000;       // ...sooner in test runs, so e2e-news needn't wait
const CHECK_MS = 60 * 60 * 1000;      // how often to ask whether a day has passed

/** d: what main shares (main.js `shared`). */
function wireNews(d) {
  const on = () => !d.CAPTURE && !!d.config && d.config.get('communityNews') !== false;
  const today = () => (d.today ? d.today() : new Date());
  const read = () => news.normalize(d.config?.get('news'));
  const save = patch => d.config.set({ news: { ...read(), ...patch } });
  let busy = null;

  /** { on, items, contest }: what's current today, minus what you closed. */
  function newsView() {
    if (!on()) return { on: false, items: [], contest: null };
    const s = read();
    return { on: true, ...news.pick(s.feed, today(), s.seen) };
  }
  const push = () => d.send(d.panel, 'news', newsView());

  /** Fetch the feed if a day has gone by (or `force`), keep it if it's good, and tell the panel. */
  function refreshNews({ force = false } = {}) {
    if (!on() || busy) return busy || Promise.resolve(newsView());
    const s = read();
    const now = Date.now();
    if (!force && (now - s.fetchedAt < DAY_MS || now - s.triedAt < RETRY_MS)) return Promise.resolve(newsView());
    busy = (async () => {
      save({ triedAt: now });
      const r = await fetchRegistryNews({ baseUrl: d.registryUrl(), url: d.newsUrl?.() || null });
      const feed = r.ok ? news.parseFeed(r.text) : null;
      if (feed) save({ feed, fetchedAt: now });
      else d.log.info(`news: kept the last copy (${r.ok ? 'not a feed this version reads' : r.errors[0]})`);
      push();
      return newsView();
    })().catch(e => { d.log.warn('news fetch failed', e?.message || String(e)); return newsView(); }).finally(() => { busy = null; });
    return busy;
  }

  /** ✕ on a card: seen here, and on your other PCs once Sync runs. */
  function dismissNews(id) {
    save({ seen: news.markSeen(read().seen, id) });
    push();
    return newsView();
  }

  /** Switched on in Settings: fetch now if there's nothing yet. Off: the cards go. */
  function newsSettingChanged() {
    if (on() && !read().fetchedAt) refreshNews({ force: true });
    push();
  }

  function startNews() {
    const first = isTestRun(process.env, app.isPackaged) ? TEST_FIRST_MS : FIRST_MS;
    setTimeout(() => refreshNews(), first).unref?.();
    d.every(() => refreshNews(), CHECK_MS);
  }

  return { newsView, refreshNews, dismissNews, newsSettingChanged, startNews, pushNews: push };
}

module.exports = { wireNews };
