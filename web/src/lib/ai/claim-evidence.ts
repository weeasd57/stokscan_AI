import { ToolResult } from "./types";
import { recommendationPerformance, summarizeRecommendationEvidence } from "./recommendation-evidence";

const plain = (text: string) => text.replace(/[*_`]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/٫/g, ".");

function recommendationRows(results: ToolResult[]): Array<{ row: any; symbol: string }> {
    const rows: Array<{ row: any; symbol: string }> = [];
    for (const result of results) {
        if (result.error) continue;
        if (["get_recommendations", "get_signals"].includes(result.tool) && Array.isArray(result.data)) {
            for (const row of result.data) {
                const symbol = String(row?.symbol || "").toUpperCase();
                if (symbol) rows.push({ row, symbol });
            }
        }
        if (result.tool === "get_stock" && result.data && !Array.isArray(result.data)) {
            const nested = result.data.recommendation || result.data.platform_recommendation;
            const symbol = String(nested?.symbol || result.data.symbol || result.symbols?.[0] || "").toUpperCase();
            if (nested && symbol) rows.push({ row: { ...nested, symbol }, symbol });
        }
    }
    return rows;
}

function userDisclosedExecution(userMessage: string, symbol: string, allSymbols: string[], realized: boolean): boolean {
    const message = plain(userMessage);
    const disclosure = realized
        ? /(?:بعت|بعتهم|ربحت|خسرت|حققت)/i
        : /(?:اشتريت|شريت|دخلت|نفذت|بعت|بعتهم)/i;
    if (!disclosure.test(message)) return false;
    const named = allSymbols.filter(candidate => new RegExp(`\\b${candidate}\\b`, "i").test(message));
    return named.includes(symbol) || (named.length === 0 && allSymbols.length === 1);
}

function recommendationClaimViolations(text: string, results: ToolResult[], userMessage: string): string[] {
    const reasons: string[] = [];
    const recommendations = recommendationRows(results);
    const allSymbols = Array.from(new Set(recommendations.map(item => item.symbol)));
    // Carry a named symbol across comma continuations. Otherwise an answer
    // could put the false performance claim after "،" and bypass the gate.
    const clauses: Array<{ symbol: string; text: string }> = [];
    for (const line of text.split(/[\n؛]/)) {
        let activeSymbol: string | null = null;
        for (const part of line.split(/،/)) {
            const mentioned = allSymbols.filter(candidate => new RegExp(`\\b${candidate}\\b`, "i").test(part));
            if (mentioned.length === 1) activeSymbol = mentioned[0];
            else if (mentioned.length > 1) activeSymbol = null;
            if (activeSymbol && part.trim()) clauses.push({ symbol: activeSymbol, text: part.trim() });
        }
    }
    for (const { row, symbol } of recommendations) {
        const performance = recommendationPerformance(row);
        const related = clauses.filter(clause => clause.symbol === symbol).map(clause => clause.text);
        for (const clause of related) {
            const hasRecClaim = /توصي|اشار|عائد|ربح|خسار|مكسب|اداء/.test(clause);
            if (row?.has_recommendation === false || String(row?.status || "").toLowerCase() === "none") {
                if (hasRecClaim && !/(?:لا\s+توجد|لا\s+يوجد|مفيش|مافيش|دون|بدون)\s+(?:توصي|اشار)/.test(clause)
                    && /(?:توصي|اشار).{0,35}(?:نشط|مفتوح|مغلق|دخل|عائد|ربح|خسار)/.test(clause))
                    reasons.push(`${symbol}: لا توجد توصية موثقة بهذا الوصف على المنصة.`);
                continue;
            }
            const executionClaim = /(?:انت|إنت|أنت|حضرتك|عندك|معاك|مركزك|صفقتك).{0,35}(?:اشتريت|شريت|دخلت|نفذت|بعت|ربحت|خسرت|حققت)|(?:اشتريت|شريت|دخلت|نفذت|بعت|ربحت|خسرت|حققت).{0,35}(?:انت|إنت|أنت|حضرتك|عندك|معاك|مركزك|صفقتك)/.test(clause);
            const claimsRealizedExecution = /(?:بعت|ربحت|خسرت|حققت)/.test(clause);
            const personalEvidence = executionClaim && userDisclosedExecution(userMessage, symbol, allSymbols, claimsRealizedExecution);
            if (executionClaim && !personalEvidence)
                reasons.push(`${symbol}: توصية المنصة لا تثبت أن المستخدم نفّذها؛ لا تنسب له شراءً أو بيعاً أو ربحاً شخصياً دون إفادة صريحة منه.`);
            // A user-disclosed trade has its own execution and exit price. It
            // must not be compared with the platform signal's open return.
            if (personalEvidence && !/توصي|اشار/.test(clause)) continue;
            if (performance.return_pct == null && /متعادل|لم تتحرك|عائد(?:ها)?\s*(?:صفر|0)/.test(clause))
                reasons.push(`${symbol}: العائد غير متاح؛ لا تصفه بالتعادل أو عدم الحركة.`);

            const matches = [...clause.matchAll(/(عائد|ربح|خسار[هت]|خسائر|مكسب|اداء|حققت?|حقق)[^%٪]{0,55}?([+-]?\d+(?:\.\d+)?)\s*[%٪]/g)];
            for (const match of matches) {
                const context = match[0].slice(0, match[0].lastIndexOf(match[2]));
                const raw = match[2];
                const amount = Math.abs(Number(raw));
                const lossWord = /خسار|خسائر|خاسر|سالب/.test(context);
                const profitWord = /ربح|مكسب|رابح|موجب/.test(context);
                if ((raw.startsWith("+") && lossWord) || (raw.startsWith("-") && profitWord)) {
                    reasons.push(`${symbol}: إشارة نسبة العائد تتعارض مع وصف الربح أو الخسارة.`);
                    continue;
                }
                const claimed = lossWord ? -amount : profitWord ? amount : Number(raw);
                const isPlatformRecSentence = /توصي|إشار|اشار|منصة|المنصة/.test(clause);
                if (isPlatformRecSentence && (performance.return_pct == null || Math.abs(claimed - performance.return_pct) > .015))
                    reasons.push(`${symbol}: العائد المذكور لا يطابق العائد الموقّع المحسوب من سعر الدخول وسعر التقييم الموثقين.`);
            }

            const negatedRealization = /(?:غير|مش|ليس|لم|ما)\s+(?:ال)?(?:محقق|تحقق|تحققت|تحققش)/.test(clause);
            const realizedClaim = !negatedRealization && /(?:ربح|خسار|عائد|مكسب).{0,25}(?:محقق|فعلي|نهائي)|(?:حققت|حقق|تحققت).{0,35}(?:ربح|خسار|عائد|مكسب)/.test(clause);
            if (performance.return_basis === "open_mark_to_market" && realizedClaim)
                reasons.push(`${symbol}: التوصية مفتوحة؛ عائدها تقييم غير محقق، ولا يوجد سعر خروج يثبت ربحاً أو خسارة محققة.`);
            if (performance.return_basis === "closed_realized" && /(?:عائد|ربح|خسار).{0,25}غير\s+محقق/.test(clause))
                reasons.push(`${symbol}: التوصية مغلقة؛ احسب العائد المحقق من سعر الخروج لا من السعر الجاري.`);

        }
    }
    return reasons;
}

/** Structured corporate actions and performance facts apply to every output route. */
export function checkStructuredClaims(reply: string, results: ToolResult[], userMessage = ""): string[] {
    const reasons: string[] = [];
    const text = plain(reply);
    const actions = results.filter(r => r.tool === "get_corporate_actions" && !r.error)
        .flatMap(r => Array.isArray(r.data?.corporate_actions) ? r.data.corporate_actions : []);
    const bonusSymbols = [...new Set(actions.filter(row => row.action_type === "bonus_shares").map(row => String(row.symbol)))];
    for (const symbol of bonusSymbols) {
        const paragraphs = text.split(/\n\s*\n/).filter(p => bonusSymbols.length === 1 || p.includes(symbol));
        if (paragraphs.some(p => /(?:مش|ليست|ليس|ماهيش|ما\s*هيش)\s+(?:توزيع\s+)?(?:ل)?اسهم\s+مجانيه/.test(p)
            || /(?:لا\s+توجد|لم\s+تصدر|لا\s+يوجد|مفيش|مافيش).{0,25}اسهم\s+مجانيه/.test(p)
            || /(?:البيانات|المعلومات).{0,50}(?:لا|مش).{0,20}(?:تحدد|تحسم|توضح).{0,100}(?:الصيغتين|الصيغه|نوع|اسهم\s+مجانيه|اكتتاب)/.test(p))) {
            reasons.push(`${symbol}: الأدلة تتضمن أسهماً مجانية؛ لا تنفِ نوع الحدث. فرّق بين نوع الحدث الموثق وشروطه التنفيذية الناقصة.`);
        }
    }
    for (const result of results.filter(r => ["get_recommendations", "get_signals"].includes(r.tool))) {
        const rows = Array.isArray(result.data) ? result.data : [];
        const summary = summarizeRecommendationEvidence(rows, result.recommendation_collection);
        const arabicCounts: Record<string, number> = { صفر: 0, واحد: 1, واحده: 1, اثنان: 2, اثنتان: 2, اثنين: 2, اتنين: 2, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7, ثمان: 8, ثماني: 8, ثمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10 };
        const pattern = /(\d+|صفر|واحده?|اثنان|اثنتان|اثنين|اتنين|ثلاثه?|اربعه?|خمسه?|سته?|سبعه?|ثمانيه?|ثماني|تسعه?|عشره?)\s*(?:توصي(?:ات|ه)|اشار(?:ات|ه))?\s*(?:في\s+المنطقه\s+)?(رابحه|خاسره|سالب(?:ه)?|موجب(?:ه)?|متعادل(?:ه)?)/g;
        for (const match of text.matchAll(pattern)) {
            const count = /^\d+$/.test(match[1]) ? Number(match[1]) : arabicCounts[match[1]];
            const expected = /رابح|موجب/.test(match[2]) ? summary.profit : /خاسر|سالب/.test(match[2]) ? summary.loss : summary.flat;
            if (count !== expected) reasons.push(`عدد حالات الأداء لا يطابق البيانات: رابحة ${summary.profit}، خاسرة ${summary.loss}، متعادلة ${summary.flat}، غير متاحة ${summary.unknown}.`);
        }
        if (result.recommendation_collection && !result.recommendation_collection.complete
            && !/جزئي|غير مكتمل|تعذر|اول|فقط|استبعاد/.test(text)) reasons.push("نتيجة التوصيات جزئية؛ اذكر حدود التغطية ولا تعرضها كقائمة كاملة.");
    }
    reasons.push(...recommendationClaimViolations(text, results, userMessage));
    return [...new Set(reasons)];
}
