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
      { source: "/api/:path*", destination: `${API_BASE}/dashboard/api/:path*` },
      { source: "/auth/login", destination: `${API_BASE}/dashboard/login` },
      { source: "/auth/logout", destination: `${API_BASE}/dashboard/logout` },
      { source: "/static/:path*", destination: `${API_BASE}/static/:path*` },
    ];
  },
};

export default nextConfig;
