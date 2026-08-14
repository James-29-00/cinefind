// Minimal service worker for CineFind.
//
// This intentionally does NO caching yet — every request just passes
// straight through to the network. Its only job right now is to exist and
// be registered, because on several Chromium versions (Chrome/Edge/Brave on
// Android) a registered service worker is one of the installability
// requirements for `beforeinstallprompt` to fire reliably. Without it, the
// in-app "📲 Install app" button can silently fail to appear on some
// devices even though the manifest + icons are otherwise correct.
//
// Offline caching (cache-first for static assets, network-first for
// TMDB/API calls) can be layered into the fetch handler below later without
// needing to change how this file is registered in index.html.

const SW_VERSION = 'v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through only — no caching logic yet.
  event.respondWith(fetch(event.request));
});
