import TechnicalScannerLoader from "./TechnicalScannerLoader";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "الماسح الفني للأسهم المصرية | Technical Stock Screener",
  description: "ماسح فني مباشر لأسهم البورصة المصرية (EGX Screener): فحص مؤشرات RSI، MACD، التقاطع الذهبي للمتوسطات المتحركة EMA، أحجام التداول، ومستويات الدعم والمقاومة.",
  keywords: [
    "الماسح الفني للأسهم المصرية",
    "فحص فني للأسهم",
    "مؤشر RSI",
    "مؤشر MACD",
    "التقاطع الذهبي",
    "دعم ومقاومة",
    "البورصة المصرية",
    "تحليل فني مباشر",
    "EGX Screener",
    "EGX BOTS",
    "egxbots"
  ],
  alternates: {
    canonical: "https://egxbots.com/scanner/technical",
  },
  openGraph: {
    title: "الماسح الفني للأسهم المصرية | Technical Screener | EGX BOTS",
    description: "ماسح فني مباشر لأسهم البورصة المصرية: مؤشرات RSI، MACD، المتوسطات المتحركة والسيولة.",
    type: "website",
    url: "https://egxbots.com/scanner/technical",
    images: [
      {
        url: "https://egxbots.com/dashboard_preview.png",
        width: 1200,
        height: 630,
        alt: "EGX Technical Scanner",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Technical Stock Screener | EGX BOTS",
    description: "Screen Egyptian Exchange stocks with RSI, MACD, EMA crossover, VWAP, and volume filters.",
    images: ["https://egxbots.com/dashboard_preview.png"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://egxbots.com/scanner/technical#tool",
      "name": "EGX Technical Screener",
      "alternateName": "الماسح الفني للبورصة المصرية",
      "applicationCategory": "FinanceApplication",
      "operatingSystem": "Web",
      "description": "ماسح فني فوري لأسهم البورصة المصرية يعتمد على مؤشرات التحليل الفني الكلاسيكية والكمية.",
      "url": "https://egxbots.com/scanner/technical"
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
          "name": "الماسح الفني",
          "item": "https://egxbots.com/scanner/technical"
        }
      ]
    }
  ]
};

export default function TechnicalScannerPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <TechnicalScannerLoader />
    </>
  );
}
