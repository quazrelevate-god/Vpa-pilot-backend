import { NextRequest, NextResponse } from "next/server";

// Guard the dashboard pages: redirect to /login when the dash_session cookie
// is missing. The cookie is set by FastAPI (/dashboard/login) and proxied
// back to us by Next.js rewrites, so it sits on the same origin as the app.
const PROTECTED_PREFIXES = ["/overview", "/appointments", "/tickets", "/referrals"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const session = req.cookies.get("dash_session");
  if (session) return NextResponse.next();

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/overview/:path*", "/appointments/:path*", "/tickets/:path*", "/referrals/:path*"],
};
