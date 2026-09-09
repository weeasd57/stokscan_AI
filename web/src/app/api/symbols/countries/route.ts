import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBackendBaseUrl() {
  return (
    process.env.PYTHON_BACKEND_URL ||
    process.env.TRADING_SIGNALS_API_URL ||
    process.env.BACKEND_URL ||
    process.env.API_BASE_URL ||
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    "http://127.0.0.1:8000"
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const source = url.searchParams.get("source") || "supabase";

  // 1. Prefer the Python backend. It honors source=local (full inventory from
  //    local symbol files) and returns canonical casing ("Egypt"), which every
  //    downstream lookup (market_cache keys, stock_fundamentals, local files)
  //    depends on because those lookups are case-sensitive.
  try {
    const backendUrl = new URL("/symbols/countries", getBackendBaseUrl());
    backendUrl.searchParams.set("source", source);

    const backendRes = await fetch(backendUrl.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (backendRes.ok) {
      const contentType = backendRes.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await backendRes.json();
        if (Array.isArray(data?.countries) && data.countries.length > 0) {
          return NextResponse.json({ countries: data.countries });
        }
      }
    }
  } catch (error) {
    console.warn("Backend countries unavailable, falling back to Supabase:", error);
  }

  // 2. Fallback: distinct countries from the stocks table (canonical casing).
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("stocks")
      .select("country")
      .not("country", "is", null)
      .limit(5000);

    if (!error && Array.isArray(data)) {
      const countries = [
        ...new Set(
          data
            .map((r: any) => (typeof r.country === "string" ? r.country.trim() : ""))
            .filter(Boolean)
        ),
      ];
      if (countries.length > 0) {
        return NextResponse.json({ countries: countries.sort() });
      }
    }
  } catch (error) {
    console.error("countries stocks fallback error:", error);
  }

  // 3. Last resort: active-countries RPC. Note: this RPC can return lowercase
  //    names (e.g. "egypt") which breaks case-sensitive country lookups
  //    downstream — only used when everything else failed.
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("get_active_countries");
    if (!error && Array.isArray(data)) {
      const countries = data.map((r: any) => r.country).filter(Boolean);
      if (countries.length > 0) {
        return NextResponse.json({ countries });
      }
    }
  } catch (error) {
    console.error("countries RPC fallback error:", error);
  }

  return NextResponse.json({ countries: ["Egypt"] });
}
