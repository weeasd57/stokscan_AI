import { Metadata } from "next";
import { ReactNode } from "react";

export const metadata: Metadata = {
  title: "أخبار البورصة المصرية وتحليل المشاعر بالذكاء الاصطناعي | EGX News & Sentiment",
  description: "تغطية مباشرة لأخبار شركات البورصة المصرية (EGX) مع تحليل المشاعر التلقائي (News Sentiment Analysis) بالذكاء الاصطناعي لتقييم أثر الأخبار على حركة الأسهم.",
  keywords: [
    "أخبار البورصة المصرية",
    "تحليل مشاعر الأخبار",
    "أخبار الأسهم المصرية اليوم",
    "EGX News",
    "Sentiment Analysis EGX",
    "البورصة المصرية",
    "EGX BOTS",
    "egxbots"
  ],
  alternates: {
    canonical: "https://egxbots.com/news",
  },
  openGraph: {
    title: "أخبار البورصة المصرية وتحليل المشاعر بالذكاء الاصطناعي | EGX BOTS",
    description: "تغطية فورية لأخبار الأسهم المصرية وتحليل مشاعر الأخبار وتأثيرها على الأسعار بالذكاء الاصطناعي.",
    type: "website",
    url: "https://egxbots.com/news",
    images: [
      {
        url: "https://egxbots.com/dashboard_preview.png",
        width: 1200,
        height: 630,
        alt: "EGX News & Sentiment Dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "EGX News & Sentiment Pulse | EGX BOTS",
    description: "AI-assisted coverage of EGX news and sentiment to surface market trends and event risks.",
    images: ["https://egxbots.com/dashboard_preview.png"],
  },
};

const newsSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": "https://egxbots.com/news#webpage",
      "name": "أخبار البورصة المصرية وتحليل المشاعر بالذكاء الاصطناعي",
      "description": "تغطية حية لأخبار شركات البورصة المصرية مع مؤشرات معنويات السوق اليومية.",
      "url": "https://egxbots.com/news",
      "breadcrumb": {
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
            "name": "الأخبار ومشاعر السوق",
            "item": "https://egxbots.com/news"
          }
        ]
      }
    }
  ]
};

export default function NewsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(newsSchema) }}
      />
      {children}
    </>
  );
}
