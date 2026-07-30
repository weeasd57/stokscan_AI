import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

import { loadSessionState, loadSessionSummary, updateSessionState, updateSessionSummary } from "@/lib/ai/session";
import { runPlanner } from "@/lib/ai/planner";
import { executeTools } from "@/lib/ai/tools";
import { generateFinalResponse, generateFinalStream } from "@/lib/ai/final";
import { selectOptimalModel } from "@/lib/ai/router";
import { AI_CONFIG } from "@/lib/ai/config";
import { logAiInteraction } from "@/lib/ai/logger";

import { runPipeline, runPipelineStream } from "@/lib/ai/pipeline";
import { analyzeImage } from "@/lib/ai/vision";
import { retrieveRelevantMemory } from "@/lib/ai/memory";
import { executeStructuredTools } from "@/lib/ai/tools-v2";
import { generateV2Response, generateV2Stream } from "@/lib/ai/final-v2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BLOCKED_INPUT_PATTERNS = [
    "system prompt", "ignore previous", "your instructions",
    "developer mode", "jailbreak", "ignore all",
    "admin_secret_key", "api_key", "database", "supabase", "postgres",
    "بيانات مستخدم", "قاعدة بيانات", "كلمة السر", "بيانات سرية", "اختراق", "باسورد"
];

function filterInput(text: string): boolean {
    const lowered = text.toLowerCase();
    return !BLOCKED_INPUT_PATTERNS.some(pattern => lowered.includes(pattern));
}

function filterOutput(response: string): string {
    const blockedOutputRegex = /(اشتري الآن|شراء فوراً|شراء الان|مضمون|ضمان|أرباح مؤكدة|guaranteed|assurance|buy now)/i;
    if (blockedOutputRegex.test(response)) {
        return "أنا أداة تحليلية ذكية، ولا يمكنني تقديم نصائح مالية أو توصيات شراء مباشرة. يمكنك مراجعة تقييم الأسهم في صفحة الماسح الذكي لمساعدتك في اتخاذ القرار.";
    }
    return response;
}

function filterOutputBlocks(text: string): boolean {
    const blockedPattern = /(اشتري الآن|شراء فوراً|شراء الان|مضمون|ضمان|أرباح مؤكدة|guaranteed|assurance|buy now)/i;
    return blockedPattern.test(text);
}

function generateSuggestedButtons(plannerResult: any, sessionState: any): string[] {
    const symbols = plannerResult?.entities?.symbols || [];
    if (symbols.length > 0) {
        const sym = symbols[0];
        return [
            `مقارنة ${sym} مع البنوك`,
            `أخبار ${sym} اليوم`,
            `تحليل السيولة لـ ${sym}`
        ];
    }
    const fallbackSymbols = sessionState?.last_symbols || [];
    if (fallbackSymbols.length > 0) {
        const sym = fallbackSymbols[0];
        return [
            `مقارنة ${sym} مع البنوك`,
            `أخبار ${sym} اليوم`,
            `تحليل السيولة لـ ${sym}`
        ];
    }
    return [
        "أقوى الأسهم النهارده",
        "مقارنة COMI و EAST",
        "البنوك حالتها إيه؟"
    ];
}

async function handleSessionResolution(
    supabase: any,
    userId: string,
    inputSessionId: string | null,
    message: string | null,
    hasImages: boolean
): Promise<string> {
    let activeSessionId = inputSessionId;
    let sessionExists = false;
    if (activeSessionId) {
        const { data: existing } = await supabase
            .from("ai_chat_sessions")
            .select("id")
            .eq("id", activeSessionId)
            .eq("user_id", userId)
            .maybeSingle();
        if (existing) sessionExists = true;
    }

    if (!activeSessionId || !sessionExists) {
        const sessionTitle = message?.trim().substring(0, 32) || (hasImages ? "تحليل صورة محفظة" : "محادثة جديدة");
        const insertPayload: any = {
            title: sessionTitle,
            user_id: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        if (activeSessionId) insertPayload.id = activeSessionId;

        const { data: newSession } = await supabase
            .from("ai_chat_sessions")
            .insert(insertPayload)
            .select("id")
            .single();

        if (newSession) activeSessionId = newSession.id;
    } else {
        await supabase
            .from("ai_chat_sessions")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", activeSessionId)
            .eq("user_id", userId);
    }

    return activeSessionId || `ses_${Date.now()}`;
}

export async function POST(req: NextRequest) {
    try {
        const totalRequestStartTime = Date.now();
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient();

        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
        }
        
        const userId = user.id;
        const body = await req.json();
        const { message, history, image, images, model: userRequestedModel, session_id: inputSessionId, stream } = body;

        const rawImages: string[] = Array.isArray(images) && images.length > 0 
            ? images 
            : (typeof image === "string" && image.startsWith("data:image/") ? [image] : []);
        
        const imageList = rawImages.filter(img => typeof img === "string" && img.startsWith("data:image/"));
        const hasImages = imageList.length > 0;

        if (!message && !hasImages) {
            return NextResponse.json({ detail: "Message or image is required" }, { status: 400 });
        }

        if (message && typeof message === "string" && !filterInput(message)) {
            return NextResponse.json({
                reply: "معذرة، لا يمكنني الاستجابة لهذه الرسالة بناءً على إرشادات الأمان والحماية الخاصة بالمنصة.",
                remaining_quota: 4
            });
        }

        const formattedHistory = Array.isArray(history)
            ? history
                .filter((item: any) => item && item.content && (item.role === "user" || item.role === "assistant"))
                .slice(-10)
                .map((item: any) => {
                    let contentStr = String(item.content)
                        .replace(/\s*✅\s*تحليل EGX Bots مبني على بيانات حية[^\n]*/g, "")
                        .trim();
                    if (contentStr.length > 500) {
                        contentStr = contentStr.substring(0, 500) + "...";
                    }
                    return { role: item.role, content: contentStr || "تحليل" };
                })
            : [];

        const userEmail = user.email || "";
        const isUnlimited = AI_CONFIG.unlimitedEmails.includes(userEmail) || AI_CONFIG.unlimitedEmails.includes(userEmail.toLowerCase());

        const today = new Date().toISOString().split("T")[0];
        let { data: limitData } = await supabase
            .from("ai_chatbot_limits")
            .select("chat_count")
            .eq("user_id", userId)
            .eq("date", today)
            .maybeSingle();

        if (!isUnlimited && limitData && limitData.chat_count >= AI_CONFIG.limits.dailyMessages) {
            return NextResponse.json({ detail: `Daily limit reached. You can send up to ${AI_CONFIG.limits.dailyMessages} messages per day.` }, { status: 429 });
        }

        const { data: dbSettings } = await supabase.from("ai_chatbot_settings").select("api_key").eq("id", 1).maybeSingle();
        const dbApiKey = dbSettings?.api_key || null;

        const keysToTry = Array.from(new Set([
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_SECONDARY_API_KEY,
            process.env.NVIDIA_NIM_API_KEY,
            dbApiKey
        ].filter((k): k is string => Boolean(k))));

        if (keysToTry.length === 0) {
            return NextResponse.json({ detail: "AI service not configured" }, { status: 500 });
        }

        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        const acceptHeader = req.headers.get("accept") || "";
        const isStreamingRequested = stream === true || stream === "true" || acceptHeader.includes("text/event-stream");

        if (isStreamingRequested) {
            const encoder = new TextEncoder();
            const customStream = new ReadableStream({
                async start(controller) {
                    const sendEvent = (data: any) => {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                    };

                    try {
                        // STEP 1: RESOLVE SESSION ID
                        sendEvent({ type: "status", status: "session", message: "Resolving session..." });
                        const activeSessionId = await handleSessionResolution(supabase, userId, inputSessionId, message, hasImages);
                        sendEvent({ type: "session_id", session_id: activeSessionId });

                        const sessionState = await loadSessionState(supabase, activeSessionId, userId);
                        const sessionSummary = await loadSessionSummary(supabase, activeSessionId, userId);

                        // Use new pipeline for streaming
                        const pipelineStream = runPipelineStream(
                            message || "",
                            imageList,
                            sessionState,
                            sessionSummary,
                            formattedHistory,
                            supabase,
                            keysToTry,
                            userId,
                            activeSessionId,
                            messageId
                        );

                        let fullResponse = "";
                        let plannerResult: any = null;
                        let liveDataString = "";
                        let plannerLatencyMs = 0;
                        let toolsLatencyMs = 0;
                        let responseLatencyMs = 0;
                        let toolsStartTime = 0;

                        for await (const event of pipelineStream) {
                            switch (event.type) {
                                case "status":
                                    sendEvent({ type: "status", status: event.data.status, message: event.data.message });
                                    break;
                                case "vision_result":
                                    sendEvent({ type: "vision", data: event.data });
                                    break;
                                case "plan":
                                    plannerResult = event.data;
                                    break;
                                case "tools_data":
                                    liveDataString = event.data.formattedText || "";
                                    break;
                                case "token":
                                    fullResponse += event.data;
                                    if (filterOutputBlocks(fullResponse)) {
                                        fullResponse = "أنا أداة تحليلية ذكية، ولا يمكنني تقديم نصائح مالية أو توصيات شراء مباشرة. يمكنك مراجعة تقييم الأسهم في صفحة الماسح الذكي لمساعدتك في اتخاذ القرار.";
                                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "token", content: fullResponse })}\n\n`));
                                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                                        controller.close();
                                        return;
                                    }
                                    sendEvent({ type: "token", content: event.data });
                                    break;
                                case "done":
                                    const replyText = filterOutput(event.data.response);
                                    const sessionUpdate = event.data.session_update;

                                    const newCount = (limitData?.chat_count || 0) + 1;

                                    // Save messages to DB
                                    try {
                                        if (activeSessionId) {
                                            await supabase.from("ai_chat_messages").insert([
                                                {
                                                    session_id: activeSessionId,
                                                    user_id: userId,
                                                    role: "user",
                                                    content: message || (hasImages ? "📷 [Image attached]" : ""),
                                                    image_url: imageList[0] || null,
                                                    created_at: new Date().toISOString()
                                                },
                                                {
                                                    session_id: activeSessionId,
                                                    user_id: userId,
                                                    role: "assistant",
                                                    content: replyText,
                                                    created_at: new Date().toISOString()
                                                }
                                            ]);
                                        }
                                    } catch (dbErr) {
                                        console.error("Failed to log chat messages to DB:", dbErr);
                                    }

                                    // Update Limits
                                    if (limitData) {
                                        await supabase
                                            .from("ai_chatbot_limits")
                                            .update({ chat_count: limitData.chat_count + 1 })
                                            .eq("user_id", userId)
                                            .eq("date", today);
                                    } else {
                                        await supabase
                                            .from("ai_chatbot_limits")
                                            .insert({ user_id: userId, date: today, chat_count: 1 });
                                    }

                                    const suggestedButtons = generateSuggestedButtons(plannerResult || {}, sessionState);
                                    const optimalModel = selectOptimalModel(plannerResult?.intent || "general_chat", plannerResult?.entities?.symbols?.length || 0, userRequestedModel);
                                    const totalLatencyMs = Date.now() - totalRequestStartTime;

                                    await logAiInteraction(supabase, {
                                        sessionId: activeSessionId,
                                        userId: userId,
                                        intent: plannerResult?.intent || "general_chat",
                                        symbols: plannerResult?.entities?.symbols || [],
                                        plannerModel: hasImages ? AI_CONFIG.models.planner.vision[0] : AI_CONFIG.models.planner.text[0],
                                        responseModel: optimalModel,
                                        plannerLatencyMs,
                                        toolsLatencyMs,
                                        responseLatencyMs,
                                        totalLatencyMs,
                                        dataSizeChars: liveDataString ? liveDataString.length : 0,
                                        error: null
                                    });

                                    sendEvent({
                                        type: "done",
                                        reply: replyText,
                                        session_id: activeSessionId,
                                        remaining_quota: isUnlimited ? 999 : Math.max(0, AI_CONFIG.limits.dailyMessages - newCount),
                                        suggested_buttons: suggestedButtons,
                                        session_state: sessionUpdate
                                    });

                                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                                    controller.close();
                                    return;
                            }
                        }
                    } catch (err: any) {
                        console.error("Streaming error:", err);
                        sendEvent({ type: "error", detail: err.message || "Streaming failed" });
                        controller.close();
                    }
                }
            });

            return new Response(customStream, {
                headers: {
                    "Content-Type": "text/event-stream; charset=utf-8",
                    "Cache-Control": "no-cache, no-transform",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no",
                },
            });
        }

        // --- NON-STREAMING JSON FALLBACK ---
        console.log(`[BOT STAGE] Starting non-streaming pipeline...`);
        const activeSessionId = await handleSessionResolution(supabase, userId, inputSessionId, message, hasImages);
        const sessionState = await loadSessionState(supabase, activeSessionId, userId);
        const sessionSummary = await loadSessionSummary(supabase, activeSessionId, userId);

        const pipelineResult = await runPipeline(
            message || "",
            imageList,
            sessionState,
            sessionSummary,
            formattedHistory,
            supabase,
            keysToTry,
            userId,
            activeSessionId,
            messageId
        );

        const replyText = filterOutput(pipelineResult.response);

        // Update Limits
        const newCount = (limitData?.chat_count || 0) + 1;
        if (limitData) {
            await supabase
                .from("ai_chatbot_limits")
                .update({ chat_count: limitData.chat_count + 1 })
                .eq("user_id", userId)
                .eq("date", today);
        } else {
            await supabase
                .from("ai_chatbot_limits")
                .insert({ user_id: userId, date: today, chat_count: 1 });
        }

        // Save messages to DB
        try {
            if (activeSessionId) {
                await supabase.from("ai_chat_messages").insert([
                    {
                        session_id: activeSessionId,
                        user_id: userId,
                        role: "user",
                        content: message || (hasImages ? "📷 [Image attached]" : ""),
                        image_url: imageList[0] || null,
                        created_at: new Date().toISOString()
                    },
                    {
                        session_id: activeSessionId,
                        user_id: userId,
                        role: "assistant",
                        content: replyText,
                        created_at: new Date().toISOString()
                    }
                ]);
            }
        } catch (dbErr) {
            console.error("Failed to log chat messages to DB:", dbErr);
        }

        const suggestedButtons = generateSuggestedButtons(pipelineResult.plan, sessionState);
        const totalLatencyMs = Date.now() - totalRequestStartTime;

        await logAiInteraction(supabase, {
            sessionId: activeSessionId,
            userId: userId,
            intent: pipelineResult.plan.intent,
            symbols: pipelineResult.plan.entities.symbols || [],
            plannerModel: hasImages ? AI_CONFIG.models.planner.vision[0] : AI_CONFIG.models.planner.text[0],
            responseModel: AI_CONFIG.models.response.default,
            plannerLatencyMs: 0,
            toolsLatencyMs: 0,
            responseLatencyMs: 0,
            totalLatencyMs,
            dataSizeChars: pipelineResult.tools?.formattedText?.length || 0,
            error: pipelineResult.vision_error
        });

        return NextResponse.json({
            reply: replyText,
            session_id: activeSessionId,
            remaining_quota: isUnlimited ? 999 : Math.max(0, AI_CONFIG.limits.dailyMessages - newCount),
            suggested_buttons: suggestedButtons,
            session_state: pipelineResult.session_update
        });

    } catch (error: any) {
        console.error("Critical Chat API Error:", error);
        return NextResponse.json({ detail: error.message || "Failed to process chat request." }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient();

        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
        }

        const userId = user.id;
        const { searchParams } = new URL(req.url);
        const action = searchParams.get("action");
        const sessionId = searchParams.get("session_id");

        if (action === "sessions") {
            const { data: sessions } = await supabase
                .from("ai_chat_sessions")
                .select("id, title, created_at, updated_at")
                .eq("user_id", userId)
                .order("updated_at", { ascending: false });

            const userEmail = user.email || "";
            const isUnlimited = AI_CONFIG.unlimitedEmails.includes(userEmail) || AI_CONFIG.unlimitedEmails.includes(userEmail.toLowerCase());
            const today = new Date().toISOString().split("T")[0];

            const { data: limitData } = await supabase
                .from("ai_chatbot_limits")
                .select("chat_count")
                .eq("user_id", userId)
                .eq("date", today)
                .maybeSingle();

            return NextResponse.json({
                sessions: sessions || [],
                remaining_quota: isUnlimited ? 999 : Math.max(0, AI_CONFIG.limits.dailyMessages - (limitData?.chat_count || 0))
            });
        }

        if (sessionId) {
            const { data: messages } = await supabase
                .from("ai_chat_messages")
                .select("role, content, image_url, created_at")
                .eq("session_id", sessionId)
                .eq("user_id", userId)
                .order("created_at", { ascending: true });

            const formattedHistory = (messages || []).map((m: any) => ({
                role: m.role,
                content: m.content,
                timestamp: new Date(m.created_at).getTime(),
                imageUrl: m.image_url || undefined
            }));

            return NextResponse.json({ history: formattedHistory });
        }

        return NextResponse.json({ detail: "Invalid request parameters" }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ detail: e.message || "Failed to fetch session data" }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient();

        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
        }

        const { session_id, title } = await req.json();
        if (!session_id || !title) {
            return NextResponse.json({ detail: "session_id and title required" }, { status: 400 });
        }

        await supabase
            .from("ai_chat_sessions")
            .update({ title, updated_at: new Date().toISOString() })
            .eq("id", session_id)
            .eq("user_id", user.id);

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ detail: e.message || "Failed to rename session" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient();

        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const sessionId = searchParams.get("session_id");

        if (!sessionId) {
            return NextResponse.json({ detail: "session_id required" }, { status: 400 });
        }

        await supabase.from("ai_chat_messages").delete().eq("session_id", sessionId).eq("user_id", user.id);
        await supabase.from("ai_chat_sessions").delete().eq("id", sessionId).eq("user_id", user.id);

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ detail: e.message || "Failed to delete session" }, { status: 500 });
    }
}
