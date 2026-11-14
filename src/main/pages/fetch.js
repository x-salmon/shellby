// shellby.fetch(), done in main: a page's iframe can't reach the network at
// all, so a page with `web` access asks main to fetch for it. rights.js has
// already checked the host is one the page was given; this keeps the request
// itself small and plain:
//   - https on 443, GET or POST, no cookies, no credentials, no redirects
//   - 1 MB back at most, 15 seconds at most
//   - never to this PC or the local network: the address the connection
//     actually uses is checked (lookup), so a name that resolves to 127.0.0.1
//     or 192.168.x.x is refused even if it changes between lookups
// Rates are kept by the service. test/pages-fetch.test.js.
const https = require('https');
const dns = require('dns');
const net = require('net');
const { LIMITS } = require('./limits');

const KEEP_HEADERS = ['content-type', 'last-modified', 'etag', 'cache-control'];

/** Whether an address is this PC, the local network, or otherwise not the internet. */
function isPrivate(address) {
  const v = net.isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number);
    const c = Number(address.split('.')[2]);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && c === 0)
      || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const s = address.toLowerCase();
    if (s.startsWith('::ffff:')) return isPrivate(s.slice(7));
    // NAT64 (64:ff9b::) and 6to4 (2002::) can lead back into a private network.
    return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9')
      || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('ff') || s.startsWith('64:ff9b:') || s.startsWith('2002:');
  }
  return true;
}

const privateError = hostname => Object.assign(new Error(`${hostname} is on this PC or your local network, which a page can't reach.`), { code: 'EPRIVATE' });

/**
 * dns.lookup that refuses private addresses. net calls it with all: true
 * (happy eyeballs) and wants an array back; older callers want one address.
 * Any private address among them refuses the lot.
 */
function publicLookup(hostname, options, cb) {
  const all = !!options?.all;
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [];
    if (!list.length) return cb(Object.assign(new Error(`${hostname} has no address.`), { code: 'ENOTFOUND' }));
    if (list.some(a => isPrivate(a.address))) return cb(privateError(hostname));
    return all ? cb(null, list) : cb(null, list[0].address, list[0].family);
  });
}

/**
 * url: already checked by rights.fetchUrl. o: { method, body, headers }.
 * -> Promise<{ ok, status, headers, body }> or throws with a reason for the page.
 */
function pageFetch(url, o = {}, { request = https.request, lookup = publicLookup } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { 'user-agent': 'Shellby-page', accept: '*/*' };
    if (o.headers?.['content-type']) headers['content-type'] = String(o.headers['content-type']).slice(0, 100);
    const body = o.method === 'POST' && typeof o.body === 'string' ? Buffer.from(o.body, 'utf8') : null;
    if (body) headers['content-length'] = String(body.length);
    const req = request({
      protocol: 'https:', hostname: u.hostname, port: 443, path: `${u.pathname}${u.search}`,
      method: o.method === 'POST' ? 'POST' : 'GET', headers, lookup, timeout: LIMITS.FETCH_MS,
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > LIMITS.FETCH_BYTES) { req.destroy(); reject(new Error(`The answer from ${u.hostname} was over ${LIMITS.FETCH_BYTES / 1024 / 1024} MB.`)); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        const kept = Object.fromEntries(KEEP_HEADERS.filter(h => res.headers[h] !== undefined).map(h => [h, String(res.headers[h]).slice(0, 300)]));
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) kept.location = String(res.headers.location).slice(0, 500);
        resolve({ ok: status >= 200 && status < 300, status, headers: kept, body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error(`${u.hostname} took longer than ${LIMITS.FETCH_MS / 1000} seconds.`)), LIMITS.FETCH_MS);
    req.on('timeout', () => req.destroy(new Error(`${u.hostname} took longer than ${LIMITS.FETCH_MS / 1000} seconds.`)));
    req.on('error', err => { clearTimeout(timer); reject(/** @type {any} */ (err).code === 'EPRIVATE' ? err : new Error(`Couldn't reach ${u.hostname}: ${err.message}`)); });
    req.on('close', () => clearTimeout(timer));
    if (body) req.write(body);
    req.end();
  });
}

module.exports = { pageFetch, isPrivate, publicLookup };
