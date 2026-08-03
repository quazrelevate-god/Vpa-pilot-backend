"use client";

import { useEffect } from "react";

// Registers the events service worker (cache-first shell, network-only for the
// /events/api/* calls). Scope is `/events/` — the maximum default scope for a
// SW file at /events/sw.js. A wider scope (like `/events` without the slash)
// would require a Service-Worker-Allowed HTTP header, which Next.js doesn't
// set for /public files — the browser silently rejects the registration.
//
// The trailing slash on scope means the SW does NOT control the bare `/events`
// URL, only `/events/` and below. The manifest's start_url is `/events/` for
// exactly this reason — iOS launches the PWA at a URL that's under scope so
// navigator.serviceWorker.ready resolves. Loading `/events` without slash in
// a normal tab won't have SW control, but that's not a supported launch path.
//
// Registration failures now surface via console.error instead of the previous
// silent .catch. Without that, any iOS-specific failure (bad MIME, HTTPS
// issue, cross-origin, quota) leaves the reviewer stuck with no clue.
export default function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/events/sw.js", { scope: "/events/" })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[events] SW registration failed:", err);
        });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
