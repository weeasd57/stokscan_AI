import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateChartWorkspace } from "@/lib/chart-workspace";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const respond = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient(request);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return respond({ error: "Authentication required" }, 401);
    const { data, error } = await supabase
      .from("chart_workspaces")
      .select("workspace,updated_at")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (error) return respond({ error: "Workspace storage unavailable" }, 503);
    return respond({
      workspace:
        data && validateChartWorkspace(data.workspace) ? data.workspace : null,
      updatedAt: data?.updated_at ?? null,
    });
  } catch {
    return respond({ error: "Workspace storage unavailable" }, 503);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient(request);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user)
      return respond({ error: "Authentication required" }, 401);
    const raw = await request.text();
    if (raw.length > 32000)
      return respond({ error: "Workspace too large" }, 413);
    let body: { workspace?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return respond({ error: "Invalid JSON" }, 400);
    }
    if (!body || !validateChartWorkspace(body.workspace))
      return respond({ error: "Invalid workspace" }, 400);
    const updatedAt = new Date().toISOString();
    const { error } = await supabase
      .from("chart_workspaces")
      .upsert(
        { user_id: user.id, workspace: body.workspace, updated_at: updatedAt },
        { onConflict: "user_id" },
      );
    if (error) return respond({ error: "Workspace storage unavailable" }, 503);
    return respond({ saved: true, updatedAt });
  } catch {
    return respond({ error: "Workspace storage unavailable" }, 503);
  }
}
