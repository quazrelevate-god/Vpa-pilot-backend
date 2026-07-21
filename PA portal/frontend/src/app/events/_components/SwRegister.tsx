"use client";

import { useEffect } from "react";

// Registers the events service worker (cache-first shell, network-only for the
// /events/api/* calls). Scope is /events/ so it only ever controls this route
// group, never the rest of the PA portal.
export default function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/events/sw.js", { scope: "/events/" }).catch(() => {});
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
