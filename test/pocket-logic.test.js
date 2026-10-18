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
  assert.deepEqual(L.route('#/tab/../../x'), { name: 'beach' });
  assert.deepEqual(L.route('#/tab/%E0%A4%A'), { name: 'beach' });
  assert.deepEqual(L.route(''), { name: 'beach' });
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
