import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const bot_id = url.searchParams.get("bot_id") || "primary";
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("bot_states")
      .select("bot_id, state, updated_at")
      .eq("bot_id", bot_id)
      .maybeSingle();
    if (error) {
      console.error("alert-scheduler state error:", error);
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }
    return NextResponse.json(data || { bot_id, state: {}, updated_at: null });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
