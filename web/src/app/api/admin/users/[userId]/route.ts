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
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, language, telegram_chat_id, whatsapp_number, notification_channel, created_at, updated_at")
      .eq("id", userId)
      .single();
    if (error) return NextResponse.json({ detail: error.message }, { status: 404 });
    return NextResponse.json(data);
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
    const allowedFields = ["display_name", "language", "telegram_chat_id", "whatsapp_number", "notification_channel"];
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
