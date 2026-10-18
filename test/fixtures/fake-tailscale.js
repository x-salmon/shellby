// A stand-in for the Tailscale CLI (pocket/tailscale.js createTailscale), for
// e2e runs: SHELLBY_FAKE_TAILSCALE=<this file> in a dev build. Signed in, HTTPS
// on, and `serve` remembered in memory, so turning Shellby on your phone on and
// off goes the whole way without Tailscale on the box.
//
// SHELLBY_FAKE_TAILSCALE_FUNNEL=1 says Funnel is on for whatever is served.
const DNS = 'e2e-pc.tail0000.ts.net';
const LOGIN = 'e2e@example.com';

function createFakeTailscale() {
  let served = 0;
  return {
    async status() { return { installed: true, state: 'running', dnsName: DNS, login: LOGIN, tailnet: LOGIN, https: true }; },
    async serveStatus() {
      return served
        ? { httpsPort: served, url: `https://${DNS}${served === 443 ? '' : `:${served}`}/`, funnel: process.env.SHELLBY_FAKE_TAILSCALE_FUNNEL === '1', taken: [] }
        : { httpsPort: 0, url: '', funnel: false, taken: [] };
    },
    async serveOn({ httpsPort }) { served = httpsPort; return { ok: true }; },
    async serveOff() { served = 0; return { ok: true }; },
  };
}

module.exports = { createFakeTailscale, DNS, LOGIN };
