/** @type {import('next').NextConfig} */

// Point this at the FastAPI backend. In production set NEXT_PUBLIC_API_BASE_URL.
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
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
      { source: "/auth/login", destination: `${API_BASE}/dashboard/login` },
      { source: "/auth/logout", destination: `${API_BASE}/dashboard/logout` },
      { source: "/static/:path*", destination: `${API_BASE}/static/:path*` },
    ];
  },
};

export default nextConfig;
