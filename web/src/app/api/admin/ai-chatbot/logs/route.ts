import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
    try {
        const supabase = getSupabaseClient();

        // 1. Fetch user emails from auth.admin API to map user_id -> email
        const userEmailMap = new Map<string, string>();
        try {
            const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
            if (authData?.users) {
                authData.users.forEach((u: any) => {
                    if (u.id && u.email) {
                        userEmailMap.set(u.id, u.email);
                    }
                });
            }
        } catch (e) {
            console.warn("Could not list auth users for email mapping:", e);
        }

        // 2. Fetch profiles as fallback for display names
        const profileMap = new Map<string, string>();
        try {
            const { data: profilesData } = await supabase
                .from("profiles")
                .select("id, display_name, username");
            (profilesData || []).forEach((p: any) => {
                const name = p.display_name || p.username;
                if (p.id && name) {
                    profileMap.set(p.id, name);
                }
            });
        } catch (e) {
            console.warn("Could not fetch profiles:", e);
        }

        const getUserLabel = (userId: string, defaultName?: string) => {
            if (userEmailMap.has(userId)) return userEmailMap.get(userId)!;
            if (profileMap.has(userId)) return profileMap.get(userId)!;
            if (defaultName && defaultName !== "Guest User" && !defaultName.includes("-")) return defaultName;
            return userId || "Guest User";
        };

        const logsMap = new Map<string, any>();

        // 3. Fetch legacy logs from ai_chatbot_logs
        try {
            const { data: logsData } = await supabase
                .from("ai_chatbot_logs")
                .select("*")
                .order("created_at", { ascending: false })
                .limit(1000);

            (logsData || []).forEach((log: any) => {
                const key = log.id || `${log.user_id}_${log.created_at}`;
                const userName = getUserLabel(log.user_id, log.user_name);
                logsMap.set(key, {
                    id: log.id,
                    user_id: log.user_id || userName,
                    user_name: userName,
                    telegram_chat_id: null,
                    message: log.message,
                    reply: log.reply,
                    created_at: log.created_at,
                });
            });
        } catch (e) {
            console.warn("Error fetching ai_chatbot_logs:", e);
        }

        // 4. Fetch structured messages from ai_chat_messages (Pair user + assistant messages)
        try {
            const { data: chatMsgs } = await supabase
                .from("ai_chat_messages")
                .select("id, session_id, user_id, role, content, created_at")
                .order("created_at", { ascending: true })
                .limit(2000);

            if (chatMsgs && chatMsgs.length > 0) {
                // Pair user query with subsequent assistant response in the same session
                for (let i = 0; i < chatMsgs.length; i++) {
                    const msg = chatMsgs[i];
                    if (msg.role === "user" && msg.user_id) {
                        const nextMsg = chatMsgs[i + 1];
                        const replyContent = (nextMsg && nextMsg.role === "assistant" && nextMsg.session_id === msg.session_id)
                            ? nextMsg.content
                            : "محادثة مسبقة مسجلة في الجلسات";

                        const key = `msg_${msg.id}`;
                        const userName = getUserLabel(msg.user_id);

                        logsMap.set(key, {
                            id: msg.id,
                            user_id: msg.user_id,
                            user_name: userName,
                            telegram_chat_id: null,
                            message: msg.content,
                            reply: replyContent,
                            created_at: msg.created_at,
                        });
                    }
                }
            }
        } catch (e) {
            console.warn("Error fetching ai_chat_messages:", e);
        }

        const formattedLogs = Array.from(logsMap.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        return NextResponse.json(formattedLogs);
    } catch (e) {
        return NextResponse.json({ detail: "Internal error" }, { status: 500 });
    }
}
