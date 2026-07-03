import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const country = incomingUrl.searchParams.get("country") || "Egypt";
  const months = Number(incomingUrl.searchParams.get("months") || 6);
  const forceRefresh = incomingUrl.searchParams.get("force_refresh") === "true";
  const cacheKey = `sector_timeline_${Number.isFinite(months) && months > 0 ? months : 6}m`;

  try {
    const supabase = getSupabaseClient();

    if (!forceRefresh) {
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
      } else if (cached?.payload) {
        const payload = typeof cached.payload === "string" ? JSON.parse(cached.payload) : cached.payload;
        return NextResponse.json({
          ...payload,
          cached: true,
          computed_at: cached.computed_at,
        });
      }
    }

    const backendBaseUrl =
      process.env.BACKEND_URL ||
      process.env.API_BASE_URL ||
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      "http://127.0.0.1:8000";

    const backendUrl = new URL("/scan/sectors/timeline", backendBaseUrl);
    backendUrl.searchParams.set("country", country);
    backendUrl.searchParams.set("months", String(Number.isFinite(months) && months > 0 ? months : 6));
    if (forceRefresh) {
      backendUrl.searchParams.set("force_refresh", "true");
    }

    const res = await fetch(backendUrl.toString(), { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Backend timeline fetch failed (${res.status})`);
    }

    const payload = await res.json();
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("Timeline API error:", error);
    return NextResponse.json(
      {
        months: [],
        monthly: [],
        sectors: [],
        cached: false,
        error: error?.message || "Failed to load timeline data",
      },
      { status: 200 }
    );
  }
}
