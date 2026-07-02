/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  i18n: {
    locales: ['en', 'ar'],
    defaultLocale: 'en',
    localeDetection: false,
  },
  async rewrites() {
    return [
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
        source: '/api/predict',
        destination: '/api/predict',
      },
      {
        source: '/api/scan/ai/:path*',
        destination: '/api/scan/ai/:path*',
      },
      {
        source: '/api/scan/technical',
        destination: '/api/scan/technical',
      },
      {
        source: '/api/symbols/by-date',
        destination: '/api/symbols/by-date',
      },
      {
        source: '/api/symbols/countries',
        destination: '/api/symbols/countries',
      },
      {
        source: '/api/scan/sectors/heatmap',
        destination: '/api/scan/sectors/heatmap',
      },
    ];
  },
};

module.exports = nextConfig;