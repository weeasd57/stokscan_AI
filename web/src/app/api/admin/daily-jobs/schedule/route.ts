import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("bot_configs")
      .select("bot_id, config, updated_at")
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("daily-jobs schedule error:", error);
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }
    const schedules = (data || []).map((r: Record<string, unknown>) => {
      const config = (r.config || {}) as Record<string, unknown>;
      return {
        bot_id: r.bot_id,
        use_schedule: config.use_schedule ?? false,
        schedule_start_time: config.schedule_start_time ?? "10:00",
        schedule_end_time: config.schedule_end_time ?? "14:30",
        schedule_days: Array.isArray(config.schedule_days) ? config.schedule_days : [0, 1, 2, 3, 4],
        schedule_timezone: config.schedule_timezone ?? "Africa/Cairo",
        poll_seconds: config.poll_seconds ?? 300,
        updated_at: r.updated_at,
      };
    });
    return NextResponse.json({ schedules });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const botId = (body.bot_id as string) || "primary";
    const supabase = getSupabaseClient();

    const { data: existing, error: fetchErr } = await supabase
      .from("bot_configs")
      .select("config")
      .eq("bot_id", botId)
      .single();
    if (fetchErr) return NextResponse.json({ detail: fetchErr.message }, { status: 404 });

    const merged = { ...(existing?.config as Record<string, unknown> || {}), ...body };
    delete merged.bot_id; // don't store bot_id inside config

    const { error } = await supabase
      .from("bot_configs")
      .update({ config: merged, updated_at: new Date().toISOString() })
      .eq("bot_id", botId);
    if (error) return NextResponse.json({ detail: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
