import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const incomingUrl = new URL(req.url);
  const backendBaseUrl =
    process.env.BACKEND_URL ||
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8000";

  try {
    const backendUrl = new URL("/market/macro-correlation/scan", backendBaseUrl);
    incomingUrl.searchParams.forEach((value, key) => {
      backendUrl.searchParams.append(key, value);
    });

    const res = await fetch(backendUrl.toString(), { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Backend macro-correlation scan failed (${res.status})`);
    }

    const payload = await res.json();

    try {
      const supabase = getSupabaseClient();
      await supabase.from("market_cache").upsert(
        {
          cache_key: "macro_correlation_scan",
          country: "Egypt",
          payload,
          computed_at: new Date().toISOString(),
        },
        {
          onConflict: "cache_key,country",
        }
      );
    } catch (cacheError) {
      console.error("Macro-correlation scan cache backfill failed:", cacheError);
    }

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("Macro-correlation scan error:", error);
    return NextResponse.json(
      {
        updated_at: new Date().toISOString(),
        symbols: [],
        error: error?.message || "Failed to load macro-correlation scan data",
      },
      { status: 200 }
    );
  }
}
