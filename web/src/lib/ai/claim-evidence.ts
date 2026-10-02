import { ToolResult } from "./types";
import { recommendationPerformance, summarizeRecommendationEvidence } from "./recommendation-evidence";

const plain = (text: string) => text.replace(/[*_`]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");

/** Structured corporate actions and performance facts apply to every output route. */
export function checkStructuredClaims(reply: string, results: ToolResult[]): string[] {
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
        for (const row of rows) {
            const performance = recommendationPerformance(row);
            const related = text.split(/[\n؛]/).filter(line => new RegExp(`\\b${row.symbol}\\b`, "i").test(line));
            for (const line of related) {
                if (performance.return_pct == null && /متعادل|لم تتحرك|عائد(?:ها)?\s*(?:صفر|0)/.test(line)) reasons.push(`${row.symbol}: العائد غير متاح؛ لا تصفه بالتعادل أو عدم الحركة.`);
                const matches = [...line.matchAll(/(?:عائد|ربح|خسار[هت]|خسائره)[^\n%٪]{0,45}?([+-]?\d+(?:\.\d+)?)\s*[%٪]/g)];
                for (const match of matches) {
                    const value = Math.abs(Number(match[1]));
                    if (performance.return_pct == null || Math.abs(value - Math.abs(performance.return_pct)) > .015) reasons.push(`${row.symbol}: العائد المذكور لا يطابق سعر التقييم وسعر الدخول الموثقين.`);
                }
            }
        }
    }
    return [...new Set(reasons)];
}
