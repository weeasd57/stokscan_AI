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

    const payload = (typeof data.payload === "string" ? JSON.parse(data.payload) : data.payload) || {};
    const safePayload = {
      ...payload,
      egx30: Array.isArray(payload.egx30) ? payload.egx30 : [],
      egx100: Array.isArray(payload.egx100) ? payload.egx100 : [],
      usdegp: Array.isArray(payload.usdegp) ? payload.usdegp : [],
    };

    // If usdegp is empty in cache, fallback to stock_prices
    if (safePayload.usdegp.length === 0) {
      try {
        const { data: usdRows } = await supabase
          .from("stock_prices")
          .select("date, open, high, low, close, volume")
          .eq("symbol", "USDEGP")
          .order("date", { ascending: true })
          .limit(365);
        if (usdRows && usdRows.length > 0) {
          safePayload.usdegp = usdRows.map((r: any) => ({
            date: r.date,
            open: toNumber(r.open, 0),
            high: toNumber(r.high, 0),
            low: toNumber(r.low, 0),
            close: toNumber(r.close, 0),
            volume: toNumber(r.volume, 0),
          }));
        }
      } catch (err) {
        console.error("Failed to fetch USD/EGP fallback prices:", err);
      }
    }

    return NextResponse.json(safePayload, {
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
