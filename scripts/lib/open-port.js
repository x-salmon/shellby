// A free port that fetch will talk to. The OS hands out any free port, but fetch
// (Node's and Chromium's) refuses the ones on the fetch spec's list, even on this
// PC: https://fetch.spec.whatwg.org/#port-blocking. Windows' usual range starts at
// 49152, above them all. A PC whose range was widened to start at 1024 gets one now
// and then, and the check looks like an app that never started.
const net = require('net');

const BLOCKED_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);
const MAX_TRIES = 20;

const listen = (server, host) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, host, () => { server.removeListener('error', reject); resolve(server.address().port); });
});
const close = server => new Promise(resolve => server.close(resolve));

/**
 * Listen on a free port fetch can reach. -> the port.
 * @param {import('net').Server} server  a net or http server that isn't listening yet
 * @param {{ host?: string, isBlocked?: (port: number) => boolean }} [opts]  isBlocked: for tests
 */
async function listenOpen(server, { host = '127.0.0.1', isBlocked = p => BLOCKED_PORTS.has(p) } = {}) {
  for (let i = 0; i < MAX_TRIES; i++) {
    const port = await listen(server, host);
    if (!isBlocked(port)) return port;
    await close(server);
  }
  throw new Error(`No port fetch can reach in ${MAX_TRIES} tries`);
}

/** n distinct free ports fetch can reach, let go again. */
async function openPorts(n) {
  const servers = Array.from({ length: n }, () => net.createServer());
  try {
    const ports = [];
    for (const s of servers) ports.push(await listenOpen(s)); // held until all are picked, so they differ
    return ports;
  } finally {
    await Promise.all(servers.filter(s => s.listening).map(close));
  }
}

module.exports = { BLOCKED_PORTS, listenOpen, openPorts };

// Run on its own (e2e-ci.js, which is synchronous): print n ports.
if (require.main === module) {
  openPorts(Number(process.argv[2]) || 1).then(
    ports => console.log(ports.join(' ')),
    e => { console.error(e.message); process.exitCode = 1; },
  );
}
