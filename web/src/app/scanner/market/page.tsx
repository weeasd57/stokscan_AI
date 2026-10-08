import MarketClient from "./MarketClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "تحليل سوق البورصة المصرية ومؤشر EGX30 | EGX Market Analysis",
  description: "تابع اتجاه البورصة المصرية ومؤشري EGX30 وEGX100، اتساع السوق وحركة السيولة وسعر الصرف وفق آخر تحديث بيانات محفوظ. راجع تاريخ التحديث وسياق توصيات الذكاء الاصطناعي.",
  keywords: [
    "تحليل البورصة المصرية",
    "مؤشر EGX30",
    "مؤشر EGX70",
    "السوق المصري",
    "تحليل الأسهم المصرية بالذكاء الاصطناعي",
    "سيولة البورصة المصرية",
    "توقعات البورصة المصرية",
    "EGX BOTS",
    "egxbots"
  ],
  alternates: {
    canonical: "https://egxbots.com/scanner/market",
  },
  openGraph: {
    title: "تحليل سوق البورصة المصرية ومؤشر EGX30 | EGX BOTS",
    description: "اتجاه السوق ومؤشرا EGX30 وEGX100 وحركة السيولة وفق آخر تحديث محفوظ، مع تاريخ البيانات وسياق التحليل.",
    type: "website",
    url: "https://egxbots.com/scanner/market",
    images: [
      {
        url: "https://egxbots.com/dashboard_preview.png",
        width: 1200,
        height: 630,
        alt: "EGX Market Analysis Dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "EGX Market Analysis & Economic Outlook | EGX BOTS",
    description: "EGX30 and EGX100 market direction, breadth and liquidity from the latest saved update, with the data timestamp.",
    images: ["https://egxbots.com/dashboard_preview.png"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://egxbots.com/scanner/market#webpage",
      "name": "تحليل سوق البورصة المصرية ومؤشر EGX30",
      "description": "تحليل مؤشري EGX30 وEGX100 واتجاه السوق والسيولة وفق آخر بيانات محفوظة.",
      "url": "https://egxbots.com/scanner/market"
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
          "name": "تحليل السوق ومؤشر EGX30",
          "item": "https://egxbots.com/scanner/market"
        }
      ]
    }
  ]
};

export default function MarketPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <MarketClient />
    </>
  );
}
