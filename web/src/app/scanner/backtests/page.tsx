import { Suspense } from "react";
import BacktestsClient from "./BacktestsClient";
import { Metadata } from "next";
import BrandedPageHeader from "@/components/BrandedPageHeader";
import Link from "next/link";

export const metadata: Metadata = {
  title: "تقييم الأسهم المصرية والتشابه التاريخي | AI Stock Research",
  description: "راجع ترتيب الأسهم المصرية بالذكاء الاصطناعي والحالات التاريخية المشابهة ونتائجها بعد 5 و10 و20 جلسة. استعرض حجم العينة وسجل التوصيات ونتائج الاختبارات التاريخية.",
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
      <Suspense fallback={
        <div className="backtests-shell app-page-shell mx-auto max-w-[1700px] w-full px-4 py-8 md:px-6 md:py-12 mt-2" dir="rtl">
          <BrandedPageHeader
            eyebrow="أبحاث أسهم البورصة المصرية"
            title="تقييم الأسهم المصرية والتشابه التاريخي"
            description="قارن الحالات التاريخية المشابهة ونتائجها بعد 5 و10 و20 جلسة، وراجع قوة العينة وسجل التوصيات ونتائج الاختبارات التاريخية."
          />
          <nav aria-label="أدوات أبحاث الأسهم" className="flex flex-wrap gap-4 text-sm font-semibold text-zinc-950 dark:text-white">
            <Link href="/stocks" className="underline">دليل أسهم البورصة المصرية</Link>
            <Link href="/scanner/technical" className="underline">الماسح الفني للأسهم</Link>
            <Link href="/scanner/market" className="underline">اتجاه السوق والسيولة</Link>
          </nav>
          <p role="status" className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">جاري تحميل أدوات التحليل…</p>
        </div>
      }>
        <BacktestsClient />
      </Suspense>
    </>
  );
}
