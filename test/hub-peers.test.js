const { test } = require('node:test');
const assert = require('node:assert/strict');
const peers = require('../src/main/hub/peers');

test('an address is only ever https on a .ts.net name, on a port serve takes', () => {
  assert.equal(peers.originOf('desk.tail3f2c.ts.net'), 'https://desk.tail3f2c.ts.net');
  assert.equal(peers.originOf('https://Desk.Tail3f2c.ts.net/#/tab/x'), 'https://desk.tail3f2c.ts.net');
  assert.equal(peers.originOf('https://desk.tail3f2c.ts.net:8443'), 'https://desk.tail3f2c.ts.net:8443');
  assert.equal(peers.originOf('https://desk.tail3f2c.ts.net:443'), 'https://desk.tail3f2c.ts.net');
  for (const bad of ['http://desk.tail3f2c.ts.net', 'https://evil.com', 'https://desk.ts.net.evil.com', 'https://192.168.1.5',
    'https://desk.tail3f2c.ts.net:22', 'https://me:pw@desk.tail3f2c.ts.net', 'file:///C:/x', '', 'javascript:alert(1)']) {
    assert.equal(peers.originOf(bad), null, bad);
  }
});

test('adding pairs a PC once per address, names it, and caps the list', () => {
  const a = peers.add([], { origin: 'laptop.tail3f2c.ts.net', name: 'Travel laptop', token: 'sealed', now: 5 });
  assert.equal(a.list.length, 1);
  assert.match(a.list[0].id, /^p-[a-f0-9]{12}$/);
  assert.equal(a.list[0].name, 'Travel laptop');
  const again = peers.add(a.list, { origin: 'https://laptop.tail3f2c.ts.net', token: 'fresh', now: 9 });
  assert.equal(again.list.length, 1, 'the same PC again replaces it');
  assert.equal(again.list[0].token, 'fresh');
  assert.equal(again.list[0].name, 'laptop', 'no name given: its host name');
  assert.match(peers.add([], { origin: 'evil.com', token: 't', now: 1 }).error, /ts\.net/);
  let list = [];
  for (let i = 0; i < peers.MAX_PEERS; i++) list = peers.add(list, { origin: `pc${i}.t.ts.net`, token: 't', now: i }).list;
  assert.match(peers.add(list, { origin: 'one-more.t.ts.net', token: 't', now: 1 }).error, /up to/);
});

test('the saved list is checked again when read', () => {
  const good = peers.add([], { origin: 'desk.t.ts.net', token: 'sealed', now: 1 }).list[0];
  const list = peers.normalize([good, { ...good }, { ...good, id: 'x' }, { ...good, origin: 'https://evil.com', id: 'p-000000000000' }, null, { id: 'p-111111111111', origin: 'a.t.ts.net' }]);
  assert.deepEqual(list.map(p => p.origin), ['https://desk.t.ts.net']);
});

test('remove and rename', () => {
  const { list } = peers.add([], { origin: 'desk.t.ts.net', name: 'Desk', token: 't', now: 1 });
  assert.equal(peers.rename(list, list[0].id, '  Office PC ')[0].name, 'Office PC');
  assert.equal(peers.rename(list, list[0].id, '   ')[0].name, 'Desk', 'an empty name changes nothing');
  assert.deepEqual(peers.remove(list, list[0].id), []);
});
