"use client";

import { useEffect } from "react";

/** Client-side Sentry init. No-op unless NEXT_PUBLIC_SENTRY_DSN is set. */
export default function SentryInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return;
    import("@sentry/nextjs").then((Sentry) =>
      Sentry.init({ dsn, tracesSampleRate: 0.1, replaysSessionSampleRate: 0 })
    ).catch(() => {});
  }, []);
  return null;
}
