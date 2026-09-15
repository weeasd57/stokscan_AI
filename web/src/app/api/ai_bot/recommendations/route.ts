import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const revalidate = 180; // 3 minutes cache

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
        "Cache-Control": "public, s-maxage=180, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("ai_bot recommendations error:", error);
    return NextResponse.json([], { status: 200 });
  }
}
