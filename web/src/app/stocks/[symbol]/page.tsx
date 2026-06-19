import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import StockDetailClient from "./StockDetailClient";
import { Metadata } from "next";

interface PageProps {
  params: {
    symbol: string;
  };
}

// Generate dynamic metadata for SEO search indexers
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const symbol = params.symbol.toUpperCase();
  const supabase = createSupabaseServerClient();

  // Fetch fundamentals
  const { data: fundData } = (await supabase
    .from("stock_fundamentals")
    .select("data, exchange")
    .eq("symbol", symbol)) as any;

  const fundRow = fundData?.find((r: any) => r.exchange === "EGX") || fundData?.[0] || null;
  const fund = fundRow?.data || {};
  const companyName = fund.name || fund.Name || symbol;
  const sector = fund.sector || fund.Sector || "";

  const title = `${companyName} (${symbol}) Live Price & Technical Indicators | EGX Bots`;
  const description = `Live market price, technical indicators (RSI, MACD, ADX), support & resistance levels, and AI scanner analysis for ${companyName} (${symbol}) ${sector ? `in the ${sector} sector` : ""}. Open to all visitors.`;

  return {
    title,
    description,
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
  const symbol = params.symbol.toUpperCase();
  const supabase = createSupabaseServerClient();

  // 1. Fetch Fundamentals
  const { data: fundData } = (await supabase
    .from("stock_fundamentals")
    .select("*")
    .eq("symbol", symbol)) as any;

  const fundRow = fundData?.find((r: any) => r.exchange === "EGX") || fundData?.[0] || null;

  // If no fundamentals, check if we have any price records to verify stock existence
  const { data: priceCheck } = await supabase
    .from("stock_prices")
    .select("symbol, exchange")
    .eq("symbol", symbol)
    .limit(1);

  // If no trace of this stock exists in fundamentals or prices, return 404
  if (!fundRow && (!priceCheck || priceCheck.length === 0)) {
    notFound();
  }

  const exchange = fundRow?.exchange || priceCheck?.[0]?.exchange || "EGX";

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

  return (
    <StockDetailClient
      symbol={symbol}
      exchange={exchange}
      fundamentals={fundRow}
      latestPrice={latestPrice}
      latestTech={latestTech}
      historicalPrices={historicalPrices}
      latestScan={latestScan}
    />
  );
}
