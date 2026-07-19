import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await context.params;
    const supabase = getSupabaseClient();

    // Query profile
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileErr) return NextResponse.json({ detail: profileErr.message }, { status: 404 });

    // Query related tables safely
    const [subRes, botSubRes, posRes, scanRes] = await Promise.all([
      supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle().catch(() => ({ data: null })),
      supabase.from("bot_subscriptions").select("*").eq("user_id", userId).catch(() => ({ data: [] })),
      supabase.from("positions").select("*").eq("user_id", userId).catch(() => ({ data: [] })),
      supabase.from("scan_results").select("*").limit(10).catch(() => ({ data: [] })),
    ]);

    return NextResponse.json({
      profile: profile || {},
      subscription: subRes?.data || null,
      bot_subscriptions: botSubRes?.data || [],
      open_positions: posRes?.data || [],
      recent_scans: scanRes?.data || [],
    });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await context.params;
    const body = await req.json();
    // Only allow safe fields to be updated
    const allowedFields = [
      "display_name", "language", "telegram_chat_id", "whatsapp_number", 
      "notification_channel", "default_target_pct", "default_stop_pct",
      "gemini_api_key", "openrouter_api_key", "custom_ai_rules"
    ];
    const safeBody: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) safeBody[field] = body[field];
    }
    safeBody.updated_at = new Date().toISOString();

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("profiles")
      .update(safeBody)
      .eq("id", userId)
      .select()
      .single();
    if (error) return NextResponse.json({ detail: error.message }, { status: 400 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await context.params;
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("profiles").delete().eq("id", userId);
    if (error) return NextResponse.json({ detail: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
