"use client";

import { useEffect, useRef, useState } from "react";
import { Unauthorized } from "./api";

/**
 * Shared data hook for every Minister overview screen: fetch on mount, poll on
 * an interval, cancel in-flight on unmount, and on a 401 send the app back to
 * the login. Returns { data, err, loading, refresh }.
 */
export function useOverview<T>(
  fetcher: (signal?: AbortSignal) => Promise<T>,
  pollMs = 30_000,
) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Keep the latest fetcher without re-subscribing the interval each render.
  const fRef = useRef(fetcher);
  fRef.current = fetcher;

  useEffect(() => {
    const ac = new AbortController();
    let alive = true;

    const run = async () => {
      try {
        const d = await fRef.current(ac.signal);
        if (alive) { setData(d); setErr(null); setLoading(false); }
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof Unauthorized) {
          window.location.href = "/minister/login";
          return;
        }
        if (alive) { setErr((e as Error).message); setLoading(false); }
      }
    };

    run();
    const iv = setInterval(run, pollMs);
    return () => { alive = false; ac.abort(); clearInterval(iv); };
  }, [pollMs]);

  return { data, err, loading };
}
