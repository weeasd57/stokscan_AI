import { IntentPlan, VisionContext, SessionState, SessionSummary, PlannerResult } from "./types";
import { analyzeImage } from "./vision";
import { retrieveRelevantMemory, MemoryResult } from "./memory";
import { runPlanner } from "./planner";
import { executeStructuredTools, StructuredToolOutput } from "./tools-v2";
import { generateV2Response, generateV2Stream } from "./final-v2";
import { loadSessionState, loadSessionSummary, updateSessionSummary, updateSessionState } from "./session";
import { buildExcelTables, ExcelTable } from "./excel-tables";

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
    if (!vision || vision.confidence < 0.5) return planSymbols;
    const visionSymbols = vision.symbols.map(s => s.symbol);
    return Array.from(new Set([...planSymbols, ...visionSymbols]));
}

export function extractExplicitSymbols(message: string): string[] {
    const excluded = new Set(["EGX", "NEWS", "TODAY", "LAST", "WEEK", "FROM", "BETWEEN", "RSI", "MACD", "VWAP"]);
    const explicit = message.match(/\b[A-Z][A-Z0-9]{1,9}\b/g) || [];
    const lowercaseTickers = message.match(/\b[a-z][a-z0-9]{2,5}\b/g) || [];
    return Array.from(new Set(
        [...explicit, ...lowercaseTickers]
            .map(symbol => symbol.toUpperCase() === "AFID" ? "AFDI" : symbol.toUpperCase())
            .filter(symbol => !excluded.has(symbol))
    ));
}

export function extractRequestedDate(message: string): string | null {
    const isoMatch = message.match(/(?:^|\s)(\d{4})-(\d{1,2})-(\d{1,2})(?:\s|$|[؟?])/);
    if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
    }
    const match = message.match(/(?:^|\s)(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?(?:\s|$|[؟?])/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = match[3] ? Number(match[3]) : new Date().getFullYear();
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function extractTemporalContext(message: string): { date: string | null; timeframe: "current" | "historical" | "unspecified" } {
    if (extractRequestedDateRange(message)) return { date: null, timeframe: "historical" };
    const date = extractRequestedDate(message);
    if (date) return { date, timeframe: "historical" };
    if (/(امبارح|امس|أمس|البارح|السابق|اللي فات|قبل كده|من شوية|الأسبوع اللي فات|الشهر اللي فات)/i.test(message)) {
        return { date: null, timeframe: "historical" };
    }
    if (/(النهارده|اليوم|دلوقتي|حاليا|حاليًا|الان|الآن)/i.test(message)) {
        return { date: new Date().toISOString().slice(0, 10), timeframe: "current" };
    }
    return { date: null, timeframe: "unspecified" };
}

export function extractRequestedDateRange(message: string, referenceDate: Date = new Date()): { start: string; end: string } | null {
    const explicitRange = message.match(/(?:مابين|ما\s*بين|بين|من)\s*(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?\s*(?:لحد|الى|إلى|ل|و|-)\s*(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?/i);
    if (explicitRange) {
        const defaultYear = referenceDate.getUTCFullYear();
        const startYear = explicitRange[3] ? Number(explicitRange[3]) : defaultYear;
        const endYear = explicitRange[6] ? Number(explicitRange[6]) : startYear;
        const toIso = (day: number, month: number, year: number) => {
            const value = new Date(Date.UTC(year, month - 1, day));
            if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return null;
            return value.toISOString().slice(0, 10);
        };
        const first = toIso(Number(explicitRange[1]), Number(explicitRange[2]), startYear);
        const second = toIso(Number(explicitRange[4]), Number(explicitRange[5]), endYear);
        if (!first || !second) return null;
        return first <= second ? { start: first, end: second } : { start: second, end: first };
    }

    if (!/(الاسبوع|الأسبوع)\s+(اللي|اللى)\s+فات|الاسبوع\s+السابق|الأسبوع\s+السابق|last\s+week/i.test(message)) return null;

    const current = new Date(Date.UTC(
        referenceDate.getUTCFullYear(),
        referenceDate.getUTCMonth(),
        referenceDate.getUTCDate()
    ));
    const daysSinceMonday = (current.getUTCDay() + 6) % 7;
    const thisMonday = new Date(current);
    thisMonday.setUTCDate(current.getUTCDate() - daysSinceMonday);
    const start = new Date(thisMonday);
    start.setUTCDate(thisMonday.getUTCDate() - 7);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function buildDeterministicPlannerResult(message: string, sessionState: SessionState): PlannerResult | null {
    const symbols = extractExplicitSymbols(message);
    const temporal = extractTemporalContext(message);
    const marketWideRequest = isMarketWideRequest(message);
    const hasPreviousReference = /(?:^|[^\u0621-\u064A])(ده|دا|دي|هذا|السهم ده|السهم دا|السهم دي|هاته|هاتها|الاتنين|السهمين)(?:$|[^\u0621-\u064A])/i.test(message);
    if (hasPreviousReference && sessionState.current_symbol && !symbols.includes(sessionState.current_symbol)) {
        symbols.unshift(sessionState.current_symbol);
    }
    if (temporal.date && symbols.length === 0 && sessionState.current_symbol && !marketWideRequest) {
        symbols.push(sessionState.current_symbol);
    }
    const sector = extractSectorFromMessage(message);
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    const isGreeting = /(ازيك|إزيك|عامل ايه|عامل إيه|اهلا|أهلا|مرحبا|السلام عليكم)/i.test(message);
        const isHistorical = needsHistoricalData("", message);
    const requestedDate = temporal.date;
    const isClearMarketRequest = /(أعلى|اعلى|أقوى|اقوى|السيول|السيوله|تجميع|تصريف|حالة السوق|السوق عمل|دولار|usd)/i.test(normalized);
    const isClearStockRequest = symbols.length > 0 && /(أخبار|اخبار|خبر|news|مقارن|قارن|compare|تحليل|حلل|السيول|السيوله|سعر|بيع|احتفظ|أحتفظ|^[\s,،;:/\-a-z0-9]+$)/i.test(message);
    if (!sector && !isGreeting && !isHistorical && !requestedDate && !isClearMarketRequest && !isClearStockRequest) return null;

    const enforced = enforceIntentFromMessage(message, symbols.length ? "stock_analysis" : "market_summary", symbols);
    return {
        intent: isGreeting ? "general_chat" : requestedDate && symbols.length ? "stock_analysis" : isHistorical ? "historical_recall" : enforced.intent,
        confidence: 1,
        entities: { symbols, sector, wants_table: !isGreeting, timeframe: temporal.timeframe, requested_date: requestedDate },
        tools: isGreeting || (isHistorical && !requestedDate) ? [] : enforced.replaceTools ? enforced.tools : sector ? ["get_sector"] : symbols.length ? ["get_stock"] : [],
        session_update: {
            current_symbol: symbols[0] || sessionState.current_symbol,
            last_symbols: symbols.length ? symbols : sessionState.last_symbols,
            summary: message
        }
    };
}

export function isMarketWideRequest(message: string): boolean {
    const normalized = message.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
    return /(اخبار\s+(السوق|البورصه)|(?:السيول|السيوله)\s+(فين|في\s+السوق|ل?يوم|لبوم|بتاريخ|يوم)|حاله\s+السوق|السوق\s+عمل|(?:اقوى|اعلى)\s+الاسهم)/i.test(normalized);
}

export function enforceIntentFromMessage(message: string, plannerIntent: string, symbols: string[]): {
    intent: string;
    tools: string[];
    replaceTools?: boolean;
    sector?: string;
} {
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    const hasExplicitSymbol = symbols.length > 0 || /\b[A-Z]{2,6}\b/.test(message);
    const decisionQuestion = /(أبيع|ابيع|بيع|أحتفظ|احتفظ|أخرج|اخرج|أشتري|اشتري|شراء|بيع الآن|أبيع الآن)/i.test(normalized);
    if (decisionQuestion && hasExplicitSymbol) {
        return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
    }

    if (/(أخبار|اخبار|خبر|news)/i.test(normalized)) {
        return { intent: "stock_news", tools: ["get_news"], replaceTools: true };
    }

    if (/(مقارن|قارن|compare)/i.test(normalized) && symbols.length >= 2) {
        return { intent: "comparison", tools: ["get_comparison"], replaceTools: true };
    }

    const topMoversQuery = /(أعلى|اعلى|أقوى|اقوى).{0,20}(10|عشرة|الأسهم|اسهم|ارتفاع|ارتفاعاً|صعود|النهارده|اليوم)/i.test(normalized);
    if (topMoversQuery) {
        return { intent: "market_summary", tools: ["get_market"], replaceTools: true };
    }

    const liquidityQuery = /((?:ال)?سيول(?:ه)?|تجميع|تصريف|مؤسس|accumulation|distribution|institutional|liquidity|فين.*السوق|where.*liquidity|market liquidity)/i.test(normalized);
    if (liquidityQuery && hasExplicitSymbol) {
        if (/(تجميع|تصريف|مؤسس|institutional|wyckoff)/i.test(normalized)) {
            return { intent: "accumulation", tools: ["get_accumulation_stocks"], replaceTools: true };
        }
        return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
    }
    if (liquidityQuery && symbols.length > 0) {
        return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
    }
    if (liquidityQuery && !hasExplicitSymbol) {
        if (extractRequestedDate(message)) {
            return {
                intent: "accumulation",
                tools: ["get_accumulation_stocks"],
                replaceTools: true
            };
        }
        return {
            intent: normalized.includes("تجميع") || normalized.includes("تصريف") ? "accumulation" : "market_summary",
            tools: ["get_market", "get_accumulation_stocks"],
            replaceTools: true
        };
    }

    const sector = extractSectorFromMessage(normalized);
    if (sector && !hasExplicitSymbol && !liquidityQuery) {
        return { intent: "sector_analysis", tools: ["get_sector"], replaceTools: true, sector };
    }

    return { intent: plannerIntent, tools: [] };
}

function isDirectAccumulationRequest(message: string, symbols: string[]): boolean {
    return symbols.length > 0 && /(تجميع|تصريف|سيول(?:ه)?|مؤسس|accumulation|distribution|institutional|liquidity|wyckoff)/i.test(message);
}

export function extractSectorFromMessage(message: string): string | null {
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    if (/(البنوك|بنوك|banking sector|banks)/i.test(normalized)) return "بنوك";
    if (/(العقارات|عقارات|عقاري|real estate)/i.test(normalized)) return "عقارات";
    if (/(الادويه|ادويه|دواء|pharma|pharmaceutical)/i.test(normalized)) return "أدوية";
    if (/(الاغذيه|اغذيه|غذائي|food|beverage)/i.test(normalized)) return "أغذية";
    if (/(البترول|بترول|الطاقه|طاقه|oil|gas|energy)/i.test(normalized)) return "بترول";
    return null;
}

export function needsLiveDataForTools(tools: string[]): boolean {
    const liveTools = new Set([
        "get_stock", "get_market", "get_indices", "get_news",
        "get_recommendations", "get_signals", "get_sector",
        "get_accumulation_stocks", "get_comparison"
    ]);
    return tools.some(tool => liveTools.has(tool));
}

export function needsHistoricalData(intent: string, message: string): boolean {
    return intent === "historical_recall"
        || Boolean(extractRequestedDate(message))
        || Boolean(extractRequestedDateRange(message))
        || /التحليل (اللي فات|السابق)|الرقم اللي (قولته|ذكرته) قبل كده|السعر اللي قولته|كان (RSI|macd|السعر) كام|من شوية|قبل كده|السابقة/i.test(message);
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
    messageId: string,
    requestedModel?: string
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
    const plannerResult = (!hasImages ? buildDeterministicPlannerResult(userMessage, sessionState) : null)
        || await runPlanner(
            userMessage,
            [], // Never pass raw images to planner when vision already analyzed
            sessionState,
            history,
            apiKeys,
            vision
        );

    let mergedSymbols = Array.from(new Set([
        ...extractExplicitSymbols(userMessage),
        ...mergeVisionSymbols(plannerResult.entities.symbols || [], vision)
    ]));
    if (mergedSymbols.length === 0 && memory?.resolved_references?.symbol) {
        mergedSymbols.push(memory.resolved_references.symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(أبيع|ابيع|بيع|أحتفظ|احتفظ|أخرج|اخرج|بكام|بكم|السعر)/i.test(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (isMarketWideRequest(userMessage) && !isDirectAccumulationRequest(userMessage, mergedSymbols)) mergedSymbols = [];
    const enforced = enforceIntentFromMessage(userMessage, plannerResult.intent, mergedSymbols);
    const datedDomainRequest = Boolean(extractRequestedDate(userMessage) || extractRequestedDateRange(userMessage)) && ["stock_analysis", "stock_news", "comparison", "sector_analysis", "accumulation"].includes(enforced.intent);
    const historicalRequest = needsHistoricalData(enforced.intent, userMessage);
    const effectiveIntent = historicalRequest && !datedDomainRequest ? "historical_recall" : enforced.intent;

    const directAccumulationRequest = isDirectAccumulationRequest(userMessage, mergedSymbols);
    const plannedTools = directAccumulationRequest
        ? ["get_accumulation_stocks"]
        : enforced.replaceTools
        ? enforced.tools
        : Array.from(new Set([...(plannerResult.tools || []), ...enforced.tools]));
    const requestedRange = extractRequestedDateRange(userMessage);
    const plan: IntentPlan = {
        intent: directAccumulationRequest ? "stock_analysis" : mapIntent(effectiveIntent),
        confidence: plannerResult.confidence || 0.8,
        entities: {
            symbols: mergedSymbols,
            sector: enforced.sector || plannerResult.entities.sector || null,
            timeframe: extractTemporalContext(userMessage).timeframe,
            reference: memory?.resolved_references?.symbol ? "last_image" : null
            ,requested_date: requestedRange ? null : extractTemporalContext(userMessage).date
            ,requested_start_date: requestedRange?.start || null
            ,requested_end_date: requestedRange?.end || null
        },
        needs_vision_context: hasImages && !!vision,
        needs_history: memory?.resolved_references?.symbol !== null || plannerResult.intent === "general_chat",
        needs_live_data: needsLiveDataForTools(plannedTools),
        needs_historical_data: historicalRequest,
        tools: plannedTools,
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
        const response = deterministicLiquidityResponse;
        yield { type: "token", data: response };
        await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
        yield { type: "done", data: { response, session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: userMessage }, tables } };
        return;
    }

    // ===== STAGE 5: Final Response =====
    yield { type: "status", data: { status: "generating", message: "إنشاء الرد..." } };
    const scopedMemory = plan.needs_historical_data || plan.entities.reference
        ? memory?.relevant_snapshots || []
        : [];
    const stream = generateV2Stream(
        userMessage, plan, vision, tools.results,
        scopedMemory,
        memory?.recent_messages || [],
        memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
        apiKeys,
        requestedModel
    );

    let fullResponse = "";
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
    messageId: string,
    requestedModel?: string
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
    const plannerResult = (!hasImages ? buildDeterministicPlannerResult(userMessage, sessionState) : null)
        || await runPlanner(
            userMessage,
            [],
            sessionState,
            history,
            apiKeys,
            vision
        );

    let mergedSymbols = Array.from(new Set([
        ...extractExplicitSymbols(userMessage),
        ...mergeVisionSymbols(plannerResult.entities.symbols || [], vision)
    ]));
    if (mergedSymbols.length === 0 && memory?.resolved_references?.symbol) {
        mergedSymbols.push(memory.resolved_references.symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(أبيع|ابيع|بيع|أحتفظ|احتفظ|أخرج|اخرج|بكام|بكم|السعر)/i.test(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (isMarketWideRequest(userMessage) && !isDirectAccumulationRequest(userMessage, mergedSymbols)) mergedSymbols = [];
    const enforced = enforceIntentFromMessage(userMessage, plannerResult.intent, mergedSymbols);
    const datedDomainRequest = Boolean(extractRequestedDate(userMessage) || extractRequestedDateRange(userMessage)) && ["stock_analysis", "stock_news", "comparison", "sector_analysis", "accumulation"].includes(enforced.intent);
    const historicalRequest = needsHistoricalData(enforced.intent, userMessage);
    const effectiveIntent = historicalRequest && !datedDomainRequest ? "historical_recall" : enforced.intent;

    const directAccumulationRequest = isDirectAccumulationRequest(userMessage, mergedSymbols);
    const plannedTools = directAccumulationRequest
        ? ["get_accumulation_stocks"]
        : enforced.replaceTools
        ? enforced.tools
        : Array.from(new Set([...(plannerResult.tools || []), ...enforced.tools]));
    const requestedRange = extractRequestedDateRange(userMessage);
    const plan: IntentPlan = {
        intent: directAccumulationRequest ? "stock_analysis" : mapIntent(effectiveIntent),
        confidence: plannerResult.confidence || 0.8,
        entities: {
            symbols: mergedSymbols,
            sector: enforced.sector || plannerResult.entities.sector || null,
            timeframe: extractTemporalContext(userMessage).timeframe,
            reference: memory?.resolved_references?.symbol ? "last_image" : null
            ,requested_date: requestedRange ? null : extractTemporalContext(userMessage).date
            ,requested_start_date: requestedRange?.start || null
            ,requested_end_date: requestedRange?.end || null
        },
        needs_vision_context: hasImages && !!vision,
        needs_history: memory?.resolved_references?.symbol !== null || plannerResult.intent === "general_chat",
        needs_live_data: needsLiveDataForTools(plannedTools),
        needs_historical_data: historicalRequest,
        tools: plannedTools,
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
    const scopedMemory = plan.needs_historical_data || plan.entities.reference
        ? memory?.relevant_snapshots || []
        : [];
    const generatedResponse = deterministicLiquidityResponse || await generateV2Response(
        userMessage, plan, vision, tools.results,
        scopedMemory,
        memory?.recent_messages || [],
        memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
        apiKeys,
        requestedModel
    );
    const response = generatedResponse;

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
