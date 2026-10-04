import { getPublicMarketClient } from "@/lib/supabase/route-data";
import { notFound } from "next/navigation";
import StockDetailClient from "./StockDetailClient";
import { Metadata } from "next";
import { cache } from "react";

interface PageProps {
  params: Promise<{
    symbol: string;
  }>;
}

// Metadata and page rendering share the same request-scoped fundamentals read.
const getFundamentals = cache(async (symbol: string) => {
  const supabase = getPublicMarketClient();
  const { data } = await supabase.from("stock_fundamentals").select("*").eq("symbol", symbol);
  return data as any[] | null;
});

// Generate dynamic metadata for SEO search indexers
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const symbol = (await params).symbol.toUpperCase();
  const fundData = await getFundamentals(symbol);

  const fundRow = fundData?.find((r: any) => r.exchange === "EGX") || fundData?.[0] || null;
  const fund = fundRow?.data || {};
  const companyName = fund.name || fund.Name || symbol;
  const sector = fund.sector || fund.Sector || "";

  const title = `تحليل وسعر سهم ${companyName} (${symbol}) بالذكاء الاصطناعي`;
  const description = `تحليل سهم ${companyName} (${symbol}) بالإغلاقات اليومية المسجلة، تقييم AI Score، ومؤشرات التحليل الفني في البورصة المصرية. راجع تاريخ البيانات الظاهر بالصفحة.`;

  return {
    title,
    description,
    keywords: [
      symbol,
      companyName,
      `تحليل سهم ${companyName}`,
      `سعر سهم ${companyName}`,
      `تحليل سهم ${symbol}`,
      `توقعات سهم ${symbol}`,
      "تحليل الأسهم المصرية بالذكاء الاصطناعي",
      "EGX BOTS",
      "egxbots",
      "البورصة المصرية",
      "EGX"
    ],
    alternates: {
      canonical: `https://egxbots.com/stocks/${symbol.toLowerCase()}`,
    },
    openGraph: {
      title,
      description,
      type: "website",
      url: `https://egxbots.com/stocks/${symbol.toLowerCase()}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function StockDetailPage({ params }: PageProps) {
  const symbol = (await params).symbol.toUpperCase();
  const supabase = getPublicMarketClient();

  // 1. Fetch Fundamentals
  const fundData = await getFundamentals(symbol);

  const fundRow = fundData?.find((r: any) => r.exchange === "EGX") || fundData?.[0] || null;

  // If no fundamentals, check if we have any price records to verify stock existence
  const priceCheck = fundRow ? null : (await supabase
    .from("stock_prices")
    .select("symbol, exchange")
    .eq("symbol", symbol)
    .limit(1)).data;

  // If no trace of this stock exists in fundamentals or prices, return 404
  if (!fundRow && (!priceCheck || priceCheck.length === 0)) {
    notFound();
  }

  const exchange = fundRow?.exchange || (priceCheck as any)?.[0]?.exchange || "EGX";

  // 2. Fetch Latest Price
  const { data: priceRows } = await supabase
    .from("stock_prices")
    .select("*")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .order("date", { ascending: false })
    .limit(1);
  const latestPrice = priceRows?.[0] || null;

  // 3. Fetch Latest Technical Indicators
  const { data: techRows } = await supabase
    .from("stock_technical_indicators")
    .select("*")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .order("date", { ascending: false })
    .limit(1);
  const latestTech = techRows?.[0] || null;

  // 4. Fetch 30-Day Historical Prices for Sparkline/Chart
  const { data: histRows } = await supabase
    .from("stock_prices")
    .select("date, open, high, low, close, volume")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .order("date", { ascending: false })
    .limit(30);

  const historicalPrices = histRows ? [...histRows].reverse() : [];

  // 5. Fetch Latest Scan Result (AI Score / Recommendation)
  const { data: scanRows } = await supabase
    .from("scan_results")
    .select("*")
    .eq("symbol", symbol)
    .eq("exchange", exchange)
    .order("created_at", { ascending: false })
    .limit(1);
  const latestScan = scanRows?.[0] || null;

  const fund = fundRow?.data || {};
  const companyName = fund.name || fund.Name || symbol;
  const priceDate = (latestPrice as any)?.date || (latestTech as any)?.date;
  // Describe the actual dataset, without inventing a second hidden buy/sell score.
  const structuredDataGraph = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `بيانات وتحليل سهم ${companyName} (${symbol})`,
    url: `https://egxbots.com/stocks/${symbol.toLowerCase()}`,
    ...(priceDate ? { dateModified: priceDate } : {}),
    description: "إغلاقات ومؤشرات يومية محفوظة؛ بيانات تعليمية وليست أسعارًا لحظية.",
    publisher: { "@type": "Organization", name: "EGX BOTS" }
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredDataGraph).replace(/</g, '\\u003c') }}
      />
      <StockDetailClient
        symbol={symbol}
        exchange={exchange}
        fundamentals={fundRow}
        latestPrice={latestPrice}
        latestTech={latestTech}
        historicalPrices={historicalPrices}
        latestScan={latestScan}
      />
    </>
  );
}
