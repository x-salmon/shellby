/* Shellby on your phone — the service worker. It keeps the app's own files
   so it opens even while the PC is asleep (with what it last knew), shows
   the notifications your PC sends, opens the right screen when one is
   tapped, answers Allow or Deny from a notification's own buttons where the
   phone shows them (Android), and takes in what another app shares. Past
   that it never touches /pocket/v1: what Shellby is doing always comes live
   from the PC. */
'use strict';
const CACHE = 'shellby-pocket-4';
// A tap, kept for a moment: a phone can drop a message to an app it has
// paused, and an iPhone may open the start page instead of the URL. The app
// looks here whenever it comes to the front (pocket.js).
const TAPPED = 'shellby-pocket-tapped';
const TAPPED_KEY = '/__tapped';
// This phone's token, which the app keeps here as well as in its own storage
// (pocket-stream.js): a notification's Allow and Deny answer without the app open.
const KEY = 'shellby-pocket-key';
const KEY_URL = '/__key';
// What another app shared (the manifest's share_target), until the app takes it.
const SHARED = 'shellby-pocket-shared';
const SHARED_URL = '/__shared';
const MAX_SHARED_PHOTOS = 4;
const MAX_SHARED_TEXT = 4000;
const ID = /^[\w-]{1,100}$/;

const SHELL = [
  '/', '/pocket.css', '/pocket.js', '/pocket-logic.js', '/pocket-stream.js', '/pocket-draw.js', '/pocket-tab.js', '/pocket-more.js', '/pocket-bits.js', '/pocket-find.js', '/pocket-phone.js', '/pocket-new.js', '/manifest.webmanifest',
  '/shared/sprite.js', '/shared/tokens.css', '/shared/fonts.css',
  '/assets/fonts/PixelifySans.ttf', '/assets/fonts/AtkinsonHyperlegible-Regular.ttf', '/assets/fonts/AtkinsonHyperlegible-Bold.ttf', '/assets/fonts/MartianMono.ttf',
  '/icons/icon-192.png', '/icons/badge-96.png', '/skin.json',
];
const KEEP = [CACHE, TAPPED, KEY, SHARED];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

// Older copies go, and so does anything in this one the app no longer uses.
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(k => !KEEP.includes(k)).map(k => caches.delete(k)));
    try {
      const cache = await caches.open(CACHE);
      for (const req of await cache.keys()) if (!SHELL.includes(new URL(req.url).pathname)) await cache.delete(req);
    } catch { /* tidied next time */ }
    await self.clients.claim();
  })());
});

// The PC first, so an update to Shellby reaches the phone; the copy here when it's asleep.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method === 'POST' && url.pathname === '/share') { e.respondWith(takeShare(e.request)); return; }
  if (e.request.method !== 'GET' || url.pathname.startsWith('/pocket/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(e.request, { signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined });
      if (fresh.ok && (SHELL.includes(url.pathname) || url.pathname === '/index.html')) cache.put(url.pathname === '/index.html' ? '/' : url.pathname, fresh.clone());
      return fresh;
    } catch {
      const kept = await cache.match(e.request.mode === 'navigate' ? '/' : url.pathname);
      return kept || Response.error();
    }
  })());
});

// Shared from another app: kept here, then the app opens on a new task with it.
// Pictures only, four at most; the words once each (a link often comes as both).
async function takeShare(req) {
  // A share comes from the phone itself; a form on some web page posting here
  // is another site's words, so nothing of it is kept.
  if (req.headers.get('sec-fetch-site') === 'cross-site') return Response.redirect(new URL('/', self.location.origin).href, 303);
  try {
    const form = await req.formData();
    const words = ['title', 'text', 'url'].map(k => form.get(k)).filter(v => typeof v === 'string' && v.trim()).map(v => v.trim());
    const text = [...new Set(words)].join('\n').slice(0, MAX_SHARED_TEXT);
    const photos = form.getAll('photos').filter(f => f && typeof f === 'object' && /^image\//.test(f.type || '')).slice(0, MAX_SHARED_PHOTOS);
    const kept = await caches.open(SHARED);
    for (const k of await kept.keys()) await kept.delete(k);
    for (const [i, f] of photos.entries()) await kept.put(`${SHARED_URL}/${i}`, new Response(f, { headers: { 'content-type': f.type } }));
    await kept.put(SHARED_URL, new Response(JSON.stringify({ text, photos: photos.length, at: Date.now() }), { headers: { 'content-type': 'application/json' } }));
  } catch { /* the app opens on a new task without it */ }
  return Response.redirect(new URL('/#/share', self.location.origin).href, 303);
}

self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Shellby', body: e.data ? e.data.text() : '' }; }
  const url = typeof m.url === 'string' && m.url.startsWith('/') ? m.url : '/';
  const tag = typeof m.tag === 'string' ? m.tag.slice(0, 120) : 'shellby';
  // A prompt the phone may answer from here (pocket/notices.js decides): Allow and Deny on it.
  const answer = m.answer && ID.test(String(m.answer.tabId)) && ID.test(String(m.answer.requestId)) ? { tabId: m.answer.tabId, requestId: m.answer.requestId } : null;
  e.waitUntil((async () => {
    if (Number.isFinite(m.badge)) {
      try { if (m.badge > 0) await self.navigator.setAppBadge?.(m.badge); else await self.navigator.clearAppBadge?.(); } catch { /* no badges here */ }
    }
    await self.registration.showNotification(String(m.title || 'Shellby').slice(0, 120), {
      body: String(m.body || '').slice(0, 600),
      tag,
      // "Working on it" sits quietly; the "done" that replaces it (same tag) buzzes.
      silent: m.silent === true,
      renotify: tag.startsWith('ask-') || (tag.startsWith('tab-') && m.silent !== true),
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      timestamp: Number.isFinite(m.at) ? m.at : Date.now(),
      // iPhones show no buttons on a web app's notification, and ignore these.
      actions: answer ? [{ action: 'deny', title: 'Deny' }, { action: 'allow', title: 'Allow' }] : [],
      data: { url, answer },
    });
  })());
});

const sameOrigin = asked => (typeof asked === 'string' && asked.startsWith('/') && new URL(asked, self.location.origin).origin === self.location.origin ? asked : '/');

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = sameOrigin(e.notification.data?.url);
  const answer = e.notification.data?.answer;
  if ((e.action === 'allow' || e.action === 'deny') && answer) { e.waitUntil(answerFromHere(answer, e.action, url)); return; }
  e.waitUntil(openApp(url));
});

async function openApp(url) {
  try {
    const kept = await caches.open(TAPPED);
    await kept.put(TAPPED_KEY, new Response(JSON.stringify({ url, at: Date.now() }), { headers: { 'content-type': 'application/json' } }));
  } catch { /* the message below still goes */ }
  const open = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .filter(c => new URL(c.url).origin === self.location.origin);
  // The one you were looking at, if there's more than one.
  const app = open.find(c => c.focused) || open.find(c => c.visibilityState === 'visible') || open[0];
  if (app) {
    try { await app.focus(); } catch { /* not allowed here: the app still finds the tap when it shows */ }
    app.postMessage({ open: url });
    return;
  }
  try { await self.clients.openWindow(url); } catch { /* nothing to open */ }
}

// Allow or Deny from the notification's own button, under the same checks as
// the app's (the PC decides). When it doesn't go, a notification says why, and
// a tap on that one opens the prompt in the app.
async function answerFromHere(answer, decision, url) {
  let said = null;
  try {
    const res = await (await caches.open(KEY)).match(KEY_URL);
    const token = res ? (await res.text()).trim() : '';
    if (token) {
      const r = await fetch('/pocket/v1/answer', {
        method: 'POST', cache: 'no-store', credentials: 'omit',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tabId: answer.tabId, requestId: answer.requestId, decision }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
      });
      said = r.status === 401 ? { ok: false, error: 'This phone isn’t paired any more.' } : await r.json().catch(() => null);
    }
  } catch { said = null; }
  if (said?.ok) return;
  await self.registration.showNotification('Shellby', {
    body: said?.error ? `${said.error} Tap to open it.` : 'That didn’t reach your PC. Tap to answer it in the app.',
    tag: `ask-${answer.tabId}`,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url },
  });
}
