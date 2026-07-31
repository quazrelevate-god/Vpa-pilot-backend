/** @type {import('next').NextConfig} */

// Point this at the FastAPI backend. In production set NEXT_PUBLIC_API_BASE_URL.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  // Force correct MIME + max-scope headers on the service worker files. Some
  // upstreams (Railway edge / Cloudflare / Next.js dev overlay) have been
  // observed serving /events/sw.js as text/html — the browser then refuses
  // to register it as a SW ("service worker registration failed"), which
  // manifests downstream as navigator.serviceWorker.ready hanging forever.
  // Setting Content-Type here removes the ambiguity end-to-end. The
  // Service-Worker-Allowed header is defensive: it explicitly authorises
  // the scope we register with, so a future scope widening doesn't need a
  // second round of debugging.
  async headers() {
    return [
      {
        source: "/events/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/events/" },
          // Cache-Control none — the SW file itself must always be
          // network-fetched so a deploy actually rolls out a new SW.
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        source: "/crowd/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/crowd/" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
  // Same-origin proxy: frontend calls /api/* and /auth/* — Next.js forwards
  // them to FastAPI's /dashboard/* routes.  Keeps the auth cookie (dash_session)
  // in scope without any CORS plumbing.
  async rewrites() {
    return [
      { source: "/api/v1/scheduling/:path*", destination: `${API_BASE}/api/v1/scheduling/:path*` },
      { source: "/api/v1/referral/:path*", destination: `${API_BASE}/api/v1/referral/:path*` },
      { source: "/api/v1/admin/:path*", destination: `${API_BASE}/api/v1/admin/:path*` },
      { source: "/api/v1/me", destination: `${API_BASE}/api/v1/me` },
      { source: "/api/v1/features", destination: `${API_BASE}/api/v1/features` },
      { source: "/api/files/:path*", destination: `${API_BASE}/dashboard/api/files/:path*` },
      { source: "/api/:path*", destination: `${API_BASE}/dashboard/api/:path*` },
      // Department workspace API (its own auth cookie, separate from the PA portal).
      { source: "/department/api/:path*", destination: `${API_BASE}/department/api/:path*` },
      // Crowd Management PWA API (its own auth cookie: display_session).
      { source: "/crowd/api/:path*", destination: `${API_BASE}/crowd/api/:path*` },
      // Events (invitation calendar) PWA API (its own auth cookie: events_session).
      { source: "/events/api/:path*", destination: `${API_BASE}/events/api/:path*` },
      { source: "/auth/login", destination: `${API_BASE}/dashboard/login` },
      { source: "/auth/logout", destination: `${API_BASE}/dashboard/logout` },
      { source: "/static/:path*", destination: `${API_BASE}/static/:path*` },
    ];
  },
};

export default nextConfig;
