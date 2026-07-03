import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 15), 50);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("daily_job_runs")
      .select("id, job_type, status, started_at, completed_at, total_symbols, error, trigger")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.error("daily-jobs history error:", error);
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }
    return NextResponse.json({ history: data || [] });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
