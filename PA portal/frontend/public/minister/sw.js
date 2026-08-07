/* Minister's Desk PWA service worker (Next.js hosted).
   The app is READ-ONLY, so this SW is intentionally lean — no push handlers.

   Strategy:
     - /minister/api/* and /api/* : ALWAYS network, never cached. These carry
       live aggregates + invitation photos (PII-adjacent) — never persisted.
     - navigations : ALWAYS network, never served from cache. A cached HTML
       shell pins the chunk hashes of the build that cached it; after a deploy
       those chunks are gone and the app dies with "undefined is not a
       function". Every screen here needs the network for its data anyway, so
       an offline shell buys nothing and costs correctness.
     - /_next/static/* : cache-first. Safe because Next content-hashes these —
       a changed file gets a new URL, so a hit is always the right bytes.
     - /minister/* static files (manifest, icons) : cache-first.

   Bump CACHE whenever this file changes: `activate` deletes every cache whose
   name doesn't match, which is what evicts a previous build's chunks.
*/
const CACHE = "minister-pwa-v2";
const SHELL = ["/minister/icon-192.png", "/minister/icon-512.png", "/minister/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Lets the page ask a waiting SW to take over immediately after a deploy.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Same-origin GETs only; let writes + cross-origin pass through untouched.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache API traffic (live aggregates + photos).
  if (url.pathname.startsWith("/minister/api/") || url.pathname.startsWith("/api/")) return;

  // Navigations: straight to the network, never cached. See the note above —
  // serving a stale shell is what breaks the app across a deploy.
  if (req.mode === "navigate") return;

  // Immutable, content-hashed build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // Other /minister static files (manifest, icons): cache-first.
  if (url.pathname.startsWith("/minister/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
  }
});
