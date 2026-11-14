// The panel's stand-in: pages/bridge.js as the plan describes it. It knows each
// page by which iframe a message came from (event.source), never by what the
// message says, and passes calls to main, which decides.
'use strict';
/* global document, window, location, setTimeout, setInterval, clearInterval, performance */

const MAX_MESSAGE = 256 * 1024;
const frames = { alpha: document.getElementById('alpha'), gamma: document.getElementById('gamma') };
const params = new URLSearchParams(location.search);
const host = { refused: [], answered: 0, busyGapMs: null, secretIntact: true };

function whichPage(source) {
  for (const [id, el] of Object.entries(frames)) if (el.contentWindow === source) return id;
  return null;
}

let ticking = null;
function watchTimers() {
  let last = performance.now();
  let worst = 0;
  ticking = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; }, 20);
  return () => { clearInterval(ticking); return Math.round(worst); };
}
let stopWatch = null;

window.addEventListener('message', async e => {
  const id = whichPage(e.source);
  if (!id || e.origin !== 'null') { host.refused.push(`from ${e.origin}: not a page frame`); return; }
  let size;
  try { size = JSON.stringify(e.data).length; } catch { host.refused.push(`${id}: not plain data`); return; }
  if (size > MAX_MESSAGE) { host.refused.push(`${id}: ${size} bytes, over ${MAX_MESSAGE}`); return; }
  const msg = e.data || {};
  if (msg.type === 'canary') { e.source.postMessage({ type: 'canary', http: params.get('http'), udp: params.get('udp'), tcp: params.get('tcp') }, '*'); return; }
  if (msg.type === 'busy-start') { stopWatch = watchTimers(); return; }
  if (msg.type === 'busy-end') { host.busyGapMs = stopWatch ? stopWatch() : null; return; }
  if (msg.type === 'report' && id === 'alpha') { finish(msg.probes); return; }
  if (msg.type === 'call') {
    const answer = await window.spikeHost.call({ frameId: id, call: msg.call, url: msg.url, claimed: msg.frameId });
    host.answered++;
    e.source.postMessage({ type: 'answer', seq: msg.seq, answer }, '*');
  }
});

function finish(probes) {
  host.secretIntact = document.getElementById('secret').textContent === 'panel-only text';
  setTimeout(() => window.spikeHost.done({ probes, host, mode: params.get('mode') }), 1500); // let gamma navigate
}
