import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "FWRY";
  const backendBaseUrl =
    process.env.BACKEND_URL ||
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8000";

  try {
    const backendUrl = new URL("/market/macro-correlation/data", backendBaseUrl);
    backendUrl.searchParams.set("symbol", symbol);

    const res = await fetch(backendUrl.toString(), { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Backend macro-correlation fetch failed (${res.status})`);
    }

    const payload = await res.json();

    try {
      const supabase = getSupabaseClient();
      await supabase.from("market_cache").upsert(
        {
          cache_key: `macro_correlation_${symbol}`,
          country: "Egypt",
          payload,
          computed_at: new Date().toISOString(),
        },
        {
          onConflict: "cache_key,country",
        }
      );
    } catch (cacheError) {
      console.error("Macro-correlation cache backfill failed:", cacheError);
    }

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("Macro-correlation data error:", error);
    return NextResponse.json(
      {
        symbol,
        corr_usd_official: 0.0,
        corr_usd_parallel: 0.0,
        corr_gold: 0.0,
        rating: "Low Protection",
        chart_data: [],
        insights: error?.message || "Macro-correlation data is unavailable.",
      },
      { status: 200 }
    );
  }
}
