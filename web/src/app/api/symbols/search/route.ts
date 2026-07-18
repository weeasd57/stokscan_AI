import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const country = url.searchParams.get("country");
    const exchange = url.searchParams.get("exchange")?.toLowerCase();
    const limit = Math.min(Number(url.searchParams.get("limit") || 25), 100);

    const supabase = getSupabaseClient();
    
    // Fetch from market_cache based on country or fallback to all_symbols
    const cacheKey = country ? `symbols_${country}` : "all_symbols_by_country";
    const { data: cacheRow, error } = await supabase
      .from("market_cache")
      .select("payload")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    let allSymbols: Array<any> = [];

    if (!error && cacheRow?.payload && Array.isArray(cacheRow.payload)) {
      allSymbols = cacheRow.payload;
    } else {
      // Fallback: query directly from symbols table in Supabase
      console.warn(`Cache miss for ${cacheKey} — falling back to symbols table`);
      let symbolQuery = supabase
        .from("symbols")
        .select("symbol, exchange, name, country, type, currency")
        .eq("isListed", true)
        .limit(2000);

      if (country) symbolQuery = symbolQuery.eq("country", country);
      if (exchange) symbolQuery = symbolQuery.ilike("exchange", exchange);

      const { data: symbolRows, error: symErr } = await symbolQuery;
      if (!symErr && symbolRows) {
        allSymbols = symbolRows.map((s: any) => ({
          Symbol: s.symbol,
          Exchange: s.exchange,
          Name: s.name,
          Country: s.country,
          Type: s.type,
          Currency: s.currency,
        }));
      } else {
        console.error(`Failed to fetch symbols from cache key ${cacheKey}:`, error);
        return NextResponse.json({ results: [] });
      }
    }

    if (!Array.isArray(allSymbols)) {
      return NextResponse.json({ results: [] });
    }

    const results = [];
    for (const item of allSymbols) {
      const sym = String(item.Symbol || item.symbol || item.Code || "").toLowerCase();
      const name = String(item.Name || item.name || "").toLowerCase();
      const ex = String(item.Exchange || item.exchange || "").toLowerCase();
      const itemCountry = String(item.Country || item.country || country || "");

      // Apply exchange filter
      if (exchange && ex !== exchange) continue;

      // Apply query filter (matches symbol or name)
      if (!q || sym.includes(q) || name.includes(q)) {
        results.push({
          symbol: item.Symbol || item.symbol || item.Code || "",
          exchange: item.Exchange || item.exchange || "",
          name: item.Name || item.name || "",
          country: itemCountry,
          hasLocal: true,
        });

        if (results.length >= limit) {
          break;
        }
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Symbols search error:", err);
    return NextResponse.json({ results: [] });
  }
}
