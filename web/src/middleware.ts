import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

async function getUserWithTimeout(supabase: any, timeoutMs = 4500) {
  try {
    const timeoutPromise = new Promise<{ data: { user: null }; error: any }>((resolve) =>
      setTimeout(() => resolve({ data: { user: null }, error: new Error("Auth timeout") }), timeoutMs)
    );
    return await Promise.race([supabase.auth.getUser(), timeoutPromise]);
  } catch (err) {
    return { data: { user: null }, error: err };
  }
}

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
  if (request.nextUrl.pathname.startsWith("/api/admin") && !request.nextUrl.pathname.startsWith("/api/admin-unlock")) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

    if (!url || !anonKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (url && anonKey) {
      const supabase = createServerClient(url, anonKey, {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value;
          },
          set() {},
          remove() {},
        },
      });

      try {
        const {
          data: { user },
        } = await getUserWithTimeout(supabase, 4500);

        if (user) {
          const adminKey = process.env.ADMIN_SECRET_KEY;
          if (adminKey) {
            requestHeaders.set("x-admin-key", adminKey);
          }
        } else {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
      } catch (err) {
        console.error("Middleware auth check failed for /api/admin:", err);
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
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
    } = await getUserWithTimeout(supabase, 4500);

    // No session → redirect to login
    if (!user) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  return response;
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
