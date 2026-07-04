import { NextResponse } from "next/server";
import { getSupabaseClient, toNumber } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 120; // 2 min (market status can change intraday)

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("market_cache")
      .select("payload")
      .eq("cache_key", "market_status_Egypt")
      .maybeSingle();

    if (error || !data?.payload) {
      return NextResponse.json(
        {
          egx30: [],
          egx100: [],
          usdegp: [],
          regime: "unknown",
          egx30_return: 0,
          reject_buys: false,
          updated_at: new Date().toISOString(),
        },
        { status: 200 }
      );
    }

    return NextResponse.json(data.payload, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' }
    });
  } catch (error) {
    console.error("market status error:", error);
    return NextResponse.json(
      {
        egx30: [],
        egx100: [],
        usdegp: [],
        regime: "unknown",
        egx30_return: 0,
        reject_buys: false,
        updated_at: new Date().toISOString(),
      },
      { status: 200 }
    );
  }
}
