import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

import { loadSessionState, loadSessionSummary, updateSessionState, updateSessionSummary } from "@/lib/ai/session";
import { runPlanner } from "@/lib/ai/planner";
import { executeTools } from "@/lib/ai/tools";
import { selectOptimalModel } from "@/lib/ai/router";
import { AI_CONFIG } from "@/lib/ai/config";
import { logAiInteraction } from "@/lib/ai/logger";

import { extractExplicitSymbols, runPipeline, runPipelineStream } from "@/lib/ai/pipeline";
import { analyzeImage } from "@/lib/ai/vision";
import { retrieveRelevantMemory } from "@/lib/ai/memory";
import { executeStructuredTools } from "@/lib/ai/tools-v2";
import { generateV2Response, generateV2Stream } from "@/lib/ai/final-v2";
import { getDeepSeekApiKey, getNvidiaApiKeys, isUnlimitedChatUser } from "@/lib/ai/server-secrets";
import { uploadChatImages } from "@/lib/ai/chat-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BLOCKED_INPUT_PATTERNS = [
    "system prompt", "ignore previous instructions", "ignore all previous",
    "developer mode", "jailbreak", "admin_secret_key", "service_role_key",
    "بيانات سرية للمستخدمين", "كلمة سر السيرفر", "اختراق الموقع", "اختراق السيرفر", "اختراق النظام"
];

function filterInput(text: string): boolean {
    const lowered = text.toLowerCase();
    return !BLOCKED_INPUT_PATTERNS.some(pattern => lowered.includes(pattern));
}

function filterOutput(response: string): string {
    const blockedOutputRegex = /(اشتري الآن|شراء فوراً|شراء الان|أرباح مؤكدة|guaranteed profits|buy now)/i;
    const cleanResponse = response
        .replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, "")
        .replace(/<\s*environment_details\s*>[\s\S]*?(?:<\s*\/\s*environment_details\s*>|$)/gi, "")
        .replace(/\[?\s*environment_details\s*\]?[\s\S]*$/gi, "")
        .replace(/environment_details[\s\S]*$/gi, "")
        .replace(/Current time:\s*[^\n]+/gi, "")
        .replace(/Working directory:\s*[^\n]+/gi, "")
        .replace(/Workspace root folder:\s*[^\n]+/gi, "")
        .replace(/\[?environment_details\]?[\s\S]*$/gi, "")
        .trim();
    if (blockedOutputRegex.test(cleanResponse)) {
        return "أنا أداة تحليلية ذكية، ولا يمكنني تقديم نصائح مالية أو توصيات شراء مباشرة. يمكنك مراجعة تقييم الأسهم في صفحة الماسح الذكي لمساعدتك في اتخاذ القرار.";
    }
    return cleanResponse;
}

function filterOutputBlocks(text: string): boolean {
    const blockedPattern = /(اشتري الآن|شراء فوراً|شراء الان|أرباح مؤكدة|guaranteed profits|buy now)/i;
    return blockedPattern.test(text);
}

function isPotentialBlockedPrefix(text: string): boolean {
    const normalized = text.toLowerCase()
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .trim();

    const lastPart = normalized.slice(-20);
    const blockedPrefixes = [
        "اشتري", "شراء", "مضمون", "ضمان", "ارباح", "guar", "assur", "buy"
    ];

    for (const pref of blockedPrefixes) {
        for (let i = 1; i <= Math.min(lastPart.length, pref.length); i++) {
            const suffix = lastPart.slice(-i);
            if (pref.startsWith(suffix)) {
                return true;
            }
        }
    }
    return false;
}

function isPotentialEnvironmentPrefix(text: string): boolean {
    const suffix = text.toLowerCase().slice(-24);
    const marker = "<environment_details>";
    for (let length = 1; length <= marker.length; length++) {
        if (suffix.endsWith(marker.slice(0, length))) return true;
    }
    const plainMarker = "environment_details";
    for (let length = 1; length <= plainMarker.length; length++) if (suffix.endsWith(plainMarker.slice(0, length))) return true;
    return false;
}

function stripEnvironmentMetadata(text: string): string {
    const markerIndex = text.toLowerCase().indexOf("environment_details");
    if (markerIndex >= 0) text = text.slice(0, markerIndex).replace(/<\s*$/g, "");
    const clean = text
        .replace(/<\s*environment_details[^>]*>[\s\S]*$/gi, "")
        .replace(/<\s*environment_details[\s\S]*$/gi, "")
        .replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, "")
        .replace(/<environment_details[\s\S]*$/gi, "")
        .replace(/\[?environment_details\]?[\s\S]*$/gi, "")
        .replace(/Current time:\s*[^\n]+/gi, "")
        .replace(/Working directory:\s*[^\n]+/gi, "")
        .replace(/Workspace root folder:\s*[^\n]+/gi, "")
        .replace(/<\/?environment_details>/gi, "");
    return /environment_details|Current time:|Working directory:|Workspace root folder:/i.test(clean) ? "" : clean;
}

function containsEnvironmentMetadata(text: unknown): boolean {
    return /environment_details|Current time:|Working directory:|Workspace root folder:/i.test(String(text || ""));
}

function hasPartialEnvironmentMetadata(text: string): boolean {
    const normalized = text.toLowerCase();
    return /(?:<\s*environment_details?|environment_detail|current\s*time|working\s*directory|workspace\s*root)/i.test(normalized.slice(-80));
}

function sanitizeUserMessage(text: string): string {
    return stripEnvironmentMetadata(text).replace(/\s{2,}/g, " ").trim();
}

// The latency_ms column ships with migration 20260813_ai_chat_messages_latency_ms.
// Until that migration is applied to the live DB, any insert/select mentioning the
// column fails with a PostgREST schema error — retry without the column so chat
// logging and the admin history keep working either way.
function isMissingColumnError(error: any): boolean {
    const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
    return /42703|PGRST204|does not exist/i.test(text);
}

async function insertChatMessages(supabase: any, rows: any[]): Promise<void> {
    const { error } = await supabase.from("ai_chat_messages").insert(rows);
    if (!error) return;
    if (isMissingColumnError(error)) {
        const { error: retryError } = await supabase.from("ai_chat_messages").insert(
            rows.map((row) => { const { latency_ms, ...rest } = row; return rest; })
        );
        if (retryError) console.error("Failed to log chat messages to DB:", retryError);
        else console.warn("[ai-chat] latency_ms column not applied yet — messages logged without latency (run supabase/migrations/20260813_ai_chat_messages_latency_ms.sql)");
    } else {
        console.error("Failed to log chat messages to DB:", error);
    }
}

function generateSuggestedButtons(plannerResult: any, sessionState: any): string[] {
    const isRecQuery = Array.isArray(plannerResult?.tools) && plannerResult.tools.includes("get_recommendations");
    if (isRecQuery) {
        const filter = plannerResult?.entities?.recommendation_filter;
        if (filter === "this_week") {
            return [
                "عايز توصيات الاسبوع اللى فات",
                "هات كل التوصيات المفتوحه",
                "أقوى الأسهم النهارده"
            ];
        }
        if (filter === "last_week") {
            return [
                "عايز توصيات الاسبوع الحالى",
                "هات كل التوصيات المفتوحه",
                "أقوى الأسهم النهارده"
            ];
        }
        return [
            "عايز توصيات الاسبوع الحالى",
            "عايز توصيات الاسبوع اللى فات",
            "أقوى الأسهم النهارده"
        ];
    }
    if (plannerResult?.intent === "sector_analysis") {
        const sec = plannerResult?.entities?.sector;
        return [
            sec ? `أقوى أسهم قطاع ${sec}` : "أقوى قطاع بالسيولة",
            "هات كل التوصيات المفتوحه",
            "أقوى الأسهم النهارده"
        ];
    }
    if (plannerResult?.intent === "general_chat" || plannerResult?.intent === "market_summary") {
        return [
            "هات كل التوصيات المفتوحه",
            "أقوى الأسهم النهارده",
            "مقارنة COMI و EAST"
        ];
    }
    const symbols = plannerResult?.entities?.symbols || [];
    if (symbols.length > 0) {
        const sym = symbols[0];
        return [
            sym === "COMI" ? `مقارنة ${sym} مع EAST` : `مقارنة ${sym} مع COMI`,
            `أخبار ${sym} اليوم`,
            `تحليل السيولة لـ ${sym}`
        ];
    }
    const fallbackSymbols = sessionState?.last_symbols || [];
    if (fallbackSymbols.length > 0) {
        const sym = fallbackSymbols[0];
        return [
            sym === "COMI" ? `مقارنة ${sym} مع EAST` : `مقارنة ${sym} مع COMI`,
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

function sanitizeSuggestedButtons(buttons: unknown): string[] | undefined {
    if (!Array.isArray(buttons)) return undefined;
    const clean = buttons.map(button => stripEnvironmentMetadata(String(button)).replace(/\s*✅\s*تحليل EGX Bots مبني على بيانات حية[^\n]*/gi, "").trim()).filter(Boolean);
    return clean.length ? clean : undefined;
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
        const correlationId = req.headers.get("x-correlation-id")?.slice(0, 128) || crypto.randomUUID();
        const authClient = createSupabaseServerClient(req);
        const supabase = getSupabaseClient();

        const { data: { user }, error: authError } = await authClient.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
        }
        
        const userId = user.id;
        const isUnlimited = isUnlimitedChatUser(user);
        const body = await req.json();
        const rawMessage = typeof body.message === "string" ? body.message : "";
        const message = sanitizeUserMessage(rawMessage);
        const { history, image, images, model: userRequestedModel, session_id: inputSessionId, stream } = body;
        const clientMessageId = typeof body.client_message_id === "string" ? body.client_message_id.trim().slice(0, 128) : "";

        const rawImages: string[] = Array.isArray(images) && images.length > 0 
            ? images 
            : (typeof image === "string" && image.startsWith("data:image/") ? [image] : []);
        
        const allowedImageMime = /^data:image\/(jpeg|jpg|png|webp);base64,/i;
        const maxImageBytes = 5 * 1024 * 1024;
        const imageList = rawImages.filter(img =>
            typeof img === "string" && allowedImageMime.test(img) && Buffer.from(img.split(",", 2)[1] || "", "base64").byteLength <= maxImageBytes
        ).slice(0, 3);
        if (rawImages.length > 3 || imageList.length !== rawImages.length) {
            return NextResponse.json({ detail: "Images must be JPEG, PNG, or WebP and no larger than 5 MB each; maximum 3 images." }, { status: 400 });
        }
        if (message.length > 4000) return NextResponse.json({ detail: "Message is too long" }, { status: 413 });
        const hasImages = imageList.length > 0;

        if (!message && !hasImages) {
            return NextResponse.json({ detail: "Message or image is required" }, { status: 400 });
        }

        if (message && typeof message === "string" && !filterInput(message)) {
            return NextResponse.json({
                reply: "معذرة، لا يمكنني الاستجابة لهذه الرسالة بناءً على إرشادات الأمان والحماية الخاصة بالمنصة."
            });
        }



        if (clientMessageId) {
            const { data: existing } = await supabase.from("ai_chat_idempotency").select("status,response,updated_at,created_at").eq("user_id", userId).eq("client_message_id", clientMessageId).maybeSingle();
            if (existing?.status === "completed" && existing.response) return NextResponse.json({ reply: existing.response, duplicate: true });
            const reservationAge = existing ? Date.now() - Date.parse(existing.updated_at || existing.created_at) : 0;
            if (existing?.status === "processing" && reservationAge < 90000) return NextResponse.json({ detail: "Request already in progress" }, { status: 409 });
            if (existing) await supabase.from("ai_chat_idempotency").delete().eq("user_id", userId).eq("client_message_id", clientMessageId);
            const { error: reserveError } = await supabase.from("ai_chat_idempotency").insert({ user_id: userId, client_message_id: clientMessageId, status: "processing" });
            if (reserveError) return NextResponse.json({ detail: "Request already in progress" }, { status: 409 });
        }

        const today = new Date().toISOString().split("T")[0];
        let limitData: { chat_count: number } | null = null;
        if (!isUnlimited) {
            const { data: quotaRows, error: quotaError } = await supabase.rpc("consume_ai_chat_quota", { p_user_id: userId, p_date: today, p_limit: AI_CONFIG.limits.dailyMessages });
            if (quotaError) return NextResponse.json({ detail: "Unable to reserve chat quota" }, { status: 503 });
            const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;
            if (!quota?.allowed) return NextResponse.json({ detail: `Daily limit reached. You can send up to ${AI_CONFIG.limits.dailyMessages} messages per day.` }, { status: 429 });
            limitData = { chat_count: Number(quota.chat_count || 0) };
        }

        const keysToTry = getNvidiaApiKeys();

        if (!getDeepSeekApiKey() && keysToTry.length === 0) {
            return NextResponse.json({ detail: "AI service not configured" }, { status: 500 });
        }

        const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        const acceptHeader = req.headers.get("accept") || "";
        const isStreamingRequested = stream === true || stream === "true" || acceptHeader.includes("text/event-stream");

        if (isStreamingRequested) {
            const encoder = new TextEncoder();
            const customStream = new ReadableStream({
                async start(controller) {
                    let streamClosed = false;
                    const sendEvent = (data: any) => {
                        if (streamClosed) return;
                        try {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                        } catch (e: any) {
                            if (e.code !== 'ERR_INVALID_STATE') {
                                console.warn("Failed to enqueue event:", e.message);
                            }
                        }
                    };
                    const heartbeat = setInterval(() => sendEvent({ type: "heartbeat", timestamp: Date.now() }), 12000);

                    try {
                        // STEP 1: RESOLVE SESSION ID
                        sendEvent({ type: "status", status: "session", message: "Resolving session..." });
                        const activeSessionId = await handleSessionResolution(supabase, userId, inputSessionId, message, hasImages);
                        sendEvent({ type: "session_id", session_id: activeSessionId });

                        let permanentImageUrls: string[] = [];
                        if (hasImages) {
                            try {
                                permanentImageUrls = await uploadChatImages(supabase, userId, activeSessionId, imageList);
                                if (permanentImageUrls.length > 0) {
                                    sendEvent({ type: "image_urls", image_urls: permanentImageUrls });
                                }
                            } catch (uploadErr) {
                                console.warn("[ai-chat] Image upload to Supabase storage failed:", uploadErr);
                            }
                        }
                        const finalSavedImageUrl = permanentImageUrls[0] || (imageList[0]?.length < 1000 ? imageList[0] : null);

                        const { data: dbHistory } = await supabase
                            .from("ai_chat_messages")
                            .select("role, content")
                            .eq("session_id", activeSessionId)
                            .eq("user_id", userId)
                            .order("created_at", { ascending: false })
                            .limit(10);

                        const dbFormattedHistory = Array.isArray(dbHistory)
                            ? dbHistory
                                .reverse()
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

                        const sessionState = await loadSessionState(supabase, activeSessionId, userId);
                        const sessionSummary = await loadSessionSummary(supabase, activeSessionId, userId);
                        const explicitSymbols = extractExplicitSymbols(message || "");
                        if (explicitSymbols.length > 0) {
                            sessionState.current_symbol = explicitSymbols[0];
                            sessionState.last_symbols = explicitSymbols;
                        }

                        // Use new pipeline for streaming
                        const pipelineStream = runPipelineStream(
                            message || "",
                            imageList,
                            sessionState,
                            sessionSummary,
                            dbFormattedHistory,
                            supabase,
                            keysToTry,
                            userId,
                            activeSessionId,
                            messageId,
                            userRequestedModel
                        );

                        let fullResponse = "";
                        let tokenBuffer = "";
                        let plannerResult: any = null;
                        let liveDataString = "";
                        let plannerLatencyMs = 0;
                        let toolsLatencyMs = 0;
                        let responseLatencyMs = 0;
                        let toolsStartTime = 0;
                        let responseStartTime = 0;

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
                                    plannerLatencyMs = Date.now() - totalRequestStartTime;
                                    toolsStartTime = Date.now();
                                    break;
                                case "tools_data":
                                    liveDataString = event.data.formattedText || "";
                                    toolsLatencyMs = toolsStartTime ? Date.now() - toolsStartTime : 0;
                                    responseStartTime = Date.now();
                                    break;
                                case "tables":
                                    sendEvent({ type: "tables", data: event.data });
                                    break;
                                case "token":
                                    const rawToken = String(event.data || "");
                                    if (containsEnvironmentMetadata(rawToken) || hasPartialEnvironmentMetadata(rawToken)) break;
                                    fullResponse = stripEnvironmentMetadata(fullResponse + rawToken);
                                    if (filterOutputBlocks(fullResponse)) {
                                        fullResponse = "أنا أداة تحليلية ذكية، ولا يمكنني تقديم نصائح مالية أو توصيات شراء مباشرة. يمكنك مراجعة تقييم الأسهم في صفحة الماسح الذكي لمساعدتك في اتخاذ القرار.";
                                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "token", content: fullResponse })}\n\n`));
                                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                                        streamClosed = true;
                                        clearInterval(heartbeat);
                                        controller.close();
                                        return;
                                    }
                                    tokenBuffer = stripEnvironmentMetadata(tokenBuffer + rawToken);
                                    if (hasPartialEnvironmentMetadata(tokenBuffer)) {
                                        tokenBuffer = "";
                                        break;
                                    }
                                    if ((isPotentialBlockedPrefix(tokenBuffer) && tokenBuffer.length < 60) || isPotentialEnvironmentPrefix(tokenBuffer)) {
                                        // Buffering to avoid token leakage
                                    } else {
                                        if (tokenBuffer.length > 0) {
                                            sendEvent({ type: "token", content: tokenBuffer });
                                            tokenBuffer = "";
                                        }
                                    }
                                    break;
                                case "done":
                                    responseLatencyMs = responseStartTime ? Date.now() - responseStartTime : Math.max(0, Date.now() - totalRequestStartTime - plannerLatencyMs - toolsLatencyMs);
                                    const streamingTotalLatencyMs = Date.now() - totalRequestStartTime;
                                    if (tokenBuffer.length > 0) {
                                        const safeBuffer = stripEnvironmentMetadata(tokenBuffer);
                                        if (safeBuffer && !filterOutputBlocks(safeBuffer) && !containsEnvironmentMetadata(safeBuffer)) sendEvent({ type: "token", content: safeBuffer });
                                        tokenBuffer = "";
                                    }
                                    const replyText = filterOutput(stripEnvironmentMetadata(event.data.response));
                                    if (clientMessageId) await supabase.from("ai_chat_idempotency").update({ status: "completed", response: replyText, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("client_message_id", clientMessageId);
                                    const sessionUpdate = event.data.session_update;

                                    const newCount = limitData?.chat_count || 0;

                                    // Save messages to DB
                                    try {
                                        if (activeSessionId) {
                                            await insertChatMessages(supabase, [
                                                {
                                                    session_id: activeSessionId,
                                                    user_id: userId,
                                                    role: "user",
                                                    content: sanitizeUserMessage(message || (hasImages ? "📷 [Image attached]" : "")),
                                                    client_message_id: clientMessageId || null,
                                                    image_url: finalSavedImageUrl,
                                                    created_at: new Date().toISOString()
                                                },
                                                {
                                                    session_id: activeSessionId,
                                                    user_id: userId,
                                                    role: "assistant",
                                                    content: replyText,
                                                    latency_ms: streamingTotalLatencyMs,
                                                    created_at: new Date().toISOString()
                                                }
                                            ]);
                                        }
                                    } catch (dbErr) {
                                        console.error("Failed to log chat messages to DB:", dbErr);
                                    }

                                    const suggestedButtons = sanitizeSuggestedButtons(generateSuggestedButtons(plannerResult || {}, sessionState));
                                    const optimalModel = selectOptimalModel(plannerResult?.intent || "general_chat", plannerResult?.entities?.symbols?.length || 0, userRequestedModel);

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
                                        correlationId,
                                        totalLatencyMs: streamingTotalLatencyMs,
                                        dataSizeChars: liveDataString ? liveDataString.length : 0,
                                        error: null
                                    });

                                    sendEvent({
                                        type: "done",
                                        reply: replyText,
                                        session_id: activeSessionId,
                                        remaining_quota: isUnlimited ? 999 : Math.max(0, AI_CONFIG.limits.dailyMessages - newCount),
                                        suggested_buttons: suggestedButtons,
                                        session_state: sessionUpdate,
                                        tables: event.data.tables || [],
                                        latency_ms: streamingTotalLatencyMs
                                    });

                                    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                                    streamClosed = true;
                                    clearInterval(heartbeat);
                                    controller.close();
                                    return;
                            }
                        }
                    } catch (err: any) {
                        if (clientMessageId) await supabase.from("ai_chat_idempotency").delete().eq("user_id", userId).eq("client_message_id", clientMessageId);
                        if (err.code !== 'ERR_INVALID_STATE') {
                            console.error("Streaming error:", err);
                        }
                        const internalDetail = String(err?.message || "Streaming failed");
                        let friendlyDetail = "تعذر إكمال التحليل حاليًا. يرجى إعادة المحاولة.";
                        if (/PIPELINE_DEADLINE_EXCEEDED|DEADLINE|Timeout|AbortError/i.test(internalDetail)) {
                            friendlyDetail = "استغرق التحليل وقتًا أطول من المتوقع نظرًا لضغط السيرفرات حالياً. يرجى إعادة إرسال السؤال أو تجربة إرساله بدون صورة للحصول على رد فوري.";
                        }
                        sendEvent({ type: "error", detail: friendlyDetail });
                        streamClosed = true;
                        clearInterval(heartbeat);
                        try { controller.close(); } catch (e) {}
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

        let permanentImageUrls: string[] = [];
        if (hasImages) {
            try {
                permanentImageUrls = await uploadChatImages(supabase, userId, activeSessionId, imageList);
            } catch (uploadErr) {
                console.warn("[ai-chat] Image upload to Supabase storage failed:", uploadErr);
            }
        }
        const finalSavedImageUrl = permanentImageUrls[0] || (imageList[0]?.length < 1000 ? imageList[0] : null);

        const { data: dbHistory } = await supabase
            .from("ai_chat_messages")
            .select("role, content")
            .eq("session_id", activeSessionId)
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(10);

        const dbFormattedHistory = Array.isArray(dbHistory)
            ? dbHistory
                .reverse()
                .map((item: any) => {
                    let contentStr = stripEnvironmentMetadata(String(item.content))
                        .replace(/\s*✅\s*تحليل EGX Bots مبني على بيانات حية[^\n]*/g, "")
                        .trim();
                    if (contentStr.length > 500) {
                        contentStr = contentStr.substring(0, 500) + "...";
                    }
                    return { role: item.role, content: stripEnvironmentMetadata(contentStr) || "تحليل" };
                })
            : [];

        const sessionState = await loadSessionState(supabase, activeSessionId, userId);
        const sessionSummary = await loadSessionSummary(supabase, activeSessionId, userId);
        const explicitSymbols = extractExplicitSymbols(message || "");
        if (explicitSymbols.length > 0) {
            sessionState.current_symbol = explicitSymbols[0];
            sessionState.last_symbols = explicitSymbols;
        }

        const pipelineStartTime = Date.now();
        const pipelineResult = await runPipeline(
            message || "",
            imageList,
            sessionState,
            sessionSummary,
            dbFormattedHistory,
            supabase,
            keysToTry,
            userId,
            activeSessionId,
            messageId,
            userRequestedModel
        );

        const replyText = filterOutput(pipelineResult.response);
        if (clientMessageId) await supabase.from("ai_chat_idempotency").update({ status: "completed", response: replyText, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("client_message_id", clientMessageId);

        // Update Limits
        const newCount = limitData?.chat_count || 0;
        const totalLatencyMs = Date.now() - totalRequestStartTime;

        // Save messages to DB
        try {
            if (activeSessionId) {
                await insertChatMessages(supabase, [
                    {
                        session_id: activeSessionId,
                        user_id: userId,
                        role: "user",
                        content: message || (hasImages ? "📷 [Image attached]" : ""),
                        client_message_id: clientMessageId || null,
                        image_url: finalSavedImageUrl,
                        created_at: new Date().toISOString()
                    },
                    {
                        session_id: activeSessionId,
                        user_id: userId,
                        role: "assistant",
                        content: replyText,
                        latency_ms: totalLatencyMs,
                        created_at: new Date().toISOString()
                    }
                ]);
            }
        } catch (dbErr) {
            console.error("Failed to log chat messages to DB:", dbErr);
        }

        const suggestedButtons = sanitizeSuggestedButtons(generateSuggestedButtons(pipelineResult.plan, sessionState));

        await logAiInteraction(supabase, {
            sessionId: activeSessionId,
            userId: userId,
            intent: pipelineResult.plan.intent,
            symbols: pipelineResult.plan.entities.symbols || [],
            plannerModel: hasImages ? AI_CONFIG.models.planner.vision[0] : AI_CONFIG.models.planner.text[0],
            responseModel: AI_CONFIG.models.response.default,
            plannerLatencyMs: null,
            toolsLatencyMs: null,
            responseLatencyMs: null,
            correlationId,
            totalLatencyMs,
            dataSizeChars: pipelineResult.tools?.formattedText?.length || 0,
            error: pipelineResult.vision_error
        });

        return NextResponse.json({
            reply: replyText,
            tables: pipelineResult.tables,
            session_id: activeSessionId,
            remaining_quota: isUnlimited ? 999 : Math.max(0, AI_CONFIG.limits.dailyMessages - newCount),
            suggested_buttons: suggestedButtons,
            session_state: pipelineResult.session_update,
            latency_ms: totalLatencyMs
        });

    } catch (error: any) {
        console.error("Critical Chat API Error:", error);
        return NextResponse.json({ detail: "Failed to process chat request." }, { status: 500 });
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

            const today = new Date().toISOString().split("T")[0];
            const isUnlimited = isUnlimitedChatUser(user);

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
            let { data: messages, error: historyError } = await supabase
                .from("ai_chat_messages")
                .select("role, content, image_url, created_at, latency_ms")
                .eq("session_id", sessionId)
                .eq("user_id", userId)
                .order("created_at", { ascending: true });
            if (historyError && isMissingColumnError(historyError)) {
                const fallback = await supabase
                    .from("ai_chat_messages")
                    .select("role, content, image_url, created_at")
                    .eq("session_id", sessionId)
                    .eq("user_id", userId)
                    .order("created_at", { ascending: true });
                messages = fallback.data;
            }

            const formattedHistory = (messages || []).map((m: any) => ({
                role: m.role,
                content: stripEnvironmentMetadata(String(m.content || "")),
                timestamp: new Date(m.created_at).getTime(),
                imageUrl: m.image_url || undefined,
                latencyMs: typeof m.latency_ms === "number" && m.latency_ms > 0 ? m.latency_ms : undefined
            }));

            return NextResponse.json({ history: formattedHistory });
        }

        return NextResponse.json({ detail: "Invalid request parameters" }, { status: 400 });
    } catch (e: any) {
        return NextResponse.json({ detail: stripEnvironmentMetadata(e.message || "Failed to fetch session data") }, { status: 500 });
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
        return NextResponse.json({ detail: stripEnvironmentMetadata(e.message || "Failed to rename session") }, { status: 500 });
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
