// alpha is a hostile page. Each probe says what Pages needs ("blocked" or
// "works") and what happened. If this file runs at all, script-src 'self'
// resolved to the page's own shellby-page://alpha/ files.
'use strict';
/* global window, document, fetch, XMLHttpRequest, WebSocket, EventSource, navigator, Worker, Blob, URL,
   RTCPeerConnection, indexedDB, caches, getComputedStyle, setTimeout, performance, localStorage, alert, location */

const WAIT = 1500;
const probes = [];
const violations = [];
document.addEventListener('securitypolicyviolation', e => violations.push(`${e.effectiveDirective} ${e.blockedURI}`));

const record = (name, want, got, detail = '') => probes.push({ name, want, got, pass: want === got, detail: String(detail).slice(0, 160) });
const viaCanary = (name, path, [got, detail]) => probes.push({ name, want: 'blocked', got, pass: got === 'blocked', detail: String(detail).slice(0, 160), canary: path });
const timeout = (ms, value) => new Promise(r => setTimeout(() => r(value), ms));
const sync = (fn) => { try { const v = fn(); return ['works', v]; } catch (err) { return ['blocked', err.name + ': ' + err.message]; } };
async function asyncProbe(fn) {
  try { const v = await Promise.race([fn(), timeout(WAIT, Symbol.for('timeout'))]); return v === Symbol.for('timeout') ? ['blocked', 'no answer'] : ['works', v]; }
  catch (err) { return ['blocked', err.name + ': ' + err.message]; }
}
function loads(tag, attrs, parent = document.body) {
  return new Promise(resolve => {
    const el = document.createElement(tag);
    el.onload = () => resolve(['works', 'loaded']);
    el.onerror = () => resolve(['blocked', 'error event']);
    Object.assign(el, attrs);
    parent.append(el);
    setTimeout(() => resolve(['blocked', 'no load in time']), WAIT);
  });
}

let seq = 0;
const pending = new Map();
function hostCall(msg) {
  return new Promise(resolve => {
    const n = ++seq;
    pending.set(n, resolve);
    window.parent.postMessage({ type: 'call', seq: n, ...msg }, '*');
    setTimeout(() => { if (pending.delete(n)) resolve({ ok: false, error: 'no answer' }); }, WAIT);
  });
}
const canaryPorts = new Promise(resolve => {
  window.addEventListener('message', e => {
    if (e.source !== window.parent) return;
    if (e.data?.type === 'canary') resolve(e.data);
    if (e.data?.type === 'answer' && pending.has(e.data.seq)) { pending.get(e.data.seq)(e.data.answer); pending.delete(e.data.seq); }
  });
  window.parent.postMessage({ type: 'canary' }, '*');
});

async function run() {
  const { http: hp, udp: up, tcp: tp } = await canaryPorts;
  const canary = p => `http://127.0.0.1:${hp}/${p}`;

  // --- its own files, through 'self'
  record("script-src 'self' loads app.js", 'works', 'works', location.href);
  record('inline <script> is blocked', 'blocked', window.inlineRan ? 'works' : 'blocked');
  record("style-src 'self' loads style.css", 'works', getComputedStyle(document.getElementById('styled')).color === 'rgb(1, 2, 3)' ? 'works' : 'blocked');
  const own = document.getElementById('own');
  record("img-src 'self' loads pic.svg", 'works', own.complete && own.naturalWidth > 0 ? 'works' : 'blocked');
  // eval on purpose: the probe passes only if the CSP (no 'unsafe-eval') stops it.
  record('eval is blocked', 'blocked', ...sync(() => eval('1 + 1')));
  record('its origin is opaque ("null")', 'works', window.origin === 'null' ? 'works' : 'blocked', window.origin);

  // --- Shellby itself
  record("parent's DOM", 'blocked', ...sync(() => window.parent.document.getElementById('secret').textContent = 'owned'));
  record('top.location', 'blocked', ...sync(() => window.top.location.href));
  record("the host's preload (spikeHost)", 'blocked', ...sync(() => { if (typeof window.spikeHost === 'undefined' && typeof window.parent.spikeHost === 'undefined') throw new Error('not visible'); return 'visible'; }));
  record('Node (require / process)', 'blocked', typeof window.require === 'undefined' && typeof window.process === 'undefined' ? 'blocked' : 'works');
  record('localStorage', 'blocked', ...sync(() => localStorage.length));
  record('document.cookie', 'blocked', ...sync(() => document.cookie));
  record('indexedDB', 'blocked', ...await asyncProbe(() => new Promise((res, rej) => { const r = indexedDB.open('x'); r.onsuccess = () => res('opened'); r.onerror = () => rej(r.error); })));
  record('CacheStorage', 'blocked', ...await asyncProbe(() => caches.open('x').then(() => 'opened')));
  const t0 = performance.now();
  try { alert('hi'); } catch { /* blocked either way */ }
  record('alert() returns at once (no allow-modals)', 'works', performance.now() - t0 < 200 ? 'works' : 'blocked', `${Math.round(performance.now() - t0)} ms`);
  record('window.open', 'blocked', ...sync(() => { const w = window.open(canary('popup')); if (!w) throw new Error('null window'); return 'opened'; }));

  // --- the network
  record('fetch to the canary', 'blocked', ...await asyncProbe(() => fetch(canary('fetch')).then(r => r.status)));
  record('XMLHttpRequest', 'blocked', ...await asyncProbe(() => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', canary('xhr')); x.onload = () => res(x.status); x.onerror = () => rej(new Error('xhr error')); x.send(); })));
  record('WebSocket', 'blocked', ...await asyncProbe(() => new Promise((res, rej) => { const s = new WebSocket(`ws://127.0.0.1:${hp}/ws`); s.onopen = () => res('open'); s.onerror = () => rej(new Error('ws error')); })));
  record('EventSource', 'blocked', ...await asyncProbe(() => new Promise((res, rej) => { const s = new EventSource(canary('sse')); s.onopen = () => res('open'); s.onerror = () => { s.close(); rej(new Error('sse error')); }; })));
  viaCanary('sendBeacon', 'beacon', sync(() => { if (!navigator.sendBeacon(canary('beacon'), 'x')) throw new Error('refused'); return 'queued'; }));
  record('<img> from the canary', 'blocked', ...await loads('img', { src: canary('img') }));
  record('CSS url() from the canary', 'blocked', ...await loads('img', { src: canary('css') }));
  record('<script> from the canary', 'blocked', ...await loads('script', { src: canary('script.js') }));
  record('<link rel=prefetch>', 'blocked', ...await loads('link', { rel: 'prefetch', href: canary('prefetch') }, document.head));
  viaCanary('nested <iframe> to the canary', 'iframe', await loads('iframe', { src: canary('iframe') }));
  record('dynamic import()', 'blocked', ...await asyncProbe(() => import(canary('module.js'))));
  record('Worker from a blob runs', 'blocked', ...await asyncProbe(() => new Promise((res, rej) => { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }))); w.onmessage = () => res('ran'); w.onerror = e => { e.preventDefault(); rej(new Error('worker error')); }; })));
  record('Worker from its own file', 'blocked', ...sync(() => new Worker('app.js')));
  viaCanary('form submit', 'form', sync(() => { const f = document.createElement('form'); f.action = canary('form'); f.method = 'post'; document.body.append(f); f.submit(); return 'submitted (check canary)'; }));
  record('WebRTC is gone', 'blocked', typeof RTCPeerConnection === 'undefined' ? 'blocked' : 'works');
  {
    viaCanary('WebRTC STUN to the canary', 'udp', await asyncProbe(async () => {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${up}` }] });
      pc.createDataChannel('x');
      await pc.setLocalDescription(await pc.createOffer());
      await timeout(800);
      pc.close();
      return 'gathered (check canary udp)';
    }));
  }

  record('about:blank child frame (a clean window to borrow from)', 'blocked', ...sync(() => { const f = document.createElement('iframe'); document.body.append(f); const w = f.contentWindow; return typeof w.RTCPeerConnection; }));
  viaCanary('a page navigating its own frame away (gamma)', 'navigate', ['blocked', 'see canary']);

  {
    viaCanary('WebRTC TURN over TCP to the canary', 'tcp', await asyncProbe(async () => {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: `turn:127.0.0.1:${tp}?transport=tcp`, username: 'u', credential: 'c' }], iceTransportPolicy: 'relay' });
      pc.createDataChannel('x');
      await pc.setLocalDescription(await pc.createOffer());
      await timeout(800);
      pc.close();
      return 'gathered';
    }));
  }

  record('WebRTC back from a fresh window', 'blocked', ...sync(() => { const w = window.open(); if (!w) throw new Error('no window'); return typeof w.RTCPeerConnection; }));

  // --- other pages
  record("another page's script (beta/secret.js)", 'blocked', ...await loads('script', { src: 'shellby-page://beta/secret.js' }));
  record("another page's image (beta/pic.svg)", 'blocked', ...await loads('img', { src: 'shellby-page://beta/pic.svg' }));
  record("fetch another page's file", 'blocked', ...await asyncProbe(() => fetch('shellby-page://beta/secret.js').then(r => r.status)));

  // --- the bridge
  const data = await hostCall({ call: 'data.get' });
  record('bridge: data.get (alpha has data)', 'works', data.ok ? 'works' : 'blocked', JSON.stringify(data));
  const forged = await hostCall({ call: 'data.get', frameId: 'gamma' });
  record('bridge: claiming to be gamma is ignored', 'works', forged.ok && forged.data?.page === 'alpha' ? 'works' : 'blocked', JSON.stringify(forged));
  const web = await hostCall({ call: 'fetch', url: 'https://api.example.com/x' });
  record('bridge: fetch to an unlisted host', 'blocked', web.ok ? 'works' : 'blocked', web.error);
  const huge = await hostCall({ call: 'data.get', pad: 'x'.repeat(2 * 1024 * 1024) });
  record('bridge: a 2 MB message is dropped', 'blocked', huge.ok ? 'works' : 'blocked', huge.error);

  // --- a page that hangs
  window.parent.postMessage({ type: 'busy-start' }, '*');
  await timeout(100);
  const end = performance.now() + 1500;
  while (performance.now() < end) { /* spin */ }
  await timeout(100);
  window.parent.postMessage({ type: 'busy-end' }, '*');
  await timeout(200);

  probes.push({ name: 'CSP violations seen', want: 'info', got: 'info', pass: true, detail: violations.join(' | ').slice(0, 600) });
  window.parent.postMessage({ type: 'report', probes }, '*');
}

run();
