import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { sanitizeUiLabel } from "@/lib/ai/sanitizer";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
    try {
        const auth = await requireAdmin(_req);
        if (auth instanceof Response) return auth;
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
                const cleanMessage = sanitizeUiLabel(log.message || "");
                const cleanReply = sanitizeUiLabel(log.reply || "");
                logsMap.set(key, {
                    id: log.id,
                    user_id: log.user_id || userName,
                    user_name: userName,
                    telegram_chat_id: null,
                    message: cleanMessage,
                    reply: cleanReply,
                    created_at: log.created_at,
                });
            });
        } catch (e) {
            console.warn("Error fetching ai_chatbot_logs:", e);
        }

        // 4. Fetch structured messages from ai_chat_messages (Pair user + assistant messages)
        try {
            let { data: chatMsgs, error: chatMsgsError } = await supabase
                .from("ai_chat_messages")
                .select("id, session_id, user_id, role, content, latency_ms, image_url, created_at")
                .order("created_at", { ascending: true })
                .limit(3000);

            // latency_ms ships with migration 20260813; until applied the select above
            // fails with a schema error — retry without the column so ALL users still show.
            if (chatMsgsError) {
                const fallback = await supabase
                    .from("ai_chat_messages")
                    .select("id, session_id, user_id, role, content, image_url, created_at")
                    .order("created_at", { ascending: true })
                    .limit(3000);
                if (fallback.data) chatMsgs = fallback.data;
                else console.warn("Error fetching ai_chat_messages:", chatMsgsError);
            }

            if (chatMsgs && chatMsgs.length > 0) {
                chatMsgs.sort((a: any, b: any) => {
                    const timeA = new Date(a.created_at).getTime();
                    const timeB = new Date(b.created_at).getTime();
                    if (timeA !== timeB) return timeA - timeB;
                    if (a.role === "user" && b.role === "assistant") return -1;
                    if (a.role === "assistant" && b.role === "user") return 1;
                    return 0;
                });

                for (let i = 0; i < chatMsgs.length; i++) {
                    const msg = chatMsgs[i];
                    if (msg.role === "user" && msg.user_id) {
                        // Find the assistant reply for this user message in the same session
                        const assistantMsg = chatMsgs[i + 1]?.session_id === msg.session_id && chatMsgs[i + 1]?.role === "assistant"
                            ? chatMsgs[i + 1]
                            : null;
                        const replyContent = assistantMsg ? assistantMsg.content : "";

                        let latencyMs = assistantMsg?.latency_ms || null;
                        if (!latencyMs && assistantMsg && msg) {
                            const userTime = new Date(msg.created_at).getTime();
                            const assistantTime = new Date(assistantMsg.created_at).getTime();
                            if (assistantTime >= userTime && assistantTime - userTime < 300000) {
                                latencyMs = assistantTime - userTime;
                            }
                        }

                        const key = `msg_${msg.id}`;
                        const userName = getUserLabel(msg.user_id);

                        const cleanMessage = sanitizeUiLabel(msg.content || "");
                        const cleanReply = sanitizeUiLabel(replyContent);
                        logsMap.set(key, {
                            id: msg.id,
                            user_id: msg.user_id,
                            user_name: userName,
                            telegram_chat_id: null,
                            message: cleanMessage,
                            image_url: msg.image_url || null,
                            reply: cleanReply,
                            latency_ms: latencyMs,
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
