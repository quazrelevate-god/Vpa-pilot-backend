import { NextRequest, NextResponse } from "next/server";

// Guard the dashboard pages: redirect to /login when the dash_session cookie
// is missing. The cookie is set by FastAPI (/dashboard/login) and proxied
// back to us by Next.js rewrites, so it sits on the same origin as the app.
const PROTECTED_PREFIXES = [
  "/overview", "/appointments", "/tickets",
  "/referrals", "/scheduling",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  const session = req.cookies.get("dash_session");

  // ── Department workspace: its own cookie (dept_session) + login page ──────────
  if (pathname.startsWith("/department")) {
    // API calls proxy straight to the backend, which enforces its own auth (401).
    // Never page-redirect them, or fetch() gets login HTML instead of JSON.
    if (pathname.startsWith("/department/api")) return NextResponse.next();
    const deptSession = req.cookies.get("dept_session");
    if (pathname === "/department/login") {
      if (deptSession) {
        const url = req.nextUrl.clone(); url.pathname = "/department"; return NextResponse.redirect(url);
      }
      return NextResponse.next();
    }
    if (deptSession) return NextResponse.next();
    // Unified sign-in lives at /login now.
    const url = req.nextUrl.clone(); url.pathname = "/login"; return NextResponse.redirect(url);
  }

  // ── Crowd Management PWA: its own cookie (display_session) + login page ────────
  if (pathname.startsWith("/crowd")) {
    // API calls proxy straight to the backend, which enforces its own auth (401).
    // Never page-redirect them, or fetch() gets login HTML instead of JSON.
    if (pathname.startsWith("/crowd/api")) return NextResponse.next();
    // PWA static assets (manifest.json, sw.js, icon-*.png) — anything with a
    // file extension under /crowd — must load without a session.
    if (/\.[a-z0-9]+$/i.test(pathname)) return NextResponse.next();
    const crowdSession = req.cookies.get("display_session");
    if (pathname === "/crowd/login") {
      if (crowdSession) {
        const url = req.nextUrl.clone(); url.pathname = "/crowd"; return NextResponse.redirect(url);
      }
      return NextResponse.next();
    }
    if (crowdSession) return NextResponse.next();
    const url = req.nextUrl.clone(); url.pathname = "/crowd/login"; return NextResponse.redirect(url);
  }

  // Already logged in → skip the login page, land on the right workspace.
  if (pathname === "/login") {
    if (session) {
      const url = req.nextUrl.clone();
      url.pathname = "/appointments";
      return NextResponse.redirect(url);
    }
    const deptSession = req.cookies.get("dept_session");
    if (deptSession) {
      const url = req.nextUrl.clone();
      url.pathname = "/department";
      return NextResponse.redirect(url);
    }
  }

  // /dashboard is a common guess — redirect to the actual appointments section
  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    const url = req.nextUrl.clone();
    url.pathname = session ? "/appointments" : "/login";
    return NextResponse.redirect(url);
  }

  if (!isProtected) return NextResponse.next();
  if (session) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/overview/:path*", "/appointments/:path*", "/tickets/:path*",
    "/referrals/:path*", "/scheduling/:path*",
    "/department", "/department/:path*",
    "/crowd", "/crowd/:path*",
    "/login", "/dashboard", "/dashboard/:path*",
  ],
};
