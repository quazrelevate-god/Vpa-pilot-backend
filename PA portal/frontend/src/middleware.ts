import { NextRequest, NextResponse } from "next/server";

// Guard the dashboard pages: redirect to /login when the dash_session cookie
// is missing. The cookie is set by FastAPI (/dashboard/login) and proxied
// back to us by Next.js rewrites, so it sits on the same origin as the app.
const PROTECTED_PREFIXES = [
  "/overview", "/appointments", "/tickets",
  "/referrals", "/scheduling", "/operations",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  const session = req.cookies.get("dash_session");

  // Already logged in → skip login page, go straight to appointments
  if (pathname === "/login" && session) {
    const url = req.nextUrl.clone();
    url.pathname = "/appointments";
    return NextResponse.redirect(url);
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
    "/referrals/:path*", "/scheduling/:path*", "/operations/:path*",
    "/login", "/dashboard", "/dashboard/:path*",
  ],
};
