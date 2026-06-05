import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const ADMIN_EMAIL = 'weeeessd57@gmail.com'

export async function middleware(request: NextRequest) {
  // Clone headers and inject ngrok skip header
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('ngrok-skip-browser-warning', 'true')

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  // ─── Admin Route Protection ────────────────────────────────────────────────
  if (request.nextUrl.pathname.startsWith('/admin')) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY

    // If Supabase env vars are missing, block access
    if (!url || !anonKey) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set() {},
        remove() {},
      },
    })

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // No session → redirect to login
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', request.nextUrl.pathname)
      return NextResponse.redirect(loginUrl)
    }

    // Logged in but NOT admin → redirect to scanner
    const isAdmin =
      user.app_metadata?.role === 'admin' ||
      user.email?.toLowerCase() === ADMIN_EMAIL

    if (!isAdmin) {
      return NextResponse.redirect(new URL('/scanner/technical', request.url))
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  return response
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/api/:path*',
    '/backtest',
    '/backtests/:path*',
    '/symbols/:path*',
    '/scan/:path*',
    '/predict',
    '/models/:path*',
    '/news',
    '/price',
    '/health',
    '/positions/:path*',
    '/bot/:path*',
  ],
}
