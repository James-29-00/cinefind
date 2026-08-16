// CineFind service worker — app-shell offline caching.
//
// Previously this just passed every request straight through to the
// network (registered purely to satisfy Chrome's installability
// criteria for the "Add to Home Screen" prompt). This version adds the
// actual offline fallback: the app shell (index.html) gets cached on
// install, and if a page load fails because there's no connection, the
// cached shell is served instead of the browser's default offline error.
//
// Scope stays intentionally narrow — this does NOT try to cache movie
// posters, search results, or site-status data. Those are inherently
// live/dynamic (a cached "Online" status shown while offline would be
// actively misleading), so the app's existing error states (timeouts,
// "could not reach this link") continue to handle that case, unchanged.

const CACHE_NAME = 'cinefind-shell-v1';
// Bump CACHE_NAME (e.g. -v2) on future deploys that change index.html
// structure enough to warrant forcing a fresh shell — the activate step
// below deletes any cache whose name doesn't match, so old shells don't
// linger and serve stale HTML.
const SHELL_URL = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(SHELL_URL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only intercept top-level navigations (loading/reloading the app
  // itself). Everything else — TMDB requests, the Cloudflare Worker,
  // site-status pings, external streaming links — passes straight
  // through untouched, exactly as before.
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(SHELL_URL).then((cached) =>
        cached || new Response(
          '<h1>You\u2019re offline</h1><p>CineFind needs a connection to load. Please check your internet and try again.</p>',
          { headers: { 'Content-Type': 'text/html' } }
        )
      )
    )
  );
});
