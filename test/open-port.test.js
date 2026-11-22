const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { BLOCKED_PORTS, listenOpen, openPorts } = require('../scripts/lib/open-port');

const close = server => new Promise(resolve => server.close(resolve));

test('fetch refuses every port on the list, so none of them is worth handing out', async () => {
  for (const port of BLOCKED_PORTS) {
    if (port === 0) continue; // never handed out: it's how you ask for one
    const err = await fetch(`http://127.0.0.1:${port}/`).then(() => null, e => e);
    assert.match(String(err?.cause?.message), /bad port/, `port ${port}`);
  }
});

test('listenOpen moves on from a port fetch would refuse', async () => {
  const seen = [];
  const server = http.createServer((req, res) => res.end('ok'));
  try {
    const port = await listenOpen(server, { isBlocked: p => { seen.push(p); return seen.length < 3; } });
    assert.equal(seen.length, 3);
    assert.equal(port, seen[2]);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ok');
  } finally {
    await close(server);
  }
});

test('listenOpen gives up, not listening, when every port is refused', async () => {
  const server = http.createServer();
  await assert.rejects(listenOpen(server, { isBlocked: () => true }), /No port fetch can reach/);
  assert.equal(server.listening, false);
});

test('openPorts gives distinct ports, all free again', async () => {
  const ports = await openPorts(3);
  assert.equal(new Set(ports).size, 3);
  for (const port of ports) {
    assert.ok(!BLOCKED_PORTS.has(port));
    const server = http.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    await close(server);
  }
});
