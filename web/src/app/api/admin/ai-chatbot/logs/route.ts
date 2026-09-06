import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { sanitizeUiLabel, stripEnvironmentLeak } from "@/lib/ai/sanitizer";
import { requireAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
    try {
        const auth = await requireAdmin(_req);
        if (auth instanceof Response) return auth;
        const supabase = getSupabaseClient();

        // Run data fetching in parallel for maximum speed
        const [authRes, profilesRes, legacyLogsRes, chatMsgsRes] = await Promise.allSettled([
            // 1. Fetch user emails from auth.admin API
            supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }).catch((e: any) => {
                console.warn("Could not list auth users:", e);
                return { data: { users: [] } };
            }),
            // 2. Fetch profiles for display names
            supabase.from("profiles").select("id, display_name, username").limit(2000),
            // 3. Fetch legacy logs from ai_chatbot_logs
            supabase.from("ai_chatbot_logs").select("*").order("created_at", { ascending: false }).limit(1000),
            // 4. Fetch latest structured chat messages ordered descending (newest first)
            supabase.from("ai_chat_messages")
                .select("id, session_id, user_id, role, content, latency_ms, image_url, metadata, created_at")
                .order("created_at", { ascending: false })
                .limit(5000)
        ]);

        // Build User Email Map
        const userEmailMap = new Map<string, string>();
        if (authRes.status === "fulfilled" && (authRes.value as any)?.data?.users) {
            (authRes.value as any).data.users.forEach((u: any) => {
                if (u.id && u.email) userEmailMap.set(u.id, u.email);
            });
        }

        // Build Profile Map
        const profileMap = new Map<string, string>();
        if (profilesRes.status === "fulfilled" && (profilesRes.value as any)?.data) {
            (profilesRes.value as any).data.forEach((p: any) => {
                const name = p.display_name || p.username;
                if (p.id && name) profileMap.set(p.id, name);
            });
        }

        const getUserLabel = (userId?: string | null, defaultName?: string) => {
            if (!userId) return defaultName || "مستخدم زائر (Guest)";
            if (userEmailMap.has(userId)) return userEmailMap.get(userId)!;
            if (profileMap.has(userId)) return profileMap.get(userId)!;
            if (defaultName && defaultName !== "Guest User" && !defaultName.includes("-")) return defaultName;
            return userId;
        };

        const logsMap = new Map<string, any>();

        // Process legacy logs
        if (legacyLogsRes.status === "fulfilled" && (legacyLogsRes.value as any)?.data) {
            (legacyLogsRes.value as any).data.forEach((log: any) => {
                const key = log.id || `${log.user_id}_${log.created_at}`;
                const userName = getUserLabel(log.user_id, log.user_name);
                const cleanMessage = sanitizeUiLabel(log.message || "");
                const cleanReply = sanitizeUiLabel(log.reply || "");
                
                // Extract data source from tool_calls if available
                let dataSource = "unknown";
                if (log.tool_calls && Array.isArray(log.tool_calls)) {
                    for (const toolCall of log.tool_calls) {
                        if (toolCall.result && toolCall.result.data && toolCall.result.data.data_source) {
                            dataSource = toolCall.result.data.data_source;
                            break;
                        }
                    }
                }
                
                logsMap.set(key, {
                    id: log.id,
                    user_id: log.user_id || userName,
                    user_name: userName,
                    telegram_chat_id: null,
                    message: cleanMessage,
                    reply: cleanReply,
                    created_at: log.created_at,
                    data_source: dataSource,
                });
            });
        }

        // Process structured chat messages
        let chatMsgs: any[] = [];
        if (chatMsgsRes.status === "fulfilled") {
            const val: any = chatMsgsRes.value;
            if (val.error) {
                // Fallback without latency_ms/metadata if columns don't exist
                const fallback = await supabase
                    .from("ai_chat_messages")
                    .select("id, session_id, user_id, role, content, image_url, created_at")
                    .order("created_at", { ascending: false })
                    .limit(5000);
                if (fallback.data) chatMsgs = fallback.data;
            } else if (val.data) {
                chatMsgs = val.data;
            }
        }

        if (chatMsgs.length > 0) {
            // Group messages by session_id
            const sessionMap = new Map<string, any[]>();
            chatMsgs.forEach((msg: any) => {
                const sId = msg.session_id || "single_session";
                if (!sessionMap.has(sId)) sessionMap.set(sId, []);
                sessionMap.get(sId)!.push(msg);
            });

            // Within each session, pair user questions with assistant replies chronologically
            sessionMap.forEach((sessionMsgs) => {
                sessionMsgs.sort((a, b) => {
                    const tDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                    if (tDiff !== 0) return tDiff;
                    if (a.role === "user" && b.role === "assistant") return -1;
                    if (a.role === "assistant" && b.role === "user") return 1;
                    return 0;
                });

                const matchedAssistantIds = new Set<string>();

                for (let i = 0; i < sessionMsgs.length; i++) {
                    const msg = sessionMsgs[i];
                    if (msg.role === "user") {
                        let assistantMsg: any = null;
                        for (let j = i + 1; j < sessionMsgs.length; j++) {
                            if (sessionMsgs[j].role === "assistant") {
                                assistantMsg = sessionMsgs[j];
                                matchedAssistantIds.add(sessionMsgs[j].id);
                                break;
                            } else if (sessionMsgs[j].role === "user") {
                                break;
                            }
                        }

                        const replyContent = assistantMsg ? (assistantMsg.content || "") : "";
                        let latencyMs = assistantMsg?.latency_ms || null;
                        if (!latencyMs && assistantMsg) {
                            const userTime = new Date(msg.created_at).getTime();
                            const assistantTime = new Date(assistantMsg.created_at).getTime();
                            if (assistantTime >= userTime && assistantTime - userTime < 300000) {
                                latencyMs = assistantTime - userTime;
                            }
                        }

                        // Data provenance saved by the chat pipeline (migration 20260906)
                        const meta = assistantMsg?.metadata || null;
                        const dataSource = meta?.data_source || null;
                        const dataDate = meta?.data_date || null;

                        const effectiveUserId = msg.user_id || (msg.session_id ? `guest_${msg.session_id.slice(0, 8)}` : "guest");
                        const userName = getUserLabel(msg.user_id, msg.user_id ? undefined : `زائر (${msg.session_id?.slice(0, 6) || "عام"})`);
                        const cleanMessage = sanitizeUiLabel(msg.content || "");
                        const cleanReply = replyContent ? stripEnvironmentLeak(replyContent) : "";

                        logsMap.set(`msg_${msg.id}`, {
                            id: msg.id,
                            session_id: msg.session_id,
                            user_id: effectiveUserId,
                            user_name: userName,
                            telegram_chat_id: null,
                            message: cleanMessage,
                            image_url: msg.image_url || null,
                            reply: cleanReply,
                            latency_ms: latencyMs,
                            created_at: msg.created_at,
                            data_source: dataSource,
                            data_date: dataDate,
                        });
                    }
                }

                // If any assistant messages were unpaired (e.g. user prompt dropped or session started with assistant greeting)
                for (const msg of sessionMsgs) {
                    if (msg.role === "assistant" && !matchedAssistantIds.has(msg.id)) {
                        const effectiveUserId = msg.user_id || (msg.session_id ? `guest_${msg.session_id.slice(0, 8)}` : "guest");
                        const userName = getUserLabel(msg.user_id, msg.user_id ? undefined : `زائر (${msg.session_id?.slice(0, 6) || "عام"})`);
                        const cleanReply = msg.content ? stripEnvironmentLeak(msg.content) : "";
                        const meta = msg.metadata || null;

                        logsMap.set(`msg_asst_${msg.id}`, {
                            id: msg.id,
                            session_id: msg.session_id,
                            user_id: effectiveUserId,
                            user_name: userName,
                            telegram_chat_id: null,
                            message: "💬 [رسالة مباشرة / بدء جلسة من المساعد]",
                            image_url: null,
                            reply: cleanReply,
                            latency_ms: msg.latency_ms || null,
                            created_at: msg.created_at,
                            data_source: meta?.data_source || null,
                            data_date: meta?.data_date || null,
                        });
                    }
                }
            });
        }

        const formattedLogs = Array.from(logsMap.values()).sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        return NextResponse.json(formattedLogs);
    } catch (e) {
        console.error("Error in admin ai-chatbot logs GET:", e);
        return NextResponse.json({ detail: "Internal error" }, { status: 500 });
    }
}
