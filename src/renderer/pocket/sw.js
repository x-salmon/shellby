/* Shellby on your phone — the service worker. It keeps the app's own files
   so it opens even while the PC is asleep (with what it last knew), shows
   the notifications your PC sends, and opens the right screen when one is
   tapped. It never touches /pocket/v1: what Shellby is doing always comes
   live from the PC. */
'use strict';
const CACHE = 'shellby-pocket-3';
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
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
  const url = e.notification.data?.url || '/';
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = open.find(c => new URL(c.url).origin === self.location.origin);
    if (app) {
      await app.focus();
      app.postMessage({ open: url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
