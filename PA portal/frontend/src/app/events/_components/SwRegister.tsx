"use client";

import { useEffect } from "react";

// Registers the events service worker (cache-first shell, network-only for the
// /events/api/* calls). Scope is `/events` (NO trailing slash) so it controls
// both `/events` (the PWA start URL) AND `/events/anything`. iOS follows the
// SW spec strictly — a scope of `/events/` (with slash) would NOT control the
// bare `/events` page that iOS launches from the home-screen icon, and
// navigator.serviceWorker.ready would hang forever on that device.
//
// Registration failures now surface via console.error instead of the previous
// silent .catch. Without that, an iOS-specific failure (bad MIME, wrong
// scope, HTTPS issue) leaves the reviewer stuck with a hanging subscribe
// step and no clue what broke.
export default function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/events/sw.js", { scope: "/events" })
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
