import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function coerceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function GET(req: Request) {
  try {
    const incomingUrl = new URL(req.url);
    const source = incomingUrl.searchParams.get("source") || "supabase";
    const supabase = getSupabaseClient();

    if (source === "local") {
      return NextResponse.json({ countries: [] });
    }

    try {
      const { data } = await supabase.rpc("get_active_countries");
      if (Array.isArray(data) && data.length > 0) {
        const countries = data
          .map((item: unknown) => String((item as Record<string, unknown>).country || ""))
          .filter(Boolean);
        return NextResponse.json({ countries });
      }
    } catch {
      // fall through to the fundamentals fallback below
    }

    const { data } = await supabase.from("stock_fundamentals").select("data");
    const countries = new Set<string>();

    for (const row of data || []) {
      const payload = coerceRecord(row.data);
      const country = String(payload.country || payload.Country || "").trim();
      if (country) countries.add(country);
    }

    return NextResponse.json({ countries: Array.from(countries).sort() });
  } catch (error) {
    console.error("Symbols countries route error:", error);
    return NextResponse.json({ detail: "Countries data unavailable" }, { status: 502 });
  }
}
