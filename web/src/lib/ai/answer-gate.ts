/**
 * answer-gate.ts
 *
 * Pre-send coherence gate for LLM-written answers. The validator proves that a
 * number exists somewhere in the tool payload; this gate proves the harder
 * things the design requires:
 *
 *   1. Did the answer address the SAME question the contract asked (metric
 *      coverage, "today" news that is not actually today)?
 *   2. Is each numeric claim attributed to the stock the sentence names
 *      (a figure belonging to another stock in a mixed conversation is a
 *      misattribution, not a verified fact)?
 *
 * The gate is advisory inside the existing correction loop: every failure
 * returns a specific reason so the rewrite fixes the exact defect instead of
 * re-rolling the same answer.
 */

import { IntentPlan, ToolResult, VisionContext } from "./types";
import { checkContextEvidence } from "./context-evidence-gate";
import { CoverageReport, checkCoverage } from "./coverage";
import { FactRecord } from "./facts";
import { isVerifiableDerivedMetric, splitSentences } from "./validator";
import { isPortfolioAnalysisRequest, isConversationalChoiceOrFollowUp, normalizeArabicIntent } from "./intent-policy";
import { evidenceViolations } from "./response-evidence";
import { checkStructuredClaims } from "./claim-evidence";
import { isTodayNewsRequest } from "./news-evidence";
import { resolveResponseTask, checkResponseTask } from "./response-task";
import { checkDecisionComparatives, checkDecisionGrounding } from "./decision-evidence";
import { proseOwner, stockSection } from "./prose-ownership";

export interface AnswerGateInput {
    reply: string;
    plan: IntentPlan;
    toolResults: ToolResult[];
    userMessage: string;
    facts: FactRecord[];
    coverage?: CoverageReport | null;
    history?: Array<{ role: string; content: string }>;
    vision?: VisionContext | null;
}

export interface AnswerGateResult {
    ok: boolean;
    reasons: string[];
    checked: {
        coverage: boolean;
        metric: boolean;
        attribution: boolean;
        context: boolean;
        completion: boolean;
    };
}

function mentionsTodayNews(reply: string): boolean {
    return /(?:أخبار|خبر|نبأ)[^\n]{0,30}(?:اليوم|النهار[د]?ده)|(?:(?:اليوم|النهار[د]?ده)[^\n]{0,20}(?:أخبار|خبر))/i.test(reply)
        || /أحدث(?: أخبار| الخبر)|(?:اليوم|النهار[د]?ده)(?: فقط| حصرًا| حصريا)/i.test(reply);
}

function claimsAccumulation(reply: string): boolean {
    return /تجميع|acc_score|accumulation|Wyckoff|وأيكوف|إيليوت/i.test(reply);
}

/**
 * For every sentence that names a symbol we hold facts for, each numeric claim
 * must match a fact recorded for THAT symbol (price fields for currency
 * figures, percent fields for percentages). Numbers found only under another
 * stock's facts are misattributions.
 */
function checkAttribution(reply: string, facts: FactRecord[]): string[] {
    const reasons: string[] = [];
    const bySymbol = new Map<string, FactRecord[]>();
    for (const record of facts) {
        if (!record.symbol) continue;
        const list = bySymbol.get(record.symbol) || [];
        list.push(record);
        bySymbol.set(record.symbol, list);
    }
    if (bySymbol.size === 0) return reasons;

    const percentFields = new Set(["change_pct", "profit_pct", "premium_pct"]);
    const currencyFields = new Set([
        "price", "close", "support", "resistance", "sma_50", "sma_200", "ema_50", "ema_200", "target_price", "stop_loss", "exit_price",
        "bb_upper", "bb_lower", "highest_price", "market_value", "cost_basis", "profit_value", "entry_price",
    ]);
    const metricFields = (prefix: string, percentage: boolean): Set<string> | null => {
        const labels: Array<[RegExp, string[]]> = percentage ? [
            [/ربح|خسار|عائد|مكسب/i, ["profit_pct"]],
            [/ارتفع|صعد|هبط|انخفض|نزل|تغير|تراجع/i, ["change_pct"]],
            [/علاوه|علاوة/i, ["premium_pct"]],
        ] : [
            [/(?:متوسط|سعر)\s*الشراء|(?:(?:متوسط|سعر)\s*)?الدخول(?:\s*(?:الإشارة|الاشارة|التوصية|التوصيه))?|\bدخول\b/i, ["entry_price"]],
            [/هدف|مستهدف|المستهدف|الهدف/i, ["target_price"]],
            [/وقف|الوقف|وقف\s*(?:الخسارة|الخساره)/i, ["stop_loss"]],
            [/خروج|الخروج|سعر\s*الخروج/i, ["exit_price"]],
            [/سعر\s*(?:حالي|الحالي|السهم|الاغلاق|الإغلاق)|اخر\s*سعر|آخر\s*سعر|الان\s*عند|الآن\s*عند/i, ["price", "close"]],
            [/دعم/i, ["support"]],
            [/مقاومه|مقاومة/i, ["resistance"]],
            [/القيمه\s*السوقيه|القيمة\s*السوقية/i, ["market_value"]],
            [/تكلفه|تكلفة/i, ["cost_basis"]],
            [/ربح|خسار/i, ["profit_value"]],
        ];
        let latest = -1;
        let selected: string[] | null = null;
        for (const [pattern, fields] of labels) {
            const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
            for (const match of prefix.matchAll(new RegExp(pattern.source, flags))) {
                if ((match.index ?? -1) > latest) { latest = match.index ?? -1; selected = fields; }
            }
        }
        return selected ? new Set(selected) : null;
    };

    let section: string | null = null;
    for (const line of reply.split("\n")) {
        section = stockSection(line, [...bySymbol.keys()]) || section;
        // Table rows pair values with columns structurally; the validator and
        // deterministic renderers own table accuracy. The gate checks prose.
        if (line.trim().startsWith("|")) continue;
        const normalizedLine = line.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "");
        for (const sentence of splitSentences(normalizedLine)) {
            const symbolsInSentence = Array.from(
                new Set((sentence.match(/\b[A-Z]{2,6}\b/g) || []).filter(sym => bySymbol.has(sym)))
            );
            if (symbolsInSentence.length === 0 && !section) continue;
            // Mixed comparisons legitimately list several stocks' numbers in one clause.
            if (symbolsInSentence.length > 1) continue;
            const symbol = proseOwner(sentence, [...bySymbol.keys()], section);
            if (!symbol) continue;
            const symbolFacts = bySymbol.get(symbol) || [];

            const percentClaims = Array.from(sentence.matchAll(/(?:[-+]?\d+(?:[.,]\d+)?)\s*(?:%|٪)/g))
                .map(match => ({ value: Number(match[0].replace(/[\s%٪]/g, "").replace(/,/g, "")), prefix: sentence.slice(0, match.index) }))
                .filter(claim => Number.isFinite(claim.value));
            const currencyClaims = Array.from(sentence.matchAll(/\d+(?:[.,]\d+)?\s*(?:جنيه|ج\.م|EGP|جنيهًا)/gi))
                .map(match => ({ value: Number(match[0].replace(/[^\d.,]/g, "").replace(/,/g, "")), prefix: sentence.slice(0, match.index) }))
                .filter(claim => Number.isFinite(claim.value));

            const matchesAny = (value: number, fields: Set<string>) => symbolFacts.some(record => {
                if (!fields.has(record.field)) return false;
                const directDiff = Math.abs(value - record.value);
                const absDiff = Math.abs(Math.abs(value) - Math.abs(record.value));
                const minDiff = Math.min(directDiff, absDiff);
                const rel = record.value !== 0 ? minDiff / Math.abs(record.value) : minDiff;
                return minDiff <= 0.15 || rel <= 0.02;
            });

            for (const { value, prefix } of percentClaims) {
                const specific = metricFields(prefix, true);
                const anyFieldOk = matchesAny(value, specific || percentFields)
                    || (!specific && symbolFacts.some(record => record.field === "rsi" && Math.abs(value - record.value) <= 0.6))
                    || (!specific && symbolFacts.some(record => (record.field === "acc_score" || record.field === "dist_score") && Math.abs(value - record.value) <= 0.6));
                // Percentages used as explanatory strengths (for example a
                // divergence confidence) are not stock returns or price
                // changes unless the sentence labels their metric.
                if (!specific && !symbolFacts.some(record => ["rsi", "acc_score", "dist_score"].includes(record.field) && Math.abs(value - record.value) <= 0.6)) continue;
                if (!anyFieldOk) {
                    reasons.push(`نسبة ${value}% منسوبة للسهم ${symbol} لكنها لا تطابق أي حقيقة مسجلة لهذا السهم — استعمل قيم ${symbol} من البيانات فقط أو احذف الرقم.`);
                }
            }
            for (const { value, prefix } of currencyClaims) {
                if (!matchesAny(value, metricFields(prefix, false) || currencyFields)) {
                    reasons.push(`قيمة ${value} جنيه منسوبة للسهم ${symbol} لكنها لا تطابق أي سعر/مستوى مسجل لهذا السهم — استعمل أسعار ${symbol} الموثقة فقط أو احذف القيمة.`);
                }
            }
        }
    }
    return reasons;
}

/**
 * Runs the pre-send checks. Returns ok=false with specific reasons so the
 * existing rewrite loop can correct the exact defect.
 */
export function runAnswerGate(input: AnswerGateInput): AnswerGateResult {
    const { reply, plan, toolResults, userMessage, facts } = input;
    const reasons: string[] = [...evidenceViolations(reply, userMessage, toolResults), ...checkStructuredClaims(reply, toolResults, userMessage),
        ...checkContextEvidence(reply, plan, toolResults, input.vision)];
    const checked = { coverage: false, metric: false, attribution: false, context: false, completion: true };
    const task = resolveResponseTask(userMessage, plan, input.history);
    reasons.push(...checkResponseTask(reply, task, toolResults), ...checkDecisionComparatives(reply, task, toolResults),
        ...checkDecisionGrounding(reply, task, toolResults));

    // A quantity/purchase price supplied in chat is evidence for analysis, not
    // a completed account write. Reads (including an empty account) prove no write.
    const writes = toolResults.filter(result => result.tool === "manage_portfolio" && !result.error
        && result.data?.ok === true && result.data?.persisted === true
        && ["add", "update", "import"].includes(result.data?.operation));
    for (const line of reply.split("\n")) {
        const text = normalizeArabicIntent(line).replace(/[*_`]/g, "");
        const claim = /(?<![\u0621-\u064A])(?:تم\s+(?:بنجاح\s+)?(?:تسجيل|حفظ|اضافه|تحديث)|(?:سجلت|حفظت|اضفت|اتسجل|اتحفظ))\s+(?:مركز|مراكز|محفظ|المحفظ|الكميات|كميتك|اسهمك|الاسهم|سهم)/.exec(text);
        if (!claim || /(?:لم|لن|لا|ما|مش)\s*(?:يتم\s*)?$/.test(text.slice(0, claim.index).trim())) continue;
        const named = line.match(/\b[A-Z]{2,6}\b/g) || [];
        const claimedSymbols = named.length ? named : plan.entities.symbols || [];
        if (!writes.length || claimedSymbols.some(symbol => !writes.some(write => write.symbols?.includes(symbol)))) {
            reasons.push("الرد يؤكد حفظ أو تسجيل مركز دون عملية محفظة ناجحة موثقة لهذا السهم. بيانات المستخدم للتحليل فقط؛ لا تقل تم التسجيل، ووضّح إمكانية الحفظ من صفحة المحفظة.");
            break;
        }
    }

    // Ownership is a three-state fact: nonempty, verified empty, or unknown.
    // The responder may not turn a missing tool result into an empty portfolio.
    const snapshot = toolResults.find(result => result.tool === "manage_portfolio"
        && !result.error && result.data?.ok === true && Array.isArray(result.data?.positions));
    const deniesHoldings = /(?:محفظت[كهي]|المحفظه|المراكز|الاسهم\s+(?:اللي\s+)?(?:عندك|معاك|تملكها)).{0,45}(?:فاضيه|فارغه|مش\s+مسجل|غير\s+مسجل|لا\s+توجد|مفيش)|(?:لا\s+توجد|مفيش|مافيش|مش\s+مسجل).{0,45}(?:محفظه|مراكز|اسهم\s+(?:عندك|معاك)|عندك\s+اسهم)/i.test(reply.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه"));
    checked.context = true;
    if (deniesHoldings && snapshot && snapshot.data.positions.length > 0) {
        reasons.push("الرد يقول إن المحفظة فارغة بينما أداة المحفظة أثبتت وجود مراكز مفتوحة. اذكر المراكز الفعلية ولا تنفِ ملكيتها.");
    }
    if (plan.entities.portfolio_operation === "view" && plan.intent !== "portfolio_management" && !snapshot) {
        reasons.push("الطلب يتطلب مراكز المستخدم الفعلية، لكن أداة المحفظة لم تُرجع لقطة موثقة. لا تقدم تحليلاً شخصياً للمحفظة.");
    }
    if (snapshot && isPortfolioAnalysisRequest(userMessage) && snapshot.data.positions.length <= 12) {
        const missingSymbols = snapshot.data.positions
            .map((position: any) => String(position.symbol || "").toUpperCase())
            .filter((symbol: string) => symbol && !new RegExp(`\\b${symbol}\\b`, "i").test(reply));
        if (missingSymbols.length > 0) {
            reasons.push(`الطلب تحليل مراكز المحفظة كلها، لكن الرد تجاهل: ${missingSymbols.join("، ")}. اذكر كل مركز أو وضّح تعذر تحليل بياناته.`);
        }
    }

    // Rule 1 — "today" news that is not today.
    if (isTodayNewsRequest(userMessage) || plan.tools.includes("get_news")) {
        checked.coverage = true;
        const wantsToday = /النهار[د]?ده|اليوم|today|آخر الأخبار|أحدث خبر/i.test(userMessage);
        const coverage = input.coverage ?? checkCoverage(["news"], toolResults, { newsMustBeToday: wantsToday });
        const newsEntry = coverage.facts.find(entry => entry.fact === "news");
        if (wantsToday && newsEntry && (newsEntry.status === "stale" || newsEntry.status === "empty" || newsEntry.status === "failed") && mentionsTodayNews(reply) && !/(لم أجد|لم اجد|لا يوجد|لا توجد|لا تتوفر|مفيش)/.test(reply)) {
            reasons.push("الرد يقدم أخبارًا على أنها أخبار اليوم بينما لا يوجد خبر منشور اليوم من مصدر موثوق — أخبر المستخدم بعدم وجود خبر بتاريخ اليوم واقترب الأقدم صراحة بتاريخه.");
        }
    }

    // Rule 2 — the ranking metric the contract asked for must actually be answered.
    if (plan.ranking_metric === "accumulation" && !/شريع|اسلام|إسلام|sharia/i.test(userMessage)) {
        checked.metric = true;
        const accRows = toolResults
            .filter(result => result.tool === "get_accumulation_stocks")
            .some(result => Array.isArray(result.data?.stocks) ? result.data.stocks.length > 0 : false);
        if (accRows && !claimsAccumulation(reply)) {
            reasons.push("السؤال طلب أقوى الأسهم بتجميع/سيولة مؤسسية لكن الرد لا يذكر حالة التجميع — أجب على معيار التجميع نفسه ولا تستبدله بالأعلى ارتفاعًا.");
        }
        if (!accRows && claimsAccumulation(reply) && !/(لا\s+تتوفر|غير\s+متاح|تعذر|لم\s+تظهر|لم\s+اجد|لم\s+أجد|مفيش\s+بيانات)/i.test(reply)) {
            reasons.push("الرد يجزم بوجود تجميع رغم أن أداة التجميع لم تُرجع صفوفاً موثقة. اذكر نقص البيانات ولا تنسب التجميع لسهم.");
        }
    }

    if (plan.ranking_metric === "liquidity" || plan.ranking_metric === "liquidity_unavailable") {
        checked.metric = true;
        const hasLiquidityRanking = toolResults.some(result => result.tool === "get_sector_liquidity"
            && !result.error && (Array.isArray(result.data?.sectors) ? result.data.sectors.length > 0 : Array.isArray(result.data?.stocks) && result.data.stocks.length > 0));
        if (!hasLiquidityRanking && /(?:الاكثر|أكثر|اعلي|أعلى|اقوي|أقوى).{0,25}(?:سيول|تداول)/i.test(reply)
            && !/(لا\s+تتوفر|غير\s+متاح|تعذر)/i.test(reply)) {
            reasons.push("الرد يرتب السيولة أو التداول دون نتيجة مسح موثقة لهذا المعيار.");
        }
    }

    // Rule 3 — numeric claims must bind to the stock named in the sentence.
    checked.attribution = true;
    // User-declared purchase cost is not a market quote or a saved holding.
    // Admit it only as entry_price for a single scoped stock, never as close.
    const declared = normalizeArabicIntent(userMessage);
    const entry = declared.match(/(?:بمتوسط|متوسط(?:\s+سعر)?(?:\s+الشراء)?|اشتريت(?:\s+[^\d]{0,20})?\s+بسعر|بسعر)\s*[:=]?\s*(\d+(?:\.\d+)?)/);
    const hasHoldingCount = /(?:عدد|كميه)\s*[:=]?\s*\d|\d\s*سهم/.test(declared);
    const userFacts: FactRecord[] = entry && hasHoldingCount && plan.entities.symbols?.length === 1
        ? [{ id: "user-declared-entry", symbol: plan.entities.symbols[0], field: "entry_price", value: Number(entry[1]), unit: "egp",
            as_of: null, source: "user_message", tool: "user_message", fetched_at: new Date().toISOString() }] : [];
    reasons.push(...checkAttribution(reply, [...facts, ...userFacts]));

        // Rule 4 — Dialogue Coherence for conversational follow-ups / answers
    if (input.history && input.history.length > 0) {
        const isFollowUp = isConversationalChoiceOrFollowUp(userMessage);
        const lastAssistantMsg = [...input.history].reverse().find(m => m.role === "assistant")?.content || "";
        const askedQuestion = /[؟?]\s*$/.test(lastAssistantMsg.trim()) || /(?:هل|أيهما|ايهما|تفضل|تبحث|تحب|ترغب|أي قطاع|انهي قطاع|انهو قطاع)/i.test(lastAssistantMsg);
        
        if (isFollowUp || (userMessage.trim().split(/\s+/).length <= 5 && askedQuestion)) {
            checked.context = true;
            const vagueComplaint = /(?:سؤالك|طلبك|كلمة|استفسارك).{0,25}(?:غير\s+واضح|مش\s+واضح|مبهم|مقتضب|قصير|ناقص)/i.test(reply)
                || /(?:لم\s+أفهم|لم\s+افهم|مش\s+فاهم|لا\s+أفهم|لا\s+افهم|يرجى\s+توضيح\s+ماذا\s+تقصد|حدد\s+السهم|حدد\s+الشركة)/i.test(reply)
                || /(?:غير\s+مدرج\s+في\s+قاعدة\s+بيانات\s+الأسهم\s+الرئيسية\s+الـ\s*236|غير\s+مسجل\s+في\s+الـ\s*236)/i.test(reply);
            if (vagueComplaint) {
                reasons.push("رسالة المستخدم هي إجابة محادثية مباشرة على سؤالك السابق. يمنع تماماً الادعاء بأن السؤال غير واضح أو طلب تحديد اسم شركة. اربط إجابة المستخدم بالسياق السابق وأجب مباشرة.");
            }
        }
    }

    return { ok: reasons.length === 0, reasons, checked };
}

/** Correction-prompt fragment for the existing rewrite loop. */
export function buildGateCorrectionBlock(reasons: string[]): string {
    if (reasons.length === 0) return "";
    return `\n- أخطاء فحص التغطية والنِّسبة التي يجب إصلاحها في هذه الصياغة:\n${reasons
        .slice(0, 6)
        .map(reason => `  * ${reason}`)
        .join("\n")}\n`;
}
