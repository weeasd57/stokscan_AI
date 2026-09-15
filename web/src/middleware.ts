import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
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
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-admin-key", adminKey);
      return NextResponse.next({
        request: { headers: requestHeaders },
      });
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  return NextResponse.next();
}

// All redirects (/ar/*, /en/*) are now handled at zero CPU cost by next.config.js redirects.
// The x-admin-key header is already injected server-side by /api/admin/[...path]/route.ts.
// Keeping the matcher empty avoids paying Edge Middleware execution on any request.
export const config = {
  matcher: [],
};
