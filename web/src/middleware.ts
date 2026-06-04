import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Clone the request headers and set the ngrok skip warning header
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('ngrok-skip-browser-warning', 'true')

  // Pass the updated headers to the rewritten request
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

export const config = {
  matcher: [
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
