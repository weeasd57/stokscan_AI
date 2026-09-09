import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBackendBaseUrl() {
  return (
    process.env.PYTHON_BACKEND_URL ||
    process.env.TRADING_SIGNALS_API_URL ||
    process.env.BACKEND_URL ||
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8000"
  );
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const country = url.searchParams.get("country");
  const exchange = url.searchParams.get("exchange")?.toLowerCase();
  const limit = Math.min(Number(url.searchParams.get("limit") || 25), 100000);

  // 1. Prefer the Python backend. It honors source=local (local symbols
  //    inventory), the full limit (the admin Data Manager requests 100000),
  //    and performs its own multi-tier symbol resolution.
  try {
    const backendUrl = new URL("/symbols/search", getBackendBaseUrl());
    url.searchParams.forEach((value, key) => {
      backendUrl.searchParams.set(key, value);
    });

    const backendRes = await fetch(backendUrl.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (backendRes.ok) {
      const contentType = backendRes.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await backendRes.json();
        if (Array.isArray(data?.results)) {
          return NextResponse.json({ results: data.results });
        }
      }
    }
  } catch (error) {
    console.warn("Backend symbols search unavailable, falling back to Supabase:", error);
  }

  // 2. Fallback: direct Supabase lookups (case-insensitive).
  try {
    const supabase = getSupabaseClient();
    const removedExchanges = new Set(["binance", "crypto", "forex", "lse"]);

    // market_cache keys are stored with canonical casing (e.g. symbols_Egypt);
    // the incoming country may be any casing, so try the common variants.
    const cacheKeyCandidates = country
      ? [
          ...new Set([
            `symbols_${country}`,
            `symbols_${country.charAt(0).toUpperCase()}${country.slice(1)}`,
            `symbols_${country.toUpperCase()}`,
          ]),
        ]
      : ["all_symbols_by_country"];

    let allSymbols: Array<any> = [];
    for (const cacheKey of cacheKeyCandidates) {
      const { data: cacheRow, error } = await supabase
        .from("market_cache")
        .select("payload")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (!error && cacheRow?.payload && Array.isArray(cacheRow.payload)) {
        allSymbols = cacheRow.payload;
        break;
      }
    }

    if (allSymbols.length === 0) {
      // Fallback to the canonical stocks table (case-insensitive matches —
      // stocks.country stores "Egypt", requests may carry "egypt").
      console.warn(`Cache miss for ${cacheKeyCandidates.join(", ")} — falling back to stocks table`);
      let symbolQuery = supabase
        .from("stocks")
        .select("symbol, exchange, name, country")
        .eq("is_active", true)
        .limit(5000);

      if (country) symbolQuery = symbolQuery.ilike("country", country);
      if (exchange) symbolQuery = symbolQuery.ilike("exchange", exchange);

      const { data: symbolRows, error: symErr } = await symbolQuery;
      if (!symErr && symbolRows) {
        allSymbols = symbolRows.map((s: any) => ({
          Symbol: s.symbol,
          Exchange: s.exchange,
          Name: s.name,
          Country: s.country,
          Type: "Common Stock",
          Currency: "EGP",
        }));
      } else if (symErr) {
        console.error(`Failed to fetch symbols from stocks table:`, symErr);
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
      if (removedExchanges.has(ex)) continue;
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
