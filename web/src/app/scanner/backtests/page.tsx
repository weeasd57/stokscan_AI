import { Suspense } from "react";
import BacktestsClient from "./BacktestsClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "بوتات التداول الآلي وإشارات الذكاء الاصطناعي | AI Trading Bots",
  description: "سجل أداء وتداولات بوتات التداول الآلي ونماذج الذكاء الاصطناعي في البورصة المصرية: نسب الأرباح المحققة، دقة الإشارات، وتنبيهات تليجرام المباشرة.",
  keywords: [
    "بوتات التداول الآلي",
    "تداول آلي بالذكاء الاصطناعي",
    "بوت تحليل الاسهم",
    "إشارات البورصة المصرية",
    "تحليل الأسهم المصرية بالذكاء الاصطناعي",
    "توصيات البورصة المصرية",
    "EGX Trading Bots",
    "EGX BOTS",
    "egxbots"
  ],
  alternates: {
    canonical: "https://egxbots.com/scanner/backtests",
  },
  openGraph: {
    title: "اختبار استراتيجيات التداول والباك تيست | AI Backtests | EGX BOTS",
    description: "نتائج الاختبارات التاريخية (Backtests) ونسب النجاح لاستراتيجيات تداول الأسهم المصرية بالذكاء الاصطناعي.",
    type: "website",
    url: "https://egxbots.com/scanner/backtests",
    images: [
      {
        url: "https://egxbots.com/dashboard_preview.png",
        width: 1200,
        height: 630,
        alt: "EGX Bots Backtest Dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Trading Bots & Backtests | EGX BOTS",
    description: "Explore historical backtests, win rates, and simulation statistics for EGX AI trading tools.",
    images: ["https://egxbots.com/dashboard_preview.png"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://egxbots.com/scanner/backtests#app",
      "name": "EGX Bots Backtesting Engine",
      "alternateName": "محرك المحاكاة التاريخية للأسهم المصرية",
      "applicationCategory": "FinanceApplication",
      "operatingSystem": "Web",
      "description": "محرك محاكاة تاريخية واختبار استراتيجيات التداول الآلي لأسهم البورصة المصرية بنماذج الذكاء الاصطناعي.",
      "url": "https://egxbots.com/scanner/backtests"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        {
          "@type": "ListItem",
          "position": 1,
          "name": "الرئيسية",
          "item": "https://egxbots.com"
        },
        {
          "@type": "ListItem",
          "position": 2,
          "name": "المحاكاة التاريخية (Backtests)",
          "item": "https://egxbots.com/scanner/backtests"
        }
      ]
    }
  ]
};

export default function BacktestsPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Suspense fallback={null}>
        <BacktestsClient />
      </Suspense>
    </>
  );
}
