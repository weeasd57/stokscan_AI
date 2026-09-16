import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS } from "@/lib/cache/daily";

export const runtime = "nodejs";
export const revalidate = 86400; // 24 hours (cleared instantly on-demand via /api/revalidate)

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || 50);
  
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("scan_results")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(Number.isFinite(limit) && limit > 0 ? limit : 50);

    const results = (data || []).map((row: Record<string, unknown>) => ({
      ...row,
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
