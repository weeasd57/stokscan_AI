import { ToolResult } from "./types";
import { recommendationPerformance, summarizeRecommendationEvidence } from "./recommendation-evidence";

export function recommendationSummaryText(tool: ToolResult): string {
    const s = summarizeRecommendationEvidence(tool.data, tool.recommendation_collection);
    const collection = s.collection;
    const coverage = collection
        ? collection.complete ? `القائمة مكتملة: ${s.count} إشارة مطابقة.`
            : `القائمة جزئية: عُرضت ${s.count} من ${collection.matched_total ?? "عدد غير مؤكد"} إشارة؛ ${collection.excluded_count} مستبعدة لعدم اكتمال البيانات${collection.fetch_failed ? "، وتعذر إكمال الجلب" : ""}.`
        : `عدد الإشارات المعروضة ${s.count}؛ اكتمال القائمة غير موثق.`;
    return `${coverage}\nالأداء: ${s.profit} رابحة، ${s.loss} خاسرة، ${s.flat} متعادلة، ${s.unknown} غير متاح تقييمها.\nالعوائد محسوبة من سعر الدخول وسعر التقييم لكل صف؛ ${s.unrealized_count} تقييم غير محقق لمراكز مفتوحة و${s.realized_count} تقييم محقق عند الإغلاق.`;
}

export function renderRecommendationEvidence(tool: ToolResult): string {
    const rows: any[] = Array.isArray(tool.data) ? tool.data : [];
    if (!rows.length) return tool.error || "لم تتوفر إشارات مطابقة موثقة لهذا الطلب.";
    return ["**إشارات فنية تاريخية مسجلة على المنصة:**", recommendationSummaryText(tool),
        ...rows.map(row => {
            const p = recommendationPerformance(row);
            const value = p.return_pct == null ? "العائد غير متاح" : `العائد ${p.return_pct >= 0 ? "+" : ""}${p.return_pct.toFixed(2)}%`;
            return `- ${row.symbol}: الدخول ${row.entry_price ?? "غير متاح"} جنيه؛ ${p.return_basis === "closed_realized" ? "سعر الخروج" : "آخر إغلاق مسجل"} ${p.valuation_price ?? "غير متاح"} جنيه (${p.valuation_date || "تاريخ التقييم غير متاح"})؛ ${value}؛ ${row.status_label || row.status}. تاريخ الإشارة ${String(p.signal_date || "غير متاح").slice(0, 10)}.`;
        }), "هذه إشارات سابقة؛ بيانات الأداء المؤرخة لا تمثل إشارة دخول جديدة، ولا تشمل العمولات."].join("\n");
}
