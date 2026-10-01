import { NextRequest, NextResponse } from "next/server";
import { getPublicMarketClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The chart needs public market data, never the privileged admin proxy.
export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim().toUpperCase() || "";
  if (!/^[A-Z0-9_-]{1,24}(?:\.[A-Z0-9_-]{1,12})?$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }
  const [symbol, exchange] = ticker.split(".");
  try {
    let query = getPublicMarketClient().from("stock_fundamentals")
      .select("data, fund_score, updated_at").eq("symbol", symbol)
      .order("updated_at", { ascending: false }).limit(1);
    if (exchange) query = query.eq("exchange", exchange);
    const { data, error } = await query.maybeSingle();
    if (error) return NextResponse.json({ error: "Fundamentals unavailable" }, { status: 503 });
    return NextResponse.json({ data: data?.data || null }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch {
    return NextResponse.json({ error: "Fundamentals unavailable" }, { status: 503 });
  }
}
