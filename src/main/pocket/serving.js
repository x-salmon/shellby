// Shellby on your phone: our port on your tailnet. Tailscale's status and what
// it serves, serve turned on for our port and taken back again, the Funnel
// check (the open internet is the one place this never is), and the watch
// while it's on. wiring/pocket.js hands in the Tailscale CLI and the settings.
const { DEFAULT_PORT } = require('./server');
const { pickHttpsPort } = require('./tailscale');

const WATCH_MS = 60 * 1000;          // how often Tailscale is looked at while it's on: Funnel never stays on
const TICK_MS = 5 * 1000;            // the usage meter and the queue change without a tab event
const TAILSCALE_URL = 'https://tailscale.com/download/windows';
const HTTPS_URL = 'https://login.tailscale.com/admin/dns';

/**
 * d: what main shares. o: { tailscale (the CLI, or a stand-in), settings(), save(patch),
 * vapidKeys() (made before a phone can ask for it), pushView() (what the tick sends) }
 */
function createPocketServing(d, { tailscale, settings, save, vapidKeys, pushView }) {
  let ts = { installed: null, state: 'unknown', dnsName: '', login: '', https: false };
  let serve = { httpsPort: 0, url: '', funnel: false, taken: [] };
  /** @type {Promise<typeof ts> | null} */ let checking = null;
  /** @type {{ text: string, link?: string | null, linkText?: string | null } | null} */ let problem = null;       // why it isn't serving, for Settings: { text, link?, linkText? }
  /** @type {NodeJS.Timeout | null} */ let watcher = null;
  /** @type {NodeJS.Timeout | null} */ let ticker = null;

  // ---- Tailscale

  // fresh: a look that starts now, after any already on its way (which may have
  // begun before serve was turned on or off).
  async function refreshTailscale({ fresh = false } = {}) {
    if (checking && !fresh) return checking;
    const before = checking || Promise.resolve();
    const mine = before.catch(() => {}).then(async () => {
      ts = await tailscale.status();
      const port = d.pocket?.port || DEFAULT_PORT;
      serve = ts.state === 'running' && ts.dnsName ? await tailscale.serveStatus({ port, dnsName: ts.dnsName }) : { httpsPort: 0, url: '', funnel: false, taken: [] };
      if (serve.funnel && d.pocket?.status === 'listening') {
        // On the open internet: the one thing this never is. Off now, and Settings says why.
        d.pocket.stop();
        problem = { text: 'Tailscale Funnel is on for this address, which puts it on the open internet. Shellby stopped serving your phone. Turn Funnel off, then turn this on again.' };
        d.log.warn('pocket: funnel is on for our address, stopped');
      }
      return ts;
    }).finally(() => { if (checking === mine) checking = null; });
    checking = mine;
    return mine;
  }

  const place = () => ({ dnsName: ts.dnsName || settings().dnsName, httpsPort: serve.httpsPort || settings().servedPort || 443 });
  const url = () => serve.url || '';

  // What's missing before it can be on, in order. null: nothing.
  function setupProblem() {
    if (ts.installed === false) return { step: 'install', text: 'Tailscale isn’t on this PC yet.', link: TAILSCALE_URL, linkText: 'Get Tailscale' };
    if (ts.state === 'needs-login' || ts.state === 'stopped') return { step: 'sign-in', text: 'Tailscale is installed but not connected. Open it and sign in.' };
    if (ts.state !== 'running' || !ts.dnsName) return { step: 'sign-in', text: ts.error || 'Tailscale isn’t running.' };
    if (!ts.https) return { step: 'https', text: 'Turn on HTTPS certificates for your tailnet (Admin console → DNS). Your phone needs them to install the app.', link: HTTPS_URL, linkText: 'Open the DNS page' };
    if (!ts.login) return { step: 'sign-in', text: 'Tailscale didn’t say who’s signed in on this PC.' };
    return null;
  }

  // ---- serving

  // The server, listening (or not, and why) before Settings is told how it went.
  /** @returns {Promise<void>} */ function listen() {
    if (d.pocket.status === 'listening') return Promise.resolve();
    return new Promise(resolve => {
      d.pocket.once('status', () => resolve());
      d.pocket.start();
    });
  }

  async function start() {
    problem = null;
    vapidKeys(); // the phone needs the key to turn notifications on, after a restart too
    await listen();
    if (d.pocket.status !== 'listening') return;
    // Our port behind Tailscale's https, unless it already is.
    const port = d.pocket.port;
    if (!serve.httpsPort) {
      const httpsPort = pickHttpsPort(serve);
      if (!httpsPort) { problem = { text: 'Tailscale already serves something else on every port it offers. Free 443 and try again.' }; return; }
      const r = await tailscale.serveOn({ port, httpsPort });
      if (!r.ok) {
        // "Serve is not enabled on your tailnet" comes with the page that turns it on.
        problem = { text: `Tailscale didn't put Shellby on your tailnet: ${r.error}`, link: r.link || null, linkText: r.link ? 'Turn on Serve' : null };
        d.log.warn('pocket: serve failed', r.error);
      } else save({ servedPort: httpsPort });
      await refreshTailscale({ fresh: true });
    }
    if (serve.funnel) {
      d.pocket.stop();
      problem = { text: 'Tailscale Funnel is on for this address. Turn it off first: Shellby only serves your phone on your own tailnet.' };
    }
    watch();
  }

  function watch() {
    clearInterval(/** @type {NodeJS.Timeout} */ (watcher));
    clearInterval(/** @type {NodeJS.Timeout} */ (ticker));
    watcher = setInterval(() => { refreshTailscale().catch(() => {}); }, WATCH_MS);
    ticker = setInterval(() => { pushView(); }, TICK_MS);
    watcher.unref?.();
    ticker.unref?.();
  }

  async function stopServing() {
    clearInterval(/** @type {NodeJS.Timeout} */ (watcher));
    clearInterval(/** @type {NodeJS.Timeout} */ (ticker));
    watcher = ticker = null;
    d.pocket?.stop();
    await takeServeBack();
  }

  // Only what Shellby asked Tailscale for itself, and only while it still points
  // at us. When Tailscale can't be asked (stopped, signed out), servedPort is
  // kept, and the next start of Shellby takes it back.
  async function takeServeBack() {
    const s = settings();
    if (!s.servedPort) return;
    await refreshTailscale({ fresh: true }).catch(() => {});
    if (ts.state !== 'running') { d.log.info('pocket: Tailscale is not running, so serve is taken back later'); return; }
    if (serve.httpsPort === s.servedPort) {
      const r = await tailscale.serveOff({ httpsPort: s.servedPort });
      if (!r.ok) { d.log.warn('pocket: serve off failed', r.error); return; }
    }
    save({ servedPort: 0 });
    await refreshTailscale({ fresh: true }).catch(() => {});
  }

  return {
    refreshTailscale, place, url, setupProblem, start, stopServing, takeServeBack,
    // As they stand now: Tailscale's status, what it serves, and why it isn't serving.
    ts: () => ts, serve: () => serve, problem: () => problem,
  };
}

module.exports = { createPocketServing };
