import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS, dailyCacheHeaders } from "@/lib/cache/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestedFrom = request.nextUrl.searchParams.get("from");
  const from = requestedFrom && /^\d{4}-\d{2}-\d{2}$/.test(requestedFrom)
    ? requestedFrom
    : new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  try {
    const db = getSupabaseServiceClient({ cacheMarketData: true });
    const dailyCounts: Record<string, number> = {};
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await db.from("scan_results")
        .select("created_at")
        .eq("is_public", true)
        .eq("exchange", "EGX")
        .gte("created_at", `${from}T00:00:00`)
        .order("created_at", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const rows = data || [];
      for (const row of rows) {
        const date = String(row.created_at || "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dailyCounts[date] = (dailyCounts[date] || 0) + 1;
      }
      if (rows.length < pageSize) break;
    }
    return NextResponse.json({ from, daily_counts: dailyCounts }, { headers: dailyCacheHeaders(DAILY_CACHE_TAGS.recommendations) });
  } catch (error) {
    console.error("[MARKET_RECOMMENDATION_COUNTS]", error);
    return NextResponse.json({ error: "Recommendation counts are temporarily unavailable" }, { status: 503 });
  }
}
