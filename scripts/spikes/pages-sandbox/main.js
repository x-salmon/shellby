// Spike for Shellby Pages (docs/plans/shellby-pages.md, section 5): does a page
// in <iframe sandbox="allow-scripts">, served from shellby-page://<id>/ with the
// plan's CSP, really have no way out but postMessage? Throwaway: nothing in
// src/ uses it. Run with:
//   node_modules/electron/dist/electron.exe scripts/spikes/pages-sandbox
// It runs every probe twice: "csp" is the sandbox and CSP alone, with Shellby's
// existing web-guard; "guarded" adds the checks main could add for page frames;
// "stripped" also runs guard.js first in every page, which removes WebRTC.
// A local canary (HTTP, WebSocket and UDP on 127.0.0.1) counts anything that got
// out. Results go to stdout as JSON and to shellby-pages-spike.json in the temp folder.
'use strict';

const { app, BrowserWindow, protocol, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const dgram = require('node:dgram');
const net = require('node:net');
const { guardAllWebContents } = require('../../../src/main/web-guard');

const SCHEME = 'shellby-page';
const PAGES_DIR = path.join(__dirname, 'pages');
const HARD_STOP_MS = 60_000;
const MODE_WAIT_MS = 15_000;
const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'none'",
  "form-action 'none'", "base-uri 'none'",
].join('; ');
// What each page was given, as main would hold it (pages/rights.js).
const RIGHTS = Object.freeze({ alpha: { data: true, web: [] }, gamma: { data: false, web: [] } });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
guardAllWebContents(app); // the rules every Shellby window already has

// ------------------------------------------------------------------ canary
const hits = [];
function startCanary() {
  const server = http.createServer((req, res) => {
    hits.push({ kind: 'http', path: req.url });
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
    res.end('leaked');
  });
  server.on('upgrade', (req, socket) => { hits.push({ kind: 'ws', path: req.url }); socket.destroy(); });
  const udp = dgram.createSocket('udp4');
  udp.on('message', (_m, from) => hits.push({ kind: 'udp', path: `stun from ${from.port}` }));
  const turn = net.createServer(sock => { hits.push({ kind: 'tcp', path: 'turn over tcp' }); sock.destroy(); });
  return Promise.all([
    new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    new Promise(r => udp.bind(0, '127.0.0.1', () => r(udp.address().port))),
    new Promise(r => turn.listen(0, '127.0.0.1', () => r(turn.address().port))),
  ]).then(([httpPort, udpPort, tcpPort]) => ({ server, udp, turn, httpPort, udpPort, tcpPort }));
}

// ---------------------------------------------------------------- protocol
const served = [];
function servePages() {
  protocol.handle(SCHEME, req => {
    const url = new URL(req.url);
    const id = url.hostname;
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    served.push(`${id}/${rel}`);
    if (rel === '__shellby/guard.js') {
      return new Response(fs.readFileSync(path.join(__dirname, 'guard.js')), { headers: { 'Content-Type': 'text/javascript', 'Content-Security-Policy': CSP } });
    }
    const file = path.resolve(PAGES_DIR, id, rel);
    if (!RIGHTS[id] && id !== 'beta') return new Response('no such page', { status: 404 });
    if (!file.startsWith(path.join(PAGES_DIR, id) + path.sep) || !fs.existsSync(file)) {
      return new Response('not found', { status: 404 });
    }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    let body = fs.readFileSync(file);
    if (stripped && type === 'text/html') body = Buffer.from(String(body).replace(/<head>/i, '<head><script src="/__shellby/guard.js"></script>'));
    return new Response(body, {
      headers: { 'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' },
    });
  });
}

// ----------------------------------------------------- the "guarded" extras
const isPageFrame = frame => {
  try { return Boolean(frame?.url?.startsWith(`${SCHEME}:`) || frame?.origin === 'null'); } catch { return false; }
};
let guarded = false;
let stripped = false;
const blocked = [];
function installGuards(win) {
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const fromPage = guarded && details.frame && isPageFrame(details.frame) && !details.url.startsWith(`${SCHEME}:`);
    if (fromPage) blocked.push(`webRequest ${details.resourceType} ${details.url}`);
    cb({ cancel: Boolean(fromPage) });
  });
  win.webContents.on('will-frame-navigate', e => {
    if (!guarded || e.isMainFrame || e.url.startsWith(`${SCHEME}:`)) return;
    blocked.push(`will-frame-navigate ${e.url}`);
    e.preventDefault();
  });
}

// A probe can't always tell from inside whether something got out (a beacon is
// "queued", an iframe fires load on its error page), so the canary decides.
function judge(report, canaryHits) {
  if (!report?.probes) return report;
  const reached = p => canaryHits.some(h => (p === 'udp' || p === 'tcp' ? h.kind === p : h.path?.startsWith(`/${p}`)));
  const probes = report.probes.map(p => {
    if (!p.canary) return p;
    const got = reached(p.canary) ? 'works' : 'blocked';
    return { ...p, got, pass: got === p.want, detail: `${p.detail} · canary ${got === 'works' ? 'HIT' : 'quiet'}` };
  });
  return { ...report, probes };
}

// ------------------------------------------------------------------ bridge
// The host (the panel's stand-in) tells main which iframe a message came from;
// main decides, from its own table, and never from anything the page wrote.
const bridgeLog = [];
ipcMain.handle('spike:call', (e, msg) => {
  const id = msg?.frameId;
  const call = msg?.call;
  const rights = RIGHTS[id];
  let answer;
  if (!rights) answer = { ok: false, error: 'unknown page' };
  else if (call === 'data.get') answer = rights.data ? { ok: true, data: { page: id } } : { ok: false, error: 'no data access' };
  else if (call === 'fetch') answer = rights.web.includes(safeUrlHost(msg.url)) ? { ok: true } : { ok: false, error: `not allowed: ${safeUrlHost(msg.url)}` };
  else answer = { ok: false, error: `unknown call ${String(call).slice(0, 40)}` };
  bridgeLog.push({ id, call, claimed: msg?.claimed ?? null, answer });
  return answer;
});
function safeUrlHost(u) { try { return new URL(u).host; } catch { return '(bad url)'; } }

// ------------------------------------------------------------------- a run
function runMode(mode, canary) {
  guarded = mode !== 'csp';
  stripped = mode === 'stripped';
  hits.length = 0; blocked.length = 0; bridgeLog.length = 0; served.length = 0;
  win.webContents.setWebRTCIPHandlingPolicy(guarded ? 'disable_non_proxied_udp' : 'default');
  return new Promise(resolve => {
    const done = (_e, report) => { clearTimeout(t); ipcMain.removeListener('spike:done', done); finish(report); };
    const t = setTimeout(() => done(null, { timedOut: true }), MODE_WAIT_MS);
    ipcMain.on('spike:done', done);
    async function finish(report) {
      const frames = win.webContents.mainFrame.framesInSubtree.map(f => ({ url: f.url, origin: f.origin, pid: f.osProcessId }));
      await new Promise(r => setTimeout(r, 800)); // late beacons and STUN
      resolve({ mode, report: judge(report, hits), canaryHits: [...hits], blocked: [...blocked], bridge: [...bridgeLog], served: [...served], frames, hostPid: win.webContents.mainFrame.osProcessId });
    }
    win.loadFile(path.join(__dirname, 'host.html'), { query: { http: String(canary.httpPort), udp: String(canary.udpPort), tcp: String(canary.tcpPort), mode } });
  });
}

let win;
app.whenReady().then(async () => {
  const hard = setTimeout(() => { console.error('hard stop'); app.exit(2); }, HARD_STOP_MS);
  servePages();
  const canary = await startCanary();
  win = new BrowserWindow({
    show: false, x: -15000, y: -15000, width: 900, height: 700,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  installGuards(win);
  const results = [];
  for (const mode of ['csp', 'guarded', 'stripped']) results.push(await runMode(mode, canary));
  const out = { electron: process.versions.electron, chrome: process.versions.chrome, csp: CSP, results };
  fs.writeFileSync(path.join(require('node:os').tmpdir(), 'shellby-pages-spike.json'), JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  clearTimeout(hard);
  canary.server.close(); canary.udp.close(); canary.turn.close();
  win.destroy();
  app.quit();
});
