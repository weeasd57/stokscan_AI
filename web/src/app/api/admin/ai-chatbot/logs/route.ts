import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
    try {
        const supabase = getSupabaseClient();
        
        // Fetch logs joined with user profiles
        const { data, error } = await supabase
            .from("ai_chatbot_logs")
            .select("*, profiles(display_name, username, telegram_chat_id)")
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) {
            return NextResponse.json({ detail: error.message }, { status: 500 });
        }

        // Format for easy frontend consumption
        const formattedLogs = (data || []).map((log: any) => ({
            id: log.id,
            user_id: log.user_id,
            user_name: log.user_name || log.profiles?.display_name || log.profiles?.username || "Guest User",
            telegram_chat_id: log.profiles?.telegram_chat_id || null,
            message: log.message,
            reply: log.reply,
            created_at: log.created_at,
        }));

        return NextResponse.json(formattedLogs);
    } catch (e) {
        return NextResponse.json({ detail: "Internal error" }, { status: 500 });
    }
}
