// Served into every page as its first script, ahead of the page's own
// (pages/protocol.js puts it there). WebRTC is the one way out of the sandbox
// that CSP has no rule for: in the spike (scripts/spikes/pages-sandbox) STUN
// over UDP and TURN over TCP both reached a local canary. A page gets no
// WebRTC at all. The window's WebRTC policy (disable_non_proxied_udp) is set
// as well, for UDP.
'use strict';
/* global window */
for (const name of Object.getOwnPropertyNames(window)) {
  if (/^(webkit)?RTC/.test(name)) {
    try { delete window[name]; } catch { /* not configurable: left as it is */ }
  }
}
