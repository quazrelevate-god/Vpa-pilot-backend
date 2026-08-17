"use client";

// Small hook for CSS-matched media queries. Reads the initial state
// synchronously so the first render doesn't mismatch the actual layout —
// SSR falls back to `false` (safer default: assume the smaller-screen state
// so nothing is force-open on a phone before hydration).
import { useEffect, useState } from "react";

export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultValue;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Modern browsers: addEventListener; older Safari: addListener
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener(handler);
    // Sync once in case the query changed between initial state and effect.
    setMatches(mql.matches);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener(handler);
    };
  }, [query]);

  return matches;
}

/**
 * True at Tailwind's `xl` breakpoint (≥1280px). Use to gate default-open
 * state for right-rail filter panels — they stay hidden by default on
 * anything smaller than desktop so mobile/tablet reviewers see the list
 * first and can pop filters on demand.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1280px)");
}
