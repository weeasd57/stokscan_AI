import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

import { loadSessionState, updateSessionState } from "@/lib/ai/session";
import { runPlanner } from "@/lib/ai/planner";
import { executeTools } from "@/lib/ai/tools";
import { generateFinalResponse, generateFinalStream } from "@/lib/ai/final";
import { selectOptimalModel } from "@/lib/ai/router";
import { AI_CONFIG } from "@/lib/ai/config";
import { logAiInteraction } from "@/lib/ai/logger";

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
                        // STEP 1: RESOLVE SESSION ID & LOAD SESSION
                        sendEvent({ type: "status", status: "session", message: "Resolving session..." });
                        let activeSessionId = inputSessionId;
                        try {
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
                        } catch (dbErr) {
                            console.error("[BOT STAGE] Error in session resolution:", dbErr);
                        }

                        sendEvent({ type: "session_id", session_id: activeSessionId });

                        const sessionState = await loadSessionState(supabase, activeSessionId, userId);

                        // STEP 2: RUN PLANNER
                        sendEvent({ type: "status", status: "planner", message: "Analyzing intent and planning tools..." });
                        const plannerStartTime = Date.now();
                        const plannerResult = await runPlanner(message || "", imageList, sessionState, formattedHistory, keysToTry);
                        const plannerLatencyMs = Date.now() - plannerStartTime;

                        // STEP 3: UPDATE SESSION
                        await updateSessionState(supabase, activeSessionId, userId, plannerResult.session_update);

                        // STEP 4: EXECUTE TOOLS
                        sendEvent({ type: "status", status: "tools", message: "Fetching market and financial data..." });
                        const toolsStartTime = Date.now();
                        const hasSymbolsInPlanner = Array.isArray(plannerResult.entities?.symbols) && plannerResult.entities.symbols.length > 0;
                        const liveDataString = (plannerResult.intent === "general_chat" && !hasSymbolsInPlanner) ? "" : await executeTools(supabase, plannerResult, message || "");
                        const toolsLatencyMs = Date.now() - toolsStartTime;

                        // STEP 5: STREAM FINAL LLM RESPONSE
                        sendEvent({ type: "status", status: "generating", message: "Generating response..." });

                        const aiMessages = [
                            { role: "system", content: "system" },
                            ...formattedHistory,
                            { 
                                role: "user", 
                                content: message || (hasImages ? "تحليل البيانات والصورة المرفقة" : "") 
                            }
                        ];

                        let fullResponse = "";
                        const responseStartTime = Date.now();
                        const streamGen = generateFinalStream(
                            message || "",
                            imageList,
                            liveDataString,
                            plannerResult,
                            aiMessages,
                            keysToTry,
                            userRequestedModel
                        );

                        for await (const chunk of streamGen) {
                            fullResponse += chunk;
                            sendEvent({ type: "token", content: chunk });
                        }
                        const responseLatencyMs = Date.now() - responseStartTime;

                        const replyText = filterOutput(fullResponse);

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

                        const newCount = (limitData?.chat_count || 0) + 1;

                        // Log Messages
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

                        let dynamicSuggestedButtons: string[] = [];
                        if (plannerResult.entities.symbols.length > 0) {
                            const sym = plannerResult.entities.symbols[0];
                            dynamicSuggestedButtons = [
                                `مقارنة ${sym} مع البنوك`,
                                `أخبار ${sym} اليوم`,
                                `تحليل السيولة لـ ${sym}`
                            ];
                        } else {
                            dynamicSuggestedButtons = [
                                "أقوى الأسهم النهارده",
                                "مقارنة COMI و EAST",
                                "البنوك حالتها إيه؟"
                            ];
                        }

                        const optimalModel = selectOptimalModel(plannerResult.intent, plannerResult.entities?.symbols?.length || 0, userRequestedModel);
                        const totalLatencyMs = Date.now() - totalRequestStartTime;

                        await logAiInteraction(supabase, {
                            sessionId: activeSessionId,
                            userId: userId,
                            intent: plannerResult.intent,
                            symbols: plannerResult.entities?.symbols || [],
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
                            suggested_buttons: dynamicSuggestedButtons,
                            session_state: plannerResult.session_update
                        });

                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                        controller.close();
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
        let activeSessionId = inputSessionId;
        try {
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
                console.log(`[BOT STAGE] Session ID ${activeSessionId || 'none'} not found in DB. Inserting new session...`);
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

                if (newSession) {
                    activeSessionId = newSession.id;
                    console.log(`[BOT STAGE] Created new session ID: ${activeSessionId}`);
                }
            } else {
                console.log(`[BOT STAGE] Session ID ${activeSessionId} verified in DB. Updating timestamp...`);
                await supabase
                    .from("ai_chat_sessions")
                    .update({ updated_at: new Date().toISOString() })
                    .eq("id", activeSessionId)
                    .eq("user_id", userId);
            }
        } catch (dbErr) {
            console.error("[BOT STAGE] Error in session resolution:", dbErr);
        }

        console.log(`[BOT STAGE] Loading session state for session ID: ${activeSessionId}...`);
        const sessionState = await loadSessionState(supabase, activeSessionId, userId);
        console.log(`[BOT STAGE] Session State loaded: Symbol = ${sessionState.current_symbol}, List = ${JSON.stringify(sessionState.last_symbols)}`);

        // --- STEP 2: RUN PLANNER ---
        console.log(`[BOT STAGE] Running planner model to detect intent and tools...`);
        const plannerStartTime = Date.now();
        const plannerResult = await runPlanner(message || "", imageList, sessionState, formattedHistory, keysToTry);
        const plannerLatencyMs = Date.now() - plannerStartTime;
        console.log(`[BOT STAGE] Planner output: Intent = ${plannerResult.intent}, Tools = ${JSON.stringify(plannerResult.tools)}, Symbols = ${JSON.stringify(plannerResult.entities?.symbols)}`);
        
        // --- STEP 3: UPDATE SESSION ---
        console.log(`[BOT STAGE] Updating session state in DB...`);
        await updateSessionState(supabase, activeSessionId, userId, plannerResult.session_update);

        // --- STEP 4: EXECUTE TOOLS ---
        const toolsStartTime = Date.now();
        const hasSymbolsInPlannerSync = Array.isArray(plannerResult.entities?.symbols) && plannerResult.entities.symbols.length > 0;
        const liveDataString = (plannerResult.intent === "general_chat" && !hasSymbolsInPlannerSync) ? "" : await executeTools(supabase, plannerResult, message || "");
        const toolsLatencyMs = Date.now() - toolsStartTime;
        console.log(`[BOT STAGE] Tools execution completed. Data size: ${liveDataString ? liveDataString.length : 0} chars.`);

        // --- STEP 5: FINAL LLM GENERATION ---
        const optimalModel = selectOptimalModel(plannerResult.intent, plannerResult.entities?.symbols?.length || 0, userRequestedModel);
        console.log(`[BOT STAGE] Starting final LLM generation using model: ${optimalModel}`);
        const aiMessages = [
            { role: "system", content: "system" },
            ...formattedHistory,
            { 
                role: "user", 
                content: message || (hasImages ? "تحليل البيانات والصورة المرفقة" : "") 
            }
        ];

        const isStreamRequest = stream === true || req.headers.get("x-stream") === "true";

        let dynamicSuggestedButtons: string[] = [];
        if (plannerResult.entities.symbols.length > 0) {
            const sym = plannerResult.entities.symbols[0];
            dynamicSuggestedButtons = [
                `مقارنة ${sym} مع البنوك`,
                `أخبار ${sym} اليوم`,
                `تحليل السيولة لـ ${sym}`
            ];
        } else {
            dynamicSuggestedButtons = [
                "أقوى الأسهم النهارده",
                "مقارنة COMI و EAST",
                "البنوك حالتها إيه؟"
            ];
        }

        if (isStreamRequest) {
            console.log(`[BOT STAGE] Streaming response requested - starting SSE stream...`);
            const encoder = new TextEncoder();
            const customStream = new ReadableStream({
                async start(controller) {
                    let fullReply = "";
                    const startTimeMain = Date.now();

                    try {
                        for await (const chunk of generateFinalStream(
                            message || "",
                            imageList,
                            liveDataString,
                            plannerResult,
                            aiMessages,
                            keysToTry,
                            userRequestedModel
                        )) {
                            fullReply += chunk;
                            controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: chunk })}\n\n`));
                        }

                        const responseLatencyMs = Date.now() - startTimeMain;
                        const cleanReply = filterOutput(fullReply);

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

                        const newCount = (limitData?.chat_count || 0) + 1;
                        const remainingQuota = isUnlimited ? 999 : Math.max(0, AI_CONFIG.limits.dailyMessages - newCount);

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
                                        content: cleanReply,
                                        created_at: new Date().toISOString()
                                    }
                                ]);
                            }
                        } catch (dbErr) {
                            console.error("Failed to log streaming chat messages to DB:", dbErr);
                        }

                        const totalLatencyMs = Date.now() - totalRequestStartTime;
                        await logAiInteraction(supabase, {
                            sessionId: activeSessionId,
                            userId: userId,
                            intent: plannerResult.intent,
                            symbols: plannerResult.entities?.symbols || [],
                            plannerModel: hasImages ? AI_CONFIG.models.planner.vision[0] : AI_CONFIG.models.planner.text[0],
                            responseModel: optimalModel,
                            plannerLatencyMs,
                            toolsLatencyMs,
                            responseLatencyMs,
                            totalLatencyMs,
                            dataSizeChars: liveDataString ? liveDataString.length : 0,
                            error: null
                        });

                        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ 
                            reply: cleanReply, 
                            session_id: activeSessionId, 
                            remaining_quota: remainingQuota, 
                            suggested_buttons: dynamicSuggestedButtons, 
                            session_state: plannerResult.session_update 
                        })}\n\n`));
                        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                        controller.close();
                    } catch (err: any) {
                        console.error("Error during streaming generation:", err);
                        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ detail: err.message || "Error generating stream response" })}\n\n`));
                        controller.close();
                    }
                }
            });

            return new Response(customStream, {
                headers: {
                    "Content-Type": "text/event-stream; charset=utf-8",
                    "Cache-Control": "no-cache, no-transform",
                    "Connection": "keep-alive",
                    "X-Accel-Buffering": "no"
                }
            });
        }

        const startTimeMain = Date.now();
        const replyTextRaw = await generateFinalResponse(
            message || "", 
            imageList, 
            liveDataString, 
            plannerResult, 
            aiMessages, 
            keysToTry, 
            userRequestedModel
        );
        const responseLatencyMs = Date.now() - startTimeMain;

        console.log(`[BOT STAGE] Main LLM response finished in ${responseLatencyMs}ms`);

        let replyText = filterOutput(replyTextRaw);

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

        const newCount = (limitData?.chat_count || 0) + 1;

        // Manage History Messages Logging
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

        const totalLatencyMs = Date.now() - totalRequestStartTime;

        await logAiInteraction(supabase, {
            sessionId: activeSessionId,
            userId: userId,
            intent: plannerResult.intent,
            symbols: plannerResult.entities?.symbols || [],
            plannerModel: hasImages ? AI_CONFIG.models.planner.vision[0] : AI_CONFIG.models.planner.text[0],
            responseModel: optimalModel,
            plannerLatencyMs,
            toolsLatencyMs,
            responseLatencyMs,
            totalLatencyMs,
            dataSizeChars: liveDataString ? liveDataString.length : 0,
            error: null
        });

        console.log(`[BOT STAGE] <<< Request completed successfully in ${totalLatencyMs}ms. Session ID: ${activeSessionId}`);

        return NextResponse.json({
            reply: replyText,
            session_id: activeSessionId,
            remaining_quota: isUnlimited ? 999 : Math.max(0, AI_CONFIG.limits.dailyMessages - newCount),
            suggested_buttons: dynamicSuggestedButtons,
            session_state: plannerResult.session_update
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
