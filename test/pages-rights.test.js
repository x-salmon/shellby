const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decide, METHODS, fetchUrl } = require('../src/main/pages/rights');
const { NO_ACCESS } = require('../src/main/pages/format');

const ALL = { read: ['usage', 'git'], ask: true, notify: true, web: ['api.example.com'] };
const page = (access = NO_ACCESS) => ({ access, draft: false, enabled: true });

test('every method a page can call is known, and nothing else is', () => {
  assert.equal(decide('require', [], page(ALL)).ok, false);
  assert.equal(decide('__proto__', [], page(ALL)).ok, false);
  assert.equal(METHODS.length, 9);
});

test('a page always has its own data and the crab, nothing more, without access', () => {
  const p = page();
  assert.equal(decide('data.get', [], p).ok, true);
  assert.equal(decide('data.set', [{ a: 1 }], p).ok, true);
  assert.equal(decide('data.append', ['rows', { a: 1 }], p).ok, true);
  assert.equal(decide('data.remove', ['rows'], p).ok, true);
  assert.equal(decide('say', ['hi'], p).ok, true);
  for (const [m, args] of [['read', ['usage']], ['ask', ['x']], ['notify', ['t']], ['fetch', ['https://api.example.com/']]]) {
    const r = decide(m, args, p);
    assert.equal(r.ok, false, m);
    assert.ok(r.refused, `${m} is a refusal the header can show`);
  }
});

test('access lets exactly what it names', () => {
  const p = page(ALL);
  assert.equal(decide('read', ['usage'], p).ok, true);
  assert.equal(decide('read', ['health'], p).ok, false);
  assert.equal(decide('fetch', ['https://api.example.com/v1?x=1'], p).ok, true);
  const other = decide('fetch', ['https://evil.example.com/'], p);
  assert.equal(other.ok, false);
  assert.deepEqual(other.refused, { kind: 'web', what: 'evil.example.com' });
  assert.match(other.error, /evil\.example\.com/);
});

test('fetch is https on 443, GET or POST, without credentials', () => {
  const p = page(ALL);
  for (const bad of ['http://api.example.com/', 'https://u:p@api.example.com/', 'https://api.example.com:8443/', 'file:///c:/x', 'https://127.0.0.1/']) {
    assert.equal(decide('fetch', [bad], p).ok, false, bad);
  }
  assert.equal(decide('fetch', ['https://api.example.com/', { method: 'DELETE' }], p).ok, false);
  const post = decide('fetch', ['https://api.example.com/', { method: 'post', body: 'x', headers: { cookie: 'a', 'Content-Type': 'text/plain' } }], p);
  assert.deepEqual(post.args[1], { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } });
  assert.equal(fetchUrl('https://API.example.com/a').host, 'api.example.com');
});

test('a draft gets its own data but nothing else, and says why', () => {
  const d = { access: ALL, draft: true, enabled: true };
  assert.equal(decide('data.set', [{ a: 1 }], d).ok, true);
  for (const [m, args] of [['read', ['usage']], ['ask', ['x']], ['notify', ['t']], ['fetch', ['https://api.example.com/']], ['say', ['x']]]) {
    const r = decide(m, args, d);
    assert.equal(r.ok, false, m);
    assert.match(r.error, /draft/i);
  }
});

test('a page that is off can do nothing', () => {
  assert.equal(decide('data.get', [], { access: ALL, draft: false, enabled: false }).ok, false);
});

test('ask never runs in a mode beyond edits, and arguments are bounded', () => {
  const r = decide('ask', ['x'.repeat(5000), { mode: 'autonomous' }], page(ALL));
  assert.equal(r.args[1].mode, 'ask');
  assert.equal(r.args[0].length, 2000);
  assert.equal(decide('ask', ['   '], page(ALL)).ok, false);
  assert.equal(decide('data.set', [[1]], page()).ok, false);
  assert.equal(decide('data.get', [{}], page()).ok, false);
});
