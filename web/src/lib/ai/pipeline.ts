import { IntentPlan, VisionContext, SessionState, SessionSummary, PlannerResult } from "./types";
import { analyzeImage } from "./vision";
import { retrieveRelevantMemory, MemoryResult } from "./memory";
import { getSyncStockMappings, getStocksList, loadValidSymbols } from "./planner";
import { executeStructuredTools, StructuredToolOutput } from "./tools-v2";
import { buildDeterministicResponse, generateV2Response, generateV2Stream, getResponderCooldownMs } from "./final-v2";
import { validateResponse, autoFixNumbers } from "./validator";
import { sanitizeReply } from "./sanitizer";
import { loadSessionState, loadSessionSummary, updateSessionSummary, updateSessionState } from "./session";
import { buildExcelTables, ExcelTable } from "./excel-tables";
import { AI_CONFIG } from "./config";
import { normalizeArabicIntent, extractInvestorPreferences, getFairValueFilters, isFairValueScanRequest, getInvestorGuidanceIntent as classifyInvestorGuidance, isDailyPriceLimitQuestion, isEarningsDataRequest, isTermsDefinitionRequest, isUsageLimitQuestion, isBestBuyStockQuestion } from "./intent-policy";
import { extractExcludedSectorNames, extractMentionedSectorNames } from "./sector-taxonomy";
import { isOtcStock, buildOtcNotice } from "./otc-stocks";

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
        current_sector?: string | null;
    };
    vision_error: string | null;
    tables: ExcelTable[];
}

export function sanitizePlannerTools(message: string, tools: string[]): string[] {
    const explicitlyRequestsRecommendations = isBestBuyStockQuestion(message) || /(?:توصيات|توصيه|توصية|اشارات|إشارات|سجل التوصيات|اقدم توصيه|أقدم توصية|مناسبة للدخول|للدخول فيها|مرشحة|أسهم مرشحة|اسهم كويسة|فرص دخول|للشراء|ترشح|ترشيحات|اشتريها|اشتري|ادخل فيها|تحقق ارباح|تحقق أرباح|فرص شراء|فرص الاستثمار)/i.test(message);
    if (explicitlyRequestsRecommendations) return tools;
    return tools.filter(tool => tool !== "get_recommendations" && tool !== "get_signals");
}

export function scopeImplicitSingleStockRequest(
    message: string,
    explicitSymbols: string[],
    plannedSymbols: string[],
    currentSymbol: string | null,
    resolvedSymbol: string | null
): string[] {
    if (explicitSymbols.length > 0) return explicitSymbols;
    const normalized = normalizeArabicIntent(message);
    const singularOwnedPosition = /(?:شريت|اشتريت|شاري|داخل).{0,35}(?:انهارده|اليوم|السهم|ونزل|نازل)|(?:السهم|هو|انه).{0,25}(?:نزل|نازل).{0,25}(?:يطلع|امل|اعمل)/i.test(normalized);
    if (!singularOwnedPosition) return plannedSymbols;
    const symbol = currentSymbol || resolvedSymbol || plannedSymbols[0] || null;
    return symbol ? [symbol] : [];
}

function clearsStockContext(plan: { intent: string; tools?: string[]; entities?: { symbols?: string[] }; guidance_intent?: any }): boolean {
    return plan.intent === "sector_analysis" || (Array.isArray(plan.tools) && plan.tools.includes("get_recommendations") && (plan.entities?.symbols?.length || 0) === 0) || (plan.intent === "market_summary" && (plan.entities?.symbols?.length || 0) === 0) || Boolean(plan.guidance_intent);
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
            const { error } = await supabase.from("ai_chat_facts").insert(rows);
            if (error?.code === "PGRST204" && /context_id/i.test(error.message || "")) {
                const legacyRows = rows.map(({ context_id, ...row }) => row);
                const legacyResult = await supabase.from("ai_chat_facts").insert(legacyRows);
                if (legacyResult.error) throw legacyResult.error;
            } else if (error) {
                throw error;
            }
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
    // These are product/platform labels frequently used in Arabic investor questions,
    const excluded = new Set([
        "EGX", "NEWS", "TODAY", "LAST", "WEEK", "FROM", "BETWEEN", "RSI", "MACD", "VWAP", "CLOUD", "THNDR", "ALSH",
        "OTC", "BUY", "SELL", "HOLD", "USD", "EGP", "EPS", "ROE", "ROA", "ROI", "NAV", "GDP", "CBE", "FRA", "IPO", "API", "AI"
    ]);
    const latinTokens = message.match(/\b[A-Za-z][A-Za-z0-9]{1,9}\b/g) || [];
    
    let matchedSymbols = [...latinTokens];

    // Attempt to match Arabic full names from the mapping
    const stockMappings = getSyncStockMappings();
    let normMsg = message.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
    for (const [arName, symbol] of Object.entries(stockMappings).sort((a, b) => b[0].length - a[0].length)) {
        const normKey = arName.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
        if (normKey.length >= 2) {
            const escapedKey = normKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`(?:^|[^a-z0-9\u0621-\u064a\u0671-\u06d3])(?:و|ف|ب|ل|ك|ال)?${escapedKey}(?:$|[^a-z0-9\u0621-\u064a\u0671-\u06d3])`, "i");
            if (regex.test(normMsg)) {
                if (Array.isArray(symbol)) {
                    matchedSymbols.push(...symbol);
                } else {
                    matchedSymbols.push(symbol);
                }
                normMsg = normMsg.replace(normKey, " ".repeat(normKey.length));
            }
        }
    }

    return Array.from(new Set(
        matchedSymbols
            .map(symbol => symbol.toUpperCase() === "AFID" ? "AFDI" : symbol.toUpperCase())
            .filter(symbol => !excluded.has(symbol))
    ));
}

export type InvestorGuidanceIntent = "onboarding" | "allocation" | "product_comparison" | "product_explainer" | "terms_explainer";

export function getInvestorGuidanceIntent(message: string, hasNamedStock?: boolean): InvestorGuidanceIntent | null {
    const hasSymbols = hasNamedStock ?? (extractExplicitSymbols(message).length > 0);
    return classifyInvestorGuidance(message, hasSymbols);
}

export function isBeginnerPortfolioQuestion(message: string): boolean {
    const intent = getInvestorGuidanceIntent(message);
    return intent === "onboarding" || intent === "allocation";
}

export function isNonEquityProductComparison(message: string): boolean {
    return getInvestorGuidanceIntent(message) === "product_comparison";
}

export function splitChatCommands(message: string): string[] {
    return message
        .replace(/\s+(?=(?:هات|جيب|اعرض|حلل|شوف|قارن|لو\s+كسر)(?:\s|$))/gi, "\n")
        .replace(/[،,]\s*(?:و\s*)?(?=(?:مين|ايه|إيه|هات|جيب|شوف|حلل)(?:\s|$))/gi, "\n")
        .split(/\n+|(?<=[؟?])\s*/)
        .map(part => part.trim())
        .filter(Boolean);
}

// Guaranteed non-null plan for unrecognized messages (greetings, small talk)
// so downstream stages never dereference a null planner result.
function generalChatPlan(sessionState: SessionState): PlannerResult {
    return {
        intent: "general_chat", confidence: 0.5,
        entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
        tools: [],
        session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: "" }
    } as PlannerResult;
}

export function buildCompoundDeterministicPlan(message: string, sessionState: SessionState): PlannerResult | null {
    const commands = splitChatCommands(message);
    if (commands.length < 2) return buildDeterministicPlannerResult(message, sessionState);
    let state = { ...sessionState, last_symbols: [...sessionState.last_symbols] };
    const plans = commands.map(command => {
        let plan = buildDeterministicPlannerResult(command, state);
        const sector = extractSectorFromMessage(command) || extractSectorFromMessage(state.summary || "");
        const normalized = command.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
        if (/(اخبار|اخباره|خبر)/i.test(normalized) && sector && (!plan || !plan.tools.includes("get_news"))) {
            plan = { ...(plan || buildDeterministicPlannerResult(`قطاع ${sector}`, state)!), intent: "sector_analysis", entities: { ...(plan?.entities || {}), symbols: [], sector }, tools: Array.from(new Set([...(plan?.tools || []), "get_sector", "get_news"])) } as PlannerResult;
        }
        if (/تجميع/i.test(normalized) && sector && (!plan || !plan.tools.includes("get_accumulation_stocks"))) {
            plan = { ...(plan || buildDeterministicPlannerResult(`قطاع ${sector}`, state)!), intent: "sector_analysis", entities: { ...(plan?.entities || {}), symbols: [], sector }, tools: Array.from(new Set([...(plan?.tools || []), "get_sector", "get_accumulation_stocks"])), } as PlannerResult;
        }
        if (plan?.session_update) state = { ...state, ...plan.session_update };
        return plan;
    }).filter((plan): plan is PlannerResult => Boolean(plan));
    if (!plans.length) return null;
    const symbols = Array.from(new Set(plans.flatMap(plan => plan.entities.symbols || [])));
    const tools = Array.from(new Set(plans.flatMap(plan => plan.tools || [])));
    const last = plans[plans.length - 1];
    const sector = plans.map(plan => plan.entities.sector).find(Boolean) || last.entities.sector;
    if (sector && extractExplicitSymbols(message).length === 0) symbols.length = 0;
    if (sector && !tools.includes("get_sector")) tools.unshift("get_sector");
    
    const mergedEntities = {
        ...last.entities,
        symbols,
        sector,
        wants_table: plans.some(p => p.entities.wants_table),
        scan_direction: plans.map(p => p.entities.scan_direction).find(Boolean) || last.entities.scan_direction || null,
        fair_value_direction: plans.map(p => p.entities.fair_value_direction).find(Boolean) || last.entities.fair_value_direction || null,
        require_distribution: plans.some(p => p.entities.require_distribution),
        require_accumulation: plans.some(p => p.entities.require_accumulation),
    };

    return { 
        ...last, 
        intent: sector ? "sector_analysis" : last.intent, 
        entities: mergedEntities, 
        tools, 
        session_update: { 
            ...last.session_update, 
            current_symbol: symbols[symbols.length - 1] || last.session_update.current_symbol, 
            last_symbols: Array.from(new Set([...symbols, ...state.last_symbols])) 
        } 
    };
}

export function extractSingleStockFromRecentHistory(history: Array<{ role: string; content: string }>): string | null {
    const latestAssistant = [...history].reverse().find(item => item.role === "assistant" && item.content)?.content || "";
    const candidates = latestAssistant
        .split("\n")
        .map(line => line.trim().match(/^(?:[-•]\s*)?(?:\d+[.)]\s*)?\**([A-Z]{2,6})\**(?:\s*[:\t|،-]|$)/)?.[1])
        .filter((symbol): symbol is string => Boolean(symbol) && !["EGX", "RSI", "MACD", "VWAP", "USD"].includes(symbol || ""));
    const unique = Array.from(new Set(candidates));
    return unique.length === 1 ? unique[0] : null;
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

export function isEgxWeekend(date: string): boolean {
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && (parsed.getUTCDay() === 5 || parsed.getUTCDay() === 6);
}

export function describeDatedFallback(requestedDate: string | null | undefined, dataDate: string | null | undefined): string | null {
    if (!requestedDate || !dataDate || requestedDate === dataDate) return null;
    if (isEgxWeekend(requestedDate)) {
        const day = new Date(`${requestedDate}T00:00:00Z`).getUTCDay() === 5 ? "الجمعة" : "السبت";
        return `التاريخ المطلوب ${requestedDate} وافق ${day}، وهو عطلة أسبوعية معتادة للبورصة المصرية؛ استخدمت آخر جلسة متاحة بتاريخ ${dataDate}.`;
    }
    return `لا توجد بيانات جلسة مسجلة بتاريخ ${requestedDate}؛ استخدمت آخر جلسة سابقة متاحة بتاريخ ${dataDate}. قد يكون السبب عطلة رسمية أو عدم اكتمال البيانات.`;
}

export function extractTemporalContext(message: string): { date: string | null; timeframe: "current" | "historical" | "unspecified" } {
    if (extractRequestedDateRange(message)) return { date: null, timeframe: "historical" };
    const date = extractRequestedDate(message);
    if (date) return { date, timeframe: "historical" };
    if (/(امبارح|امس|أمس|البارح|السابق|اللي فات|قبل كده|من شوية|الأسبوع اللي فات|الشهر اللي فات)/i.test(message)) {
        return { date: null, timeframe: "historical" };
    }
    if (/(النهارده|اليوم|دلوقتي|حاليا|حاليًا|الان|الآن)/i.test(message)) {
        return { date: null, timeframe: "current" };
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
    if (/^\s*(?:كمل|كمّل|تابع)\s*[!؟?.]*$/i.test(message)) {
        return {
            intent: "general_chat", confidence: 1,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    if (/^\s*(?:جدع|عاش|تمام|تسلم|شكرا|شكراً|حلو|ممتاز|برافو)\s*[!؟?.]*$/i.test(message)) {
        return {
            intent: "general_chat", confidence: 1,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    if (isTermsDefinitionRequest(message)) {
        return {
            intent: "general_chat",
            confidence: 1,
            guidance_intent: "terms_explainer",
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    const normalized = normalizeArabicIntent(message);
    const explicitSymbols = extractExplicitSymbols(message);
    const excludedSectors = extractExcludedSectors(message);
    const referencedSector = extractSectorFromMessage(message) || sessionState.current_sector || extractSectorFromMessage(sessionState.summary || "");
    const sectorNewsFollowUp = /(?:اخبار|أخبار|خبر(?!ه)|عناوين).{0,35}(?:القطاع|قطاع|متعلقه|متعلقة)|(?:القطاع|قطاع).{0,35}(?:اخبار|أخبار|خبر|عناوين)/i.test(normalized);
    if (sectorNewsFollowUp && referencedSector) {
        return {
            intent: "sector_analysis", confidence: 1,
            entities: { symbols: [], sector: referencedSector, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_news"],
            session_update: { current_symbol: null, last_symbols: [], summary: message }
        };
    }
    const sectorLiquidityReasonFollowUp = /^(?:ه[ىي]\s+)?(?:ليه|لماذا|ايه السبب|إيه السبب)\s+(?:السيول|السيوله|سيوله)\s+(?:عاليه|عالية|مرتفعه|مرتفعة)[؟?\s]*$/i.test(normalized);
    if (sectorLiquidityReasonFollowUp && referencedSector) {
        return {
            intent: "sector_analysis", confidence: 1,
            entities: { symbols: [], sector: referencedSector, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_sector_liquidity"],
            session_update: { current_symbol: null, last_symbols: [], summary: message }
        };
    }
    if (isFairValueScanRequest(message)) {
        const filters = getFairValueFilters(message);
        const fvTools: string[] = ["get_fair_value_scan"];
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: explicitSymbols, sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, excluded_sectors: excludedSectors, ...filters },
            tools: fvTools,
            session_update: { current_symbol: explicitSymbols[0] || null, last_symbols: explicitSymbols.length ? explicitSymbols : sessionState.last_symbols, summary: message }
        };
    }

    if (excludedSectors.length > 0 && /(سيول|ادخل|دخول|استثمر|فرص)/i.test(normalized)) {
        return {
            intent: "market_summary", confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, excluded_sectors: excludedSectors },
            tools: ["get_sector_liquidity"],
            session_update: { current_symbol: null, last_symbols: [], summary: message }
        };
    }
    const followsSectorList = /قطاع|قطاعات/i.test(sessionState.summary || "")
        && /(?:احسن|افضل).{0,20}(?:واحد|قطاع).{0,25}(?:فيهم|احط|استثمر)/i.test(normalized);
    if (followsSectorList) {
        return {
            intent: "market_summary", confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_sector_liquidity"],
            session_update: { current_symbol: null, last_symbols: [], summary: message }
        };
    }
    // Follow-up asking to re-serve the previous scan list ("هات اخر قايمه" after asking
    // about accumulation): re-run the same scan direction; the tool layer serves the last
    // recorded (possibly stale) rows when the user explicitly asks for the latest list.
    const lastListFollowUp = /(?:هات|جيب|اعرض|وريني|ايه|فين)?\s*(?:ال)?(?:اخر|اخيرة).{0,15}(?:قايمه|قائمه|قائمة|مسح|نتايج|نتائج|بيانات|سكان)/i.test(normalized)
        || /(?:قايمه|قائمه|قائمة)\s*(?:ال)?مسح/i.test(normalized);
    const priorScanDirection = /(?:تصريف|تصريفي|distribution)/i.test(String(sessionState.summary || "")) ? "distribution"
        : /(?:تجميع|accumulation)/i.test(String(sessionState.summary || "")) ? "accumulation"
        : null;
    if (lastListFollowUp && priorScanDirection && explicitSymbols.length === 0) {
        return {
            intent: "accumulation_distribution",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "historical", requested_date: null, scan_direction: priorScanDirection },
            tools: [priorScanDirection === "distribution" ? "get_distribution_stocks" : "get_accumulation_stocks"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: `${message} ${priorScanDirection === "distribution" ? "تصريف" : "تجميع"}` }
        };
    }
    const broadScan = explicitSymbols.length === 0 && /(?:الاسهم|اسهم|هات|ابعت|اعرض).{0,45}(?:تجميع|تصريف)|(?:تجميع|تصريف).{0,45}(?:الاسهم|اسهم)/i.test(normalized);
    const hasGroupReference = /(فيهم|منهم|من دول|بينهم|أيهم|أيها|أحسن واحد|احسن واحد|أفضل واحد|افضل واحد|الأسهم دي|الاسهم دي)/i.test(normalized) && sessionState.last_symbols.length > 0;
    const allocationSymbols = explicitSymbols.length >= 2 ? explicitSymbols : hasGroupReference ? sessionState.last_symbols.slice(0, 5) : [];
    if (allocationSymbols.length >= 2 && /(احط|أحط|اوزع|أوزع|قسم|اقسم|استثمر).{0,30}(مين|فيهم|بينهم|الاتنين|السهمين)/i.test(normalized)) {
        return {
            intent: "comparison", confidence: 1, guidance_intent: "allocation",
            entities: { symbols: allocationSymbols, sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_stock", "get_stock_levels"],
            session_update: { current_symbol: allocationSymbols[0], last_symbols: allocationSymbols, summary: message }
        };
    }
    const isAccumulationScan = /(?:تجميع|تجميعي|تجميعيه|accumulation)/i.test(normalized) && /(?:اسهم|الاسهم|قايمه|قائمة|هات|اعرض|فين|منطقة|منطقه|مؤسسي|مؤسسات|فرص|هل فيه|هل في)/i.test(normalized);
    if (isAccumulationScan && explicitSymbols.length === 0) {
        return {
            intent: "accumulation_distribution",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: "accumulation" },
            tools: ["get_accumulation_stocks"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    const isDistributionScan = /(?:تصريف|تصريفي|تصريفيه|distribution)/i.test(normalized) && /(?:اسهم|الاسهم|قايمه|قائمة|هات|اعرض|فين|منطقة|منطقه|مؤسسي|مؤسسات|فرص|هل فيه|هل في)/i.test(normalized);
    if (isDistributionScan && explicitSymbols.length === 0) {
        return {
            intent: "accumulation_distribution",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: "distribution" },
            tools: ["get_distribution_stocks"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    const hasNamedStock = explicitSymbols.length > 0 || hasGroupReference || Boolean(sessionState.current_symbol);
    const guidance = isFairValueScanRequest(message) ? null : getInvestorGuidanceIntent(message, hasNamedStock);
    if (guidance) {
        const wantsAccumulation = /تجميع|accumulation/i.test(normalized);
        return {
            intent: wantsAccumulation ? "accumulation_distribution" : "general_chat",
            confidence: 1,
            guidance_intent: wantsAccumulation ? null : guidance,
            entities: { symbols: [], sector: null, wants_table: wantsAccumulation, timeframe: "current", requested_date: null, scan_direction: wantsAccumulation ? "accumulation" : null },
            tools: wantsAccumulation ? ["get_accumulation_stocks"] : [],
            session_update: {
                current_symbol: null,
                last_symbols: sessionState.last_symbols,
                summary: message
            }
        };
    }
    const isMarketCheapestRequest = explicitSymbols.length === 0
        && /(?:ارخص|أرخص)\s*(?:\d{1,2})?\s*(?:ال)?(?:اسهم|الاسهم|أسهم|الأسهم|سهم)/i.test(normalized)
        && !/(?:ارتفاع|صعود|عائد|اداء|أداء|سيول|تداول|خسار|انخفاض|هابط)/i.test(normalized);
    if (isMarketCheapestRequest) {
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_price_history"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    const isYtdMarketRequest = /(?:من\s+(?:اول|أول|بداية|بدايه)\s+السنه|من\s+(?:اول|أول|بداية|بدايه)\s+السنة|من\s+يناير|خلال\s+العام|منذ\s+بداية\s+العام|منذ\s+بدايه\s+العام|ytd|year\s*to\s*date|هذا\s+العام|العام\s+الحالي|السنه\s+(?:دي|ده|دا)|ف[يى]\s+(?:العام|السنه|السنة)|(?:العام|السنه)\s+(?:الماضي|الاخير|الفايت|الفائت))/i.test(normalized);
    const isMtdMarketRequest = /(?:من\s+(?:اول|أول|بداية|بدايه)\s+الشهر|من\s+(?:اول|أول|بداية|بدايه)\s+الشهر|خلال\s+الشهر|منذ\s+بداية\s+الشهر|منذ\s+بدايه\s+الشهر|mtd|month\s*to\s*date|الشهر\s+ده|الشهر\s+دا|الشهر\s+الحالي|هذا\s+الشهر|الشهر\s+دي|ف[يى]\s+الشهر|الشهر\s+(?:الماضي|الاخير|الفايت|الفائت))/i.test(normalized);
    const isWtdMarketRequest = /(?:من\s+(?:اول|أول|بداية|بدايه)\s+الاسبوع|من\s+(?:اول|أول|بداية|بدايه)\s+الاسبوع|خلال\s+الاسبوع|منذ\s+بداية\s+الاسبوع|منذ\s+بدايه\s+الاسبوع|wtd|week\s*to\s*date|الاسبوع\s+ده|الاسبوع\s+دا|الاسبوع\s+الحالي|هذا\s+الاسبوع|الاسبوع\s+دي|ف[يى]\s+الاسبوع|الاسبوع\s+(?:الماضي|الاخير|الفايت|الفائت))/i.test(normalized);
    // A temporal phrase alone ("سهم كورا فى الاسبوع") must not hijack a stock question
    // into a market ranking — a superlative/list/count hint must also be present.
    const hasMarketListHint = /(?:اعلي|أعلى|اقوي|اقوى|افضل|أفضل|اقل|أقل|ارخص|أرخص|ادنى|أدنى|ترتيب|مرتب|قايمه|قائمه|قائمة|top)/i.test(normalized)
        || /(?:^|[\s،,])\d{1,2}\s*(?:سهم|سمهم|أسهم|اسهم)/i.test(normalized);
    const isPeriodRankingRequest = explicitSymbols.length === 0
        && hasMarketListHint
        && (isYtdMarketRequest || isMtdMarketRequest || isWtdMarketRequest || /(?:اعلي|أعلى|افضل|أفضل|اقل|أقل|ارخص|أرخص|ادنى|أدنى|بافضل|بأفضل|بافل|بأفل|بأعلى|باعلى|قايمه|قائمة|ترتيب).{0,35}(?:ارباح|أرباح|ارتفاع|صعود|اداء|أداء|عائد|سيول|تداول|حجم|ربح|أرباح).{0,35}(?:اول|أول|بداية|بدايه|خلال|منذ).{0,20}(?:السنه|السنة|الشهر|الاسبوع|يناير|ytd|mtd|wtd)/i.test(normalized));
    if (isPeriodRankingRequest) {
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "historical", requested_date: isWtdMarketRequest ? "wtd" : isMtdMarketRequest ? "mtd" : null, scan_direction: null },
            tools: ["get_price_history"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    const recommendationRequest = isBestBuyStockQuestion(message) || /(?:توصيات|توصية|توصيه|ترشح|ترشيحات|فرص شراء|فرص دخول|اسهم ادخل فيها|اسهم اشتريها|اشتري ايه|ادخل في ايه|ادخل فيها|اسهم ممتازة|اسهم كويسة|تحقق ارباح|تحقق أرباح|توصيات كويسة|توصيات شراء|اسهم للشراء|فرص الشراء)/i.test(normalized);
    if (recommendationRequest && !hasNamedStock) {
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, recommendation_order: "newest" },
            tools: ["get_recommendations"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    if (/(?:اقوي|اقوى|أقوى)\s+(?:الاسهم|الأسهم)\s*[؟?\s]*$/i.test(normalized.trim()) && !/(النهارده|اليوم|جلسه|جلسة|اسبوع|أسبوع|سيول|سيولة|زخم|ارتفاع)/i.test(normalized)) {
        return {
            intent: "clarification",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "unspecified", requested_date: null, scan_direction: null },
            tools: [],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    if (isBestBuyStockQuestion(message) && !hasNamedStock) {
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_recommendations", "get_fair_value_scan"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    if (isUsageLimitQuestion(message)) {
        return {
            intent: "general_chat",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            session_update: {
                current_symbol: sessionState.current_symbol,
                last_symbols: sessionState.last_symbols,
                summary: message
            }
        };
    }
    if (isEarningsDataRequest(message)) {
        const symbols = extractExplicitSymbols(message);
        return {
            intent: "stock_analysis",
            confidence: 1,
            entities: { symbols, sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            session_update: {
                current_symbol: symbols[0] || sessionState.current_symbol,
                last_symbols: symbols.length ? symbols : sessionState.last_symbols,
                summary: message
            }
        };
    }
    const symbols = broadScan ? [] : extractExplicitSymbols(message);
    const temporal = extractTemporalContext(message);
    const marketWideRequest = isMarketWideRequest(message);
    const riskFollowUp = /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(normalized);
    const explicitContextComparison = /(قارن|مقارنه|مقارنة).{0,20}(ده|دا|دي|هذا).{0,20}(مع|بـ|ب)/i.test(normalized);
    const hasPreviousReference = /(?:^|[^\u0621-\u064A])(ده|دا|دي|هذا|السهم ده|السهم دا|السهم دي|هاته|هاتها|اخباره|أخباره|خبره|الاتنين|السهمين|عليه|فيه|ليه|عليها|فيها|ليها|عنه|عنها|به|بها|معاه|معاها|هو|هي)(?:$|[^\u0621-\u064A])/i.test(normalized) && !broadScan && (explicitSymbols.length === 0 || explicitContextComparison);
    if (hasGroupReference && sessionState.last_symbols.length > 0) {
        sessionState.last_symbols.forEach(sym => {
            if (!symbols.includes(sym)) symbols.push(sym);
        });
    } else if (hasPreviousReference && sessionState.current_symbol && !symbols.includes(sessionState.current_symbol)) {
        symbols.unshift(sessionState.current_symbol);
    }
    if ((marketWideRequest || (isBestBuyStockQuestion(message) && !hasGroupReference)) && extractExplicitSymbols(message).length === 0) {
        symbols.length = 0;
    }
    if (temporal.date && symbols.length === 0 && sessionState.current_symbol && !marketWideRequest) {
        symbols.push(sessionState.current_symbol);
    }
    if (riskFollowUp && symbols.length === 0 && sessionState.current_symbol) {
        symbols.push(sessionState.current_symbol);
    }
    const fiveSessionForecast = /(توقعات|توقع|متوقع|تقعات|وقعات).{0,25}(?:5|خمس|الخمسه|الخمسة).{0,15}(جلسات|جلسه|جلسة)|(?:5|خمس|الخمسه|الخمسة).{0,15}(جلسات|جلسه|جلسة).{0,25}(توقعات|توقع|متوقع|تقعات|وقعات)/i.test(normalized);
    if (fiveSessionForecast && symbols.length === 0 && sessionState.current_symbol) {
        symbols.push(sessionState.current_symbol);
    }
    if (/(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(normalized) && symbols.length === 0 && sessionState.current_symbol) symbols.push(sessionState.current_symbol);
    if ((isDailyPriceLimitQuestion(message) || /(?:أ|ا)عل[ىي].{0,15}(?:سعر|قم[هة])/i.test(normalized)) && symbols.length === 0 && sessionState.current_symbol) symbols.push(sessionState.current_symbol);
    const isGeneralStockFollowUp = /(?:مناسب|استثمار|استثمر|ادخل|شراء|اشتري|فرصه|فرصة|رايك|رأيك|توقعات|وضعه|اخباره|أخباره|حركته|تحليل|مستهدف|اهداف|أهداف|دعم|مقاومه|مقاومة|شهور|سنه|سنة|شهر|اسبوع|أسبوع)/i.test(normalized);
    if (isGeneralStockFollowUp && symbols.length === 0 && sessionState.current_symbol && !isMarketWideRequest(message) && !isBestBuyStockQuestion(message)) {
        symbols.push(sessionState.current_symbol);
    }
    const sectorReference = /القطاع\s+(?:ده|دا|هذا)/i.test(normalized) ? sessionState.summary : null;
    const knownSectorFollowUp = /^(?:process industries|finance|health technology|health services|consumer services|consumer durables|consumer non-durables|commercial services|communications|distribution services|electronic technology|energy minerals|industrial services|miscellaneous|non-energy minerals|producer manufacturing|retail trade|technology services|transportation|utilities)$/i.test(message.trim())
        ? message.trim()
        : null;
    const mentionedSectorsInPlan = extractMentionedSectorNames(message);
    const isMultiSectorOrComparison = mentionedSectorsInPlan.length >= 2 || /(?:أيهما|ايهما|مقارنة|مقارنه|مفاضلة|افضل|أفضل|احسن|أحسن|قارن|ترتيب|أقوى|اقوى|اعلى|أعلى).{0,30}(?:قطاع|القطاعات)/i.test(normalized);
    let explicitSector = isMultiSectorOrComparison ? null : extractSectorFromMessage(message);
    if (symbols.length > 0 && !/(قطاع|القطاع)/i.test(normalized)) explicitSector = null;
    const sector = isMultiSectorOrComparison ? null : (knownSectorFollowUp || explicitSector || extractSectorFromMessage(sectorReference || ""));
    const hasExplicitLatinTicker = /(?:^|[^A-Za-z0-9])[A-Za-z][A-Za-z0-9]{1,9}(?=$|[^A-Za-z0-9])/.test(message);
    if (sector && !hasExplicitLatinTicker && symbols.length === 0 && /(قطاع|القطاعات|البنوك|الاتصالات|العقارات|الادويه|الاغذيه|البترول|الطاقه)/i.test(normalized)) symbols.length = 0;
    const isGreeting = /^(?:ازيك|إزيك|عامل ايه|عامل إيه|اهلا|أهلا|مرحبا|السلام عليكم)[؟?،,.!\s]*$/i.test(message.trim()) || /(?:انت|إنت|انتا|أنت).{0,12}(مين|موديل|نموذج)|مين انت|مين إنت/i.test(normalized);
    const beginnerPortfolioRequest = /(معنديش|ما عنديش).{0,20}(خبره|خبرة).{0,40}(اسهم|الاسهم)|(?:ابني|اعمل|ابدأ).{0,25}(محفظه|محفظة)|صناديق.{0,20}(دخل ثابت|عائد يومي)|(?:اول|أول)\s+يوم.{0,20}(البورصه|البورصة)|عايز\s+افهم\s+اعمل/i.test(normalized);
    const isHistorical = needsHistoricalData("", message);
    const oldestRecommendationRequest = /(اقدم|أقدم).{0,15}(توصيه|توصية|اشاره|إشارة)/i.test(message);
    const marketNewsRequest = /اخبار\s+(?:السوق|البورصه)/i.test(message);
    const requestedDate = temporal.date;
    const isClearMarketRequest = marketWideRequest || isBestBuyStockQuestion(message) || oldestRecommendationRequest || /(?:(?:أ|ا)عل[ىي]|(?:أ|ا)قو[ىي]|أحسن|احسن|أفضل|افضل|سيول|السيول|السيوله|تجميع|تصريف|القطاعات|قطاعات|حالة السوق|حاله البورصه|حالة البورصة|اداء المؤشر|أداء المؤشر|المؤشر النهارده|السوق عمل|دولار|usd)/i.test(normalized);
    const isClearStockRequest = symbols.length > 0;
    if (!sector && !isGreeting && !beginnerPortfolioRequest && !isHistorical && !requestedDate && !isClearMarketRequest && !isClearStockRequest) return null;

    if (oldestRecommendationRequest) {
        return {
            intent: "historical_recall",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "historical", requested_date: null, scan_direction: null, recommendation_order: "oldest" },
            tools: ["get_recommendations"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    const enforced = enforceIntentFromMessage(message, symbols.length ? "stock_analysis" : "market_summary", symbols, sessionState);
    const sectorFollowUp = Boolean(sectorReference && symbols.length === 0);
    const comparesSectors = enforced.tools.includes("get_sector_liquidity") && enforced.sector === null;
    const effectiveSector = comparesSectors ? null : explicitSector || knownSectorFollowUp || sectorFollowUp ? sector : null;
    return {
        intent: isGreeting || beginnerPortfolioRequest ? "general_chat" : marketNewsRequest ? "market_summary" : requestedDate && symbols.length ? "stock_analysis" : isHistorical ? "historical_recall" : explicitSector || knownSectorFollowUp || sectorFollowUp ? "sector_analysis" : enforced.intent,
        confidence: 1,
        entities: {
            symbols,
            sector: effectiveSector,
            wants_table: !isGreeting,
            timeframe: temporal.timeframe,
            requested_date: requestedDate,
            scan_direction: enforced.scan_direction || null,
            fair_value_direction: enforced.fair_value_direction || null,
            require_distribution: Boolean(enforced.require_distribution),
            require_accumulation: Boolean(enforced.require_accumulation),
            recommendation_order: enforced.recommendation_order || null,
            requested_sectors: enforced.requested_sectors || [],
        },
        tools: isGreeting || beginnerPortfolioRequest || (isHistorical && !requestedDate && !marketNewsRequest && !oldestRecommendationRequest) ? [] : marketNewsRequest ? ["get_news"] : knownSectorFollowUp || sectorFollowUp ? ["get_sector"] : enforced.replaceTools ? enforced.tools : explicitSector ? ["get_sector"] : symbols.length ? ["get_stock"] : [],
        session_update: {
            current_symbol: effectiveSector ? null : (symbols[0] || sessionState.current_symbol),
            last_symbols: symbols.length ? symbols : sessionState.last_symbols,
            summary: message
        }
    };
}

export function isMarketWideRequest(message: string): boolean {
    const normalized = message.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLowerCase();
    const marketTerms = [
        /اخبار\s+(السوق|البورصه)/i,
        /(?:السيول|السيوله)\s+(فين|في\s+السوق|ل?يوم|لبوم|بتاريخ|يوم)/i,
        /(?:اكبر|اعلى|اقوى)\s+قطاع.{0,20}(سيول|تداول)/i,
        /حاله\s+(السوق|البورصه)/i,
        /السوق\s+عمل/i,
        /اداء\s+(?:المؤشر|الموشر)/i,
        /(?:المؤشر|الموشر)\s+(?:النهارده|اليوم)/i,
        /(?:اقوى|اعلى)\s+الاسهم/i,
        /(?:السهم|القطاع|الاسهم|القطاعات).{0,45}(?:متوقع|توقع|يرتفع|هيطلع|هيرتفع).{0,35}(?:الاسبوع|اسبوع|الايام الجايه|الفتره الجايه)/i,
        /(?:متوقع|توقع|يرتفع|هيطلع|هيرتفع).{0,45}(?:السهم|القطاع|الاسهم|القطاعات).{0,35}(?:الاسبوع|اسبوع|الايام الجايه|الفتره الجايه)/i,
        /(?:مين|ايه|اية).{0,25}(?:متوقع|توقع).{0,25}(?:يرتفع|هيطلع|يصعد).{0,25}(?:الاسبوع|اسبوع)/i,
        /(?:متوقع|توقع|يرتفع|هيطلع|هيرتفع|يصعد).{0,45}(?:الاسبوع|اسبوع|الايام الجايه|الفتره الجايه)/i,
        /افضل\s+الفرص\s+المتاحه/i,
        /(?:كل|جميع).{0,12}(?:اسهم|الاسهم).{0,12}(?:المؤشر|الموشر|موشر).{0,8}30/i,
        /(?:السيول|السيوله|سيوله).{0,30}(?:انهو|انهي|اي|أى|أي|فين|فين|قطاع|القطاعات)/i,
        /(?:انهو|انهي|اي|أى|أي|فين).{0,20}(?:قطاع|القطاعات).{0,20}(?:السيول|السيوله|سيوله)/i,
        /^\s*(?:و?ال)?(?:تجميع|تصريف)(?:\s+(?:فين|ايه|الاسهم|الأسهم|النهارده|اليوم))?[؟?\s]*$/i
    ];
    return isFairValueScanRequest(message) || marketTerms.some(pattern => pattern.test(normalized.trim()));
}

export function extractExcludedSectors(message: string): string[] {
    return extractExcludedSectorNames(message);
}



export function enforceIntentFromMessage(message: string, plannerIntent: string, symbols: string[], sessionState?: SessionState): {
    intent: string;
    tools: string[];
    replaceTools?: boolean;
    sector?: string | null;
    requested_sectors?: string[];
    scan_direction?: "accumulation" | "distribution";
    fair_value_direction?: "above" | "below";
    require_distribution?: boolean;
    require_accumulation?: boolean;
    recommendation_order?: "oldest" | "newest";
} {
    if (isTermsDefinitionRequest(message)) {
        return { intent: "general_chat", tools: [], replaceTools: true };
    }
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const hasExplicitSymbol = /\b[A-Za-z]{2,6}\b/.test(message);
    const hasSymbol = symbols.length > 0 || hasExplicitSymbol;
    if (message.trim().length <= 2 && !hasSymbol) {
        return { intent: "general_chat", tools: [], replaceTools: true };
    }

    const excludedSectors = extractExcludedSectors(message);
    const mentionedSectors = extractMentionedSectorNames(message);
    const marketFairValueScan = isFairValueScanRequest(message);
    const hasDist = /تصريف|distribution/i.test(normalized);
    const hasAcc = /تجميع|accumulation/i.test(normalized);
    const noDist = /(?:لا|بدون|مفيش|صفر|0|zero).{0,15}(?:يوجد)?.{0,15}(?:تصريف|distribution)/i.test(normalized) || /(?:تصريف|distribution)\s*(?:=|يساوي)\s*0/.test(normalized);
    const noAcc = /(?:لا|بدون|مفيش|صفر|0|zero).{0,15}(?:يوجد)?.{0,15}(?:تجميع|accumulation)/i.test(normalized) || /(?:تجميع|accumulation)\s*(?:=|يساوي)\s*0/.test(normalized);
    const asksSectorLiquidity = /(?:السيول|السيوله|سيوله).{0,30}(?:انهو|انهي|اي\s+قطاع|أي\s+قطاع|قطاع|القطاعات)|(?:انهو|انهي|اي|أى|أي|فين).{0,20}(?:قطاع|القطاعات).{0,20}(?:السيول|السيوله|سيوله)/i.test(normalized);
    let direction: "accumulation" | "distribution" | null = null;
    if (hasAcc && noDist) direction = "accumulation";
    else if (hasDist && noAcc) direction = "distribution";
    else if (hasAcc && !hasDist) direction = "accumulation";
    else if (hasDist && !hasAcc) direction = "distribution";
    else if (hasAcc && hasDist) {
        const accIdx = Math.max(normalized.indexOf("تجميع"), normalized.indexOf("accumulation"));
        const distIdx = Math.max(normalized.indexOf("تصريف"), normalized.indexOf("distribution"));
        direction = (accIdx !== -1 && accIdx < distIdx) ? "accumulation" : "distribution";
    }
    if (/شريع|sharia/i.test(normalized)) {
        if (hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
        return { intent: "market_summary", tools: ["get_recommendations"], replaceTools: true };
    }
    // Explicit request to search the internet (information not in the database)
    if (/(?:ابحث|دور|فتش|بحث|شوف|بص|سيرش|شيك|تشيك)\s*(?:في|فى|على|عن)\s*(?:النت|الانترنت|الإنترنت|جوجل|المواقع|الويب)|(?:من|عبر)\s+(?:النت|الانترنت|الإنترنت)/i.test(normalized)) {
        return { intent: "general_chat", tools: ["search_web"], replaceTools: true };
    }
    if (asksSectorLiquidity && mentionedSectors.length === 0) return { intent: "market_summary", tools: ["get_sector_liquidity"], replaceTools: true };
    if (marketFairValueScan && !hasExplicitSymbol) return { intent: "market_summary", tools: ["get_fair_value_scan"], replaceTools: true, ...getFairValueFilters(message) };
    const weeklyMarketForecast = !hasSymbol
        && /(?:متوقع|توقع|يرتفع|هيطلع|هيرتفع|يصعد).{0,45}(?:الاسبوع|اسبوع|الايام الجايه|الفتره الجايه)/i.test(normalized);
    if (weeklyMarketForecast) {
        return { intent: "market_summary", tools: ["get_fair_value_scan"], replaceTools: true, fair_value_direction: "above" };
    }
    if (excludedSectors.length > 0 && /(سيول|ادخل|دخول|استثمر|فرص)/i.test(normalized)) {
        return { intent: "market_summary", tools: ["get_sector_liquidity"], replaceTools: true };
    }
    if (/(توقعات|توقع|متوقع|تقعات|وقعات).{0,35}(?:5|خمس|الخمسه|الخمسة|15|خمستاشر|خمسة عشر).{0,15}(جلسات|جلسه|جلسة|يوم)|(?:5|خمس|الخمسه|الخمسة|15|خمستاشر|خمسة عشر).{0,15}(جلسات|جلسه|جلسة|يوم).{0,35}(توقعات|توقع|متوقع|تقعات|وقعات)/i.test(normalized) || /(متوقع|توقع|توقعات|سعر).{0,25}(اخر|آخر|نهايه|نهاية).{0,15}(السنه|السنة|العام)/i.test(normalized) || /(?:اخر|آخر)\s*(?:اسبوع|أسبوع|ايام|أيام|جلسات|5|خمس)|يوم\s*بـ?\s*يوم|التغير\s*اليومي|تغير\s*يومي|سعر\s*كل\s*يوم|أداء\s*يومي/i.test(normalized)) {
        return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels", "get_price_history"], replaceTools: true };
    }
    if (isDailyPriceLimitQuestion(message)) return { intent: "levels_analysis", tools: ["get_price_history", "get_stock_levels"], replaceTools: true };
    if (/(?:أ|ا)عل[ىي].{0,15}(?:سعر|قم[هة])/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_price_history"], replaceTools: true };
    const hasRecommendationKw = /(?:توصيات|توصيه|توصية|إشارة|إشارات|اشارة|اشارات|توصي)/i.test(normalized);
    if (hasRecommendationKw) {
        const oldestRequest = /(اقدم|أقدم)/i.test(normalized);
        return {
            intent: oldestRequest ? "historical_recall" : "market_summary",
            tools: ["get_recommendations", "get_signals"],
            replaceTools: true,
            recommendation_order: oldestRequest ? "oldest" : "newest"
        };
    }
    if (direction) return { intent: "accumulation_distribution", tools: [direction === "distribution" ? "get_distribution_stocks" : "get_accumulation_stocks"], replaceTools: true, scan_direction: direction };
    if (/(قيمه عادله|القيمه العادله|fair value|عادله)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    if (/(?:سبب|اسباب|ليه|لماذا)/i.test(normalized) && hasSymbol) return { intent: "stock_news", tools: ["get_stock", "get_news", "get_stock_levels"], replaceTools: true };
    if (/(مقاوم|مقوام|دعم|support|resistance)/i.test(normalized) && hasSymbol && !/حلل.{0,30}(اخبار|أخبار)/i.test(normalized)) return { intent: "levels_analysis", tools: ["get_stock_levels"], replaceTools: true };
    if (/(سيول|السيوله)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
    if (hasSymbol && /(حلل|لو\s+كسر|اعمل\s+ايه|أعمل\s+إيه)/i.test(normalized)) {
        const compoundAnalysis = /حلل.{0,20}(هات|اخبار|أخبار)|هات.{0,20}(اخبار|أخبار)|لو\s+كسر.{0,20}(اخبار|أخبار)/i.test(normalized);
        return { intent: "stock_analysis", tools: compoundAnalysis ? ["get_stock", "get_stock_levels", "get_news"] : ["get_stock", "get_stock_levels"], replaceTools: true };
    }
    if (/(?:اخبار|أخبار|(?:^|\s)خبر(?:\s|$)|news)/i.test(normalized) && hasSymbol) return { intent: "stock_news", tools: ["get_news"], replaceTools: true };
    if (/(مقارن|قارن|compare)/i.test(normalized) && symbols.length >= 2) return { intent: "comparison", tools: ["get_comparison"], replaceTools: true };
    if (/(يخسر|خسار|يهبط|ينزل|يطلع|صعود|هبوط)/i.test(normalized) && hasSymbol) return { intent: "risk_analysis", tools: ["get_stock", "get_distribution_stocks"], replaceTools: true, scan_direction: "distribution" };
    if (/(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(normalized) && hasSymbol) return { intent: "levels_analysis", tools: ["get_stock_levels"], replaceTools: true };
    if (/(ابيع|بيع|احتفظ|اخرج|اشتري|شراء)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    if (/(ينصح|داخل|دخول|مستهدف|يصحح|تصحيح|بكره|بكرة|اخر الاسبوع|المحفظه|مليون)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    if (symbols.length >= 2 && hasSymbol && !/(اخبار|خبر|قارن|مقارن|قطاع|تجميع|تصريف)/i.test(normalized)) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    const marketListHintEnforce = /(?:اعلي|أعلى|اقوي|اقوى|افضل|أفضل|اقل|أقل|ارخص|أرخص|ادنى|أدنى|ترتيب|مرتب|قايمه|قائمه|قائمة|top)/i.test(normalized)
        || /(?:^|[\s،,])\d{1,2}\s*(?:سهم|سمهم|أسهم|اسهم)/i.test(normalized);
    const isPeriodRanking = !hasSymbol && marketListHintEnforce && (/(?:من\s+(?:اول|أول|بداية|بدايه)\s+(?:السنه|السنة|الشهر|الاسبوع|اسبوع)|من\s+يناير|خلال\s+(?:العام|الشهر|الاسبوع)|منذ\s+بداية\s+(?:العام|الشهر|الاسبوع)|ytd|mtd|wtd|الشهر\s+ده|الشهر\s+دا|الشهر\s+الحالي|هذا\s+الشهر|الاسبوع\s+ده|الاسبوع\s+دا|الاسبوع\s+الحالي|هذا\s+الاسبوع|هذا\s+العام|ف[يى]\s+(?:الاسبوع|الشهر|العام|السنه)|(?:الاسبوع|الشهر|العام|السنه)\s+(?:الماضي|الاخير|الفايت|الفائت))/i.test(normalized)
        || /(?:اعلي|أعلى|افضل|أفضل|اقل|أقل|ارخص|أرخص|ادنى|أدنى|بافضل|بأفضل|بافل|بأفل|بأعلى|باعلى|قايمه|قائمة|ترتيب).{0,35}(?:ارباح|أرباح|ارتفاع|صعود|اداء|أداء|عائد|سيول|تداول|حجم|ربح).{0,35}(?:اول|أول|بداية|بدايه|خلال|منذ).{0,20}(?:السنه|السنة|الشهر|الاسبوع|يناير|ytd|mtd|wtd)/i.test(normalized));
    if (isPeriodRanking) {
        return { intent: "market_summary", tools: ["get_price_history"], replaceTools: true };
    }
    if (/(اكبر|اعلى|اقوى)\s+قطاع.{0,25}(سيول|تداول)|(?:(?:ال)?سيول(?:ه)?).{0,30}(قطاع|القطاعات)|قطاع.{0,30}(?:(?:ال)?سيول(?:ه)?|تداول)/i.test(normalized)) {
        const sector = extractSectorFromMessage(normalized);
        return sector ? { intent: "sector_analysis", tools: ["get_sector_liquidity"], replaceTools: true, sector } : { intent: "market_summary", tools: ["get_sector_liquidity"], replaceTools: true };
    }
    if (/(قائمه|قايمه|قائمة|هات|جيب|اعرض).{0,20}(القطاعات|قطاعات)/i.test(normalized)) return { intent: "sector_analysis", tools: ["get_sector_list"], replaceTools: true };
    if (/(?:ارخص|أرخص)\s*(?:\d{1,2})?\s*(?:ال)?(?:اسهم|الاسهم|أسهم|الأسهم|سهم)/i.test(normalized) && !hasSymbol && !/(?:ارتفاع|صعود|عائد|اداء|أداء|سيول|تداول|خسار|انخفاض|هابط)/i.test(normalized)) return { intent: "market_summary", tools: ["get_price_history"], replaceTools: true };
    if (/(?:(?:أ|ا)عل[ىي]|(?:أ|ا)قو[ىي]).{0,25}(الاسهم|الأسهم|ارتفاع|صعود|اليوم|النهارده|اخر يوم|آخر يوم)/i.test(normalized)) return { intent: "market_summary", tools: ["get_market"], replaceTools: true };
    if (/(حاله|حالة).{0,12}(السوق|البورصه|البورصة)|(?:السوق|البورصه|البورصة).{0,12}(النهارده|اليوم|عامل|حاله|حالة)/i.test(normalized)) return { intent: "market_summary", tools: ["get_market"], replaceTools: true };
    if (/(اداء|أداء|رايك|رأيك).{0,15}(المؤشر|موشر|egx30)|(?:المؤشر|موشر).{0,15}(النهارده|اليوم|عامل)/i.test(normalized)) return { intent: "market_summary", tools: ["get_market"], replaceTools: true };
    if (/(سيول|تداول|liquidity)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
    if (/(سيول|تداول|liquidity)/i.test(normalized) && !hasSymbol) {
        const referencedSector = extractSectorFromMessage(message) || sessionState?.current_sector || extractSectorFromMessage(sessionState?.summary || "");
        if (referencedSector) {
            return { intent: "sector_analysis", tools: ["get_sector_liquidity"], replaceTools: true, sector: referencedSector };
        }
        return { intent: "market_summary", tools: ["get_market", "get_accumulation_stocks"], replaceTools: true };
    }
    const isSectorComparison = !marketFairValueScan && (
        mentionedSectors.length >= 2 ||
        /(?:أيهما|ايهما|مقارنة|مقارنه|مفاضلة|افضل|أفضل|احسن|أحسن|قارن|ترتيب|أقوى|اقوى|اعلى|أعلى).{0,30}(?:قطاع|القطاعات)/i.test(normalized) ||
        /(?:قطاع|القطاعات).{0,25}(?:احسن|افضل|أفضل|أحسن|مقارنة|مقارنه|مفاضلة|أقوى|اقوى).{0,25}(?:من|بين|ولا|أم|ام).{0,25}(?:قطاع|القطاعات|ادويه|أدوية|بنوك|عقارات|اتصالات|أغذية|اغذية|دواء|بتروكيماويات|طاقه|طاقة)/i.test(normalized) ||
        /(?:رايك|رأيك|ايه رايك|إيه رأيك).{0,25}(?:في|فى).{0,25}(?:قطاع|القطاعات).{0,35}(?:احسن|افضل|أفضل|أحسن|ولا|أم|ام).{0,35}(?:من|بين|قطاع|الادويه|الأدوية|الاتصالات|البنوك|العقارات|البتروكيماويات)/i.test(normalized)
    );
    if (isSectorComparison) {
        return { intent: "sector_analysis", tools: ["get_sector_liquidity"], replaceTools: true, sector: null, requested_sectors: mentionedSectors };
    }
    const isRecommendationQuery = isBestBuyStockQuestion(message) || /(?:توصيات|توصية|توصيه|ترشح|ترشيحات|فرص شراء|فرص دخول|اسهم ادخل فيها|اسهم اشتريها|اشتري ايه|ادخل في ايه|ادخل فيها|اسهم ممتازة|اسهم كويسة|تحقق ارباح|تحقق أرباح|توصيات كويسة|توصيات شراء|اسهم للشراء|فرص الشراء)/i.test(normalized);
    if (isRecommendationQuery) {
        if (hasSymbol) {
            return { intent: "stock_analysis", tools: ["get_stock", "get_recommendations", "get_stock_levels"], replaceTools: true };
        }
        return { intent: "market_summary", tools: ["get_recommendations"], replaceTools: true };
    }
    const sector = extractSectorFromMessage(normalized);
    if (sector && /(اخبار|خبر|news)/i.test(normalized)) return { intent: "sector_analysis", tools: ["get_sector", "get_news"], replaceTools: true, sector };
    if (sector && !hasSymbol) return { intent: "sector_analysis", tools: ["get_sector"], replaceTools: true, sector };
    if (plannerIntent === "stock_analysis" && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    return { intent: plannerIntent, tools: [] };
}

export function extractSectorFromMessage(message: string): string | null {
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    if (/(استصلاح|اراضي استصلاح|استصلاح اراضي|اراضى|زراعه|زراعي|زراعيه|agri|agriculture|reclamation)/i.test(normalized)) return "استصلاح أراضي";
    if (/(البنوك|بنوك|banking sector|banks)/i.test(normalized)) return "بنوك";
    if (/(العقارات|عقارات|عقاري|real estate)/i.test(normalized)) return "عقارات";
    if (/(الادويه|ادويه|دواء|صيدلان|صيدله|pharma|pharmaceutical|health technology|التكنولوجيا الصحيه|التكنولوجيا الصحية)/i.test(normalized)) return "أدوية";
    if (/(خدمات صحيه|الخدمات الصحيه|مستشفى|مستشفيات|health services|healthcare)/i.test(normalized)) return "خدمات صحية";
    if (/(الاغذيه|اغذيه|غذائي|مواد غذائيه|مواد استهلاكيه|consumer non-durables|food|beverage)/i.test(normalized)) return "أغذية";
    if (/(البترول|بترول|الطاقه|طاقه|oil|gas|energy)/i.test(normalized)) return "بترول";
    if (/(الانشاءات|انشاءات|مواد البناء|مواد بنا|تعدين|اسمنت|حديد|صلب|non-energy minerals|construction materials)/i.test(normalized)) return "مواد بناء وتعدين";
    if (/(اتصالات|الاتصالات|تكنولوجيا المعلومات|technology information|telecom|telecommunication)/i.test(normalized)) return "اتصالات وتكنولوجيا";
    if (/(نقل|الشحن|شحن|transport|logistics|transportation)/i.test(normalized)) return "نقل وشحن";
    if (/(تجزئه|تجزئة|بيع بالتجزئه|retail trade|retail)/i.test(normalized)) return "تجارة تجزئة";
    if (/(خدمات تجاريه|خدمات تجارية|commercial services)/i.test(normalized)) return "خدمات تجارية";
    if (/(سياحه|السياحه|فنادق|الفنادق|tourism|hotels|travel)/i.test(normalized)) return "سياحة وخدمات استهلاكية";
    if (/(finance|financial|مالي|تمويل|استثمار)/i.test(normalized)) return "Finance";
    return null;
}

export function needsLiveDataForTools(tools: string[]): boolean {
    const liveTools = new Set([
        "get_stock", "get_market", "get_indices", "get_news",
        "get_recommendations", "get_signals", "get_sector",
        "get_accumulation_stocks", "get_distribution_stocks", "get_sector_liquidity", "get_sector_list", "get_stock_levels", "get_comparison", "get_fair_value_scan", "get_price_history", "search_web"
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

export function buildTopMoversResponse(tools: StructuredToolOutput): string | null {
    const market = tools.results.find(result => result.tool === "get_market");
    const gainers = Array.isArray(market?.data?.top_gainers) ? market.data.top_gainers.filter((stock: any) => Number.isFinite(Number(stock?.change))) : [];
    if (!market) return null;
    if (gainers.length === 0) {
        return [
            `لا توجد بيانات تغير يومي كافية لترتيب أقوى الأسهم في آخر جلسة متاحة بتاريخ ${market.data_time}.`,
            "بيانات EGX30 وحدها تصف حالة السوق، لكنها لا تثبت أن سهماً معيناً كان الأقوى؛ لذلك لن أضع أسماء أو نسباً مخمّنة.",
            "الأفضل إعادة الطلب بعد تحديث بيانات الجلسة، أو طلب تحليل سهم محدد إذا كنت تريد فحص السعر والسيولة والمستويات المتاحة له."
        ].join("\n");
    }
    return [
        `أقوى الأسهم ارتفاعاً حسب آخر جلسة متاحة بتاريخ ${market.data_time}:`,
        ...gainers.slice(0, 10).map((stock: any, index: number) => `${index + 1}. ${stock.symbol}${stock.name && stock.name !== stock.symbol ? ` (${stock.name})` : ""}: ${Number(stock.change) >= 0 ? "+" : ""}${Number(stock.change).toFixed(2)}%.`),
        "الترتيب حسب نسبة التغير في الجلسة، وليس توصية شراء أو تقييماً للقيمة العادلة."
    ].join("\n");
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
    const deadlineAt = Date.now() + AI_CONFIG.limits.requestDeadlineMs;
    const ensureBudget = (reserveMs = 0) => {
        if (Date.now() + reserveMs >= deadlineAt) throw new Error("PIPELINE_DEADLINE_EXCEEDED");
    };
    const hasImages = images.length > 0;
    let vision: VisionContext | null = null;
    let visionError: string | null = null;
    let memory: MemoryResult | null = null;

    try {
        // Warm up the Arabic names cache for synchronous extraction later
        await getStocksList();

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

    // ===== STAGE 3: Intent / Entity Planner =====
    yield { type: "status", data: { status: "planner", message: "تحليل النية وتخطيط الأدوات..." } };
    if (!hasImages) await getStocksList();

    // ─── Deterministic intent/entity planner ───
    const plannerResult = buildCompoundDeterministicPlan(userMessage, sessionState)
        ?? generalChatPlan(sessionState);

    const prefs = extractInvestorPreferences(userMessage);
    if (prefs.budget !== null || prefs.horizon !== null || prefs.risk_tolerance !== null || prefs.sector !== null) {
        sessionState = {
            ...sessionState,
            investment_budget: prefs.budget !== null ? prefs.budget : sessionState.investment_budget,
            investment_horizon: prefs.horizon !== null ? prefs.horizon : sessionState.investment_horizon,
            risk_tolerance: prefs.risk_tolerance !== null ? prefs.risk_tolerance : sessionState.risk_tolerance,
            preferred_sectors: prefs.sector 
                ? Array.from(new Set([...(sessionState.preferred_sectors || []), prefs.sector]))
                : sessionState.preferred_sectors
        };
    }

    const explicitSymbols = extractExplicitSymbols(userMessage);
    const broadScanRequest = explicitSymbols.length === 0 && /(?:الاسهم|اسهم|هات|ابعت|اعرض).{0,40}(?:تجميع|تصريف)|(?:تجميع|تصريف).{0,40}(?:الاسهم|اسهم)/i.test(normalizeArabicIntent(userMessage));
    let mergedSymbols = explicitSymbols.length > 0
        ? explicitSymbols
        : Array.from(new Set([
            ...mergeVisionSymbols(plannerResult.entities.symbols || [], vision)
        ]));
    mergedSymbols = clearsStockContext(plannerResult) 
        ? explicitSymbols 
        : scopeImplicitSingleStockRequest(userMessage, explicitSymbols, mergedSymbols, sessionState.current_symbol, memory?.resolved_references?.symbol || null);
    const riskFollowUp = /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage);
    if (riskFollowUp && mergedSymbols.length === 0) {
        const recentSymbol = extractSingleStockFromRecentHistory(history);
        if (recentSymbol) mergedSymbols.push(recentSymbol);
    }
    if (mergedSymbols.length === 0 && memory?.resolved_references?.symbol) {
        mergedSymbols.push(memory.resolved_references.symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(أبيع|ابيع|بيع|أحتفظ|احتفظ|أخرج|اخرج|بكام|بكم|السعر)/i.test(userMessage) && !isBestBuyStockQuestion(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(اخباره|أخباره|هات\s+اخبار|هات\s+أخبار|خبره)/i.test(userMessage)) mergedSymbols.push(sessionState.current_symbol);
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && (
        /(عليه|عليها|فيه|فيها|ليه|ليها|له|لها|عنه|عنها|به|بها|معاه|معاها|هو|هي|ده|دي|هذا|هذه|تجميع|تصريف|تحليل|مؤشر|مؤشرات|دعم|مقاومة|مقاومه)/i.test(userMessage) ||
        userMessage.trim().split(/\s+/).length <= 3
    ) && !isMarketWideRequest(userMessage) && !isBestBuyStockQuestion(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    // An explicit company-name phrase that resolves to no known symbol ("حلل دلتا للطباعه")
    // must not inherit the previous session symbol — the responder would analyze the WRONG stock.
    const unresolvedNameMatch = userMessage.match(/(?:^|[\s،,])(\S{2,}\s+لل\S{2,})/);
    const unresolvedStockName = explicitSymbols.length === 0 && unresolvedNameMatch && !vision
        ? unresolvedNameMatch[1].replace(/[.،,؟?…].*$/, "").trim()
        : null;
    if (unresolvedStockName) mergedSymbols = [];
    const compoundRequest = splitChatCommands(userMessage).length > 1;
    if ((isMarketWideRequest(userMessage) || broadScanRequest || isBestBuyStockQuestion(userMessage)) && !compoundRequest && extractExplicitSymbols(userMessage).length === 0) mergedSymbols = [];
    if (plannerResult.entities.sector && extractExplicitSymbols(userMessage).length === 0) mergedSymbols = [];
    const fairValueScanRequest = isFairValueScanRequest(userMessage);
    const enforced: ReturnType<typeof enforceIntentFromMessage> = compoundRequest
        ? { 
            intent: plannerResult.intent, 
            tools: plannerResult.tools || [], 
            replaceTools: true, 
            scan_direction: plannerResult.entities.scan_direction || undefined,
            fair_value_direction: plannerResult.entities.fair_value_direction || undefined,
            require_distribution: plannerResult.entities.require_distribution,
            require_accumulation: plannerResult.entities.require_accumulation
          }
        : fairValueScanRequest
            ? { intent: "market_summary", tools: ["get_fair_value_scan"], replaceTools: true }
            : enforceIntentFromMessage(userMessage, plannerResult.intent, mergedSymbols, sessionState);
    const marketScopedTools = new Set(["get_market", "get_sector_liquidity", "get_sector_list", "get_fair_value_scan"]);
    if (explicitSymbols.length === 0 && enforced.tools.some(tool => marketScopedTools.has(tool))) mergedSymbols = [];
    const datedDomainRequest = Boolean(extractRequestedDate(userMessage) || extractRequestedDateRange(userMessage)) && ["stock_analysis", "stock_news", "comparison", "sector_analysis", "accumulation_distribution"].includes(enforced.intent);
    const historicalRequest = needsHistoricalData(enforced.intent, userMessage);
    const effectiveIntent = historicalRequest && !datedDomainRequest ? "historical_recall" : enforced.intent;

    const plannedTools = sanitizePlannerTools(userMessage, enforced.replaceTools
        ? enforced.tools
        : Array.from(new Set([...(plannerResult.tools || []), ...enforced.tools])));
    // Day-by-day change questions need the daily price rows; the compound-command
    // path above can bypass enforceIntentFromMessage and the planner sometimes
    // omits get_price_history, so re-add it here.
    if (!plannedTools.includes("get_price_history")
        && mergedSymbols.length > 0
        && /يوم\s*بـ?\s*يوم|التغير\s*اليومي|تغير\s*يومي|سعر\s*كل\s*يوم|أداء\s*يومي|(?:اخر|آخر)\s*(?:اسبوع|أسبوع|ايام|أيام|جلسات).{0,30}(?:تغير|نسب)/i.test(userMessage)) {
        plannedTools.push("get_price_history");
    }
    const requestedRange = extractRequestedDateRange(userMessage);
    let guidanceIntent = plannerResult.guidance_intent || getInvestorGuidanceIntent(userMessage, mergedSymbols.length > 0);
    const dataScanTools = new Set(["get_price_history", "get_accumulation_stocks", "get_distribution_stocks", "get_fair_value_scan", "get_recommendations", "get_sector_liquidity"]);
    if ((mergedSymbols.length > 0 && guidanceIntent !== "product_comparison") || plannedTools.some(t => dataScanTools.has(t))) {
        guidanceIntent = null;
    }
    const excludedSectors = extractExcludedSectors(userMessage);
    const plannerExcludedSectors = plannerResult.entities.excluded_sectors || [];
    const comparesSectors = plannedTools.includes("get_sector_liquidity") && enforced.sector === null;
    const plan: IntentPlan = {
        intent: mapIntent(effectiveIntent),
        confidence: plannerResult.confidence || 0.8,
        guidance_intent: guidanceIntent,
        entities: {
            symbols: mergedSymbols,
            sector: comparesSectors || (excludedSectors.length > 0 && plannedTools.includes("get_sector_liquidity")) ? null : enforced.sector || plannerResult.entities.sector || null,
            timeframe: extractTemporalContext(userMessage).timeframe,
            reference: memory?.resolved_references?.symbol ? "last_image" : null
            ,scan_direction: enforced.scan_direction || plannerResult.entities.scan_direction || null
            ,fair_value_direction: enforced.fair_value_direction || plannerResult.entities.fair_value_direction || null
            ,require_distribution: Boolean(enforced.require_distribution || plannerResult.entities.require_distribution)
            ,require_accumulation: Boolean(enforced.require_accumulation || plannerResult.entities.require_accumulation)
            ,recommendation_order: enforced.recommendation_order || plannerResult.entities.recommendation_order || null
            ,min_acc_score: plannerResult.entities.min_acc_score ?? null
            ,min_vol_ratio: plannerResult.entities.min_vol_ratio ?? null
            ,excluded_sectors: Array.from(new Set([...excludedSectors, ...plannerExcludedSectors]))
            ,requested_sectors: enforced.requested_sectors || plannerResult.entities.requested_sectors || []
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
        yield {
            type: "status",
            data: {
                status: "tools",
                message: plan.tools.includes("search_web") ? "البحث على الإنترنت في مصادر فعلية..." : "جلب بيانات السوق..."
            }
        };
    }
    ensureBudget(8000);
    const tools = await Promise.race([
        executeStructuredTools(supabase, plan, apiKeys, userId, sessionId, userMessage, history),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TOOLS_TIMEOUT")), AI_CONFIG.limits.toolsTimeoutMs)),
    ]);
    // Apply custom user filters if present in message (e.g. "أعلى من 75", "يومين")
    if (userMessage) {
        const scoreMatch = userMessage.match(/(?:أعلى|اكثر|أكبر|اكبر|فوق).{1,10}?(\d{2,3})/i) || userMessage.match(/(\d{2,3}).{1,10}?(?:فأكثر|فاكثر)/i);
        const minScore = scoreMatch ? parseInt(scoreMatch[1] || scoreMatch[2] || "0", 10) : 0;
        
        const volMatch = userMessage.match(/(?:نسبة الحجم|سيوله|سيولة).{1,15}?(?:أكبر|اعلى|أعلى).{1,10}?(\d+(?:\.\d+)?)/i);
        const minVol = volMatch ? parseFloat(volMatch[1]) : 0;
        
        const daysMatch = userMessage.match(/(?:يومين)/i) ? 2 : (userMessage.match(/(?:أيام|ايام).{1,10}?(\d+)/i) ? parseInt(userMessage.match(/(?:أيام|ايام).{1,10}?(\d+)/i)![1], 10) : 0);
        
        tools.results.forEach(res => {
            if (res.tool === "get_accumulation_stocks" || res.tool === "get_distribution_stocks") {
                const scoreField = res.tool === "get_accumulation_stocks" ? "acc_score" : "dist_score";
                const daysField = res.tool === "get_accumulation_stocks" ? "consecutive_acc_days" : "consecutive_dist_days";
                
                const filterFn = (s: any) => {
                    let pass = true;
                    if (minScore > 0 && Number(s[scoreField] || 0) <= minScore) pass = false;
                    if (minVol > 0 && Number(s.vol_ratio || 0) <= minVol) pass = false;
                    if (daysMatch > 0 && Number(s[daysField] || 0) < daysMatch) pass = false;
                    return pass;
                };

                if (Array.isArray(res.data?.stocks)) {
                    res.data.stocks = res.data.stocks.filter(filterFn);
                }
                if (Array.isArray(res.data?.scan_rows)) {
                    res.data.scan_rows = res.data.scan_rows.filter(filterFn);
                }
                if (Array.isArray(res.symbols)) {
                    res.symbols = res.symbols.filter((sym: string) => {
                        const row = (res.data?.stocks || []).find((s: any) => String(s.symbol).toUpperCase() === String(sym).toUpperCase());
                        return !!row;
                    });
                }
            }
        });
    }

    const tables = buildExcelTables(tools.results, vision);
    if (tables.length > 0) yield { type: "tables", data: tables };
    if (tools.results.length > 0) {
        yield { type: "tools_data", data: tools };
    }

    await saveFactSnapshots(supabase, userId, sessionId, tools, vision, messageId);

    // ===== STAGE 5: Final Response =====
    const topMoversRequest = /(أعلى|اعلى|أقوى|اقوى).{0,25}(الأسهم|اسهم|ارتفاع|صعود|النهارده|اليوم|اخر يوم|آخر يوم|جلسه|جلسة)/i.test(userMessage);
    const deterministicLiquidityResponse = topMoversRequest
        ? buildTopMoversResponse(tools)
        : plan.intent === "market_summary" && plan.entities.symbols.length === 0
        && !plan.tools.includes("get_fair_value_scan")
        && !plan.entities.scan_direction
        ? buildMarketLiquidityResponse(tools)
        : null;
    const isAnalyticalQueryRegex = /(سبب|ليه|لماذا|ازاي|إزاي|تفسير|سر|ينزل|يهبط|يطلع|صعود|هبوط|فرص|أحسن|احسن|افضل|أفضل|توقعات|متوقع|مقارن|قارن|حالة|حالتها|رايك|رأيك|توجيه|تجميع|تصريف|تحليل|شراء|بيع|مناسب|مكمل|مستمر|جلسه|جلسة|غدا|غداً|اشترى|اشتري|اشتريت|خسران|نازل|عادله|عادلة|تقييم|قيمته|تسوى|تساوي|أهداف|اهداف|احتفاظ|خروج|دخول|بيجمع|ينطلق|مؤشر|مؤشرات|اخبار|أخبار|إيه|ايه|هل|فين|مين|مسح|شروط|\?|؟)/i;
    const isAnalyticalQuery = isAnalyticalQueryRegex.test(userMessage) || userMessage.trim().split(/\s+/).length > 4;
    
    const hasScanTool = tools.results.some(res => res.tool === "get_accumulation_stocks" || res.tool === "get_distribution_stocks");
    const isMarketWideScan = hasScanTool && mergedSymbols.length === 0;

    // Check if scan filters resulted in 0 stocks on a market-wide scan to prevent LLM hallucinations
    let emptyScanResult = false;
    let scanStale = false;
    let scanDate: string | null = null;
    const directionAr = plan.entities.scan_direction === "distribution" ? "تصريف" : "تجميع";
    if (isMarketWideScan) {
        tools.results.forEach(res => {
            if (res.tool === "get_accumulation_stocks" || res.tool === "get_distribution_stocks") {
                if (Array.isArray(res.data?.stocks) && res.data.stocks.length === 0) {
                    emptyScanResult = true;
                    if (res.data?.validation && !res.data.validation.ok) scanStale = true;
                    if (res.data?.date) scanDate = String(res.data.date);
                }
            }
        });
    }

    const deterministicDomainResponse = emptyScanResult
        ? scanStale
            ? `آخر مسح ${directionAr} مسجل في قاعدة البيانات بتاريخ ${scanDate || "غير محدد"} (أقدم من 7 أيام)، ولم يسجل هذا المسح أي أسهم في منطقة ${directionAr}. يتم تحديث بيانات المسح بشكل دوري.`
            : plan.entities.min_acc_score != null || plan.entities.min_vol_ratio != null || plan.entities.min_consecutive_acc_days != null
                ? `عذراً، لم أجد أي أسهم تطابق الشروط التي حددتها حالياً. يمكنك محاولة تخفيف الشروط (مثل تقليل درجة ${directionAr} المطلوبة أو نسبة الحجم) للحصول على نتائج.`
                : `حالياً لا توجد أسهم في منطقة ${directionAr} واضحة بناءً على أحدث بيانات المسح المتاحة (بتاريخ ${scanDate || "اليوم"}). هذا يعني أن السوق قد لا يمر بمرحلة ${directionAr} مؤسسي واضحة في الوقت الحالي.`
        : null;

    const deterministicResponse = deterministicDomainResponse;
    if (deterministicResponse) {
        const response = deterministicResponse;
        const deterministicSessionUpdate = clearsStockContext(plan)
            ? { current_symbol: null, last_symbols: plan.entities.symbols || [], summary: userMessage, current_sector: plan.entities.sector || sessionState.current_sector || null }
            : { current_symbol: plan.entities.symbols[0] || sessionState.current_symbol, last_symbols: Array.from(new Set([...(plan.entities.symbols || []), ...(sessionState.last_symbols || [])])).slice(0, 15), summary: userMessage, current_sector: plan.entities.sector || sessionState.current_sector || null };
        yield { type: "token", data: response };
        await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
        yield { type: "done", data: { response, session_update: deterministicSessionUpdate, tables } };
        return;
    }

    // Earnings data requests have no backing data source (tools: []) — bypass the LLM entirely
    // with a clear deterministic answer instead of risking a validation failure / empty fallback.
    if (tools.results.length === 0 && isEarningsDataRequest(userMessage)) {
        const earningsResponse = plan.entities.symbols.length > 0
            ? `لا تتوفر لدي حالياً بيانات أرباح موثقة للفترة المطلوبة للسهم ${plan.entities.symbols.join("، ")}. لذلك لن أستبدل سؤال الأرباح بالسعر أو RSI. يمكنني تحليل السعر فنياً، أو عرض الأرباح عند إضافة مصدر قوائم مالية مؤرخ للنظام.`
            : "لا تتوفر لدي حالياً بيانات أرباح موثقة للشركات في قاعدة البيانات. يمكنني تحليل السعر والسيولة والتجميع والتصريف فنياً، أو عرض الأرباح عند إضافة مصدر قوائم مالية مؤرخ للنظام.";
        yield { type: "token", data: earningsResponse };
        await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
        yield { type: "done", data: { response: earningsResponse, session_update: { current_symbol: plan.entities.symbols[0] || sessionState.current_symbol, last_symbols: Array.from(new Set([...(plan.entities.symbols || []), ...(sessionState.last_symbols || [])])).slice(0, 15), summary: userMessage, current_sector: plan.entities.sector || sessionState.current_sector || null }, tables } };
        return;
    }

    // Explicit company name that matched no listed stock — say so instead of silently
    // answering about whatever the session previously discussed.
    if (tools.results.length === 0 && unresolvedStockName) {
        const unknownStockResponse = `لم أجد شركة بهذا الاسم («${unresolvedStockName}») في قاعدة بيانات البورصة المصرية المتاحة لي، لذلك لن أحلل سهمًا آخر بدلًا منه. تأكد من كتابة الاسم كما هو معروف في السوق أو اكتب الرمز اللاتيني (مثل AMES أو COMI)، ولو كانت الشركة غير مدرجة في EGX فهي خارج تغطية النظام حاليًا.`;
        yield { type: "token", data: unknownStockResponse };
        await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
        yield { type: "done", data: { response: unknownStockResponse, session_update: { current_symbol: null, last_symbols: sessionState.last_symbols || [], summary: userMessage, current_sector: plan.entities.sector || sessionState.current_sector || null }, tables } };
        return;
    }

    // ===== STAGE 5: Final Response =====
    yield { type: "status", data: { status: "generating", message: "إنشاء الرد..." } };
    const scopedMemory = plan.needs_historical_data || plan.entities.reference
        ? memory?.relevant_snapshots || []
        : [];
    ensureBudget(5000);

    const validSymbols = await loadValidSymbols();
    
    // We construct the liveDataString to pass to the validator
    let liveDataString = "";
    if (Array.isArray(tools.results)) {
        tools.results.forEach(r => {
            liveDataString += `\nالأداة: ${r.tool} | البيانات: ${JSON.stringify(r.data)}`;
        });
    }

    let attempts = 0;
    const maxAttempts = 2;
    let correctionPrompt: string | undefined = undefined;
    let finalReply = "";

    // ⛔ Phrases that should stop further streaming output (usually disclaimers at the end)
    const STREAM_STOP_PHRASES = [
        "📌 إدارة المخاطر",
        "إدارة المخاطر:",
    ];

    // ⚠️ Phrases that should be skipped/suppressed, but allow the rest of the stream to continue
    const STREAM_SKIP_PHRASES = [
        "البيانات الحية المتاحة، هذه مقارنة فنية",
        "الأسهم الموضحة بالجدول أعلاه",
        "مرحباً بكم في هذا المقال",
        "مرحبا بكم في هذا المقال",
    ];

    const responderMeta: { source?: "llm" | "deterministic"; degraded?: boolean } = {};

while (attempts < maxAttempts) {
        let currentResponse = "";
        let pendingModelText = "";
        let streamStopped = false;

        responderMeta.source = undefined;
        responderMeta.degraded = false;
        const stream = generateV2Stream(
            userMessage, plan, vision, tools.results,
            scopedMemory,
            memory?.recent_messages || [],
            memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
            apiKeys,
            requestedModel,
            sessionState,
            correctionPrompt,
            responderMeta
        );

        for await (const chunk of stream) {
            if (streamStopped) break;
            pendingModelText += chunk;
            const lines = pendingModelText.split("\n");
            pendingModelText = lines.pop() || "";
            for (const line of lines) {
                if (streamStopped) break;
                // Deterministic replies or table-requested queries preserve their markdown tables
                if (isMarkdownTableLine(line) && responderMeta.source !== "deterministic" && !plan.entities.wants_table && !/(جدول|قايمه|قائمة|ترتيب|table|list)/i.test(userMessage)) continue;

                // Stop if matching stop phrases
                if (STREAM_STOP_PHRASES.some(phrase => line.includes(phrase))) {
                    streamStopped = true;
                    break;
                }

                // Skip if matching skip phrases
                if (STREAM_SKIP_PHRASES.some(phrase => line.includes(phrase))) {
                    continue;
                }

                let cleanLine = line.replace(/^(?:من خلال التحليل الفني|من خلال تحليل البيانات|بناءً على البيانات المتاحة|بناء على البيانات المتاحة)[،:\s]+/gi, "");

                currentResponse += `${cleanLine}\n`;
            }
        }

        if (!streamStopped && pendingModelText && (!isMarkdownTableLine(pendingModelText) || responderMeta.source === "deterministic" || plan.entities.wants_table || /(جدول|قايمه|قائمة|ترتيب|table|list)/i.test(userMessage))) {
            const shouldStop = STREAM_STOP_PHRASES.some(phrase => pendingModelText.includes(phrase));
            const shouldSkip = STREAM_SKIP_PHRASES.some(phrase => pendingModelText.includes(phrase));
            if (!shouldStop && !shouldSkip) {
                const cleanText = pendingModelText.replace(/^(?:من خلال التحليل الفني|من خلال تحليل البيانات|بناءً على البيانات المتاحة|بناء على البيانات المتاحة)[،:\s]+/gi, "");
                currentResponse += cleanText;
            }
        }

        currentResponse = currentResponse.trim();

        // Deterministic replies are template-built from live tool data — re-validating
        // them only wastes an attempt cycle. A degraded fallback (all providers failed)
        // gets one cheap retry: models in 429 cooldown are skipped instantly, so the
        // retry only costs time when a short rate-limit window expired and a model recovered.
        if (responderMeta.source === "deterministic") {
            if (!responderMeta.degraded || attempts >= maxAttempts - 1) {
                finalReply = currentResponse;
                break;
            }
            // Wait out short per-minute rate-limit windows so the retry can recover
            // a natural reply; long storms (daily quota etc.) fail fast with the template.
            const cooldownMs = getResponderCooldownMs();
            if (cooldownMs > 45_000) {
                console.warn("[VALIDATOR] Degraded fallback with long provider cooldown — serving deterministic reply");
                finalReply = currentResponse;
                break;
            }
            if (cooldownMs > 0) await new Promise(r => setTimeout(r, cooldownMs + 500));
            attempts++;
            continue;
        }

        // Run validation
        currentResponse = autoFixNumbers(currentResponse, tools.results);
        const validation = validateResponse(currentResponse, liveDataString, validSymbols, tools.results, userMessage);
        if (validation.isValid) {
            finalReply = currentResponse;
            break;
        }

        // If it is the last attempt and still invalid, fall back to safe response
        if (attempts === maxAttempts - 1) {
            console.warn(`[VALIDATOR] Attempt ${attempts + 1} failed validation! Reached max retries. Using safe fallback.`);
            finalReply = buildSafeFallbackResponse(tools.results, plan);
            break;
        }

        // If invalid, log warning and set correction prompt
        console.warn(`[VALIDATOR] Attempt ${attempts + 1} failed validation! Suspicious Symbols: ${validation.suspiciousSymbols.join(", ")}, Suspicious Numbers: ${validation.suspiciousNumbers.join(", ")}, Has Repetitions: ${validation.hasRepetitions}, Det Errors: ${validation.deterministicErrors?.join("; ")}, EnglishThinking: ${Boolean(validation.englishThinking)}`);
        
        yield { type: "status", data: { status: "generating", message: `كشف أخطاء في الرد (محاولة ${attempts + 1})، جاري إعادة الصياغة تلقائياً...` } };
        
        correctionPrompt = "تنبيه هام ومؤكد للالتزام بالبيانات:\n";
        if (validation.englishThinking) {
            correctionPrompt += "- لقد كتبت نص التفكير بالإنجليزية بدلاً من الرد. يمنع تماماً كتابة أي تفكير أو عبارات إنجليزية؛ أكتب الرد النهائي فقط باللغة العربية وبصياغة مباشرة تجيب على سؤال المستخدم.\n";
        }
        if (validation.suspiciousSymbols.length > 0) {
            correctionPrompt += `- لقد استخدمت رموز أسهم غير حقيقية أو غير موجودة في البيانات المتاحة: (${validation.suspiciousSymbols.join(", ")}). يمنع تماماً اختراع أي رمز سهم.\n`;
        }
        if (validation.suspiciousNumbers.length > 0) {
            correctionPrompt += `- لقد قمت باختلاق أو استخدام أرقام/نسب/أسعار غير موجودة بالبيانات المرفقة: (${validation.suspiciousNumbers.join(", ")}). التزم حرفياً بالأرقام والأسعار والنسب المعطاة فقط، وإذا لم يتوفر الرقم اكتب 'غير متوفر' ولا تخترع أي رقم.\n`;
        }
        if (validation.deterministicErrors && validation.deterministicErrors.length > 0) {
            correctionPrompt += `- لقد ذكرت معلومات تتعارض مع حقائق قاعدة البيانات:\n`;
            validation.deterministicErrors.forEach(err => {
                correctionPrompt += `  * ${err}\n`;
            });
            correctionPrompt += `يمنع تماماً الاستنتاج الضمني (Implicit Inference) لأي زخم أو مرحلة تداول إلا بوجود الدليل الصريح. التزم حرفياً بالقيم المعطاة في البيانات فقط!\n`;
        }
        if (validation.hasRepetitions) {
            correctionPrompt += `- لقد قمت بتكرار نفس العبارات أو الجمل بشكل متكرر غير طبيعي. أعد صياغة الرد بلغة عربية سلسلة ومتنوعة وبدون تكرار أي عبارة أو سطر.\n`;
        }
        correctionPrompt += "أعد صياغة الرد بالكامل مع الالتزام التام ببيانات الجدول والبيانات الحقيقية المعطاة فقط وبدون أي أرقام أو رموز خارجية.";

        attempts++;
    }

    let fullResponse = sanitizeReply(finalReply);

    // 🛡️ Final safety net: if the reply is not an Arabic answer (e.g. leaked
    // English chain-of-thought survived all attempts), use the safe Arabic fallback.
    const finalArabicChars = (fullResponse.match(/[\u0600-\u06FF]/g) || []).length;
    const finalAsciiChars = (fullResponse.match(/[A-Za-z]/g) || []).length;
    if (finalArabicChars < 40 || finalAsciiChars > finalArabicChars) {
        console.warn("[VALIDATOR] Final reply lacks Arabic content — using safe fallback");
        fullResponse = sanitizeReply(buildSafeFallbackResponse(tools.results, plan));
    }

    // Now stream the final, verified response to the client
    const responseLines = fullResponse.split("\n");
    for (let i = 0; i < responseLines.length; i++) {
        const line = responseLines[i];
        const token = i === responseLines.length - 1 ? line : `${line}\n`;
        yield { type: "token", data: token };
    }

    // ===== Update Session =====
    const allSymbols = new Set<string>();
    if (plan.entities.symbols) plan.entities.symbols.forEach(s => allSymbols.add(s));
    if (vision?.symbols) vision.symbols.forEach(s => allSymbols.add(s.symbol));
    if (memory?.resolved_references?.symbol) allSymbols.add(memory.resolved_references.symbol);
    if (Array.isArray(tools.results)) {
        tools.results.forEach(res => {
            if (Array.isArray(res.symbols)) {
                res.symbols.forEach((s: string) => allSymbols.add(s));
            }
        });
    }

    const finalSymbols = Array.from(allSymbols).filter(Boolean);
    const sessionUpdate = {
        current_symbol: clearsStockContext(plan) ? null : (finalSymbols[0] || sessionState.current_symbol),
        last_symbols: Array.from(new Set([...finalSymbols, ...(sessionState.last_symbols || [])])).slice(0, 15),
        summary: userMessage || (hasImages ? "تحليل صورة" : null),
        current_sector: plan.entities.sector || sessionState.current_sector || null
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
    yield { type: "done", data: { response: fullResponse, session_update: sessionUpdate, tables } };
    } catch (err: any) {
        console.error("Pipeline stream error caught:", err);
        const isTimeout = /PIPELINE_DEADLINE_EXCEEDED|DEADLINE|Timeout|AbortError/i.test(err?.message || "");
        const fallbackText = isTimeout
            ? "معذرة، استغرق التحليل وقتًا أطول من المتوقع نظرًا لضغط السيرفرات حالياً. يرجى إعادة إرسال السؤال أو تجربة السؤال بدون صورة للحصول على رد فوري."
            : "حدث خطأ أثناء معالجة الطلب، يرجى إعادة المحاولة مرة أخرى.";

        yield { type: "token", data: fallbackText };
        yield { type: "done", data: {
            response: fallbackText,
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: sessionState.summary },
            tables: []
        } };
    }
}

import { ToolResult } from "./types";

 function buildSafeFallbackResponse(toolsResults: ToolResult[], plan: IntentPlan): string {
     const sectorLiquidity = toolsResults.find(result => result.tool === "get_sector_liquidity");
     if (sectorLiquidity) {
         return buildDeterministicResponse("سيولة القطاعات", plan, toolsResults)
             || "تعذر صياغة ملخص سيولة القطاعات، لكن البيانات الموثقة متاحة في الجدول.";
     }
     const isSectorScoped = plan.tools.includes("get_sector_liquidity") || plan.tools.includes("get_sector_list") || plan.intent === "sector_analysis";
     const stockResult = toolsResults.find(result => result.tool === "get_stock" && result.data?.symbol);
     const symbol = isSectorScoped ? null : (stockResult?.data?.symbol || plan.entities.symbols?.[0] || null);
     
     const otcNotice = symbol && isOtcStock(symbol) ? buildOtcNotice(symbol) : null;

     const lines = [
         symbol
             ? `البيانات الفنية والتحليلية المعتمدة لسهم ${symbol}:`
             : "البيانات الفنية والتحليلية المعتمدة:",
         otcNotice ? `\n${otcNotice}\n` : ""
     ];

    let hasContent = false;

    if (Array.isArray(toolsResults)) {
        toolsResults.forEach(r => {
            if (r.tool === "get_stock" && r.data?.symbol) {
                hasContent = true;
                const d = r.data;
                lines.push(`📊 **بيانات التداول اللحظية لـ ${d.symbol}:**`);
                lines.push(`  • السعر الحالي: ${d.price} جنيه`);
                lines.push(`  • نسبة التغير: ${d.change_pct}`);
                if (d.rsi_14 !== undefined && d.rsi_14 !== null) lines.push(`  • مؤشر RSI: ${d.rsi_14}`);
                if (d.macd_signal !== undefined && d.macd_signal !== null) lines.push(`  • مؤشر MACD: ${d.macd_signal}`);
                if (d.vol_ratio !== undefined && d.vol_ratio !== null) lines.push(`  • نسبة الحجم: ${d.vol_ratio}`);
                lines.push("");
            }
            if (r.tool === "get_stock_levels" && r.data?.symbol) {
                hasContent = true;
                const d = r.data;
                lines.push(`📍 **المستويات الفنية لـ ${d.symbol}:**`);
                lines.push(`  • الدعم الحسابي: ${d.support !== undefined && d.support !== null ? d.support + " جنيه" : "غير متاح"}`);
                lines.push(`  • المقاومة الحسابية: ${d.resistance !== undefined && d.resistance !== null ? d.resistance + " جنيه" : "غير متاح"}`);
                if (d.trading_zone) lines.push(`  • المنطقة السعرية الحالية: ${d.trading_zone}`);
                lines.push("");
            }
            if (r.tool === "get_price_history" && Array.isArray(r.data?.market_period_ranking) && r.data.market_period_ranking.length > 0) {
                hasContent = true;
                const d = r.data;
                const metricName = d.wants_liquidity ? "السيولة" : "العائد";
                const metricCol = d.wants_liquidity ? "قيمة التداول" : "نسبة التغيير";
                lines.push(`📊 **ترتيب الأسهم حسب ${metricName} (${d.period_label || d.period_type || "الفترة المحددة"}):**`);
                // Markdown table rows survive the sanitizer's English-CoT filter; plain
                // numbered lists with English symbols get dropped line-by-line.
                lines.push(`| # | الرمز | الشركة | السعر الحالي | سعر بداية الفترة | ${metricCol} |`);
                lines.push(`| :---: | :--- | :--- | :---: | :---: | :---: |`);
                d.market_period_ranking.slice(0, 10).forEach((s: any, idx: number) => {
                    const metricVal = d.wants_liquidity
                        ? (Number(s.liquidity || 0) >= 1_000_000
                            ? `${(Number(s.liquidity) / 1_000_000).toFixed(2)} مليون ج.م`
                            : `${Number(s.liquidity || 0).toFixed(2)} ج.م`)
                        : `${Number(s.return_pct) >= 0 ? "+" : ""}${s.return_pct}%`;
                    lines.push(`| ${idx + 1} | ${s.symbol} | ${s.name || s.symbol} | ${s.current_price} ج.م | ${s.start_price} ج.م | ${metricVal} |`);
                });
                lines.push("");
            }
            if (r.tool === "get_price_history" && r.data?.symbol && r.data?.latest) {
                hasContent = true;
                const d = r.data;
                lines.push(`📈 **آخر جلسة لـ ${d.symbol}:** إغلاق ${d.latest.close} جنيه بتاريخ ${d.latest.date}`);
                if (d.previous_close != null && Number(d.previous_close) > 0) {
                    const pct = ((Number(d.latest.close) - Number(d.previous_close)) / Number(d.previous_close)) * 100;
                    lines.push(`  • التغير عن الإغلاق السابق: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`);
                }
                lines.push("");
            }
            if ((r.tool === "get_accumulation_stocks" || r.tool === "get_distribution_stocks") && r.data) {
                hasContent = true;
                const d = r.data;
                const dirAr = d.direction === "distribution" ? "التصريف" : "التجميع";
                const scoreField = d.direction === "distribution" ? "dist_score" : "acc_score";
                const scanStocks = Array.isArray(d.stocks) ? d.stocks : [];
                if (scanStocks.length > 0) {
                    lines.push(`📊 **أسهم ${dirAr} (بيانات بتاريخ ${d.date || "غير محدد"}):**`);
                    lines.push(`| # | الرمز | الشركة | درجة ${dirAr} | نسبة الحجم | التغير |`);
                    lines.push(`| :---: | :--- | :--- | :---: | :---: | :---: |`);
                    scanStocks.slice(0, 10).forEach((s: any, idx: number) => {
                        const changeStr = Number(s.change_pct || 0) >= 0 ? `+${Number(s.change_pct).toFixed(2)}%` : `${Number(s.change_pct).toFixed(2)}%`;
                        lines.push(`| ${idx + 1} | ${s.symbol} | ${s.name || s.symbol} | ${s[scoreField]}/100 | ${s.vol_ratio}x | ${changeStr} |`);
                    });
                } else {
                    lines.push(`📊 **مسح ${dirAr}:** لا توجد أسهم تطابق شروط المسح في البيانات المتاحة بتاريخ ${d.date || "غير محدد"}.`);
                }
                lines.push("");
            }
            if (r.tool === "get_news" && Array.isArray(r.data) && r.data.length > 0) {
                hasContent = true;
                lines.push(`📰 **الأخبار المتاحة:**`);
                r.data.slice(0, 5).forEach((item: any) => {
                    const sentiment = Number(item.sentiment_score || 0) > 0.15 ? "إيجابي" : Number(item.sentiment_score || 0) < -0.15 ? "سلبي" : "محايد";
                    lines.push(`  • ${item.symbol || "السوق"}: معنويات ${sentiment} | عدد الأخبار: ${item.news_count || 0}`);
                    (item.headlines || []).slice(0, 3).forEach((hl: string) => lines.push(`    - ${hl}`));
                });
                lines.push("");
            }
            if (r.tool === "get_fair_value_scan" && Array.isArray(r.data?.stocks) && r.data.stocks.length > 0) {
                hasContent = true;
                const d = r.data;
                const relAr = d.direction === "above" ? "أعلى من قيمتها العادلة" : "أقل من قيمتها العادلة";
                lines.push(`⚖️ **أسهم تتداول ${relAr} (الانحراف عن منتصف مدى 60 جلسة):**`);
                lines.push(`| # | الرمز | السعر | الدعم | المقاومة | الانحراف |`);
                lines.push(`| :---: | :--- | :---: | :---: | :---: | :---: |`);
                d.stocks.slice(0, 10).forEach((s: any, idx: number) => {
                    const premium = s.premium_pct != null ? `${Number(s.premium_pct) >= 0 ? "+" : ""}${Number(s.premium_pct).toFixed(2)}%` : "غير متاح";
                    lines.push(`| ${idx + 1} | ${s.symbol} | ${s.close} ج.م | ${Number(s.support).toFixed(2)} | ${Number(s.resistance).toFixed(2)} | ${premium} |`);
                });
                lines.push("");
            }
            if (r.tool === "get_sector" && r.data?.sector) {
                hasContent = true;
                const d = r.data;
                lines.push(`🏭 **بيانات قطاع ${d.sector}:**`);
                lines.push(`| الاتجاه | الرمز | الشركة | التغير |`);
                lines.push(`| :--- | :--- | :--- | :---: |`);
                (d.gainers || []).slice(0, 5).forEach((s: any) => lines.push(`| صاعد | ${s.symbol} | ${s.name || s.symbol} | +${Number(s.tech?.change_pct || 0).toFixed(2)}% |`));
                (d.losers || []).slice(0, 5).forEach((s: any) => lines.push(`| هابط | ${s.symbol} | ${s.name || s.symbol} | ${Number(s.tech?.change_pct || 0).toFixed(2)}% |`));
                lines.push("");
            }
            if (r.tool === "get_sector_list" && Array.isArray(r.data?.sectors) && r.data.sectors.length > 0) {
                hasContent = true;
                lines.push(`🏭 **القطاعات المتاحة في السوق:**`);
                r.data.sectors.slice(0, 12).forEach((s: any) => lines.push(`  • ${s.sector}: ${s.stock_count} سهم`));
                lines.push("");
            }
            if (r.tool === "get_recommendations" && Array.isArray(r.data)) {
                hasContent = true;
                lines.push(`📈 **الصفقات والتوصيات النشطة:**`);
                r.data.slice(0, 5).forEach((rec: any) => {
                    const returnStr = rec.return_pct != null ? `${Number(rec.return_pct) >= 0 ? "+" : ""}${Number(rec.return_pct).toFixed(2)}%` : "غير متاح";
                    lines.push(`  • ${rec.symbol}: دخول ${rec.entry_price}، هدف ${rec.target_price}، وقف ${rec.stop_loss} (العائد الحالي: ${returnStr})`);
                });
                lines.push("");
            }
            if (r.tool === "search_web" && r.data?.results?.length > 0) {
                hasContent = true;
                lines.push(`🌐 **معلومات إضافية من الويب:**`);
                r.data.results.slice(0, 3).forEach((webResult: any) => {
                    if (webResult.title && webResult.snippet) {
                        lines.push(`  • **${webResult.title}**: ${webResult.snippet}`);
                    }
                });
                lines.push("");
            }
        });
    }

    // No tool produced usable content — say so clearly instead of an empty header + disclaimer.
    if (!hasContent) {
        return "عذراً، لم تتوفر بيانات موثقة لهذا الطلب من قاعدة البيانات حالياً، لذلك لن أخمن إجابة غير مدعومة بالبيانات. جرّب إعادة صياغة السؤال (مثلاً: سعر سهم معين، أسهم التجميع اليوم، ترتيب الأسهم بالسيولة، أداء القطاعات) وسأعرض النتائج الموثقة المتاحة.";
    }

    lines.push("📌 الرأي مبني على مؤشرات السعر والزخم والحجم والمستويات الفنية المسجلة، وهو لأغراض استرشادية وليس توصية مباشرة بالشراء أو البيع.");
    return lines.join("\n").trim();
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
    requestedModel?: string,
    testConfig?: { mockToolsResults?: StructuredToolOutput }
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

    if (!hasImages) await getStocksList();

    // ─── Deterministic planner runs for text requests ───
    const deterministicPlan = !hasImages ? buildCompoundDeterministicPlan(userMessage, sessionState) : null;

    // Stage 2: Memory is only needed when routing cannot resolve the request.
    if (!deterministicPlan || deterministicPlan.intent === "historical_recall") {
        memory = await retrieveRelevantMemory(userMessage, sessionSummary, sessionState, history, supabase, userId, sessionId);
    }

    // Stage 3: deterministic plan
    const plannerResult = deterministicPlan
        ?? buildCompoundDeterministicPlan(userMessage, sessionState)
        ?? generalChatPlan(sessionState);

    const explicitSymbols = extractExplicitSymbols(userMessage);
    let mergedSymbols = explicitSymbols.length > 0
        ? explicitSymbols
        : Array.from(new Set([
            ...mergeVisionSymbols(plannerResult.entities.symbols || [], vision)
        ]));
    mergedSymbols = clearsStockContext(plannerResult) 
        ? explicitSymbols 
        : scopeImplicitSingleStockRequest(userMessage, explicitSymbols, mergedSymbols, sessionState.current_symbol, memory?.resolved_references?.symbol || null);
    const riskFollowUp = /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage);
    if (riskFollowUp && mergedSymbols.length === 0) {
        const recentSymbol = extractSingleStockFromRecentHistory(history);
        if (recentSymbol) mergedSymbols.push(recentSymbol);
    }
    if (mergedSymbols.length === 0 && memory?.resolved_references?.symbol) {
        mergedSymbols.push(memory.resolved_references.symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(أبيع|ابيع|بيع|أحتفظ|احتفظ|أخرج|اخرج|بكام|بكم|السعر)/i.test(userMessage) && !isBestBuyStockQuestion(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(اخباره|أخباره|هات\s+اخبار|هات\s+أخبار|خبره)/i.test(userMessage)) mergedSymbols.push(sessionState.current_symbol);
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && (
        /(عليه|عليها|فيه|فيها|ليه|ليها|له|لها|عنه|عنها|به|بها|معاه|معاها|هو|هي|ده|دي|هذا|هذه|تجميع|تصريف|تحليل|مؤشر|مؤشرات|دعم|مقاومة|مقاومه)/i.test(userMessage) ||
        userMessage.trim().split(/\s+/).length <= 3
    ) && !isMarketWideRequest(userMessage) && !isBestBuyStockQuestion(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    // An explicit company-name phrase that resolves to no known symbol ("حلل دلتا للطباعه")
    // must not inherit the previous session symbol — the responder would analyze the WRONG stock.
    const unresolvedNameMatch = userMessage.match(/(?:^|[\s،,])(\S{2,}\s+لل\S{2,})/);
    const unresolvedStockName = explicitSymbols.length === 0 && unresolvedNameMatch && !vision
        ? unresolvedNameMatch[1].replace(/[.،,؟?…].*$/, "").trim()
        : null;
    if (unresolvedStockName) mergedSymbols = [];
    const compoundRequest = splitChatCommands(userMessage).length > 1;
    if ((isMarketWideRequest(userMessage) || isBestBuyStockQuestion(userMessage)) && !compoundRequest && extractExplicitSymbols(userMessage).length === 0) mergedSymbols = [];
    if (plannerResult.entities.sector && extractExplicitSymbols(userMessage).length === 0) mergedSymbols = [];
    const enforced: ReturnType<typeof enforceIntentFromMessage> = compoundRequest
        ? { 
            intent: plannerResult.intent, 
            tools: plannerResult.tools || [], 
            replaceTools: true, 
            scan_direction: plannerResult.entities.scan_direction || undefined,
            fair_value_direction: plannerResult.entities.fair_value_direction || undefined,
            require_distribution: plannerResult.entities.require_distribution,
            require_accumulation: plannerResult.entities.require_accumulation
          }
        : enforceIntentFromMessage(userMessage, plannerResult.intent, mergedSymbols, sessionState);
    const marketScopedTools = new Set(["get_market", "get_sector_liquidity", "get_sector_list", "get_fair_value_scan"]);
    if (explicitSymbols.length === 0 && enforced.tools.some(tool => marketScopedTools.has(tool))) mergedSymbols = [];
    const datedDomainRequest = Boolean(extractRequestedDate(userMessage) || extractRequestedDateRange(userMessage)) && ["stock_analysis", "stock_news", "comparison", "sector_analysis", "accumulation_distribution"].includes(enforced.intent);
    const historicalRequest = needsHistoricalData(enforced.intent, userMessage);
    const effectiveIntent = historicalRequest && !datedDomainRequest ? "historical_recall" : enforced.intent;

    const plannedTools = sanitizePlannerTools(userMessage, enforced.replaceTools
        ? enforced.tools
        : Array.from(new Set([...(plannerResult.tools || []), ...enforced.tools])));
    // Day-by-day change questions need the daily price rows; the compound-command
    // path above can bypass enforceIntentFromMessage and the planner sometimes
    // omits get_price_history, so re-add it here.
    if (!plannedTools.includes("get_price_history")
        && mergedSymbols.length > 0
        && /يوم\s*بـ?\s*يوم|التغير\s*اليومي|تغير\s*يومي|سعر\s*كل\s*يوم|أداء\s*يومي|(?:اخر|آخر)\s*(?:اسبوع|أسبوع|ايام|أيام|جلسات).{0,30}(?:تغير|نسب)/i.test(userMessage)) {
        plannedTools.push("get_price_history");
    }
    const requestedRange = extractRequestedDateRange(userMessage);
    let guidanceIntent = plannerResult.guidance_intent || getInvestorGuidanceIntent(userMessage, mergedSymbols.length > 0);
    if (mergedSymbols.length > 0 && guidanceIntent !== "product_comparison") {
        guidanceIntent = null;
    }
    const excludedSectors = extractExcludedSectors(userMessage);
    const plannerExcludedSectors = plannerResult.entities.excluded_sectors || [];
    const comparesSectors = plannedTools.includes("get_sector_liquidity") && enforced.sector === null;
    const plan: IntentPlan = {
        intent: mapIntent(effectiveIntent),
        confidence: plannerResult.confidence || 0.8,
        guidance_intent: guidanceIntent,
        entities: {
            symbols: mergedSymbols,
            sector: comparesSectors || (excludedSectors.length > 0 && plannedTools.includes("get_sector_liquidity")) ? null : enforced.sector || plannerResult.entities.sector || null,
            timeframe: extractTemporalContext(userMessage).timeframe,
            reference: memory?.resolved_references?.symbol ? "last_image" : null
            ,scan_direction: enforced.scan_direction || plannerResult.entities.scan_direction || null
            ,fair_value_direction: enforced.fair_value_direction || plannerResult.entities.fair_value_direction || null
            ,require_distribution: Boolean(enforced.require_distribution || plannerResult.entities.require_distribution)
            ,require_accumulation: Boolean(enforced.require_accumulation || plannerResult.entities.require_accumulation)
            ,recommendation_order: enforced.recommendation_order || plannerResult.entities.recommendation_order || null
            ,min_acc_score: plannerResult.entities.min_acc_score ?? null
            ,min_vol_ratio: plannerResult.entities.min_vol_ratio ?? null
            ,excluded_sectors: Array.from(new Set([...excludedSectors, ...plannerExcludedSectors]))
            ,requested_sectors: enforced.requested_sectors || plannerResult.entities.requested_sectors || []
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
    let tools: StructuredToolOutput;
    if (testConfig?.mockToolsResults) {
        tools = testConfig.mockToolsResults;
    } else {
        tools = await executeStructuredTools(supabase, plan, apiKeys, userId, sessionId, userMessage, history);
    }
    
    // Apply custom user filters if present in message (e.g. "أعلى من 75", "يومين")
    if (userMessage) {
        const scoreMatch = userMessage.match(/(?:أعلى|اكثر|أكبر|اكبر|فوق).{1,10}?(\d{2,3})/i) || userMessage.match(/(\d{2,3}).{1,10}?(?:فأكثر|فاكثر)/i);
        const minScore = scoreMatch ? parseInt(scoreMatch[1] || scoreMatch[2] || "0", 10) : 0;
        
        const volMatch = userMessage.match(/(?:نسبة الحجم|سيوله|سيولة).{1,15}?(?:أكبر|اعلى|أعلى).{1,10}?(\d+(?:\.\d+)?)/i);
        const minVol = volMatch ? parseFloat(volMatch[1]) : 0;
        
        const daysMatch = userMessage.match(/(?:يومين)/i) ? 2 : (userMessage.match(/(?:أيام|ايام).{1,10}?(\d+)/i) ? parseInt(userMessage.match(/(?:أيام|ايام).{1,10}?(\d+)/i)![1], 10) : 0);
        
        tools.results.forEach(res => {
            if (res.tool === "get_accumulation_stocks" || res.tool === "get_distribution_stocks") {
                const scoreField = res.tool === "get_accumulation_stocks" ? "acc_score" : "dist_score";
                const daysField = res.tool === "get_accumulation_stocks" ? "consecutive_acc_days" : "consecutive_dist_days";
                
                const filterFn = (s: any) => {
                    let pass = true;
                    if (minScore > 0 && Number(s[scoreField] || 0) <= minScore) pass = false;
                    if (minVol > 0 && Number(s.vol_ratio || 0) <= minVol) pass = false;
                    if (daysMatch > 0 && Number(s[daysField] || 0) < daysMatch) pass = false;
                    return pass;
                };

                if (Array.isArray(res.data?.stocks)) {
                    res.data.stocks = res.data.stocks.filter(filterFn);
                }
                if (Array.isArray(res.data?.scan_rows)) {
                    res.data.scan_rows = res.data.scan_rows.filter(filterFn);
                }
                if (Array.isArray(res.symbols)) {
                    res.symbols = res.symbols.filter((sym: string) => {
                        const row = (res.data?.stocks || []).find((s: any) => String(s.symbol).toUpperCase() === String(sym).toUpperCase());
                        return !!row;
                    });
                }
            }
        });
    }

    const tables = buildExcelTables(tools.results, vision);

    await saveFactSnapshots(supabase, userId, sessionId, tools, vision, messageId);

    // Stage 5: Response
    const topMoversRequest = /(أعلى|اعلى|أقوى|اقوى).{0,25}(الأسهم|اسهم|ارتفاع|صعود|النهارده|اليوم|اخر يوم|آخر يوم|جلسه|جلسة)/i.test(userMessage);
    const deterministicLiquidityResponse = topMoversRequest
        ? buildTopMoversResponse(tools)
        : plan.intent === "market_summary" && plan.entities.symbols.length === 0
        && !plan.tools.includes("get_fair_value_scan")
        && !plan.entities.scan_direction
        ? buildMarketLiquidityResponse(tools)
        : null;
    const scopedMemory = plan.needs_historical_data || plan.entities.reference
        ? memory?.relevant_snapshots || []
        : [];
    const isAnalyticalQueryRegex = /(سبب|ليه|لماذا|ازاي|إزاي|تفسير|سر|ينزل|يهبط|يطلع|صعود|هبوط|فرص|أحسن|احسن|افضل|أفضل|توقعات|متوقع|مقارن|قارن|حالة|حالتها|رايك|رأيك|توجيه|تجميع|تصريف|تحليل|شراء|بيع|مناسب|مكمل|مستمر|جلسه|جلسة|غدا|غداً|اشترى|اشتري|اشتريت|خسران|نازل|عادله|عادلة|تقييم|قيمته|تسوى|تساوي|أهداف|اهداف|احتفاظ|خروج|دخول|بيجمع|ينطلق|مؤشر|مؤشرات|اخبار|أخبار|إيه|ايه|هل|فين|مين|مسح|شروط|\?|؟)/i;
    const isAnalyticalQuery = isAnalyticalQueryRegex.test(userMessage) || userMessage.trim().split(/\s+/).length > 4;
    const hasScanTool = tools.results.some(res => res.tool === "get_accumulation_stocks" || res.tool === "get_distribution_stocks");
    const isMarketWideScan = hasScanTool && mergedSymbols.length === 0;

    // Check if scan filters resulted in 0 stocks on a market-wide scan to prevent LLM hallucinations
    let emptyScanResult = false;
    let scanStale = false;
    let scanDate: string | null = null;
    const directionAr = plan.entities.scan_direction === "distribution" ? "تصريف" : "تجميع";
    if (isMarketWideScan) {
        tools.results.forEach(res => {
            if (res.tool === "get_accumulation_stocks" || res.tool === "get_distribution_stocks") {
                if (Array.isArray(res.data?.stocks) && res.data.stocks.length === 0) {
                    emptyScanResult = true;
                    if (res.data?.validation && !res.data.validation.ok) scanStale = true;
                    if (res.data?.date) scanDate = String(res.data.date);
                }
            }
        });
    }

    const deterministicDomainResponse = emptyScanResult
        ? scanStale
            ? `آخر مسح ${directionAr} مسجل في قاعدة البيانات بتاريخ ${scanDate || "غير محدد"} (أقدم من 7 أيام)، ولم يسجل هذا المسح أي أسهم في منطقة ${directionAr}. يتم تحديث بيانات المسح بشكل دوري.`
            : plan.entities.min_acc_score != null || plan.entities.min_vol_ratio != null || plan.entities.min_consecutive_acc_days != null
                ? `عذراً، لم أجد أي أسهم تطابق الشروط التي حددتها حالياً. يمكنك محاولة تخفيف الشروط (مثل تقليل درجة ${directionAr} المطلوبة أو نسبة الحجم) للحصول على نتائج.`
                : `حالياً لا توجد أسهم في منطقة ${directionAr} واضحة بناءً على أحدث بيانات المسح المتاحة (بتاريخ ${scanDate || "اليوم"}). هذا يعني أن السوق قد لا يمر بمرحلة ${directionAr} مؤسسي واضحة في الوقت الحالي.`
        : null;

    // Earnings data requests have no backing data source (tools: []) — bypass the LLM entirely
    // with a clear deterministic answer instead of risking a validation failure / empty fallback.
    if (tools.results.length === 0 && isEarningsDataRequest(userMessage)) {
        const earningsResponse = plan.entities.symbols.length > 0
            ? `لا تتوفر لدي حالياً بيانات أرباح موثقة للفترة المطلوبة للسهم ${plan.entities.symbols.join("، ")}. لذلك لن أستبدل سؤال الأرباح بالسعر أو RSI. يمكنني تحليل السعر فنياً، أو عرض الأرباح عند إضافة مصدر قوائم مالية مؤرخ للنظام.`
            : "لا تتوفر لدي حالياً بيانات أرباح موثقة للشركات في قاعدة البيانات. يمكنني تحليل السعر والسيولة والتجميع والتصريف فنياً، أو عرض الأرباح عند إضافة مصدر قوائم مالية مؤرخ للنظام.";
        const earningsSymbols = plan.entities.symbols || [];
        const earningsSessionUpdate = {
            current_symbol: earningsSymbols[0] || sessionState.current_symbol,
            last_symbols: Array.from(new Set([...earningsSymbols, ...(sessionState.last_symbols || [])])).slice(0, 15),
            summary: userMessage,
            current_sector: plan.entities.sector || sessionState.current_sector || null
        };
        await updateSessionState(supabase, sessionId, userId, earningsSessionUpdate);
        return {
            vision,
            memory,
            plan,
            tools,
            response: earningsResponse,
            session_update: earningsSessionUpdate,
            vision_error: visionError,
            tables
        };
    }

    // Explicit company name that matched no listed stock — say so instead of silently
    // answering about whatever the session previously discussed.
    if (tools.results.length === 0 && unresolvedStockName) {
        const unknownStockResponse = `لم أجد شركة بهذا الاسم («${unresolvedStockName}») في قاعدة بيانات البورصة المصرية المتاحة لي، لذلك لن أحلل سهمًا آخر بدلًا منه. تأكد من كتابة الاسم كما هو معروف في السوق أو اكتب الرمز اللاتيني (مثل AMES أو COMI)، ولو كانت الشركة غير مدرجة في EGX فهي خارج تغطية النظام حاليًا.`;
        const unknownSessionUpdate = {
            current_symbol: null,
            last_symbols: sessionState.last_symbols || [],
            summary: userMessage,
            current_sector: plan.entities.sector || sessionState.current_sector || null
        };
        await updateSessionState(supabase, sessionId, userId, unknownSessionUpdate);
        return {
            vision,
            memory,
            plan,
            tools,
            response: unknownStockResponse,
            session_update: unknownSessionUpdate,
            vision_error: visionError,
            tables
        };
    }

    const responderMetaNs: { source?: "llm" | "deterministic"; degraded?: boolean } = {};
const generatedLlmReply = deterministicDomainResponse || await generateV2Response(
        userMessage, plan, vision, tools.results,
        scopedMemory,
        memory?.recent_messages || [],
        memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
        apiKeys,
        requestedModel,
        sessionState,
        undefined,
        responderMetaNs
    );
    const genericFailure = /^(?:عذراً، )?لم أتمكن من إنشاء الرد/.test(generatedLlmReply || "");
    // Leaked English chain-of-thought leaves no usable Arabic answer — treat as failure.
    const replyArabicChars = ((generatedLlmReply || "").match(/[\u0600-\u06FF]/g) || []).length;
    const replyAsciiChars = ((generatedLlmReply || "").match(/[A-Za-z]/g) || []).length;
    const nonArabicReply = replyArabicChars < 40 || replyAsciiChars > replyArabicChars;
    let response = (genericFailure || nonArabicReply)
        ? (topMoversRequest ? buildTopMoversResponse(tools) : buildMarketLiquidityResponse(tools))
            || buildDeterministicResponse(userMessage, plan, tools.results)
            || generatedLlmReply
        : generatedLlmReply;

    // One corrective LLM attempt when the first reply was unusable (CoT leak etc.),
    // or when all providers failed and a degraded template was served — the retry
    // recovers natural replies after short per-minute rate-limit windows expire.
    let skipCorrectiveRetry = false;
    if (responderMetaNs.degraded) {
        const cooldownMs = getResponderCooldownMs();
        if (cooldownMs > 45_000) {
            console.warn("[Pipeline] Degraded fallback with long provider cooldown — skipping corrective retry");
            skipCorrectiveRetry = true;
        } else if (cooldownMs > 0) {
            await new Promise(r => setTimeout(r, cooldownMs + 500));
        }
    }
    if (!skipCorrectiveRetry && (genericFailure || nonArabicReply || responderMetaNs.degraded)) {
        console.warn("[Pipeline] Non-stream reply unusable — one corrective LLM attempt");
        let retryText = "";
        const retryMeta: { source?: "llm" | "deterministic"; degraded?: boolean } = {};
        try {
            const retryStream = generateV2Stream(
                userMessage, plan, vision, tools.results,
                scopedMemory,
                memory?.recent_messages || [],
                memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
                apiKeys,
                requestedModel,
                sessionState,
                "مهم جداً: أكتب الرد باللغة العربية فقط، بدون أي تفكير أو عبارات إنجليزية، وأجب مباشرة على سؤال المستخدم باستخدام البيانات المرفقة.",
                retryMeta
            );
            for await (const chunk of retryStream) retryText += chunk;
            retryText = retryText.trim();
        } catch (retryErr: any) {
            console.warn(`[Pipeline] Corrective attempt failed: ${retryErr?.message || retryErr}`);
        }
        const retryArabic = (retryText.match(/[\u0600-\u06FF]/g) || []).length;
        const retryAscii = (retryText.match(/[A-Za-z]/g) || []).length;
        if (retryMeta.source === "llm" && retryArabic >= 40 && retryAscii <= retryArabic) {
            response = retryText;
        }
    }

    const allSymbols = new Set<string>();
    if (plan.entities.symbols) plan.entities.symbols.forEach(s => allSymbols.add(s));
    if (vision?.symbols) vision.symbols.forEach(s => allSymbols.add(s.symbol));
    if (Array.isArray(tools.results)) {
        tools.results.forEach(res => {
            if (Array.isArray(res.symbols)) {
                res.symbols.forEach((s: string) => allSymbols.add(s));
            }
        });
    }

    const finalSymbols = Array.from(allSymbols).filter(Boolean);
    const sessionUpdate = {
        current_symbol: clearsStockContext(plan) ? null : (finalSymbols[0] || sessionState.current_symbol),
        last_symbols: clearsStockContext(plan) ? finalSymbols : Array.from(new Set([...finalSymbols, ...(sessionState.last_symbols || [])])).slice(0, 15),
        summary: userMessage || (hasImages ? "تحليل صورة" : null),
        current_sector: plan.entities.sector || sessionState.current_sector || null
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
        current_symbol: clearsStockContext(plan) ? null : (symbols[0] || sessionState.current_symbol),
        last_symbols: Array.from(new Set([...symbols, ...(sessionState.last_symbols || [])])).slice(0, 15),
        summary: hasImages ? "تحليل صورة" : sessionState.summary,
        current_sector: plan.entities.sector || sessionState.current_sector || null
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
        "accumulation_distribution": "accumulation_distribution",
        "risk_analysis": "risk_analysis",
        "stock_news": "stock_analysis",
        "historical_recall": "historical_recall",
        "general_chat": "general_chat"
    };
    return intentMap[intent] || "follow_up";
}
