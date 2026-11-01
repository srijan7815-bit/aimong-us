/*
 * AImong Us service worker.
 *
 * Goal: the app icon on the home screen always opens instantly, even while the
 * Render free instance is cold-starting, and a flaky mobile network never shows
 * a browser error page.
 *
 * Strategy
 *  - navigations (the app shell): network-first, fall back to the cached shell
 *  - /assets/* (content-hashed by Vite): cache-first, immutable
 *  - /api/* and /matchmake/*: never cached (live game traffic)
 *
 * Bump CACHE_VERSION whenever the shell changes (index.html / sw.js).
 */
const CACHE_VERSION = 'aimong-v1';
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll fails the whole install if any URL 404s, so add individually.
      await Promise.all(
        SHELL_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function isAsset(url) {
  return url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live traffic must never be served from cache.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/matchmake') || url.pathname === '/healthz') {
    return;
  }

  // App shell / navigations: fresh if we can, cache if we cannot.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put('/', fresh.clone()).catch(() => undefined);
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          const cached = (await cache.match('/')) || (await cache.match('/index.html'));
          return (
            cached ||
            new Response(
              '<!doctype html><body style="font-family:system-ui;background:#070b14;color:#e8eefb;padding:2rem">' +
                '<h1>Offline</h1><p>The station is unreachable. Reconnect and try again.</p></body>',
              { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
            )
          );
        }
      })(),
    );
    return;
  }

  // Hashed build assets: cache-first.
  if (isAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          if (fresh.ok) cache.put(request, fresh.clone()).catch(() => undefined);
          return fresh;
        } catch {
          return cached || Response.error();
        }
      })(),
    );
  }
});

// Let the page trigger an immediate update after a new deploy.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});
