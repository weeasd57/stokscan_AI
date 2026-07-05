import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    
    // 1. Fetch bot configuration
    const { data: configData, error: configError } = await supabase
      .from("bot_configs")
      .select("bot_id, config, updated_at")
      .eq("bot_id", "primary")
      .maybeSingle();

    if (configError) {
      console.error("daily-jobs config fetch error:", configError);
      return NextResponse.json({ detail: configError.message }, { status: 500 });
    }

    const rawConfig = (configData?.config || {}) as Record<string, any>;

    // 2. Fetch stats and run history from daily_job_runs
    let totalRuns = 0;
    let totalFailed = 0;
    let lastRunAt: string | null = null;
    let lastRunStatus: string | null = null;
    let runHistory: { run_at: string; status: string; job_id: string }[] = [];

    try {
      const { data: runs, error: runsError } = await supabase
        .from("daily_job_runs")
        .select("id, status, started_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (!runsError && runs) {
        totalRuns = runs.length;
        totalFailed = runs.filter((r: any) => r.status === "failed").length;
        if (runs.length > 0) {
          lastRunAt = runs[0].started_at;
          lastRunStatus = runs[0].status;
        }
        runHistory = runs.slice(0, 10).map((r: any) => ({
          run_at: r.started_at,
          status: r.status,
          job_id: r.id
        }));
      }
    } catch (runsErr) {
      console.error("Failed to query run history for stats:", runsErr);
    }

    // Map backend keys to expected frontend structure
    const scheduleState = {
      enabled: rawConfig.use_schedule ?? rawConfig.enabled ?? false,
      run_time: rawConfig.schedule_start_time ?? rawConfig.run_time ?? "16:00",
      active_days: Array.isArray(rawConfig.schedule_days)
        ? rawConfig.schedule_days
        : Array.isArray(rawConfig.active_days)
        ? rawConfig.active_days
        : [0, 1, 2, 3, 6],
      status: rawConfig.status ?? "idle",
      next_run_at: null, // Computed on demand/frontend or left as null
      last_run_at: lastRunAt,
      last_run_status: lastRunStatus,
      total_runs: totalRuns,
      total_failed: totalFailed,
      run_history: runHistory
    };

    return NextResponse.json(scheduleState);
  } catch (error: any) {
    console.error("daily-jobs schedule error:", error);
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const botId = "primary";
    const supabase = getSupabaseClient();

    const { data: existing, error: fetchErr } = await supabase
      .from("bot_configs")
      .select("config")
      .eq("bot_id", botId)
      .single();

    if (fetchErr) {
      return NextResponse.json({ detail: fetchErr.message }, { status: 404 });
    }

    // Map incoming frontend properties to backend keys
    const configUpdate: Record<string, any> = {};
    if (body.enabled !== undefined) {
      configUpdate.use_schedule = body.enabled;
      configUpdate.enabled = body.enabled;
    }
    if (body.run_time !== undefined) {
      configUpdate.schedule_start_time = body.run_time;
      configUpdate.run_time = body.run_time;
    }
    if (body.active_days !== undefined) {
      configUpdate.schedule_days = body.active_days;
      configUpdate.active_days = body.active_days;
    }

    const merged = { 
      ...(existing?.config as Record<string, unknown> || {}), 
      ...configUpdate 
    };
    delete merged.bot_id;

    const { error } = await supabase
      .from("bot_configs")
      .update({ config: merged, updated_at: new Date().toISOString() })
      .eq("bot_id", botId);

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 400 });
    }
    
    // Return updated config state formatted for the frontend
    return NextResponse.json({
      enabled: merged.use_schedule ?? merged.enabled ?? false,
      run_time: merged.schedule_start_time ?? merged.run_time ?? "16:00",
      active_days: merged.schedule_days ?? merged.active_days ?? [0, 1, 2, 3, 6],
      status: merged.status ?? "idle",
      ok: true
    });
  } catch (error: any) {
    console.error("daily-jobs schedule update error:", error);
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

