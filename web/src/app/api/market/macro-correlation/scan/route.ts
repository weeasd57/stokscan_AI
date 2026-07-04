import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 3600;

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("market_cache")
      .select("payload, computed_at")
      .eq("cache_key", "macro_correlation_scan")
      .eq("country", "Egypt")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Macro-correlation scan error:", error);
    }

    if (data?.payload) {
      const payload =
        typeof data.payload === "string"
          ? JSON.parse(data.payload)
          : data.payload;
      return NextResponse.json({ ...payload, computed_at: data.computed_at }, {
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' }
      });
    }

    // No data yet — backend will populate on next daily run
    return NextResponse.json({
      updated_at: new Date().toISOString(),
      symbols: [],
    });
  } catch (error: any) {
    console.error("Macro-correlation scan error:", error);
    return NextResponse.json(
      {
        updated_at: new Date().toISOString(),
        symbols: [],
        error: "Failed to load macro-correlation scan data",
      },
      { status: 200 }
    );
  }
}


