import { IntentPlan, VisionContext, SessionState, SessionSummary, PlannerResult } from "./types";
import { analyzeImage } from "./vision";
import { retrieveRelevantMemory, MemoryResult } from "./memory";
import { runPlanner, getSyncStockMappings, getStocksList } from "./planner";
import { executeStructuredTools, StructuredToolOutput } from "./tools-v2";
import { buildDeterministicResponse, generateV2Response, generateV2Stream } from "./final-v2";
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
    // These are product/platform labels frequently used in Arabic investor questions,
    // not EGX ticker symbols. Treating them as stocks creates empty comparisons.
    const excluded = new Set(["EGX", "NEWS", "TODAY", "LAST", "WEEK", "FROM", "BETWEEN", "RSI", "MACD", "VWAP", "CLOUD", "THNDR"]);
    const explicit = message.match(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{1,9})(?=$|[^A-Za-z0-9])/g)?.map(match => match.replace(/^[^A-Za-z0-9]+/, "")) || [];
    const lowercaseTickers = message.match(/\b[a-z][a-z0-9]{2,5}\b/g) || [];
    
    let matchedSymbols = [...explicit, ...lowercaseTickers];

    // Attempt to match Arabic full names from the mapping
    const stockMappings = getSyncStockMappings();
    // Use word boundaries or strict inclusion to prevent false positives for short words
    const normMsg = message.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
    for (const [arName, symbol] of Object.entries(stockMappings)) {
        const normKey = arName.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
        if (normKey.length >= 2 && normMsg.includes(normKey)) {
            if (Array.isArray(symbol)) {
                matchedSymbols.push(...symbol);
            } else {
                matchedSymbols.push(symbol);
            }
        }
    }

    return Array.from(new Set(
        matchedSymbols
            .map(symbol => symbol.toUpperCase() === "AFID" ? "AFDI" : symbol.toUpperCase())
            .filter(symbol => !excluded.has(symbol))
    ));
}

export type InvestorGuidanceIntent = "onboarding" | "allocation" | "product_comparison" | "product_explainer";

export function getInvestorGuidanceIntent(message: string): InvestorGuidanceIntent | null {
    const normalized = message
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .toLowerCase();
    const symbols = extractExplicitSymbols(message);
    const hasNamedStock = symbols.length > 0;
    const mentionsDefensiveProduct = /(صندوق|صناديق|دخل\s+(?:ال)?ثابت|عائد\s+(?:ال)?يومي|عائد\s+(?:ال)?ثابت|شهاده|وديعة|حساب توفير|سوق المال|money market|cash|cloud|ثاندر|thndr)/i.test(normalized);
    const asksComparison = /(مقارن|قارن|compare|افضل.*ولا|ولا.*افضل|فرق.*بين|(?:سيب|اسيب|احط|اختار).{0,50}ولا)/i.test(normalized);
    const asksHowItWorks = /(بيشتغل.*ازاي|ازاي.*بيشتغل|يعني ايه|ايه.*فكره|فكرة.*ايه|مخاطر.*ايه|امان.*ولا|آمن.*ولا|مضمون.*ولا)/i.test(normalized);
    const asksAllocation = /(محفظ|اوزع|وزع|توزيع|راس المال|رأس المال|كل الفلوس|ميزاني|استثمر|ادخل.*اسهم|اشتري.*اسهم|اشتري.*ايه|اشتري.*اي|فلوسي.*فين)/i.test(normalized);
    const signalsInexperience = /(معنديش خبر|ما عنديش خبر|بدون خبر|مبتدئ|اول مره|ابني|بناء.*محفظ|ابدا.*استثمر|بدايه.*استثمار|(?:عايز|عاوز|مش فاهم|مش عارف).{0,40}(?:استثمار|الاسهم|اسهم|البورصه))/i.test(normalized);

    if (asksComparison && mentionsDefensiveProduct && (hasNamedStock || /سهم|اسهم|الاسهم/.test(normalized))) {
        return "product_comparison";
    }
    if (mentionsDefensiveProduct && asksHowItWorks && !hasNamedStock) {
        return "product_explainer";
    }
    if (asksAllocation && !hasNamedStock) {
        return "allocation";
    }
    if (signalsInexperience && !hasNamedStock) {
        return "onboarding";
    }
    return null;
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

export function buildCompoundDeterministicPlan(message: string, sessionState: SessionState): PlannerResult | null {
    const commands = splitChatCommands(message);
    if (commands.length < 2) return buildDeterministicPlannerResult(message, sessionState);
    let state = { ...sessionState, last_symbols: [...sessionState.last_symbols] };
    const plans = commands.map(command => {
        let plan = buildDeterministicPlannerResult(command, state);
        const sector = extractSectorFromMessage(command) || extractSectorFromMessage(state.summary || "");
        const normalized = command.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
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
    return { ...last, intent: sector ? "sector_analysis" : last.intent, entities: { ...last.entities, symbols, sector }, tools, session_update: { ...last.session_update, current_symbol: symbols[symbols.length - 1] || last.session_update.current_symbol, last_symbols: Array.from(new Set([...symbols, ...state.last_symbols])) } };
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
    if (getInvestorGuidanceIntent(message)) {
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
    const symbols = extractExplicitSymbols(message);
    const temporal = extractTemporalContext(message);
    const marketWideRequest = isMarketWideRequest(message);
    const riskFollowUp = /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(message);
    const hasPreviousReference = /(?:^|[^\u0621-\u064A])(ده|دا|دي|هذا|السهم ده|السهم دا|السهم دي|هاته|هاتها|اخباره|أخباره|خبره|الاتنين|السهمين)(?:$|[^\u0621-\u064A])/i.test(message);
    if (hasPreviousReference && sessionState.current_symbol && !symbols.includes(sessionState.current_symbol)) {
        symbols.unshift(sessionState.current_symbol);
    }
    if (temporal.date && symbols.length === 0 && sessionState.current_symbol && !marketWideRequest) {
        symbols.push(sessionState.current_symbol);
    }
    if (riskFollowUp && symbols.length === 0 && sessionState.current_symbol) {
        symbols.push(sessionState.current_symbol);
    }
    if (/(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(message) && symbols.length === 0 && sessionState.current_symbol) symbols.push(sessionState.current_symbol);
    const sectorReference = /القطاع\s+(?:ده|دا|هذا)/i.test(message) ? sessionState.summary : null;
    const knownSectorFollowUp = /^(?:process industries|finance|health technology|health services|consumer services|consumer durables|consumer non-durables|commercial services|communications|distribution services|electronic technology|energy minerals|industrial services|miscellaneous|non-energy minerals|producer manufacturing|retail trade|technology services|transportation|utilities)$/i.test(message.trim())
        ? message.trim()
        : null;
    let explicitSector = extractSectorFromMessage(message);
    if (symbols.length > 0 && !/(قطاع|القطاع)/i.test(message)) explicitSector = null;
    const sector = knownSectorFollowUp || explicitSector || extractSectorFromMessage(sectorReference || "");
    const hasExplicitLatinTicker = /(?:^|[^A-Za-z0-9])[A-Z][A-Z0-9]{1,9}(?=$|[^A-Za-z0-9])/.test(message);
    if (sector && !hasExplicitLatinTicker && symbols.length === 0 && /(قطاع|القطاعات|البنوك|الاتصالات|العقارات|الادويه|الاغذيه|البترول|الطاقه)/i.test(message)) symbols.length = 0;
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    const isGreeting = /^(?:ازيك|إزيك|عامل ايه|عامل إيه|اهلا|أهلا|مرحبا|السلام عليكم)[؟?،,.!\s]*$/i.test(message.trim()) || /(?:انت|إنت|انتا|أنت).{0,12}(مين|موديل|نموذج)|مين انت|مين إنت/i.test(message);
    const beginnerPortfolioRequest = /(معنديش|ما عنديش).{0,20}(خبره|خبرة).{0,40}(اسهم|الاسهم)|(?:ابني|اعمل|ابدأ).{0,25}(محفظه|محفظة)|صناديق.{0,20}(دخل ثابت|عائد يومي)|(?:اول|أول)\s+يوم.{0,20}(البورصه|البورصة)|عايز\s+افهم\s+اعمل/i.test(normalized);
    const isHistorical = needsHistoricalData("", message);
    const marketNewsRequest = /اخبار\s+(?:السوق|البورصه)/i.test(message);
    const requestedDate = temporal.date;
    const isClearMarketRequest = marketWideRequest || /(أعلى|اعلى|أقوى|اقوى|سيول|السيول|السيوله|تجميع|تصريف|القطاعات|قطاعات|حالة السوق|السوق عمل|دولار|usd)/i.test(normalized);
    const isClearStockRequest = symbols.length > 0 && /(أخبار|اخبار|اخباره|أخباره|خبر|news|مقارن|قارن|compare|تحليل|حلل|شوف|رايكم|رأيكم|رايك|رأيك|سبب|ليه|لماذا|ممكن|ينصح|داخل|دخول|مستهدف|يصحح|بكره|بكرة|اخر الاسبوع|آخر الأسبوع|المحفظه|المحفظة|مليون|السيول|السيوله|سعر|بيع|احتفظ|أحتفظ|اشتري|شراء|يخسر|خسار|يهبط|ينزل|مقاوم|مقاومه|مقوام|دعم|support|resistance|^[\s,،;:/\-a-z0-9]+$)/i.test(message);
    if (!sector && !isGreeting && !beginnerPortfolioRequest && !isHistorical && !requestedDate && !isClearMarketRequest && !isClearStockRequest) return null;

    const enforced = enforceIntentFromMessage(message, symbols.length ? "stock_analysis" : "market_summary", symbols);
    const sectorFollowUp = Boolean(sectorReference && symbols.length === 0);
    const effectiveSector = explicitSector || knownSectorFollowUp || sectorFollowUp ? sector : null;
    return {
        intent: isGreeting || beginnerPortfolioRequest ? "general_chat" : marketNewsRequest ? "market_summary" : requestedDate && symbols.length ? "stock_analysis" : isHistorical ? "historical_recall" : explicitSector || knownSectorFollowUp || sectorFollowUp ? "sector_analysis" : enforced.intent,
        confidence: 1,
        entities: { symbols, sector: effectiveSector, wants_table: !isGreeting, timeframe: temporal.timeframe, requested_date: requestedDate, scan_direction: enforced.scan_direction || null },
        tools: isGreeting || beginnerPortfolioRequest || (isHistorical && !requestedDate && !marketNewsRequest) ? [] : marketNewsRequest ? ["get_news"] : knownSectorFollowUp || sectorFollowUp ? ["get_sector"] : enforced.replaceTools ? enforced.tools : explicitSector ? ["get_sector"] : symbols.length ? ["get_stock"] : [],
        session_update: {
            current_symbol: symbols[0] || sessionState.current_symbol,
            last_symbols: symbols.length ? symbols : sessionState.last_symbols,
            summary: message
        }
    };
}

export function isMarketWideRequest(message: string): boolean {
    const normalized = message.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();
    return isFairValueScanRequest(message) || /(اخبار\s+(السوق|البورصه)|(?:السيول|السيوله)\s+(فين|في\s+السوق|ل?يوم|لبوم|بتاريخ|يوم)|(?:اكبر|اعلى|اقوى)\s+قطاع.{0,20}(سيول|تداول)|حاله\s+السوق|السوق\s+عمل|(?:اقوى|اعلى)\s+الاسهم|(?:كل|جميع).{0,12}(?:اسهم|الاسهم).{0,12}(?:المؤشر|الموشر|موشر).{0,8}30|^(?:و?ال)?(?:تجميع|تصريف)(?:\s+(?:فين|ايه|الاسهم|الأسهم|النهارده|اليوم))?[؟?\s]*$)/i.test(normalized.trim());
}

export function isFairValueScanRequest(message: string): boolean {
    const normalized = message
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .toLowerCase()
        .replace(/[؟?]/g, " ");
    // الصيغة الأساسية: أسهم تتداول فوق القيمة العادلة
    if (/(?:الاسهم|اسهم|السهم|سهم).{0,45}(?:فوق|اعلى|أعلى|متداول|بتتداول|يتداول).{0,35}(?:القيمه|قيمه|قيمتها|التقييم).{0,20}(?:العادله|العادل|العادله)/i.test(normalized)) return true;
    // الصيغة المعكوسة: القيمة العادلة + أسهم
    if (/(?:القيمه|قيمه|التقييم).{0,20}(?:العادله|العادل).{0,45}(?:الاسهم|اسهم|السهم|سهم)/i.test(normalized)) return true;
    // الصيغة المنقوصة: "فوق القيمة العادلة" بدون تحديد كلمة "أسهم"
    if (/(?:فوق|اعلى).{0,10}(?:القيمه|قيمه).{0,10}(?:العادله|العادل)/i.test(normalized)) return true;
    // صيغة مباشرة: "القيمة العادلة" فقط كسؤال
    if (/(?:الاسهم|اسهم).{0,25}(?:القيمه|قيمه).{0,10}(?:العادله|العادل)/i.test(normalized)) return true;
    // صيغة: "مبالغ فيها" أو "أغلى من قيمتها"
    if (/(?:مبالغ|باهظ|غالي|غالى).{0,20}(?:قيمت|تقييم|اسعار)/i.test(normalized)) return true;
    if (/(?:الاسهم|اسهم).{0,15}(?:مبالغ|باهظ|غاليه)/i.test(normalized)) return true;
    return false;
}

export function enforceIntentFromMessage(message: string, plannerIntent: string, symbols: string[]): {
    intent: string;
    tools: string[];
    replaceTools?: boolean;
    sector?: string;
    scan_direction?: "accumulation" | "distribution";
} {
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    const hasSymbol = symbols.length > 0 || /\b[A-Z]{2,6}\b/.test(message);
    const marketFairValueScan = isFairValueScanRequest(message);
    const direction = /تصريف|distribution/i.test(normalized) ? "distribution" : /تجميع|accumulation/i.test(normalized) ? "accumulation" : null;
    if (marketFairValueScan) return { intent: "market_summary", tools: ["get_fair_value_scan"], replaceTools: true };
    if (direction) return { intent: "accumulation_distribution", tools: [direction === "distribution" ? "get_distribution_stocks" : "get_accumulation_stocks"], replaceTools: true, scan_direction: direction };
    if (/(قيمه عادله|القيمه العادله|fair value|عادله)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    if (/(?:سبب|اسباب|ليه|لماذا)/i.test(normalized) && hasSymbol) return { intent: "stock_news", tools: ["get_stock", "get_news", "get_stock_levels"], replaceTools: true };
    if (/(مقاوم|مقوام|دعم|support|resistance)/i.test(normalized) && hasSymbol && !/حلل.{0,30}(اخبار|أخبار)/i.test(normalized)) return { intent: "levels_analysis", tools: ["get_stock_levels"], replaceTools: true };
    if (/(سيول|السيوله)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
    if (hasSymbol && /(حلل|لو\s+كسر|اعمل\s+ايه|أعمل\s+إيه)/i.test(normalized)) {
        const compoundAnalysis = /حلل.{0,20}(هات|اخبار|أخبار)|هات.{0,20}(اخبار|أخبار)|لو\s+كسر.{0,20}(اخبار|أخبار)/i.test(normalized);
        return { intent: "stock_analysis", tools: compoundAnalysis ? ["get_stock", "get_stock_levels", "get_news"] : ["get_stock", "get_stock_levels"], replaceTools: true };
    }
    if (/(?:اخبار|خبر|news)/i.test(normalized) && hasSymbol) return { intent: "stock_news", tools: ["get_news"], replaceTools: true };
    if (/(مقارن|قارن|compare)/i.test(normalized) && symbols.length >= 2) return { intent: "comparison", tools: ["get_comparison"], replaceTools: true };
    if (/(يخسر|خسار|يهبط|ينزل|يطلع|صعود|هبوط)/i.test(normalized) && hasSymbol) return { intent: "risk_analysis", tools: ["get_stock", "get_distribution_stocks"], replaceTools: true, scan_direction: "distribution" };
    if (/(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(normalized) && hasSymbol) return { intent: "levels_analysis", tools: ["get_stock_levels"], replaceTools: true };
    if (/(ابيع|بيع|احتفظ|اخرج|اشتري|شراء)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    if (/(ينصح|داخل|دخول|مستهدف|يصحح|تصحيح|بكره|بكرة|اخر الاسبوع|المحفظه|مليون)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    if (symbols.length >= 2 && hasSymbol && !/(اخبار|خبر|قارن|مقارن|قطاع|تجميع|تصريف)/i.test(normalized)) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    if (/(اكبر|اعلى|اقوى)\s+قطاع.{0,25}(سيول|تداول)|(?:(?:ال)?سيول(?:ه)?).{0,25}(قطاع|القطاعات)|قطاع.{0,25}(?:(?:ال)?سيول(?:ه)?|تداول)/i.test(normalized)) {
        const sector = extractSectorFromMessage(normalized);
        return sector ? { intent: "sector_analysis", tools: ["get_sector_liquidity"], replaceTools: true, sector } : { intent: "market_summary", tools: ["get_sector_liquidity"], replaceTools: true };
    }
    if (/(قائمه|قايمه|قائمة|هات|جيب|اعرض).{0,20}(القطاعات|قطاعات)/i.test(normalized)) return { intent: "sector_analysis", tools: ["get_sector_list"], replaceTools: true };
    if (/(اعلى|اقوى|أعلى|أقوى).{0,25}(الاسهم|الأسهم|ارتفاع|صعود|اليوم|النهارده|اخر يوم|آخر يوم)/i.test(normalized)) return { intent: "market_summary", tools: ["get_market"], replaceTools: true };
    if (/(سيول|تداول|liquidity)/i.test(normalized) && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock"], replaceTools: true };
    if (/(سيول|تداول|liquidity)/i.test(normalized) && !hasSymbol) return { intent: "market_summary", tools: ["get_market", "get_accumulation_stocks"], replaceTools: true };
    const sector = extractSectorFromMessage(normalized);
    if (sector && !hasSymbol) return { intent: "sector_analysis", tools: ["get_sector"], replaceTools: true, sector };
    if (plannerIntent === "stock_analysis" && hasSymbol) return { intent: "stock_analysis", tools: ["get_stock", "get_stock_levels"], replaceTools: true };
    return { intent: plannerIntent, tools: [] };
}

export function extractSectorFromMessage(message: string): string | null {
    const normalized = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    if (/(استصلاح|اراضي استصلاح|استصلاح اراضي|اراضى|زراعه|زراعي|زراعيه|agri|agriculture|reclamation)/i.test(normalized)) return "استصلاح أراضي";
    if (/(البنوك|بنوك|banking sector|banks)/i.test(normalized)) return "بنوك";
    if (/(العقارات|عقارات|عقاري|real estate)/i.test(normalized)) return "عقارات";
    if (/(الادويه|ادويه|دواء|pharma|pharmaceutical)/i.test(normalized)) return "أدوية";
    if (/(الاغذيه|اغذيه|غذائي|food|beverage)/i.test(normalized)) return "أغذية";
    if (/(البترول|بترول|الطاقه|طاقه|oil|gas|energy)/i.test(normalized)) return "بترول";
    if (/(finance|financial|مالي|تمويل|استثمار)/i.test(normalized)) return "Finance";
    return null;
}

export function needsLiveDataForTools(tools: string[]): boolean {
    const liveTools = new Set([
        "get_stock", "get_market", "get_indices", "get_news",
        "get_recommendations", "get_signals", "get_sector",
        "get_accumulation_stocks", "get_distribution_stocks", "get_sector_liquidity", "get_sector_list", "get_stock_levels", "get_comparison", "get_fair_value_scan"
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
    const hasImages = images.length > 0;
    let vision: VisionContext | null = null;
    let visionError: string | null = null;
    let memory: MemoryResult | null = null;

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

    // ===== STAGE 3: Intent / Entity Planner (no raw images — uses vision context) =====
    yield { type: "status", data: { status: "planner", message: "تحليل النية وتخطيط الأدوات..." } };
    const plannerResult = (!hasImages ? buildCompoundDeterministicPlan(userMessage, sessionState) : null)
        || await runPlanner(
            userMessage,
            [], // Never pass raw images to planner when vision already analyzed
            sessionState,
            history,
            apiKeys,
            vision
        );

    const explicitSymbols = extractExplicitSymbols(userMessage);
    let mergedSymbols = explicitSymbols.length > 0
        ? explicitSymbols
        : Array.from(new Set([
            ...mergeVisionSymbols(plannerResult.entities.symbols || [], vision)
        ]));
    const riskFollowUp = /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage);
    if (riskFollowUp && mergedSymbols.length === 0) {
        const recentSymbol = extractSingleStockFromRecentHistory(history);
        if (recentSymbol) mergedSymbols.push(recentSymbol);
    }
    if (mergedSymbols.length === 0 && memory?.resolved_references?.symbol) {
        mergedSymbols.push(memory.resolved_references.symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(أبيع|ابيع|بيع|أحتفظ|احتفظ|أخرج|اخرج|بكام|بكم|السعر)/i.test(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(اخباره|أخباره|هات\s+اخبار|هات\s+أخبار|خبره)/i.test(userMessage)) mergedSymbols.push(sessionState.current_symbol);
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (isMarketWideRequest(userMessage)) mergedSymbols = [];
    if (plannerResult.entities.sector && extractExplicitSymbols(userMessage).length === 0) mergedSymbols = [];
    const compoundRequest = splitChatCommands(userMessage).length > 1;
    const fairValueScanRequest = isFairValueScanRequest(userMessage);
    const enforced = fairValueScanRequest
        ? { intent: "market_summary", tools: ["get_fair_value_scan"], replaceTools: true }
        : compoundRequest
            ? { intent: plannerResult.intent, tools: plannerResult.tools || [], replaceTools: true, scan_direction: plannerResult.entities.scan_direction || undefined }
            : enforceIntentFromMessage(userMessage, plannerResult.intent, mergedSymbols);
    const datedDomainRequest = Boolean(extractRequestedDate(userMessage) || extractRequestedDateRange(userMessage)) && ["stock_analysis", "stock_news", "comparison", "sector_analysis", "accumulation_distribution"].includes(enforced.intent);
    const historicalRequest = needsHistoricalData(enforced.intent, userMessage);
    const effectiveIntent = historicalRequest && !datedDomainRequest ? "historical_recall" : enforced.intent;

    const plannedTools = enforced.replaceTools
        ? enforced.tools
        : Array.from(new Set([...(plannerResult.tools || []), ...enforced.tools]));
    const requestedRange = extractRequestedDateRange(userMessage);
    const guidanceIntent = getInvestorGuidanceIntent(userMessage);
    const plan: IntentPlan = {
        intent: mapIntent(effectiveIntent),
        confidence: plannerResult.confidence || 0.8,
        guidance_intent: guidanceIntent,
        entities: {
            symbols: mergedSymbols,
            sector: enforced.sector || plannerResult.entities.sector || null,
            timeframe: extractTemporalContext(userMessage).timeframe,
            reference: memory?.resolved_references?.symbol ? "last_image" : null
            ,scan_direction: enforced.scan_direction || plannerResult.entities.scan_direction || null
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
    const topMoversRequest = /(أعلى|اعلى|أقوى|اقوى).{0,25}(الأسهم|اسهم|ارتفاع|صعود|النهارده|اليوم|اخر يوم|آخر يوم|جلسه|جلسة)/i.test(userMessage);
    const deterministicLiquidityResponse = topMoversRequest
        ? buildTopMoversResponse(tools)
        : plan.intent === "market_summary" && plan.entities.symbols.length === 0
        && !plan.tools.includes("get_fair_value_scan")
        && !plan.entities.scan_direction
        ? buildMarketLiquidityResponse(tools)
        : null;
    const deterministicDomainResponse = buildDeterministicResponse(userMessage, plan, tools.results);
    const deterministicResponse = deterministicLiquidityResponse || (plan.guidance_intent ? null : deterministicDomainResponse);
    if (deterministicResponse) {
        const response = deterministicResponse;
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
    const plannerResult = (!hasImages ? buildCompoundDeterministicPlan(userMessage, sessionState) : null)
        || await runPlanner(
            userMessage,
            [],
            sessionState,
            history,
            apiKeys,
            vision
        );

    const explicitSymbols = extractExplicitSymbols(userMessage);
    let mergedSymbols = explicitSymbols.length > 0
        ? explicitSymbols
        : Array.from(new Set([
            ...mergeVisionSymbols(plannerResult.entities.symbols || [], vision)
        ]));
    const riskFollowUp = /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage);
    if (riskFollowUp && mergedSymbols.length === 0) {
        const recentSymbol = extractSingleStockFromRecentHistory(history);
        if (recentSymbol) mergedSymbols.push(recentSymbol);
    }
    if (mergedSymbols.length === 0 && memory?.resolved_references?.symbol) {
        mergedSymbols.push(memory.resolved_references.symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(أبيع|ابيع|بيع|أحتفظ|احتفظ|أخرج|اخرج|بكام|بكم|السعر)/i.test(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(اخباره|أخباره|هات\s+اخبار|هات\s+أخبار|خبره)/i.test(userMessage)) mergedSymbols.push(sessionState.current_symbol);
    if (mergedSymbols.length === 0 && sessionState.current_symbol && /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage)) {
        mergedSymbols.push(sessionState.current_symbol);
    }
    if (isMarketWideRequest(userMessage)) mergedSymbols = [];
    if (plannerResult.entities.sector && extractExplicitSymbols(userMessage).length === 0) mergedSymbols = [];
    const compoundRequest = splitChatCommands(userMessage).length > 1;
    const enforced = compoundRequest
        ? { intent: plannerResult.intent, tools: plannerResult.tools || [], replaceTools: true, scan_direction: plannerResult.entities.scan_direction || undefined }
        : enforceIntentFromMessage(userMessage, plannerResult.intent, mergedSymbols);
    const datedDomainRequest = Boolean(extractRequestedDate(userMessage) || extractRequestedDateRange(userMessage)) && ["stock_analysis", "stock_news", "comparison", "sector_analysis", "accumulation_distribution"].includes(enforced.intent);
    const historicalRequest = needsHistoricalData(enforced.intent, userMessage);
    const effectiveIntent = historicalRequest && !datedDomainRequest ? "historical_recall" : enforced.intent;

    const plannedTools = enforced.replaceTools
        ? enforced.tools
        : Array.from(new Set([...(plannerResult.tools || []), ...enforced.tools]));
    const requestedRange = extractRequestedDateRange(userMessage);
    const guidanceIntent = getInvestorGuidanceIntent(userMessage);
    const plan: IntentPlan = {
        intent: mapIntent(effectiveIntent),
        confidence: plannerResult.confidence || 0.8,
        guidance_intent: guidanceIntent,
        entities: {
            symbols: mergedSymbols,
            sector: enforced.sector || plannerResult.entities.sector || null,
            timeframe: extractTemporalContext(userMessage).timeframe,
            reference: memory?.resolved_references?.symbol ? "last_image" : null
            ,scan_direction: enforced.scan_direction || plannerResult.entities.scan_direction || null
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
    const topMoversRequest = /(أعلى|اعلى|أقوى|اقوى).{0,25}(الأسهم|اسهم|ارتفاع|صعود|النهارده|اليوم|اخر يوم|آخر يوم|جلسه|جلسة)/i.test(userMessage);
    const deterministicLiquidityResponse = topMoversRequest
        ? buildTopMoversResponse(tools)
        : plan.intent === "market_summary" && plan.entities.symbols.length === 0
        && !plan.entities.scan_direction
        ? buildMarketLiquidityResponse(tools)
        : null;
    const scopedMemory = plan.needs_historical_data || plan.entities.reference
        ? memory?.relevant_snapshots || []
        : [];
    const deterministicDomainResponse = buildDeterministicResponse(userMessage, plan, tools.results);
    const generatedResponse = deterministicLiquidityResponse || (plan.guidance_intent ? null : deterministicDomainResponse) || await generateV2Response(
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
        "accumulation_distribution": "accumulation_distribution",
        "risk_analysis": "risk_analysis",
        "stock_news": "stock_analysis",
        "historical_recall": "historical_recall",
        "general_chat": "general_chat"
    };
    return intentMap[intent] || "follow_up";
}
