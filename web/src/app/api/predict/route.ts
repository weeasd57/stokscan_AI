import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeExchange(value?: string | null) {
  const exchange = String(value || "EGX").trim().toUpperCase();
  return exchange || "EGX";
}

function coerceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const ticker = String(body?.ticker || body?.symbol || "").trim().toUpperCase();
    const exchange = normalizeExchange(body?.exchange);

    if (!ticker) {
      return NextResponse.json({ detail: "Ticker is required" }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const [priceRes, fundamentalsRes, scanRes] = await Promise.all([
      supabase.from("stock_prices").select("date,close,open,high,low,volume").eq("symbol", ticker).eq("exchange", exchange).order("date", { ascending: false }).limit(20),
      supabase.from("stock_fundamentals").select("symbol,exchange,data").eq("symbol", ticker).eq("exchange", exchange).order("created_at", { ascending: false }).limit(1),
      supabase.from("scan_results").select("symbol,exchange,name,last_close,precision,signal,top_reasons,council_score,consensus_ratio").eq("symbol", ticker).eq("exchange", exchange).order("updated_at", { ascending: false }).limit(1),
    ]);

    const latestPrice = priceRes.data?.[0] as Record<string, unknown> | undefined;
    const fundamentalsRow = fundamentalsRes.data?.[0] as Record<string, unknown> | undefined;
    const scanRow = scanRes.data?.[0] as Record<string, unknown> | undefined;
    const fundamentalsData = coerceRecord(fundamentalsRow?.data);
    const precision = toNumber(scanRow?.precision, toNumber(body?.buy_threshold, 0.55));
    const tomorrowPrediction = precision >= 0.5 ? 1 : 0;
    const signal = String(scanRow?.signal || (tomorrowPrediction ? "BUY" : "HOLD")).toUpperCase();

    return NextResponse.json({
      ticker,
      precision,
      tomorrowPrediction: tomorrowPrediction as 0 | 1,
      signal,
      lastClose: toNumber(latestPrice?.close, toNumber(scanRow?.last_close, 0)),
      lastDate: String(latestPrice?.date || ""),
      fundamentals: {
        marketCap: toNumber(fundamentalsData.marketCap, 0),
        peRatio: toNumber(fundamentalsData.peRatio, 0),
        eps: toNumber(fundamentalsData.eps, 0),
        sector: String(fundamentalsData.sector || fundamentalsData.Sector || ""),
        beta: toNumber(fundamentalsData.beta, 0),
        dividendYield: toNumber(fundamentalsData.dividendYield, 0),
        high52: toNumber(fundamentalsData.high52, 0),
        low52: toNumber(fundamentalsData.low52, 0),
        name: String(fundamentalsData.name || fundamentalsData.Name || scanRow?.name || ticker),
        logoUrl: String(fundamentalsData.logoUrl || fundamentalsData.logo_url || ""),
      },
      testPredictions: [],
      executionTime: 0,
      topReasons: Array.isArray(scanRow?.top_reasons) ? scanRow.top_reasons : [],
      councilScore: toNumber(scanRow?.council_score, 0),
      consensusRatio: String(scanRow?.consensus_ratio || ""),
      ai_score: precision * 100,
      fundamental_score: precision * 100,
      technical_score: precision * 100,
      sentiment_score: precision * 100,
    });
  } catch (error) {
    console.error("Predict route error:", error);
    return NextResponse.json({ detail: "Prediction data unavailable" }, { status: 502 });
  }
}
