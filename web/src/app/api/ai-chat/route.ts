import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";

import { loadSessionState, updateSessionState } from "@/lib/ai/session";
import { runPlanner } from "@/lib/ai/planner";
import { executeTools } from "@/lib/ai/tools";
import { generateFinalResponse } from "@/lib/ai/final";

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
        const { message, history, image, images, model: userRequestedModel, session_id: inputSessionId } = await req.json();

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
        const isUnlimited = ["weeessd57@gmail.com", "user@gmail.com", "weeasd57@gmail.com"].includes(userEmail.toLowerCase());

        const today = new Date().toISOString().split("T")[0];
        let { data: limitData } = await supabase
            .from("ai_chatbot_limits")
            .select("chat_count")
            .eq("user_id", userId)
            .eq("date", today)
            .maybeSingle();

        if (!isUnlimited && limitData && limitData.chat_count >= 15) {
            return NextResponse.json({ detail: "Daily limit reached. You can send up to 15 messages per day." }, { status: 429 });
        }

        const keysToTry = Array.from(new Set([
            process.env.NVIDIA_API_KEY,
            process.env.NVIDIA_SECONDARY_API_KEY,
            process.env.NVIDIA_NIM_API_KEY
        ].filter((k): k is string => Boolean(k))));

        if (keysToTry.length === 0) {
            return NextResponse.json({ detail: "AI service not configured" }, { status: 500 });
        }
        const apiKey = keysToTry[0];

        // --- STEP 1: RESOLVE SESSION ID & LOAD SESSION ---
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
                if (existing) {
                    sessionExists = true;
                }
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
                if (activeSessionId) {
                    insertPayload.id = activeSessionId;
                }

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
        const plannerResult = await runPlanner(message || "", imageList, sessionState, formattedHistory, keysToTry);
        console.log(`[BOT STAGE] Planner output: Intent = ${plannerResult.intent}, Tools = ${JSON.stringify(plannerResult.tools)}, Symbols = ${JSON.stringify(plannerResult.entities?.symbols)}`);
        
        // --- STEP 3: UPDATE SESSION ---
        console.log(`[BOT STAGE] Updating session state in DB...`);
        await updateSessionState(supabase, activeSessionId, userId, plannerResult.session_update);

        // --- STEP 4: EXECUTE TOOLS ---
        console.log(`[BOT STAGE] Executing database tools: ${JSON.stringify(plannerResult.tools)}...`);
        const liveDataString = await executeTools(supabase, plannerResult);
        console.log(`[BOT STAGE] Tools execution completed. Data size: ${liveDataString ? liveDataString.length : 0} chars.`);

        // --- STEP 5: FINAL LLM GENERATION ---
        console.log(`[BOT STAGE] Starting final LLM generation using model: ${userRequestedModel || "default"}`);
        const aiMessages = [
            { role: "system", content: "system" },
            ...formattedHistory,
            { 
                role: "user", 
                content: message || (hasImages ? "تحليل البيانات والصورة المرفقة" : "") 
            }
        ];

        // Prepare comparison fetch logic in a function
        const fetchComparisonPromise = async (): Promise<string> => {
            try {
                console.log("[BOT STAGE] Starting comparison model (DeepSeek V4 Flash) in parallel...");
                const finalSystemPrompt = `You are EGX Bots AI Assistant for the Egyptian Stock Exchange (EGX).
🚨 ZERO HALLUCINATION POLICY 🚨
Use ONLY provided data. Never invent financial information.
Respond in Arabic. Be factual and helpful.

${plannerResult.image_summary ? `\n=== IMAGE DATA ===\n${plannerResult.image_summary}\n=== END ===\n` : ""}
${liveDataString ? `\n=== DATABASE DATA ===\n${liveDataString}\n=== END ===\n` : ""}`;

                const sanitizedAiMessages = aiMessages.slice(1).map((msg: any) => {
                    if (Array.isArray(msg.content)) {
                        const textParts = msg.content
                            .filter((part: any) => part && part.type === "text" && part.text)
                            .map((part: any) => part.text)
                            .join(" ");
                        return { role: msg.role, content: textParts || message || "تحليل البيانات والصورة" };
                    }
                    return msg;
                });

                const messagesToSendCompare = [
                    { role: "system", content: finalSystemPrompt },
                    ...sanitizedAiMessages
                ];

                const key = keysToTry.find(k => k);
                if (key) {
                    const startCompTime = Date.now();
                    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${key}`
                        },
                        body: JSON.stringify({
                            model: "deepseek-ai/deepseek-v4-flash",
                            messages: messagesToSendCompare,
                            temperature: 0.2,
                            max_tokens: 1024
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        console.log(`[BOT STAGE] Comparison model (DeepSeek) finished in ${Date.now() - startCompTime}ms`);
                        return data.choices?.[0]?.message?.content || "";
                    } else {
                        return `Failed to fetch: ${res.status}`;
                    }
                }
                return "";
            } catch (err: any) {
                console.error("[BOT STAGE] Error in comparison model fetch:", err);
                return `Error: ${err.message}`;
            }
        };

        const startTimeMain = Date.now();
        // Run both fetches concurrently!
        const [replyTextRaw, debugModel2Raw] = await Promise.all([
            generateFinalResponse(
                message || "", 
                imageList, 
                liveDataString, 
                plannerResult, 
                aiMessages, 
                keysToTry, 
                userRequestedModel
            ),
            fetchComparisonPromise()
        ]);

        console.log(`[BOT STAGE] Main LLM response finished in ${Date.now() - startTimeMain}ms`);

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

        console.log(`[BOT STAGE] <<< Request completed successfully in ${Date.now() - totalRequestStartTime}ms. Session ID: ${activeSessionId}`);

        return NextResponse.json({
            reply: replyText,
            session_id: activeSessionId,
            remaining_quota: isUnlimited ? 999 : Math.max(0, 15 - newCount),
            suggested_buttons: dynamicSuggestedButtons,
            session_state: plannerResult.session_update,
            debug: {
                model_2_raw_response: debugModel2Raw
            }
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
            const isUnlimited = ["weeessd57@gmail.com", "user@gmail.com", "weeasd57@gmail.com"].includes(userEmail.toLowerCase());
            const today = new Date().toISOString().split("T")[0];

            const { data: limitData } = await supabase
                .from("ai_chatbot_limits")
                .select("chat_count")
                .eq("user_id", userId)
                .eq("date", today)
                .maybeSingle();

            return NextResponse.json({
                sessions: sessions || [],
                remaining_quota: isUnlimited ? 999 : Math.max(0, 15 - (limitData?.chat_count || 0))
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
