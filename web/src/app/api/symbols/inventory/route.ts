import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS, dailyCacheHeaders } from "@/lib/cache/daily";

export const runtime = "nodejs";
export const revalidate = 86400;
const headers = dailyCacheHeaders(DAILY_CACHE_TAGS.symbols);

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    
    // 1. Try to load precalculated inventory from market_cache
    try {
      const { data: cacheRow } = await supabase
        .from("market_cache")
        .select("payload")
        .eq("cache_key", "inventory")
        .maybeSingle();

      if (cacheRow?.payload && Array.isArray(cacheRow.payload)) {
        return NextResponse.json({
          inventory: cacheRow.payload,
        }, { headers });
      }
    } catch (cacheErr) {
      console.warn("Failed to load inventory from market_cache:", cacheErr);
    }

    // 2. Fallback to basic fundamentals aggregation
    const { data, error } = await supabase
      .from("stock_fundamentals")
      .select("symbol,exchange,data")
      .limit(1000);
    if (error) throw error;

    const fallbackInventory = (data || []).map((row: Record<string, any>) => {
      const rowData = row.data || {};
      return {
        exchange: row.exchange,
        symbol: row.symbol,
        price_count: 0,
        fund_count: 1,
        country: rowData.country || rowData.Country || "Unknown",
        expected_count: 0,
        priceCount: 0,
        fundCount: 1,
        expectedCount: 0,
        intradayCount: 0,
      };
    });

    return NextResponse.json({
      inventory: fallbackInventory,
    }, { headers });
  } catch (error) {
    console.error("symbols inventory route error:", error);
    return NextResponse.json({ error: "Inventory temporarily unavailable" }, { status: 503 });
  }
}
