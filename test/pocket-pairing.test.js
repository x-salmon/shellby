const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/main/pocket/pairing');

test('a code is eight characters a person can read off a screen', () => {
  for (let i = 0; i < 200; i++) {
    const code = p.newCode();
    assert.equal(code.length, p.CODE_LEN);
    for (const ch of code) assert.ok(p.CODE_ALPHABET.includes(ch), ch);
    assert.doesNotMatch(code, /[01ILO]/);
  }
  assert.equal(p.showCode('K7Q2M9XD'), 'K7Q2-M9XD');
  assert.equal(p.showCode('short'), '');
});

test('the code is typed however you like: case, spaces and the dash do not matter', () => {
  const s = p.openPairing(1000, 'K7Q2M9XD');
  assert.equal(p.tryCode(s, 'k7q2-m9xd', 2000).ok, true);
  assert.equal(p.tryCode(s, ' K7Q2 M9XD ', 2000).ok, true);
});

test('a wrong code counts a try, and the fifth wrong one closes it', () => {
  let s = p.openPairing(0, 'K7Q2M9XD');
  for (let i = 1; i < p.CODE_TRIES; i++) {
    const r = p.tryCode(s, 'AAAAAAAA', 10);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'wrong');
    assert.equal(r.state.tries, i);
    s = r.state;
  }
  const last = p.tryCode(s, 'AAAAAAAA', 10);
  assert.equal(last.error, 'closed');
  assert.equal(last.state, null);
  // ...and the right code after that is no use either.
  assert.equal(p.tryCode(last.state, 'K7Q2M9XD', 10).ok, false);
});

test('a code runs out after five minutes, and works only once', () => {
  const s = p.openPairing(0, 'K7Q2M9XD');
  assert.equal(p.tryCode(s, 'K7Q2M9XD', p.CODE_TTL_MS + 1).error, 'closed');
  const ok = p.tryCode(s, 'K7Q2M9XD', 5);
  assert.equal(ok.ok, true);
  assert.equal(ok.state, null);
  assert.equal(p.tryCode(null, 'K7Q2M9XD', 5).ok, false);
});

test('a prefix or a longer string is not the code', () => {
  const s = p.openPairing(0, 'K7Q2M9XD');
  assert.equal(p.tryCode(s, 'K7Q2', 1).ok, false);
  assert.equal(p.tryCode(s, 'K7Q2M9XDZ', 1).ok, false);
  assert.equal(p.tryCode(s, '', 1).ok, false);
});

test('a device keeps a hash of its token, never the token', () => {
  const { device, token } = p.newDevice({ name: 'iPhone', login: 'me@example.com', now: 5 });
  assert.match(token, p.TOKEN_RE);
  assert.notEqual(device.tokenHash, token);
  assert.equal(device.tokenHash, p.sha256(token));
  assert.ok(!JSON.stringify(device).includes(token));
  assert.equal(p.deviceFor([device], token), device);
  assert.equal(p.deviceFor([device], token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(p.deviceFor([device], 'not a token'), null);
  assert.equal(p.deviceFor([device], undefined), null);
});

test('the list in settings.json is checked, and holds a few phones at most', () => {
  assert.deepEqual(p.normalizeDevices('nope'), []);
  assert.deepEqual(p.normalizeDevices([{ id: 'x', tokenHash: 'y' }]), []);
  let list = [];
  for (let i = 0; i < p.MAX_DEVICES + 2; i++) list = p.addDevice(list, p.newDevice({ name: `phone ${i}`, now: i }).device);
  assert.equal(list.length, p.MAX_DEVICES);
  // The ones seen longest ago made way.
  assert.equal(list[0].name, 'phone 2');
});

test('a name is plain text, from what the phone says it is', () => {
  assert.equal(p.nameFromAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'iPhone');
  assert.equal(p.nameFromAgent('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari'), 'Android phone');
  assert.equal(p.nameFromAgent('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'iPad');
  assert.equal(p.nameFromAgent(''), 'Phone');
  assert.equal(p.cleanName('my‮phone\n'), 'my phone');
  assert.equal(p.newDevice({ name: 'x'.repeat(200) }).device.name.length, 40);
});

test('what Settings lists has no hashes', () => {
  const { device } = p.newDevice({ name: 'iPhone', now: 0 });
  const [v] = p.devicesView([device], 60 * 1000);
  assert.equal(v.tokenHash, undefined);
  assert.equal(v.recent, true);
  assert.equal(p.devicesView([device], 10 * 60 * 1000)[0].recent, false);
});
