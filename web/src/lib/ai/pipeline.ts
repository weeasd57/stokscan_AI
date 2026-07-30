import { IntentPlan, VisionContext, SessionState, SessionSummary } from "./types";
import { analyzeImage } from "./vision";
import { retrieveRelevantMemory, MemoryResult } from "./memory";
import { runPlanner } from "./planner";
import { executeStructuredTools, StructuredToolOutput } from "./tools-v2";
import { generateV2Response, generateV2Stream } from "./final-v2";
import { loadSessionState, loadSessionSummary, updateSessionSummary, updateSessionState } from "./session";
import { buildExcelTables, ExcelTable, tablesToMarkdown } from "./excel-tables";

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
    tables: ExcelTable[];
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

export function enforceIntentFromMessage(message: string, plannerIntent: string, symbols: string[]): {
    intent: string;
    tools: string[];
    replaceTools?: boolean;
} {
    const normalized = message.toLowerCase();
    const hasExplicitSymbol = symbols.length > 0 || /\b[A-Z]{2,6}\b/.test(message);
    const decisionQuestion = /(أبيع|ابيع|بيع|أحتفظ|احتفظ|أخرج|اخرج|أشتري|اشتري|شراء|بيع الآن|أبيع الآن)/i.test(normalized);
    if (decisionQuestion && hasExplicitSymbol) {
        return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
    }

    const liquidityQuery = /(السيول|السيوله|تجميع|تصريف|فين.*السوق|where.*liquidity|market liquidity)/i.test(normalized);
    if (liquidityQuery && !hasExplicitSymbol) {
        return { intent: normalized.includes("تجميع") || normalized.includes("تصريف") ? "accumulation" : "market_summary", tools: ["get_market", "get_accumulation_stocks"] };
    }

    if (/(البنوك|بنوك|قطاع البنوك|banking sector|banks)/i.test(normalized)) {
        return { intent: "sector_analysis", tools: ["get_sector"] };
    }

    return { intent: plannerIntent, tools: [] };
}

export function buildMarketLiquidityResponse(tools: StructuredToolOutput): string | null {
    const marketResult = tools.results.find(result => result.tool === "get_market");
    const market = marketResult?.data;
    const accumulation = tools.results.find(result => result.tool === "get_accumulation_stocks");
    if (!market && !accumulation) return null;

    const lines = ["### ملخص سيولة السوق", "", "البيانات التالية وصفية ومأخوذة من المسح الفعلي، وليست توصية شراء أو بيع."];
    if (market?.regime) lines.push(`- حالة السوق: ${market.regime}`);
    if (market?.egx30 != null) lines.push(`- EGX30: ${market.egx30} نقطة`);
    if (market?.usd != null) lines.push(`- USD/EGP: ${market.usd} جنيه`);

    // Top Gainers
    if (market?.top_gainers && Array.isArray(market.top_gainers) && market.top_gainers.length > 0) {
        lines.push("", `📈 **أعلى الأسهم ارتفاعاً اليوم (${marketResult?.data_time?.split("T")[0] || ""}):**`);
        market.top_gainers.forEach((stock: any, index: number) => {
            const changeVal = stock.change ?? stock.change_pct ?? 0;
            const changeStr = typeof changeVal === "number" 
                ? `${changeVal >= 0 ? "+" : ""}${changeVal.toFixed(2)}%`
                : changeVal;
            lines.push(`${index + 1}. **${stock.symbol}**: ${changeStr}`);
        });
    }

    // Top Losers
    if (market?.top_losers && Array.isArray(market.top_losers) && market.top_losers.length > 0) {
        lines.push("", `📉 **أعلى الأسهم انخفاضاً اليوم (${marketResult?.data_time?.split("T")[0] || ""}):**`);
        market.top_losers.forEach((stock: any, index: number) => {
            const changeVal = stock.change ?? stock.change_pct ?? 0;
            const changeStr = typeof changeVal === "number" 
                ? `${changeVal >= 0 ? "+" : ""}${changeVal.toFixed(2)}%`
                : changeVal;
            lines.push(`${index + 1}. **${stock.symbol}**: ${changeStr}`);
        });
    }

    const stocks = Array.isArray(accumulation?.data?.stocks) ? accumulation.data.stocks.slice(0, 8) : [];
    if (stocks.length > 0) {
        lines.push("", `📊 **أعلى أسهم التجميع والسيولة المؤسسية في بيانات ${accumulation?.data_time}:**`);
        stocks.forEach((stock: any, index: number) => {
            const score = stock.acc_score != null ? `، درجة التجميع ${stock.acc_score}/100` : "";
            const ratio = stock.vol_ratio != null ? `، نسبة الحجم ${stock.vol_ratio}x` : "";
            const change = stock.change_pct != null ? `، التغير ${stock.change_pct}%` : "";
            lines.push(`${index + 1}. **${stock.symbol}**${score}${ratio}${change}`);
        });
    } else {
        lines.push("", "لا توجد حالياً قائمة موثقة لأسهم التجميع والسيولة المؤسسية في أحدث مسح.");
    }

    lines.push("", "ملاحظة: لا يتم استخدام RSI أو MACD لقياس سيولة السوق الكلية، ولا توجد نسبة حجم واحدة تمثل السوق كله في البيانات الحالية.");
    return lines.join("\n");
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
    const enforced = enforceIntentFromMessage(userMessage, plannerResult.intent, mergedSymbols);

    const plan: IntentPlan = {
        intent: mapIntent(enforced.intent),
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
        needs_live_data: !hasImages || enforced.intent === "comparison" || enforced.intent === "market_summary" || enforced.intent === "sector_analysis" || enforced.intent === "accumulation",
        needs_historical_data: userMessage.includes("قبل كده") || userMessage.includes("الفات") || userMessage.includes("السابقة"),
        tools: enforced.replaceTools ? enforced.tools : Array.from(new Set([...(plannerResult.tools || []), ...enforced.tools])),
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
    const tables = buildExcelTables(tools.results, vision);
    if (tables.length > 0) yield { type: "tables", data: tables };
    if (tools.results.length > 0) {
        yield { type: "tools_data", data: tools };
    }

    await saveFactSnapshots(supabase, userId, sessionId, tools, vision, messageId);

    // ===== STAGE 5: Final Response =====
    const deterministicLiquidityResponse = plan.intent === "market_summary" && plan.entities.symbols.length === 0
        ? buildMarketLiquidityResponse(tools)
        : null;
    if (deterministicLiquidityResponse) {
        const tableMarkdown = tablesToMarkdown(tables);
        const response = tableMarkdown ? `${tableMarkdown}\n\n${deterministicLiquidityResponse}` : deterministicLiquidityResponse;
        yield { type: "token", data: response };
        await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
        yield { type: "done", data: { response, session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: userMessage }, tables } };
        return;
    }

    // ===== STAGE 5: Final Response =====
    yield { type: "status", data: { status: "generating", message: "إنشاء الرد..." } };
    const stream = generateV2Stream(
        userMessage, plan, vision, tools.results,
        memory?.relevant_snapshots || [],
        memory?.recent_messages || [],
        memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
        apiKeys
    );

    const tableMarkdown = tablesToMarkdown(tables);
    let fullResponse = tableMarkdown ? `${tableMarkdown}\n\n` : "";
    let pendingModelText = "";
    for await (const chunk of stream) {
        pendingModelText += chunk;
        const lines = pendingModelText.split("\n");
        pendingModelText = lines.pop() || "";
        for (const line of lines) {
            if (isMarkdownTableLine(line)) continue;
            fullResponse += `${line}\n`;
            yield { type: "token", data: `${line}\n` };
        }
    }
    if (pendingModelText && !isMarkdownTableLine(pendingModelText)) {
        fullResponse += pendingModelText;
        yield { type: "token", data: pendingModelText };
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

    const summaryUpdate: Partial<SessionSummary> = {
        current_symbols: finalSymbols,
        last_data_date: new Date().toISOString().split("T")[0]
    };
    if (vision) {
        summaryUpdate.last_image_symbols = vision.symbols.map(s => s.symbol);
        summaryUpdate.last_vision_context = vision;
        summaryUpdate.last_topic = vision.image_type;
    }
    if (memory?.resolved_references?.symbol) {
        summaryUpdate.open_references = [memory.resolved_references.symbol];
    }
    await updateSessionSummary(supabase, sessionId, userId, summaryUpdate);

    yield { type: "done", data: { response: fullResponse, session_update: sessionUpdate, tables } };
}

function isMarkdownTableLine(line: string): boolean {
    const trimmed = line.trim();
    return (trimmed.startsWith("|") && trimmed.endsWith("|")) || /^\|[\s:|-]+\|$/.test(trimmed);
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
    const enforced = enforceIntentFromMessage(userMessage, plannerResult.intent, mergedSymbols);

    const plan: IntentPlan = {
        intent: mapIntent(enforced.intent),
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
        needs_live_data: !hasImages || enforced.intent === "comparison" || enforced.intent === "market_summary" || enforced.intent === "sector_analysis" || enforced.intent === "accumulation",
        needs_historical_data: userMessage.includes("قبل كده") || userMessage.includes("الفات") || userMessage.includes("السابقة"),
        tools: enforced.replaceTools ? enforced.tools : Array.from(new Set([...(plannerResult.tools || []), ...enforced.tools])),
        clarification_needed: false,
        resolved_from: {
            symbol: memory?.resolved_references?.symbol || null,
            message_id: memory?.resolved_references?.message_id || null
        }
    };

    // Stage 4: Tools
    const tools = await executeStructuredTools(supabase, plan, apiKeys, userId, sessionId);
    const tables = buildExcelTables(tools.results, vision);

    await saveFactSnapshots(supabase, userId, sessionId, tools, vision, messageId);

    // Stage 5: Response
    const deterministicLiquidityResponse = plan.intent === "market_summary" && plan.entities.symbols.length === 0
        ? buildMarketLiquidityResponse(tools)
        : null;
    const generatedResponse = deterministicLiquidityResponse || await generateV2Response(
        userMessage, plan, vision, tools.results,
        memory?.relevant_snapshots || [],
        memory?.recent_messages || [],
        memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
        apiKeys
    );
    const tableMarkdown = tablesToMarkdown(tables);
    const response = tableMarkdown ? `${tableMarkdown}\n\n${generatedResponse}` : generatedResponse;

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
    const summaryUpdate: Partial<SessionSummary> = {
        current_symbols: finalSymbols,
        last_data_date: new Date().toISOString().split("T")[0]
    };
    if (vision) {
        summaryUpdate.last_image_symbols = vision.symbols.map(s => s.symbol);
        summaryUpdate.last_vision_context = vision;
        summaryUpdate.last_topic = vision.image_type;
    }
    if (memory?.resolved_references?.symbol) {
        summaryUpdate.open_references = [memory.resolved_references.symbol];
    }
    await updateSessionSummary(supabase, sessionId, userId, summaryUpdate);

    return {
        vision,
        memory,
        plan,
        tools,
        response,
        session_update: sessionUpdate,
        vision_error: visionError,
        tables
    };
}

async function persistPipelineSession(
    sessionState: SessionState,
    sessionSummary: SessionSummary | null,
    plan: IntentPlan,
    vision: VisionContext | null,
    memory: MemoryResult | null,
    sessionId: string,
    userId: string,
    supabase: any,
    hasImages: boolean
): Promise<void> {
    const symbols = plan.entities.symbols || [];
    const sessionUpdate = {
        current_symbol: symbols[0] || sessionState.current_symbol,
        last_symbols: Array.from(new Set([...symbols, ...(sessionState.last_symbols || [])])).slice(0, 15),
        summary: hasImages ? "تحليل صورة" : sessionState.summary
    };
    await updateSessionState(supabase, sessionId, userId, sessionUpdate);
    await updateSessionSummary(supabase, sessionId, userId, {
        current_symbols: symbols,
        last_image_symbols: vision?.symbols.map(symbol => symbol.symbol) || sessionSummary?.last_image_symbols || [],
        last_topic: vision?.image_type || sessionSummary?.last_topic || null,
        open_references: memory?.resolved_references?.symbol ? [memory.resolved_references.symbol] : sessionSummary?.open_references || [],
        last_data_date: new Date().toISOString().split("T")[0],
        last_vision_context: vision || sessionSummary?.last_vision_context || null
    });
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
        "current_data": "stock_analysis",
        "previous_analysis_comparison": "historical_recall",
        "recommendation": "stock_analysis",
        "accumulation": "stock_analysis",
        "stock_news": "stock_analysis",
        "historical_recall": "historical_recall",
        "general_chat": "general_chat"
    };
    return intentMap[intent] || "follow_up";
}
