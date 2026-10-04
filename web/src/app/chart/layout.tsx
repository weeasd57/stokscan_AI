import { Metadata } from "next";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "الرسم البياني والشارت المباشر للأسهم المصرية | Live EGX Charts",
  description: "شارت ورسم بياني تفاعلي متقدم لأسهم البورصة المصرية (EGX) مدعوم بـ TradingView مع مؤشرات الذكاء الاصطناعي وإشارات التداول وتاريخ التوصيات.",
  keywords: [
    "شارت البورصة المصرية",
    "رسم بياني للأسهم المصرية",
    "TradingView EGX",
    "تحليل فني شارت",
    "مؤشرات فنية مباشرة",
    "EGX BOTS",
    "egxbots"
  ],
  alternates: {
    canonical: "https://egxbots.com/chart",
  },
  openGraph: {
    title: "الرسم البياني والشارت المباشر للأسهم المصرية | EGX BOTS",
    description: "شارت تفاعلي متقدم لأسهم البورصة المصرية مع مؤشرات الذكاء الاصطناعي وإشارات التداول.",
    type: "website",
    url: "https://egxbots.com/chart",
    images: [
      {
        url: "https://egxbots.com/dashboard_preview.png",
        width: 1200,
        height: 630,
        alt: "EGX Live Chart",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Live EGX Stock Charts | EGX BOTS",
    description: "Interactive TradingView chart with AI recommendation history for the Egyptian Exchange.",
    images: ["https://egxbots.com/dashboard_preview.png"],
  },
};

const chartSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://egxbots.com/chart#app",
      "name": "EGX Interactive Charting Tool",
      "alternateName": "شارت البورصة المصرية المباشر",
      "applicationCategory": "FinanceApplication",
      "operatingSystem": "Web",
      "description": "شارت تفاعلي مباشر لأسهم البورصة المصرية مدعوم بمؤشرات الذكاء الاصطناعي وإشارات التداول الفنية.",
      "url": "https://egxbots.com/chart"
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
          "name": "الرسم البياني المباشر",
          "item": "https://egxbots.com/chart"
        }
      ]
    }
  ]
};

export default function ChartLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(chartSchema) }}
      />
      {children}
    </>
  );
}
