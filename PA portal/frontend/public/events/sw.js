/* Events Calendar PWA service worker (Next.js hosted).
   Strategy:
     - /events/api/* and /api/* : ALWAYS network, never cached. These responses
       carry event details + invitation photos (PII-adjacent) — we deliberately
       never persist them in Cache Storage. Repeat photo views are served by the
       browser HTTP cache via the backend's ETag/immutable headers instead.
     - /_next/static/* : cache-first. Hashed, immutable build assets.
     - /events navigations : network-first, fall back to the last cached page
       (so a deploy never leaves the app pointing at chunk hashes it can't load).
     - /events/* static files (manifest, icons) : cache-first.
*/
const CACHE = "events-pwa-v1";
const SHELL = ["/events", "/events/icon-192.png", "/events/icon-512.png", "/events/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Same-origin GETs only; let writes + cross-origin pass through untouched.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache API traffic (event data + photos).
  if (url.pathname.startsWith("/events/api/") || url.pathname.startsWith("/api/")) return;

  // Immutable build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // App navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === "navigate" && url.pathname.startsWith("/events")) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/events", copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("/events")))
    );
    return;
  }

  // Other /events static files (manifest, icons): cache-first.
  if (url.pathname.startsWith("/events/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
});
