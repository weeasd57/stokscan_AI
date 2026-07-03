import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "FWRY";

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("market_cache")
      .select("payload, computed_at")
      .eq("cache_key", `macro_correlation_${symbol}`)
      .eq("country", "Egypt")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Macro-correlation data error:", error);
    }

    if (data?.payload) {
      const payload =
        typeof data.payload === "string"
          ? JSON.parse(data.payload)
          : data.payload;
      return NextResponse.json({ ...payload, computed_at: data.computed_at });
    }

    // No data yet — backend will populate on next daily run
    return NextResponse.json({
      symbol,
      corr_usd_official: 0.0,
      corr_usd_parallel: 0.0,
      corr_gold: 0.0,
      rating: "Low Protection",
      chart_data: [],
      insights: "Macro-correlation data is not yet available. It will be computed during the next daily update.",
    });
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
        insights: "Macro-correlation data is currently unavailable.",
      },
      { status: 200 }
    );
  }
}


