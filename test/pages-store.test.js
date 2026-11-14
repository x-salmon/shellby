const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/main/pages/store');
const format = require('../src/main/pages/format');
const { LIMITS } = require('../src/main/pages/limits');

const INDEX = '<script src="shellby.js"></script>';
const YOU = { kind: 'you', name: '' };
const AGENT = { kind: 'agent', name: 'Fix flaky test' };

function fresh() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shellby-pages-')));
  let t = 1_700_000_000_000;
  return createStore(root, { now: () => (t += 1000) });
}
const man = (extra = {}) => format.manifestOf({ name: 'Print queue', ...extra }).manifest;

test('a page is made with an id from its name, and a second gets its own', () => {
  const s = fresh();
  const a = s.create(man(), { 'index.html': INDEX });
  const b = s.create(man(), { 'index.html': INDEX });
  assert.equal(a.id, 'print-queue');
  assert.equal(b.id, 'print-queue-2');
  assert.equal(s.manifest('print-queue').id, 'print-queue');
  assert.deepEqual(s.files('print-queue'), { 'index.html': INDEX });
  assert.equal(s.list().length, 2);
});

test('updates are versions; the newest 20 are kept and going back makes a new one', () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': 'v1' });
  for (let i = 2; i <= 25; i++) s.update(id, man(), { 'index.html': `v${i}` }, { who: AGENT, why: `change ${i}` });
  const st = s.state(id);
  assert.equal(st.version, 25);
  assert.equal(st.versions.length, LIMITS.VERSIONS);
  assert.equal(st.versions[0].n, 6);
  assert.equal(fs.readdirSync(path.join(s.root, id, 'v')).length, LIMITS.VERSIONS);
  assert.equal(s.revert(id, 3, YOU).ok, false);
  const back = s.revert(id, 10, YOU);
  assert.equal(back.version, 26);
  assert.equal(s.files(id)['index.html'], 'v10');
  assert.match(s.state(id).versions.at(-1).why, /version 10/);
});

test('a page runs with nothing until you agree, and only what you agreed while a newer version asks for more', () => {
  const s = fresh();
  const { id } = s.create(man({ access: { read: ['usage'] } }), { 'index.html': INDEX });
  assert.deepEqual(s.access(id), format.NO_ACCESS);
  assert.equal(s.agree(id, 2).ok, false, 'not the version you were shown');
  s.agree(id, 1);
  assert.deepEqual(s.access(id).read, ['usage']);
  const up = s.update(id, man({ access: { read: ['usage', 'git'], web: ['api.example.com'] } }), { 'index.html': INDEX }, { who: AGENT, why: 'more' });
  assert.deepEqual(up.growth.map(g => g.kind), ['read', 'web']);
  assert.deepEqual(s.access(id).read, ['usage']);
  assert.equal(s.pendingAccess(id).length, 2);
  assert.equal(s.list()[0].needsOk, true);
  s.addHost(id, 'other.example.com');
  assert.deepEqual(s.access(id).web, ['other.example.com']);
  s.setMeta(id, { enabled: false });
  assert.deepEqual(s.access(id), format.NO_ACCESS);
});

test('data writes are checked as a whole, signed and logged', () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': INDEX });
  const w = s.write(id, { set: { title: 'x' }, append: { rows: [{ a: 1 }, { a: 2 }] } }, AGENT);
  assert.equal(w.ok, true);
  assert.deepEqual(s.read(id).values, { title: 'x', rows: [{ a: 1 }, { a: 2 }] });
  assert.equal(s.read(id).by.rows.who.name, 'Fix flaky test');
  s.write(id, { append: { rows: { a: 3 } } }, YOU);
  assert.equal(s.read(id).values.rows.length, 3);
  assert.equal(s.write(id, { append: { title: 1 } }, YOU).ok, false, 'not a list');
  assert.equal(s.write(id, { set: { big: 'x'.repeat(300 * 1024) } }, YOU).ok, false);
  assert.equal(s.write(id, { set: { '': 1 } }, YOU).ok, false);
  assert.equal(s.write(id, JSON.parse('{"set":{"__proto__":{"x":1}}}'), YOU).ok, false, 'no prototype keys');
  assert.equal(s.write(id, {}, YOU).ok, false);
  assert.deepEqual(s.read(id, ['title']).values, { title: 'x' }, 'a refused write changed nothing');
  s.write(id, { remove: ['title'] }, YOU);
  assert.equal('title' in s.read(id).by, false);
  assert.equal(s.activity(id).length, 3);
  assert.match(s.activity(id)[0].text, /added 2 to rows/);
});

test('data has a key limit and a size limit', () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': INDEX });
  const many = Object.fromEntries(Array.from({ length: LIMITS.DATA_KEYS + 1 }, (_, i) => [`k${i}`, i]));
  assert.equal(s.write(id, { set: many }, YOU).ok, false);
  const chunk = 'x'.repeat(200 * 1024);
  for (let i = 0; i < 5; i++) assert.equal(s.write(id, { set: { [`c${i}`]: chunk } }, YOU).ok, true);
  assert.equal(s.write(id, { set: { c5: chunk } }, YOU).ok, false);
});

test('a draft lives apart, keeps its sample data until saved, then lands empty on the shelf', () => {
  const s = fresh();
  const d = s.create(man({ name: 'Agents checklist' }), { 'index.html': INDEX }, { draft: true, tab: 'tab-1' });
  assert.ok(format.isDraftId(d.id));
  assert.equal(s.list().length, 0);
  assert.equal(s.draftsOf('tab-1').length, 1);
  s.write(d.id, { set: { sample: 1 } }, { kind: 'page' });
  const saved = s.saveDraft(d.id);
  assert.equal(saved.id, 'agents-checklist');
  assert.equal(s.known(d.id), false);
  assert.deepEqual(s.read(saved.id).values, {});
  assert.equal(s.manifest(saved.id).id, 'agents-checklist');
  assert.equal(s.list().length, 1);
});

test('a broken folder reads back as nothing rather than throwing', () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': INDEX });
  fs.writeFileSync(path.join(s.root, id, 'v', '1', 'page.json'), '{not json');
  fs.writeFileSync(path.join(s.root, id, 'data.json'), '[1,2]');
  assert.equal(s.manifest(id), null);
  assert.deepEqual(s.read(id).values, {});
  assert.deepEqual(s.list(), []);
  assert.equal(s.readFile(id, '../state.json'), null);
  assert.equal(s.readFile('..', 'x.js'), null);
});

test('the shelf puts pinned pages first', () => {
  const s = fresh();
  const a = s.create(man({ name: 'A' }), { 'index.html': INDEX }).id;
  s.create(man({ name: 'B' }), { 'index.html': INDEX });
  s.setMeta(a, { pinned: true });
  assert.equal(s.list()[0].id, a);
});
