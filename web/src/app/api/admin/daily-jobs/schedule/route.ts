import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from("bot_configs")
      .select("bot_id, config")
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }

    const schedules = (data || []).map((r: any) => ({
      bot_id: r.bot_id,
      use_schedule: r.config?.use_schedule,
      schedule_start_time: r.config?.schedule_start_time,
      schedule_end_time: r.config?.schedule_end_time,
      schedule_days: r.config?.schedule_days,
      schedule_timezone: r.config?.schedule_timezone,
    }));

    return NextResponse.json({ schedules });
  } catch (e) {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabaseClient();

    const { data: existing } = await supabase
      .from("bot_configs")
      .select("config")
      .eq("bot_id", body.bot_id || "primary")
      .single();

    const merged = { ...existing?.config, ...body };

    const { error } = await supabase
      .from("bot_configs")
      .update({ 
        config: merged, 
        updated_at: new Date().toISOString() 
      })
      .eq("bot_id", body.bot_id || "primary");

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}