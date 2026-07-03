/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  i18n: {
    locales: ['en', 'ar'],
    defaultLocale: 'en',
    localeDetection: false,
  },
  async rewrites() {
    console.log("Using Python Path:", process.env.PYTHON_PATH || "Default System Python");
    // Rewrites must target the Python backend only — never the Next.js origin.
    let backendUrl =
      process.env.TRADING_SIGNALS_API_URL ||
      process.env.PYTHON_BACKEND_URL ||
      "http://127.0.0.1:8000";
    if (/localhost:3000|:3000\b/.test(backendUrl)) {
      console.warn(
        "[next.config] Ignoring backend URL pointing at Next.js dev server; using http://127.0.0.1:8000"
      );
      backendUrl = "http://127.0.0.1:8000";
    }
    console.log("Using Trading Signals Backend URL:", backendUrl);
    const BACKEND_URL = backendUrl.replace(/\/$/, "");
    return [
      // Bypass rewrites to keep backtests, scan alerts, and admin proxy routes local
      {
        source: '/api/backtests/:path*',
        destination: '/api/backtests/:path*',
      },
      {
        source: '/api/scan/alerts/:path*',
        destination: '/api/scan/alerts/:path*',
      },
      {
        source: '/api/admin/:path*',
        destination: '/api/admin/:path*',
      },
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/:path*`,
      },
      // Trading signals specific endpoints
      {
        source: '/signals/:path*',
        destination: `${BACKEND_URL}/signals/:path*`,
      },
      {
        source: '/markets/:path*',
        destination: `${BACKEND_URL}/markets/:path*`,
      },
      {
        source: '/alerts/:path*',
        destination: `${BACKEND_URL}/alerts/:path*`,
      },
      {
        source: '/strategies/:path*',
        destination: `${BACKEND_URL}/strategies/:path*`,
      },
      {
        source: '/backtest',
        destination: `${BACKEND_URL}/backtest`,
      },
      {
        source: '/backtests/:path*',
        destination: `${BACKEND_URL}/backtests/:path*`,
      },
      {
        source: '/docs',
        destination: `${BACKEND_URL}/docs`,
      },
      {
        source: '/openapi.json',
        destination: `${BACKEND_URL}/openapi.json`,
      },
      // Proxy specific top-level routes to backend
      {
        source: '/symbols/:path*',
        destination: `${BACKEND_URL}/symbols/:path*`,
      },
      {
        source: '/scan/:path*',
        destination: `${BACKEND_URL}/scan/:path*`,
      },
      {
        source: '/predict',
        destination: `${BACKEND_URL}/predict`,
      },
      {
        source: '/models/:path*',
        destination: `${BACKEND_URL}/models/:path*`,
      },
      {
        source: '/news',
        destination: `${BACKEND_URL}/news`,
      },
      {
        source: '/price',
        destination: `${BACKEND_URL}/price`,
      },
      {
        source: '/health',
        destination: `${BACKEND_URL}/health`,
      },
      {
        source: '/positions/:path*',
        destination: `${BACKEND_URL}/positions/:path*`,
      },
      {
        source: '/bot/:path*',
        destination: `${BACKEND_URL}/bot/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;