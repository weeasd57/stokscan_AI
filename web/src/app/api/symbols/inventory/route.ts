import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase
      .from("stock_fundamentals")
      .select("symbol,exchange,data")
      .limit(1000);

    return NextResponse.json({
      inventory: (data || []).map((row: Record<string, unknown>) => ({
        symbol: row.symbol,
        exchange: row.exchange,
        data: row.data,
      })),
    });
  } catch (error) {
    console.error("symbols inventory route error:", error);
    return NextResponse.json({ inventory: [] });
  }
}
