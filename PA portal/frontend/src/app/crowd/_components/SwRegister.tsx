"use client";

import { useEffect } from "react";

// Registers the crowd service worker (cache-first shell, network-only for the
// PII-bearing /crowd/api/* + scheduling calls). Scope is /crowd/ so it only ever
// controls this route group, never the rest of the PA portal.
export default function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/crowd/sw.js", { scope: "/crowd/" }).catch(() => {});
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
