const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filesOf, check } = require('../src/main/pages/checks');
const { NO_ACCESS } = require('../src/main/pages/format');

const INDEX = '<!doctype html><html><head><script src="shellby.js"></script><script src="app.js"></script></head><body></body></html>';
const run = (files, access = NO_ACCESS) => check(filesOf(files).files, access);

test('files must be a flat map of text with an index.html, and none of Shellby\'s names', () => {
  assert.equal(filesOf(null).ok, false);
  assert.equal(filesOf({}).ok, false);
  assert.equal(filesOf({ 'app.js': '' }).ok, false);
  assert.equal(filesOf({ 'index.html': 1 }).ok, false);
  assert.equal(filesOf({ 'index.html': '', 'shellby.js': '' }).ok, false);
  assert.equal(filesOf({ 'index.html': '', 'sub/x.js': '' }).ok, false);
  const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}.js`, '']));
  assert.equal(filesOf({ ...many, 'index.html': '' }).ok, false);
  assert.equal(filesOf({ 'INDEX.HTML': INDEX }).files['index.html'], INDEX);
});

test('a clean page passes', () => {
  const r = run({ 'index.html': INDEX, 'app.js': 'shellby.data.get().then(d => document.body.textContent = JSON.stringify(d));' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('index.html must load shellby.js', () => {
  const r = run({ 'index.html': '<script src="app.js"></script>', 'app.js': '' });
  assert.match(r.errors.join(), /shellby\.js/);
});

test('size over the limit fails', () => {
  assert.equal(run({ 'index.html': INDEX, 'big.js': 'x'.repeat(600 * 1024) }).ok, false);
});

test('remote scripts, styles, images and imports fail with a reason', () => {
  const cases = [
    `${INDEX}<script src="https://cdn.example.com/x.js"></script>`,
    `${INDEX}<link rel="stylesheet" href="//fonts.example.com/a.css">`,
    `${INDEX}<img src="http://x.example.com/a.png">`,
  ];
  for (const html of cases) assert.equal(run({ 'index.html': html }).ok, false, html);
  assert.equal(run({ 'index.html': INDEX, 'a.css': '@import url("https://x.example.com/a.css");' }).ok, false);
  assert.equal(run({ 'index.html': INDEX, 'a.css': 'body { background: url(https://x.example.com/a.png) }' }).ok, false);
  assert.equal(run({ 'index.html': INDEX, 'app.js': 'import x from "https://esm.example.com/x.js";' }).ok, false);
});

test('inline script, handlers, eval and direct network use fail', () => {
  assert.equal(run({ 'index.html': `${INDEX}<script>alert(1)</script>` }).ok, false);
  assert.equal(run({ 'index.html': `${INDEX}<button onclick="go()">x</button>` }).ok, false);
  assert.equal(run({ 'index.html': `${INDEX}<a href="javascript:void 0">x</a>` }).ok, false);
  for (const js of ['eval("1")', 'new Function("return 1")', 'setTimeout("go()", 10)', 'fetch("/x")', 'new WebSocket("wss://x")']) {
    assert.equal(run({ 'index.html': INDEX, 'app.js': js }).ok, false, js);
  }
});

test('comments do not trip the checks', () => {
  const r = run({ 'index.html': `${INDEX}<!-- <script>alert(1)</script> -->`, 'app.js': '// eval("x") would be bad\n/* fetch("/x") */\nconst u = "https://example.com";' });
  assert.deepEqual(r.errors, []);
});

test('access must match what the code calls', () => {
  const js = "shellby.read('usage'); shellby.ask('x'); shellby.notify('t'); shellby.fetch('https://api.example.com/v1');";
  const none = run({ 'index.html': INDEX, 'app.js': js });
  assert.equal(none.errors.length, 4);
  const all = run({ 'index.html': INDEX, 'app.js': js }, { read: ['usage'], ask: true, notify: true, web: ['api.example.com'] });
  assert.deepEqual(all.errors, []);
  const extra = run({ 'index.html': INDEX }, { ...NO_ACCESS, read: ['git'] });
  assert.equal(extra.ok, true);
  assert.match(extra.notes.join(), /git/);
  assert.equal(run({ 'index.html': INDEX, 'app.js': "shellby.fetch('http://api.example.com/')" }, { ...NO_ACCESS, web: ['api.example.com'] }).ok, false);
});

test('hostile files cost time in proportion to their size, never its square', () => {
  // Each of these once took from 2 s to over a minute at this size, freezing main
  // (a terminal's create_page, or a page arriving through the sync gist).
  const N = 400 * 1024;
  const fill = unit => unit.repeat(Math.floor(N / unit.length));
  const hostile = [
    ['index.html', '<!--'], ['index.html', '<script>'], ['index.html', '<style>'], ['index.html', '<a '],
    ['index.html', '<link href='], ['index.html', '<img src='], ['index.html', '<script src=x '],
    ['a.js', 'import '], ['a.js', 'import a,'], ['a.js', '/*'], ['a.css', '/*'],
  ];
  for (const [name, unit] of hostile) {
    const files = { 'index.html': INDEX, [name]: name === 'index.html' ? INDEX + fill(unit) : fill(unit) };
    const t = Date.now();
    check(files, NO_ACCESS);
    assert.ok(Date.now() - t < 3000, `${name} of ${JSON.stringify(unit)} took ${Date.now() - t} ms`);
  }
  const big = check({ 'index.html': INDEX + fill('<a ').repeat(3) }, NO_ACCESS);
  assert.deepEqual([big.ok, big.errors.length], [false, 1], 'too big stops before any pattern runs');
});

test('the tag scan still finds what the old patterns did', () => {
  assert.match(run({ 'index.html': '<!doctype html><script src="shellby.js"></script><script>alert(1)</script>' }).errors.join(), /inline <script>/);
  assert.match(run({ 'index.html': '<!doctype html><script src="shellby.js"></script><link rel="stylesheet" href="https://x.example/a.css">' }).errors.join(), /link href/);
  assert.match(run({ 'index.html': '<!doctype html><script src="shellby.js"></script><img alt="" src="//x.example/a.png">' }).errors.join(), /loads from the web/);
  assert.match(run({ 'index.html': '<!doctype html><script src="shellby.js"></script><div class="a" onclick="go()">' }).errors.join(), /onclick/);
  assert.match(run({ 'index.html': '<!doctype html><script src="shellby.js"></script><style>@import "https://x.example/a.css";</style>' }).errors.join(), /@import/);
  assert.equal(run({ 'index.html': '<!doctype html><script src="./shellby.js"></script><script>if (a < b) {}</script>' }).errors.some(e => /must load the bridge/.test(e)), false);
  assert.match(run({ 'index.html': '<!doctype html><!-- <script src="shellby.js"></script> -->' }).errors.join(), /must load the bridge/, 'a commented-out bridge is no bridge');
});
