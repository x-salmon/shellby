// What each paired phone may do (pocket/rights.js), and how pairing.js keeps it.
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../src/main/pocket/rights');
const p = require('../src/main/pocket/pairing');
const { ACTIONS } = require('../src/main/pocket/server');

test('a record with no level is a full one, and anything odd is too', () => {
  assert.equal(r.rightsOf({}), 'full');
  assert.equal(r.rightsOf(null), 'full');
  assert.equal(r.rightsOf({ rights: 'admin' }), 'full');
  assert.equal(r.rightsOf({ rights: 'readonly' }), 'readonly');
});

test('a full phone is refused nothing here; a read-only one may only look, leave and set its notifications', () => {
  for (const a of ACTIONS) assert.equal(r.refuse({ rights: 'full' }, a), null, a);
  for (const a of r.READ_ONLY_ACTIONS) {
    assert.ok(ACTIONS.includes(a), `${a} is an action`);
    assert.equal(r.refuse({ rights: 'readonly' }, a), null, a);
  }
  for (const a of ['answer', 'task', 'reply', 'stop', 'undo', 'home', 'reviewed', 'cancel-held', 'focus', 'routine-run', 'routine-toggle', 'workflow-run', 'note-add', 'note-tick', 'wear', 'quiet']) {
    assert.ok(ACTIONS.includes(a), `${a} is an action`);
    assert.equal(r.refuse({ rights: 'readonly' }, a), r.READ_ONLY_SAYS, a);
  }
  assert.equal(r.refuse({ rights: 'readonly' }, 'made-up'), r.READ_ONLY_SAYS);
  assert.equal(r.refuseUpload({ rights: 'full' }), null);
  assert.equal(r.refuseUpload({ rights: 'readonly' }), r.READ_ONLY_SAYS);
});

test('pairing keeps the level: new phones are full, old records read as full, and Settings can change one', () => {
  const { device } = p.newDevice({ name: 'iPhone', now: 1 });
  assert.equal(device.rights, 'full');
  const old = { ...device, id: 'a'.repeat(16) };
  delete old.rights;
  const list = p.normalizeDevices([old, { ...device, rights: 'readonly' }, { ...device, id: 'b'.repeat(16), rights: 'root' }]);
  assert.deepEqual(list.map(d => d.rights), ['full', 'readonly', 'full']);
  const changed = p.setRights(list, old.id, 'readonly');
  assert.equal(changed.find(d => d.id === old.id).rights, 'readonly');
  assert.equal(list.find(d => d.id === old.id).rights, 'full', 'the old list is untouched');
  assert.equal(p.setRights(list, old.id, 'root'), null);
  assert.equal(p.setRights(list, 'nobody', 'readonly'), null);
  assert.equal(p.devicesView(changed, 2)[0].rights, 'readonly');
});
