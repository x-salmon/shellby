const { test } = require('node:test');
const assert = require('node:assert/strict');
const format = require('../src/main/pages/format');

test('an id is a host-safe slug of the name, and drafts keep a prefix of their own', () => {
  assert.equal(format.slug('Print queue!'), 'print-queue');
  assert.equal(format.slug('  Café  Menu '), 'cafe-menu');
  assert.equal(format.slug('???'), 'page');
  assert.equal(format.slug('draft-thing'), 'page-draft-thing');
  assert.equal(format.isId('print-queue'), true);
  assert.equal(format.isId('Print'), false);
  assert.equal(format.isId('-x'), false);
  assert.equal(format.isId('draft-abcdefgh'), false);
  assert.equal(format.isDraftId('draft-abcdefgh'), true);
  assert.equal(format.isDraftId('draft-ABC'), false);
});

test('file names are flat text files only', () => {
  for (const ok of ['index.html', 'app.js', 'style.css', 'logo.svg', 'seed.json']) assert.equal(format.isFileName(ok), true, ok);
  for (const bad of ['../x.js', 'a/b.js', 'x.exe', '.hidden.js', 'pic.png', '']) assert.equal(format.isFileName(bad), false, bad);
});

test('hosts are https hosts without ports or paths', () => {
  assert.equal(format.hostOf('https://API.example.com/v1'), 'api.example.com');
  assert.equal(format.hostOf('api.github.com'), 'api.github.com');
  assert.equal(format.hostOf('localhost'), null);
  assert.equal(format.hostOf('127.0.0.1'), null);
  assert.equal(format.hostOf('example.com:8080'), null);
});

test('access rejects what a page cannot have, with a reason', () => {
  assert.equal(format.accessOf({ read: ['secrets'] }).ok, false);
  assert.equal(format.accessOf({ web: ['http://x'] }).ok, false);
  const a = format.accessOf({ read: ['git', 'usage', 'usage'], ask: true, web: ['api.example.com', 'API.example.com'] });
  assert.deepEqual(a.access, { read: ['usage', 'git'], ask: true, notify: false, web: ['api.example.com'] });
  assert.deepEqual(format.accessOf(undefined).access, format.NO_ACCESS);
});

test('growth lists only what is new, and words describe each entry', () => {
  const prev = { read: ['usage'], ask: false, notify: true, web: ['a.com'] };
  const next = { read: ['usage', 'git'], ask: true, notify: true, web: ['a.com', 'b.com'] };
  assert.deepEqual(format.accessGrowth(prev, next).map(g => g.kind), ['read', 'ask', 'web']);
  assert.deepEqual(format.accessGrowth(null, format.NO_ACCESS), []);
  assert.equal(format.accessWords(next).length, 6);
});

test('a manifest needs a name and cleans everything else', () => {
  assert.equal(format.manifestOf({}).ok, false);
  const m = format.manifestOf({ name: ' Print\nqueue ', description: 'x'.repeat(500), agents: 'robots', icon: '🖨️🖨️🖨️', id: 'evil' }, { id: 'print-queue' });
  assert.equal(m.manifest.name, 'Print queue');
  assert.equal(m.manifest.description.length, 200);
  assert.equal(m.manifest.agents, 'any');
  assert.equal(m.manifest.id, 'print-queue');
  assert.ok([...m.manifest.icon].length <= 2);
});
