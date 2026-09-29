import { ToolResult } from "./types";
import { summarizeNewsEvidence } from "./news-evidence";

export function volumeRatio(value: unknown): number | null {
    if (value == null || value === "") return null;
    const parsed = Number(String(value).trim().replace(/x$/i, ""));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function volumeAssessment(value: unknown): string {
    const ratio = volumeRatio(value);
    if (ratio == null) return "غير متاح";
    return ratio < 1 ? "أقل من متوسط 20 جلسة" : ratio > 1.5 ? "أعلى بوضوح من متوسط 20 جلسة" : "قريب من متوسط 20 جلسة أو أعلى منه قليلاً";
}

export function evidencePolicyPrompt(results: ToolResult[]): string {
    return `=== PUBLICATION EVIDENCE CONTRACT ===
كل معلومة لها تاريخ حدث مستقل عن وقت جلبها. لا تصف الإغلاق اليومي بأنه لحظي حتى لو تاريخ اليوم.
اختلاف أداء المؤشرات وحجم التداول وحدهما لا يثبتان انتقال الأموال أو دخول/خروج سيولة مؤسسية.
لا تحول غياب بيانات وايكوف إلى neutral أو أصفار. اذكر wyckoff_status وwyckoff_as_of؛ الأصفار المسجلة حالة رصد وليست غياب بيانات.
الأخبار تتطلب عنواناً وتاريخ نشر؛ صف معنويات أو وقت جلب لا يثبت وجود خبر اليوم. عند غياب خبر اليوم قل صراحة لم أجد خبراً موثقاً اليوم في المصادر المتاحة.
${JSON.stringify(results.filter(r => ["get_market", "get_stock", "get_news"].includes(r.tool)).map(r => ({ tool: r.tool, symbols: r.symbols, date: r.data_time,
        ...(r.tool === "get_market" ? { quote_kind: r.data?.quote_kind || "daily_close", dates: r.data?.component_dates } : {}),
        ...(r.tool === "get_stock" ? { volume: volumeAssessment(r.data?.vol_ratio), wyckoff_status: r.data?.wyckoff_status, wyckoff_as_of: r.data?.wyckoff_as_of } : {}),
        ...(r.tool === "get_news" ? { news: summarizeNewsEvidence(r.data) } : {}),
    })))}`;
}

/** These checks run both in the rewrite loop and at the single publication boundary. */
export function evidenceViolations(reply: string, message: string, results: ToolResult[]): string[] {
    const reasons: string[] = [];
    const normalized = reply.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    const market = results.find(r => r.tool === "get_market" && !r.error);
    if (market && !market.data?.is_live_intraday) {
        if (!/اغلاق|بيانات يوميه|لقطه يوميه|اخر جلسه متاحه/.test(normalized)) reasons.push("بيانات السوق إغلاق يومي؛ صرّح بذلك ولا تقدمها كشاشة لحظية.");
        if (/لحظ|مباشر/.test(message) && !/(?:ليست|ليس|غير|لا\s+تتوفر|لا\s+يتوفر|لا\s+املك|مش|لا\s+توجد).{0,35}(?:لحظ|مباشر)/.test(normalized)) reasons.push("طلب المستخدم شاشة لحظية؛ وضّح صراحة أن البيانات المتاحة ليست لحظية.");
        const componentLabels: Record<string, RegExp> = { egx30: /EGX\s*30/i, egx100: /EGX\s*100/i, usd: /USD|دولار/i, movers: /ارتفاع|انخفاض|صاعد|هابط|رابح|خاسر/ };
        for (const [field, date] of Object.entries(market.data?.component_dates || {})) {
            if (date && componentLabels[field]?.test(reply) && !reply.includes(String(date))) reasons.push(`اذكر تاريخ مكونات لقطة السوق المعروضة: ${date}.`);
        }
        const flowClaim = /(?:انتقال|انتقلت|تتحول|تحول|تنتقل|اتجاه|توجه|دخلت?|خرجت?|دخول|خروج|تدفق).{0,30}(?:السيوله|الاموال|اموال)|(?:السيوله|الاموال|اموال).{0,30}(?:انتقل|تنتقل|تتجه|توجه|تحول|دخل|خرج|تدفق)/;
        const unsupportedFlow = normalized.split(/[\n؛.!؟]/).some(sentence => flowClaim.test(sentence)
            && !/(?:لا|ليس|مش|غير|دون).{0,35}(?:يثبت|دليل|يكفي|يمكن|يعني|موثق|جزم|اثبات)|لا يثبت|لا يكفي|لا تعني/.test(sentence));
        if (unsupportedFlow) reasons.push("اختلاف المؤشرات لا يثبت دخول أو خروج أو انتقال السيولة؛ احذف الاستنتاج غير المدعوم.");
    }
    const news = results.filter(r => ["get_news", "search_web"].includes(r.tool));
    if (news.length && /اليوم|النهارده|النهاردة|today/i.test(message)) {
        const dated = news.some(r => !r.error && summarizeNewsEvidence(Array.isArray(r.data) ? r.data : r.data?.results).today_count > 0);
        if (!dated && !/(?:لم\s+اجد|لا\s+يوجد|لا\s+توجد|لا\s+تتوفر|مفيش|لم\s+اعثر).{0,65}(?:خبر|اخبار).{0,65}(?:اليوم|النهارده|بتاريخ)/.test(normalized)) reasons.push("لا يوجد عنوان موثق بتاريخ اليوم؛ اذكر حدود التغطية صراحة حتى لو لم تسمّ الرد أخبار اليوم.");
    }
    const stocks = results.filter(r => r.tool === "get_stock" && !r.error);
    for (const stock of stocks) {
        const clauses = stocks.length === 1 ? normalized.split(/\n|[؛。]/) : normalized.split("\n").filter(line => line.includes(String(stock.data?.symbol || stock.symbols[0])));
        const ratio = volumeRatio(stock.data?.vol_ratio_num ?? stock.data?.vol_ratio);
        if (ratio != null && ratio < 1 && clauses.some(line => /(?:الحجم|حجم التداول)\s+(?:المرتفع|مرتفع)|حجم\s+(?:عال|عالي|كبير)/.test(line) && !/اذا|لو|ليس|مش|غير/.test(line))) reasons.push("نسبة الحجم أقل من المتوسط؛ لا تصف الحجم بأنه مرتفع.");
    }
    return reasons;
}

export function safeEvidenceResponse(message: string, results: ToolResult[]): string {
    const sections: string[] = [];
    const market = results.find(r => r.tool === "get_market" && !r.error);
    if (market) {
        const d = market.data || {};
        const dates = d.component_dates || {};
        sections.push("المتاح لدي لقطة إغلاق يومية وليست بيانات لحظية.");
        for (const [field, label] of [["egx30", "EGX30"], ["egx100", "EGX100"], ["usd", "USD/EGP"]]) {
            if (d[field] != null && Number.isFinite(Number(d[field]))) sections.push(`- ${label}: ${Number(d[field]).toLocaleString("en-US")} — بتاريخ ${dates[field] || market.data_time || "غير محدد"}.`);
        }
        if (dates.movers) sections.push(`تاريخ بيانات الأسهم الصاعدة والهابطة: ${dates.movers}.`);
        for (const [key, label] of [["top_gainers", "الأعلى ارتفاعاً"], ["top_losers", "الأعلى انخفاضاً"]]) {
            if (Array.isArray(d[key]) && d[key].length) sections.push(`${label} — آخر جلسة متاحة بتاريخ ${dates.movers || market.data_time || "غير محدد"}:\n${d[key].slice(0, 10).map((row: any) => `- ${row.symbol}: ${Number(row.change ?? row.change_pct).toFixed(2)}%`).join("\n")}`);
        }
        sections.push("اختلاف أداء المؤشرات وحده لا يثبت انتقال السيولة بين الأسهم.");
    }
    const news = results.filter(r => ["get_news", "search_web"].includes(r.tool));
    if (news.length) {
        const articles = news.filter(r => !r.error).flatMap(r => summarizeNewsEvidence(Array.isArray(r.data) ? r.data : r.data?.results).articles);
        const today = summarizeNewsEvidence([]).today;
        const selected = /اليوم|النهارده|النهاردة|today/i.test(message) ? articles.filter(a => a.event_date === today) : articles;
        sections.push(selected.length ? selected.slice(0, 5).map(a => `- ${a.title} (${a.event_date || "تاريخ النشر غير موثق"})`).join("\n") : "لم أجد خبراً موثقاً اليوم في المصادر المتاحة؛ هذا لا يؤكد عدم صدور أخبار.");
    }
    for (const r of results.filter(r => r.tool === "get_stock" && !r.error)) {
        sections.push(`${r.data?.symbol || r.symbols[0]} — نسبة حجم التداول ${r.data?.vol_ratio ?? "غير متاحة"}: ${volumeAssessment(r.data?.vol_ratio)}. حجم التداول وحده لا يثبت التجميع أو التصريف.`);
    }
    return sections.join("\n\n") || "تعذر التحقق من إجابة متسقة مع سؤالك والبيانات المتاحة. أعد المحاولة لاستكمال التحقق.";
}
