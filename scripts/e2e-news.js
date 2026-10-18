// ci: community news from a fixture feed: the contest card on the Us page and About, Get it, ✕ kept after a restart, the switch
// End-to-end check of community news (src/main/news.js, docs/COMMUNITY.md)
// against the dev app over CDP, with a throwaway profile, the date pinned to
// November 5th 2026 (SHELLBY_TODAY) and the feed served from
// test/fixtures/news.json on this PC (SHELLBY_NEWS_URL, refused when
// packaged). The contest's card shows on the Us page and on About, the
// current contest is what the Painter reads (api.getNews), a link off the
// allowed sites never shows, ✕ closes a card for good (after a restart too,
// with no second fetch), and Settings → Community news off takes it all down.
// What's expected comes from the fixture through news.js, never typed in.
//   node scripts/e2e-news.js [screenshot folder]
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { savePng } = require('./lib/shot');
const news = require('../src/main/news');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_CDP_PORT) || 9471;
const DAY = '2026-11-05';
const FEED = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'news.json'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let fails = 0;
  const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) fails++; };
  const expected = news.pick(news.parseFeed(FEED), DAY);
  let served = 0;
  const server = http.createServer((req, res) => {
    if (req.url !== '/feed/news.json') { res.writeHead(404); res.end(); return; }
    served++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(FEED);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const feedUrl = `http://127.0.0.1:${server.address().port}/feed/news.json`;
  const profile = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-test-')));
  const shots = process.argv[2] || null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let app = null;

  const launch = async () => {
    app = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), [ROOT, `--remote-debugging-port=${PORT}`], {
      stdio: 'ignore',
      env: {
        ...process.env, SHELLBY_E2E: '1', SHELLBY_USER_DATA: profile, SHELLBY_TODAY: DAY, SHELLBY_NEWS_URL: feedUrl,
        SHELLBY_FAKE_CLAUDE: path.join(ROOT, 'test', 'fixtures', 'fake-claude.js'), SHELLBY_HOOK_PORT: process.env.E2E_HOOK_PORT || '48071',
      },
    });
    let list = [];
    for (let i = 0; i < 40 && !list.some(t => t.url.endsWith('panel.html')); i++) {
      try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* starting */ }
      await wait(500);
    }
    const ws = new WebSocket(list.find(t => t.url.endsWith('panel.html')).webSocketDebuggerUrl);
    await new Promise(r => { ws.onopen = r; });
    let id = 0; const p = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); p.get(m.id)?.(m); };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, m => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
    const until = async (expr, ms = 10000) => { for (let t = 0; t < ms; t += 250) { if (await ev(expr)) return true; await wait(250); } return false; };
    await until('!!window.SB && !!SB.news');
    return { send, ev, until, close: () => ws.close() };
  };
  const quit = async () => {
    app.kill();
    for (let i = 0; i < 20 && app.exitCode === null && app.signalCode === null; i++) await wait(250);
    await wait(500);
  };

  try {
    let { send, ev, until, close } = await launch();
    await ev(`shellby.setSettings({ onboarded: true, crabOnly: false })`);

    // ---- fetched once, a couple of seconds after boot (test runs), and current for November 5th
    check(await until(`shellby.getNews().then(v => v.items.length > 0)`), 'the fixture feed is fetched');
    const v = await ev(`shellby.getNews()`);
    check(v?.on === true, 'news is on by default');
    check(JSON.stringify(v?.items.map(i => i.id)) === JSON.stringify(expected.items.map(i => i.id)), `today's items, contest first (${v?.items.map(i => i.id).join(', ')})`);
    check(!v?.items.some(i => /example\.com/.test(i.url || '')), 'the item linking off the allowed sites never shows');
    check(v?.contest?.id === expected.contest.id && v.contest.contest.month === expected.contest.contest.month, `the current contest, for the Painter (${v?.contest?.id})`);

    // ---- the Us page: one quiet card, the contest
    await ev(`SB.setView('us')`);
    await wait(500);
    const card = JSON.parse(await ev(`JSON.stringify((b => b && { hidden: b.hidden, n: b.querySelectorAll('.nw-card').length, id: b.querySelector('.nw-card')?.dataset.newsId, title: b.querySelector('.nw-title')?.textContent, eyebrow: b.querySelector('.nw-eyebrow')?.textContent })(document.querySelector('[data-news="us"]')))`));
    check(card && !card.hidden && card.n === 1, 'the Us page shows one card');
    check(card?.id === expected.items[0].id && card.title === expected.items[0].title, `the contest's (${card?.title})`);
    check(card?.eyebrow?.includes(`${expected.items.length - 1} more`), `and says how many more wait (${card?.eyebrow})`);
    check(await ev(`!document.querySelector('[data-news="about"]').hidden`), 'About shows it too');
    if (shots) await savePng(send, path.join(shots, 'news-us.png'));

    // ---- ✕: the next one, the winner, with Get it
    await ev(`document.querySelector('[data-news="us"] .nw-close').click()`);
    check(await until(`document.querySelector('[data-news="us"] .nw-card')?.dataset.newsId === ${JSON.stringify(expected.items[1].id)}`), 'closing it shows the next: the winner');
    check(await ev(`document.querySelector('[data-news="us"] [data-news-get]')?.dataset.newsGet`) === expected.items[1].pack, 'with Get it for its pack');
    const after = await ev(`shellby.getNews()`);
    check(after?.contest?.id === expected.contest.id, 'the Painter still has the contest');
    const fetches = served;
    close();
    await quit();

    // ---- a restart: still closed, and no second fetch the same day
    ({ send, ev, until, close } = await launch());
    await wait(3500);
    const again = await ev(`shellby.getNews()`);
    check(again?.items?.[0]?.id === expected.items[1].id, `still closed after a restart (${again?.items?.[0]?.id})`);
    check(served === fetches, `fetched at most once a day (${served} fetch${served === 1 ? '' : 'es'})`);

    // ---- the switch: off takes the cards down
    await ev(`shellby.setSettings({ communityNews: false }).then(() => SB.news.refresh())`);
    await wait(500);
    check(await ev(`document.querySelector('[data-news="us"]').hidden && document.querySelector('[data-news="about"]').hidden`), 'Community news off hides the cards');
    check((await ev(`shellby.getNews()`))?.contest === null, 'and offers no contest');
    close();
  } catch (e) {
    console.log(`FAIL  ${e.stack || e}`);
    fails++;
  } finally {
    app?.kill();
    server.close();
    await wait(800);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* still closing */ }
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
