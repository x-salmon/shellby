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

// ---------------------------------------------------------- between PCs (sync/pages.js)
const LAPTOP = { pc: 'laptop-1', name: 'LAPTOP' };

test('a page from another PC lands switched off and not agreed, with the gist id, and Turn it on agrees to the version shown', () => {
  const s = fresh();
  const r = s.arrive('gym-log', man({ name: 'Gym log', access: { notify: true } }), { 'index.html': INDEX }, { at: 500, from: LAPTOP, why: 'First version', who: AGENT });
  assert.deepEqual([r.ok, r.kind, r.version], [true, 'new', 1]);
  const st = s.state('gym-log');
  assert.equal(st.enabled, false);
  assert.equal(st.agreed, null);
  assert.equal(st.from, 'pc');
  assert.deepEqual(st.arrived, { kind: 'new', from: LAPTOP, at: st.arrived.at, quiet: false });
  assert.deepEqual([st.sync.at, st.sync.sharedAt, st.sync.from], [500, 500, LAPTOP], "the other PC's stamp, not this PC's clock");
  assert.equal(st.versions[0].pc, 'LAPTOP');
  assert.deepEqual(s.access('gym-log'), format.NO_ACCESS, 'nothing until you agree here');
  assert.equal(s.turnOn('gym-log', 2).ok, false, 'not the version you were shown');
  assert.equal(s.turnOn('gym-log', 1).ok, true);
  const on = s.state('gym-log');
  assert.deepEqual([on.enabled, on.agreed.notify, on.arrived], [true, true, null]);
  assert.equal(s.arrive('../x', man(), { 'index.html': INDEX }, { at: 1, from: LAPTOP }).ok, false);
  for (const bad of ['constructor', 'con', 'nul', 'com1']) assert.equal(s.arrive(bad, man(), { 'index.html': INDEX }, { at: 1, from: LAPTOP }).ok, false, bad);
});

test('a changed page waits while the version agreed here runs; one never agreed just takes it; Not on this PC goes quiet', () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': 'v1' });
  s.agree(id, 1);
  s.markShared(id, s.state(id).sync.at); // the gist has this PC's version 1
  const before = s.state(id);
  const r = s.arrive(id, man({ description: 'Changed there' }), { 'index.html': 'v2' }, { at: before.sync.at + 100, from: LAPTOP, why: 'A total', who: AGENT });
  assert.deepEqual([r.kind, r.version], ['changed', 2]);
  const st = s.state(id);
  assert.equal(st.version, 1, 'yours still runs');
  assert.equal(st.enabled, true, 'and was not switched off');
  assert.deepEqual(st.sync.pending, { n: 2, at: before.sync.at + 100, from: LAPTOP, why: 'A total', who: AGENT });
  assert.equal(st.arrived.kind, 'changed');
  assert.equal(s.files(id)['index.html'], 'v1');
  assert.equal(s.files(id, 2)['index.html'], 'v2');
  assert.equal(st.sync.lost, null, 'this PC had shared its version: no clash');
  assert.equal(s.decline(id).ok, true);
  assert.equal(s.state(id).arrived.quiet, true);
  assert.equal(s.state(id).sync.pending.n, 2, 'still in History, still waiting');
  assert.equal(s.turnOn(id, 2).ok, true);
  assert.deepEqual([s.state(id).version, s.state(id).sync.pending, s.state(id).arrived], [2, null, null]);
  assert.equal(s.files(id)['index.html'], 'v2');
  // Never agreed here (arrived earlier, never looked at): the new version just becomes the one on offer.
  s.arrive('other', man({ name: 'Other' }), { 'index.html': 'a' }, { at: 10, from: LAPTOP });
  const again = s.arrive('other', man({ name: 'Other' }), { 'index.html': 'b' }, { at: 20, from: LAPTOP });
  assert.deepEqual([again.kind, s.state('other').version, s.state('other').sync.pending, s.state('other').enabled], ['new', 2, null, false]);
});

test("a version of this PC's the gist never saw loses to a later one and is kept, named in History", () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': 'mine' });
  s.agree(id, 1);
  s.markShared(id, s.state(id).sync.at);
  s.update(id, man(), { 'index.html': 'mine-2' }, { who: YOU, why: 'colours' }); // not synced yet
  const local = s.state(id);
  assert.ok(local.sync.at > local.sync.sharedAt);
  s.arrive(id, man(), { 'index.html': 'theirs' }, { at: local.sync.at + 5, from: LAPTOP, why: 'total', who: AGENT });
  const st = s.state(id);
  assert.deepEqual(st.sync.lost, { n: 2, at: local.sync.at, from: LAPTOP });
  assert.equal(st.version, 2, 'still running while the other waits');
  assert.equal(s.files(id, 2)['index.html'], 'mine-2', 'kept');
  s.update(id, man(), { 'index.html': 'mine-3' }, { who: YOU, why: 'again' });
  assert.deepEqual([s.state(id).sync.lost, s.state(id).sync.pending, s.state(id).sync.from], [null, null, null], "a change here is this PC's newest");
});

test('data from another PC keeps its stamps and signatures, fires as a write, and a removal is remembered', () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': INDEX });
  s.write(id, { set: { title: 'x' }, append: { rows: [1] } }, YOU);
  const mine = s.read(id).by;
  assert.equal(mine.rows.op, 'append');
  assert.equal(mine.title.op, 'set');
  const r = s.arriveData(id, { set: { rows: { v: [1, 2], by: { who: AGENT, at: 77, op: 'append', pc: 'LAPTOP' } }, note: { v: 'hi', by: { who: YOU, at: 78 } } }, remove: ['title'], gone: { title: 90 } }, { name: 'LAPTOP' });
  assert.deepEqual(r.changed, ['rows', 'note', 'title']);
  assert.match(r.text, /added 1 to rows; changed note; removed title/);
  assert.deepEqual(r.who, { kind: 'pc', name: 'LAPTOP' });
  const d = s.read(id);
  assert.deepEqual(d.values, { rows: [1, 2], note: 'hi' });
  assert.deepEqual(d.by.rows, { who: AGENT, at: 77, op: 'append', pc: 'LAPTOP' }, 'not re-stamped here');
  assert.equal(d.gone.title, 90);
  assert.equal(s.activity(id).at(-1).who.kind, 'pc');
  s.write(id, { remove: ['note'] }, YOU);
  assert.ok(s.read(id).gone.note > 0, 'a removal here leaves a marker too');
  s.write(id, { set: { note: 1 } }, YOU);
  assert.equal('note' in s.read(id).gone, false);
  assert.equal(s.arriveData(id, JSON.parse('{"set":{"__proto__":{"v":1,"by":{"at":1}}}}'), { name: 'LAPTOP' }).changed.length, 0, 'no prototype keys');
});

test('deleting a page leaves a marker for the sync; Where it goes is kept per page; opening is remembered', () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': INDEX });
  assert.deepEqual(s.state(id).sync, { where: 'everywhere', data: 'with', at: s.state(id).sync.at, sharedAt: 0, from: null, pending: null, lost: null });
  assert.equal(s.setWhere(id, { where: 'here', data: 'nope' }).ok, true);
  assert.deepEqual([s.state(id).sync.where, s.state(id).sync.data], ['here', 'with']);
  assert.equal(s.state(id).openedAt, 0);
  s.touchOpened(id);
  assert.ok(s.state(id).openedAt > 0);
  const draft = s.create(man(), { 'index.html': INDEX }, { draft: true, tab: 't' });
  s.remove(draft.id);
  assert.deepEqual(s.syncState().gone, {}, 'a draft leaves no marker');
  s.remove(id);
  assert.ok(s.syncState().gone[id] > 0);
  // The marker goes once it arrives again (a later change elsewhere).
  s.arrive(id, man(), { 'index.html': INDEX }, { at: Date.now() + 1e6, from: LAPTOP });
  assert.deepEqual(s.syncState().gone, {});
});

test('History never runs code from another PC you have not looked at, and keeps the running version through many arrivals', () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': 'v1' });
  s.agree(id, 1);
  s.markShared(id, s.state(id).sync.at);
  let at = s.state(id).sync.at;
  for (let i = 0; i < 25; i++) s.arrive(id, man(), { 'index.html': `there-${i}` }, { at: ++at, from: LAPTOP, why: `v${i}`, who: AGENT });
  const st = s.state(id);
  assert.equal(st.version, 1, 'yours still runs');
  assert.equal(s.files(id)['index.html'], 'v1', 'and its files were never pruned');
  assert.ok(s.files(id, st.sync.pending.n), 'the one waiting is kept too');
  assert.match(s.revert(id, st.sync.pending.n, YOU).error, /haven't looked at it here/);
  assert.equal(s.turnOn(id, st.sync.pending.n).ok, true);
  assert.equal(s.state(id).versions.find(v => v.n === st.sync.pending.n).unseen, undefined, 'looked at now');
});

test('a page deleted on another PC goes to .trash, out of the shelf', () => {
  const s = fresh();
  const { id } = s.create(man(), { 'index.html': INDEX });
  assert.equal(s.trash(id).ok, true);
  assert.equal(s.known(id), false);
  assert.ok(!s.list().some(p => p.id === id));
  assert.equal(fs.readdirSync(path.join(s.root, '.trash')).filter(n => n.startsWith(`${id}-`)).length, 1);
});
