"use client";

import { useEffect } from "react";

/**
 * Keeps the Minister PWA in landscape — the app is built for a tablet held
 * sideways (6-across KPI grid, side-by-side charts, wide tables).
 *
 * The manifest's `"orientation": "landscape"` is what the OS honours when the
 * app is installed; this is the runtime belt-and-braces for browsers that
 * support the Screen Orientation API (Chrome/Edge on Android, installed PWAs).
 * It is a no-op — never an error — where locking isn't permitted (iOS Safari,
 * desktop browsers, or a plain browser tab), so the app still works there; it
 * simply stays responsive as before.
 */
export default function OrientationLock() {
  useEffect(() => {
    const orientation = window.screen?.orientation as
      | (ScreenOrientation & { lock?: (o: string) => Promise<void> })
      | undefined;
    if (!orientation?.lock) return;

    let cancelled = false;
    const lock = () => {
      // Rejects with NotSupportedError / SecurityError outside an installed
      // (standalone/fullscreen) context — expected, and safely ignored.
      orientation.lock!("landscape").catch(() => {});
    };

    lock();
    // Re-assert if the OS hands orientation back (e.g. after a system rotation
    // prompt or when the app is resumed from the background).
    const onChange = () => { if (!cancelled) lock(); };
    orientation.addEventListener?.("change", onChange);
    document.addEventListener("visibilitychange", onChange);

    return () => {
      cancelled = true;
      orientation.removeEventListener?.("change", onChange);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, []);

  return null;
}
