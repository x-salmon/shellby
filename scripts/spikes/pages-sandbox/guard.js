// What Shellby would run first in every page (served as /__shellby/guard.js and
// put ahead of the page's own scripts): WebRTC is the one way out CSP has no
// rule for, so a page gets no WebRTC at all.
'use strict';
/* global window */
for (const name of Object.getOwnPropertyNames(window)) {
  if (/^(webkit)?RTC/.test(name)) { try { delete window[name]; } catch { /* not configurable */ } }
}
