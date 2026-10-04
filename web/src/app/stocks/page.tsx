import { Metadata } from "next";
import { getPublicMarketClient } from "@/lib/supabase/route-data";
import StocksClient from "./StocksClient";
import BrandedPageHeader from "@/components/BrandedPageHeader";

export const revalidate = 3600; // Cache for 1 hour

export const metadata: Metadata = {
  title: "دليل أسهم البورصة المصرية | جميع شركات EGX بالذكاء الاصطناعي",
  description: "دليل شامل ومحدث لجميع أسهم وشركات البورصة المصرية (EGX). استعرض تحليلات الأسهم، أسعار التداول المباشرة، تقييمات الذكاء الاصطناعي AI Score، والمؤشرات الفنية لكل شركة.",
  keywords: [
    "دليل أسهم البورصة المصرية",
    "قائمة شركات البورصة المصرية",
    "أسهم البورصة المصرية",
    "تحليل الأسهم المصرية بالذكاء الاصطناعي",
    "مؤشر EGX30",
    "مؤشر EGX70",
    "أسهم CIB وبلتون وطلعت مصطفى",
    "EGX Directory",
    "EGX BOTS",
    "egxbots"
  ],
  alternates: {
    canonical: "https://egxbots.com/stocks",
  },
  openGraph: {
    title: "دليل أسهم البورصة المصرية | EGX BOTS",
    description: "تصفح جميع أسهم وشركات البورصة المصرية مع تحليلات الذكاء الاصطناعي والمؤشرات الفنية المباشرة.",
    type: "website",
    url: "https://egxbots.com/stocks",
    images: [
      {
        url: "https://egxbots.com/dashboard_preview.png",
        width: 1200,
        height: 630,
        alt: "EGX Bots Stocks Directory",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Egyptian Exchange Stocks Directory | EGX BOTS",
    description: "Complete directory of EGX listed companies with AI scores and technical analysis.",
    images: ["https://egxbots.com/dashboard_preview.png"],
  },
};

async function getStocks() {
  try {
    const supabase = getPublicMarketClient();
    const { data, error } = await supabase
      .from("stock_fundamentals")
      .select("symbol, exchange, data")
      .eq("exchange", "EGX");

    if (error || !data) {
      console.error("Error fetching stocks list:", error);
      return [];
    }

    const uniqueMap = new Map<string, any>();
    data.forEach((row: any) => {
      const sym = (row.symbol || "").toUpperCase();
      if (!sym) return;
      if (!uniqueMap.has(sym)) {
        const d = row.data || {};
        uniqueMap.set(sym, {
          symbol: sym,
          name: d.name || d.Name || sym,
          sector: d.sector || d.Sector || "",
          marketCap: d.marketCap || null,
        });
      }
    });

    return Array.from(uniqueMap.values()).sort((a, b) =>
      a.symbol.localeCompare(b.symbol)
    );
  } catch (err) {
    console.error("Failed to load stocks:", err);
    return [];
  }
}

export default async function StocksPage() {
  const stocks = await getStocks();

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": "https://egxbots.com/stocks#webpage",
        "name": "دليل أسهم وشركات البورصة المصرية",
        "description": "قائمة كاملة لأسهم البورصة المصرية والتحليل الفني والذكاء الاصطناعي.",
        "url": "https://egxbots.com/stocks",
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
              "name": "دليل الأسهم",
              "item": "https://egxbots.com/stocks"
            }
          ]
        }
      },
      {
        "@type": "ItemList",
        "@id": "https://egxbots.com/stocks#itemlist",
        "name": "Egyptian Exchange (EGX) Listed Stocks",
        "numberOfItems": stocks.length,
        "itemListElement": stocks.slice(0, 100).map((s, idx) => ({
          "@type": "ListItem",
          "position": idx + 1,
          "name": `${s.name} (${s.symbol})`,
          "url": `https://egxbots.com/stocks/${s.symbol.toLowerCase()}`
        }))
      }
    ]
  };

  return (
    <div className="w-full pt-5 sm:pt-7">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <BrandedPageHeader
        eyebrow="دليل السوق والشركات | EGX DIRECTORY"
        title="دليل أسهم البورصة المصرية بالذكاء الاصطناعي"
        description="تصفح جميع الشركات والأسهم المقيدة في البورصة المصرية، واكتشف التقييمات الفنية ونماذج تعلم الآلة ومستويات السيولة لكل سهم."
      />
      <StocksClient initialStocks={stocks} />
    </div>
  );
}
