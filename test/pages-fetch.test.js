const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const dns = require('dns');
const { publicLookup, isPrivate } = require('../src/main/pages/fetch');

const call = (host, options) => new Promise(resolve => publicLookup(host, options, (err, ...rest) => resolve({ err, rest })));

test('publicLookup answers both shapes net asks for', async t => {
  const real = dns.lookup;
  t.after(() => { dns.lookup = real; });
  dns.lookup = (_h, o, cb) => cb(null, o.all ? [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }] : '93.184.216.34', 4);
  const many = await call('example.com', { all: true });
  assert.equal(many.err, null);
  assert.equal(many.rest[0].length, 2);
  const one = await call('example.com', {});
  assert.deepEqual(one.rest, ['93.184.216.34', 4]);
});

test('publicLookup refuses a name with any private address', async t => {
  const real = dns.lookup;
  t.after(() => { dns.lookup = real; });
  dns.lookup = (_h, _o, cb) => cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  const r = await call('sneaky.example', { all: true });
  assert.equal(r.err?.code, 'EPRIVATE');
});

test('a real connection goes through publicLookup, and refuses this PC', async () => {
  // localhost is this PC: the connection must fail with EPRIVATE, not with a lookup-shape error.
  const err = await new Promise(resolve => {
    const s = net.connect({ host: 'localhost', port: 9, lookup: publicLookup });
    s.on('error', resolve);
    s.on('connect', () => { s.destroy(); resolve(null); });
  });
  assert.equal(err?.code, 'EPRIVATE');
});

test('the odd ranges that lead back inside count as private', () => {
  for (const a of ['192.0.0.8', '198.18.0.1', '198.19.255.1', '64:ff9b::a00:1', '2002:c0a8:101::1']) assert.equal(isPrivate(a), true, a);
});
