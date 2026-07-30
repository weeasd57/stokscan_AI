import { IntentPlan, VisionContext, SessionState, SessionSummary, FactSnapshot, ToolResult, PipelineContext } from "./types";
import { analyzeImage } from "./vision";
import { retrieveRelevantMemory, MemoryResult } from "./memory";
import { runPlanner } from "./planner";
import { executeStructuredTools, StructuredToolOutput } from "./tools-v2";
import { generateV2Response, generateV2Stream } from "./final-v2";
import { loadSessionState, loadSessionSummary, updateSessionSummary, updateSessionState } from "./session";

export interface PipelineResult {
    vision: VisionContext | null;
    memory: MemoryResult | null;
    plan: IntentPlan;
    tools: StructuredToolOutput;
    response: string;
    session_update: {
        current_symbol: string | null;
        last_symbols: string[];
        summary: string | null;
    };
    vision_error: string | null;
}

async function saveFactSnapshots(
    supabase: any,
    userId: string,
    sessionId: string,
    tools: StructuredToolOutput,
    vision: VisionContext | null,
    messageId: string
): Promise<void> {
    try {
        const now = new Date().toISOString();
        const rows: any[] = [];

        if (vision && vision.symbols.length > 0) {
            rows.push({
                user_id: userId,
                session_id: sessionId,
                context_id: messageId,
                source: "vision_analysis",
                symbols: vision.symbols.map(s => s.symbol),
                as_of: now.split("T")[0],
                facts: {
                    image_type: vision.image_type,
                    symbol_names: vision.symbols.map(s => s.name).join(", "),
                    summary: vision.user_relevant_summary
                },
                data_type: "image-derived",
                created_at: now
            });
        }

        for (const result of tools.results) {
            if (!result.data || Object.keys(result.data).length === 0) continue;
            rows.push({
                user_id: userId,
                session_id: sessionId,
                context_id: messageId,
                source: result.source,
                symbols: result.symbols || [],
                as_of: result.data_time || now.split("T")[0],
                facts: result.data,
                data_type: result.data_type,
                created_at: now
            });
        }

        if (rows.length > 0) {
            await supabase.from("ai_chat_facts").insert(rows);
        }
    } catch (e) {
        console.warn("Failed to save fact snapshots:", e);
    }
}

function mergeVisionSymbols(planSymbols: string[], vision: VisionContext | null): string[] {
    if (!vision) return planSymbols;
    const visionSymbols = vision.symbols.map(s => s.symbol);
    return Array.from(new Set([...planSymbols, ...visionSymbols]));
}

export async function* runPipelineStream(
    userMessage: string,
    images: string[],
    sessionState: SessionState,
    sessionSummary: SessionSummary | null,
    history: Array<{ role: string; content: string }>,
    supabase: any,
    apiKeys: string[],
    userId: string,
    sessionId: string,
    messageId: string
): AsyncGenerator<{ type: string; data: any }> {
    const hasImages = images.length > 0;
    let vision: VisionContext | null = null;
    let visionError: string | null = null;
    let memory: MemoryResult | null = null;

    // ===== STAGE 1: Vision Analysis (isolated, multi-image support) =====
    if (hasImages) {
        yield { type: "status", data: { status: "vision", message: "تحليل الصور..." } };
        const allVisions: VisionContext[] = [];
        for (const img of images) {
            const visionResult = await analyzeImage(img, userMessage, apiKeys, messageId);
            if (visionResult.vision) {
                allVisions.push(visionResult.vision);
            }
            if (visionResult.error && !visionError) {
                visionError = visionResult.error;
            }
        }

        if (allVisions.length > 0) {
            vision = allVisions[0];
            if (allVisions.length > 1) {
                vision.symbols = Array.from(
                    new Map(allVisions.flatMap(v => v.symbols).map(s => [s.symbol.toUpperCase(), s])).values()
                );
                vision.technical_observations = allVisions.flatMap(v => v.technical_observations);
                vision.user_relevant_summary = allVisions.map(v => v.user_relevant_summary).join(" | ");
                vision.uncertainties = Array.from(new Set(allVisions.flatMap(v => v.uncertainties)));
                vision.confidence = allVisions.reduce((sum, v) => sum + v.confidence, 0) / allVisions.length;
            }

            yield { type: "vision_result", data: vision };
        } else if (visionError) {
            yield { type: "vision_error", data: visionError };
        }
    }

    // ===== STAGE 2: Memory Retrieval =====
    yield { type: "status", data: { status: "memory", message: "استرجاع السياق..." } };
    memory = await retrieveRelevantMemory(userMessage, sessionSummary, sessionState, history, supabase, userId, sessionId);

    // ===== STAGE 3: Intent / Entity Planner (no raw images — uses vision context) =====
    yield { type: "status", data: { status: "planner", message: "تحليل النية وتخطيط الأدوات..." } };
    const plannerResult = await runPlanner(
        userMessage,
        [], // Never pass raw images to planner when vision already analyzed
        sessionState,
        history,
        apiKeys,
        vision
    );

    const mergedSymbols = mergeVisionSymbols(plannerResult.entities.symbols || [], vision);

    const plan: IntentPlan = {
        intent: mapIntent(plannerResult.intent),
        confidence: plannerResult.confidence || 0.8,
        entities: {
            symbols: mergedSymbols,
            sector: plannerResult.entities.sector || null,
            timeframe: (plannerResult.entities.timeframe === "current" || plannerResult.entities.timeframe === "historical")
                ? plannerResult.entities.timeframe
                : "unspecified",
            reference: memory?.resolved_references?.symbol ? "last_image" : null
        },
        needs_vision_context: hasImages && !!vision,
        needs_history: memory?.resolved_references?.symbol !== null || plannerResult.intent === "general_chat",
        needs_live_data: !hasImages || plannerResult.intent === "comparison" || plannerResult.intent === "market_summary" || plannerResult.intent === "sector_analysis",
        needs_historical_data: userMessage.includes("قبل كده") || userMessage.includes("الفات") || userMessage.includes("السابقة"),
        tools: plannerResult.tools || [],
        clarification_needed: false,
        resolved_from: {
            symbol: memory?.resolved_references?.symbol || null,
            message_id: memory?.resolved_references?.message_id || null
        }
    };

    yield { type: "plan", data: plan };

    // ===== STAGE 4: Tools and Data Fetching =====
    if (plan.needs_live_data || plan.needs_historical_data) {
        yield { type: "status", data: { status: "tools", message: "جلب بيانات السوق..." } };
    }
    const tools = await executeStructuredTools(supabase, plan, apiKeys, userId, sessionId);
    if (tools.results.length > 0) {
        yield { type: "tools_data", data: tools };
    }

    await saveFactSnapshots(supabase, userId, sessionId, tools, vision, messageId);

    // ===== STAGE 5: Final Response =====
    yield { type: "status", data: { status: "generating", message: "إنشاء الرد..." } };
    const stream = generateV2Stream(
        userMessage, plan, vision, tools.results,
        memory?.relevant_snapshots || [],
        memory?.recent_messages || [],
        memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
        apiKeys
    );

    let fullResponse = "";
    for await (const chunk of stream) {
        fullResponse += chunk;
        yield { type: "token", data: chunk };
    }

    // ===== Update Session =====
    const allSymbols = new Set<string>();
    if (plan.entities.symbols) plan.entities.symbols.forEach(s => allSymbols.add(s));
    if (vision?.symbols) vision.symbols.forEach(s => allSymbols.add(s.symbol));
    if (memory?.resolved_references?.symbol) allSymbols.add(memory.resolved_references.symbol);

    const finalSymbols = Array.from(allSymbols).filter(Boolean);
    const sessionUpdate = {
        current_symbol: finalSymbols[0] || sessionState.current_symbol,
        last_symbols: Array.from(new Set([...finalSymbols, ...(sessionState.last_symbols || [])])).slice(0, 15),
        summary: userMessage || (hasImages ? "تحليل صورة" : null)
    };

    await updateSessionState(supabase, sessionId, userId, sessionUpdate);

    if (vision) {
        await updateSessionSummary(supabase, sessionId, userId, {
            last_image_symbols: vision.symbols.map(s => s.symbol),
            last_vision_context: vision,
            last_topic: vision.image_type
        });
    }

    yield { type: "done", data: { response: fullResponse, session_update: sessionUpdate } };
}

export async function runPipeline(
    userMessage: string,
    images: string[],
    sessionState: SessionState,
    sessionSummary: SessionSummary | null,
    history: Array<{ role: string; content: string }>,
    supabase: any,
    apiKeys: string[],
    userId: string,
    sessionId: string,
    messageId: string
): Promise<PipelineResult> {
    const hasImages = images.length > 0;
    let vision: VisionContext | null = null;
    let visionError: string | null = null;
    let memory: MemoryResult | null = null;

    // Stage 1: Vision (multi-image)
    if (hasImages) {
        const allVisions: VisionContext[] = [];
        for (const img of images) {
            const visionResult = await analyzeImage(img, userMessage, apiKeys, messageId);
            if (visionResult.vision) allVisions.push(visionResult.vision);
            if (visionResult.error && !visionError) visionError = visionResult.error;
        }

        if (allVisions.length > 0) {
            vision = allVisions[0];
            if (allVisions.length > 1) {
                vision.symbols = Array.from(
                    new Map(allVisions.flatMap(v => v.symbols).map(s => [s.symbol.toUpperCase(), s])).values()
                );
                vision.technical_observations = allVisions.flatMap(v => v.technical_observations);
                vision.user_relevant_summary = allVisions.map(v => v.user_relevant_summary).join(" | ");
                vision.confidence = allVisions.reduce((sum, v) => sum + v.confidence, 0) / allVisions.length;
            }
        }
    }

    // Stage 2: Memory
    memory = await retrieveRelevantMemory(userMessage, sessionSummary, sessionState, history, supabase, userId, sessionId);

    // Stage 3: Planner (no raw images)
    const plannerResult = await runPlanner(
        userMessage,
        [],
        sessionState,
        history,
        apiKeys,
        vision
    );

    const mergedSymbols = mergeVisionSymbols(plannerResult.entities.symbols || [], vision);

    const plan: IntentPlan = {
        intent: mapIntent(plannerResult.intent),
        confidence: plannerResult.confidence || 0.8,
        entities: {
            symbols: mergedSymbols,
            sector: plannerResult.entities.sector || null,
            timeframe: (plannerResult.entities.timeframe === "current" || plannerResult.entities.timeframe === "historical")
                ? plannerResult.entities.timeframe
                : "unspecified",
            reference: memory?.resolved_references?.symbol ? "last_image" : null
        },
        needs_vision_context: hasImages && !!vision,
        needs_history: memory?.resolved_references?.symbol !== null || plannerResult.intent === "general_chat",
        needs_live_data: !hasImages || plannerResult.intent === "comparison" || plannerResult.intent === "market_summary" || plannerResult.intent === "sector_analysis",
        needs_historical_data: userMessage.includes("قبل كده") || userMessage.includes("الفات") || userMessage.includes("السابقة"),
        tools: plannerResult.tools || [],
        clarification_needed: false,
        resolved_from: {
            symbol: memory?.resolved_references?.symbol || null,
            message_id: memory?.resolved_references?.message_id || null
        }
    };

    // Stage 4: Tools
    const tools = await executeStructuredTools(supabase, plan, apiKeys, userId, sessionId);

    await saveFactSnapshots(supabase, userId, sessionId, tools, vision, messageId);

    // Stage 5: Response
    const response = await generateV2Response(
        userMessage, plan, vision, tools.results,
        memory?.relevant_snapshots || [],
        memory?.recent_messages || [],
        memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
        apiKeys
    );

    const allSymbols = new Set<string>();
    if (plan.entities.symbols) plan.entities.symbols.forEach(s => allSymbols.add(s));
    if (vision?.symbols) vision.symbols.forEach(s => allSymbols.add(s.symbol));

    const finalSymbols = Array.from(allSymbols).filter(Boolean);
    const sessionUpdate = {
        current_symbol: finalSymbols[0] || sessionState.current_symbol,
        last_symbols: Array.from(new Set([...finalSymbols, ...(sessionState.last_symbols || [])])).slice(0, 15),
        summary: userMessage || (hasImages ? "تحليل صورة" : null)
    };

    await updateSessionState(supabase, sessionId, userId, sessionUpdate);
    if (vision) {
        await updateSessionSummary(supabase, sessionId, userId, {
            last_image_symbols: vision.symbols.map(s => s.symbol),
            last_vision_context: vision,
            last_topic: vision.image_type
        });
    }

    return {
        vision,
        memory,
        plan,
        tools,
        response,
        session_update: sessionUpdate,
        vision_error: visionError
    };
}

function mapIntent(intent: string): IntentPlan["intent"] {
    const intentMap: Record<string, IntentPlan["intent"]> = {
        "chart_analysis": "image_analysis",
        "portfolio": "image_analysis",
        "market_depth": "image_analysis",
        "stock_analysis": "stock_analysis",
        "sector_analysis": "sector_analysis",
        "comparison": "comparison",
        "market_summary": "market_summary",
        "recommendation": "stock_analysis",
        "accumulation": "stock_analysis",
        "stock_news": "stock_analysis",
        "general_chat": "general_chat"
    };
    return intentMap[intent] || "follow_up";
}