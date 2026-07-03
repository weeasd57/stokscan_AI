import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const country = incomingUrl.searchParams.get("country") || "Egypt";
  const months = Number(incomingUrl.searchParams.get("months") || 6);
  const safeMonths = Number.isFinite(months) && months > 0 ? months : 6;
  const cacheKey = `sector_timeline_${safeMonths}m`;

  try {
    const supabase = getSupabaseClient();

    const { data: cached, error } = await supabase
      .from("market_cache")
      .select("payload, computed_at")
      .eq("cache_key", cacheKey)
      .eq("country", country)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Timeline cache fetch error:", error);
    }

    if (cached?.payload) {
      const payload =
        typeof cached.payload === "string"
          ? JSON.parse(cached.payload)
          : cached.payload;
      return NextResponse.json({
        ...payload,
        cached: true,
        computed_at: cached.computed_at,
      });
    }

    // No cached data yet — return empty structure (backend will populate on next daily run)
    return NextResponse.json({
      months: [],
      monthly: [],
      sectors: [],
      cached: false,
      computed_at: null,
    });
  } catch (error: any) {
    console.error("Timeline API error:", error);
    return NextResponse.json(
      {
        months: [],
        monthly: [],
        sectors: [],
        cached: false,
        error: "Failed to load timeline data",
      },
      { status: 200 }
    );
  }
}


