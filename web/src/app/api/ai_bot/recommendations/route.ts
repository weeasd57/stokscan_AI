import { NextResponse } from "next/server";
import { getSupabaseServiceClient, toNumber } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS } from "@/lib/cache/daily";

export const runtime = "nodejs";
export const revalidate = 86400; // 24 hours (cleared instantly on-demand via /api/revalidate)

export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 50)
    : 50;
  const recommendationFields =
    "id,batch_id,symbol,exchange,name,last_close,precision,signal,status,entry_price,target_price,stop_loss,is_public,created_at,updated_at,exit_price,profit_loss_pct,top_reasons";
  
  try {
    const supabase = getSupabaseServiceClient();
    let { data, error } = await supabase
      .from("current_public_recommendations")
      .select(recommendationFields)
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    // Older production databases may not have the reconciliation view yet.
    // Keep a deliberately narrow, public-only fallback rather than exposing
    // every scan_results column through a public endpoint.
    if (error) {
      const fallback = await supabase
        .from("scan_results")
        .select(recommendationFields)
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(limit);
      data = fallback.data;
      error = fallback.error;
    }
    if (error) throw error;

    const symbols = Array.from(new Set((data || []).map((row: Record<string, unknown>) => String(row.symbol || "")).filter(Boolean)));
    const { data: fundamentals } = symbols.length
      ? await supabase
        .from("stock_fundamentals")
        .select("symbol,data")
        .in("symbol", symbols)
      : { data: [] as Array<{ symbol: string; data?: Record<string, unknown> }> };
    const sectorMap = new Map((fundamentals || []).map((row: any) => [
      String(row.symbol),
      row.data?.sector || row.data?.Sector || row.data?.industry || "General",
    ]));

    const results = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      sector: sectorMap.get(String(row.symbol)) || "General",
      year: row.created_at ? new Date(String(row.created_at)).getFullYear() : null,
      precision: toNumber(row.precision, 0),
      last_close: toNumber(row.last_close, 0),
    }));

    return NextResponse.json(results, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=86400",
        "Vercel-Cache-Tag": DAILY_CACHE_TAGS.recommendations,
      },
    });
  } catch (error) {
    console.error("ai_bot recommendations error:", error);
    return NextResponse.json([], { status: 200 });
  }
}
