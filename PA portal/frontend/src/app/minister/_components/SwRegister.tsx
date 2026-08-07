"use client";

import { useEffect } from "react";

// Registers the Minister PWA service worker (scope /minister/). The
// Service-Worker-Allowed header is set for /minister/sw.js in next.config so
// the scope is authorised. Failures surface via console.error rather than a
// silent .catch, so an iOS-specific registration issue is debuggable.
export default function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/minister/sw.js", { scope: "/minister/" })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[minister] SW registration failed:", err);
        });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
