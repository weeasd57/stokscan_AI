import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    // support_messages columns: id, session_id, user_id, sender, content, user_name,
    // telegram_message_id, created_at
    const { data, error } = await supabase
      .from("support_messages")
      .select("session_id, user_id, user_name, content, created_at, sender")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("admin support chats error:", error);
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }

    // Group messages into sessions (unique conversations)
    const sessions: Record<string, {
      session_id: string;
      user_id: string | null;
      user_name: string | null;
      last_message: string;
      last_at: string;
      last_message_time: string;
      message_count: number;
    }> = {};

    (data || []).forEach((msg: Record<string, unknown>) => {
      const sid = msg.session_id as string;
      if (!sessions[sid]) {
        sessions[sid] = {
          session_id: sid,
          user_id: (msg.user_id as string) || null,
          user_name: (msg.user_name as string) || null,
          last_message: (msg.content as string) || "",
          last_at: (msg.created_at as string) || "",
          last_message_time: (msg.created_at as string) || "",
          message_count: 0,
        };
      }
      sessions[sid].message_count++;
    });

    return NextResponse.json({ chats: Object.values(sessions) });
  } catch {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}
