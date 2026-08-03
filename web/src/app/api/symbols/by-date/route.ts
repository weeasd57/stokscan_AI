import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const start = incomingUrl.searchParams.get("start");
  const end = incomingUrl.searchParams.get("end");
  const exchange = incomingUrl.searchParams.get("exchange");
  const limit = Math.min(parseInt(incomingUrl.searchParams.get("limit") || "50"), 500);
  const searchTerm = incomingUrl.searchParams.get("search_term");

  if (exchange && ["BINANCE", "CRYPTO", "FOREX", "LSE"].includes(exchange.toUpperCase())) {
    return NextResponse.json({ results: [], error: "Market removed" }, { status: 410 });
  }

  try {
    const supabase = getSupabaseClient();

    // 1. Get all symbols with latest price dates from stock_prices
    //    Filtered by optional exchange and date range
    let priceQuery = supabase
      .from("stock_prices")
      .select("symbol, exchange, date")
      .order("date", { ascending: false });

    if (exchange) {
      priceQuery = priceQuery.eq("exchange", exchange.toUpperCase());
    }
    if (start) {
      priceQuery = priceQuery.gte("date", start);
    }
    if (end) {
      priceQuery = priceQuery.lte("date", end);
    }

    const { data: priceRows, error: priceErr } = await priceQuery.limit(limit * 10);

    if (priceErr) {
      console.error("by-date price query error:", priceErr);
      return NextResponse.json({ results: [] });
    }

    // Deduplicate — keep only one (most recent) row per symbol
    const seen = new Map<string, { symbol: string; exchange: string; date: string; rowCount: number }>();
    for (const row of (priceRows || [])) {
      const key = `${row.symbol}|${row.exchange}`;
      if (!seen.has(key)) {
        seen.set(key, {
          symbol: row.symbol,
          exchange: row.exchange,
          date: row.date,
          rowCount: 1,
        });
      } else {
        seen.get(key)!.rowCount++;
      }
    }

    // 2. Optionally get names from stock_fundamentals
    const uniqueExchanges = [...new Set((priceRows || []).map((r: any) => r.exchange))];
    let fundMap: Record<string, string> = {};
    try {
      let fundQuery = supabase
        .from("stock_fundamentals")
        .select("symbol, exchange, data");
      if (exchange) {
        fundQuery = fundQuery.eq("exchange", exchange.toUpperCase());
      }
      const { data: fundRows } = await fundQuery.limit(5000);
      for (const row of (fundRows || [])) {
        const key = `${row.symbol}|${row.exchange}`;
        const rowData = row.data || {};
        fundMap[key] = rowData.name || rowData.Name || "";
      }
    } catch {
      // name lookup is optional
    }

    // 3. Apply optional search term filter and build result
    let results = Array.from(seen.values()).map((entry) => ({
      symbol: entry.symbol,
      exchange: entry.exchange,
      name: fundMap[`${entry.symbol}|${entry.exchange}`] || "",
      rowCount: entry.rowCount,
      lastDate: entry.date,
    }));

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      results = results.filter(
        (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
      );
    }

    return NextResponse.json({ results: results.slice(0, limit) });
  } catch (error) {
    console.error("by-date API error:", error);
    return NextResponse.json({ results: [] });
  }
}
