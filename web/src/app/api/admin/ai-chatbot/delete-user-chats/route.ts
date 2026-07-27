import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { userId } = body;

        if (!userId) {
            return NextResponse.json({ detail: "User ID is required" }, { status: 400 });
        }

        const supabase = getSupabaseClient();

        // 1. Delete from ai_chatbot_logs
        await supabase.from("ai_chatbot_logs").delete().or(`user_id.eq.${userId},user_name.eq.${userId}`);

        // 2. Delete messages from ai_chat_messages
        await supabase.from("ai_chat_messages").delete().eq("user_id", userId);

        // 3. Delete sessions from ai_chat_sessions
        await supabase.from("ai_chat_sessions").delete().eq("user_id", userId);

        return NextResponse.json({ ok: true, message: `All chats deleted for user: ${userId}` });
    } catch (error: any) {
        return NextResponse.json({ detail: error.message || "Failed to delete chats" }, { status: 500 });
    }
}
