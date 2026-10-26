// Receives Claude Code's telemetry (telemetry.js has the rules): an OTLP/HTTP
// receiver on 127.0.0.1, for metrics only, behind a token made fresh each run so
// nothing else on this PC can add to the numbers. Keeps a per-day ledger in
// config.json and hands the conversations Shellby starts the variables that
// point Claude Code at it.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomBytes, timingSafeEqual } = require('crypto');
const tel = require('./telemetry');

const MAX_BODY = 4 * 1024 * 1024;   // one export; Claude Code's are a few KB
const SAVE_MS = 5000;
const MAX_SETTINGS = 1024 * 1024;
const HEADERS_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;
const KEEP_ALIVE_MS = 1000;
// Managed settings can set telemetry up for an organisation; Claude Code reads them over yours.
const MANAGED_SETTINGS = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'managed-settings.json');

/**
 * deps: { config, configDir(): string, env?: process.env, managedFile?: string, log }
 */
function createTelemetry(deps) {
  const { config } = deps;
  const token = randomBytes(24).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  /** @type {import('http').Server | null} */
  let server = null;
  /** @type {number | null} */
  let port = null;
  /** @type {any} */
  let days = null;
  /** @type {NodeJS.Timeout | null} */
  let saveTimer = null;

  const load = () => { days ??= tel.normalizeDays(config.get('telemetryDays')); };

  function save() {
    clearTimeout(saveTimer ?? undefined);
    saveTimer = null;
    if (days) config.set({ telemetryDays: days });
  }

  function authorized(req) {
    const got = Buffer.from(String(req.headers.authorization || ''));
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  // Claude Code never sends an Origin and always names the loopback address it
  // was given: anything else is a browser or a rebinding trick.
  const fromHere = req => !req.headers.origin && req.headers.host === `127.0.0.1:${port}`;

  function onRequest(req, res) {
    const reply = (code, close = false) => {
      res.writeHead(code, { 'content-type': 'application/json', ...(close ? { connection: 'close' } : {}) });
      res.end('{}');
    };
    if (req.method !== 'POST' || req.url !== '/v1/metrics') return reply(404);
    if (!fromHere(req)) return reply(403);
    if (!authorized(req)) return reply(401);
    if (!/json/i.test(String(req.headers['content-type'] || ''))) return reply(415);
    if (Number(req.headers['content-length']) > MAX_BODY) return reply(413, true);
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', c => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY) {
        done = true;
        res.on('finish', () => req.destroy());
        reply(413, true);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400); }
      load();
      const next = tel.recordPoints(days, tel.pointsFrom(body), Date.now());
      if (next !== days) {
        days = next;
        if (!saveTimer) saveTimer = setTimeout(save, SAVE_MS);
      }
      reply(200);
    });
    req.on('error', () => {});
  }

  function start() {
    if (server) return;
    const s = http.createServer(onRequest);
    s.headersTimeout = HEADERS_TIMEOUT_MS;
    s.requestTimeout = REQUEST_TIMEOUT_MS;
    s.keepAliveTimeout = KEEP_ALIVE_MS;
    // A receiver that failed is let go, so the next conversation tries again.
    s.on('error', err => {
      deps.log?.warn(`telemetry: receiver failed: ${err.message}`);
      if (server === s) { server = null; port = null; }
    });
    s.listen(0, '127.0.0.1', () => { if (server === s) port = /** @type {import('net').AddressInfo} */ (s.address()).port; });
    server = s;
  }

  function stop() {
    save();
    server?.close();
    server = null;
    port = null;
  }

  // An env block in a Claude Code settings file, or null.
  function settingsEnv(file) {
    try {
      if (fs.statSync(file).size > MAX_SETTINGS) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))?.env || null;
    } catch { return null; }
  }

  /**
   * Variables for a Claude Code that Shellby starts on this PC, or {} when it
   * shouldn't send here. Project settings can't point telemetry elsewhere
   * (Claude Code ignores OTEL exporter variables in them); your own user
   * settings and managed settings can, and then Shellby stays out.
   */
  function env() {
    if (config.get('claudeTelemetry') === false) return {};
    if (!server) start();
    if (!port) return {};
    const own = tel.ownTelemetry(deps.env || process.env, settingsEnv(path.join(deps.configDir(), 'settings.json')), settingsEnv(deps.managedFile || MANAGED_SETTINGS));
    return own ? {} : tel.telemetryEnv({ port, token });
  }

  function summary() {
    load();
    return tel.telemetrySummary(days, Date.now());
  }

  return { start, stop, save, env, summary, port: () => port, token: () => token };
}

module.exports = { createTelemetry };
