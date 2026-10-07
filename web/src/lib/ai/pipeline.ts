import { IntentPlan, VisionContext, SessionState, SessionSummary, PlannerResult } from "./types";
import { analyzeImage, reconcileVisionWithMarket } from "./vision";
import { retrieveRelevantMemory, MemoryResult, isStockFollowUpReference } from "./memory";
import { getSyncStockMappings, getStocksList, getSyncValidSymbols, loadValidSymbols, isUnresolvedCompanyNameMention, LATIN_TICKER_ALIASES, runPlanner } from "./planner";
import { executeStructuredTools, StructuredToolOutput } from "./tools-v2";
import { buildDeterministicResponse, buildDeterministicPortfolioAnalysisResponse, buildBothAccumulationDistributionResponse, generateV2Response, generateV2Stream, getResponderCooldownMs, normalizeStockFreshnessLanguage } from "./final-v2";
import { validateResponse, autoFixNumbers } from "./validator";
import { sanitizeReply } from "./sanitizer";
import { loadSessionState, loadSessionSummary, updateSessionSummary, updateSessionState, loadPersistentInvestorProfile, isUuid } from "./session";
import { buildExcelTables, ExcelTable } from "./excel-tables";
import { AI_CONFIG } from "./config";
import { normalizeArabicIntent, extractInvestorPreferences, getFairValueFilters, isFairValueScanRequest, getInvestorGuidanceIntent as classifyInvestorGuidance, isDailyPriceLimitQuestion, isEarningsDataRequest, isTermsDefinitionRequest, isUsageLimitQuestion, isBestBuyStockQuestion, isExplicitRecommendationRequest, detectPortfolioIntent, detectPortfolioConfirmation, isPortfolioAnalysisRequest, isPortfolioRankingRequest, isNileExchangeQuestion, isConversationalChoiceOrFollowUp } from "./intent-policy";
import { extractExcludedSectorNames, extractMentionedSectorNames } from "./sector-taxonomy";
import { isOtcStock, buildOtcNotice } from "./otc-stocks";
import { isEgxSessionOpen } from "./live-stock-updater";
import { replacePortfolioFromImage, checkPortfolioImportCapacity } from "./portfolio-tools";
import { isPro } from "./plan-gate";
import { getDeepSeekApiKey } from "./server-secrets";
import { createExecutionScope, awaitExecution, executionFetch, executionSupabase, getExecutionSignal, remainingExecutionMs, withExecutionTimeout } from "./execution";
import { attachEvidenceContract } from "./evidence";
import { buildFactRecords } from "./facts";
import { runAnswerGate, buildGateCorrectionBlock } from "./answer-gate";
import { asksForAccumulationEvidence, asksForRecommendationEvidence, safeEvidenceResponse } from "./response-evidence";
import { isUnspecifiedOpportunityRequest } from "./intent-policy";
import { completeToolsByFacets } from "./tool-completion";
import { explicitBollingerPreset } from "./scan-request";
import { completeDecisionTools, ResponseTask } from "./response-task";

export interface PipelineResult {
    response_origin?: "llm" | "deterministic" | "fallback";
    response_task?: ResponseTask | null;
    publication_review?: { passed: boolean; repaired: boolean; final_passed: boolean; reasons: string[] };
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

const HYBRID_REVIEW_ALLOWED_TOOLS = new Set([
    "get_stock", "get_stock_levels", "get_news", "get_corporate_actions", "get_market",
    "get_sector", "get_sector_list", "get_sector_liquidity", "get_accumulation_stocks",
    "get_distribution_stocks", "get_technical_scan", "get_comparison", "get_recommendations",
    "get_fair_value_scan", "get_price_history", "search_web",
]);

async function reviewHybridToolResults(
    _message: string,
    _plan: IntentPlan,
    _results: StructuredToolOutput,
    _sessionState: SessionState,
): Promise<string[]> {
    // Secondary LLM call disabled for latency optimization - saves 5-8s per user message
    return [];
}

async function executeHybridAdditionalTools(
    supabase: any,
    plan: IntentPlan,
    initial: StructuredToolOutput,
    additionalTools: string[],
    apiKeys: string[],
    userId: string,
    sessionId: string,
    message: string,
    history: Array<{ role: string; content: string }>,
    userIsPro: boolean = false,
): Promise<StructuredToolOutput> {
    const toolBudget = Math.min(15000, remainingExecutionMs() - 12000);
    if (!additionalTools.length || toolBudget < 1000) return initial;
    let extra: StructuredToolOutput;
    try {
        extra = await withExecutionTimeout(toolBudget, () => executeStructuredTools(
            supabase,
            { ...plan, tools: additionalTools },
            apiKeys,
            userId,
            sessionId,
            message,
            history,
            userIsPro,
        ));
    } catch (error) {
        console.warn("[HYBRID_TOOLS] additional tools failed:", error);
        return initial;
    }
    const results = [...initial.results];
    for (const result of extra.results) {
        if (!results.some(existing => existing.tool === result.tool)) results.push(result);
    }
    return { results, formattedText: [initial.formattedText, extra.formattedText].filter(Boolean).join("\n\n") };
}

function applyHybridDomainInvariants(message: string, plan: IntentPlan): IntentPlan {
    const text = normalizeArabicIntent(message);
    const symbols = plan.entities.symbols || [];
    const unscopedForecast = symbols.length === 0 && /متوقع|توقع|هيرتفع|يرتفع/.test(text)
        && /اسبوع|جلسات/.test(text) && !/زخم|سيول|تجميع|القيمه|اداء|تاريخي/.test(text);
    const missingStockScope = symbols.length === 0 && ["stock_analysis", "levels_analysis", "risk_analysis", "comparison", "follow_up"].includes(plan.intent)
        && plan.tools.some(tool => ["get_stock", "get_stock_levels", "get_comparison"].includes(tool))
        && !plan.tools.some(tool => ["get_market", "get_sector", "get_sector_liquidity", "get_sector_list", "get_price_history", "get_fair_value_scan", "get_technical_scan", "get_accumulation_stocks", "get_distribution_stocks"].includes(tool));
    if (unscopedForecast || missingStockScope) {
        return { ...plan, intent: "clarification", tools: [], clarification_needed: true,
            needs_live_data: false, needs_historical_data: false,
            clarification_options: unscopedForecast
                ? ["توقع أسبوعي لسهم محدد", "أسهم للمراقبة حسب الزخم الحالي", "أداء الأسبوع السابق"]
                : ["حدد السهم المطلوب", "تحليل السوق كله"] };
    }
    const explicitSector = /(?:قطاع|القطاع)\s+(?:ال)?(بنوك|بنك|خدمات مالية)/i.test(text)
        ? "بنوك"
        : /(?:قطاع|القطاع)\s+(?:ال)?(ادويه|أدوية|صحه|صحية)/i.test(text)
            ? "ادويه"
            : /(?:قطاع|القطاع)\s+(?:ال)?(عقارات|عقاري)/i.test(text)
                ? "عقارات"
                : null;
    if (/(?:عدد|كام|كم|قائمة|قايمه|هات|جيب|اعرض|كل).{0,20}(?:قطاع|قطاعات)|(?:قطاعات|القطاعات)\s+كلها/i.test(text)) {
        return { ...plan, intent: "sector_analysis", tools: ["get_sector_list"], entities: { ...plan.entities, symbols: [] } };
    }
    if (/(?:سيول|سيولة).{0,30}(?:قطاع|قطاعات)/i.test(text)) {
        return { ...plan, intent: "market_summary", tools: ["get_sector_liquidity"], entities: { ...plan.entities, symbols: [] } };
    }
    if (symbols.length >= 2 && /(?:قارن|مقارن|مفاضل)/i.test(text)) {
        const tools = new Set(plan.tools);
        tools.add("get_comparison");
        tools.add("get_stock");
        if (/(?:خبر|أخبار|اخبار)/i.test(text)) tools.add("get_news");
        return { ...plan, intent: "comparison", tools: Array.from(tools), needs_live_data: true };
    }
    if (/(?:تجميع|وايكوف|accumulation)/i.test(text) && plan.entities.sector) {
        return { ...plan, intent: "accumulation_distribution", tools: Array.from(new Set([...plan.tools, "get_accumulation_stocks"])), entities: { ...plan.entities, sector: plan.entities.sector || explicitSector, scan_direction: "accumulation" } };
    }
    if (explicitSector && /(?:تجميع|وايكوف|accumulation)/i.test(text)) {
        return { ...plan, intent: "accumulation_distribution", tools: Array.from(new Set([...plan.tools, "get_accumulation_stocks"])), entities: { ...plan.entities, sector: explicitSector, scan_direction: "accumulation" } };
    }
    if (plan.tools.includes("get_fair_value_scan") && /(?:تجميع|وايكوف|accumulation)/i.test(text)) {
        return { ...plan, entities: { ...plan.entities, require_accumulation: true } };
    }
    return plan;
}

function intersectHybridScanResults(tools: StructuredToolOutput, plan: IntentPlan): StructuredToolOutput {
    const fair = tools.results.find(result => result.tool === "get_fair_value_scan");
    const accumulation = tools.results.find(result => result.tool === "get_accumulation_stocks");
    if (!fair || !accumulation) return tools;
    const fairSymbols = new Set((fair.data?.stocks || []).map((stock: any) => String(stock.symbol || "").toUpperCase()));
    const filteredStocks = (accumulation.data?.stocks || []).filter((stock: any) => fairSymbols.has(String(stock.symbol || "").toUpperCase()));
    const filteredRows = (accumulation.data?.scan_rows || []).filter((stock: any) => fairSymbols.has(String(stock.symbol || "").toUpperCase()));
    accumulation.data = { ...accumulation.data, stocks: filteredStocks, scan_rows: filteredRows, hybrid_intersection: true, fair_value_symbols: Array.from(fairSymbols) };
    accumulation.symbols = filteredStocks.map((stock: any) => String(stock.symbol).toUpperCase());
    const fairStocks = (fair.data?.stocks || []).filter((stock: any) => filteredStocks.some((candidate: any) => String(candidate.symbol).toUpperCase() === String(stock.symbol).toUpperCase()));
    fair.data = { ...fair.data, stocks: fairStocks, hybrid_intersection: true };
    fair.symbols = fairStocks.map((stock: any) => String(stock.symbol).toUpperCase());
    return { ...tools, formattedText: `${tools.formattedText}\n[Hybrid intersection: ${filteredStocks.length} stocks]` };
}

export function sanitizePlannerTools(message: string, tools: string[]): string[] {
    if (/(?:ثندر|thndr)/i.test(message)) return tools.filter(tool => tool === "get_market");
    const explicitlyRequestsRecommendations = isExplicitRecommendationRequest(message);
    if (explicitlyRequestsRecommendations) return tools;
    return tools.filter(tool => tool !== "get_recommendations" && tool !== "get_signals");
}

/** Market ranking is a different question from ranking daily price movers. */
export function getMarketRankingMode(message: string, requested?: PlannerResult["request"]): "price_change" | "liquidity_unavailable" | "accumulation" | null {
    if (isUnspecifiedOpportunityRequest(message)) return null;
    const normalized = normalizeArabicIntent(message);
    if (/(?:وايكوف|wyckoff|مرحله\s+تجميع|اسهم\s+التجميع|سيوله\s+مؤسسيه|سيوله\s+ذكيه|تجميع\s+مؤسسي|التجميع\s+المؤسسي)/i.test(normalized)) return "accumulation";
    if (requested?.ranking_metric === "accumulation") return "accumulation";
    const sectorScoped = Boolean(extractSectorFromMessage(message)) || /(?:القطاعات|قطاعات|قطاع)/i.test(normalized);
    const historicalPeriod = /(?:هذا\s+الشهر|الشهر\s+الحالي|خلال\s+الشهر|من\s+اول\s+(?:السنه|السنة|الشهر|الاسبوع)|منذ\s+بدايه\s+(?:السنه|السنة|الشهر|الاسبوع)|شهري|اسبوعي|اخر\s+\d+\s+(?:ايام|اسابيع|شهور)|عام|سنوي|ytd|mtd|wtd)/i.test(normalized);
    const marketRanking = !sectorScoped && !historicalPeriod
        && /(?:اعلى|اعلي|اقوى|اقوي|اكبر|ترتيب|رتب|قائمه|قايمه|مين\s+اكتر|اسهم\s+الاكثر)/i.test(normalized)
        && /(?:اسهم|السوق|البورصه|تداول|جلسه|اليوم|النهارده|حاليا|مباشر|اخر\s+جلسه)/i.test(normalized);
    if (marketRanking && /(?:سيول|حجم\s*(?:التداول)?|احجام\s*(?:التداول)?|volume|بيجمع)/i.test(normalized)) return "liquidity_unavailable";
    if (requested?.ranking_metric === "liquidity" && marketRanking) return "liquidity_unavailable";
    if (/(?:تجميع|accumulation)/i.test(normalized)) return "accumulation";
    if (!sectorScoped && !historicalPeriod && /(?:اعلى|اعلي|اقوى|اقوي|اكبر|اكبر).{0,35}(?:ارتفاع|صعود|رابح|مكسب|gainer)/i.test(normalized)) return "price_change";
    const bareDailyGainers = /(?:اقوى|اقوي|اعلى|اعلي)\s+(?:الاسهم|اسهم)(?:\s+(?:اليوم|النهارده|النهاردة|(?:اخر|لاخر)\s+(?:جلسه|جلسة|يوم)))?$/i.test(normalized.trim());
    if (!sectorScoped && !historicalPeriod && bareDailyGainers
        && !/(?:استثمار|فن[ىي]|توزيع|ارباح|عائد|سيول|حجم|تجميع|تصريف|زخم|مؤشرات)/i.test(normalized)) return "price_change";
    if (requested?.ranking_metric === "price_change" && !sectorScoped && !historicalPeriod) return "price_change";
    return null;
}

export function resolveGroupReferenceSymbols(message: string, candidates: string[]): string[] {
    const refersToPriorGroup = /(?:فيهم|منهم|بينهم|وسطهم|واحد\s+منهم|واحد\s+فيهم|among\s+them|between\s+them)/i.test(normalizeArabicIntent(message));
    return refersToPriorGroup ? Array.from(new Set(candidates.map(symbol => String(symbol).toUpperCase()))).slice(0, 15) : [];
}

export function shouldClarifySingularGroupReference(message: string, candidates: string[], lastAssistant: string, currentSymbol: string | null = null): boolean {
    const symbols = Array.from(new Set(candidates.map(symbol => String(symbol).toUpperCase())));
    if (symbols.length < 2 || extractExplicitSymbols(message).length > 0) return false;
    const normalized = normalizeArabicIntent(message);
    if (!/(?:السهم\s+د[ها]|^د[ها]$|عليه|عنه|خسارته|ربحه|توقعه|مقاومته|دعمه|وقف\s+خسارته)/i.test(normalized)
        || /(فيهم|منهم|بينهم|كلهم|الاسهم|أسهم)/i.test(message)) return false;
    const mentioned = symbols.filter(symbol => new RegExp(`\\b${symbol}\\b`, "i").test(lastAssistant));
    return mentioned.length !== 1 || mentioned[0] !== String(currentSymbol || symbols[0]).toUpperCase();
}

export function scopeImplicitSingleStockRequest(
    message: string,
    explicitSymbols: string[],
    plannedSymbols: string[],
    currentSymbol: string | null,
    resolvedSymbol: string | null
): string[] {
    if (explicitSymbols.length > 0) return plannedSymbols.length > 0 ? plannedSymbols : explicitSymbols;
    const normalized = normalizeArabicIntent(message);
    const singularOwnedPosition = /(?:شريت|اشتريت|شاري|داخل).{0,35}(?:انهارده|اليوم|السهم|ونزل|نازل)|(?:السهم|هو|انه).{0,25}(?:نزل|نازل).{0,25}(?:يطلع|امل|اعمل)/i.test(normalized);
    if (!singularOwnedPosition) return plannedSymbols;
    const symbol = currentSymbol || resolvedSymbol || plannedSymbols[0] || null;
    return symbol ? [symbol] : [];
}

function clearsStockContext(plan: { intent: string; tools?: string[]; entities?: { symbols?: string[] }; guidance_intent?: any }): boolean {
    return plan.intent === "sector_analysis" || plan.intent === "technical_scan" || (plan.intent === "accumulation_distribution" && (plan.entities?.symbols?.length || 0) === 0) || (Array.isArray(plan.tools) && (plan.tools.includes("get_recommendations") || plan.tools.includes("get_technical_scan")) && (plan.entities?.symbols?.length || 0) === 0) || (plan.intent === "market_summary" && (plan.entities?.symbols?.length || 0) === 0) || Boolean(plan.guidance_intent);
}

// ============================================================================
// Implicit single-stock follow-up detection (shared by planner + pipeline)
// ----------------------------------------------------------------------------
// Users refer to the stock discussed in the previous message without naming
// it again ("طب ممكن يطلع للمقاومة امتى" right after an AALR analysis). Such
// questions must resolve to the session's current stock and must NEVER be
// mistaken for a new company name — "يطلع للمقاومة" is a question fragment,
// not a company. These helpers centralize the logic so the deterministic
// planner and both pipeline variants cannot drift apart.

// Market/index/scan-scoped wording: the question targets the whole market,
// a scan, or recommendations — not the session's single stock — so it must
// not inherit the stock context. Word-boundary aware so suffixed forms stay
// stock-scoped ("مؤشراته", "توصيته") while whole words stay market-scoped
// ("المؤشر العام", "توصيات", "الاسهم").
const MARKET_SCOPE_PATTERN = /(?:^|[^ئ-ي])(?:السوق|البورصه|المؤشر|الدولار|الذهب|الاقتصاد|الاحتياطي|الفايده|الشركات|شركات|القطاع|قطاع|القطاعات|اسهم|الاسهم|متوقع|المتوقع|توصيات|التوصيات|توصيه|مسح|مين|اقوي|افضل|احسن|سعر\s+الصرف)(?:$|[^ئ-ي])|(?:مؤشر|موشر)\s*(?:ال)?(?:تلاتين|ثلاثين|التلاتين|الثلاثين|30|egx)|egx\s*\d+|egx30|market|index|dollar|gold|economy/i;

// Price-action vocabulary that implies a single-stock follow-up: levels,
// motion, breakout, direction, risk and holding behaviour.
const STOCK_FOLLOWUP_STRONG_PATTERN = /مقاوم|دعم|تارجت|الهدف|هدفه|هدفها|اهدافه|اهدافها|يكسر|هيكسر|تكسر|كسر|يخترق|هيخترق|اختراق|يعدي|هيعدي|يتخطي|هيتخطي|يتجاوز|هيتجاوز|تجاوز|يطلع|هيطلع|تطلع|طلوع|صعود|يصعد|هيصعد|يرتفع|هيرتفع|ارتفاع|يقفز|هيقفز|ينزل|هينزل|تنزل|نزول|هبوط|يهبط|هيهبط|ينخفض|هينخفض|انخفاض|ينهار|هينهار|انهيار|يوصل|هيوصل|توصل|وصول|يرجع|هيرجع|ترجع|رجوع|يرتد|هيرتد|ارتداد|يكمل|هيكمل|يستمر|هيستمر|استمرار|هيبقى|يبقى|هيفضل|يفضل|يخسر|خساره|خسارة|خساير|خسران|خسارتي|خسارتى|وقف\s*(?:ال)?خسار|اوقف\s*(?:ال)?خسار|يستفيد|هيستفيد|(?:يقفل|يغلق|هيقفل|هيغلق)\s+(?:فوق|تحت)|(?:اشتري|ابيع|احتفظ|اخرج|اخلص|ادخل|ادخلها|ادخله)(?:\s+\S+){0,2}\s+(?:فيه|فيها|عليه|عليها|به|بها|منه|منها)|(?:اشتريت|شاري|شاريه|شريت|متوسط|متوسطي|مركزي|سعري|دخولي)(?:\s+\S+){0,3}\s*(?:السهم|بسعر|\d+)|(?:السهم|فيه|فيها|معايا|معي)(?:\s+\S+){0,3}\s*(?:اشتريت|شاري|متوسط|مركزي|سعري)|(?:السهم|السهمين|الاتنين)\s+(?:ده|دا|دي|هيعمل|وضعه|اخباره|أخباره|رايك|مكمل|نازل|طالع)|resistance|support|target|breakout|break\s+(?:out|down|up)|rebound|pullback|climb|keep\s+going|going\s+(?:up|down)|sell\s+it|buy\s+it|hold\s+it/i;

// Timing questions only count as stock follow-ups when combined with motion.
const STOCK_FOLLOWUP_TIMING_PATTERN = /امتي|متي|بكره|غدا|بعد\s+كام|كام\s+(?:يوم|اسبوع|شهر|سنه)|الاسبوع\s+الجاي|الشهر\s+الجاي|when\s+will|how\s+long|how\s+many\s+(?:days|weeks|months)/i;
const STOCK_FOLLOWUP_MOTION_PATTERN = /يصل|هيوصل|يرجع|هيرجع|طلع|هيطلع|نزل|هينزل|وصل|هيكمل|يكمل|drop|rise|fall|climb|reach|rebound|recover|bounce/i;

export function isImplicitStockFollowUp(message: string): boolean {
    if (!message || !message.trim()) return false;
    const normalized = normalizeArabicIntent(message);
    if (MARKET_SCOPE_PATTERN.test(normalized)) return false;
    if (STOCK_FOLLOWUP_STRONG_PATTERN.test(normalized)) return true;
    // Pure timing question ("هيوصل امتى؟") still needs a motion verb.
    return STOCK_FOLLOWUP_TIMING_PATTERN.test(normalized) && STOCK_FOLLOWUP_MOTION_PATTERN.test(normalized);
}

// Starters of an "X للY" phrase that mark it as a question fragment (verbs in
// present/future form, modals, question words, motion nouns) rather than a
// company name. Company names are noun phrases and never start with a verb.
const QUESTION_FRAGMENT_START_PATTERN = /^(?:هي|ي|ت|ن)?(?:طلع|نزل|وصل|رج|كسر|خترق|عدي|تخطي|تجاوز|ستمر|كمل|بق|فضل|قفز|رتفع|نخفض|هبط|صعد|رتد|خسر|قفل|غلق|حصل|بان|ستني|شتري|حتفظ|خرج|دخل|فلت|سيب|نفع|مكن|زاي|ين|طيح|كمل|خش)|^(?:ممكن|امتي|متي|ازاي|ليه|مين|ايه|هل|طب|لو|بعد|قبل|كام|كده|طيب|قداه|قد\s*ايه|ينفع|اقدر|مقدرش|عايزني|اقدر|الوصول|النزول|الطلوع|الصعود|الكسر|الاختراق|الارتداد|الهبوط|الانخفاض|الارتفاع|الاستمرار|التجاوز|التقاطع|when|will|can|could|should|would|does|is|it|how|what|why|where|who)/i;

export function looksLikeQuestionFragment(candidate: string): boolean {
    if (!candidate || !candidate.trim()) return false;
    return QUESTION_FRAGMENT_START_PATTERN.test(normalizeArabicIntent(candidate).trim());
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
        if (!supabase || !sessionId || !isUuid(sessionId)) {
            return;
        }
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
                if (error.code === "23503" && /ai_chat_facts_session_id_fkey/i.test(error.message || "")) {
                    console.warn(`[saveFactSnapshots] Session ${sessionId} not found in ai_chat_sessions; skipping facts.`);
                    return;
                }
                throw error;
            }
        }
    } catch (e: any) {
        if (e?.code === "23503" && /ai_chat_facts_session_id_fkey/i.test(e?.message || "")) {
            console.warn(`[saveFactSnapshots] Session ${sessionId} not found in ai_chat_sessions; skipping facts.`);
            return;
        }
        console.warn("Failed to save fact snapshots:", e);
    }
}

function mergeVisionSymbols(planSymbols: string[], vision: VisionContext | null, explicitSymbolsCount: number = 0): string[] {
    if (!vision || vision.confidence < 0.5 || !Array.isArray(vision.symbols) || vision.symbols.length === 0) return planSymbols;
    const visionSymbols = vision.symbols.map(s => s.symbol);
    // If the user explicitly typed new stocks in the text prompt (e.g. "قارن COMI مع اللي في الصورة"), merge them.
    // Otherwise, vision symbols represent the user's fresh image query and MUST fully override leftover session context.
    if (explicitSymbolsCount > 0) {
        return Array.from(new Set([...planSymbols, ...visionSymbols]));
    }
    return visionSymbols;
}

export function extractExplicitSymbols(message: string): string[] {
    // These are product/platform labels frequently used in Arabic investor questions,
    const excluded = new Set([
        "EGX", "NEWS", "TODAY", "LAST", "WEEK", "FROM", "BETWEEN", "RSI", "MACD", "VWAP", "CLOUD", "THNDR", "ALSH",
        "OTC", "BUY", "SELL", "HOLD", "USD", "EGP", "EPS", "ROE", "ROA", "ROI", "NAV", "GDP", "CBE", "FRA", "IPO", "API", "AI", "KING", "ML", "ADX", "SMA", "EMA",
        "WHEN", "WILL", "REACH", "RESISTANCE", "SUPPORT", "IS", "GOING", "TO", "BREAK", "OUT", "IT", "THE", "HOW", "LONG", "CAN", "COULD", "SHOULD",
        "HELLO", "THANKS", "YES", "NO", "ORDER", "BOOK", "DEPTH", "PRICE", "VOLUME"
    ]);
    const latinTokens = message.match(/\b[A-Za-z][A-Za-z0-9]{1,9}\b/g) || [];

    // Latin tickers that match no listed stock (e.g. FTNS) must not scope tools —
    // filter them against the known-symbol universe before anything else.
    const knownSymbols = getSyncValidSymbols();
    const resolvedLatin = latinTokens.map(token => {
        const upper = token.toUpperCase();
        return LATIN_TICKER_ALIASES[upper] || upper;
    });
    // Only listed symbols/known aliases are entities. Ordinary English sector
    // names such as "Process Industries" must never become fake tickers. If
    // the symbol universe is not loaded yet, accept only tokens the user typed
    // in ticker form (all caps); unknown tickers are handled explicitly later.
    const knownSet = new Set(knownSymbols.map(symbol => String(symbol).toUpperCase()));
    // A Latin token in an Arabic stock question is an explicit identifier even
    // when written in mixed case and outside our coverage (e.g. Adri اغلق اليوم).
    const contextualTickers = new Set([
        ...Array.from(message.matchAll(/(?:^|[\s،,])(?:سهم|حلل|تحليل|أخبار|اخبار|قارن|مقارنة)\s+(?:سهم\s+)?([A-Za-z]{2,6})\b/g), match => match[1].toUpperCase()),
        ...(message.match(/^\s*([A-Za-z]{2,6})\b(?=\s+[\u0621-\u064A])/)?.slice(1) || []).map(token => token.toUpperCase()),
        ...(/^[A-Za-z]{2,6}[؟?\s.]*$/.test(message.trim()) ? [message.trim().replace(/[؟?\s.]+$/, "").toUpperCase()] : []),
    ]);
    const validLatin = knownSymbols.length > 0
        ? resolvedLatin.filter((symbol, index) => knownSet.has(symbol)
            || knownSet.has(LATIN_TICKER_ALIASES[symbol] || "")
            || latinTokens[index] === latinTokens[index].toUpperCase()
            || contextualTickers.has(latinTokens[index].toUpperCase()))
        : resolvedLatin.filter((_, index) => latinTokens[index] === latinTokens[index].toUpperCase());

    let matchedSymbols = [...validLatin];

    // Attempt to match Arabic full names from the mapping
    const stockMappings = getSyncStockMappings();
    let normMsg = message.replace(/[\u064B-\u065F\u0670]/g, "").replace(/\u0640/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
    // "بورصة النيل" / "سوق النيل" / "مؤشر النيل" refers to the Nile SME exchange, not the stock NIPH
    normMsg = normMsg.replace(/(?:بورص[ةه]|سوق|مؤشر)\s+النيل/g, "           ");
    for (const [arName, symbol] of Object.entries(stockMappings).sort((a, b) => b[0].length - a[0].length)) {
        const normKey = arName.replace(/[\u064B-\u065F\u0670]/g, "").replace(/\u0640/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
        if (normKey.length >= 2) {
            const escapedKey = normKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            let pattern: string;
            if (normKey.startsWith("ال")) {
                const keyWithoutAl = normKey.slice(2);
                const escapedWithoutAl = keyWithoutAl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                pattern = `(?:^|[^a-z0-9\\u0621-\\u064a\\u0671-\\u06d3])(?:(?:و|ف|ب|ل|ك|ال)?${escapedKey}|لل${escapedWithoutAl})(?:$|[^a-z0-9\\u0621-\\u064a\\u0671-\\u06d3])`;
            } else {
                pattern = `(?:^|[^a-z0-9\\u0621-\\u064a\\u0671-\\u06d3])(?:و|ف|ب|ل|ك|ال)?${escapedKey}(?:$|[^a-z0-9\\u0621-\\u064a\\u0671-\\u06d3])`;
            }
            const regex = new RegExp(pattern, "i");
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
        // Attached waw conjunction ("حلل كومي وهات اسهم التجميع", "كام واخبار كومي ايه") —
        // without this the whole message plans as ONE intent and the other half's tools are lost.
        .replace(/\s+و(?=(?:هات|جيب|اعرض|حلل|شوف|قارن|مين|ايه|إيه|اخبار|أخبار|سعر|اعمل|ترتيب|قايمه|قائمة)(?:\s|$))/gi, "\n")
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
        const normalized = command.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
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
        technical_preset: plans.map(p => p.entities.technical_preset).find(Boolean) || last.entities.technical_preset || null,
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
        // Single-stock replies open with "**Company Name (SYMBOL)**" — the
        // symbol sits mid-line inside parentheses, so the line-start pattern
        // alone misses it.
        .concat(
            Array.from(latestAssistant.matchAll(/\*\*[^*\n]{0,80}\(([A-Z]{2,6})\)\*\*/g)).map(match => match[1]),
            Array.from(latestAssistant.matchAll(/\*\*([A-Z]{2,6})\*\*(?:\s*[-—:،])/g)).map(match => match[1])
        )
        .filter((symbol): symbol is string => Boolean(symbol) && !["EGX", "RSI", "MACD", "VWAP", "USD"].includes(symbol || ""));
    const unique = Array.from(new Set(candidates));
    return unique.length === 1 ? unique[0] : null;
}

export function extractRequestedDate(message: string, refDate: Date = new Date()): string | null {
    const normalized = message.toLowerCase().replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

    // Relative dates
    if (/(?:اول|أول)\s*(?:امبارح|امس|أمس)/i.test(normalized)) {
        const d = new Date(refDate);
        d.setDate(d.getDate() - 2);
        return d.toISOString().slice(0, 10);
    }
    if (/(?<![\u0621-\u064A])(?:امبارح|امس|أمس|البارح|بالامس|بالأمس)(?![\u0621-\u064A])/i.test(normalized)) {
        const d = new Date(refDate);
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
    }
    if (/(?:النهارده|النهاردة|اليوم)/i.test(normalized) && (/(?:بتاريخ|تاريخ|جلسة|جلسه|مسح|بيانات)/i.test(normalized) || /\d{1,2}\s*[\\/-]\s*\d{1,2}/.test(normalized))) {
        const d = new Date(refDate);
        return d.toISOString().slice(0, 10);
    }

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
    const match = normalized.match(/(?:^|\s)(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?(?:\s|$|[؟?])/);
    if (match) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = match[3] ? Number(match[3]) : refDate.getFullYear();
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
    }

    // Arabic month names e.g. "19 اغسطس" or "19 أغسطس"
    const monthsAr: Record<string, number> = {
        "يناير": 1, "فبراير": 2, "مارس": 3, "ابريل": 4, "أبريل": 4, "مايو": 5, "يونيو": 6,
        "يوليو": 7, "اغسطس": 8, "أغسطس": 8, "سبتمبر": 9, "اكتوبر": 10, "أكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12
    };
    const arMonthMatch = message.match(/(\d{1,2})\s*(يناير|فبراير|مارس|ابريل|أبريل|مايو|يونيو|يوليو|اغسطس|أغسطس|سبتمبر|اكتوبر|أكتوبر|نوفمبر|ديسمبر)(?:\s*(\d{4}))?/i);
    if (arMonthMatch) {
        const day = Number(arMonthMatch[1]);
        const monthName = arMonthMatch[2];
        const month = monthsAr[monthName];
        const year = arMonthMatch[3] ? Number(arMonthMatch[3]) : refDate.getFullYear();
        if (month) {
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }
    }

    return null;
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
    if (/(?<![\u0621-\u064A])(?:امبارح|امس|أمس|البارح|السابق|اللي فات|قبل كده|من شوية|الأسبوع اللي فات|الشهر اللي فات)(?![\u0621-\u064A])/i.test(message)) {
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
    const portfolioOperation = detectPortfolioIntent(message);
    if (portfolioOperation) {
        return {
            intent: "portfolio_management",
            confidence: 1,
            entities: { symbols: extractExplicitSymbols(message), sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null, portfolio_operation: portfolioOperation },
            tools: ["manage_portfolio"],
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    const isCryptoQuestion = /(?:usdt|btc|eth|crypto|كريبتو|بيتكوين|عملات\s*رقمية|عمله\s*رقميه|بينانس|binance)/i.test(message);
    if (isCryptoQuestion && extractExplicitSymbols(message).length === 0) {
        return {
            intent: "general_chat",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            service_degraded_message: "منصة EGX Bots متخصصة حصرياً في أسهم وقطاعات البورصة المصرية (EGX)، ولا تدعم العملات الرقمية أو أزواج التداول المشفرة (Crypto / USDT). يمكنك البحث والتحليل لأي سهم مصري مدرج.",
            session_update: { current_symbol: null, last_symbols: [], summary: message }
        };
    }
    if (/شريع|sharia/i.test(normalizeArabicIntent(message))) {
        const normalized_sh = normalizeArabicIntent(message);
        const explicitSymbols_sh = extractExplicitSymbols(message);
        if (explicitSymbols_sh.length > 0) {
            return {
                intent: "stock_analysis", confidence: 1,
                entities: { symbols: explicitSymbols_sh, sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null, sharia_filter: true },
                tools: ["get_stock"],
                session_update: { current_symbol: explicitSymbols_sh[0], last_symbols: explicitSymbols_sh, summary: message },
            } as any;
        }
        // No verified sharia classification is stored in the database. Never
        // turn a sharia request into ordinary recommendations.
        return {
            intent: "general_chat", confidence: 1,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: message },
        } as any;
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
    const directGroupAllocation = /(?:فيهم|منهم|الاتنين|السهمين|واحد\s+فيهم)/i.test(normalized)
        && /(?:احط|أحط|اوزع|أوزع|ادخل|اشتري|أشتري)/i.test(normalized)
        && sessionState.last_symbols.length > 1;
    if (directGroupAllocation) {
        const groupSymbols = sessionState.last_symbols.slice(0, 5);
        return {
            intent: "comparison", confidence: 1, guidance_intent: "allocation",
            entities: { symbols: groupSymbols, sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_stock", "get_stock_levels"],
            session_update: { current_symbol: groupSymbols[0], last_symbols: groupSymbols, summary: message }
        } as any;
    }
    const asksOldestRecommendation = /(?:اقدم|أقدم)\s+(?:توصي|توصية|توصيات)/i.test(normalized);
    if (asksOldestRecommendation && explicitSymbols.length === 0) {
        return {
            intent: "historical_recall",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "historical", requested_date: null, scan_direction: null, recommendation_order: "oldest", recommendation_filter: null },
            tools: ["get_recommendations"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        } as any;
    }
    if (/^\s*كمل\s*[!؟?.]*$/i.test(message)) {
        return {
            intent: "general_chat", confidence: 1,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: message }
        } as any;
    }
    const investorGuidance = /(?:قطاع|القطاعات|العقارات|الادويه|الأدوية|الاتصالات)/i.test(normalized)
        ? null
        : getInvestorGuidanceIntent(message, explicitSymbols.length > 0);
    const hasGuidanceGroupReference = Boolean(investorGuidance)
        && /(?:فيهم|منهم|الاتنين|السهمين|واحد\s+فيهم)/i.test(normalized)
        && /(?:احط|أحط|اوزع|أوزع|ادخل|اشتري|أشتري)/i.test(normalized)
        && sessionState.last_symbols.length > 1;
    if (hasGuidanceGroupReference) {
        const groupSymbols = sessionState.last_symbols.slice(0, 5);
        return {
            intent: "comparison", confidence: 1, guidance_intent: "allocation",
            entities: { symbols: groupSymbols, sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_stock", "get_stock_levels"],
            session_update: { current_symbol: groupSymbols[0], last_symbols: groupSymbols, summary: message }
        } as any;
    }
    if (investorGuidance && /تجميع|accumulation/i.test(normalized)) {
        return {
            intent: "general_chat", confidence: 1, guidance_intent: investorGuidance,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: "accumulation" },
            tools: ["get_accumulation_stocks"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        } as any;
    }
    const isEducationFirstGuidance = Boolean(investorGuidance)
        && /(?:مش\s*فاهم|خبر[ةه]|صندوق\s+دخل\s+ثابت|مقارن[ةه].{0,20}(?:صندوق|سهم)|ازاي\s+ابدا|كيف\s+ابدا)/i.test(normalized)
        && !/(?:سيول|سيولة|قطاع|الاسهم|اسهم\s+(?:تجميع|تصريف)|توصي)/i.test(normalized);
    if (isEducationFirstGuidance || (investorGuidance && (!explicitSymbols.length || investorGuidance === "product_comparison"))) {
        return {
            intent: "general_chat",
            confidence: 1,
            guidance_intent: investorGuidance,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: message }
        } as any;
    }
    if (investorGuidance && /(?:فيهم|منهم|الاتنين|السهمين|واحد\s+فيهم).{0,35}(?:احط|أحط|اوزع|أوزع|ادخل|اشتري|أشتري)/i.test(normalized) && sessionState.last_symbols.length > 0) {
        return {
            intent: "comparison", confidence: 1, guidance_intent: "allocation",
            entities: { symbols: sessionState.last_symbols, sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_stock", "get_stock_levels"],
            session_update: { current_symbol: sessionState.last_symbols[0], last_symbols: sessionState.last_symbols, summary: message }
        } as any;
    }
    // A follow-up question about price action ("يطلع للمقاومة امتى") must
    // reuse the session's current stock. It runs before every company-name
    // detector so a question fragment is never mistaken for a stock name.
    const followUpSymbol = explicitSymbols.length === 0
        ? (sessionState.current_symbol || (sessionState.last_symbols || [])[0] || null)
        : null;
    const isAnaphoricTimingFollowUp = /(?:امتي|متي|متى|امتى|when|how\s+long|هيوصل|هيطلع|هينزل|هيرجع|هيكمل|will\s+it|when\s+will|is\s+it|going\s+to|should\s+i)/i.test(normalized);
    const isPositionOrLossFollowUp = Boolean(followUpSymbol) && (
        /(?:اشتريت|شاري|متوسط|متوسطي|مركزي|سعري|دخولي|معايا|معي).{0,30}(?:السهم|بسعر|\d+)/i.test(normalized)
        || /(?:السهم|فيه|فيها).{0,20}(?:اشتريت|شاري|متوسط|مركزي|سعري)/i.test(normalized)
        || /(?:اوقف|وقف|أوقف).{0,15}(?:خسار|خساير|الخسار|الخساير)/i.test(normalized)
        || /(?:خسران|خسارتي|خسارتى|خساير|خساره|خسارة).{0,25}(?:اعمل|أعمل|ايه|إيه|اوقف|وقف|تقل|تزيد|تاني|اكتر|أكتر|فيها|فيه)/i.test(normalized)
        || /(?:السهم|السهمين|الاتنين).{0,25}(?:هيعمل|وضعه|اخباره|أخباره|رايك|رأيك|مكمل|نازل|طالع|هيطلع|هينزل|يصحح|يكسر|يخترق|ابيع|اشتري|احتفظ|اخرج|وقف)/i.test(normalized)
        || /(?:ابيع|أبيع|اشتري|أشتري|احتفظ|أحتفظ|اخرج|أخرج).{0,20}(?:السهم|فيه|فيها|ولا|دلوقتي|حاليا)/i.test(normalized)
    );
    if (followUpSymbol && ((isImplicitStockFollowUp(message) && isAnaphoricTimingFollowUp) || isPositionOrLossFollowUp)) {
        const wantsLossRiskTools = /(?:خسار|خساير|خسران|وقف|اوقف|يهبط|ينزل)/i.test(normalized);
        return {
            intent: wantsLossRiskTools ? "risk_analysis" : "stock_analysis",
            confidence: 1,
            entities: {
                symbols: [String(followUpSymbol).toUpperCase()],
                sector: null,
                wants_table: true,
                timeframe: "current",
                requested_date: null,
                scan_direction: wantsLossRiskTools ? "distribution" : null
            },
            tools: wantsLossRiskTools ? ["get_stock", "get_stock_levels", "get_distribution_stocks"] : ["get_stock", "get_stock_levels"],
            session_update: { current_symbol: followUpSymbol, last_symbols: sessionState.last_symbols, summary: message },
        } as any;
    }
    // A new, market-wide investment request must not inherit the previous
    // stock from the session (for example: "عايز اسهم استثمار لمدة سنة"
    // after an AMER analysis). Route it to recommendations before resolving
    // implicit stock context or sectors.
    const broadInvestmentRequest = explicitSymbols.length === 0
        && /(?:عايز|عاوز|اريد|أريد|محتاج|نفسي|اسهم|أسهم|فرص|ادخل|استثمر|استثمار)/i.test(normalized)
        && /(?:استثمار|استثمر|احتفاظ|طويل|سنه|سنة|العام|عاماً|عام كامل|شهور|شهر|مدى|اجل|أجل)/i.test(normalized)
        && !/(?:قطاع|القطاع|شركة|سهم\s+[A-Z]{2,6}|[A-Z]{2,6})/i.test(message);
    if (broadInvestmentRequest) {
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, recommendation_order: "newest", recommendation_filter: null },
            tools: ["get_recommendations"],
            session_update: { current_symbol: null, last_symbols: [], summary: message }
        };
    }
    // "Best stocks tomorrow" and the immediate Arabic-name follow-up must
    // route deterministically with fair value / recommendation dataset.
    const asksRecommendations = explicitSymbols.length === 0 && /(?:توصي[اإ]?\s*ت|توصي[ةه]|ترشح|ترشيحات|فرص\s*شراء|فرص\s*دخول|اسهم\s*ادخل\s*فيها|اسهم\s*اشتريها|اشتري\s*ايه|ادخل\s*في\s*ايه|ادخل\s*فيها|اسهم\s*ممتازة|اسهم\s*كويسة|تحقق\s*ارباح|تحقق\s*أرباح|توصيات\s*كويسة|توصيات\s*شراء|اسهم\s*للشراء|فرص\s*الشراء|هات\s*توصي[ةه]|عايز\s*توصي[ةه]|في\s*توصيات|فيه\s*توصيات)/i.test(normalized);
    const asksTomorrowRecommendations = explicitSymbols.length === 0 && /(?:اقوى|أقوى|افضل|أفضل|شراء|اشترى|أسهم|اسهم).{0,35}(?:غدا|غداً|بكره|بكرة|غدًا)/i.test(normalized);
    const asksArabicNames = explicitSymbols.length === 0 && /(?:حدد|اكتب|هات|اعرض).{0,25}(?:الاسماء|الأسماء|اسماء|أسماء).{0,15}(?:بالعربى|بالعربي|العربي|العربية)/i.test(normalized);
    const hasPreviousRecommendationList = /(?:توصي|شراء|افضل\s+سهم|أقوى\s+سهم|أقوى\s+الأسهم|افضل\s+الاسهم|أفضل\s+الأسهم)/i.test(String(sessionState.summary || ""));
    if (asksTomorrowRecommendations) {
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, recommendation_order: "newest", recommendation_filter: "open" },
            tools: ["get_recommendations", "get_fair_value_scan"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message },
        } as any;
    }
    if (asksRecommendations || (asksArabicNames && hasPreviousRecommendationList)) {
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, recommendation_order: "newest", recommendation_filter: "open" },
            tools: ["get_recommendations"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message },
        } as any;
    }
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
    // Check if query asks for BOTH accumulation and distribution together
    const isBothAccumulationAndDistribution = explicitSymbols.length === 0 && (
        /(?:تجميع\s*(?:و|أو|او|مع|ولا)\s*تصريف|تصريف\s*(?:و|أو|او|مع|ولا)\s*تجميع|تجميع\s+وتصريف|التجميع\s+والتصريف)/i.test(normalized) ||
        (/(?:تجميع|accumulation)/i.test(normalized) && /(?:تصريف|distribution)/i.test(normalized))
    );
    if (isBothAccumulationAndDistribution) {
        return {
            intent: "accumulation_distribution",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_accumulation_stocks", "get_distribution_stocks"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    // Single stock accumulation / distribution query (e.g. "هل سهم فوري عليه تجميع ولا تصريف؟" or "تجميع COMI")
    if (explicitSymbols.length > 0 && /(?:تجميع|تصريف|وايكوف|wyckoff)/i.test(normalized)) {
        const scanDirection = /تصريف|distribution/i.test(normalized) ? "distribution" : "accumulation";
        return {
            intent: "accumulation_distribution",
            confidence: 1,
            entities: { symbols: explicitSymbols, sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: scanDirection },
            tools: [scanDirection === "distribution" ? "get_distribution_stocks" : "get_accumulation_stocks"],
            session_update: { current_symbol: explicitSymbols[0], last_symbols: explicitSymbols, summary: message }
        };
    }

    const bollingerPreset = explicitBollingerPreset(message);
    if (bollingerPreset) return {
        intent: "technical_scan", confidence: 1,
        entities: { symbols: [], sector: null, timeframe: "current", requested_date: extractRequestedDate(message), wants_table: true, technical_preset: bollingerPreset },
        tools: ["get_technical_scan"], session_update: { current_symbol: null, last_symbols: [], summary: message },
    };

    // Technical Scanner Template 1: MACD Golden Cross
    const isMacdCross = explicitSymbols.length === 0 && /(?:تقاطع\s*(?:ذهبي|ايجابي|إيجابي)|تقاطع\s*(?:ال)?(?:macd|ماكد).{0,18}(?:صاعد|إيجابي|ايجابي|ذهبي)|جولدن\s*كروس|golden\s*cross|macd\s*(?:cross|ذهبي)|تقاطع\s*(?:خط\s*)?الماكد|ماكد\s*كروس)/i.test(normalized);
    if (isMacdCross) {
        return {
            intent: "technical_scan",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, technical_preset: "macd_cross" },
            tools: ["get_technical_scan"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    // Technical Scanner Template 2: RSI Oversold
    const isRsiOversold = explicitSymbols.length === 0 && /(?:ذرو[ةه]\s*البيع|تشبع\s*(?:بيعي|البيع)|oversold|rsi.{0,25}(?:اقل|أقل|تحت|دون).{0,8}(?:30|35)|ار\s*اس\s*اي.{0,25}(?:اقل|أقل|تحت|دون).{0,8}(?:30|35))/i.test(normalized);
    if (isRsiOversold) {
        return {
            intent: "technical_scan",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, technical_preset: "rsi_oversold" },
            tools: ["get_technical_scan"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    // Technical Scanner Template 3: Volume Breakout
    const isVolumeBreakout = explicitSymbols.length === 0 && /(?:اختراق\s*حجم(?:\s*التداول)?|انفجار\s*حجم(?:\s*التداول)?|فوليوم\s*(?:عالي|انفجاري|غير\s*عادي|قياسي|ضخم|كبير)|volume\s*breakout|احجام\s*تداول\s*(?:غير\s*عادي[ةه]|عالي[ةه]|قياسي[ةه])|حجم\s*تداول\s*(?:غير\s*عادي|انفجاري|كبير|عالي))/i.test(normalized);
    if (isVolumeBreakout) {
        return {
            intent: "technical_scan",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, technical_preset: "volume_breakout" },
            tools: ["get_technical_scan"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    // Technical Scanner Template 4: SMA 200 Breakout
    const isSma200 = explicitSymbols.length === 0 && /(?:اختراق\s*الاتجاه|متوسط\s*200|موفينج\s*200|ema\s*200|sma\s*200|فوق\s*(?:متوسط\s*)?200\s*يوم)/i.test(normalized);
    if (isSma200) {
        return {
            intent: "technical_scan",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, technical_preset: "sma_200_breakout" },
            tools: ["get_technical_scan"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    // Technical Scanner Template 5: Smart Money Flow
    const isSmartMoney = explicitSymbols.length === 0 && /(?:[اأ]موال\s*ذكي[ةه]|تدفق\s*(?:ال)?[اأ]موال|سيول[ةه]\s*ذكي[ةه]|smart\s*money|cmf|أقوى\s+زخم|اقوى\s+زخم|زخم\s+فني|الزخم\s+الفني|زخم|الزخم|momentum)/i.test(normalized);
    if (isSmartMoney) {
        return {
            intent: "technical_scan",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, technical_preset: "smart_money_flow" },
            tools: ["get_technical_scan"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    // Technical Scanner Template 6: Bullish RSI Divergence
    const isBullishDiv = explicitSymbols.length === 0 && /(?:دايفرجنس\s*(?:ايجابي|إيجابي|صعودي)|تباعد\s*(?:صعودي|ايجابي|إيجابي)|bullish\s*divergence|(?:دايفرجنس|تباعد).{0,25}(?:rsi|ار\s*اس\s*اي).{0,25}(?:ايجابي|صعودي)|(?:rsi|ار\s*اس\s*اي).{0,25}(?:دايفرجنس|تباعد).{0,25}(?:ايجابي|صعودي)|دايفرجنس.{0,15}ايجابي)/i.test(normalized);
    if (isBullishDiv) {
        return {
            intent: "technical_scan",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, technical_preset: "rsi_bullish_divergence" },
            tools: ["get_technical_scan"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    // Technical Scanner Template 7: Bearish Divergence Alert
    const isBearishDiv = explicitSymbols.length === 0 && /(?:دايفرجنس\s*(?:سلبي|هبوطي)|تباعد\s*(?:هبوطي|سلبي)|bearish\s*divergence|تحذير\s*دايفرجنس|تنبيه\s*تباعد|دايفرجنس.{0,15}(?:سلبي|هبوطي)|تباعد.{0,15}هبوطي)/i.test(normalized);
    if (isBearishDiv) {
        return {
            intent: "technical_scan",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, technical_preset: "bearish_divergence_alert" },
            tools: ["get_technical_scan"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
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
    if (explicitSymbols.length === 0 && /(?:اقوى|اقوي|أقوى|اعلى|اعلي|أعلى)\s+(?:الاسهم|الأسهم|اسهم)\s+(?:النهارده|اليوم|(?:اخر|لاخر)\s+(?:جلسه|يوم))$/i.test(normalized.trim())) {
        return {
            intent: "market_summary", confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null },
            tools: ["get_market"],
            request: { goal: "ترتيب الأسهم حسب تغير السعر في آخر جلسة", reference: "market", ranking_metric: "price_change", required_facts: ["market_summary"] },
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        } as PlannerResult;
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
    const isExplicitMtdPerformance = explicitSymbols.length === 0
        && /(?:العائد|عائد|عوائد|أداء|اداء|ارباح|أرباح).{0,20}(?:الشهري|الشهر|خلال\s+الشهر|في\s+الشهر|الشهر\s+ده|هذا\s+الشهر)/i.test(normalized)
        && !/(?:معايا|عندي|محفظ|ادخر|توزيع|صندوق|شهاده|وديعه|دخل)/i.test(normalized);

    const isPeriodRankingRequest = explicitSymbols.length === 0
        && ((hasMarketListHint && (isYtdMarketRequest || isMtdMarketRequest || isWtdMarketRequest || /(?:اعلي|أعلى|افضل|أفضل|اقل|أقل|ارخص|أرخص|ادنى|أدنى|بافضل|بأفضل|بافل|بأفل|بأعلى|باعلى|قايمه|قائمة|ترتيب).{0,35}(?:ارباح|أرباح|ارتفاع|صعود|اداء|أداء|عائد|سيول|تداول|حجم|ربح|أرباح).{0,35}(?:اول|أول|بداية|بدايه|خلال|منذ).{0,20}(?:السنه|السنة|الشهر|الاسبوع|يناير|ytd|mtd|wtd)/i.test(normalized)))
            || isExplicitMtdPerformance);
    if (isPeriodRankingRequest) {
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "historical", requested_date: isWtdMarketRequest ? "wtd" : (isMtdMarketRequest || isExplicitMtdPerformance) ? "mtd" : null, scan_direction: null },
            tools: ["get_price_history"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    const hasPreviousReferenceEarly = /(?:^|[^\u0621-\u064A])(ده|دا|دي|هذا|السهم ده|السهم دا|السهم دي|هاته|هاتها|اخباره|أخباره|خبره|الاتنين|السهمين|عليه|فيه|ليه|عليها|فيها|ليها|عنه|عنها|به|بها|معاه|معاها|هو|هي)(?:$|[^\u0621-\u064A])/i.test(normalized) && !broadScan && (explicitSymbols.length === 0 || /(قارن|مقارنه|مقارنة).{0,20}(ده|دا|دي|هذا).{0,20}(مع|بـ|ب)/i.test(normalized));
    const isSingleStockRecReference = hasPreviousReferenceEarly && Boolean(sessionState.current_symbol);
    const ambiguousStrongestRequest = explicitSymbols.length === 0
        && /(?:اقوى|اقوي|أقوى|اعلى|اعلي|أعلى)\s+(?:الاسهم|الأسهم|اسهم)\s*[؟?\s]*$/i.test(normalized.trim())
        && !/(النهارده|اليوم|جلسه|جلسة|اخر\s+(?:جلسه|يوم)|لاخر\s+(?:جلسه|يوم)|اسبوع|أسبوع|سيول|سيولة|زخم|ارتفاع|صعود)/i.test(normalized);
    if (ambiguousStrongestRequest) {
        return {
            intent: "clarification",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "unspecified", requested_date: null, scan_direction: null },
            tools: [],
            clarification_needed: true,
            clarification_options: ["أعلى ارتفاع سعري", "أعلى سيولة", "أقوى زخم فني", "أفضل أداء أسبوعي"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    const recommendationRequest = isBestBuyStockQuestion(message) || /(?:توصي[اإ]?\s*ت|توصي[ةه]|ترشح|ترشيحات|فرص\s*شراء|فرص\s*دخول|اسهم\s*ادخل\s*فيها|اسهم\s*اشتريها|اشتري\s*ايه|ادخل\s*في\s*ايه|ادخل\s*فيها|اسهم\s*ممتازة|اسهم\s*كويسة|تحقق\s*ارباح|تحقق\s*أرباح|توصيات\s*كويسة|توصيات\s*شراء|اسهم\s*للشراء|فرص\s*الشراء)/i.test(normalized);
    if (recommendationRequest && explicitSymbols.length === 0 && !isSingleStockRecReference) {
        const isRecFilterOpen = /(?:مفتوح[ةه]|open)/i.test(normalized);
        const isRecFilterThisWeek = /(?:[اأ]سبوع\s*(?:حالي|الحالي|الحالى|ده|هذا)|this\s*week)/i.test(normalized);
        const isRecFilterLastWeek = /(?:[اأ]سبوع\s*(?:الماضي|السابق|الفايت|اللي\s*فات|اللى\s*فات)|last\s*week)/i.test(normalized);
        const recommendation_filter: "open" | "this_week" | "last_week" | "all" | null = isRecFilterOpen ? "open" : isRecFilterLastWeek ? "last_week" : isRecFilterThisWeek ? "this_week" : null;
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, recommendation_order: "newest", recommendation_filter },
            tools: ["get_recommendations"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }
    if (recommendationRequest && explicitSymbols.length === 0 && isSingleStockRecReference) {
        return {
            intent: "stock_analysis",
            confidence: 1,
            entities: { symbols: [sessionState.current_symbol!], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, recommendation_order: "newest", recommendation_filter: null },
            tools: ["get_stock", "get_recommendations", "get_stock_levels"],
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: [sessionState.current_symbol!], summary: message }
        };
    }
    if (
        explicitSymbols.length === 0
        && /(?:متوقع|متوقعة|يرتفع|تطلع|يصعد|صعود)/i.test(normalized)
        && /(?:السهم|الاسهم|الأسهم|قطاع|قطاعات)/i.test(normalized)
        && !/(?:سيول|سيولة|تجميع|تصريف|زخم|مؤشر|مؤشرات|توصي|توصيات|القيمة|عادلة|اسبوع|أسبوع|اسبوعي|أسبوعي|اليوم|النهارده|جلسة|جلسه)/i.test(normalized)
    ) {
        return {
            intent: "clarification",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "unspecified", requested_date: null, scan_direction: null },
            tools: [],
            clarification_needed: true,
            clarification_options: ["فوق القيمة الفنية", "أسهم عليها تجميع", "أقوى زخم فني", "التوصيات المسجلة", "توقع أسبوعي"],
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
    // Guard: a company-like name that maps to no known symbol must NOT inherit
    // the previous session symbol (e.g. "التعمير والاستشارات" must not resolve to FCMD).
    const unresolvedCompanyNameMention = !broadScan && isUnresolvedCompanyNameMention(message, symbols);
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
    if (temporal.date && symbols.length === 0 && sessionState.current_symbol && !marketWideRequest && !unresolvedCompanyNameMention) {
        symbols.push(sessionState.current_symbol);
    }
    if (riskFollowUp && symbols.length === 0 && sessionState.current_symbol && !unresolvedCompanyNameMention) {
        symbols.push(sessionState.current_symbol);
    }
    const fiveSessionForecast = /(توقعات|توقع|متوقع|تقعات|وقعات).{0,25}(?:5|خمس|الخمسه|الخمسة).{0,15}(جلسات|جلسه|جلسة)|(?:5|خمس|الخمسه|الخمسة).{0,15}(جلسات|جلسه|جلسة).{0,25}(توقعات|توقع|متوقع|تقعات|وقعات)/i.test(normalized);
    if (fiveSessionForecast && symbols.length === 0 && sessionState.current_symbol && !unresolvedCompanyNameMention) {
        symbols.push(sessionState.current_symbol);
    }
    if (/(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(normalized) && symbols.length === 0 && sessionState.current_symbol && !unresolvedCompanyNameMention) symbols.push(sessionState.current_symbol);
    if ((isDailyPriceLimitQuestion(message) || /(?:أ|ا)عل[ىي].{0,15}(?:سعر|قم[هة])/i.test(normalized)) && symbols.length === 0 && sessionState.current_symbol && !unresolvedCompanyNameMention) symbols.push(sessionState.current_symbol);
    const isGeneralStockFollowUp = /(?:مناسب|استثمر|ادخل|شراء|اشتري|فرصه|فرصة|رايك|رأيك|توقعات|وضعه|اخباره|أخباره|حركته|تحليل|مستهدف|اهداف|أهداف|دعم|مقاومه|مقاومة|شهور|سنه|سنة|شهر|اسبوع|أسبوع)/i.test(normalized);
    if (isGeneralStockFollowUp && symbols.length === 0 && sessionState.current_symbol && !isMarketWideRequest(message) && !/(?:قطاع|القطاعات|البنوك|العقارات|الاتصالات|الادويه|الأدوية)/i.test(normalized) && !isBestBuyStockQuestion(message) && !investorGuidance && !unresolvedCompanyNameMention) {
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
    if (isMultiSectorOrComparison) symbols.length = 0;
    const hasExplicitLatinTicker = /(?:^|[^A-Za-z0-9])[A-Za-z][A-Za-z0-9]{1,9}(?=$|[^A-Za-z0-9])/.test(message);
    if (sector && !hasExplicitLatinTicker && symbols.length === 0 && /(قطاع|القطاعات|البنوك|الاتصالات|العقارات|الادويه|الاغذيه|البترول|الطاقه)/i.test(normalized)) symbols.length = 0;
    const isGreeting = /^(?:ازيك|إزيك|عامل ايه|عامل إيه|اهلا|أهلا|مرحبا|السلام عليكم)[؟?،,.!\s]*$/i.test(message.trim()) || /(?:انت|إنت|انتا|أنت).{0,12}(مين|موديل|نموذج)|مين انت|مين إنت/i.test(normalized);
    const beginnerPortfolioRequest = /(معنديش|ما عنديش).{0,20}(خبره|خبرة).{0,40}(اسهم|الاسهم)|(?:ابني|اعمل|ابدأ).{0,25}(محفظه|محفظة)|صناديق.{0,20}(دخل ثابت|عائد يومي)|(?:اول|أول)\s+يوم.{0,20}(البورصه|البورصة)|عايز\s+افهم\s+اعمل/i.test(normalized);
    const isHistorical = needsHistoricalData("", message);
    const oldestRecommendationRequest = /(اقدم|أقدم).{0,15}(توصيه|توصية|اشاره|إشارة)/i.test(message);
    const marketNewsRequest = /اخبار\s+(?:السوق|البورصه)/i.test(message);
    const requestedDate = temporal.date;
    const dateOnlyFollowUp = Boolean(requestedDate && symbols.length === 0 && sessionState.current_symbol && !marketWideRequest && !unresolvedCompanyNameMention);
    if (dateOnlyFollowUp) symbols.push(sessionState.current_symbol!);
    const isClearMarketRequest = marketWideRequest || isBestBuyStockQuestion(message) || oldestRecommendationRequest || /(?:(?:أ|ا)عل[ىي]|(?:أ|ا)قو[ىي]|أحسن|احسن|أفضل|افضل|سيول|السيول|السيوله|تجميع|تصريف|القطاعات|قطاعات|كام\s+(?:ال)?قطاعات?|كم\s+(?:ال)?قطاعات?|حالة السوق|حاله البورصه|حالة البورصة|اداء المؤشر|أداء المؤشر|المؤشر النهارده|السوق عمل|دولار|usd)/i.test(normalized);
    const isClearStockRequest = symbols.length > 0;
    if (/(?:كام|كم|عدد).{0,20}(?:قطاع|قطاعات)/i.test(normalized)) {
        return {
            intent: "sector_analysis",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: temporal.timeframe, requested_date: requestedDate, scan_direction: null },
            tools: ["get_sector_list"],
            session_update: { current_symbol: null, last_symbols: [], summary: message },
        } as any;
    }
    if (dateOnlyFollowUp) {
        return {
            intent: "stock_analysis",
            confidence: 1,
            entities: { symbols, sector: null, wants_table: false, timeframe: "historical", requested_date: requestedDate, scan_direction: null },
            tools: ["get_stock", "get_stock_levels"],
            session_update: { current_symbol: symbols[0], last_symbols: symbols, summary: message },
        } as any;
    }

    // Day-by-day / closing-price history requests for a named stock or the
    // active session stock ("سعر إقفال X كل يوم من النهارده ولغاية أسبوعين
    // فاتوا + المتوقع") must pull structured price history instead of replying
    // "لا توجد بيانات تاريخية" from a single live snapshot.
    const dayByDayHistory = /(?:سعر\s+(?:اقفال|إقفال|الاقفال|الإقفال)|اقفال|إقفال)\s*(?:ال)?(?:سهم|سعر)?\s*.{0,45}(?:كل\s+يوم|يوم\s*بـ?\s*يوم|يوميا|يومية|يوميه)/i.test(normalized)
        || /(?:كل\s+يوم|يوم\s*بـ?\s*يوم).{0,20}(?:من|النهارده|النهاردة).{0,60}(?:ولغاية|لغاية|حتى|الى|الي).{0,30}(?:فات|فاتت|فاتوا|الماضي|الماضية|السابق)/i.test(normalized)
        || /(?:اقفال|إقفال).{0,60}(?:اسبوعين|أسبوعين|جلسات|فات|فاتت|فاتوا)/i.test(normalized);
    if (dayByDayHistory && symbols.length === 0 && sessionState.current_symbol && !unresolvedCompanyNameMention && !marketWideRequest) {
        symbols.push(sessionState.current_symbol);
    }
    if (dayByDayHistory && symbols.length > 0 && !marketWideRequest && !/(قارن|مقارن)/i.test(normalized)) {
        return {
            intent: "stock_analysis",
            confidence: 1,
            entities: { symbols, sector: null, wants_table: true, timeframe: "historical", requested_date: null, scan_direction: null },
            tools: ["get_stock", "get_stock_levels", "get_price_history"],
            session_update: { current_symbol: symbols[0], last_symbols: symbols, summary: message }
        };
    }

    // Investment-horizon clarification after a sharia/recommendation request
    // ("مش مضاربة استثمار لحد أول السنة") must never hijack into a Finance
    // sector scan — "استثمار" here is a horizon, not the Finance sector.
    const horizonClarification = !marketWideRequest
        && symbols.length === 0
        && !sector
        && /(?:مش\s+مضاربه|مش\s+مضاربة|استثمار|مضاربه|مضاربة).{0,35}(?:لحد|حتى|الى|الي|طويل|الاجل|الأجل|المدى|الامد|بعدين|بدايه|بداية)/i.test(normalized);
    if (horizonClarification && !isBestBuyStockQuestion(message)) {
        const priorRecContext = /(شريع|sharia|توصي|ادخل\s+في|فرص|استثمر)/i.test(String(sessionState.summary || ""));
        if (priorRecContext) {
            return {
                intent: "market_summary",
                confidence: 1,
                entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, recommendation_order: "newest", recommendation_filter: null },
                tools: ["get_recommendations"],
                session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
            };
        }
        return {
            intent: "general_chat",
            confidence: 1,
            guidance_intent: "allocation",
            entities: { symbols: [], sector: null, wants_table: false, timeframe: "current", requested_date: null, scan_direction: null },
            tools: [],
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    // "هما سهمين أخش فيهم ليه كل ده؟" — a follow-up asking to narrow the
    // previous sharia/recommendation feed to a couple of entries must stay on
    // the recommendation feed, not drift back into a Finance sector scan.
    const pickFromPriorRecommendations = symbols.length === 0
        && /(?:سهمين|الاتنين|السهمين|اتنين|منهم|فيهم|من دول|دول).{0,25}(?:اخش|ادخل|اشتري|اختار|أختار)/i.test(normalized)
        && /(شريع|sharia|توصي|فرص|ادخل|استثمار|قطاع)/i.test(String(sessionState.summary || ""));
    if (pickFromPriorRecommendations) {
        return {
            intent: "market_summary",
            confidence: 1,
            entities: { symbols: [], sector: null, wants_table: true, timeframe: "current", requested_date: null, scan_direction: null, recommendation_order: "newest", recommendation_filter: null },
            tools: ["get_recommendations"],
            session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: message }
        };
    }

    if (!sector && !isGreeting && !beginnerPortfolioRequest && !investorGuidance && !isHistorical && !requestedDate && !isClearMarketRequest && !isClearStockRequest) return null;

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
        intent: isGreeting || beginnerPortfolioRequest || investorGuidance ? "general_chat" : marketNewsRequest ? "market_summary" : requestedDate && symbols.length ? "stock_analysis" : isHistorical ? "historical_recall" : explicitSector || knownSectorFollowUp || sectorFollowUp ? "sector_analysis" : enforced.intent,
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
            recommendation_filter: enforced.recommendation_filter || null,
            requested_sectors: enforced.requested_sectors || [],
        },
        tools: isGreeting || beginnerPortfolioRequest || investorGuidance || (isHistorical && !requestedDate && !marketNewsRequest && !oldestRecommendationRequest) ? [] : marketNewsRequest ? ["get_news"] : knownSectorFollowUp || sectorFollowUp ? ["get_sector"] : enforced.replaceTools ? enforced.tools : explicitSector ? ["get_sector"] : symbols.length ? ["get_stock"] : [],
        session_update: {
            current_symbol: effectiveSector ? null : (symbols[0] || sessionState.current_symbol),
            last_symbols: symbols.length ? symbols : sessionState.last_symbols,
            summary: message
        }
    };
}

export function parsePortfolioAnswer(message: string, item: { symbol: string; quantity: number | null; price: number | null }) {
    message = message.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const nums = Array.from(message.matchAll(/\d+(?:[.,]\d+)?/g)).map(m => Number(m[0].replace(/,/g, ""))).filter(Number.isFinite);
    let quantity = item.quantity;
    let price = item.price;
    const onlyQuantityMissing = quantity === null && price !== null;
    const onlyPriceMissing = price === null && quantity !== null;
    const quantityMatch = message.match(/(?:عدد|كمي[ةه])\s*[:=]?\s*(\d[\d,]*)/) || message.match(/(\d[\d,]*)\s*سهم/);
    if (quantity === null && quantityMatch) quantity = Number(quantityMatch[1].replace(/,/g, ""));
    if (quantity === null && nums.length > 0 && (
        /سهم|كمي|عدد|معايا|امتلك/i.test(message)
        // The bot explicitly asks for a number, so accept the concise reply
        // "200 بسعر 45.65" without requiring the user to repeat "سهم".
        || /^(?:\s*\d[\d,.]*\s*)(?:بسعر|سعر|بمتوسط|متوسط)/i.test(message)
        || (onlyQuantityMissing && nums.length === 1)
    )) quantity = nums[0];
    if (price === null) {
        const match = message.match(/(?:متوسط|شراء|بسعر|سعر)[^\d]*(\d+(?:[.,]\d+)?)/i);
        if (match) price = Number(match[1].replace(/,/g, ""));
        else if (nums.length > 1) price = nums[1];
        else if (onlyPriceMissing && nums.length === 1) price = nums[0];
    }
    return { ...item, quantity, price };
}

/** Parse a follow-up such as "أول ٥ أسهم" after an oversized image import. */
export function parsePortfolioSelectionCount(message: string): number | null {
    const normalized = normalizeArabicIntent(message);
    const words: Record<string, number> = {
        واحد: 1, واحده: 1, اتنين: 2, اثنين: 2, تلاته: 3, ثلاثه: 3,
        اربعه: 4, خمسه: 5, سته: 6, سبعه: 7, تمانيه: 8, تسعه: 9, عشره: 10,
    };
    const match = normalized.match(/(?:اول|الأول|first)\s*(\d{1,2}|واحده?|اتنين|اثنين|تلاته|ثلاثه|اربعه|خمسه|سته|سبعه|تمانيه|تسعه|عشره)\s*(?:اسهم|سهم|مراكز|مركز)/i);
    if (!match) return null;
    const count = /^\d+$/.test(match[1]) ? Number(match[1]) : words[match[1]];
    return Number.isFinite(count) && count > 0 && count <= 10 ? count : null;
}

export function portfolioMissingQuestion(item: { symbol: string; quantity: number | null; price: number | null }): string {
    const missing = [item.quantity === null ? "الكمية" : "", item.price === null ? "متوسط سعر الشراء" : ""].filter(Boolean).join(" و");
    return `عشان أسجل ${item.symbol} صح في محفظتك، محتاج ${missing}. اكتب مثلاً: «200 سهم بمتوسط 45.65 جنيه». متوسط السعر هو متوسط تكلفة الشراء، مش السعر الحالي.`;
}

/**
 * Track the conversational portfolio-edit state after a manage_portfolio tool
 * run. When the tool asked for the symbol, or for the quantity of a known
 * symbol, the user's next short reply should complete that same operation.
 * Any other outcome clears the state so unrelated messages are never hijacked.
 */
async function persistPortfolioAwaitingState(
    supabase: any,
    sessionId: string,
    userId: string,
    operation: string,
    data: any,
): Promise<void> {
    if (!sessionId) return;
    let next: { operation: "add" | "update" | "remove" | "sell"; symbol: string | null } | null = null;
    if (data && data.ok === false && typeof data.message === "string") {
        const op: "add" | "update" | "remove" | "sell" | null =
            operation === "add" || operation === "update" || operation === "remove" || operation === "sell" ? operation : null;
        const quantityAsk = data.message.match(/محتاج أعرف عدد أسهم ([A-Z0-9]+)/);
        if (op && quantityAsk) {
            next = { operation: op, symbol: quantityAsk[1] };
        } else if (op && /رمز السهم اللي عايز/.test(data.message)) {
            next = { operation: op, symbol: null };
        }
    }
    await updateSessionSummary(supabase, sessionId, userId, { portfolio_add_awaiting: next });
}

export function formatPortfolioSnapshotResponse(data: any): string {
    if (data?.ok !== true || !Array.isArray(data?.positions)) {
        return "تعذر قراءة محفظتك حالياً. جرّب مرة أخرى؛ لا يمكن اعتبار فشل القراءة محفظة فارغة.";
    }
    const positions = Array.isArray(data?.positions) ? data.positions : [];
    const watchPositions = Array.isArray(data?.watch_positions) ? data.watch_positions : [];
    const totals = data?.totals || {};
    const analysis = data?.analysis || {};
    const lines = [positions.length ? `محفظتك فيها ${positions.length} مركز.` : "محفظتك فاضية حالياً."];
    lines.push(`إجمالي قيمة المحفظة: ${Number(totals.equity || 0).toLocaleString("en-US")} ج.م`);
    const hasCost = totals.cost_basis !== null && totals.cost_basis !== undefined;
    lines.push(`إجمالي قيمة الأسهم: ${Number(totals.market_value || 0).toLocaleString("en-US")} ج.م، والتكلفة: ${hasCost ? `${Number(totals.cost_basis).toLocaleString("en-US")} ج.م` : "غير مكتملة"}`);
    const totalProfit = totals.profit_value;
    const totalProfitPct = totals.profit_pct;
    lines.push(totalProfit === null || totalProfit === undefined
        ? "الربح/الخسارة: غير متاح لأن متوسط شراء مركز أو أكثر غير مسجل."
        : `${totalProfit >= 0 ? "الربح" : "الخسارة"} غير المحققة: ${totalProfit >= 0 ? "+" : ""}${Number(totalProfit).toLocaleString("en-US")} ج.م (${Number(totalProfitPct || 0).toFixed(1)}%)`);
    lines.push(`السيولة: ${Number(data?.cash_balance || 0).toLocaleString("en-US")} ج.م (${Number(analysis.cash_pct || 0).toFixed(1)}%)`);
    lines.push(`أكبر مركز: ${analysis.top_symbol || "لا يوجد"} (${Number(analysis.top_position_pct || 0).toFixed(1)}%)`);
    lines.push(`التنويع: ${analysis.diversification || "غير متاح"}`);
    for (const position of positions) {
        const quantity = Number(position.quantity || 0);
        const entry = position.entry_price != null && Number(position.entry_price) > 0 ? Number(position.entry_price) : null;
        const last = position.last_price != null && Number(position.last_price) > 0 ? Number(position.last_price) : null;
        const hasEntry = entry != null && entry > 0;
        const pnl = hasEntry && last != null && Number.isFinite(quantity * (last - entry)) ? quantity * (last - entry) : null;
        const pnlPct = hasEntry && last != null ? ((last - entry) / entry) * 100 : null;
        const sourceLabel = position.price_source === "live" ? "لحظي" : position.price_source === "stock_prices" ? "آخر إغلاق" : "غير متاح";
        lines.push(`- ${position.symbol}: ${position.quantity ?? "؟"} سهم، متوسط ${hasEntry ? `${position.entry_price} ج.م` : "غير مسجل"}، آخر سعر ${position.last_price ?? "غير متاح"} ج.م (${sourceLabel})، ${pnl === null ? "الربح/الخسارة غير متاح" : `${pnl >= 0 ? "ربح" : "خسارة"} ${pnl >= 0 ? "+" : ""}${pnl.toLocaleString("en-US")} ج.م (${pnlPct!.toFixed(1)}%)`}`);
    }
    for (const suggestion of analysis.suggestions || []) lines.push(`⚠️ ${suggestion}`);
    if (watchPositions.length > 0) {
        lines.push("");
        lines.push(`👁️ أسهم المراقبة من الماسح (${watchPositions.length}) — دي مش ضمن المحفظة لأن الكمية ومتوسط الشراء غير مسجّلين:`);
        for (const watch of watchPositions) {
            lines.push(`- ${watch.symbol}${watch.name ? ` (${watch.name})` : ""}${watch.last_price != null ? ` — آخر سعر ${watch.last_price} ج.م` : ""}`);
        }
        lines.push("عايز أضيفها لمحفظتك؟ اكتب: «ضيف <الرمز> <الكمية> بمتوسط <السعر>» أو «حلل <الرمز>» لتحليلها أولاً.");
    }
    lines.push("\nأقدر أكمل معاك في واحد من دول: أشرح أكبر خسارة، أقترح تنويع، أو أراجع سهم معين داخل المحفظة. تحب نبدأ بإيه؟");
    return lines.join("\n");
}

export function formatPortfolioRankingResponse(data: any, userMessage: string): string {
    if (data?.ok !== true || !Array.isArray(data?.positions)) {
        return "تعذر قراءة مراكز محفظتك حالياً، فلا أقدر أرتبها بصورة موثوقة. جرّب مرة أخرى.";
    }
    const allPositions = data.positions;
    const positions = allPositions
        .filter((position: any) => position?.profit_pct !== null && position?.profit_pct !== undefined
            && Number.isFinite(Number(position.profit_pct)));
    if (positions.length === 0) {
        return "لا أقدر أحدد أفضل سهم حالياً لأن متوسط شراء مركز أو أكثر غير مؤكد. ثبّت متوسط الشراء لكل مركز أولاً، ولن أخمّن ترتيباً من بيانات ناقصة.";
    }
    const asksWorst = /(?:اسوا|اسوء|اكبر\s+(?:خساره|خسارة)|الخاسر|اضعف)/i.test(normalizeArabicIntent(userMessage));
    const ranked = [...positions].sort((a: any, b: any) => asksWorst
        ? Number(a.profit_pct) - Number(b.profit_pct)
        : Number(b.profit_pct) - Number(a.profit_pct));
    const selected = ranked[0];
    const label = asksWorst ? "أضعف أداء غير محقق" : "أفضل أداء غير محقق";
    const lines = [
        `${label} بين المراكز القابلة للمقارنة في محفظتك حالياً: ${selected.symbol} (${Number(selected.profit_pct).toFixed(1)}%)، على أساس متوسط الشراء المسجل وآخر سعر متاح.`,
        `- ${selected.symbol}: ${selected.quantity ?? "غير متاح"} سهم، متوسط ${selected.entry_price ?? "غير متاح"} ج.م، آخر سعر ${selected.last_price ?? "غير متاح"} ج.م.`,
    ];
    if (ranked.length > 1) {
        lines.push("\nالترتيب المختصر:");
        ranked.slice(0, 5).forEach((position: any, index: number) => {
            lines.push(`${index + 1}. ${position.symbol}: ${Number(position.profit_pct).toFixed(1)}%`);
        });
    }
    if (positions.length < allPositions.length) lines.push(`لم أدخل ${allPositions.length - positions.length} مركز في الترتيب لغياب متوسط الشراء أو السعر.`);
    lines.push("\nالأرقام وصفية وليست توصية شراء أو بيع.");
    return lines.join("\n");
}

export function isMarketWideRequest(message: string): boolean {
    const normalized = message.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLowerCase();
    const marketTerms = [
        /اخبار\s+(السوق|البورصه)/i,
        /(?:السيول|السيوله)\s+(فين|في\s+السوق|ل?يوم|لبوم|بتاريخ|يوم)/i,
        /(?:اكبر|اعلى|اقوى)\s+قطاع.{0,20}(سيول|تداول)/i,
        /حاله\s+(السوق|البورصه)/i,
        /السوق\s+عمل/i,
        /اداء\s+(?:المؤشر|الموشر)/i,
        /(?:المؤشر|الموشر)\s+(?:النهارده|اليوم)/i,
        /(?:اقوى|اعلى|اكبر)\s*(?:\d{1,2}\s*)?(?:ال)?اسهم/i,
        /(?:افضل|ارخص|اقل|ادنى)\s*(?:\d{1,2}\s*)?(?:ال)?(?:اسهم|سهم)\b/i,
        /(?:ترتيب|قايمه|قائمه|قائمة)\s+(?:ال)?(?:اسهم|أسهم)/i,
        /(?:السهم|القطاع|الاسهم|القطاعات).{0,45}(?:متوقع|توقع|يرتفع|هيطلع|هيرتفع).{0,35}(?:الاسبوع|اسبوع|الايام الجايه|الفتره الجايه)/i,
        /(?:متوقع|توقع|يرتفع|هيطلع|هيرتفع).{0,45}(?:السهم|القطاع|الاسهم|القطاعات).{0,35}(?:الاسبوع|اسبوع|الايام الجايه|الفتره الجايه)/i,
        /(?:مين|ايه|اية).{0,25}(?:متوقع|توقع).{0,25}(?:يرتفع|هيطلع|يصعد).{0,25}(?:الاسبوع|اسبوع)/i,
        /(?:متوقع|توقع|يرتفع|هيطلع|هيرتفع|يصعد).{0,45}(?:الاسبوع|اسبوع|الايام الجايه|الفتره الجايه)/i,
        /افضل\s+الفرص\s+المتاحه/i,
        /(?:كل|جميع).{0,12}(?:اسهم|الاسهم).{0,12}(?:المؤشر|الموشر|موشر).{0,8}30/i,
        /(?:السيول|السيوله|سيوله).{0,30}(?:انهو|انهي|اي|أى|أي|فين|فين|قطاع|القطاعات)/i,
        /(?:انهو|انهي|اي|أى|أي|فين).{0,20}(?:قطاع|القطاعات).{0,20}(?:السيول|السيوله|سيوله)/i,
        /^\s*(?:و?ال)?(?:تجميع|تصريف)(?:\s+(?:فين|ايه|الاسهم|الأسهم|النهارده|اليوم))?[؟?\s]*$/i,
        /(?:توصي[اإ]?\s*ت|فرص\s*(?:شراء|دخول))\s*(?:الاسبوع|اسبوع|مفتوح|المفتوح|النهارده|اليوم|السوق|الحالي|الماضي|الفايت|اللي فات|اللى فات)/i,
        /(?:عايز|هات|اعرض|فين|ايه|اية|كل)\s+(?:كل\s+)?(?:ال)?توصي[اإ]?\s*ت/i,
        /^(?:كل\s+)?(?:ال)?توصي[اإ]?\s*ت\b/i
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
    recommendation_filter?: "open" | "this_week" | "last_week" | "all" | null;
} {
    if (isTermsDefinitionRequest(message)) {
        return { intent: "general_chat", tools: [], replaceTools: true };
    }
    const portfolioOperation = detectPortfolioIntent(message);
    if (portfolioOperation) {
        return { intent: "portfolio_management", tools: ["manage_portfolio"], replaceTools: true };
    }
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const hasExplicitSymbol = /\b[A-Za-z]{2,6}\b/.test(message);
    const isSingleStockRecFollowUp = Boolean(sessionState?.current_symbol) && /(?:^|[^\u0621-\u064A])(ده|دا|دي|هذا|السهم ده|السهم دا|السهم دي|هاته|هاتها|اخباره|أخباره|خبره|الاتنين|السهمين|عليه|فيه|ليه|عليها|فيها|ليها|عنه|عنها|به|بها|معاه|معاها|هو|هي)(?:$|[^\u0621-\u064A])/i.test(normalized) && /(?:توصي[اإ]?\s*ت|توصي[ةه])/i.test(normalized);
    const isFollowUpToCurrentStock = Boolean(sessionState?.current_symbol) && !isMarketWideRequest(message) && (
        isSingleStockRecFollowUp
        || /(?:^|[^\u0621-\u064A])(السهم|السهم ده|السهم دا|السهم دي|ده|دا|دي|هذا|هذه|فيه|فيها|عليه|عليها|عنه|عنها|معاه|معاها|هو|هي)(?:$|[^\u0621-\u064A])/i.test(normalized)
        || /(?:اشتريت|شاري|متوسط|مركزي|سعري|دخولي|خسار|خساير|خسران|كسبان|ارباح|أرباح|ابيع|أبيع|احتفظ|أحتفظ|اخرج|أخرج|اوقف|وقف)/i.test(normalized)
    );
    const effectiveSymbols = symbols.length > 0 ? symbols : (isFollowUpToCurrentStock && sessionState?.current_symbol ? [sessionState.current_symbol] : []);
    const hasSymbol = effectiveSymbols.length > 0 || hasExplicitSymbol;
    if (symbols.length === 0 && effectiveSymbols.length > 0) {
        symbols = effectiveSymbols;
    }
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
    const asksSectorLiquidity = /(?:السيول|السيوله|سيوله).{0,30}(?:انهو|انهي|اي\s+قطاع|أي\s+قطاع|قطاع|القطاعات)/i.test(normalized) || /(?:انهو|انهي|اي|أى|أي|فين).{0,20}(?:قطاع|القطاعات).{0,20}(?:السيول|السيوله|سيوله)/i.test(normalized) || /(?:انشط|أنشط|نشاط|حركة|حركه|سيولة|سيوله)\s+(?:قطاع|القطاعات)/i.test(normalized);
    let direction: "accumulation" | "distribution" | null = null;
    if (hasAcc && noDist) direction = "accumulation";
    else if (hasDist && noAcc) direction = "distribution";
    else if (hasAcc && !hasDist) direction = "accumulation";
    else if (hasDist && !hasAcc) direction = "distribution";
    else if (hasAcc && hasDist) {
        direction = "both" as any;
    }
    if (/شريع|sharia/i.test(normalized)) {
        if (hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
        return { intent: "general_chat", tools: [], replaceTools: true };
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
        const isHistoricalRec = /(?:قديم|أقدم|اقدم|سابق|سابق[ةه]|تاريخ|أرشيف|ارشيف|مغلق[ةه]|حققت|ضربت|نتائج|أداء|اداء|سجل)/i.test(normalized);
        const isRecFilterOpen = /(?:مفتوح[ةه]|open)/i.test(normalized);
        const isRecFilterThisWeek = /(?:[اأ]سبوع\s*(?:حالي|الحالي|الحالى|ده|هذا)|this\s*week)/i.test(normalized);
        const isRecFilterLastWeek = /(?:[اأ]سبوع\s*(?:الماضي|السابق|الفايت|اللي\s*فات|اللى\s*فات)|last\s*week)/i.test(normalized);
        const recFilter: "open" | "this_week" | "last_week" | "all" | null = isRecFilterLastWeek ? "last_week" : isRecFilterThisWeek ? "this_week" : isHistoricalRec ? "all" : "open";
        if (hasSymbol) {
            return {
                intent: "stock_analysis",
                tools: ["get_stock", "get_recommendations", "get_stock_levels"],
                replaceTools: true,
                recommendation_order: oldestRequest ? "oldest" : "newest",
                recommendation_filter: recFilter
            };
        }
        return {
            intent: oldestRequest ? "historical_recall" : "market_summary",
            tools: oldestRequest ? ["get_recommendations", "get_signals"] : ["get_recommendations", "get_accumulation_stocks"],
            replaceTools: true,
            recommendation_order: oldestRequest ? "oldest" : "newest",
            recommendation_filter: recFilter
        };
    }
    if (direction && !hasSymbol) {
        if ((direction as string) === "both" || (hasAcc && hasDist)) {
            return { intent: "accumulation_distribution", tools: ["get_accumulation_stocks", "get_distribution_stocks"], replaceTools: true, scan_direction: "both" as any };
        }
        return { intent: "accumulation_distribution", tools: [direction === "distribution" ? "get_distribution_stocks" : "get_accumulation_stocks"], replaceTools: true, scan_direction: direction };
    }
    if (hasSymbol && /(?:تجميع|تصريف|وايكوف|wyckoff)/i.test(normalized)) {
        if (/(?:على|عليه|عليها|للسهم|للسهمين|السهم).{0,20}(?:تجميع|تصريف|وايكوف|wyckoff)|(?:تجميع|تصريف|وايكوف|wyckoff).{0,20}(?:على|عليه|عليها|السهم)/i.test(normalized) && plannerIntent === "market_summary") {
            return { intent: "accumulation_distribution", tools: [hasDist && !hasAcc ? "get_distribution_stocks" : "get_accumulation_stocks"], replaceTools: true, scan_direction: hasDist && !hasAcc ? "distribution" : "accumulation" };
        }
        return { 
            intent: "stock_analysis", 
            tools: [hasDist && !hasAcc ? "get_distribution_stocks" : "get_accumulation_stocks"],
            replaceTools: true 
        };
    }
    if (plannerIntent === "technical_scan") return { intent: "technical_scan", tools: ["get_technical_scan"], replaceTools: true };
    const isRecommendationQuery = isBestBuyStockQuestion(message) || /(?:توصي[اإ]?\s*ت|توصي[ةه]|ترشح|ترشيحات|فرص\s*شراء|فرص\s*دخول|اسهم\s*ادخل\s*فيها|اسهم\s*اشتريها|اشتري\s*ايه|ادخل\s*في\s*ايه|ادخل\s*فيها|اسهم\s*ممتازة|اسهم\s*كويسة|تحقق\s*ارباح|تحقق\s*أرباح|توصيات\s*كويسة|توصيات\s*شراء|اسهم\s*للشراء|فرص\s*الشراء)/i.test(normalized);
    if (isRecommendationQuery) {
        const oldestRequest = /(اقدم|أقدم)/i.test(normalized);
        const isHistoricalRec = /(?:قديم|أقدم|اقدم|سابق|سابق[ةه]|تاريخ|أرشيف|ارشيف|مغلق[ةه]|حققت|ضربت|نتائج|أداء|اداء|سجل)/i.test(normalized);
        const isRecFilterOpen = /(?:مفتوح[ةه]|open)/i.test(normalized);
        const isRecFilterThisWeek = /(?:[اأ]سبوع\s*(?:حالي|الحالي|الحالى|ده|هذا)|this\s*week)/i.test(normalized);
        const isRecFilterLastWeek = /(?:[اأ]سبوع\s*(?:الماضي|السابق|الفايت|اللي\s*فات|اللى\s*فات)|last\s*week)/i.test(normalized);
        const recFilter: "open" | "this_week" | "last_week" | "all" | null = isRecFilterLastWeek ? "last_week" : isRecFilterThisWeek ? "this_week" : isHistoricalRec ? "all" : "open";
        if (hasSymbol) {
            return { intent: "stock_analysis", tools: ["get_stock", "get_recommendations", "get_stock_levels"], replaceTools: true, recommendation_filter: recFilter };
        }
        return { intent: "market_summary", tools: ["get_recommendations", "get_accumulation_stocks"], replaceTools: true, recommendation_filter: recFilter };
    }
    if (/(?:سبب|اسباب|لماذا|ليه\s+(?:نزل|طلع|هبط|صعد|وقع|طالع|نازل|بيخسر|بيهبط|بينزل|خسران|بيصعد)|ايه\s+سبب)/i.test(normalized) && hasSymbol) return { intent: "stock_news", tools: ["get_stock", "get_news", "get_stock_levels"], replaceTools: true };
    const isMultiStockLiquidityComparison = /(?:سيول|تداول|liquidity)/i.test(normalized)
        && (/(?:مقارن|قارن|compare|بين|أيهما|ايهما|مين|الاتنين|السهمين|افضل|أفضل)/i.test(normalized) || symbols.length >= 2);
    if (isMultiStockLiquidityComparison) {
        const compareTargetSymbols = symbols.length >= 2
            ? symbols
            : (sessionState?.last_symbols && sessionState.last_symbols.length >= 2 ? sessionState.last_symbols.slice(0, 2) : []);
        if (compareTargetSymbols.length >= 2) {
            return {
                intent: "comparison",
                tools: ["get_comparison"],
                replaceTools: true,
                entities: { symbols: compareTargetSymbols, wants_table: true }
            } as any;
        }
    }
    if (/(مقاوم|مقوام|دعم|support|resistance)/i.test(normalized) && hasSymbol && !/حلل.{0,30}(اخبار|أخبار)/i.test(normalized)) return { intent: "levels_analysis", tools: ["get_stock_levels"], replaceTools: true };
    if (/(سيول|السيوله)/i.test(normalized) && hasSymbol && symbols.length <= 1) return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
    if (hasSymbol && /(حلل|تحليل|توقع|اتجاه|اتجاة|لو\s+كسر|اعمل\s+ايه|أعمل\s+إيه)/i.test(normalized)) {
        const compoundAnalysis = /حلل.{0,20}(هات|اخبار|أخبار)|هات.{0,20}(اخبار|أخبار)|لو\s+كسر.{0,20}(اخبار|أخبار)/i.test(normalized);
        return { intent: "stock_analysis", tools: compoundAnalysis ? ["get_stock", "get_stock_levels", "get_news"] : ["get_stock", "get_stock_levels"], replaceTools: true };
    }
    // Corporate-action questions (اكتتاب/توزيعات/تجزئة/منحة/كوبون...) route to
    // news + corporate actions so the answer is grounded in real events.
    if (/(?:اكتتاب|توزيعات|توزيع\s*ارباح|كوبون|تجزئ[ةه]|منح[ةه]|سهم\s*مجاني|زياد[ةه]\s*ر[أا]س\s*المال|تخفيض\s*(?:ر[أا]س|القيم[ةه])|اعاد[ةه]\s*شراء|dividend|coupon|rights?\s+issue|stock\s+split|bonus\s+shares?)/i.test(normalized) && hasSymbol) {
        return { intent: "stock_news", tools: ["get_news", "get_corporate_actions"], replaceTools: true };
    }
    if (/(?:اخبار|أخبار|(?:^|\s)خبر(?:\s|$)|news)/i.test(normalized) && hasSymbol) return { intent: "stock_news", tools: ["get_news"], replaceTools: true };

    if (/(مقارن|قارن|compare)/i.test(normalized)) {
        const targetSyms = symbols.length >= 2
            ? symbols
            : (sessionState?.last_symbols && sessionState.last_symbols.length >= 2 ? sessionState.last_symbols.slice(0, 2) : []);
        if (targetSyms.length >= 2) {
            return { intent: "comparison", tools: ["get_comparison"], replaceTools: true, entities: { symbols: targetSyms, wants_table: true } } as any;
        }
    }
    if (/(يخسر|خسار|يهبط|ينزل|يطلع|صعود|هبوط)/i.test(normalized) && hasSymbol) return { intent: "risk_analysis", tools: ["get_stock", "get_stock_levels", "get_distribution_stocks"], replaceTools: true, scan_direction: "distribution" };
    if (/(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(normalized) && hasSymbol) return { intent: "levels_analysis", tools: ["get_stock_levels"], replaceTools: true };
    if (/(ابيع|بيع|احتفظ|اخرج|اشتري|شراء)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    if (/(ينصح|داخل|دخول|مستهدف|يصحح|تصحيح|بكره|بكرة|اخر الاسبوع|المحفظه|مليون)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    if (symbols.length >= 2 && hasSymbol && !/(اخبار|خبر|قارن|مقارن|قطاع|تجميع|تصريف|سيول|تداول|liquidity)/i.test(normalized)) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    const marketListHintEnforce = /(?:اعلي|أعلى|اقوي|اقوى|افضل|أفضل|اقل|أقل|ارخص|أرخص|ادنى|أدنى|ترتيب|مرتب|قايمه|قائمه|قائمة|top)/i.test(normalized)
        || /(?:^|[\s،,])\d{1,2}\s*(?:سهم|سمهم|أسهم|اسهم)/i.test(normalized);
    const isPeriodRanking = !hasSymbol && marketListHintEnforce && (/(?:من\s+(?:اول|أول|بداية|بدايه)\s+(?:السنه|السنة|الشهر|الاسبوع|اسبوع)|من\s+يناير|خلال\s+(?:العام|الشهر|الاسبوع)|منذ\s+بداية\s+(?:العام|الشهر|الاسبوع)|ytd|mtd|wtd|الشهر\s+ده|الشهر\s+دا|الشهر\s+الحالي|هذا\s+الشهر|الاسبوع\s+ده|الاسبوع\s+دا|الاسبوع\s+الحالي|هذا\s+الاسبوع|هذا\s+العام|ف[يى]\s+(?:الاسبوع|الشهر|العام|السنه)|(?:الاسبوع|الشهر|العام|السنه)\s+(?:الماضي|الاخير|الفايت|الفائت))/i.test(normalized)
        || /(?:اعلي|أعلى|افضل|أفضل|اقل|أقل|ارخص|أرخص|ادنى|أدنى|بافضل|بأفضل|بافل|بأفل|بأعلى|باعلى|قايمه|قائمة|ترتيب).{0,35}(?:ارباح|أرباح|ارتفاع|صعود|اداء|أداء|عائد|سيول|تداول|حجم|ربح).{0,35}(?:اول|أول|بداية|بدايه|خلال|منذ).{0,20}(?:السنه|السنة|الشهر|الاسبوع|يناير|ytd|mtd|wtd)/i.test(normalized));
    const isExplicitMtdSecond = !hasSymbol && /(?:العائد|عائد|عوائد|أداء|اداء|ارباح|أرباح).{0,20}(?:الشهري|الشهر|خلال\s+الشهر|في\s+الشهر|الشهر\s+ده|هذا\s+الشهر)/i.test(normalized);
    if (isPeriodRanking || isExplicitMtdSecond) {
        return { intent: "market_summary", tools: ["get_price_history"], replaceTools: true };
    }
    if (/(اكبر|اعلى|اقوى)\s+قطاع.{0,25}(سيول|تداول)|(?:(?:ال)?سيول(?:ه)?).{0,30}(قطاع|القطاعات)|قطاع.{0,30}(?:(?:ال)?سيول(?:ه)?|تداول)/i.test(normalized)) {
        const sector = extractSectorFromMessage(normalized);
        return sector ? { intent: "sector_analysis", tools: ["get_sector_liquidity"], replaceTools: true, sector } : { intent: "market_summary", tools: ["get_sector_liquidity"], replaceTools: true };
    }
    if (/(?:عدد|كام|كم|قائمه|قايمه|قائمة|هات|جيب|اعرض).{0,20}(?:القطاعات|قطاعات)/i.test(normalized)) return { intent: "sector_analysis", tools: ["get_sector_list"], replaceTools: true };
    if (/(?:ارخص|أرخص)\s*(?:\d{1,2})?\s*(?:ال)?(?:اسهم|الاسهم|أسهم|الأسهم|سهم)/i.test(normalized) && !hasSymbol && !/(?:ارتفاع|صعود|عائد|اداء|أداء|سيول|تداول|خسار|انخفاض|هابط)/i.test(normalized)) return { intent: "market_summary", tools: ["get_price_history"], replaceTools: true };
    if (/(?:(?:أ|ا)عل[ىي]|(?:أ|ا)قو[ىي]).{0,25}(الاسهم|الأسهم|ارتفاع|صعود|اليوم|النهارده|اخر يوم|آخر يوم)/i.test(normalized)) return { intent: "market_summary", tools: ["get_market"], replaceTools: true };
    if (/(حاله|حالة).{0,12}(السوق|البورصه|البورصة)|(?:السوق|البورصه|البورصة).{0,12}(النهارده|اليوم|عامل|حاله|حالة)/i.test(normalized)) return { intent: "market_summary", tools: ["get_market"], replaceTools: true };
    if (/(اداء|أداء|رايك|رأيك).{0,15}(المؤشر|موشر|egx30)|(?:المؤشر|موشر).{0,15}(النهارده|اليوم|عامل)/i.test(normalized)) return { intent: "market_summary", tools: ["get_market"], replaceTools: true };
    if (/(سيول|تداول|liquidity)/i.test(normalized) && hasSymbol && symbols.length <= 1) return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
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
    const sector = extractSectorFromMessage(normalized);
    if (sector && /(اخبار|خبر|news)/i.test(normalized)) return { intent: "sector_analysis", tools: ["get_sector", "get_news"], replaceTools: true, sector };
    if (sector && !hasSymbol) return { intent: "sector_analysis", tools: ["get_sector"], replaceTools: true, sector };
    if (plannerIntent === "technical_scan") return { intent: "technical_scan", tools: ["get_technical_scan"], replaceTools: true };
    if (plannerIntent === "stock_analysis" && hasSymbol) {
        const isAccOrDist = /(?:تجميع|تصريف|وايكوف|wyckoff)/i.test(normalized);
        return { 
            intent: "stock_analysis", 
            tools: isAccOrDist ? ["get_stock", "get_stock_levels", "get_accumulation_stocks"] : ["get_stock", "get_stock_levels"], 
            replaceTools: true 
        };
    }
    return { intent: plannerIntent, tools: [] };
}

export function extractSectorFromMessage(message: string): string | null {
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
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
    if (/(finance|financial|مالي|تمويل|(?:قطاع\s+)?الاستثمار\s*(?:المالي|فى البورصه|في البورصة)?|شركات?\s+الاستثمار|شركات?\s+استثمار|اسهم\s+الاستثمار|أسهم\s+الاستثمار|اسهم\s+استثمار|أسهم\s+استثمار|صناديق\s+الاستثمار|بنوك?\s+استثمار)/i.test(normalized)) return "Finance";
    return null;
}

export function needsLiveDataForTools(tools: string[]): boolean {
    const liveTools = new Set([
        "get_stock", "get_market", "get_indices", "get_news",
        "get_recommendations", "get_signals", "get_sector",
        "get_accumulation_stocks", "get_distribution_stocks", "get_technical_scan", "get_sector_liquidity", "get_sector_list", "get_stock_levels", "get_comparison", "get_fair_value_scan", "get_price_history", "search_web", "get_corporate_actions"
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

export interface PipelineOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    mockToolsResults?: StructuredToolOutput;
    /** Test seam for exercising downstream intent resolution without a planner service. */
    mockPlannerResult?: PlannerResult;
    /** Offline vision fixture for regression tests; production always analyzes the image. */
    mockVisionResult?: VisionContext;
    /** User subscription tier: true for Pro, false for Free. */
    isPro?: boolean;
}

export async function* runPipelineStream(
    userMessage: string, images: string[], sessionState: SessionState,
    sessionSummary: SessionSummary | null, history: Array<{ role: string; content: string }>,
    supabase: any, apiKeys: string[], userId: string, sessionId: string, messageId: string,
    requestedModel?: string, options: PipelineOptions = {},
): AsyncGenerator<{ type: string; data: any }> {
    const scope = createExecutionScope(options.timeoutMs ?? AI_CONFIG.limits.requestDeadlineMs, options.signal);
    const core = runPipelineCore(userMessage, images, sessionState, sessionSummary, history,
        executionSupabase(supabase), apiKeys, userId, sessionId, messageId, requestedModel, options);
    let publicationPlan: IntentPlan | null = null;
    let publicationTools: StructuredToolOutput | null = null;
    let publicationVision: VisionContext | null = null;
    const publicationGateInput = (reply: string) => ({ reply,
        plan: publicationPlan || { intent: "general_chat", confidence: 1,
            entities: { symbols: [], sector: null, timeframe: "unspecified", reference: null }, tools: [],
            clarification_needed: false, needs_vision_context: Boolean(publicationVision), needs_history: false,
            needs_live_data: false, needs_historical_data: false, resolved_from: { symbol: null, message_id: null } } as IntentPlan,
        toolResults: publicationTools?.results || [], userMessage, history, vision: publicationVision,
        facts: buildFactRecords(publicationTools?.results || []) });
    try {
        while (true) {
            const next = await scope.run(() => awaitExecution(core.next()));
            if (next.done) return;
            if (next.value.type === "plan") publicationPlan = next.value.data;
            if (next.value.type === "tools_data") publicationTools = next.value.data;
            if (next.value.type === "vision_result") publicationVision = next.value.data;
            // Publish only the canonical, validated response. A persistence error
            // or interrupted provider must never append an error to partial text.
            if (next.value.type === "token") continue;
            if (next.value.type === "done") {
                publicationPlan ||= { intent: "general_chat", confidence: 1,
                    entities: { symbols: [], sector: null, timeframe: "unspecified", reference: null }, tools: [],
                    clarification_needed: false, needs_vision_context: Boolean(publicationVision), needs_history: false, needs_live_data: false,
                    needs_historical_data: false, resolved_from: { symbol: null, message_id: null } };
                publicationTools ||= { results: [], formattedText: "" };
                if (publicationVision) publicationTools = { ...publicationTools, results: [...publicationTools.results,
                    { tool: "image_context", source: "user_image", data_time: publicationVision.analyzed_at,
                        data_type: "image-derived", symbols: publicationVision.symbols.map(s => s.symbol), data: publicationVision }] };
                {
                    const gateInput = publicationGateInput(String(next.value.data.response || ""));
                    const isDeterministicPortfolio = typeof next.value.data.response === "string" && next.value.data.response.includes("تقرير التحليل الفني الشامل وإدارة مخاطر المحفظة");
                    const gate = isDeterministicPortfolio ? { ok: true, reasons: [] } : runAnswerGate(gateInput);
                    let finalPassed = gate.ok;
                    if (!gate.ok) {
                        let repaired = (publicationVision ? null : buildDeterministicResponse(userMessage, publicationPlan, publicationTools.results, sessionState))
                            || safeEvidenceResponse(userMessage, publicationTools.results, publicationPlan);
                        next.value.data.response_origin = "fallback";
                        // Deterministic shortcuts also get a contextual LLM repair,
                        // preserving other parts of compound requests when possible.
                        if ((apiKeys.length || getDeepSeekApiKey()) && remainingExecutionMs() > 12000) {
                            try {
                                const candidate = await scope.run(() => generateV2Response(userMessage, publicationPlan!, publicationVision,
                                    publicationTools!.results, [], history,
                                    { symbol: sessionState.current_symbol, message_id: null, confidence: 1 },
                                    apiKeys, requestedModel, sessionState,
                                    `${buildGateCorrectionBlock(gate.reasons)}\nالرد السابق:\n${gateInput.reply}\nحافظ على جميع أجزاء طلب المستخدم مع تصحيح المخالفات.`));
                                if (runAnswerGate({ ...gateInput, reply: candidate }).ok) {
                                    repaired = candidate;
                                    next.value.data.response_origin = "llm";
                                }
                            } catch { /* A provider failure must not publish the rejected candidate. */ }
                        }
                        const repairedGate = runAnswerGate({ ...gateInput, reply: repaired });
                        finalPassed = repairedGate.ok;
                        next.value.data.response = repairedGate.ok ? repaired : "تعذر التحقق من إجابة متسقة مع سؤالك والبيانات المتاحة. أعد المحاولة لاستكمال التحقق.";
                        next.value.data.degraded = true;
                    }
                    next.value.data.publication_review = { passed: gate.ok, repaired: !gate.ok, final_passed: finalPassed, reasons: gate.reasons };
                    next.value.data.response_origin ||= "deterministic";
                    next.value.data.response_task = publicationPlan.response_task || null;
                }
                yield { type: "token", data: next.value.data.response };
                yield next.value;
                return;
            }
            yield next.value;
        }
    } catch (error) {
        if (options.signal?.aborted) return;
        const response = "تعذر إكمال التحليل في الوقت المتاح. جرّب إعادة السؤال؛ لم أعرض رداً جزئياً أو أستبدل سؤالك ببيانات سهم سابق.";
        // Failure responses carry the same review record. Missing requested data
        // can fail coverage here; do not claim an analysis passed when it timed out.
        const failureGate = runAnswerGate(publicationGateInput(response));
        yield { type: "token", data: response };
        yield { type: "done", data: { response, degraded: true, response_origin: "fallback",
            response_task: publicationPlan?.response_task || null,
            publication_review: { passed: failureGate.ok, repaired: false, final_passed: failureGate.ok, reasons: failureGate.reasons },
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: sessionState.summary },
            tables: [] } };
    } finally {
        scope.dispose();
        // Do not wait forever for a non-cooperative third-party promise.
        void core.return(undefined).catch(() => {});
    }
}

async function* runPipelineCore(
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
    options: PipelineOptions = {},
): AsyncGenerator<{ type: string; data: any }> {
    const deadlineAt = Date.now() + Math.min(AI_CONFIG.limits.requestDeadlineMs, remainingExecutionMs());
    const pipelineStart = Date.now();
    const ensureBudget = (reserveMs = 0) => {
        if (Date.now() + reserveMs >= deadlineAt) throw new Error("PIPELINE_DEADLINE_EXCEEDED");
    };
    const hasImages = images.length > 0;
    let vision: VisionContext | null = null;
    let visionError: string | null = null;
    let memory: MemoryResult | null = null;

    let userIsPro = options.isPro ?? false;
    if (options.isPro === undefined && userId && supabase) {
        try {
            const { isPro: gateIsPro } = await import("./plan-gate");
            const { data: planRows } = await supabase
                .from("subscriptions")
                .select("plan_id,status,current_period_end")
                .eq("user_id", userId)
                .limit(10);
            userIsPro = gateIsPro(planRows || []);
        } catch {
            userIsPro = false;
        }
    }

    // A market category is not the similarly named NIPH stock. Preserve the
    // category across short follow-ups instead of letting an old stock alias
    // turn a market question into a single-company analysis.
    if (!hasImages && isNileExchangeQuestion(userMessage, history)) {
        const normUserMsg = normalizeArabicIntent(userMessage);
        const asksForPicks = /(احسن|افضل|رشح|اشتري|اقوي|رتب|مين|اللي\s+فيه)/i.test(normUserMsg);
        const asksForDiff = /(الفرق|فرق|شرح|ايه الفرق|إيه الفرق|ماهو|ما هو|إيه هية|ايه هية|معلومات|عن بورصة النيل|ما هي)/i.test(normUserMsg);
        const response = asksForPicks
            ? "تقصد بورصة النيل للشركات الصغيرة والمتوسطة. لا تتوفر لدي حالياً قائمة تداول موثقة ومحدثة لأسهمها كلها لترتيب الأفضل فيها، لذلك لا أقدر أرشح سهماً منها بثقة. لو عندك رمز شركة محددة فيها، ابعته وأحلل بياناتها المتاحة."
            : asksForDiff
            ? "البورصة المصرية تنقسم إلى السوق الرئيسي وبورصة النيل (سوق الشركات الصغيرة والمتوسطة):\n\n1. **السوق الرئيسي (Main Market):** مخصص للشركات الكبيرة والمتوسطة ذات رؤوس الأموال الضخمة، وتطبق عليه شروط إفصاح وحوكمة صارمة، وحجم التداول والسيولة فيه مرتفعان.\n2. **بورصة النيل (Nile Exchange - NILEX):** مخصص للشركات الناشئة والصغيرة والمتوسطة ذات متطلبات إدراج ورأس مال أقل، وتكون نسبة التذبذب والسيولة فيه مختلفة ومخاطر الاستثمار في أسهمه أعلى لقلة التداول وإفصاحاتها المحدودة.\n\nإذا كان لديك رمز شركة محددة في أي من السوقين تريد تحليل بياناتها الفنية (مثل NIPH)، يسعدني مساعدتك!"
            : "بورصة النيل سوق للشركات الصغيرة والمتوسطة. تقصد شرح السوق ومخاطره، ولا مقارنة أسهم معينة مدرجة فيه؟ لو عندك رموز أسهم محددة ابعتها لي.";
        await updateSessionState(supabase, sessionId, userId, { current_symbol: null, last_symbols: [], summary: userMessage, current_sector: null });
        await updateSessionSummary(supabase, sessionId, userId, { current_symbols: [], last_topic: "nile_exchange", last_reference_symbol: null, last_reference_source: null, last_reference_at: null });
        yield { type: "done", data: { response, session_update: { current_symbol: null, last_symbols: [], summary: userMessage }, tables: [] } };
        return;
    }
    const priorSymbols = Array.from(new Set((sessionState.last_symbols || []).map(symbol => String(symbol).toUpperCase())));
    const lastAssistant = [...history].reverse().find(turn => turn.role === "assistant")?.content || "";
    if (!hasImages && shouldClarifySingularGroupReference(userMessage, priorSymbols, lastAssistant, sessionState.current_symbol)) {
        const response = `تقصد أنهي سهم من اللي اتكلمنا عنهم: ${priorSymbols.slice(0, 6).join("، ")}؟ اكتب رمزه عشان ما أنسبش التحليل لسهم غلط.`;
        yield { type: "done", data: { response, session_update: { current_symbol: null, last_symbols: priorSymbols, summary: userMessage }, tables: [] } };
        return;
    }

    // Continue a confirmed screenshot import conversationally. The previous
    // implementation persisted this state but never consumed the next answer,
    // so the user could provide the missing quantity/average price without the
    // position ever being written.
    const pendingImport = sessionSummary?.pending_portfolio_import;
    const analyzeSavedPortfolio = isPortfolioAnalysisRequest(userMessage) && /المحفوظ/i.test(normalizeArabicIntent(userMessage));
    const pendingImportAnalysis = isPortfolioAnalysisRequest(userMessage);
    const cancelsPendingImport = /(?:^|\s)(?:الغاء|إلغاء|الغي|ألغي|مش عايز|سيبها|cancel)(?:$|\s)/i.test(userMessage.trim());
    const answersPendingImport = /[0-9٠-٩]/.test(userMessage)
        && !/(?:اخبار|أخبار|حلل|تحليل|ليه|لماذا|ازاي|إزاي|هل|؟|\?)/i.test(userMessage)
        && !/(?:السعر\s+الحالي|آخر\s+سعر|سعر\s+حالي)/i.test(userMessage);
    if (!hasImages && pendingImport?.items?.length && !analyzeSavedPortfolio
        && (pendingImportAnalysis || cancelsPendingImport || answersPendingImport)) {
        if (cancelsPendingImport) {
            await updateSessionSummary(supabase, sessionId, userId, {
                pending_portfolio_import: null,
                last_topic: "portfolio",
            });
            const response = "تم إلغاء استيراد صورة المحفظة، ولم أغيّر مراكزك الحالية.";
            yield { type: "done", data: {
                response,
                session_update: { current_symbol: null, last_symbols: sessionState.last_symbols, summary: response },
                tables: [],
            } };
            return;
        }
        const index = Math.min(Math.max(pendingImport.current_index || 0, 0), pendingImport.items.length - 1);
        // If the user includes a ticker, apply the answer to that ticker—not
        // blindly to the item the conversation happened to ask about. This
        // prevents values for LUTS/KWIN (or any two adjacent holdings) from
        // being shifted between positions.
        const answerSymbols = extractExplicitSymbols(userMessage).map(symbol => String(symbol).toUpperCase());
        const matchingIndexes = answerSymbols
            .map(symbol => pendingImport.items.findIndex(item => String(item.symbol).toUpperCase() === symbol))
            .filter(itemIndex => itemIndex >= 0);
        if (answerSymbols.length > 0 && matchingIndexes.length !== 1) {
            const expected = pendingImport.items[index].symbol;
            const response = matchingIndexes.length > 1
                ? "اكتب بيانات سهم واحد فقط في كل رسالة عشان ما يحصلش خلط بين الكميات والمتوسطات."
                : `الرمز المكتوب مش ضمن الأسهم المنتظرة في الصورة. أنا منتظر بيانات ${expected}: اكتب مثلاً «${expected} 200 سهم بمتوسط 45.65».`;
            yield { type: "done", data: {
                response,
                session_update: { current_symbol: expected, last_symbols: pendingImport.items.map(item => item.symbol), summary: response },
                tables: [],
            } };
            return;
        }
        // A new analysis request is not a quantity/average-price answer. The
        // screenshot is still unsaved, so do not analyse an older holding (or
        // the previously discussed ticker) as if it came from that screenshot.
        if (pendingImportAnalysis) {
            const missing = pendingImport.items.find(item => item.quantity == null || item.quantity <= 0 || item.price == null || item.price <= 0);
            const response = missing
                ? `الصورة لسه ما اتسجلتش كمحفظة؛ بيانات ${missing.symbol} ناقصة. ${portfolioMissingQuestion(missing)} لو تقصد محفظتك المحفوظة قبل الصورة، اكتب «حلل المحفظة المحفوظة».`
                : "الصورة لسه ما اتسجلتش كمحفظة. أكمل تأكيد بياناتها أولاً، أو اكتب «حلل المحفظة المحفوظة».";
            yield { type: "done", data: {
                response,
                session_update: { current_symbol: missing?.symbol || null, last_symbols: pendingImport.items.map(item => item.symbol), summary: response },
                tables: [],
            } };
            return;
        }
        const answerIndex = matchingIndexes.length === 1 ? matchingIndexes[0] : index;
        const updatedItem = parsePortfolioAnswer(userMessage, pendingImport.items[answerIndex]);
        const items = pendingImport.items.map((item, itemIndex) => itemIndex === answerIndex ? updatedItem : item);
        const nextMissingIndex = items.findIndex(item =>
            item.quantity == null || item.quantity <= 0 || item.price == null || item.price <= 0
        );

        if (nextMissingIndex >= 0) {
            const nextItem = items[nextMissingIndex];
            const saved = await updateSessionSummary(supabase, sessionId, userId, {
                pending_portfolio_import: { items, current_index: nextMissingIndex },
                last_topic: "portfolio_import_pending",
            });
            const response = saved
                ? portfolioMissingQuestion(nextItem)
                : "فهمت البيانات، لكن تعذر حفظ حالة الاستيراد. اكتب الرمز والكمية ومتوسط الشراء معاً مرة أخرى.";
            yield { type: "done", data: {
                response,
                session_update: { current_symbol: nextItem.symbol, last_symbols: items.map(item => item.symbol), summary: response },
                tables: [],
            } };
            return;
        }

        const imported = await replacePortfolioFromImage(supabase, userId, items);
        if (imported.ok) yield { type: "tools_data", data: { results: [{ tool: "manage_portfolio", source: "positions",
            data_time: new Date().toISOString(), data_type: "cached", symbols: items.map(item => item.symbol),
            data: { ...imported, operation: "import", persisted: true } }], formattedText: imported.message } };
        if (!imported.ok) {
            yield { type: "done", data: {
                response: imported.message,
                session_update: { current_symbol: null, last_symbols: items.map(item => item.symbol), summary: imported.message },
                tables: [],
            } };
            return;
        }
        await updateSessionSummary(supabase, sessionId, userId, {
            pending_portfolio_import: null,
            // "portfolio_imported" (not "portfolio") so a later bare "ايوه"
            // in another context cannot silently re-run the import; an
            // explicit "دى محفظتى" still works via the vision-context path.
            last_topic: "portfolio_imported",
            current_symbols: items.map(item => item.symbol),
        });
        yield { type: "done", data: {
            response: `${imported.message}\n\nسجلت الكميات ومتوسطات الشراء من البيانات التي أكّدتها. تقدر تقول «حلل محفظتي» عشان أراجع كل مركز بالأرقام الحالية.`,
            session_update: { current_symbol: null, last_symbols: items.map(item => item.symbol), summary: imported.message },
            tables: [],
        } };
        return;
    }

    // A confirmation after a portfolio screenshot is an import confirmation,
    // not a request to view the existing (possibly empty) portfolio. The
    // classic path is last_topic === "portfolio" (image was identified as a
    // portfolio). A follow-up like "دى محفظتى" after ANY analyzed image with
    // symbols must also start the import — day-14 live chat showed the user
    // confirming a table-classified screenshot and getting "محفظتك فاضية".
    const visionContextSymbols = sessionSummary?.last_vision_context?.symbols || [];
    const portfolioSelectionCount = parsePortfolioSelectionCount(userMessage);
    const selectedPortfolioImport = visionContextSymbols.length > 0
        && portfolioSelectionCount !== null
        && sessionSummary?.last_topic === "portfolio";
    const explicitPortfolioConfirmation = visionContextSymbols.length > 0
        && /(محفظ|بتاعتي)/i.test(normalizeArabicIntent(userMessage));
    if (!hasImages && (sessionSummary?.last_topic === "portfolio" || explicitPortfolioConfirmation || selectedPortfolioImport)) {
        const confirmation = selectedPortfolioImport ? true : detectPortfolioConfirmation(userMessage);
        if (confirmation === false) {
            // "لأ مش بتاعتي" — clear the stale image context so a later bare
            // "ايوه" cannot resurrect an import the user rejected.
            await updateSessionSummary(supabase, sessionId, userId, {
                last_vision_context: null,
                last_image_symbols: [],
                last_topic: null,
            });
        }
        if (confirmation === true) {
            const visionItems = selectedPortfolioImport
                ? visionContextSymbols.slice(0, portfolioSelectionCount as number)
                : visionContextSymbols;
            const items = visionItems.map(item => ({
                symbol: item.symbol,
                name: item.name,
                quantity: item.visible_values.quantity,
                price: item.visible_values.price,
            }));
            // Reject a plan-limit breach up-front instead of asking the user
            // for every missing quantity/price and failing at the final save.
            const capacity = await checkPortfolioImportCapacity(supabase, userId, items.map(item => item.symbol));
            if (!capacity.ok) {
                await updateSessionSummary(supabase, sessionId, userId, {
                    pending_portfolio_import: null,
                    last_topic: "portfolio",
                });
                yield { type: "done", data: {
                    response: capacity.message,
                    session_update: { current_symbol: null, last_symbols: items.map(item => item.symbol), summary: capacity.message },
                    tables: [],
                } };
                return;
            }
            const missing = items.find(item => item.quantity == null || item.quantity <= 0 || item.price == null || item.price <= 0);
            if (missing) {
                await updateSessionSummary(supabase, sessionId, userId, {
                    pending_portfolio_import: null,
                    last_topic: "portfolio",
                });
                const response = `تمام يا غالي. بما أن لقطة الشاشة لا توضح جميع الكميات ومتوسطات الشراء بدقة لكل سهم، يمكنك التوجه إلى [صفحة المحفظة في حسابك](https://egxbots.com/profile#portfolio) وتسجيل جميع أسهمك وكمياتك دفعة واحدة وبضغطة زر لحفظها وتتبع أرباحك وخسائرك تلقائياً بدقة.\n\nهل تود أن نراجع الآن أي سهم محدد من أسهمك الفنية (الدعوم والمقاومات وفرص التعويض)؟`;
                yield { type: "done", data: {
                    response,
                    session_update: { current_symbol: null, last_symbols: items.map(item => item.symbol), summary: "توجيه المستخدم لصفحة البروفايل لتسجيل المحفظة" },
                    tables: [],
                } };
                return;
            }
            const imported = await replacePortfolioFromImage(supabase, userId, items);
            if (imported.ok) yield { type: "tools_data", data: { results: [{ tool: "manage_portfolio", source: "positions",
                data_time: new Date().toISOString(), data_type: "cached", symbols: items.map(item => item.symbol),
                data: { ...imported, operation: "import", persisted: true } }], formattedText: imported.message } };
            if (!imported.ok) {
                yield { type: "vision_error", data: "portfolio_import_failed" };
                yield { type: "done", data: {
                    response: `${imported.message}\n\nلم أمسح حالة المحفظة المعلقة، ويمكنك إعادة المحاولة بعد تصحيح البيانات.`,
                    session_update: { current_symbol: null, last_symbols: items.map(item => item.symbol), summary: "فشل حفظ محفظة الصورة" },
                    tables: [],
                } };
                return;
            }
            const summarySaved = await updateSessionSummary(supabase, sessionId, userId, {
                pending_portfolio_import: null,
                last_topic: "portfolio_imported",
            });
            if (!summarySaved) {
                yield { type: "vision_error", data: "portfolio_import_context_not_cleared" };
                yield { type: "done", data: {
                    response: `${imported.message}\n\nتم حفظ المحفظة، لكن تعذر تحديث حالة الجلسة. لن أعتبر الاستيراد مكتملًا في الرسائل التالية حتى يتم تحديث الجلسة.`,
                    session_update: { current_symbol: null, last_symbols: items.map(item => item.symbol), summary: imported.message },
                    tables: [],
                } };
                return;
            }
            yield { type: "done", data: {
                response: imported.message,
                session_update: { current_symbol: null, last_symbols: items.map(item => item.symbol), summary: imported.message },
                tables: [],
            } };
            return;
        }
    }

    // Fast path: portfolio CRUD is deterministic and must not pay the cost of
    // stock-name warming, memory retrieval, planner LLM work, or final LLM
    // generation. This is also the path that keeps Vercel Fluid CPU low for
    // the most common portfolio requests.
    let portfolioAnalysisSymbols: string[] = [];
    if (!hasImages) {
        let directPortfolioOperation = detectPortfolioIntent(userMessage);
        let effectivePortfolioMessage = userMessage;
        // Conversational completion: the bot previously asked for the symbol
        // (or the quantity/price of a known symbol) and the user's short reply
        // should complete that operation. Day-14 live chat: "ضيفه معانا السهم
        // ده" → "قولي رمز السهم" → "ادون وثيقة" must ADD KASABF, not run a
        // fresh analysis. Any explicit new portfolio command or a long/analytic
        // reply cancels the pending state instead.
        const awaitingPortfolioInput = sessionSummary?.portfolio_add_awaiting;
        if (!directPortfolioOperation && awaitingPortfolioInput) {
            const isBarePortfolioReply = userMessage.trim().split(/\s+/).length <= 5
                && !/[؟?]/.test(userMessage)
                && !/(حلل|تحليل|اخبار|أخبار|رايك|رأيك|مقارن|قارن|اعرض|وريني|توصي|توقع|فين|كام|كم |علاقه|علاقة)/i.test(userMessage);
            const replySymbols = isBarePortfolioReply ? extractExplicitSymbols(userMessage) : [];
            const opVerbs: Record<string, string> = { add: "ضيف", update: "عدل", remove: "شيل", sell: "بعت" };
            const opVerb = opVerbs[awaitingPortfolioInput.operation] || "ضيف";
            if (awaitingPortfolioInput.symbol && isBarePortfolioReply) {
                // Quantity/price reply for the remembered symbol. A bare number
                // is the quantity the bot just asked for.
                const bareNumber = /^[\d\s.,]+$/.test(userMessage.trim());
                effectivePortfolioMessage = `${opVerb} سهم ${awaitingPortfolioInput.symbol} ${userMessage.trim()}${bareNumber ? " سهم" : ""} في محفظتي`;
                directPortfolioOperation = awaitingPortfolioInput.operation;
            } else if (replySymbols.length > 0) {
                effectivePortfolioMessage = `${opVerb} ${userMessage.trim()} في محفظتي`;
                directPortfolioOperation = awaitingPortfolioInput.operation;
            } else {
                await updateSessionSummary(supabase, sessionId, userId, { portfolio_add_awaiting: null });
            }
        }
        const recentPortfolioTurn = history.slice(-2).some(turn =>
            (turn.role === "user" && Boolean(detectPortfolioIntent(turn.content)))
            || /محفظ|مراكزك|اسهمك|أسهمك/i.test(normalizeArabicIntent(turn.content)));
        const savedPortfolioTopic = ["portfolio", "portfolio_imported", "portfolio_import_pending"].includes(String(sessionSummary?.last_topic || ""))
            && (recentPortfolioTurn || (history.length === 0 && Boolean(detectPortfolioIntent(sessionState.summary || ""))));
        const hasPortfolioContext = /محفظ|البورتفوليو|portfolio/i.test(normalizeArabicIntent(userMessage))
            || savedPortfolioTopic
            || recentPortfolioTurn;
        const implicitPortfolioRanking = hasPortfolioContext
            && /(?:مين|انهي|ايه|رتب).{0,25}(?:اضعفهم|اسواهم|احسنهم|افضلهم|اقواهم)|(?:اضعفهم|اسواهم|احسنهم|افضلهم|اقواهم)/i.test(normalizeArabicIntent(userMessage));
        const portfolioRankingRequest = hasPortfolioContext && (isPortfolioRankingRequest(userMessage) || implicitPortfolioRanking);
        if (portfolioRankingRequest) directPortfolioOperation = "view";
        const portfolioDecisionRequest = /(?:ابيع|أبيع|بيع).*?(?:احتفظ|أحتفظ)|(?:احتفظ|أحتفظ).*?(?:ابيع|أبيع|بيع)/i.test(normalizeArabicIntent(userMessage))
            || (hasPortfolioContext && /(?:هخفف|اخفف|أخفف|قلل|اقلل|أقلل|ابدأ\s+بمين|أبدأ\s+بمين)/i.test(normalizeArabicIntent(userMessage)));
        const portfolioAnalysis = !portfolioRankingRequest && (directPortfolioOperation === "view" || portfolioDecisionRequest) && (
            isPortfolioAnalysisRequest(userMessage)
            // Keep these common Arabic variants on the full portfolio-analysis
            // path even when the planner normalizes the wording differently.
            || /(?:حلل|حلّل|تحليل|راجع|قيّم).*محفظ/i.test(normalizeArabicIntent(userMessage))
            || portfolioDecisionRequest
        );
        if (portfolioAnalysis) {
            // "حلل محفظتي" must use the same stock-analysis path the user gets
            // for typing a ticker, once per held symbol, in a single reply.
            const { data: heldRows, error: heldError } = await supabase
                .from("positions")
                .select("symbol,status,quantity")
                .eq("user_id", userId)
                .eq("status", "open");
            if (heldError) {
                yield { type: "done", data: { response: "تعذر قراءة محفظتك حالياً. جرّب مرة أخرى؛ لا أقدر أحلل مراكزك قبل التحقق منها.", session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: userMessage }, tables: [] } };
                return;
            }
            portfolioAnalysisSymbols = Array.from(new Set(
                (heldRows || []).filter((row: any) => Number(row.quantity) > 0)
                    .map((row: any) => String(row.symbol || "").toUpperCase()).filter(Boolean)
            ));
            if (portfolioAnalysisSymbols.length === 0) {
                yield { type: "done", data: {
                    response: "محفظتك فاضية حالياً. سجّل أسهمك أولاً (اكتب مثلاً: «ضيف COMI 100 بمتوسط 80») وبعدها أقدر أحللها لك كلها في رد واحد.",
                    session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: "طلب تحليل محفظة فاضية" },
                    tables: [],
                } };
                return;
            }
            if (!analyzeSavedPortfolio) {
                await updateSessionSummary(supabase, sessionId, userId, { pending_portfolio_import: null });
            }
        } else if (directPortfolioOperation) {
            const symbols = extractExplicitSymbols(effectivePortfolioMessage);
            const directPlan: IntentPlan = {
                intent: "portfolio_management",
                confidence: 1,
                guidance_intent: null,
                entities: {
                    symbols,
                    sector: null,
                    timeframe: "current",
                    reference: null,
                    portfolio_operation: directPortfolioOperation,
                    scan_direction: null,
                    fair_value_direction: null,
                    require_distribution: false,
                    require_accumulation: false,
                    recommendation_order: null,
                    recommendation_filter: null,
                    technical_preset: null,
                    min_acc_score: null,
                    min_vol_ratio: null,
                    excluded_sectors: [],
                    requested_sectors: [],
                    requested_date: null,
                    requested_start_date: null,
                    requested_end_date: null,
                },
                needs_vision_context: false,
                needs_history: false,
                needs_live_data: false,
                needs_historical_data: false,
                tools: ["manage_portfolio"],
                clarification_needed: false,
                service_degraded_message: null,
                unresolved_stock: false,
                resolved_from: { symbol: null, message_id: null },
            };
            yield { type: "status", data: { status: "portfolio", message: "قراءة المحفظة وتنفيذ الطلب..." } };
            const directTools = await executeStructuredTools(supabase, directPlan, apiKeys, userId, sessionId, effectivePortfolioMessage, [], userIsPro);
            console.log(`[AI TELEMETRY DETAIL] fast_portfolio_tools_ms=${Date.now() - pipelineStart} operation=${directPortfolioOperation}`);
            const portfolioResult = directTools.results.find(result => result.tool === "manage_portfolio");
            if (portfolioResult) {
                const data = portfolioResult.data || {};
                const response = portfolioRankingRequest
                    ? formatPortfolioRankingResponse(data, userMessage)
                    : directPortfolioOperation === "view"
                        ? formatPortfolioSnapshotResponse(data)
                        : String(data.message || "تم تنفيذ عملية المحفظة بنجاح.");
                await persistPipelineSession(sessionState, sessionSummary, directPlan, null, null, sessionId, userId, supabase, false);
                await persistPortfolioAwaitingState(supabase, sessionId, userId, directPortfolioOperation, data);
                yield { type: "plan", data: directPlan };
                yield { type: "tools_data", data: directTools };
                yield { type: "token", data: response };
                yield { type: "done", data: { response, session_update: { current_symbol: sessionState.current_symbol, last_symbols: portfolioResult.symbols || sessionState.last_symbols, summary: response }, tables: buildExcelTables(directTools.results, null) } };
                return;
            }
            const response = "تعذر تنفيذ طلب المحفظة حالياً لأن أداة المحفظة لم تُرجع نتيجة. جرّب مرة أخرى.";
            yield { type: "done", data: { response, session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: userMessage }, tables: [] } };
            return;
        }
    }

    try {
        // Warm up the Arabic names cache for synchronous extraction later
        await getStocksList();

    // ===== STAGE 1: Vision Analysis (isolated, multi-image support) =====
    if (hasImages) {
        yield { type: "status", data: { status: "vision", message: "تحليل الصور..." } };
        const allVisions: VisionContext[] = [];
        for (const img of images) {
            const visionResult = options.mockVisionResult ? { vision: options.mockVisionResult, error: null }
                : await analyzeImage(img, userMessage, apiKeys, messageId);
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

            if (!options.mockVisionResult) vision = await reconcileVisionWithMarket(vision, supabase);
            yield { type: "vision_result", data: vision };
            // When an image contains stock symbols, extract them, persist them to session,
            // and let the pipeline continue to analyze them directly like standard stock queries!
            if (vision.symbols.length > 0) {
                const extractedSymbols = vision.symbols.map(s => s.symbol).filter(Boolean);
                sessionState.current_symbol = extractedSymbols.length === 1 ? extractedSymbols[0] : null;
                sessionState.last_symbols = extractedSymbols;
                await updateSessionSummary(supabase, sessionId, userId, {
                    current_symbols: extractedSymbols,
                    last_image_symbols: extractedSymbols,
                    last_topic: "portfolio_image_analysis",
                    last_vision_context: vision,
                    pending_portfolio_import: null,
                    last_data_date: new Date().toISOString().split("T")[0],
                });
            }
            // Vision ran but returned unknown type with no symbols → image unreadable
            if (vision.image_type === "unknown" && vision.symbols.length === 0) {
                yield { type: "vision_error", data: "vision_unreadable" };
                yield { type: "done", data: {
                    response: "الصورة وصلت لكن لم أتمكن من قراءة محتواها بوضوح. جرّب ترفع الصورة مرة تانية بجودة أعلى، أو اكتب رموز الأسهم والكميات ومتوسط الشراء يدوياً وهحللهالك فوراً.",
                    session_update: { current_symbol: null, last_symbols: [], summary: "تعذّر قراءة الصورة" },
                    tables: [],
                } };
                return;
            }
            // Non-portfolio image (chart/table) with symbols: persist the
            // extracted symbols so a later "دى محفظتى" reply can still start
            // the import flow. Day-14 live chat lost this context because the
            // screenshot was classified as a comparison table and nothing was
            // saved, so the user's confirmation got "محفظتك فاضية".
            if (vision.symbols.length > 0) {
                await updateSessionSummary(supabase, sessionId, userId, {
                    last_image_symbols: vision.symbols.map(symbol => symbol.symbol),
                    last_vision_context: vision,
                });
            }
        } else if (visionError) {
            yield { type: "vision_error", data: visionError };
                yield { type: "done", data: {
                    response: "الصورة وصلت لكن لم أستطع قراءتها والتحقق منها. لن أستبدلها بتحليل توصيات أو بيانات قديمة. أعد رفع الصورة أو اكتب الرموز والكميات ومتوسط الشراء يدوياً.",
                    vision_error: visionError || "vision_analysis_failed",
                    session_update: { current_symbol: null, last_symbols: [], summary: "فشل قراءة صورة المستخدم" },
                    tables: [],
                } };
            return;
        }
    }


    // ===== STAGE 2: Memory Retrieval =====
    yield { type: "status", data: { status: "memory", message: "استرجاع السياق..." } };
    memory = await retrieveRelevantMemory(userMessage, sessionSummary, sessionState, history, supabase, userId, sessionId);
    yield { type: "memory_result", data: memory };
    if (!hasImages && memory.resolved_references.requires_clarification && extractExplicitSymbols(userMessage).length === 0) {
        const candidates = memory.resolved_references.candidates || [];
        const clarificationPlan: IntentPlan = { intent: "clarification", confidence: 1,
            entities: { symbols: [], sector: null, timeframe: "current", reference: null }, tools: [], clarification_needed: true,
            clarification_options: candidates, needs_vision_context: false, needs_history: true,
            needs_live_data: false, needs_historical_data: false, resolved_from: { symbol: null, message_id: null } };
        yield { type: "plan", data: clarificationPlan };
        yield { type: "tools_data", data: { results: [], formattedText: "" } };
        yield { type: "done", data: { response: `تقصد أي سهم${candidates.length ? `: ${candidates.join(" ولا ")}` : " من الأسهم اللي اتكلمنا عنها"}؟`,
            session_update: { current_symbol: null, last_symbols: candidates, summary: userMessage }, tables: [] } };
        return;
    }

    // ===== STAGE 3: Intent / Entity Planner =====
    yield { type: "status", data: { status: "planner", message: "تحليل النية وتخطيط الأدوات..." } };
    if (!hasImages) await getStocksList();

    // Resolve unavailable explicit identifiers before semantic planning, tools,
    // or ranking clarification can replace them with another company.
    const requestedSymbols = extractExplicitSymbols(userMessage);
    const knownSymbolSet = new Set(getSyncValidSymbols());
    if (!hasImages && requestedSymbols.length > 0 && requestedSymbols.every(symbol => !knownSymbolSet.has(symbol))) {
        const unavailablePlan: IntentPlan = { intent: "stock_analysis", confidence: 1,
            entities: { symbols: requestedSymbols, sector: null, timeframe: "current", reference: null },
            tools: [], clarification_needed: false, needs_vision_context: false, needs_history: false,
            needs_live_data: false, needs_historical_data: false, resolved_from: { symbol: null, message_id: null } };
        completeDecisionTools(userMessage, unavailablePlan, history);
        unavailablePlan.tools = [];
        yield { type: "plan", data: unavailablePlan };
        yield { type: "tools_data", data: { results: [], formattedText: "" } };
        yield { type: "done", data: {
            response: `لا تتوفر لدي بيانات موثقة للرمز ${requestedSymbols.join("، ")} في تغطية النظام الحالية. لا أستطيع ترجيح أو مقارنة أسهم بلا بيانات موثقة. لن أستبدله بسهم آخر أو أعتبر السعر الذي كتبته إغلاقاً موثقاً. اكتب اسم الشركة الكامل لتحديدها؛ سأوضح نقص التغطية إذا ظلت بياناتها غير متاحة.`,
            session_update: { current_symbol: null, last_symbols: [], summary: userMessage }, tables: [],
        } };
        return;
    }

    // ─── Hybrid intent/entity planner ───
    // Deterministic routes remain policy guards for known financial actions.
    // Ambiguous/new phrasings are delegated to the semantic planner instead of
    // being forced into a regex fallback that silently reuses an old symbol.
    const deterministicPlannerResult = buildCompoundDeterministicPlan(userMessage, sessionState);
    let plannerResult = options.mockPlannerResult ?? deterministicPlannerResult ?? generalChatPlan(sessionState);
    let isSemanticPlanAuthoritative = false;
    const greetingOnly = /^(?:ازيك|إزيك|عامل ايه|عامل إيه|اهلا|أهلا|مرحبا|السلام عليكم|شكرا|شكرًا|تمام|اوكي|أوكي)[؟?،,.!\s]*$/i.test(userMessage.trim());
    const preserveDeterministicPlan = greetingOnly
        || /^(?:جدع|عاش|تمام|تسلم|شكرا|شكراً|حلو|ممتاز|برافو)\s*[!؟?.]*$/i.test(userMessage.trim())
        || Boolean(detectPortfolioIntent(userMessage))
        || deterministicPlannerResult?.intent === "portfolio_management"
        || deterministicPlannerResult?.guidance_intent === "terms_explainer"
        || Boolean(/شريع|sharia/i.test(normalizeArabicIntent(userMessage)))
        || Boolean(deterministicPlannerResult?.tools?.includes("get_recommendations")
            && (isExplicitRecommendationRequest(userMessage)
                || deterministicPlannerResult?.intent === "historical_recall"))
        || Boolean(deterministicPlannerResult?.service_degraded_message || deterministicPlannerResult?.unresolved_stock);
    const canUseSemanticPlanner = !hasImages
        && portfolioAnalysisSymbols.length === 0
        && !options.mockToolsResults
        && !greetingOnly
        && !preserveDeterministicPlan
        && Boolean(apiKeys.length > 0 || getDeepSeekApiKey());
    if (canUseSemanticPlanner) {
        try {
            const semanticPlan = await withExecutionTimeout(
                Math.min(7000, Math.max(1000, remainingExecutionMs() - 1000)),
                () => runPlanner(userMessage, [], sessionState, history, apiKeys, vision),
            );
            if (semanticPlan.confidence >= 0.6) {
                plannerResult = semanticPlan;
                isSemanticPlanAuthoritative = true;
            }
        } catch (error) {
            console.warn("[PLANNER] semantic routing unavailable; using safe deterministic fallback:", error);
        }
    }

    // Explicit scan criteria constrain even a confident semantic plan. The
    // semantic planner may enrich context, but cannot replace the predicate.
    const explicitScan = !hasImages && splitChatCommands(userMessage).length === 1 ? deterministicPlannerResult?.entities?.technical_preset : null;
    if (explicitScan) {
        plannerResult = { ...plannerResult, intent: "technical_scan", tools: ["get_technical_scan"],
            clarification_needed: false, entities: { ...plannerResult.entities, symbols: [], sector: null, technical_preset: explicitScan },
            request: { goal: userMessage, reference: "market", ranking_metric: "unspecified", required_facts: [] } };
        isSemanticPlanAuthoritative = false;
    }
    const explicitFairValueScan = !hasImages && splitChatCommands(userMessage).length === 1 && isFairValueScanRequest(userMessage) && extractExplicitSymbols(userMessage).length === 0;
    if (explicitFairValueScan) {
        const filters = getFairValueFilters(userMessage);
        plannerResult = { ...plannerResult, intent: 'market_summary', tools: ['get_fair_value_scan'],
            clarification_needed: false, entities: { ...plannerResult.entities, symbols: [], sector: null, ...filters },
            request: { goal: userMessage, reference: 'market', ranking_metric: 'unspecified', required_facts: [] } };
        isSemanticPlanAuthoritative = false;
    }
    const bollingerStockSymbols = /bollinger|بولينجر|بولنجر|بولينغر/i.test(userMessage) && !isMarketWideRequest(userMessage)
        ? extractExplicitSymbols(userMessage) : [];
    if (bollingerStockSymbols.length && !explicitScan) {
        plannerResult = { ...plannerResult, intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], clarification_needed: false,
            entities: { ...plannerResult.entities, symbols: bollingerStockSymbols, technical_preset: null },
            request: { goal: userMessage, reference: "explicit", ranking_metric: "unspecified", required_facts: ["stock_quote", "technical_indicators"] } };
        isSemanticPlanAuthoritative = false;
    }
    const asksSectorLiquidity = !hasImages && (
        /(?:سيول|السيول).{0,30}(?:قطاع|القطاع|في\s+قطاع|في\s+القطاع|قطاعات|القطاعات)/i.test(normalizeArabicIntent(userMessage)) ||
        /(?:انشط|أنشط|اقوى|أقوى|اعلى|أعلى|ترتيب|رتب)\s+(?:القطاعات|قطاعات)/i.test(normalizeArabicIntent(userMessage))
    );
    if (asksSectorLiquidity) {
        plannerResult = {
            ...plannerResult,
            intent: "market_summary",
            tools: ["get_sector_liquidity"],
            clarification_needed: false,
            entities: { ...plannerResult.entities, symbols: [] },
            request: { goal: userMessage, reference: "market", ranking_metric: "liquidity", required_facts: ["liquidity"] }
        };
        isSemanticPlanAuthoritative = false;
    }

    const imageSymbols = (hasImages && vision?.symbols?.length)
        ? vision.symbols.map(s => s.symbol).filter(Boolean)
        : [];

    if (imageSymbols.length > 0) {
        // Route every extracted stock from the image through the normal stock-analysis tools!
        plannerResult = {
            intent: "stock_analysis",
            confidence: 1,
            entities: {
                symbols: Array.from(new Set([...imageSymbols, ...extractExplicitSymbols(userMessage)])),
                sector: null,
                wants_table: true,
                timeframe: "current",
                requested_date: null,
                scan_direction: null,
            },
            tools: ["get_stock", "get_stock_levels", "get_signals"],
            session_update: { current_symbol: imageSymbols[0], last_symbols: imageSymbols, summary: userMessage },
        } as any;
    } else if (portfolioAnalysisSymbols.length > 0) {
        // Route every saved holding through the normal stock-analysis tools so
        // the reply mirrors the per-symbol analysis the user gets manually.
        plannerResult = {
            intent: "stock_analysis",
            confidence: 1,
            entities: {
                symbols: portfolioAnalysisSymbols,
                sector: null,
                wants_table: true,
                timeframe: "current",
                requested_date: null,
                scan_direction: null,
                portfolio_operation: "view",
            },
            tools: ["manage_portfolio", "get_stock", "get_stock_levels"],
            request: {
                goal: userMessage,
                reference: "portfolio",
                ranking_metric: "unspecified",
                required_facts: ["portfolio_positions", "stock_quote", "price_levels"],
            },
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: portfolioAnalysisSymbols, summary: userMessage },
        } as any;
    }

    const prefs = extractInvestorPreferences(userMessage);
    const normalizedPreferenceText = normalizeArabicIntent(userMessage);
    const experience_level = /(?:مبتدئ|اول مره|أول مرة|مش فاهم|مش عارف|لسه بادئ|بداية استثمار)/i.test(normalizedPreferenceText)
        ? "beginner"
        : /(?:محترف|خبير|خبرة كبيرة|متداول محترف|بيتا|انحراف معياري|volatility|sharpe)/i.test(normalizedPreferenceText)
            ? "expert"
            : null;
    const persistentProfile = await loadPersistentInvestorProfile(supabase, userId);
    if (prefs.budget !== null || prefs.horizon !== null || prefs.risk_tolerance !== null || prefs.sector !== null) {
        sessionState = {
            ...sessionState,
            investment_budget: prefs.budget !== null ? prefs.budget : sessionState.investment_budget,
            investment_horizon: prefs.horizon !== null ? prefs.horizon : sessionState.investment_horizon,
            risk_tolerance: prefs.risk_tolerance !== null ? prefs.risk_tolerance : sessionState.risk_tolerance,
            preferred_sectors: prefs.sector 
                ? Array.from(new Set([...(sessionState.preferred_sectors || []), prefs.sector]))
                : sessionState.preferred_sectors,
            experience_level: experience_level || sessionState.experience_level || persistentProfile.experience_level || null
        };
    }
    if (!sessionState.experience_level && (experience_level || persistentProfile.experience_level)) {
        sessionState = { ...sessionState, experience_level: experience_level || persistentProfile.experience_level };
    }
    if (prefs.budget !== null || prefs.horizon !== null || prefs.risk_tolerance !== null || prefs.sector !== null || experience_level) {
        try {
            const { error: profErr } = await supabase.from("ai_chat_facts").insert({
                user_id: userId,
                session_id: sessionId,
                source: "investor_profile",
                symbols: [],
                as_of: new Date().toISOString().slice(0, 10),
                facts: {
                    budget: prefs.budget ?? sessionState.investment_budget ?? null,
                    horizon: prefs.horizon ?? sessionState.investment_horizon ?? null,
                    risk_tolerance: prefs.risk_tolerance ?? sessionState.risk_tolerance ?? null,
                    sector: prefs.sector || sessionState.preferred_sectors?.[0] || null,
                    experience_level: experience_level || sessionState.experience_level || null,
                },
                data_type: "user-provided",
            });
            if (profErr?.code === "23503" && /ai_chat_facts_session_id_fkey/i.test(profErr?.message || "")) {
                // Session not persisted yet, ignore fact snapshot
            } else if (profErr) {
                console.warn("Failed to persist investor profile:", profErr);
            }
        } catch (error: any) {
            if (error?.code !== "23503") {
                console.warn("Failed to persist investor profile:", error);
            }
        }
    }

    const explicitSymbols = extractExplicitSymbols(userMessage);
    const broadScanRequest = explicitSymbols.length === 0 && /(?:الاسهم|اسهم|هات|ابعت|اعرض).{0,40}(?:تجميع|تصريف)|(?:تجميع|تصريف).{0,40}(?:الاسهم|اسهم)/i.test(normalizeArabicIntent(userMessage));
    const plannerResolvedSymbols = plannerResult.entities.symbols || [];
    const antecedentSymbols = (sessionState.last_symbols || []).length > 1
        ? sessionState.last_symbols
        : plannerResolvedSymbols;
    const groupReferenceSymbols = resolveGroupReferenceSymbols(userMessage, antecedentSymbols);
    const explicitComparison = /قارن|مقارن|مفاضل|السهمين|الاتنين|compare/i.test(userMessage);
    const referenceCandidates = new Set([...(sessionState.last_symbols || []),
        ...(sessionState.current_symbol ? [sessionState.current_symbol] : []),
        ...(memory?.resolved_references?.symbol ? [memory.resolved_references.symbol] : []),
        ...(vision?.symbols || []).map(s => s.symbol)]);
    const unionSymbols = explicitSymbols.length > 0
        ? Array.from(new Set([...explicitSymbols, ...(explicitComparison && explicitSymbols.length === 1
            ? plannerResolvedSymbols.filter(s => referenceCandidates.has(s)) : [])]))
        : plannerResolvedSymbols;
    let mergedSymbols = mergeVisionSymbols(unionSymbols, vision, explicitSymbols.length);
    mergedSymbols = clearsStockContext(plannerResult) 
        ? explicitSymbols 
        : hasImages && imageSymbols.length > 0 ? mergedSymbols
        : scopeImplicitSingleStockRequest(userMessage, explicitSymbols, mergedSymbols, sessionState.current_symbol, memory?.resolved_references?.symbol || null);
    const riskFollowUp = /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage);
    if (riskFollowUp && mergedSymbols.length === 0) {
        const recentSymbol = extractSingleStockFromRecentHistory(history);
        if (recentSymbol) mergedSymbols.push(recentSymbol);
    }
    // A remembered symbol is not a default subject. Reuse it only when the
    // new message is linguistically a stock follow-up; unrelated market,
    // sector, recommendation, or general questions must start unscoped.
    if (mergedSymbols.length === 0 && memory?.resolved_references?.symbol && isImplicitStockFollowUp(userMessage)) {
        mergedSymbols.push(memory.resolved_references.symbol);
    }
    // An implicit follow-up question (see isImplicitStockFollowUp) must resolve
    // to the session's current stock even when current_symbol is missing from
    // the passed sessionState (fall back to last_symbols / recent history).
    // This runs before the "X للY" company-name detector which misread
    // questions like "ممكن يطلع للمقاومة امتى" as an unknown company.
    const implicitStockFollowUp = explicitSymbols.length === 0 && (isImplicitStockFollowUp(userMessage) || isStockFollowUpReference(userMessage));
    if (implicitStockFollowUp && mergedSymbols.length === 0) {
        const recentSymbol = memory?.resolved_references?.symbol || extractSingleStockFromRecentHistory(history);
        if (recentSymbol) {
            mergedSymbols.push(String(recentSymbol).toUpperCase());
            plannerResult = {
                ...plannerResult,
                intent: "stock_analysis",
                tools: ["get_stock", "get_stock_levels"],
                entities: { ...plannerResult.entities, symbols: mergedSymbols },
            } as any;
        }
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(أبيع|ابيع|بيع(?!ه|ها|هم|ين)|أحتفظ|احتفظ|أخرج|اخرج|بكام|بكم|السعر|وقف\s*(?:ال)?خسار|اوقف\s*(?:ال)?خسار|خسار|خساير|خسران|اشتريت|شاري|متوسط)/i.test(userMessage) && !isBestBuyStockQuestion(userMessage) && !isMarketWideRequest(userMessage) && plannerResult.intent !== "technical_scan") {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(اخباره|أخباره|هات\s+اخبار|هات\s+أخبار|خبره)/i.test(userMessage)) mergedSymbols.push(sessionState.current_symbol);
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    const isSingleStockRecFollowUp = Boolean(sessionState.current_symbol) && /(?:^|[^\u0621-\u064A])(ده|دا|دي|هذا|السهم ده|السهم دا|السهم دي|هاته|هاتها|اخباره|أخباره|خبره|الاتنين|السهمين|عليه|فيه|ليه|عليها|فيها|ليها|عنه|عنها|به|بها|معاه|معاها|هو|هي)(?:$|[^\u0621-\u064A])/i.test(normalizeArabicIntent(userMessage)) && /(?:توصي[اإ]?\s*ت|توصي[ةه])/i.test(normalizeArabicIntent(userMessage));
    const isConversationalFollowUp = isConversationalChoiceOrFollowUp(userMessage);
    if (mergedSymbols.length === 0 && sessionState.current_symbol && !isConversationalFollowUp && (
        /(السهم|السهمين|الاتنين|عليه|عليها|فيه|فيها|ليه|ليها|له|لها|عنه|عنها|به|بها|معاه|معاها|هو|هي|ده|دي|هذا|هذه|تجميع|تصريف|تحليل|مؤشر|مؤشرات|دعم|مقاومة|مقاومه|توصي|خسار|خساير|اشتريت|شاري|متوسط)/i.test(userMessage) ||
        (userMessage.trim().split(/\s+/).length <= 3 && !/^(?:مش\s+عارف|معرفش|رشحلي|اختارلي|الاتنين|الاثنين|صغير[ةه]|متوسط[ةه]|كبير[ةه]|مضارب[ةه]|استثمار|عقارات|بنوك|ادوية|أدوية)$/i.test(normalizeArabicIntent(userMessage.trim())))
    ) && !isMarketWideRequest(userMessage) && (!isBestBuyStockQuestion(userMessage) || isSingleStockRecFollowUp) && plannerResult.intent !== "technical_scan") {
        mergedSymbols.push(sessionState.current_symbol);
    }
    // An explicit company-name phrase that resolves to no known symbol ("حلل دلتا للطباعه")
    // must not inherit the previous session symbol — the responder would analyze the WRONG stock.
    const unresolvedNameMatch = userMessage.match(/(?:^|[\s،,])(\S{2,}\s+لل\S{2,})/);
    const unresolvedCandidate = unresolvedNameMatch ? unresolvedNameMatch[1].replace(/[.،,؟?…].*$/, "").trim() : null;
    // A follow-up question ("يطلع للمقاومة امتى") matches the "X للY" pattern but
    // is not a company name and must fall back to the current symbol instead of
    // returning "لم أجد شركة بهذا الاسم".
    const looksLikeFollowUpPhrase = unresolvedCandidate !== null
        && (looksLikeQuestionFragment(unresolvedCandidate) || isImplicitStockFollowUp(userMessage));
    const unresolvedStockName = explicitSymbols.length === 0 && unresolvedCandidate && !vision && !looksLikeFollowUpPhrase
        ? unresolvedCandidate
        : null;
    if (unresolvedStockName) mergedSymbols = [];
    // Bare ticker that matches no listed stock ("FTNS") — answer that it is not
    // covered instead of running empty tools and serving a degraded fallback.
    const unrecognizedTicker = !vision && explicitSymbols.length === 0
        && /^[A-Za-z]{2,6}[؟?\s.]*$/.test(userMessage.trim());
    const compoundRequest = splitChatCommands(userMessage).length > 1;
    if ((isMarketWideRequest(userMessage) || broadScanRequest || (isBestBuyStockQuestion(userMessage) && !isSingleStockRecFollowUp && groupReferenceSymbols.length === 0) || plannerResult.intent === "technical_scan" || plannerResult.intent === "accumulation_distribution" || Boolean(plannerResult.request?.reference === "market")) && !compoundRequest && extractExplicitSymbols(userMessage).length === 0) mergedSymbols = [];
    if (groupReferenceSymbols.length > 0 && isBestBuyStockQuestion(userMessage)) mergedSymbols = groupReferenceSymbols;
    if (plannerResult.entities.sector && extractExplicitSymbols(userMessage).length === 0) mergedSymbols = [];
    const fairValueScanRequest = isFairValueScanRequest(userMessage);
    const dateOnlyFollowUp = Boolean(
        extractRequestedDate(userMessage)
        && mergedSymbols.length === 0
        && sessionState.current_symbol
        && !isMarketWideRequest(userMessage)
        && !unresolvedStockName
    );
    if (dateOnlyFollowUp) mergedSymbols = [sessionState.current_symbol!];
    const enforced: ReturnType<typeof enforceIntentFromMessage> = isSemanticPlanAuthoritative
        ? { intent: plannerResult.intent, tools: plannerResult.tools || [], replaceTools: false }
        : dateOnlyFollowUp
        ? { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true }
        : compoundRequest
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
    if (imageSymbols.length > 0) {
        enforced.intent = "stock_analysis";
        enforced.tools = ["get_stock", "get_stock_levels"];
        enforced.replaceTools = true;
        mergedSymbols = Array.from(new Set([...imageSymbols, ...explicitSymbols]));
    }
    if (portfolioAnalysisSymbols.length > 0) {
        // Never let the portfolio fast-path override a full analysis request.
        enforced.intent = "stock_analysis";
        enforced.tools = ["manage_portfolio", "get_stock", "get_stock_levels"];
        enforced.replaceTools = true;
        mergedSymbols = portfolioAnalysisSymbols.slice();
    }
    const marketScopedTools = new Set(["get_market", "get_sector_liquidity", "get_sector_list", "get_fair_value_scan", "get_technical_scan", "get_accumulation_stocks", "get_distribution_stocks"]);
    const isExplicitStockIntent = ["stock_analysis", "risk_analysis", "levels_analysis", "stock_news"].includes(enforced.intent) || enforced.tools.includes("get_stock");
    if (explicitSymbols.length === 0 && !isExplicitStockIntent && enforced.tools.some(tool => marketScopedTools.has(tool))) mergedSymbols = [];
    const datedDomainRequest = Boolean(extractRequestedDate(userMessage) || extractRequestedDateRange(userMessage)) && ["stock_analysis", "stock_news", "comparison", "sector_analysis", "accumulation_distribution"].includes(enforced.intent);
    const historicalRequest = needsHistoricalData(enforced.intent, userMessage);
    let effectiveIntent = isSemanticPlanAuthoritative ? plannerResult.intent : (historicalRequest && !datedDomainRequest ? "historical_recall" : enforced.intent);

    const requiredFactTools: Record<string, string[]> = {
        stock_quote: ["get_stock"], technical_indicators: ["get_stock"], price_levels: ["get_stock", "get_stock_levels"],
        news: ["get_news"], corporate_actions: mergedSymbols.length ? ["get_corporate_actions"] : [],
        liquidity: mergedSymbols.length ? ["get_stock"] : plannerResult.entities.sector ? ["get_sector_liquidity"] : [],
        accumulation: ["get_accumulation_stocks"], distribution: ["get_distribution_stocks"], market_summary: ["get_market"],
        recommendations: ["get_recommendations"], historical_prices: ["get_price_history"], portfolio_positions: ["manage_portfolio"],
    };
    const requestedFactTools = compoundRequest ? [] : Array.from(new Set((plannerResult.request?.required_facts || []).flatMap(fact => requiredFactTools[fact] || [])));
    const plannedTools = plannerResult.clarification_needed
        ? []
        : sanitizePlannerTools(userMessage, isSemanticPlanAuthoritative
        ? Array.from(new Set([...(plannerResult.tools || []), ...requestedFactTools]))
        : enforced.replaceTools
        ? [...enforced.tools, ...requestedFactTools]
        : Array.from(new Set([...(plannerResult.tools || []), ...enforced.tools])));
    // Reconcile the planner's interpretation with what the user actually asked.
    // A broad opportunities request needs a criterion, not an invented scan.
    const unspecifiedOpportunities = isUnspecifiedOpportunityRequest(userMessage)
        && !isFairValueScanRequest(userMessage)
        && explicitSymbols.length === 0 && groupReferenceSymbols.length === 0
        && !plannerResult.entities.sector && !compoundRequest;
    if (unspecifiedOpportunities) {
        if (/اقوي|اقوى|أقوى/i.test(normalizeArabicIntent(userMessage))) {
            mergedSymbols = [];
            plannedTools.splice(0, plannedTools.length);
            effectiveIntent = "clarification";
            plannerResult.clarification_needed = true;
            plannerResult.clarification_options = ["أعلى ارتفاعاً", "أعلى سيولة", "أعلى تجميعاً"];
            plannerResult.request = {
                goal: userMessage, reference: "market", ranking_metric: "unspecified", required_facts: [],
                clarification_reason: "كلمة (أقوى) يمكن أن تعني الأقوى في الصعود، أو الأقوى في السيولة، أو الأقوى من حيث التجميع المؤسسي. يرجى تحديد المعيار الذي تفضله."
            };
        } else {
            mergedSymbols = [];
            plannedTools.splice(0, plannedTools.length, "get_recommendations", "get_market", "get_accumulation_stocks");
            effectiveIntent = "market_summary";
            plannerResult.clarification_needed = false;
            plannerResult.clarification_options = ["توصيات المنصة المفتوحة", "أسهم التجميع المؤسسي", "أقوى الأسهم ارتفاعاً اليوم"];
            plannerResult.entities.recommendation_filter = "open";
            plannerResult.request = {
                goal: userMessage, reference: "market", ranking_metric: "unspecified", required_facts: ["recommendations", "market_summary", "accumulation"],
                clarification_reason: null,
            };
        }
    }
    const marketRankingMode = mergedSymbols.length === 0 ? getMarketRankingMode(userMessage, plannerResult.request) : null;
    if (marketRankingMode === "liquidity_unavailable") {
        plannedTools.splice(0, plannedTools.length);
        effectiveIntent = "clarification";
        plannerResult.clarification_needed = true;
        plannerResult.clarification_options = ["أسهم التجميع المؤسسي (Wyckoff)", "أعلى الأسهم ارتفاعاً في السعر"];
        plannerResult.request = {
            goal: "ترتيب أسهم السوق حسب السيولة وحجم التداول",
            reference: "market",
            ranking_metric: "liquidity",
            required_facts: ["liquidity"],
            clarification_reason: "لا يتوفر حالياً مسح سوقي موثق لترتيب كل الأسهم حسب قيمة التداول أو نسبة الحجم.",
        };
    } else if (!plannerResult.clarification_needed && marketRankingMode) {
        const marketTools = marketRankingMode === "price_change" ? ["get_market"]
            : marketRankingMode === "accumulation" ? ["get_accumulation_stocks"] : [];
        for (const tool of marketTools) if (!plannedTools.includes(tool)) plannedTools.push(tool);
        effectiveIntent = marketRankingMode === "accumulation" ? "accumulation_distribution" : "market_summary";
        if (plannerResult.request) plannerResult.request.ranking_metric = marketRankingMode;
        if (marketRankingMode === "accumulation") plannerResult.entities.scan_direction = "accumulation";
    }
    if (marketRankingMode === "price_change" && !plannerResult.clarification_needed && !plannedTools.includes("get_market")) plannedTools.push("get_market");
    if (!plannerResult.clarification_needed && !isTermsDefinitionRequest(userMessage) && plannedTools.length > 0) {
        const completion = completeToolsByFacets({
            message: userMessage,
            symbols: explicitSymbols,
            tools: plannedTools,
            sector: enforced.sector || plannerResult.entities.sector || null,
        });
        for (const tool of completion.added) plannedTools.push(tool);
        if (completion.stockFacetAdded && effectiveIntent === "market_summary") effectiveIntent = "stock_analysis";
    }
    // Day-by-day change questions need the daily price rows; the compound-command
    // path above can bypass enforceIntentFromMessage and the planner sometimes
    // omits get_price_history, so re-add it here.
    if (!plannedTools.includes("get_price_history")
        && mergedSymbols.length > 0
        && /يوم\s*بـ?\s*يوم|التغير\s*اليومي|تغير\s*يومي|سعر\s*كل\s*يوم|أداء\s*يومي|(?:اخر|آخر)\s*(?:اسبوع|أسبوع|ايام|أيام|جلسات).{0,30}(?:تغير|نسب)/i.test(userMessage)) {
        plannedTools.push("get_price_history");
    }
    const isGreetingMsg = /^(?:ازيك|إزيك|عامل ايه|عامل إيه|اهلا|أهلا|مرحبا|السلام عليكم|شكرا|شكرًا|تمام|اوكي|أوكي)[؟?،,.!\s]*$/i.test(userMessage.trim());
    if (!plannerResult.clarification_needed && !plannerResult.service_degraded_message && plannedTools.length === 0 && (unrecognizedTicker || unresolvedStockName || (mergedSymbols.length === 0 && !isGreetingMsg && !isTermsDefinitionRequest(userMessage) && !isConversationalFollowUp && userMessage.trim().length >= 2))) {
        plannedTools.push("search_web");
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

    const isFutureOpportunityQuery = /(?:غدا|بكره|بكرة|الاسبوع|الأسبوع|النهاردة|النهارده|اليوم)/i.test(normalizeArabicIntent(userMessage)) && /(?:فرص|فرصه|توقعات|ربحي|ترشح|اشتري|اسهم|أقوى|اقوي|اقوى|افضل|أفضل)/i.test(normalizeArabicIntent(userMessage));
    if (isFutureOpportunityQuery && !plannedTools.includes("get_recommendations") && !plannerResult.clarification_needed) {
        plannedTools.push("get_recommendations");
    }

    const plan: IntentPlan = {
        intent: mapIntent(effectiveIntent),
        confidence: plannerResult.confidence || 0.8,
        guidance_intent: guidanceIntent,
        entities: {
            symbols: mergedSymbols,
            sector: comparesSectors || (excludedSectors.length > 0 && plannedTools.includes("get_sector_liquidity")) ? null : enforced.sector || plannerResult.entities.sector || null,
            timeframe: extractTemporalContext(userMessage).timeframe,
            reference: implicitStockFollowUp && memory?.resolved_references?.symbol ? "last_stock" : null
            ,scan_direction: enforced.scan_direction || plannerResult.entities.scan_direction || null
            ,fair_value_direction: enforced.fair_value_direction || plannerResult.entities.fair_value_direction || null
            ,require_distribution: Boolean(enforced.require_distribution || plannerResult.entities.require_distribution)
            ,require_accumulation: Boolean(enforced.require_accumulation || plannerResult.entities.require_accumulation)
            ,recommendation_order: enforced.recommendation_order || plannerResult.entities.recommendation_order || null
            ,recommendation_filter: enforced.recommendation_filter || plannerResult.entities.recommendation_filter || null
            ,technical_preset: plannerResult.entities.technical_preset || null
            ,min_acc_score: plannerResult.entities.min_acc_score ?? null
            ,min_vol_ratio: plannerResult.entities.min_vol_ratio ?? null
            ,max_dist_score: plannerResult.entities.max_dist_score ?? null
            ,min_consecutive_acc_days: plannerResult.entities.min_consecutive_acc_days ?? null
            ,wants_table: plannerResult.entities.wants_table
            ,sharia_filter: plannerResult.entities.sharia_filter
            ,excluded_sectors: Array.from(new Set([...excludedSectors, ...plannerExcludedSectors]))
            ,requested_sectors: enforced.requested_sectors || plannerResult.entities.requested_sectors || []
            ,requested_date: extractRequestedDate(userMessage) || null
            ,requested_start_date: requestedRange?.start || null
             ,requested_end_date: requestedRange?.end || null
            ,portfolio_operation: plannerResult.entities.portfolio_operation || null
         },
        needs_vision_context: hasImages && !!vision,
        needs_history: (Array.isArray(history) && history.length > 0) || Boolean(implicitStockFollowUp && memory?.resolved_references?.symbol) || plannerResult.intent === "general_chat",
        needs_live_data: needsLiveDataForTools(plannedTools),
        needs_historical_data: historicalRequest,
        tools: plannedTools,
        clarification_needed: Boolean(plannerResult.clarification_needed),
        clarification_options: plannerResult.clarification_options || [],
        ranking_metric: /شريع|sharia/i.test(normalizeArabicIntent(userMessage)) ? "unspecified" : (marketRankingMode || plannerResult.request?.ranking_metric || "unspecified"),
        service_degraded_message: plannerResult.service_degraded_message || null,
        unresolved_stock: Boolean(plannerResult.unresolved_stock),
        request: plannerResult.request,
        resolved_from: {
            symbol: implicitStockFollowUp ? memory?.resolved_references?.symbol || null : null,
            message_id: implicitStockFollowUp ? memory?.resolved_references?.message_id || null : null
        }
    };

    const normalizedDollarStockQuestion = normalizeArabicIntent(userMessage);
    const dollarStockQuestion = isBestBuyStockQuestion(userMessage)
        && /(?:دولار|usd|us stocks?)/i.test(normalizedDollarStockQuestion)
        && /(?:سهم|اسهم|stock|stocks|equities)/i.test(normalizedDollarStockQuestion);

    // Portfolio commands are transactional and must never fall through to the
    // slow responder LLM. Re-check the raw user message at the final plan
    // boundary because an earlier planner/enforcement pass can overwrite the
    // intent while merging context (the old symptom was a 20s "financial
    // report" for the simple "اعرض محفظتي" request).
    const directPortfolioOperation = detectPortfolioIntent(userMessage);
    if (directPortfolioOperation && !hasImages && portfolioAnalysisSymbols.length === 0) {
        plan.intent = "portfolio_management";
        plan.entities.portfolio_operation = directPortfolioOperation;
        plan.tools = ["manage_portfolio"];
        plan.needs_live_data = false;
        plan.needs_historical_data = false;
    }
    // A definition is a new educational task, not analysis of a remembered stock.
    if (!hasImages && isTermsDefinitionRequest(userMessage)) {
        plan.intent = "general_chat";
        plan.guidance_intent = "terms_explainer";
        plan.entities.symbols = [];
        plan.entities.portfolio_operation = null;
        plan.tools = [];
        plan.request = undefined;
        plan.clarification_needed = false;
        plan.needs_live_data = false;
        plan.needs_historical_data = false;
        plan.resolved_from = { symbol: null, message_id: null };
    }
    Object.assign(plan, applyHybridDomainInvariants(userMessage, plan));
    if (!hasImages && explicitSymbols.length === 1 && !explicitComparison && plan.intent === "comparison") {
        plan.intent = "stock_analysis";
        plan.tools = Array.from(new Set([...plan.tools.filter(t => t !== "get_comparison"), "get_stock", "get_stock_levels"]));
        plan.entities.symbols = explicitSymbols;
        plan.needs_live_data = true;
    }
    if (dollarStockQuestion) {
        plan.intent = "clarification";
        plan.entities.symbols = [];
        plan.tools = [];
        plan.needs_live_data = false;
        plan.needs_historical_data = false;
        plan.clarification_needed = true;
        plan.clarification_options = ["أسهم مصرية مقومة بالدولار", "أسهم أمريكية"];
        plan.request = {
            goal: userMessage, reference: "market", ranking_metric: "unspecified", required_facts: [],
            clarification_reason: "لا تتوفر في بيانات المنصة الحالية معلومات موثوقة كافية لترشيح سهم دولاري. هل تقصد سهماً مصرياً مقوماً بالدولار أم سهماً في سوق أمريكي؟",
        };
    }

    if (unresolvedStockName && !hasImages && !isMarketWideRequest(userMessage)
        && !isUnspecifiedOpportunityRequest(userMessage) && !explicitScan && !isTermsDefinitionRequest(userMessage)) {
        plan.intent = "clarification";
        plan.entities.symbols = [];
        plan.tools = [];
        plan.needs_live_data = false;
        plan.needs_historical_data = false;
        plan.clarification_needed = true;
        plan.unresolved_stock = true;
        plan.request = { goal: userMessage, reference: "explicit", ranking_metric: "unspecified", required_facts: [],
            clarification_reason: `لم أجد شركة بهذا الاسم («${unresolvedStockName}») في تغطية النظام الحالية. اكتب الرمز اللاتيني أو اسم الشركة الكامل؛ لن أحلل سهماً آخر بدلاً منها.` };
    }
    if (!hasImages && !isTermsDefinitionRequest(userMessage)
        && /عمق\s*(?:السعر|السوق)|دفتر\s*الاوامر/i.test(normalizeArabicIntent(userMessage))) {
        plan.intent = "clarification";
        plan.tools = [];
        plan.needs_live_data = false;
        plan.needs_historical_data = false;
        plan.clarification_needed = true;
        plan.request = { goal: userMessage, reference: "explicit", ranking_metric: "unspecified", required_facts: [],
            clarification_reason: `لا أملك وصولاً مباشراً لدفتر الأوامر${plan.entities.symbols.length ? ` لسهم ${plan.entities.symbols.join("، ")}` : ""}. أرسل صورة واضحة ومؤرخة لعمق السعر تظهر الطلبات والعروض والكميات؛ مؤشرات الإغلاق وحدها لا تكفي لتحليل عمق السعر.` };
    }
    completeDecisionTools(userMessage, plan, history);
    yield { type: "plan", data: plan };

    if (plan.clarification_needed) {
        const response = plan.request?.clarification_reason
            ? plan.ranking_metric === "liquidity" || plan.ranking_metric === "liquidity_unavailable"
                ? `لا تتوفر لدي حالياً بيانات مسح موثقة لترتيب جميع أسهم السوق حسب السيولة وحجم التداول؛ لذلك لن أستبدل هذا الترتيب بقائمة الأسهم الأعلى ارتفاعاً أو بنتائج التجميع. أقدر أعرض أسهم التجميع المؤسسي (Wyckoff) أو أعلى الأسهم ارتفاعاً في السعر.`
                : plan.request.clarification_reason
            : buildDeterministicResponse(userMessage, plan, []);
        const safeResponse = response || "اختار المقصود من الخيارات عشان أستخدم الأداة المناسبة.";
        yield { type: "token", data: safeResponse };
        await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
        yield {
            type: "done",
            data: {
                response: safeResponse,
                session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: userMessage },
                suggested_buttons: plan.clarification_options || [],
                tables: [],
            }
        };
        return;
    }

    // ===== STAGE 4: Tools and Data Fetching =====
    if (plan.needs_live_data || plan.needs_historical_data) {
        const isSingleStockLive = isEgxSessionOpen() && plan.tools.includes("get_stock") && plan.entities.symbols.length > 0;
        yield {
            type: "status",
            data: {
                status: "tools",
                message: isSingleStockLive
                    ? "⏳ جاري تحديث بيانات السهم اللحظية وحساب المؤشرات الفنية من الجلسة..."
                    : (plan.tools.includes("search_web") ? "البحث على الإنترنت في مصادر فعلية..." : "جلب بيانات السوق...")
            }
        };
    }
    ensureBudget(8000);
    let tools = options.mockToolsResults ?? await withExecutionTimeout(AI_CONFIG.limits.toolsTimeoutMs,
        () => executeStructuredTools(supabase, plan, apiKeys, userId, sessionId, userMessage, history, userIsPro));
    const hybridAdditionalTools = options.mockToolsResults ? [] : await reviewHybridToolResults(userMessage, plan, tools, sessionState);
    tools = await executeHybridAdditionalTools(supabase, plan, tools, hybridAdditionalTools, apiKeys, userId, sessionId, userMessage, history, userIsPro);
    tools = attachEvidenceContract(intersectHybridScanResults(tools, plan));
    const verifiedPortfolioSnapshot = tools.results.find(result => result.tool === "manage_portfolio"
        && !result.error && result.data?.ok === true && Array.isArray(result.data?.positions));
    const actualPortfolioSymbols = Array.from(new Set<string>((verifiedPortfolioSnapshot?.data?.positions || [])
        .map((position: any) => String(position.symbol || "").toUpperCase()).filter(Boolean)));
    if (portfolioAnalysisSymbols.length > 0 && (!verifiedPortfolioSnapshot
        || actualPortfolioSymbols.length !== portfolioAnalysisSymbols.length
        || actualPortfolioSymbols.some((symbol: string) => !portfolioAnalysisSymbols.includes(symbol)))) {
        const response = "تعذر التحقق من تفاصيل محفظتك حالياً، فلا أقدر أربط التحليل بمراكزك وتكلفتها بشكل موثوق. جرّب السؤال مرة أخرى.";
        yield { type: "done", data: { response, session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: userMessage }, tables: [] } };
        return;
    }
    // Every successful tool path must reach the publication reviewer, including
    // transactional portfolio responses that return before the LLM stage.
    yield { type: "tools_data", data: tools };
    if (plan.intent === "portfolio_management") {
        const portfolioResult = tools.results.find(result => result.tool === "manage_portfolio");
        if (portfolioResult) {
            const data = portfolioResult.data || {};
            const response = plan.entities.portfolio_operation === "view"
                ? formatPortfolioSnapshotResponse(data)
                : String(data.message || "تم تنفيذ عملية المحفظة بنجاح.");
            yield { type: "token", data: response };
            await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
            await persistPortfolioAwaitingState(supabase, sessionId, userId, String(plan.entities.portfolio_operation || ""), data);
            yield { type: "done", data: { response, session_update: { current_symbol: sessionState.current_symbol, last_symbols: portfolioResult.symbols || sessionState.last_symbols, summary: response }, tables: buildExcelTables(tools.results, vision) } };
            return;
        }
        const response = "تعذر تنفيذ طلب المحفظة حالياً لأن أداة المحفظة لم تُرجع نتيجة. جرّب مرة أخرى.";
        yield { type: "done", data: { response, session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: userMessage }, tables: [] } };
        return;
    }

    if (portfolioAnalysisSymbols.length > 0 || isPortfolioAnalysisRequest(userMessage)) {
    const portfolioAnalysisReply = buildDeterministicPortfolioAnalysisResponse(userMessage, plan, tools.results);
        if (portfolioAnalysisReply) {
            await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
            const portfolioResult = tools.results.find(result => result.tool === "manage_portfolio");
            const responseLines = portfolioAnalysisReply.split("\n");
            for (let i = 0; i < responseLines.length; i++) {
                const line = responseLines[i];
                const token = i === responseLines.length - 1 ? line : `${line}\n`;
                yield { type: "token", data: token };
            }
            yield {
                type: "done",
                data: {
                    response: portfolioAnalysisReply,
                    session_update: {
                        current_symbol: sessionState.current_symbol,
                        last_symbols: portfolioResult?.symbols || portfolioAnalysisSymbols || sessionState.last_symbols,
                        summary: userMessage,
                    },
                    tables: buildExcelTables(tools.results, vision),
                },
            };
            return;
        }
    }
    // Only interpret a numeric bound when attached to its metric. A price,
    // holding period, or volume bound must not become a Wyckoff-score filter.
    if (userMessage) {
        const filterMessage = normalizeArabicIntent(userMessage);
        const volMatch = filterMessage.match(/(?:نسبه\s+الحجم|الحجم\s+النسبي|حجم\s+نسبي|vol(?:ume)?\s*ratio)\s*(?:اعلي|اكبر|اكثر|فوق|>)\s*(?:من\s*)?(\d+(?:\.\d+)?)/i);
        const minVol = volMatch ? parseFloat(volMatch[1]) : 0;
        
        tools.results.forEach(res => {
            if (res.tool === "get_accumulation_stocks" || res.tool === "get_distribution_stocks") {
                const scoreField = res.tool === "get_accumulation_stocks" ? "acc_score" : "dist_score";
                const daysField = res.tool === "get_accumulation_stocks" ? "consecutive_acc_days" : "consecutive_dist_days";
                const metric = res.tool === "get_accumulation_stocks" ? "تجميع" : "تصريف";
                const scoreMatch = filterMessage.match(new RegExp(`(?:درجه\\s+(?:ال)?${metric}|${metric}|${scoreField})\\s*(?:اعلي|اكبر|اكثر|فوق|>)\\s*(?:من\\s*)?(\\d+(?:\\.\\d+)?)`, "i"));
                const minScore = scoreMatch ? Number(scoreMatch[1]) : 0;
                const consecutive = filterMessage.match(new RegExp(`(?:ال)?${metric}\\s*(?:متتالي\\s*)?(?:لـ?\\s*)?(يومين|\\d+\\s*(?:ايام|يوم))`, "i"));
                const daysMatch = consecutive?.[1] === "يومين" ? 2 : consecutive ? parseInt(consecutive[1], 10) : 0;
                
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
                const performance = res.data?.performance;
                if (Array.isArray(performance?.details)) {
                    const symbols = new Set((res.data.stocks || []).map((s: any) => String(s.symbol).toUpperCase()));
                    const details = performance.details.filter((row: any) => symbols.has(String(row.symbol).toUpperCase()));
                    res.data.performance = {
                        ...performance, details, total_evaluated: details.length,
                        missing_prices: symbols.size - details.length,
                        rising_count: details.filter((row: any) => row.return_pct > 0).length,
                        falling_count: details.filter((row: any) => row.return_pct < 0).length,
                        flat_count: details.filter((row: any) => row.return_pct === 0).length,
                    };
                }
                if (res.availability === "available" && res.data?.stocks?.length === 0) res.availability = "empty";
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
    const hasAccTool = tools.results.some(r => r.tool === "get_accumulation_stocks");
    const hasDistTool = tools.results.some(r => r.tool === "get_distribution_stocks");
    const isBothScans = hasAccTool && hasDistTool;
    const directionAr = isBothScans ? "تجميع وتصريف" : (plan.entities.scan_direction === "distribution" ? "تصريف" : "تجميع");

    // Market rankings and liquidity summaries are ordinary data-backed answers:
    // let the configured responder explain the fetched facts in the user's terms.
    const deterministicLiquidityResponse = null;
    const isAnalyticalQueryRegex = /(سبب|ليه|لماذا|ازاي|إزاي|تفسير|سر|ينزل|يهبط|يطلع|صعود|هبوط|فرص|أحسن|احسن|افضل|أفضل|توقعات|متوقع|مقارن|قارن|حالة|حالتها|رايك|رأيك|توجيه|تجميع|تصريف|تحليل|شراء|بيع|مناسب|مكمل|مستمر|جلسه|جلسة|غدا|غداً|اشترى|اشتري|اشتريت|خسران|نازل|عادله|عادلة|تقييم|قيمته|تسوى|تساوي|أهداف|اهداف|احتفاظ|خروج|دخول|بيجمع|ينطلق|مؤشر|مؤشرات|اخبار|أخبار|إيه|ايه|هل|فين|مين|مسح|شروط|\?|؟)/i;
    const isAnalyticalQuery = isAnalyticalQueryRegex.test(userMessage) || userMessage.trim().split(/\s+/).length > 4;
    
    const hasScanTool = tools.results.some(res => res.tool === "get_accumulation_stocks" || res.tool === "get_distribution_stocks");
    const isMarketWideScan = hasScanTool && mergedSymbols.length === 0 && !tools.results.some(r => r.tool === "get_recommendations" || r.tool === "get_market");

    // Check if scan filters resulted in 0 stocks on a market-wide scan to prevent LLM hallucinations
    let emptyScanResult = false;
    let scanStale = false;
    let scanDate: string | null = null;

    if (isMarketWideScan) {
        if (isBothScans) {
            // When both accumulation and distribution are requested, buildBothAccumulationDistributionResponse
            // handles presentation. Only flag as empty scan if BOTH tools return 0 stocks.
            const accRes = tools.results.find(r => r.tool === "get_accumulation_stocks");
            const distRes = tools.results.find(r => r.tool === "get_distribution_stocks");
            const accEmpty = !Array.isArray(accRes?.data?.stocks) || accRes.data.stocks.length === 0;
            const distEmpty = !Array.isArray(distRes?.data?.stocks) || distRes.data.stocks.length === 0;
            if (accEmpty && distEmpty) {
                emptyScanResult = true;
                if (accRes?.data?.date) scanDate = String(accRes.data.date);
                else if (distRes?.data?.date) scanDate = String(distRes.data.date);
            }
        } else {
            const targetTool = plan.entities.scan_direction === "distribution" ? "get_distribution_stocks" : "get_accumulation_stocks";
            const targetRes = tools.results.find(r => r.tool === targetTool) || tools.results.find(r => r.tool === "get_accumulation_stocks" || r.tool === "get_distribution_stocks");
            if (targetRes && Array.isArray(targetRes.data?.stocks) && targetRes.data.stocks.length === 0) {
                emptyScanResult = true;
                if (targetRes.data?.validation && !targetRes.data.validation.ok) scanStale = true;
                if (targetRes.data?.date) scanDate = String(targetRes.data.date);
            }
        }
        if (!vision && visionError) {
            return {
                vision: null,
                memory: null,
                plan: generalChatPlan(sessionState) as any,
                tools: { results: [], formattedText: "" },
                response: "الصورة وصلت، لكن خدمة قراءة الصورة اتأخرت ولم أقدر أتحقق من الأسهم بأمان. مش هسجل أي سهم أو رقم قديم بالخطأ. ابعت الصورة مرة تانية أو اكتب الرموز والكميات ومتوسط الشراء يدوياً.",
                session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: "فشل مؤقت في قراءة صورة المحفظة" },
                vision_error: visionError,
                tables: [],
            };
        }
    }

    const scanResults = tools.results.filter(r => r.tool === "get_accumulation_stocks" || r.tool === "get_distribution_stocks");
    const scanFailed = scanResults.some(r => r.availability === "failed" || r.error);
    const scanMissing = scanResults.some(r => r.source === "empty" || r.data?.coverage === "missing");
    scanStale ||= scanResults.some(r => r.availability === "stale");
    const deterministicDomainResponse = emptyScanResult
        ? scanFailed
            ? "تعذر جلب بيانات المسح حالياً. لا يمكنني استنتاج وجود أو غياب التجميع والتصريف من فشل الاتصال بمصدر البيانات."
            : scanMissing
                ? "لا تتوفر بيانات مسح كافية للنطاق أو الفترة المطلوبة. نقص البيانات لا يعني عدم وجود تجميع أو تصريف في السوق."
                : scanStale
            ? `آخر مسح ${directionAr} متاح بتاريخ ${scanDate || "غير محدد"} قديم؛ لا يكفي للحكم على حالة السوق الحالية.`
            : plan.entities.min_acc_score != null || plan.entities.min_vol_ratio != null || plan.entities.max_dist_score != null || plan.entities.min_consecutive_acc_days != null
                ? `عذراً، لم أجد أي أسهم تطابق الشروط التي حددتها حالياً. يمكنك محاولة تخفيف الشروط (مثل تقليل درجة ${directionAr} المطلوبة أو نسبة الحجم) للحصول على نتائج.`
                : `لم تظهر أسهم مطابقة لمعايير ${directionAr} ضمن بيانات المسح المتاحة بتاريخ ${scanDate || "غير محدد"}. هذه نتيجة العينة والمعايير المستخدمة، وليست حكماً على السوق كله.`
        : null;

    // Build dual scan presentation when both accumulation and distribution tools have results
    const deterministicBothScanResponse = null;

    // These templates are grounded directly in the returned tool rows. Keeping
    // them ahead of the responder prevents unsupported claims about liquidity
    // and prevents database closes from being described as live prices.
    const deterministicResponse = deterministicDomainResponse || deterministicBothScanResponse || deterministicLiquidityResponse;
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
    if (tools.results.length === 0 && unresolvedStockName && plan.entities.symbols.length === 0) {
        const unknownStockResponse = `لم أجد شركة بهذا الاسم («${unresolvedStockName}») في قاعدة بيانات البورصة المصرية المتاحة لي، لذلك لن أحلل سهمًا آخر بدلًا منه. تأكد من كتابة الاسم كما هو معروف في السوق أو اكتب الرمز اللاتيني (مثل AMES أو COMI)، ولو كانت الشركة غير مدرجة في EGX فهي خارج تغطية النظام حاليًا.`;
        yield { type: "token", data: unknownStockResponse };
        await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
        yield { type: "done", data: { response: unknownStockResponse, session_update: { current_symbol: null, last_symbols: sessionState.last_symbols || [], summary: userMessage, current_sector: plan.entities.sector || sessionState.current_sector || null }, tables } };
        return;
    }

    // Bare ticker matching no listed stock — say it is not covered instead of
    // running empty tools and serving a degraded fallback with junk web snippets.
    if (unrecognizedTicker) {
        const ticker = userMessage.trim().replace(/[؟?\s.]+$/, "").toUpperCase();
        const uncoveredResponse = `الرمز ${ticker} غير موجود في تغطية النظام حالياً (غير مدرج في قاعدة أسهم البورصة المصرية المتاحة لي)، ولن أخمن بياناته. تأكد من كتابة الرمز بشكل صحيح (مثل COMI أو AMES)، أو اكتب اسم الشركة بالعربي وسأحاول التعرف عليه.`;
        yield { type: "token", data: uncoveredResponse };
        await persistPipelineSession(sessionState, sessionSummary, plan, vision, memory, sessionId, userId, supabase, hasImages);
        yield { type: "done", data: { response: uncoveredResponse, session_update: { current_symbol: null, last_symbols: sessionState.last_symbols || [], summary: userMessage, current_sector: sessionState.current_sector || null }, tables } };
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
    const maxAttempts = remainingExecutionMs() > 18000 ? 3 : 2;
    let correctionPrompt: string | undefined = undefined;
    let finalReply = "";
    const answerFacts = buildFactRecords(tools.results);

    const responderMeta: { source?: "llm" | "deterministic"; degraded?: boolean } = {};
    const marketGainersResult = tools.results.find(result => result.tool === "get_market");
    const verifiedGainers = Array.isArray(marketGainersResult?.data?.top_gainers)
        ? marketGainersResult.data.top_gainers.filter((stock: any) => Number.isFinite(Number(stock?.change ?? stock?.change_pct)))
        : [];
    const verifiedTopMovers = marketGainersResult && verifiedGainers.length > 0
        ? [
            `أقوى الأسهم ارتفاعاً حسب آخر جلسة متاحة بتاريخ ${marketGainersResult.data_time}:`,
            ...verifiedGainers.slice(0, 10)
                .map((stock: any, index: number) => `${index + 1}. ${stock.symbol}${stock.name && stock.name !== stock.symbol ? ` (${stock.name})` : ""}: ${Number(stock.change ?? stock.change_pct) >= 0 ? "+" : ""}${Number(stock.change ?? stock.change_pct).toFixed(2)}%.`),
            "الترتيب حسب نسبة التغير في الجلسة، وليس توصية شراء أو تقييماً للقيمة العادلة."
        ].join("\n")
        : null;

    while (attempts < maxAttempts) {
        if (remainingExecutionMs() < 5000) {
            responderMeta.source = "deterministic";
            responderMeta.degraded = true;
            finalReply = (plan.ranking_metric === "price_change" ? buildTopMoversResponse(tools) : null)
                || buildSafeFallbackResponse(tools.results, plan, userMessage);
            break;
        }
        let currentResponse = "";

        responderMeta.source = undefined;
        responderMeta.degraded = false;
        let userIsPro = false;
        try {
            if (userId && supabase) {
                const { data: subData } = await supabase.from("subscriptions").select("plan_id,status,current_period_end").eq("user_id", userId).limit(5);
                userIsPro = isPro(subData || []);
            }
        } catch {
            userIsPro = false;
        }

        const activeSymbolsCount = Math.max(
            portfolioAnalysisSymbols.length,
            Array.isArray(plan.entities.symbols) ? plan.entities.symbols.length : 0
        );

        const dynamicResponseTokens = userIsPro
            ? AI_CONFIG.limits.proResponseTokens
            : activeSymbolsCount >= AI_CONFIG.limits.portfolioResponseTokens.largePortfolioMinSymbols
                ? AI_CONFIG.limits.portfolioResponseTokens.large
                : activeSymbolsCount >= 3
                    ? AI_CONFIG.limits.portfolioResponseTokens.medium
                    : activeSymbolsCount >= 1
                        ? AI_CONFIG.limits.responseMaxTokens
                        : undefined;

        const stream = generateV2Stream(
            userMessage, plan, vision, tools.results,
            scopedMemory,
            memory?.recent_messages || [],
            memory?.resolved_references || { symbol: null, message_id: null, confidence: 0 },
            apiKeys,
            requestedModel,
            sessionState,
            correctionPrompt,
            responderMeta,
            dynamicResponseTokens
        );

        // A market ranking fallback is still grounded in the live tool result,
        // so it remains useful even when every configured language provider is down.
        for await (const chunk of stream) {
            // Preserve all answer sections and tables for validation. Removing
            // whole lines based on presentation phrases can delete requested facts.
            currentResponse += chunk;
        }

        currentResponse = currentResponse.trim();
        if (plan.ranking_metric === "price_change" && responderMeta.source === "deterministic" && responderMeta.degraded && verifiedTopMovers
            && plan.tools.includes("get_market")) {
            finalReply = verifiedTopMovers;
            break;
        }

        // Deterministic replies are template-built from live tool data — re-validating
        // them only wastes an attempt cycle. A degraded fallback (all providers failed)
        // gets one cheap retry: models in 429 cooldown are skipped instantly, so the
        // retry only costs time when a short rate-limit window expired and a model recovered.
        if (responderMeta.source === "deterministic") {
            if (responderMeta.degraded && plan.ranking_metric === "price_change") {
                finalReply = buildTopMoversResponse(tools) || currentResponse;
                break;
            }
            if (!responderMeta.degraded || attempts >= maxAttempts - 1) {
                finalReply = currentResponse;
                break;
            }
            // Wait out short per-minute rate-limit windows so the retry can recover
            // a natural reply; long storms (daily quota etc.) fail fast with the template.
            const cooldownMs = getResponderCooldownMs();
            if (cooldownMs + 5500 >= remainingExecutionMs() || remainingExecutionMs() < 20000) {
                console.warn("[VALIDATOR] Insufficient execution time or long cooldown for LLM retry — serving deterministic reply");
                finalReply = currentResponse;
                break;
            }
            if (cooldownMs > 0) {
                const waitMs = cooldownMs + 500;
                const signal = getExecutionSignal();
                await new Promise<void>((resolve, reject) => {
                    const cleanup = () => signal?.removeEventListener("abort", abort);
                    const timer = setTimeout(() => { cleanup(); resolve(); }, waitMs);
                    const abort = () => { clearTimeout(timer); cleanup(); reject(signal?.reason || new Error("EXECUTION_ABORTED")); };
                    signal?.addEventListener("abort", abort, { once: true });
                    if (signal?.aborted) abort();
                });
            }
            attempts++;
            continue;
        }

        // Run validation
        currentResponse = autoFixNumbers(currentResponse, tools.results);
        const validation = validateResponse(currentResponse, liveDataString, validSymbols, tools.results, userMessage, plan.intent);
        const answerGate = runAnswerGate({ reply: currentResponse, plan, toolResults: tools.results, userMessage, facts: answerFacts, history: memory?.recent_messages || history });
        if (validation.isValid && answerGate.ok) {
            finalReply = currentResponse;
            break;
        }

        // If it is the last attempt and still invalid, fall back to safe response
        if (attempts === maxAttempts - 1) {
            responderMeta.source = "deterministic";
            responderMeta.degraded = true;
            console.warn(`[VALIDATOR] Attempt ${attempts + 1} failed validation! Reached max retries. Using safe fallback. Context: ${answerGate.reasons.join("; ")}; Det Errors: ${validation.deterministicErrors?.join("; ")}`);
            // Preserve the user's exact intent when the model exhausts its
            // validation retries. The intent-aware deterministic renderer can
            // answer questions such as daily limits and period highs from the
            // same verified tool facts; the generic table is only a last resort.
            finalReply = buildDeterministicResponse(userMessage, plan, tools.results, sessionState)
                || buildSafeFallbackResponse(tools.results, plan, userMessage);
            break;
        }

        // If invalid, log warning and set correction prompt
        console.warn(`[VALIDATOR] Attempt ${attempts + 1} failed validation! Suspicious Symbols: ${validation.suspiciousSymbols.join(", ")}, Suspicious Numbers: ${validation.suspiciousNumbers.join(", ")}, Has Repetitions: ${validation.hasRepetitions}, Det Errors: ${validation.deterministicErrors?.join("; ")}, EnglishThinking: ${Boolean(validation.englishThinking)}, Context: ${answerGate.reasons.join("; ")}`);
        
        yield { type: "status", data: { status: "generating", message: `كشف أخطاء في الرد (محاولة ${attempts + 1})، جاري إعادة الصياغة تلقائياً...` } };
        
        correctionPrompt = "تنبيه هام ومؤكد للالتزام بالبيانات:\n";
        correctionPrompt += buildGateCorrectionBlock(answerGate.reasons);
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

            const hasWyckoffError = validation.deterministicErrors.some(e => e.includes("تجميع") || e.includes("تصريف") || e.includes("Wyckoff"));
            const hasPriceLevelError = validation.deterministicErrors.some(e => e.includes("تضارب في سعر") || e.includes("تضارب في قيمة الدعم") || e.includes("تضارب في قيمة المقاومة"));

            if (hasWyckoffError) {
                correctionPrompt += `- لقد ادّعيت مرحلة تجميع أو تصريف Wyckoff دون وجود بيانات مسح حقيقية:\n`;
                correctionPrompt += `  * الصياغة الصحيحة الوحيدة المسموح بها عند غياب بيانات Wyckoff هي:\n`;
                correctionPrompt += `    "بيانات مسح Wyckoff غير متاحة لهذا السهم حالياً، لذا لا يمكن تحديد مرحلة التجميع أو التصريف."\n`;
                correctionPrompt += `  * بعد هذه الجملة يمكنك تقديم التحليل الفني العادي (RSI، الدعم، المقاومة، الحجم) فقط.\n`;
                correctionPrompt += `  * يمنع تماماً استخدام كلمات: "مرحلة تجميع"، "سيولة تجميعية"، "عليه تجميع" إلا إذا كان acc_score > 0 في البيانات.\n`;
            }

            if (hasPriceLevelError) {
                correctionPrompt += `- لقد استخدمت قيمة خاطئة كسعر دعم أو مقاومة:\n`;
                correctionPrompt += `  * ⛔ يمنع تماماً استخدام acc_score أو dist_score أو consecutive_days كأسعار — هذه مؤشرات (0-100) أو أعداد أيام وليست أسعار.\n`;
                correctionPrompt += `  * مستويات الأسعار الصحيحة الوحيدة: support وresistance وsma_50 وsma_200 وbb_upper وbb_lower من حقول FACTS فقط.\n`;
                const priceErrors = validation.deterministicErrors.filter(e => e.includes("تضارب في سعر") || e.includes("تضارب في قيمة الدعم") || e.includes("تضارب في قيمة المقاومة"));
                priceErrors.forEach(err => {
                    correctionPrompt += `  * ${err}\n`;
                });
            }

            if (!hasWyckoffError && !hasPriceLevelError) {
                correctionPrompt += `- لقد ذكرت معلومات تتعارض مع حقائق قاعدة البيانات:\n`;
                validation.deterministicErrors.forEach(err => {
                    correctionPrompt += `  * ${err}\n`;
                });
                correctionPrompt += `يمنع تماماً الاستنتاج الضمني (Implicit Inference) لأي زخم أو مرحلة تداول إلا بوجود الدليل الصريح. التزم حرفياً بالقيم المعطاة في البيانات فقط!\n`;
            }
        }


        if (validation.hasRepetitions) {
            correctionPrompt += `- لقد قمت بتكرار نفس العبارات أو الجمل بشكل متكرر غير طبيعي. أعد صياغة الرد بلغة عربية سلسلة ومتنوعة وبدون تكرار أي عبارة أو سطر.\n`;
        }
        correctionPrompt += "أعد صياغة الرد بالكامل مع الالتزام التام ببيانات الجدول والبيانات الحقيقية المعطاة فقط وبدون أي أرقام أو رموز خارجية.";

        attempts++;
    }

    let fullResponse = normalizeStockFreshnessLanguage(
        plan.ranking_metric === "price_change" && verifiedTopMovers && responderMeta.degraded && finalReply === verifiedTopMovers
            ? verifiedTopMovers
            : sanitizeReply(finalReply),
        tools.results
    );

    // 🛡️ Final safety net: if the reply is not an Arabic answer (e.g. leaked
    // English chain-of-thought survived all attempts), use the safe Arabic fallback.
    const finalArabicChars = (fullResponse.match(/[\u0600-\u06FF]/g) || []).length;
    if (finalArabicChars < 30) {
        responderMeta.source = "deterministic";
        responderMeta.degraded = true;
        console.warn("[VALIDATOR] Final reply lacks Arabic content — using safe fallback");
        fullResponse = sanitizeReply(
            buildDeterministicResponse(userMessage, plan, tools.results, sessionState)
            || buildSafeFallbackResponse(tools.results, plan, userMessage)
        );
    }

    // If response was already produced deterministically (e.g. portfolio engine or fallback),
    // do not run the LLM-oriented AnswerGate against it to prevent overwriting accurate calculated math.
    if (responderMeta.source !== "deterministic") {
        const preSendGate = runAnswerGate({ reply: fullResponse, plan, toolResults: tools.results, userMessage, facts: answerFacts, history });
        if (!preSendGate.ok) {
            responderMeta.source = "deterministic";
            responderMeta.degraded = true;
            console.warn(`[ANSWER_GATE] Rejected final response: ${preSendGate.reasons.join("; ")}`);
            const deterministicAlt = buildDeterministicResponse(userMessage, plan, tools.results, sessionState);
            if (deterministicAlt) {
                fullResponse = deterministicAlt;
            } else {
                const portfolioSnapshot = tools.results.find(result => result.tool === "manage_portfolio"
                    && !result.error && result.data?.ok === true && Array.isArray(result.data?.positions));
                fullResponse = (plan.entities.portfolio_operation === "view" || isPortfolioAnalysisRequest(userMessage)) && portfolioSnapshot
                    ? `${formatPortfolioSnapshotResponse(portfolioSnapshot.data)}\n\nتعذر إكمال التحليل الفني لكل المراكز بصورة موثوقة حالياً؛ أعد طلب التحليل بعد قليل.`
                    : safeEvidenceResponse(userMessage, tools.results, plan);
            }
        }
    }

    // 📢 Ensure the free Telegram channel footer is appended to every response
    const TELEGRAM_CHANNEL_FOOTER = "📢 [قناة EGX Bots المجانية على تليجرام للتنبيهات والفرص](https://t.me/egxbots)";
    if (fullResponse && !fullResponse.includes("t.me/egxbots") && !fullResponse.includes("t.me/")) {
        fullResponse = `${fullResponse.trim()}\n\n${TELEGRAM_CHANNEL_FOOTER}`;
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

    const finalSymbols = clearsStockContext(plan) ? [] : Array.from(allSymbols).filter(Boolean);
    const sessionUpdate = {
        current_symbol: clearsStockContext(plan) || finalSymbols.length > 1 ? null : (finalSymbols[0] || sessionState.current_symbol),
        last_symbols: clearsStockContext(plan) ? [] : Array.from(new Set([...finalSymbols, ...(sessionState.last_symbols || [])])).slice(0, 15),
        summary: userMessage || (hasImages ? "تحليل صورة" : null),
        current_sector: plan.entities.sector || sessionState.current_sector || null
    };

    await updateSessionState(supabase, sessionId, userId, sessionUpdate);

    const summaryUpdate: Partial<SessionSummary> = {
        current_symbols: finalSymbols,
        last_data_date: new Date().toISOString().split("T")[0]
    };
    if (plan.entities.portfolio_operation === "view") {
        summaryUpdate.last_topic = "portfolio";
    }
if (vision) {
        summaryUpdate.last_image_symbols = vision.symbols.map(s => s.symbol);
        summaryUpdate.last_vision_context = vision;
        summaryUpdate.last_topic = vision.image_type;
    } else if (finalSymbols.length > 0 || clearsStockContext(plan)) {
        // A newer explicit text symbol supersedes an older image reference.
        summaryUpdate.last_image_symbols = [];
    }
    // Record the newest explicit symbol reference (image or text) for "ده".
    if (vision?.symbols?.length) {
        summaryUpdate.last_reference_symbol = vision.symbols.length === 1 ? vision.symbols[0]?.symbol : null;
        summaryUpdate.last_reference_source = "image";
        summaryUpdate.last_reference_at = new Date().toISOString();
    } else if (finalSymbols.length > 0) {
        summaryUpdate.last_reference_symbol = finalSymbols.length === 1 ? finalSymbols[0] : null;
        summaryUpdate.last_reference_source = "text";
        summaryUpdate.last_reference_at = new Date().toISOString();
    }
    if (clearsStockContext(plan)) {
        summaryUpdate.open_references = [];
        summaryUpdate.last_reference_symbol = null;
        summaryUpdate.last_reference_source = null;
        summaryUpdate.last_reference_at = null;
        summaryUpdate.last_image_symbols = [];
        summaryUpdate.last_vision_context = null;
    } else if (memory?.resolved_references?.symbol) {
        summaryUpdate.open_references = [memory.resolved_references.symbol];
    }
    await updateSessionSummary(supabase, sessionId, userId, summaryUpdate);
    yield { type: "done", data: { response: fullResponse, session_update: sessionUpdate, tables,
        response_origin: responderMeta.source === "llm" ? "llm" : responderMeta.degraded ? "fallback" : "deterministic" } };
    } catch (err: any) {
        console.error("Pipeline stream error caught:", err);
        const isTimeout = /PIPELINE_DEADLINE_EXCEEDED|DEADLINE|Timeout|AbortError/i.test(err?.message || "");
        const fallbackText = isTimeout
            ? "معذرة، استغرق التحليل وقتًا أطول من المتوقع نظرًا لضغط السيرفرات حالياً. يرجى إعادة إرسال السؤال أو تجربة السؤال بدون صورة للحصول على رد فوري."
            : "حدث خطأ أثناء معالجة الطلب، يرجى إعادة المحاولة مرة أخرى.";

        yield { type: "token", data: fallbackText };
        yield { type: "done", data: {
            response: fallbackText,
            response_origin: "fallback",
            degraded: true,
            session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: sessionState.summary },
            tables: []
        } };
    }
}

import { ToolResult } from "./types";

function hasMeaningfulData(result: ToolResult): boolean {
    if (result.source === "empty") return false;
    if (!result.data || typeof result.data !== "object") return false;
    if (Array.isArray(result.data)) return result.data.length > 0;
    const keys = Object.keys(result.data);
    if (keys.length === 0) return false;
    if (keys.length === 1 && result.data.symbol) return false;
    return true;
}

 function buildSafeFallbackResponse(toolsResults: ToolResult[], plan: IntentPlan, userMessage: string): string {
     const asksRecommendations = asksForRecommendationEvidence(userMessage, plan);
     const asksMarketOverview = (isMarketWideRequest(userMessage) && !isBestBuyStockQuestion(userMessage))
         || /(?:الدولار كام|سعر الدولار|usd\/egp|egp\/usd)/i.test(normalizeArabicIntent(userMessage));
     const normalizedMessage = normalizeArabicIntent(userMessage);
     const asksAccumulation = asksForAccumulationEvidence(userMessage, plan);
     const asksDistribution = /(?:تصريف|distribution)/i.test(normalizedMessage);
     const sectorLiquidity = toolsResults.find(result => result.tool === "get_sector_liquidity"
         && /(?:سيول|تداول|قطاع)/i.test(normalizeArabicIntent(userMessage)));
     if (sectorLiquidity) {
         return buildDeterministicResponse("سيولة القطاعات", plan, toolsResults)
             || "تعذر صياغة ملخص سيولة القطاعات، لكن البيانات الموثقة متاحة في الجدول.";
     }
      const isSectorScoped = plan.tools.includes("get_sector_liquidity") || plan.tools.includes("get_sector_list") || plan.intent === "sector_analysis";
      const stockResult = toolsResults.find(result => result.tool === "get_stock" && hasMeaningfulData(result) && result.data?.symbol);
      const symbol = isSectorScoped ? null : (stockResult?.data?.symbol || plan.entities.symbols?.[0] || null);
     
     const otcNotice = symbol && isOtcStock(symbol) ? buildOtcNotice(symbol) : null;

     const hasMultiStockIntent = plan.entities.symbols.length >= 2 || plan.intent === "comparison" || toolsResults.some(r => r.tool === "get_comparison");
     const titleLine = hasMultiStockIntent && plan.entities.symbols.length >= 2
         ? `البيانات الفنية والتحليلية المعتمدة للأسهم (${plan.entities.symbols.join(" و")}):`
         : (symbol ? `البيانات الفنية والتحليلية المعتمدة لسهم ${symbol}:` : "البيانات الفنية والتحليلية المعتمدة:");

     const lines = [
         titleLine,
         otcNotice ? `\n${otcNotice}\n` : ""
     ];

     let hasContent = false;

     if (asksRecommendations) {
         const locked = toolsResults.find(r => (r.tool === "get_recommendations" || r.tool === "get_signals") && r.pro_locked);
         if (locked?.error) {
             lines.push(locked.error);
             hasContent = true;
         }
     }

    if (Array.isArray(toolsResults)) {
        toolsResults.forEach(r => {
            if (!hasMeaningfulData(r)) return;
            if (r.tool === "get_accumulation_stocks" && !asksAccumulation) return;
            if (r.tool === "get_distribution_stocks" && !asksDistribution) return;
            if ((r.tool === "get_recommendations" || r.tool === "get_signals") && !asksRecommendations) return;
            if (r.tool === "get_market" && !asksMarketOverview) return;
            if (r.tool === "get_stock" && r.data?.symbol) {
                hasContent = true;
                const d = r.data;
                const isLive = r.data_type === "live" && d.is_live_intraday;
                lines.push(`📊 **${isLive ? "بيانات التداول اللحظية" : "أحدث بيانات التداول المسجلة"} لـ ${d.symbol}:**`);
                lines.push(isLive
                    ? `  • السعر اللحظي: ${d.price} جنيه`
                    : `  • آخر إغلاق مسجل: ${d.price} جنيه بتاريخ ${String(r.data_time || "غير محدد").slice(0, 10)}`);
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
                lines.push(`| # | الرمز | الشركة | آخر سعر متاح | سعر بداية الفترة | ${metricCol} |`);
                lines.push(`| :---: | :--- | :--- | :---: | :---: | :---: |`);
                d.market_period_ranking.slice(0, 10).forEach((s: any, idx: number) => {
                    const metricVal = d.wants_liquidity
                        ? (s.liquidity == null || Number(s.liquidity) <= 0
                            ? "غير متاح"
                            : Number(s.liquidity) >= 1_000_000
                                ? `${(Number(s.liquidity) / 1_000_000).toFixed(2)} مليون ج.م`
                                : `${Number(s.liquidity).toFixed(2)} ج.م`)
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
                const relAr = d.direction === "above" ? "فوق القيمة الوسطية" : "تحت القيمة الوسطية";
                const condition = d.require_distribution ? " وتحقق إشارة تصريف" : d.require_accumulation ? " وتحقق إشارة تجميع" : "";
                lines.push(`⚖️ **أسهم تتداول ${relAr} لنطاق 60 جلسة${condition} (مقياس فني لا قيمة عادلة مالية):**`);
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
            if (r.tool === "get_comparison" && Array.isArray(r.data?.comparisons) && r.data.comparisons.length > 0) {
                hasContent = true;
                lines.push(`⚖️ **مقارنة فنية مباشرة بين الأسهم المطلوبة:**`);
                lines.push(`| الرمز | آخر سعر متاح | التغير | مؤشر RSI | مؤشر MACD | نسبة الحجم | الدعم | المقاومة |`);
                lines.push(`| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);
                r.data.comparisons.forEach((s: any) => {
                    const priceStr = s.price != null ? `${s.price} ج.م` : "غير متاح";
                    const changeStr = s.change_pct != null ? `${Number(s.change_pct) >= 0 ? "+" : ""}${s.change_pct}` : "0%";
                    const supStr = s.support != null ? Number(s.support).toFixed(2) : "غير متاح";
                    const resStr = s.resistance != null ? Number(s.resistance).toFixed(2) : "غير متاح";
                    lines.push(`| ${s.symbol} | ${priceStr} | ${changeStr} | ${s.rsi_14 ?? "غير متاح"} | ${s.macd ?? s.macd_signal ?? "غير متاح"} | ${s.vol_ratio ?? "غير متاح"}x | ${supStr} | ${resStr} |`);
                });
                lines.push("");
            }
            if (r.tool === "get_market" && r.data?.summary) {
                hasContent = true;
                const d = r.data;
                lines.push(`📊 **ملخص حركة السوق (مؤشر EGX30):**`);
                lines.push(`  • إغلاق المؤشر: ${d.summary.close} (${d.summary.change_pct}%)`);
                if (Array.isArray(d.top_gainers) && d.top_gainers.length > 0) {
                    lines.push(`  • أنشط الأسهم ارتفاعاً: ${d.top_gainers.slice(0, 3).map((g: any) => `${g.symbol} (+${g.change_pct}%)`).join("، ")}`);
                }
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
                // Aggregator snippets like "خبر منشور في: موقع X" carry no content — drop them.
                const usefulResults = r.data.results.filter((webResult: any) => {
                    const snippet = String(webResult.snippet || "").trim();
                    return webResult.title && snippet.length >= 30 && !/^خبر منشور في/.test(snippet);
                });
                if (usefulResults.length > 0) {
                    hasContent = true;
                    lines.push(`🌐 **معلومات إضافية من الويب:**`);
                    usefulResults.slice(0, 3).forEach((webResult: any) => {
                        lines.push(`  • **${webResult.title}**: ${webResult.snippet}`);
                    });
                }
                lines.push("");
            }
        });
    }

     // No tool produced usable content — say so clearly instead of an empty header + disclaimer.
     // But if tables (built from the same tool results) contain real data, don't contradict
     // the table by saying "no verified data" — acknowledge the table instead.
     if (!hasContent) {
         const availableTables = buildExcelTables(toolsResults, null);
         if (availableTables.length > 0) {
             return "تم توفير البيانات الأساسية في الجدول أعلاه. لم يُنتج تحليل نصي موثوق بعد (جميع محاولات الذكاء الاصطناعي فشلت في اجتياز فحص البيانات). الرجاء الاطلاع على الأرقام مباشرةً واتخاذ القرار بناءً عليها. 📌 الرأي مبني على مؤشرات السعر والزخم والحجم والمستويات الفنية المسجلة، وهو لأغراض استرشادية وليس توصية مباشرة بالشراء أو البيع.";
         }
         return "عذراً، لم تتوفر بيانات موثقة لهذا الطلب من قاعدة البيانات حالياً، لذلك لن أخمن إجابة غير مدعومة بالبيانات. جرّب إعادة صياغة السؤال (مثلاً: سعر سهم معين، أسهم التجميع اليوم، ترتيب الأسهم بالسيولة، أداء القطاعات) وسأعرض النتائج الموثقة المتاحة.\n\n📢 [قناة EGX Bots المجانية على تليجرام للتنبيهات والفرص](https://t.me/egxbots)";
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
    testConfig?: PipelineOptions
): Promise<PipelineResult> {
    const result: PipelineResult = {
        vision: null, memory: null, vision_error: null, tools: { results: [], formattedText: "" },
        plan: {
            intent: "general_chat", confidence: 0,
            entities: { symbols: [], sector: null, timeframe: "unspecified", reference: null },
            needs_vision_context: false, needs_history: false, needs_live_data: false,
            needs_historical_data: false, tools: [], clarification_needed: false,
            resolved_from: { symbol: null, message_id: null },
        },
        response: "", tables: [],
        session_update: { current_symbol: sessionState.current_symbol, last_symbols: sessionState.last_symbols, summary: sessionState.summary },
    };
    for await (const event of runPipelineStream(userMessage, images, sessionState, sessionSummary,
        history, supabase, apiKeys, userId, sessionId, messageId, requestedModel, testConfig)) {
        if (event.type === "plan") result.plan = event.data;
        else if (event.type === "vision_result") result.vision = event.data;
        else if (event.type === "vision_error") result.vision_error = event.data;
        else if (event.type === "memory_result") result.memory = event.data;
        else if (event.type === "tools_data") result.tools = event.data;
        else if (event.type === "done") {
            result.response = event.data.response;
            result.publication_review = event.data.publication_review;
            result.response_origin = event.data.response_origin;
            result.response_task = event.data.response_task ?? null;
            result.session_update = event.data.session_update ?? result.session_update;
            result.tables = event.data.tables ?? [];
        }
    }
    return result;
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
        current_symbol: clearsStockContext(plan) || symbols.length > 1 ? null : (symbols[0] || sessionState.current_symbol),
        last_symbols: clearsStockContext(plan) ? [] : Array.from(new Set([...symbols, ...(sessionState.last_symbols || [])])).slice(0, 15),
        summary: hasImages ? "تحليل صورة" : sessionState.summary,
        current_sector: plan.entities.sector || sessionState.current_sector || null
    };
    await updateSessionState(supabase, sessionId, userId, sessionUpdate);
    const clearsContext = clearsStockContext(plan);
    await updateSessionSummary(supabase, sessionId, userId, {
        current_symbols: symbols,
        last_image_symbols: clearsContext ? [] : vision?.symbols.map(symbol => symbol.symbol) || (symbols.length > 0 ? [] : sessionSummary?.last_image_symbols || []),
        last_topic: vision?.image_type || (plan.entities.portfolio_operation === "view" || plan.intent === "portfolio_management" ? "portfolio" : sessionSummary?.last_topic || null),
        open_references: clearsContext ? [] : memory?.resolved_references?.symbol ? [memory.resolved_references.symbol] : sessionSummary?.open_references || [],
        last_data_date: new Date().toISOString().split("T")[0],
        last_vision_context: clearsContext ? null : vision || sessionSummary?.last_vision_context || null,
        ...(clearsContext ? {
            last_reference_symbol: null,
            last_reference_source: null,
            last_reference_at: null,
        } : vision?.symbols?.length ? {
            last_reference_symbol: vision.symbols.length === 1 ? vision.symbols[0]?.symbol : null,
            last_reference_source: "image" as const,
            last_reference_at: new Date().toISOString(),
        } : symbols.length > 0 ? {
            last_reference_symbol: symbols.length === 1 ? symbols[0] : null,
            last_reference_source: "text" as const,
            last_reference_at: new Date().toISOString(),
        } : {})
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
        "recommendations": "market_summary",
        "accumulation": "stock_analysis",
        "accumulation_distribution": "accumulation_distribution",
        "risk_analysis": "risk_analysis",
        "stock_news": "stock_analysis",
        "historical_recall": "historical_recall",
        "portfolio_management": "portfolio_management",
        "general_chat": "general_chat"
    };
    return intentMap[intent] || "follow_up";
}
