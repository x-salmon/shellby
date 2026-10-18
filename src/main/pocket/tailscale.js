// Tailscale, for Shellby on your phone (pocket/server.js).
//
// Shellby never listens beyond 127.0.0.1. Tailscale's own `serve` puts that
// port on your tailnet at https://<this-pc>.<tailnet>.ts.net, with a real
// certificate, which is what lets a phone install the page as an app and get
// push notifications. Only devices signed in to your tailnet can reach it, and
// Tailscale tells Shellby who each request is from (Tailscale-User-Login).
//
// This reads `tailscale status --json` and `tailscale serve status --json`,
// and turns serve on and off for our port, nothing else. Funnel (which would
// put the port on the open internet) is never turned on, and if it's on for
// our address Shellby refuses to serve at all.
//
// The parsing is pure; createTailscale() runs the CLI with execFile, no shell.
const fs = require('fs');
const path = require('path');

const HTTPS_PORTS = [443, 8443, 10000]; // tailscale serve takes 443, 8443 and 10000
const RUN_TIMEOUT_MS = 15000;
const DNS_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.ts\.net$/;

/** Where tailscale.exe usually is, then PATH. */
function candidates(env = process.env) {
  const out = [];
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]) {
    if (base) out.push(path.join(base, 'Tailscale', 'tailscale.exe'));
  }
  out.push(process.platform === 'win32' ? 'tailscale.exe' : 'tailscale');
  return out;
}

const lower = s => (typeof s === 'string' ? s.toLowerCase() : '');

/**
 * `tailscale status --json` -> what Settings and the server need.
 *   { state: 'running' | 'needs-login' | 'stopped' | 'starting' | 'unknown',
 *     dnsName, login, tailnet, https }
 * dnsName: this PC's MagicDNS name without the trailing dot, or '' when it has none.
 * https: whether the tailnet hands out certificates (an admin switch).
 */
function parseStatus(raw) {
  let j = raw;
  if (typeof raw === 'string') { try { j = JSON.parse(raw); } catch { j = null; } }
  if (!j || typeof j !== 'object') return { state: 'unknown', dnsName: '', login: '', tailnet: '', https: false };
  const backend = String(j.BackendState || '');
  const state = { Running: 'running', NeedsLogin: 'needs-login', NeedsMachineAuth: 'needs-login', Stopped: 'stopped', Starting: 'starting' }[backend] || 'unknown';
  const name = lower(j.Self?.DNSName).replace(/\.$/, '');
  const dnsName = DNS_NAME.test(name) ? name : '';
  const user = j.User && j.Self && j.User[String(j.Self.UserID)];
  const login = typeof user?.LoginName === 'string' ? user.LoginName.slice(0, 200) : '';
  const tailnet = typeof j.CurrentTailnet?.Name === 'string' ? j.CurrentTailnet.Name.slice(0, 200) : '';
  const certs = Array.isArray(j.CertDomains) ? j.CertDomains.map(lower) : [];
  return { state, dnsName, login, tailnet, https: !!dnsName && certs.includes(dnsName) };
}

const ours = (proxy, port) => {
  const p = lower(proxy).replace(/\/+$/, '');
  return p === `http://127.0.0.1:${port}` || p === `http://localhost:${port}` || p === `127.0.0.1:${port}` || p === `localhost:${port}` || p === String(port);
};

/**
 * `tailscale serve status --json` (a ServeConfig) -> where our port is served.
 *   { httpsPort, url, funnel, taken: [ports whose "/" serves something else] }
 * httpsPort: the https port that proxies "/" to us, or 0.
 * funnel: any of our addresses is open to the internet.
 */
function parseServe(raw, { port, dnsName }) {
  let j = raw;
  if (typeof raw === 'string') { try { j = JSON.parse(raw || '{}'); } catch { j = null; } }
  const out = { httpsPort: 0, url: '', funnel: false, taken: /** @type {number[]} */ ([]) };
  if (!j || typeof j !== 'object') return out;
  const web = j.Web && typeof j.Web === 'object' ? j.Web : {};
  for (const [hostPort, cfg] of Object.entries(web)) {
    const m = /^(.+):(\d+)$/.exec(lower(hostPort));
    if (!m) continue;
    const [, host, p] = m;
    if (dnsName && host !== dnsName) continue;
    const handlers = cfg?.Handlers && typeof cfg.Handlers === 'object' ? cfg.Handlers : {};
    const root = handlers['/'];
    const https = Number(p);
    if (root && ours(root.Proxy, port)) {
      if (!out.httpsPort) {
        out.httpsPort = https;
        out.url = https === 443 ? `https://${host}/` : `https://${host}:${https}/`;
      }
      if (j.AllowFunnel && j.AllowFunnel[hostPort]) out.funnel = true;
    } else if (root || Object.keys(handlers).length) {
      out.taken.push(https);
    }
  }
  // A raw TCP forward to our port skips the identity headers Shellby checks:
  // never one of ours, so it counts as exposed, like Funnel.
  const tcp = j.TCP && typeof j.TCP === 'object' ? j.TCP : {};
  for (const cfg of Object.values(tcp)) if (cfg && ours(cfg.TCPForward, port)) out.funnel = true;
  // A `tailscale serve` or `funnel` left running in a terminal keeps its own config per session.
  const fg = j.Foreground && typeof j.Foreground === 'object' ? Object.values(j.Foreground) : [];
  for (const cfg of fg) {
    const inner = parseServe(cfg, { port, dnsName });
    if (inner.funnel || inner.httpsPort) out.funnel = out.funnel || inner.funnel || !!(cfg?.AllowFunnel && Object.values(cfg.AllowFunnel).some(Boolean));
    if (inner.httpsPort && !out.httpsPort) { out.httpsPort = inner.httpsPort; out.url = inner.url; }
  }
  return out;
}

/** The https port to ask for: 443 unless something else has it. */
function pickHttpsPort(serve) {
  if (serve?.httpsPort) return serve.httpsPort;
  return HTTPS_PORTS.find(p => !serve?.taken?.includes(p)) || 0;
}

const serveOnArgs = (httpsPort, port) => ['serve', '--bg', `--https=${httpsPort}`, `http://127.0.0.1:${port}`];
const serveOffArgs = httpsPort => ['serve', `--https=${httpsPort}`, 'off'];

/** The page Tailscale says to visit (to turn Serve on for the tailnet), when it names one. */
function linkIn(text) {
  const m = /https:\/\/login\.tailscale\.com\/[^\s"'<>]+/.exec(String(text || ''));
  return m ? m[0].slice(0, 300) : null;
}

/** Tailscale's own words for a failure, cut down to a line Settings can show. */
function firstLine(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).find(Boolean)?.slice(0, 200) || '';
}

/**
 * The CLI, found once and run without a shell.
 *   execFile: child_process.execFile (injectable for tests)
 */
function createTailscale({ execFile = require('child_process').execFile, env = process.env, exists = p => fs.existsSync(p) } = {}) {
  let exe = null;

  function find() {
    if (exe) return exe;
    exe = candidates(env).find(p => !path.isAbsolute(p) || exists(p)) || null;
    return exe;
  }

  function run(args) {
    const bin = find();
    return new Promise(resolve => {
      if (!bin) { resolve({ ok: false, missing: true, stdout: '', stderr: '' }); return; }
      execFile(bin, args, { timeout: RUN_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') { exe = null; resolve({ ok: false, missing: true, stdout: '', stderr: '' }); return; }
        resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
      });
    });
  }

  async function status() {
    const r = await run(['status', '--json']);
    if (r.missing) return { installed: false, ...parseStatus(null) };
    // A stopped or signed-out tailscale still prints its JSON, with an exit code.
    const s = parseStatus(r.stdout);
    if (s.state === 'unknown' && !r.ok) return { installed: true, ...s, error: firstLine(r.stderr) };
    return { installed: true, ...s };
  }

  async function serveStatus({ port, dnsName }) {
    const r = await run(['serve', 'status', '--json']);
    if (!r.ok) return { ...parseServe(null, { port, dnsName }), error: firstLine(r.stderr) || "Couldn't read Tailscale's serve settings." };
    return parseServe(r.stdout, { port, dnsName });
  }

  async function serveOn({ port, httpsPort }) {
    const r = await run(serveOnArgs(httpsPort, port));
    if (r.ok) return { ok: true };
    const said = `${r.stderr}\n${r.stdout}`;
    return { ok: false, error: firstLine(said) || "Tailscale didn't take it.", link: linkIn(said) };
  }

  async function serveOff({ httpsPort }) {
    const r = await run(serveOffArgs(httpsPort));
    return r.ok ? { ok: true } : { ok: false, error: firstLine(r.stderr) || "Tailscale didn't let go of it." };
  }

  return { find, run, status, serveStatus, serveOn, serveOff };
}

module.exports = { HTTPS_PORTS, candidates, createTailscale, firstLine, linkIn, parseServe, parseStatus, pickHttpsPort, serveOffArgs, serveOnArgs };
