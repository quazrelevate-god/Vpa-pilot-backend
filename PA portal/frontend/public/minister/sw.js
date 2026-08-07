/* Minister's Desk PWA service worker (Next.js hosted).
   The app is READ-ONLY, so this SW is intentionally lean — no push handlers.
   Strategy:
     - /minister/api/* and /api/* : ALWAYS network, never cached. These carry
       live aggregates + invitation photos (PII-adjacent) — never persisted.
     - /_next/static/* : cache-first (hashed, immutable build assets).
     - /minister navigations : network-first, fall back to the cached shell so
       a deploy never leaves the app on chunk hashes it can't load.
     - /minister/* static files (manifest, icons) : cache-first.
*/
const CACHE = "minister-pwa-v1";
const SHELL = ["/minister", "/minister/icon-192.png", "/minister/icon-512.png", "/minister/manifest.json"];

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

  // Never cache API traffic (live aggregates + photos).
  if (url.pathname.startsWith("/minister/api/") || url.pathname.startsWith("/api/")) return;

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
  if (req.mode === "navigate" && url.pathname.startsWith("/minister")) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/minister", copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("/minister")))
    );
    return;
  }

  // Other /minister static files (manifest, icons): cache-first.
  if (url.pathname.startsWith("/minister/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
});
