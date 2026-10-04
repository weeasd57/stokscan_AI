import ComparisonClient from "./ComparisonClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "مقارنة أداء أسهم البورصة المصرية | Stock Comparison Tool",
  description: "أداة مقارنة أسهم البورصة المصرية جنباً إلى جنب: مقارنة المؤشرات الفنية، العوائد التاريخية، أحجام التداول، وتقييمات الذكاء الاصطناعي لاختيار أفضل فرص الاستثمار.",
  keywords: [
    "مقارنة أسهم البورصة المصرية",
    "مقارنة الأسهم",
    "تحليل الأسهم المصرية بالذكاء الاصطناعي",
    "أفضل أسهم للاستثمار",
    "مقارنة الأداء المالي",
    "EGX BOTS",
    "egxbots"
  ],
  alternates: {
    canonical: "https://egxbots.com/scanner/comparison",
  },
  openGraph: {
    title: "مقارنة أداء أسهم البورصة المصرية | EGX BOTS",
    description: "قارن بين أسهم الشركات المصرية جنباً إلى جنب لاكتشاف أفضل الفرص بالذكاء الاصطناعي.",
    type: "website",
    url: "https://egxbots.com/scanner/comparison",
    images: [
      {
        url: "https://egxbots.com/dashboard_preview.png",
        width: 1200,
        height: 630,
        alt: "EGX Stock Comparison Tool",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stock Comparison Scanner | EGX BOTS",
    description: "Compare multiple Egyptian Stock Exchange symbols side-by-side with AI metrics.",
    images: ["https://egxbots.com/dashboard_preview.png"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://egxbots.com/scanner/comparison#tool",
      "name": "EGX Stock Comparison Tool",
      "alternateName": "أداة مقارنة الأسهم المصرية",
      "applicationCategory": "FinanceApplication",
      "operatingSystem": "Web",
      "description": "أداة تفاعلية لمقارنة الأسهم المصرية ومؤشراتها الفنية والكمية.",
      "url": "https://egxbots.com/scanner/comparison"
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
          "name": "مقارنة الأسهم",
          "item": "https://egxbots.com/scanner/comparison"
        }
      ]
    }
  ]
};

export default function ComparisonPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <ComparisonClient />
    </>
  );
}
