import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Clone headers and inject ngrok skip header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("ngrok-skip-browser-warning", "true");

  const pathParts = request.nextUrl.pathname.split("/");
  const localePrefix = pathParts[1];
  if ((localePrefix === "ar" || localePrefix === "en") && !request.nextUrl.pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = `/${pathParts.slice(2).join("/")}` || "/";
    return NextResponse.redirect(url);
  }

  // ─── Inject Admin Key for backend admin API proxy calls (Secured) ─────────
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    const adminKey = process.env.ADMIN_SECRET_KEY;
    if (adminKey) {
      requestHeaders.set("x-admin-key", adminKey);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/ar/:path*",
    "/en/:path*",
    "/api/:path*",
    "/backtests/:path*",
    "/symbols/:path*",
    "/scan/:path*",
    "/predict",
    "/models/:path*",
    "/news",
    "/price",
    "/health",
    "/positions/:path*",
    "/bot/:path*",
  ],
};
