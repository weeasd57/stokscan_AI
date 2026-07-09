import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    
    // Get all support messages and group by session
    const { data, error } = await supabase
      .from("support_messages")
      .select("session_id, user_id, user_name, content, created_at, sender")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ detail: error.message }, { status: 500 });
    }

    // Group messages into chat sessions
    const sessions: Record<string, any> = {};
    (data || []).forEach((msg: any) => {
      if (!sessions[msg.session_id]) {
        sessions[msg.session_id] = {
          session_id: msg.session_id,
          user_id: msg.user_id,
          user_name: msg.user_name,
          last_message: msg.content,
          last_at: msg.created_at,
          message_count: 0,
        };
      }
      sessions[msg.session_id].message_count++;
    });

    return NextResponse.json({ 
      chats: Object.values(sessions) 
    });
  } catch (e) {
    return NextResponse.json({ detail: "Internal error" }, { status: 500 });
  }
}