/* Shellby on your phone — the service worker. It keeps the app's own files
   so it opens even while the PC is asleep (with what it last knew), shows
   the notifications your PC sends, and opens the right screen when one is
   tapped. It never touches /pocket/v1: what Shellby is doing always comes
   live from the PC. */
'use strict';
const CACHE = 'shellby-pocket-3';
// A tap, kept for a moment: a phone can drop a message to an app it has
// paused, and an iPhone may open the start page instead of the URL. The app
// looks here whenever it comes to the front (pocket.js).
const TAPPED = 'shellby-pocket-tapped';
const TAPPED_KEY = '/__tapped';

const SHELL = [
  '/', '/pocket.css', '/pocket.js', '/pocket-logic.js', '/pocket-stream.js', '/pocket-draw.js', '/pocket-tab.js', '/pocket-more.js', '/pocket-bits.js', '/pocket-find.js', '/pocket-phone.js', '/manifest.webmanifest',
  '/shared/sprite.js', '/shared/tokens.css', '/shared/fonts.css',
  '/assets/fonts/PixelifySans.ttf', '/assets/fonts/AtkinsonHyperlegible-Regular.ttf', '/assets/fonts/AtkinsonHyperlegible-Bold.ttf', '/assets/fonts/MartianMono.ttf',
  '/icons/icon-192.png', '/icons/badge-96.png', '/skin.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== TAPPED).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// The PC first, so an update to Shellby reaches the phone; the copy here when it's asleep.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/pocket/')) return;
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

self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Shellby', body: e.data ? e.data.text() : '' }; }
  const url = typeof m.url === 'string' && m.url.startsWith('/') ? m.url : '/';
  const tag = typeof m.tag === 'string' ? m.tag.slice(0, 120) : 'shellby';
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
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const asked = e.notification.data?.url;
  const url = typeof asked === 'string' && asked.startsWith('/') && new URL(asked, self.location.origin).origin === self.location.origin ? asked : '/';
  e.waitUntil((async () => {
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
  })());
});
