const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const news = require('../src/main/news');
const { fetchRegistryNews } = require('../src/main/registry');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'news.json'), 'utf8');
const item = (over = {}) => ({ id: 'note-a', kind: 'note', title: 'Hello', body: 'Hi there', from: '2026-11-01', until: '2026-11-30', ...over });
const feed = items => ({ format: 1, items });
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

test('a good feed comes through, every item checked', () => {
  const f = news.parseFeed(FIXTURE);
  assert.deepEqual(f.items.map(i => i.id), ['contest-2026-11', 'winner-2026-10', 'note-hello', 'wrapped-2026'], 'the link to example.com is dropped alone');
  const c = f.items[0];
  assert.deepEqual(c.contest, { month: '2026-11', theme: 'frozen', kinds: ['skin'], monthName: 'November 2026' });
  assert.equal(f.items[1].pack, 'tiny-hats');
  assert.equal(f.items[2].url, null);
});

test('bad kinds, long strings, foreign links and bad pack ids are dropped one by one', () => {
  const keep = id => news.cleanFeed(feed([item({ id: 'ok' }), item({ id, ...cases[id] })])).items.map(i => i.id);
  const cases = {
    'bad-kind': { kind: 'ad' },
    'no-title': { title: '   ' },
    'bad-day': { from: '2026-02-30' },
    'backwards': { from: '2026-12-01', until: '2026-11-01' },
    'no-until': { until: undefined },
    'http-link': { url: 'http://github.com/x-salmon/shellby' },
    'foreign-link': { url: 'https://github.com/someone-else/repo' },
    'lookalike': { url: 'https://getshellby.com.evil.example/' },
    'with-port': { url: 'https://x-salmon.github.io:8443/x' },
    'creds': { url: 'https://me@github.com/x-salmon/shellby' },
    'pack-on-note': { pack: 'tiny-hats' },
    'bad-pack': { kind: 'featured', pack: '../evil' },
    'contest-wrong-kind': { contest: { month: '2026-11', theme: 'x', kinds: ['skin'] } },
    'contest-bad': { kind: 'contest', contest: { month: '2026-13', theme: 'frozen', kinds: ['skin'] } },
    'contest-kinds': { kind: 'contest', contest: { month: '2026-11', theme: 'frozen', kinds: ['skin', 'malware'] } },
    'contest-none': { kind: 'contest' },
    'BadId': {},
  };
  for (const id of Object.keys(cases)) assert.deepEqual(keep(id), ['ok'], id);
  assert.equal(news.cleanItem(item({ id: 'x'.repeat(61) })), null, 'ids are at most 60');
  assert.ok(news.cleanItem(item({ id: 'x'.repeat(60) })));
});

test('every string is clipped and made plain', () => {
  const it = news.cleanItem(item({ title: `<b>${'t'.repeat(100)}</b>`, body: `line one\nline‮two ${'b'.repeat(300)}` }));
  assert.equal(it.title.length, 60);
  assert.ok(it.title.startsWith('<b>'), 'kept as text, never HTML');
  assert.equal(it.body.length, 200);
  assert.ok(!/[\n‮]/.test(it.body));
  const c = news.cleanItem(item({ kind: 'contest', contest: { month: '2026-11', theme: 'f'.repeat(80), kinds: ['skin', 'skin', 'decor'] } }));
  assert.equal(c.contest.theme.length, 40);
  assert.deepEqual(c.contest.kinds, ['skin', 'decor']);
});

test('not a feed, a newer format or too big: nothing (yesterday\'s copy stays)', () => {
  assert.equal(news.parseFeed('nope'), null);
  assert.equal(news.parseFeed(JSON.stringify({ format: 2, items: [] })), null);
  assert.equal(news.parseFeed(JSON.stringify({ format: 1 })), null);
  assert.equal(news.parseFeed(JSON.stringify(feed([item({ body: 'x'.repeat(70 * 1024) })]))), null, 'over 64 KB');
  assert.deepEqual(news.cleanFeed(feed([item(), item({ title: 'again' })])).items.map(i => i.title), ['Hello'], 'a repeated id keeps the first');
});

test('what shows is what\'s current today, most important first, minus what you closed', () => {
  const f = news.parseFeed(FIXTURE);
  const nov5 = news.pick(f, at(2026, 11, 5));
  assert.deepEqual(nov5.items.map(i => i.id), ['contest-2026-11', 'winner-2026-10', 'note-hello']);
  assert.equal(nov5.contest.id, 'contest-2026-11');
  const closed = news.pick(f, at(2026, 11, 5), ['contest-2026-11']);
  assert.deepEqual(closed.items.map(i => i.id), ['winner-2026-10', 'note-hello']);
  assert.equal(closed.contest.id, 'contest-2026-11', 'the Painter still offers a contest whose card you closed');
  assert.equal(news.pick(f, at(2026, 11, 22)).contest, null, 'entries close after the 21st');
  assert.deepEqual(news.pick(f, at(2026, 10, 15)).items.map(i => i.id), ['note-hello']);
  assert.deepEqual(news.pick(f, '2026-11-21').items.map(i => i.id)[0], 'contest-2026-11', 'until is inclusive');
});

test('items across the new year, and SHELLBY_TODAY\'s day', () => {
  const f = news.cleanFeed(feed([item({ id: 'nye', from: '2026-12-28', until: '2027-01-03' })]));
  assert.equal(news.pick(f, at(2026, 12, 31)).items.length, 1);
  assert.equal(news.pick(f, at(2027, 1, 3, 23)).items.length, 1);
  assert.equal(news.pick(f, at(2027, 1, 4, 0)).items.length, 0);
  const { makeToday } = require('../src/main/today');
  const today = makeToday({ packaged: false, env: { SHELLBY_TODAY: '2027-01-02' } });
  assert.deepEqual(news.pick(news.parseFeed(FIXTURE), today()).items.map(i => i.id), ['wrapped-2026']);
  assert.deepEqual(news.pick(null, at(2026, 11, 5)), { items: [], contest: null });
  assert.deepEqual(news.pick(f, 'not a day'), { items: [], contest: null });
});

test('closed items merge for Sync: closed on either PC is closed', () => {
  const a = news.markSeen([], 'contest-2026-11');
  const b = news.markSeen(news.markSeen([], 'note-hello'), 'contest-2026-11');
  assert.deepEqual(news.mergeSeen(a, b), ['contest-2026-11', 'note-hello']);
  assert.deepEqual(news.markSeen(a, '<script>'), a);
  assert.deepEqual(news.cleanSeen(['ok', 7, 'Bad', 'ok']), ['ok']);
  assert.equal(news.cleanSeen(Array.from({ length: 300 }, (_, i) => `n-${i}`)).length, 200);
  const sync = require('../src/main/github/sync');
  const m = sync.merge({ news: { seen: a } }, { news: { seen: ['note-hello'] } });
  assert.deepEqual(m.news.seen, ['contest-2026-11', 'note-hello']);
  const patch = sync.patchFor(m, k => ({ news: { seen: ['note-hello'], fetchedAt: 5 } })[k]);
  assert.deepEqual(patch.news, { seen: ['note-hello', 'contest-2026-11'], fetchedAt: 5 }, 'the feed and when it came stay this PC\'s');
});

test('the stored copy is tolerated whatever is on disk', () => {
  assert.deepEqual(news.normalize(null), { feed: null, fetchedAt: 0, triedAt: 0, seen: [] });
  const s = news.normalize({ feed: JSON.parse(FIXTURE), fetchedAt: -1, triedAt: 'x', seen: ['a', 'B'] });
  assert.equal(s.feed.items.length, 4);
  assert.deepEqual([s.fetchedAt, s.triedAt, s.seen], [0, 0, ['a']]);
});

test('the fetch stays on the gallery\'s site and under 64 KB', async () => {
  let body = FIXTURE;
  const server = http.createServer((req, res) => {
    if (req.url === '/packs/news.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(body); return; }
    if (req.url === '/packs/away.json') { res.writeHead(302, { location: 'http://127.0.0.1:1/x' }); res.end(); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/packs/`;
  try {
    const ok = await fetchRegistryNews({ baseUrl: base });
    assert.equal(ok.ok, true);
    assert.equal(news.parseFeed(ok.text).items.length, 4);
    const fixture = await fetchRegistryNews({ url: `${base}news.json` });
    assert.equal(fixture.ok, true, 'SHELLBY_NEWS_URL: a feed at its own address');
    body = 'x'.repeat(65 * 1024);
    assert.equal((await fetchRegistryNews({ baseUrl: base })).ok, false, 'too big');
    assert.equal((await fetchRegistryNews({ url: `${base}away.json` })).ok, false, 'no redirect off the site');
    assert.equal((await fetchRegistryNews({ url: 'file:///etc/passwd' })).ok, false);
  } finally {
    server.close();
  }
});
