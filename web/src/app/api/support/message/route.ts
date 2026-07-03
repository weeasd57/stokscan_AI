import { NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.session_id || "");
    const content = String(body.content || "").trim();
    const userName = String(body.user_name || "Guest");
    if (!sessionId || !content) return NextResponse.json({ ok: false }, { status: 400 });

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("support_messages")
      .insert({ session_id: sessionId, sender: "user", content, user_name: userName })
      .select("*")
      .single();

    if (error) return NextResponse.json({ ok: false }, { status: 200 });
    return NextResponse.json({ ok: true, message: data });
  } catch (error) {
    console.error("support message route error:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
