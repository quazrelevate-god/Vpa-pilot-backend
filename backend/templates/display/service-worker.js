/* Crowd Board PWA service worker.
   Strategy:
     - App shell (the /display/ page + icons): cache-first so it opens instantly
       on slow/flaky internet.
     - API calls (/display/api/*): ALWAYS network, never cached. The responses
       contain decrypted citizen names + mobile numbers (PII); we deliberately
       do not persist them in Cache Storage. Offline simply shows the empty shell
       and the "offline" banner.
*/
const CACHE = "crowd-board-v4";
const SHELL = [
  "/display/",
  "/static/assets/icon-192.png",
  "/static/assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs; let writes (PATCH/POST) and cross-origin pass through.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // API: never cache PII — always go to the network (let it fail when offline).
  if (url.pathname.startsWith("/display/api/")) return;

  // Shell / assets: cache-first, then network.
  if (url.pathname.startsWith("/display") || url.pathname.startsWith("/static/assets")) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
});
