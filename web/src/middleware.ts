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

// The ngrok-skip-browser-warning header is injected client-side by the global
// fetch wrapper in src/app/providers.tsx for every relative request, so the
// middleware no longer needs to run on all API traffic. Keeping the matcher
// narrow avoids paying edge middleware execution on every request.
export const config = {
  matcher: [
    "/api/admin/:path*",
    "/ar/:path*",
    "/en/:path*",
  ],
};
