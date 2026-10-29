// The panel's page is built from src/renderer/panel/html/ (scripts/panel-html.js).
// The built panel.html is committed, so it has to match what its pieces say.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { build, OUT } = require('../scripts/panel-html');

test('panel.html is what html/ builds: after editing a piece, run npm run panel:html', () => {
  const { html } = build();
  assert.ok(fs.readFileSync(OUT, 'utf8') === html, 'panel.html is out of date: run npm run panel:html');
});

test('every piece in html/ is used, once', () => {
  const { used, unused } = build();
  assert.deepEqual(unused, []);
  assert.equal(new Set(used).size, used.length);
});

test('a shared piece (the Shellby tabs) is one row, the same on every page of his screen', () => {
  const { html } = build();
  assert.doesNotMatch(html, /@shared/);
  const rows = html.match(/<nav class="seg shellby-tabs"[\s\S]*?<\/nav>/g);
  assert.ok(rows.length >= 6, 'each page of his screen has the row');
  assert.equal(new Set(rows).size, 1, 'and it is the same row everywhere');
  assert.doesNotMatch(rows[0], /aria-current|\sid="/, 'with no page marked and no ids to repeat');
});

test('a screen per piece: each <main> view lives in a file of its own', () => {
  const frame = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'renderer', 'panel', 'html', 'frame.html'), 'utf8');
  assert.doesNotMatch(frame, /<main class="view/);
  assert.ok(build().html.match(/<main class="view/g).length >= 20);
});
