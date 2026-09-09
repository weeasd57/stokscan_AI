import { NextRequest, NextResponse } from "next/server";
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = Math.min(Number(url.searchParams.get("days") || 14), 90);

  // 1. Prefer the Python backend: authoritative stats and the exact shape
  //    ({update_day, row_count}) the admin Data Manager chart renders.
  try {
    const backendUrl = new URL("/admin/data-growth", getBackendBaseUrl());
    backendUrl.searchParams.set("days", String(days));

    const headers: Record<string, string> = {};
    const adminKey = process.env.ADMIN_SECRET_KEY;
    if (adminKey) headers["x-admin-key"] = adminKey;

    const backendRes = await fetch(backendUrl.toString(), {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(20000),
    });

    if (backendRes.ok) {
      const contentType = backendRes.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await backendRes.json();
        if (Array.isArray(data)) {
          return NextResponse.json(data);
        }
      }
    }
  } catch (error) {
    console.warn("Backend data-growth unavailable, falling back to Supabase RPC:", error);
  }

  // 2. Fallback: call the same Supabase RPC the backend uses. It returns the
  //    array shape the chart expects. (The previous implementation returned a
  //    per-table summary object that the chart silently discarded.)
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("get_daily_data_growth", { p_days: days });
    if (!error && Array.isArray(data)) {
      return NextResponse.json(data);
    }
    if (error) console.error("get_daily_data_growth RPC failed:", error);
  } catch (error) {
    console.error("Data growth Supabase fallback error:", error);
  }

  return NextResponse.json([]);
}
