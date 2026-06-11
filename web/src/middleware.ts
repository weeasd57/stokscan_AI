import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(request: NextRequest) {
  // Clone headers and inject ngrok skip header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("ngrok-skip-browser-warning", "true");

  // ─── Inject Admin Key for backend admin API proxy calls ───────────────────
  // The Next.js rewrite forwards /api/admin/* → backend /admin/*.
  // We add X-Admin-Key server-side so the secret is never exposed to the browser.
  if (request.nextUrl.pathname.startsWith("/api/admin")) {
    const adminKey = process.env.ADMIN_SECRET_KEY;
    if (adminKey) {
      requestHeaders.set("x-admin-key", adminKey);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // ─── Admin Route: require login only (password gate handled client-side) ───
  if (request.nextUrl.pathname.startsWith("/admin")) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

    if (!url || !anonKey) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // No session → redirect to login
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Logged in → allow through (password gate handled on the page)
  }
  // ───────────────────────────────────────────────────────────────────────────

  return response;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/:path*",
    "/backtest",
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
