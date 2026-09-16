import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { DAILY_CACHE_TAGS } from "@/lib/cache/daily";

export const runtime = "nodejs";
export const revalidate = 3600;

const PUBLIC_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300",
  "Vercel-CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
  "Vercel-Cache-Tag": DAILY_CACHE_TAGS.market,
};

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("stocks")
      .select("symbol")
      .eq("country", "Egypt");

    if (error) {
      throw error;
    }

    const symbols = Array.from(new Set((data || []).map((s: any) => s.symbol))).sort();

    if (symbols.length === 0) {
      // Fallback symbols if DB is empty
      return NextResponse.json({
        symbols: ["FWRY", "ABUK", "AMOC", "EAST", "SWDY", "HRHO", "CIEB", "MASR", "COSG", "ETEL"]
      }, { headers: PUBLIC_CACHE_HEADERS });
    }

    return NextResponse.json({ symbols }, { headers: PUBLIC_CACHE_HEADERS });
  } catch (error) {
    console.error("Error fetching macro-correlation symbols:", error);
    return NextResponse.json({
      symbols: ["FWRY", "ABUK", "AMOC", "EAST", "SWDY", "HRHO", "CIEB", "MASR", "COSG", "ETEL"]
    }, { headers: PUBLIC_CACHE_HEADERS });
  }
}
