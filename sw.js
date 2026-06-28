/* Flat Earth Paper — service worker
   Precaches the core files so the atlas works offline, and runtime-caches
   external resources (fonts, three.js, lenis) as they are first fetched.
   Pages are cached at their clean (extensionless) URLs.
   Bump CACHE when you ship a significant update to force a fresh cache. */
const CACHE = 'fep-cache-v3';

/* Pages addressed by their clean URLs (see vercel.json / _redirects / .htaccess) */
const PAGES = ['./', './megathread', './privacy', './terms'];

/* Static assets that always exist at a fixed path */
const ASSETS = [
  './site.webmanifest',
  './favicon.svg',
  './favicon-32.png',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './og-cover.png',
  './og-megathread.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Assets are all-or-nothing; pages are cached individually so a host
      // that serves them differently can never break the install.
      var jobs = [ c.addAll(ASSETS).catch(function () {}) ];
      PAGES.forEach(function (u) {
        jobs.push(
          fetch(new Request(u, { redirect: 'follow' }))
            .then(function (res) { if (res && res.ok && !res.redirected) return c.put(u, res); })
            .catch(function () {})
        );
      });
      return Promise.all(jobs);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // HTML navigations: network-first so online visitors get fresh content,
  // falling back to the cached page (or home) when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        })
        .catch(function () {
          return caches.match(req).then(function (r) { return r || caches.match('./'); });
        })
    );
    return;
  }

  // Everything else (local assets + CDN fonts/scripts): stale-while-revalidate.
  e.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
