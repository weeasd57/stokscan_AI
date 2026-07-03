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
    keywords: [symbol, companyName, "EGX BOTS", "egxbots", "egx bots", "البورصة المصرية", "تحليل أسهم"],
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

  // Compute composite AI Score dynamically if DB has no AI Scanner result
  let computedAIScore = 50;
  if (latestScan && (latestScan as any).precision) {
    computedAIScore = Math.round(Number((latestScan as any).precision) * 100);
  } else if (latestTech) {
    let score = 50; // base
    const rsi = Number((latestTech as any).rsi_14);
    if (!isNaN(rsi)) {
      if (rsi < 30) score += 15;
      else if (rsi > 70) score -= 15;
      else if (rsi > 50) score += 5;
    }

    const macd = Number((latestTech as any).macd);
    const signal = Number((latestTech as any).macd_signal);
    if (!isNaN(macd) && !isNaN(signal)) {
      if (macd > signal) score += 15;
      else score -= 15;
    }

    const close = Number((latestTech as any).close);
    const ema50 = Number((latestTech as any).ema_50);
    const ema200 = Number((latestTech as any).ema_200);
    if (!isNaN(close)) {
      if (!isNaN(ema50)) {
        if (close > ema50) score += 10;
        else score -= 10;
      }
      if (!isNaN(ema200)) {
        if (close > ema200) score += 10;
        else score -= 10;
      }
    }

    const chg = Number((latestTech as any).change_pct);
    if (!isNaN(chg)) {
      if (chg > 0) score += 5;
      else score -= 5;
    }

    computedAIScore = Math.max(10, Math.min(95, score));
  }

  let rawSignal = "HOLD";
  if (latestScan && (latestScan as any).signal) {
    rawSignal = (latestScan as any).signal.toUpperCase();
  } else {
    if (computedAIScore >= 65) rawSignal = "BUY";
    else if (computedAIScore <= 40) rawSignal = "SELL";
  }

  let opinionArabic = "احتفاظ";
  if (rawSignal === "BUY" || rawSignal === "STRONG BUY") {
    opinionArabic = "شراء";
  } else if (rawSignal === "SELL" || rawSignal === "STRONG SELL") {
    opinionArabic = "بيع";
  }

  const fund = fundRow?.data || {};
  const companyName = fund.name || fund.Name || symbol;
  const sector = fund.sector || fund.Sector || "";
  const currentPrice = Number((latestPrice as any)?.close ?? (latestTech as any)?.close ?? 0);
  const priceDate = (latestPrice as any)?.date || (latestTech as any)?.date || new Date().toISOString();
  const description = `تحليل وتوصية سهم ${companyName} (${symbol}) بناءً على الذكاء الاصطناعي والمؤشرات الفنية في البورصة المصرية.`;

  const structuredDataGraph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "FinancialProduct",
        "@id": `https://egxbots.com/stocks/${symbol.toLowerCase()}#financial-product`,
        "name": companyName,
        "tickerSymbol": symbol,
        "exchange": exchange,
        "description": description,
        "brand": {
          "@type": "Brand",
          "name": "EGX Bots"
        },
        "offers": currentPrice > 0 ? {
          "@type": "Offer",
          "price": currentPrice.toFixed(2),
          "priceCurrency": "EGP",
          "priceValidUntil": new Date(new Date().setDate(new Date().getDate() + 1)).toISOString().split('T')[0]
        } : undefined
      },
      {
        "@type": "Dataset",
        "@id": `https://egxbots.com/stocks/${symbol.toLowerCase()}#dataset`,
        "name": `${companyName} (${symbol}) Stock Price & Indicators Dataset`,
        "description": `بيانات أسعار ومؤشرات فنية وتوصيات الذكاء الاصطناعي لسهم ${companyName} (${symbol}) في البورصة المصرية.`,
        "url": `https://egxbots.com/stocks/${symbol.toLowerCase()}`,
        "creator": {
          "@type": "Organization",
          "name": "EGX Bots"
        }
      },
      {
        "@type": "AnalysisNewsArticle",
        "@id": `https://egxbots.com/stocks/${symbol.toLowerCase()}#analysis`,
        "headline": `تحليل وتوصية ذكاء اصطناعي لسهم ${companyName} (${symbol}) | البورصة المصرية`,
        "description": description,
        "datePublished": (latestScan as any)?.created_at || priceDate,
        "dateModified": priceDate,
        "author": {
          "@type": "Organization",
          "name": "EGX Bots AI"
        },
        "publisher": {
          "@type": "Organization",
          "name": "EGX BOTS",
          "logo": {
            "@type": "ImageObject",
            "url": "https://egxbots.com/favicon_io/android-chrome-512x512.png"
          }
        },
        "opinion": opinionArabic,
        "about": {
          "@type": "FinancialProduct",
          "name": companyName,
          "tickerSymbol": symbol,
          "exchange": exchange
        }
      }
    ]
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredDataGraph) }}
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
