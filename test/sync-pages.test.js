const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../src/main/sync/pages');
const { stateOf } = require('../src/main/pages/store');
const format = require('../src/main/pages/format');
const { LIMITS } = require('../src/main/pages/limits');

const INDEX = '<!doctype html><script src="shellby.js"></script><script src="app.js"></script>';
const FILES = { 'index.html': INDEX, 'app.js': 'shellby.data.get()' };
const DESK = { pc: 'desk-1', name: 'DESK' };
const LAPTOP = { pc: 'laptop-1', name: 'LAPTOP' };
const man = (extra = {}) => format.manifestOf({ name: 'Gym log', description: 'Sets by day', ...extra }).manifest;

/** A page on one PC, as wiring/pages.js describes it to the sync. */
function page(id, { at = 10, sharedAt = 0, where, dataWhere, values = {}, by = {}, gone = {}, agreed = null, pending = null, openedAt = 0, manifest = man(), files = FILES, wants = null, from = null } = {}) {
  const state = stateOf({
    version: 1, enabled: true, agreed, openedAt, updatedAt: at, wants,
    versions: [{ n: 1, at, who: { kind: 'agent', name: 'Claude' }, why: 'First version' }],
    sync: { at, sharedAt, where, data: dataWhere, pending, from },
  });
  return { id, state, manifest, files, data: { values, by, gone }, thumb: null, version: { why: 'First version', who: { kind: 'agent', name: 'Claude' } } };
}
const local = (me, pages, gone = {}) => ({ me, gone, pages });
const stamped = (at, op = 'set', who = { kind: 'you', name: '' }) => ({ who, at, op });

test('a page from another PC arrives new, with its data; what came from here needs nothing', () => {
  const laptop = sync.snapshot(local(LAPTOP, [page('gym-log', { at: 20, values: { sets: [1, 2] }, by: { sets: stamped(5) } })]));
  const desk = local(DESK, []);
  const merged = sync.merge(sync.snapshot(desk), laptop);
  const actions = sync.apply(desk, merged);
  assert.deepEqual(actions.map(a => a.kind), ['new']);
  assert.equal(actions[0].item.manifest.name, 'Gym log');
  assert.deepEqual(actions[0].item.from, LAPTOP);
  assert.deepEqual(actions[0].data.set.sets.v, [1, 2]);
  assert.equal(actions[0].data.set.sets.by.at, 5);
  // The laptop, syncing again against what it wrote, has nothing to do.
  assert.deepEqual(sync.apply(local(LAPTOP, [page('gym-log', { at: 20, sharedAt: 20, values: { sets: [1, 2] }, by: { sets: stamped(5) } })]), merged), []);
  assert.match(sync.describeArrived(actions), /1 page came from LAPTOP, switched off until you look/);
});

test('the later save wins per page; the PC whose version lost sees it as changed and the gist agrees afterwards', () => {
  const mine = page('gym-log', { at: 15, sharedAt: 10, agreed: man().access });
  const theirs = sync.snapshot(local(LAPTOP, [page('gym-log', { at: 20, manifest: man({ description: 'With a weekly total' }) })]));
  const merged = sync.merge(sync.snapshot(local(DESK, [mine])), theirs);
  assert.equal(merged.pages['gym-log'].manifest.description, 'With a weekly total');
  assert.deepEqual(sync.apply(local(DESK, [mine]), merged).map(a => a.kind), ['changed']);
  // The other way round: the desk's is later, and the laptop's copy is what changes.
  const newer = page('gym-log', { at: 30, manifest: man({ description: 'Desk wins' }) });
  const m2 = sync.merge(sync.snapshot(local(DESK, [newer])), theirs);
  assert.equal(m2.pages['gym-log'].manifest.description, 'Desk wins');
  assert.deepEqual(m2.pages['gym-log'].from, DESK);
  assert.deepEqual(sync.apply(local(DESK, [newer]), m2), [{ kind: 'shared', id: 'gym-log', at: 30 }]);
  assert.deepEqual(sync.merge(theirs, sync.snapshot(local(DESK, [newer]))).pages['gym-log'].manifest, m2.pages['gym-log'].manifest, 'order does not matter');
});

test('data merges key by key: the later write per key, a removed key stays removed', () => {
  const desk = local(DESK, [page('gym-log', { at: 10, sharedAt: 10, values: { title: 'Desk', weight: 80 }, by: { title: stamped(5), weight: stamped(9) }, gone: { note: 12 } })]);
  const laptop = local(LAPTOP, [page('gym-log', { at: 10, sharedAt: 10, values: { title: 'Laptop', weight: 70, note: 'hi' }, by: { title: stamped(7), weight: stamped(3), note: stamped(11) } })]);
  const merged = sync.merge(sync.snapshot(desk), sync.snapshot(laptop));
  const keys = merged.pages['gym-log'].data.keys;
  assert.equal(keys.title.v, 'Laptop', 'written later there');
  assert.equal(keys.weight.v, 80, 'written later here');
  assert.equal('note' in keys, false, 'removed here after it was written there');
  assert.equal(merged.pages['gym-log'].data.gone.note, 12);
  const atDesk = sync.apply(desk, merged);
  assert.deepEqual(atDesk.map(a => a.kind), ['data']);
  assert.deepEqual(Object.keys(atDesk[0].set), ['title']);
  assert.equal(atDesk[0].set.title.by.at, 7);
  const atLaptop = sync.apply(laptop, merged);
  assert.deepEqual(Object.keys(atLaptop[0].set), ['weight']);
  assert.deepEqual(atLaptop[0].remove, ['note']);
});

test('a list both PCs appended to keeps both PCs\' items, and settles the same way on both', () => {
  const desk = local(DESK, [page('gym-log', { at: 10, sharedAt: 10, values: { sets: ['a', 'b', 'd'] }, by: { sets: stamped(20, 'append') } })]);
  const laptop = local(LAPTOP, [page('gym-log', { at: 10, sharedAt: 10, values: { sets: ['a', 'b', 'c'] }, by: { sets: stamped(25, 'append') } })]);
  const merged = sync.merge(sync.snapshot(desk), sync.snapshot(laptop));
  const sets = merged.pages['gym-log'].data.keys.sets;
  assert.deepEqual(sets.v, ['a', 'b', 'd', 'c'], 'the older list, then what the newer added');
  assert.equal(sets.at, 25);
  assert.deepEqual(sync.merge(sync.snapshot(laptop), sync.snapshot(desk)).pages['gym-log'].data.keys.sets.v, sets.v, 'order does not matter');
  // A set replaces: clearing the list later than the append wins whole.
  const cleared = local(DESK, [page('gym-log', { at: 10, sharedAt: 10, values: { sets: [] }, by: { sets: stamped(30, 'set') } })]);
  assert.deepEqual(sync.merge(sync.snapshot(cleared), sync.snapshot(laptop)).pages['gym-log'].data.keys.sets.v, []);
  // Duplicates are items too.
  assert.deepEqual(sync.unionList(['x', 'x'], ['x', 'x', 'x']), ['x', 'x', 'x']);
  assert.equal(sync.unionList(Array(LIMITS.LIST_ITEMS).fill(1), [2]).length, LIMITS.LIST_ITEMS);
});

test('a page that is This PC only never leaves, and its copy here is left alone', () => {
  const desk = local(DESK, [page('drives', { at: 10, where: 'here' }), page('gym-log', { at: 10 })]);
  const snap = sync.snapshot(desk);
  assert.deepEqual(Object.keys(snap.pages), ['gym-log']);
  const remote = sync.snapshot(local(LAPTOP, [page('drives', { at: 99, manifest: man({ name: 'Drives there' }) })]));
  const merged = sync.merge(snap, remote);
  assert.ok(merged.pages.drives, 'the other PC\'s copy stays in the file');
  assert.deepEqual(sync.apply(desk, merged).filter(a => a.id === 'drives'), []);
  // One waiting to be added (from a routine) isn't yours yet: it stays too.
  assert.deepEqual(Object.keys(sync.snapshot(local(DESK, [page('gym-log', { wants: 'add' })])).pages), []);
});

test('data that stays on this PC neither leaves nor arrives, while the page itself goes', () => {
  const desk = local(DESK, [page('radar', { at: 10, sharedAt: 10, dataWhere: 'here', values: { found: ['x'] }, by: { found: stamped(5) } })]);
  const snap = sync.snapshot(desk);
  assert.equal(snap.pages.radar.data, null);
  const remote = sync.snapshot(local(LAPTOP, [page('radar', { at: 10, sharedAt: 10, values: { found: ['y'] }, by: { found: stamped(50) } })]));
  const merged = sync.merge(snap, remote);
  assert.deepEqual(merged.pages.radar.data.keys.found.v, ['y'], 'the laptop\'s data is what travels');
  assert.deepEqual(sync.apply(desk, merged), []);
});

test('a page arriving while this PC has one it never agreed to just takes the new version', () => {
  const desk = local(DESK, [page('gym-log', { at: 10, sharedAt: 10, agreed: null })]);
  const remote = sync.snapshot(local(LAPTOP, [page('gym-log', { at: 20 })]));
  const actions = sync.apply(desk, sync.merge(sync.snapshot(desk), remote));
  assert.deepEqual(actions.map(a => a.kind), ['changed']); // the store makes it current: nothing was agreed to keep running (store.arrive)
});

test('a delete made later removes the page here; one deleted here later stays gone and does not come back', () => {
  const desk = local(DESK, [page('gym-log', { at: 10, sharedAt: 10 })]);
  const laptopGone = sync.clean({ gone: { 'gym-log': 20 } });
  assert.deepEqual(sync.apply(desk, sync.merge(sync.snapshot(desk), laptopGone)), [{ kind: 'gone', id: 'gym-log' }]);
  const older = sync.clean({ gone: { 'gym-log': 5 } });
  const kept = sync.merge(sync.snapshot(desk), older);
  assert.ok(kept.pages['gym-log']);
  assert.deepEqual(sync.apply(desk, kept), [], 'an older delete changes nothing, and the gist already agreed on this version');
  // Deleted here at 30; the laptop still has it from 20: it stays deleted, and the marker travels.
  const after = local(DESK, [], { 'gym-log': 30 });
  const m = sync.merge(sync.snapshot(after), sync.snapshot(local(LAPTOP, [page('gym-log', { at: 20 })])));
  assert.deepEqual(Object.keys(m.pages), []);
  assert.equal(m.gone['gym-log'], 30);
  assert.deepEqual(sync.apply(after, m), []);
});

test('the budget: pages travel in the order last opened, one too big stays home and the rest still go', () => {
  const big = { ...FILES, 'data.txt': 'x'.repeat(LIMITS.FILES_BYTES - 200) }; // about 512 KB of files
  const pages = [
    page('a', { at: 1, openedAt: 50, files: big }),
    page('b', { at: 1, openedAt: 40, files: big }),
    page('c', { at: 1, openedAt: 30, files: big }),
    page('d', { at: 1, openedAt: 20, files: big, values: { blob: 'y'.repeat(200 * 1024) }, by: { blob: stamped(2) } }),
    page('e', { at: 1, openedAt: 10, files: FILES }),
  ];
  const m = sync.measure(local(DESK, pages));
  assert.deepEqual(m.pages.map(p => p.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(m.pages.map(p => p.fits), [true, true, true, false, true], 'd does not fit; e, smaller and older, still does');
  assert.ok(m.used <= LIMITS.SYNC_BYTES && m.used > LIMITS.SYNC_BYTES / 2);
  const snap = sync.snapshot(local(DESK, pages));
  assert.deepEqual(Object.keys(snap.pages).sort(), ['a', 'b', 'c', 'e']);
  assert.ok(Buffer.byteLength(sync.content(snap)) < sync.FILE_BYTES);
  // Nothing of d's is lost or deleted here, and a later change to d on the laptop still arrives.
  const merged = sync.merge(snap, sync.snapshot(local(LAPTOP, [page('d', { at: 9, files: FILES })])));
  assert.deepEqual(sync.apply(local(DESK, pages), merged).filter(a => a.id === 'd').map(a => a.kind), ['changed']);
});

test('a hostile gist is refused page by page, and prototype keys never land', () => {
  const good = { at: 5, from: LAPTOP, manifest: man(), files: FILES };
  const c = sync.clean(JSON.parse(JSON.stringify({
    pages: {
      'ok-page': good,
      '../etc': good,
      'Draft-abc': good,
      __proto__: good,
      constructor: good,
      'no-bridge': { ...good, files: { 'index.html': '<p>hi</p>' } },
      'remote-script': { ...good, files: { 'index.html': `${INDEX}<script src="https://evil.example/x.js"></script>` } },
      'nested-file': { ...good, files: { ...FILES, '../x.js': '1' } },
      'exe-file': { ...good, files: { ...FILES, 'run.exe': '1' } },
      'svg-script': { ...good, files: { ...FILES, 'logo.svg': '<svg><script>alert(1)</script></svg>' } },
      'bad-access': { ...good, manifest: { ...man(), access: { read: ['files'] } } },
      'too-big': { ...good, files: { ...FILES, 'big.txt': 'x'.repeat(LIMITS.FILES_BYTES + 1) } },
      'bad-data': { ...good, data: { keys: { __proto__: { v: { polluted: true }, at: 1 }, 'ok': { v: 1, at: 1 }, '': { v: 2, at: 1 }, huge: { v: 'x'.repeat(LIMITS.VALUE_BYTES + 1), at: 1 } } } },
      'bad-thumb': { ...good, thumb: Buffer.from('<svg onload=alert(1)>').toString('base64') },
    },
    gone: { 'fine-one': 3, 'bad id!': 4, __proto__: 5 },
  })));
  assert.deepEqual(Object.keys(c.pages).sort(), ['bad-data', 'bad-thumb', 'ok-page']);
  assert.deepEqual(Object.keys(c.pages['bad-data'].data.keys), ['ok']);
  assert.equal(c.pages['bad-thumb'].thumb, null);
  assert.deepEqual(c.gone, { 'fine-one': 3 });
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(c.pages, '__proto__'), false);
  // The whole file over the budget: what fits is kept, in order.
  const many = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i}`, { ...good, files: { ...FILES, 'f.txt': 'x'.repeat(LIMITS.FILES_BYTES - 2000) } }]));
  assert.equal(Object.keys(sync.clean({ pages: many }).pages).length, 4, 'four of about 510 KB fit in 2 MB');
  assert.deepEqual(sync.clean(null), { format: 1, pages: {}, gone: {} });
  assert.deepEqual(sync.clean({ pages: [1, 2], gone: 'x' }), { format: 1, pages: {}, gone: {} });
});

test('a miniature travels only as a small JPEG', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const item = sync.cleanItem('gym-log', { at: 1, manifest: man(), files: FILES, thumb: jpeg.toString('base64') });
  assert.equal(item.thumb, jpeg.toString('base64'));
  assert.equal(sync.cleanItem('gym-log', { at: 1, manifest: man(), files: FILES, thumb: Buffer.alloc(LIMITS.SYNC_THUMB_BYTES + 10, 0xff).toString('base64') }).thumb, null);
  const p = page('gym-log', { at: 1 });
  p.thumb = jpeg;
  assert.equal(sync.snapshot(local(DESK, [p])).pages['gym-log'].thumb, jpeg.toString('base64'));
});

test('a stamp from the future counts as none, so it can never win every merge', () => {
  const far = Date.now() + 365 * 24 * 60 * 60 * 1000;
  const mine = page('gym-log', { at: 15, sharedAt: 15 });
  const planted = { format: 1, pages: {}, gone: { 'gym-log': far } };
  const merged = sync.merge(sync.snapshot(local(DESK, [mine])), planted);
  assert.ok(merged.pages['gym-log'], 'the page stays');
  assert.deepEqual(sync.apply(local(DESK, [mine]), merged).filter(a => a.kind === 'gone'), []);
});

test('deletions from another PC are a few a pass, and always said', () => {
  const now = Date.now();
  const mine = ['a', 'b', 'c', 'd', 'e'].map(id => page(`page-${id}`, { at: 10, sharedAt: 10 }));
  const gone = Object.fromEntries(mine.map(p => [p.id, now]));
  const actions = sync.apply(local(DESK, mine), sync.merge(sync.snapshot(local(DESK, mine)), { format: 1, pages: {}, gone }));
  assert.equal(actions.filter(a => a.kind === 'gone').length, 3);
  assert.match(sync.describeArrived(actions), /3 pages deleted on another PC were moved to the \.trash folder/);
});

test('data keys named after Object.prototype members merge like any other', () => {
  const desk = local(DESK, [page('gym-log', { at: 10, sharedAt: 10, values: { toString: 'mine' }, by: { toString: stamped(5) } })]);
  const laptop = local(LAPTOP, [page('gym-log', { at: 10, sharedAt: 10, values: { valueOf: 'theirs' }, by: { valueOf: stamped(6) } })]);
  const keys = sync.merge(sync.snapshot(desk), sync.snapshot(laptop)).pages['gym-log'].data.keys;
  assert.deepEqual([keys.toString?.v, keys.valueOf?.v], ['mine', 'theirs']);
});
