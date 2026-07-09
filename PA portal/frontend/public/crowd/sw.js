/* Crowd Management PWA service worker (Next.js hosted).
   Strategy:
     - /crowd/api/* and /api/* : ALWAYS network, never cached. These responses
       carry decrypted citizen names + mobile numbers (PII) — we deliberately
       never persist them in Cache Storage.
     - /_next/static/* : cache-first. Hashed, immutable build assets.
     - /crowd navigations : network-first, fall back to the last cached page
       (so a deploy never leaves the app pointing at chunk hashes it can't load).
     - /crowd/* static files (manifest, icons) : cache-first.
*/
const CACHE = "crowd-pwa-v2";
const SHELL = ["/crowd", "/crowd/icon-192.png", "/crowd/icon-512.png", "/crowd/manifest.json"];

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

  // Never cache PII-bearing API traffic.
  if (url.pathname.startsWith("/crowd/api/") || url.pathname.startsWith("/api/")) return;

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
  if (req.mode === "navigate" && url.pathname.startsWith("/crowd")) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/crowd", copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("/crowd")))
    );
    return;
  }

  // Other /crowd static files (manifest, icons): cache-first.
  if (url.pathname.startsWith("/crowd/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
});
