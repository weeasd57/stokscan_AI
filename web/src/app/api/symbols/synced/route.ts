import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const country = url.searchParams.get("country");

    if (!country) {
      return NextResponse.json({ results: [] });
    }

    const supabase = getSupabaseClient();
    const cacheKey = `symbols_${country}`;
    const { data: cacheRow, error } = await supabase
      .from("market_cache")
      .select("payload")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    if (error || !cacheRow?.payload) {
      console.error(`Failed to fetch synced symbols from cache key ${cacheKey}:`, error);
      return NextResponse.json({ results: [] });
    }

    const allSymbols = cacheRow.payload as Array<any>;
    if (!Array.isArray(allSymbols)) {
      return NextResponse.json({ results: [] });
    }

    // Map to consistent format expected by UI
    const results = allSymbols.map((item) => ({
      symbol: item.Symbol || item.symbol || item.Code || "",
      exchange: item.Exchange || item.exchange || "",
      name: item.Name || item.name || "",
      country: item.Country || item.country || country,
      hasLocal: true,
    }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Symbols synced error:", err);
    return NextResponse.json({ results: [] });
  }
}
