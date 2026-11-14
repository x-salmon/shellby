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
