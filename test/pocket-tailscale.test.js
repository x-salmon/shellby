const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('../src/main/pocket/tailscale');

const STATUS = {
  BackendState: 'Running',
  Self: { DNSName: 'desk-pc.tail4e2b.ts.net.', UserID: 1234 },
  User: { 1234: { LoginName: 'me@example.com', DisplayName: 'Me' } },
  CurrentTailnet: { Name: 'me@example.com', MagicDNSSuffix: 'tail4e2b.ts.net', MagicDNSEnabled: true },
  CertDomains: ['desk-pc.tail4e2b.ts.net'],
};

test('status: the name, the login and whether certificates are on', () => {
  assert.deepEqual(ts.parseStatus(JSON.stringify(STATUS)), {
    state: 'running', dnsName: 'desk-pc.tail4e2b.ts.net', login: 'me@example.com', tailnet: 'me@example.com', https: true,
  });
  assert.equal(ts.parseStatus({ ...STATUS, CertDomains: [] }).https, false);
  assert.equal(ts.parseStatus({ ...STATUS, BackendState: 'NeedsLogin' }).state, 'needs-login');
  assert.equal(ts.parseStatus('not json').state, 'unknown');
});

test('status: a name that is not a ts.net name is not used', () => {
  const s = ts.parseStatus({ ...STATUS, Self: { DNSName: 'evil.example.com.', UserID: 1234 } });
  assert.equal(s.dnsName, '');
  assert.equal(s.https, false);
});

test('serve: our port behind 443 is found, with its address', () => {
  const serve = {
    TCP: { 443: { HTTPS: true } },
    Web: { 'desk-pc.tail4e2b.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:47916' } } } },
  };
  assert.deepEqual(ts.parseServe(serve, { port: 47916, dnsName: 'desk-pc.tail4e2b.ts.net' }), {
    httpsPort: 443, url: 'https://desk-pc.tail4e2b.ts.net/', funnel: false, taken: [],
  });
});

test('serve: Funnel on our address, or a raw TCP forward to us, counts as exposed', () => {
  const funnel = {
    Web: { 'desk-pc.tail4e2b.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:47916' } } } },
    AllowFunnel: { 'desk-pc.tail4e2b.ts.net:8443': true },
  };
  const f = ts.parseServe(funnel, { port: 47916, dnsName: 'desk-pc.tail4e2b.ts.net' });
  assert.equal(f.funnel, true);
  assert.equal(f.url, 'https://desk-pc.tail4e2b.ts.net:8443/');
  assert.equal(ts.parseServe({ TCP: { 5000: { TCPForward: '127.0.0.1:47916' } } }, { port: 47916 }).funnel, true);
});

test('serve: a serve or Funnel left running in a terminal is seen too', () => {
  const fg = { Foreground: { abc: { Web: { 'desk-pc.tail4e2b.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:47916' } } } }, AllowFunnel: { 'desk-pc.tail4e2b.ts.net:443': true } } } };
  assert.equal(ts.parseServe(fg, { port: 47916, dnsName: 'desk-pc.tail4e2b.ts.net' }).funnel, true);
});

test('serve: 443 taken by something else means another port is asked for', () => {
  const serve = { Web: { 'desk-pc.tail4e2b.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } } };
  const s = ts.parseServe(serve, { port: 47916, dnsName: 'desk-pc.tail4e2b.ts.net' });
  assert.deepEqual(s.taken, [443]);
  assert.equal(s.httpsPort, 0);
  assert.equal(ts.pickHttpsPort(s), 8443);
  assert.equal(ts.pickHttpsPort({ taken: [] }), 443);
  assert.equal(ts.pickHttpsPort({ taken: ts.HTTPS_PORTS }), 0);
  assert.equal(ts.parseServe('', { port: 47916 }).httpsPort, 0);
});

test('serve is turned on and off for our port only, never with Funnel', () => {
  assert.deepEqual(ts.serveOnArgs(443, 47916), ['serve', '--bg', '--https=443', 'http://127.0.0.1:47916']);
  assert.deepEqual(ts.serveOffArgs(443), ['serve', '--https=443', 'off']);
  assert.ok(!ts.serveOnArgs(443, 1).join(' ').includes('funnel'));
});

test('the CLI is run by its full path when it is installed, and missing says so', async () => {
  const calls = [];
  const execFile = (bin, args, opts, cb) => { calls.push({ bin, args, opts }); cb(null, JSON.stringify(STATUS), ''); };
  const t = ts.createTailscale({ execFile, env: { ProgramFiles: 'C:\\Program Files' }, exists: p => p.includes('Program Files') });
  const s = await t.status();
  assert.equal(s.installed, true);
  assert.equal(s.dnsName, 'desk-pc.tail4e2b.ts.net');
  assert.match(calls[0].bin, /Tailscale[\\/]tailscale\.exe$/);
  assert.equal(calls[0].opts.windowsHide, true);

  const gone = ts.createTailscale({ execFile: (b, a, o, cb) => cb(Object.assign(new Error('no'), { code: 'ENOENT' })), env: {}, exists: () => false });
  assert.equal((await gone.status()).installed, false);
});

test("a failed serve comes back as Tailscale's own first line", async () => {
  const execFile = (b, a, o, cb) => cb(new Error('exit 1'), '', 'Serve is not enabled on your tailnet.\nTo enable, visit:\n  https://login.tailscale.com/f/serve?node=x\n');
  const t = ts.createTailscale({ execFile, env: {}, exists: () => false });
  const r = await t.serveOn({ port: 47916, httpsPort: 443 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'Serve is not enabled on your tailnet.');
});
