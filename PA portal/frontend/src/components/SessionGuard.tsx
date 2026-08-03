"use client";

import { useEffect } from "react";

/**
 * Global session guard for the PA dashboard.
 *
 * Problem it solves: the dashboard session cookie (`dash_session`) lasts 8h.
 * Once it expires, the backend's `require_auth` dependency answers API calls
 * with a 302 → /auth/login (see backend/src/core/dash_auth.py), NOT a 401.
 * `fetch()` follows that redirect automatically, so the caller receives a
 * *redirected 200* pointing at the login page — `resp.ok` is true and the
 * component then blows up on `resp.json()` with an opaque parse error. The UI
 * never learns the session died, so it never sends the user back to login.
 *
 * Fix: wrap `window.fetch` for the lifetime of the dashboard and treat any
 * dashboard API response that is either a 401 OR a redirect that landed on the
 * login page as "session expired" → hard-navigate to /login. This covers every
 * current and future call site without touching each fetch individually.
 *
 * Scoped to the dashboard only (mounted in DashboardProviders); the login page
 * lives outside this tree, so there is no redirect loop.
 */

// Module-level latch so a burst of simultaneously-failing calls only triggers
// one navigation.
let redirecting = false;

function isDashboardApi(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return false;
    return u.pathname.startsWith("/api/") || u.pathname.startsWith("/auth/");
  } catch {
    return false;
  }
}

function isAuthFailure(resp: Response): boolean {
  // A clean 401 (in case the backend is ever changed to return one).
  if (resp.status === 401) return true;
  // Expired session: 302 → /auth/login was followed by fetch, so the final URL
  // is the login route even though the status is 200.
  if (resp.redirected) {
    try {
      const path = new URL(resp.url).pathname;
      if (path === "/auth/login" || path.startsWith("/login")) return true;
    } catch {
      /* ignore malformed URL */
    }
  }
  return false;
}

function goToLogin(): void {
  if (redirecting) return;
  if (window.location.pathname.startsWith("/login")) return;
  redirecting = true;
  // Full navigation (not client-side) so all stale in-memory state is dropped.
  window.location.href = "/login";
}

export default function SessionGuard() {
  useEffect(() => {
    const original = window.fetch;

    window.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const resp = await original(...args);
      const input = args[0];
      const url = input instanceof Request ? input.url : String(input);
      if (isDashboardApi(url) && isAuthFailure(resp)) {
        goToLogin();
      }
      return resp;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  return null;
}
