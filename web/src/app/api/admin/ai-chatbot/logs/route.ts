import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
    try {
        const supabase = getSupabaseClient();
        
        // 1. Fetch logs from ai_chatbot_logs (up to 2000 records)
        const { data: logsData } = await supabase
            .from("ai_chatbot_logs")
            .select("*, profiles(display_name, username, telegram_chat_id)")
            .order("created_at", { ascending: false })
            .limit(2000);

        // 2. Fetch structured messages from ai_chat_messages (up to 2000 records)
        const { data: chatMsgs } = await supabase
            .from("ai_chat_messages")
            .select("id, user_id, role, content, created_at, profiles(display_name, username, telegram_chat_id)")
            .order("created_at", { ascending: false })
            .limit(2000);

        const logsMap = new Map<string, any>();

        (logsData || []).forEach((log: any) => {
            const key = log.id || `${log.user_id}_${log.created_at}`;
            logsMap.set(key, {
                id: log.id,
                user_id: log.user_id,
                user_name: log.user_name || log.profiles?.display_name || log.profiles?.username || log.user_id || "Guest User",
                telegram_chat_id: log.profiles?.telegram_chat_id || null,
                message: log.message,
                reply: log.reply,
                created_at: log.created_at,
            });
        });

        // Merge messages from ai_chat_messages
        (chatMsgs || []).forEach((msg: any) => {
            if (msg.role === "user" && msg.user_id) {
                const key = `msg_${msg.id}`;
                if (!logsMap.has(key)) {
                    logsMap.set(key, {
                        id: msg.id,
                        user_id: msg.user_id,
                        user_name: msg.profiles?.display_name || msg.profiles?.username || msg.user_id || "Guest User",
                        telegram_chat_id: msg.profiles?.telegram_chat_id || null,
                        message: msg.content,
                        reply: "محادثة مسجلة في الجلسات",
                        created_at: msg.created_at,
                    });
                }
            }
        });

        const formattedLogs = Array.from(logsMap.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        return NextResponse.json(formattedLogs);
    } catch (e) {
        return NextResponse.json({ detail: "Internal error" }, { status: 500 });
    }
}
