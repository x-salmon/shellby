const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeUrl, makeOpenSafe } = require('../src/main/safe-open');
const { makeRevive, MAX_REVIVES, WINDOW_MS } = require('../src/main/window-revive');

test('isSafeUrl takes https and http on this PC only', () => {
  assert.equal(isSafeUrl('https://example.com/a'), true);
  assert.equal(isSafeUrl('http://localhost:3000/'), true);
  assert.equal(isSafeUrl('http://127.0.0.1:3000/'), true);
  assert.equal(isSafeUrl('http://example.com/'), false);
});

test('isSafeUrl refuses schemes that can run things, and hidden credentials', () => {
  for (const url of ['file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id', 'javascript:alert(1)', 'vscode://file/a', 'https://a@evil.example/', 'nonsense', '', null, 7]) {
    assert.equal(isSafeUrl(url), false, String(url));
  }
});

test('isSafeUrl takes a scheme only when the caller names it', () => {
  assert.equal(isSafeUrl('vscode://file/C:/a.js:3', ['vscode:']), true);
});

test('openSafe opens an allowed link and refuses the rest with a warning', () => {
  const opened = [];
  const warned = [];
  const open = makeOpenSafe(async url => { opened.push(url); }, what => warned.push(what));
  assert.equal(open('https://example.com/'), true);
  assert.equal(open('file:///C:/a.exe'), false);
  assert.deepEqual(opened, ['https://example.com/']);
  assert.equal(warned.length, 1);
});

test('openSafe logs a handler failing instead of throwing it', async () => {
  const warned = [];
  const open = makeOpenSafe(() => Promise.reject(new Error('no handler')), (what, detail) => warned.push(detail));
  assert.equal(open('https://example.com/'), true);
  await new Promise(setImmediate);
  assert.deepEqual(warned, ['no handler']);
});

function contents() {
  return { reloads: 0, isDestroyed: () => false, reload() { this.reloads++; } };
}

test('revive reloads a crashed window', () => {
  const wc = contents();
  const revive = makeRevive({ onGaveUp() {}, log: { warn() {} }, now: () => 0 });
  assert.equal(revive(wc, { reason: 'crashed' }), true);
  assert.equal(wc.reloads, 1);
});

test('revive leaves a clean exit and a destroyed window alone', () => {
  const wc = contents();
  const revive = makeRevive({ onGaveUp() {}, log: { warn() {} }, now: () => 0 });
  assert.equal(revive(wc, { reason: 'clean-exit' }), false);
  assert.equal(revive({ ...wc, isDestroyed: () => true }, { reason: 'crashed' }), false);
  assert.equal(wc.reloads, 0);
});

test('revive stops a crash loop, tells once, and recovers after the window passes', () => {
  let at = 0;
  let toldCount = 0;
  const wc = contents();
  const revive = makeRevive({ onGaveUp() { toldCount++; }, log: { warn() {} }, now: () => at });
  for (let i = 0; i < MAX_REVIVES + 3; i++) revive(wc, { reason: 'crashed' });
  assert.equal(wc.reloads, MAX_REVIVES);
  assert.equal(toldCount, 1);
  at = WINDOW_MS + 1;
  assert.equal(revive(wc, { reason: 'crashed' }), true);
});
