const { test } = require('node:test');
const assert = require('node:assert/strict');
const { answer, withGuard, CSP, CSP_INERT } = require('../src/main/pages/protocol');
const { isPrivate } = require('../src/main/pages/fetch');

const SIDE = { 'shellby.js': 'BRIDGE', 'guard.js': 'GUARD' };
const FILES = { 'print-queue': { 'index.html': '<!doctype html><p>hi</p>', 'app.js': 'x()' } };
const pages = (servable = true) => ({
  known: id => id in FILES,
  servable: () => servable,
  readFile: (id, name) => (FILES[id]?.[name] !== undefined ? Buffer.from(FILES[id][name]) : null),
});

test('a page is served with the guard first and its own files', () => {
  const a = answer('shellby-page://print-queue/', pages(), SIDE);
  assert.equal(a.status, 200);
  assert.equal(a.type, 'text/html');
  assert.equal(a.body, '<!doctype html><script src="guard.js"></script><p>hi</p>');
  assert.equal(answer('shellby-page://print-queue/app.js', pages(), SIDE).body.toString(), 'x()');
  assert.equal(answer('shellby-page://print-queue/shellby.js', pages(), SIDE).body, 'BRIDGE');
  assert.equal(answer('shellby-page://print-queue/guard.js', pages(), SIDE).body, 'GUARD');
});

test('nothing outside a known page is served', () => {
  assert.equal(answer('shellby-page://other/index.html', pages(), SIDE).status, 404);
  assert.equal(answer('shellby-page://print-queue/../state.json', pages(), SIDE).status, 404);
  assert.equal(answer('shellby-page://print-queue/%2e%2e%2fstate.json', pages(), SIDE).status, 404);
  assert.equal(answer('shellby-page://print-queue/missing.js', pages(), SIDE).status, 404);
  assert.equal(answer('shellby-page://print-queue/v/1/index.html', pages(), SIDE).status, 404);
  assert.equal(answer('not a url', pages(), SIDE).status, 400);
});

test('a page that is off or waiting for your OK is not served at all', () => {
  assert.equal(answer('shellby-page://print-queue/', pages(false), SIDE).status, 403);
});

test('the CSP keeps a page to its own files and sandboxed', () => {
  for (const part of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "frame-src 'none'", 'sandbox allow-scripts']) assert.ok(CSP.includes(part), part);
  assert.ok(!CSP.includes('unsafe-eval'));
  assert.equal(withGuard('<p>'), '<script src="guard.js"></script><p>');
  assert.ok(CSP_INERT.endsWith('sandbox') && !CSP_INERT.includes('script-src'), 'an SVG opened by itself runs nothing');
});

test('fetch refuses this PC and the local network', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.1.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '100.64.0.1']) assert.equal(isPrivate(a), true, a);
  for (const a of ['93.184.216.34', '2606:2800:220:1::1', '172.32.0.1']) assert.equal(isPrivate(a), false, a);
});
