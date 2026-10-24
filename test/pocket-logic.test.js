// The phone app's parts with no DOM (renderer/pocket/pocket-logic.js): reading
// the stream, folding a transcript into what's drawn, a little markdown that
// never becomes HTML, a diff, and the words on the beach. Plus the Settings
// lines for it (settings-text.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/renderer/pocket/pocket-logic');
const T = require('../src/renderer/panel/settings-text');

test('the stream is read however the chunks fall, and pings are skipped', () => {
  const got = [];
  const feed = L.sseParser((name, data) => got.push([name, data]));
  feed('retry: 2000\n\nevent: view\ndata: {"v":');
  feed('1}\n\n: ping\n\nevent: item\r\ndata: {"tabId":"t1"}\r\n\r\n');
  feed('event: bye\ndata: not json\n\n');
  assert.deepEqual(got, [['view', { v: 1 }], ['item', { tabId: 't1' }], ['bye', null]]);
});

test('a compacting tab’s working line says it’s tidying up, under a waiting prompt', () => {
  assert.equal(L.doingLine({ compacting: true, todos: { current: 'Fix it' } }), 'Tidying the conversation up');
  assert.equal(L.doingLine({ compacting: true, pending: 1 }), 'Waiting on your yes');
  assert.equal(L.doingLine({ todos: { current: 'Fix it' } }), 'Fix it');
});

test('reconnecting backs off, up to fifteen seconds', () => {
  assert.equal(L.backoff(0, () => 0.5), 1000);
  assert.equal(L.backoff(2, () => 0.5), 4000);
  assert.equal(L.backoff(20, () => 0.5), 15000);
});

test('a transcript folds into replies, tool rows, helper lanes and the turn’s end', () => {
  const blocks = L.fold([
    { k: 'user', text: 'fix it', turnId: 'u1' },
    { k: 'text', text: 'On it.' },
    { k: 'text', text: 'Reading first.' },
    { k: 'tool', id: 'a', label: 'Read', detail: 'a.js' },
    { k: 'done', id: 'a', error: false },
    { k: 'tool', id: 'b', label: 'Run', detail: 'npm test' },
    { k: 'done', id: 'b', error: true, text: 'exit 1' },
    { k: 'tool', id: 'h', label: 'Agent', agent: { type: 'Explore', description: 'map it' } },
    { k: 'tool', id: 'x', label: 'Grep', detail: 'foo', sub: true, parent: 'h' },
    { k: 'task', phase: 'done', toolUseId: 'h', taskId: 'k1', status: 'completed', summary: 'found 3 callers' },
    { k: 'asked', requestId: 'r1', label: 'Run', detail: 'rm x' },
    { k: 'decision', requestId: 'r1', decision: 'deny', via: 'pocket' },
    { k: 'tool', id: 'c', label: 'Edit', detail: 'b.js' },
    { k: 'end', ok: true, seconds: 42, tokens: 1200, share: 3 },
  ]);
  assert.deepEqual(blocks.map(b => b.type), ['user', 'text', 'tools', 'crew', 'asked', 'tools', 'end']);
  assert.equal(blocks[1].text, 'On it.\n\nReading first.');
  assert.deepEqual(blocks[2].tools.map(t => t.state), ['ok', 'error']);
  assert.equal(blocks[3].lanes[0].state, 'ok');
  assert.equal(blocks[3].lanes[0].summary, 'found 3 callers');
  assert.equal(blocks[3].lanes[0].activity, 'Grep foo');
  assert.equal(blocks[4].decision, 'deny');
  // A turn that ended leaves nothing spinning.
  assert.equal(blocks[5].tools[0].state, 'ok');
  assert.equal(L.endLine(blocks[6]), '42s · 1.2k tokens · 3% of your window');
});

test('an undo marks its changes undone', () => {
  const blocks = L.fold([{ k: 'changes', after: 'a1', added: 3, removed: 1, files: [] }, { k: 'undone', after: 'a1' }]);
  assert.equal(blocks[0].undone, true);
  assert.equal(blocks[1].type, 'note');
});

test('a busy helper’s live steps never push the conversation out of the feed', () => {
  let items = [{ k: 'user', text: 'look around' }, { k: 'tool', id: 'a', label: 'Agent', agent: { type: 'Explore', description: 'map it' } }];
  for (let i = 0; i < 1000; i++) {
    items = L.keepItem(items, { k: 'tool', id: `s${i}`, label: 'Read', detail: `f${i}.js`, sub: true, parent: 'a' }, 600);
    items = L.keepItem(items, { k: 'done', id: `s${i}`, sub: true, parent: 'a' }, 600);
  }
  assert.deepEqual(items.map(i => i.k), ['user', 'tool', 'tool']);
  const blocks = L.fold(items);
  assert.deepEqual(blocks.map(b => b.type), ['user', 'crew']);
  assert.equal(blocks[1].lanes[0].activity, 'Read f999.js');
  // The conversation's own items still roll off at the cap.
  for (let i = 0; i < 700; i++) items = L.keepItem(items, { k: 'text', text: `${i}` }, 600);
  assert.equal(items.length, 600);
});

test('markdown becomes blocks of plain runs, never HTML', () => {
  const md = L.markdown('# Title\n\nSome **bold**, `code` and [a link](https://example.com) and [bad](javascript:alert(1)).\n\n- one\n- two\n\n```js\nconst x = "<b>";\n```\n\n<script>alert(1)</script>');
  assert.deepEqual(md.map(b => b.t), ['h', 'p', 'li', 'li', 'code', 'p']);
  const runs = md[1].runs;
  assert.ok(runs.some(r => r.b && r.text === 'bold'));
  assert.ok(runs.some(r => r.code && r.text === 'code'));
  assert.ok(runs.some(r => r.href === 'https://example.com'));
  assert.ok(!runs.some(r => r.href && r.href.startsWith('javascript')));
  assert.equal(md[4].text, 'const x = "<b>";');
  // A tag is text, to be set with textContent.
  assert.equal(md[5].runs[0].text, '<script>alert(1)</script>');
});

test('a unified diff parses into files, hunks and numbered rows', () => {
  const files = L.parsePatch([
    'diff --git a/src/a.js b/src/a.js', 'index 1..2 100644', '--- a/src/a.js', '+++ b/src/a.js',
    '@@ -10,3 +10,3 @@ function f() {', ' keep', '-old', '+new', '\\ No newline at end of file',
    'diff --git a/img.png b/img.png', 'Binary files a/img.png and b/img.png differ',
  ].join('\n'));
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'src/a.js');
  assert.equal(files[0].hunks[0].header, 'function f() {');
  assert.deepEqual(files[0].hunks[0].rows, [
    { kind: 'ctx', text: 'keep', a: 10, b: 10 }, { kind: 'del', text: 'old', a: 11, b: null }, { kind: 'add', text: 'new', a: null, b: 11 },
  ]);
  assert.equal(files[1].binary, true);
});

test('the hash says which screen, and anything odd is the beach', () => {
  assert.deepEqual(L.route('#/tab/abc-1'), { name: 'tab', tabId: 'abc-1' });
  assert.deepEqual(L.route('#/diff/t1/a1b2'), { name: 'diff', tabId: 't1', after: 'a1b2' });
  assert.deepEqual(L.route('#/queue'), { name: 'queue' });
  assert.deepEqual(L.route('#/branch/t1'), { name: 'branch', tabId: 't1' });
  assert.deepEqual(L.route('#/past/abc-1'), { name: 'past', id: 'abc-1' });
  assert.deepEqual(L.route('#/past/../x'), { name: 'beach' });
  assert.deepEqual(L.route('#/find'), { name: 'find' });
  assert.deepEqual(L.route('#/history'), { name: 'history' });
  assert.deepEqual(L.route('#/project-history'), { name: 'project-history' });
  assert.deepEqual(L.route('#/prompt/t1/req-9'), { name: 'prompt', tabId: 't1', requestId: 'req-9' });
  assert.deepEqual(L.route('#/prompt/t1'), { name: 'beach' });
  assert.deepEqual(L.route('#/prompt/t1/a%20b'), { name: 'beach' });
  assert.deepEqual(L.route('#/tab/../../x'), { name: 'beach' });
  assert.deepEqual(L.route('#/tab/%E0%A4%A'), { name: 'beach' });
  assert.deepEqual(L.route(''), { name: 'beach' });
});

test('a tapped notification leads to its screen only while the tap is fresh', () => {
  const now = 1_000_000;
  assert.equal(L.tappedHash({ url: '/#/tab/t1', at: now - 5000 }, now), '#/tab/t1');
  assert.equal(L.tappedHash({ url: '/', at: now }, now), '#/');
  assert.equal(L.tappedHash({ url: '/#/tab/t1', at: now - 10 * 60 * 1000 }, now), null);
  assert.equal(L.tappedHash({ url: 'https://elsewhere.example/#/tab/t1', at: now }, now), null);
  assert.equal(L.tappedHash({ url: '//elsewhere.example/', at: now }, now), null);
  assert.equal(L.tappedHash({ url: '/#/tab/t1', at: now + 60 * 1000 }, now), null);
  assert.equal(L.tappedHash({ url: '/#/tab/t1' }, now), null);
  assert.equal(L.tappedHash(null, now), null);
});

test('the beach leads with what needs you, then what’s working, then what’s ready', () => {
  const tabs = [{ id: 'a', standing: 'working' }, { id: 'b', standing: 'review' }, { id: 'c', standing: 'quiet' }];
  assert.equal(L.headline({ tabs, prompts: [{}, {}] }).title, '2 things need you');
  assert.equal(L.headline({ tabs, prompts: [] }).title, 'On it');
  assert.equal(L.headline({ tabs: [tabs[1]], prompts: [] }).title, 'Ready for a look');
  assert.equal(L.headline({ tabs: [], prompts: [] }).title, 'All quiet');
  assert.deepEqual(L.sections({ tabs, prompts: [] }).map(s => s.key), ['review', 'working', 'quiet']);
  // An asking tab with no prompt in the list still shows up.
  assert.equal(L.sections({ tabs: [{ id: 'z', standing: 'asking' }], prompts: [] })[0].key, 'asking');
});

test('words: durations, tokens, a typed code', () => {
  assert.equal(L.duration(42), '42s');
  assert.equal(L.duration(252), '4m 12s');
  assert.equal(L.duration(3 * 3600 + 120), '3h 02m');
  assert.equal(L.tokens(23100), '23.1k tokens');
  assert.equal(L.formatCode('k7q2m9xd'), 'K7Q2-M9XD');
  assert.equal(L.formatCode('k7-q2'), 'K7Q2');
  assert.equal(L.isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)'), true);
  assert.equal(L.isIos('Mozilla/5.0 (Macintosh)', 5), true);
  assert.equal(L.isIos('Mozilla/5.0 (Linux; Android 15)'), false);
  assert.deepEqual([...L.keyBytes('AQID')], [1, 2, 3]);
});

test('an update waits to redraw a list while a thumb is on it or it is still coasting', () => {
  const now = 10_000;
  assert.equal(L.holdRedraw({ touching: true, movedAt: 0 }, now), true);
  assert.equal(L.holdRedraw({ touching: false, movedAt: now - 50 }, now), true);
  assert.equal(L.holdRedraw({ touching: false, movedAt: now - L.SETTLE_MS }, now), false);
  assert.equal(L.holdRedraw({}, now), false, 'a list nobody has touched redraws straight away');
});

test('history groups by the day it was worked on, newest first, and the away card sums itself up', () => {
  const now = new Date(2026, 9, 19, 12).getTime(); // a Monday
  const day = 864e5;
  assert.equal(L.dayLabel(now - 3600e3, now), 'Today');
  assert.equal(L.dayLabel(now - day, now), 'Yesterday');
  assert.equal(L.dayLabel(now - 3 * day, now), 'Friday');
  assert.equal(L.dayLabel(now - 10 * day, now), '9 Oct');
  assert.equal(L.dayLabel(now - 400 * day, now), '14 Sep 2025');
  const groups = L.byDay([{ id: 'a', at: now - day }, { id: 'b', at: now - 1000 }, { id: 'c', at: now - day - 3600e3 }], now);
  assert.deepEqual(groups.map(g => [g.label, g.entries.map(e => e.id)]), [['Today', ['b']], ['Yesterday', ['a', 'c']]]);
  assert.equal(L.awayLine({ finished: [1, 2], trouble: [], waiting: [1], share: 4.2 }), '2 finished, 1 waiting on you, 4% of your window spent');
  assert.equal(L.awayLine({ finished: [], trouble: [1], waiting: [], share: 0, tokens: 2300 }), '1 hit a problem, 2.3k tokens spent');
  assert.equal(L.awayLine({ finished: [], trouble: [], waiting: [], share: 0.4 }), '<1% of your window spent');
});

const base = { tailscale: { installed: true, state: 'running', dnsName: 'pc.tail.ts.net', https: true }, enabled: true, server: { status: 'listening', connected: 0 }, url: 'https://pc.tail.ts.net/', devices: [], problem: null };

test('Settings: the steps to get there, one at a time', () => {
  assert.deepEqual(T.pocketSteps({ ...base, enabled: false, url: '', tailscale: { installed: false }, setup: { link: 'https://tailscale.com/download/windows' } }).map(s => s.state), ['bad', 'todo', 'todo', 'todo']);
  assert.equal(T.pocketSteps({ ...base, tailscale: { installed: false }, setup: { link: 'x' } })[0].link, 'x');
  assert.deepEqual(T.pocketSteps({ ...base, tailscale: { ...base.tailscale, https: false } }).map(s => s.state), ['ok', 'bad', 'ok', 'todo']);
  assert.deepEqual(T.pocketSteps({ ...base, devices: [{ name: 'iPhone' }] }).map(s => s.state), ['ok', 'ok', 'ok', 'ok']);
  assert.match(T.pocketSteps({ ...base, devices: [{ name: 'iPhone' }] })[3].text, /iPhone is paired/);
  const bad = T.pocketSteps({ ...base, problem: { text: 'Serve is off.', link: 'https://login.tailscale.com/f/serve', linkText: 'Turn on Serve' } })[2];
  assert.deepEqual([bad.state, bad.linkText], ['bad', 'Turn on Serve']);
});

test('Settings: the line under the switch, and the code’s time left', () => {
  assert.equal(T.pocketStatus({ ...base, enabled: false }).text, '');
  assert.equal(T.pocketStatus({ ...base, server: { status: 'busy', port: 47916 } }).tone, 'warn');
  assert.equal(T.pocketStatus(base).text, 'Pair a phone to begin.');
  assert.equal(T.pocketStatus({ ...base, devices: [{}] }).text, 'Waiting for your phone.');
  assert.deepEqual(T.pocketStatus({ ...base, server: { status: 'listening', connected: 1 } }), { text: 'Your phone is looking now.', tone: 'ok' });
  assert.equal(T.pocketCodeHint({ expiresAt: 1000 + 4 * 60 * 1000, triesLeft: 5 }, 1000), 'Type it into Shellby on your phone. 4 min left.');
  assert.equal(T.pocketCodeHint({ expiresAt: 1000 + 30 * 1000, triesLeft: 2 }, 1000), 'Type it into Shellby on your phone. 30s left, 2 tries left.');
});

test('a share and the Trophies screen have routes of their own', () => {
  assert.deepEqual(L.route('#/share'), { name: 'share' });
  assert.deepEqual(L.route('#/trophies'), { name: 'trophies' });
  assert.deepEqual(L.route('#/new'), { name: 'new' });
});

test('a screen reader hears a new prompt and a conversation that just finished, not the first view', () => {
  const prompt = (id, title) => ({ requestId: id, tabId: 't1', title });
  const tab = (id, standing, outcome = null) => ({ id, title: `Tab ${id}`, standing, outcome });
  const before = { prompts: [prompt('r1', 'Fix the test')], tabs: [tab('a', 'working'), tab('b', 'working'), tab('c', 'working'), tab('d', 'review')] };
  assert.deepEqual(L.announcements(null, before), []);
  assert.deepEqual(L.announcements(before, before), []);
  const after = { prompts: [prompt('r1', 'Fix the test'), prompt('r2', 'Ship it')], tabs: [tab('a', 'review'), tab('b', 'finished', 'error'), tab('c', 'finished', 'stopped'), tab('d', 'review')] };
  assert.deepEqual(L.announcements(before, after), ['He needs you: Ship it.', 'Tab a is done.', 'Tab b hit a problem.']);
  const two = { ...before, prompts: [prompt('r3', 'x'), prompt('r4', 'y')] };
  assert.deepEqual(L.announcements({ ...before, prompts: [] }, two), ['2 prompts need you.']);
});

test('the outbox keeps what was written while the PC was away, once per key, oldest first, and no more than it can hold', () => {
  let list = [];
  list = L.outboxPut(list, { key: 'k1', name: 'task', body: { text: 'a', key: 'k1' }, label: 'a', at: 1 }).list;
  list = L.outboxPut(list, { key: 'k2', name: 'reply', body: { text: 'b', key: 'k2' }, label: 'b', at: 2 }).list;
  list = L.outboxPut(list, { key: 'k1', name: 'task', body: { text: 'a again', key: 'k1' }, label: 'a', at: 3 }).list;
  assert.deepEqual(list.map(e => e.key), ['k2', 'k1']);
  assert.equal(list[1].body.text, 'a again');
  assert.deepEqual(L.outboxDrop(list, 'k2').map(e => e.key), ['k1']);
  // Only tasks and replies, never anything else the PC could be asked.
  assert.deepEqual(L.outboxOf([{ key: 'x', name: 'home', body: {} }, null, { key: 'y', name: 'reply', body: {} }]).map(e => e.key), ['y']);
  let full = [];
  for (let i = 0; i < L.OUTBOX_MAX; i++) full = L.outboxPut(full, { key: `k${i}`, name: 'reply', body: {}, label: '' }).list;
  assert.match(L.outboxPut(full, { key: 'more', name: 'reply', body: {} }).error, /waiting to send/);
  assert.notEqual(L.newKey(), L.newKey());
  assert.match(L.newKey(), /^[A-Za-z0-9_-]{8,64}$/, 'a key the PC accepts');
});

test('saved prompts: newest first, the same words once, and a chip from the first line', () => {
  let list = L.savePrompt([], 'Run the tests and fix what fails').list;
  list = L.savePrompt(list, 'Update the dependencies\nand run the tests').list;
  list = L.savePrompt(list, 'Run the tests and fix what fails').list;
  assert.deepEqual(list.map(p => p.text), ['Run the tests and fix what fails', 'Update the dependencies\nand run the tests']);
  assert.match(L.savePrompt(list, '   ').error, /Type the task/);
  assert.deepEqual(L.dropPrompt(list, 'Run the tests and fix what fails').length, 1);
  assert.equal(L.promptChip('Update the dependencies\nand run the tests'), 'Update the dependencies');
  assert.equal(L.promptChip('A very long saved prompt that keeps on going past the chip'), 'A very long saved prompt that k…');
  let full = [];
  for (let i = 0; i < L.SAVED_MAX; i++) full = L.savePrompt(full, `task ${i}`).list;
  assert.match(L.savePrompt(full, 'one more').error, /Remove one/);
});

test('a reply read aloud has no markdown marks, says code is code, and names a link', () => {
  const said = L.spokenText('## Done\n\nI **fixed** the `upload` test.\n\n```js\nconst x = 1;\n```\n\n- See [the docs](https://example.com/docs) or https://example.com');
  assert.equal(said, 'Done I fixed the upload test. (some code) See the docs or a link');
  assert.equal(L.spokenText(''), '');
});

test('a word on a line of a diff names the file and the line, added or removed', () => {
  const add = L.lineComment({ path: 'src/a.js', row: { kind: 'add', text: '  const x = 1;', a: null, b: 12 }, said: 'Rename x' });
  assert.equal(add, 'In src/a.js, line 12:\n\n    const x = 1;\n\nRename x');
  const del = L.lineComment({ path: 'src/a.js', row: { kind: 'del', text: 'old()', a: 7, b: null }, said: 'Why did this go?' });
  assert.match(del, /line 7 \(a line this turn removed\)/);
});
