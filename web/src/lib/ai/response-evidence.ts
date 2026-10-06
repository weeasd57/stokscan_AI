import { IntentPlan, ToolResult } from "./types";
import { buildDecisionFallback } from "./decision-evidence";
import { summarizeNewsEvidence, summarizeToolNewsEvidence, corporateActionDates, isTodayNewsRequest, newsEventDate } from "./news-evidence";
import { renderRecommendationEvidence } from "./recommendation-presentation";
import { explicitBollingerPreset } from "./scan-request";
import { isBestBuyStockQuestion, normalizeArabicIntent } from "./intent-policy";

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

function assertsMarketQuote(clause: string): boolean {
    const text = clause.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[*_]/g, "");
    // Entry prices, targets and conditional future closes are different facts
    // from an observed market quote and do not inherit the quote's timestamp.
    if (/(?:^|\s)(?:اذا|لو|عند|حال|في حاله)\s/.test(text)) return false;
    return /(?:اخر\s+)?(?:اغلاق(?:\s+(?:مسجل|رسمي|يومي))?|السعر(?:\s+(?:الحالي|اللحظي|المسجل))?|سعر\s+(?:السهم|حالي|لحظي|مسجل)|يتداول(?:\s+الان)?)\s*(?:(?:هو|عند|بلغ|يساوي)\s*)?[:=]?\s*\d/.test(text);
}

export function evidencePolicyPrompt(results: ToolResult[]): string {
    return `=== PUBLICATION EVIDENCE CONTRACT ===
كل معلومة لها تاريخ حدث مستقل عن وقت جلبها. لا تصف الإغلاق اليومي بأنه لحظي حتى لو تاريخ اليوم.
اختلاف أداء المؤشرات وحجم التداول وحدهما لا يثبتان انتقال الأموال أو دخول/خروج سيولة مؤسسية.
لا تحول غياب بيانات وايكوف إلى neutral أو أصفار. اذكر wyckoff_status وwyckoff_as_of؛ الأصفار المسجلة حالة رصد وليست غياب بيانات.
الأخبار تتطلب عنواناً وتاريخ نشر؛ صف معنويات أو وقت جلب لا يثبت وجود خبر اليوم. عند غياب خبر اليوم قل صراحة لم أجد خبراً موثقاً اليوم في المصادر المتاحة.
تاريخ نشر خبر الشركة مستقل عن تاريخ تنفيذ الإجراء؛ لا تستبدل أياً منهما بوقت جلب الأداة. وجود إجراء شركة لا يثبت أنه سبب تغير السعر أو حجم التداول.
${JSON.stringify(results.filter(r => ["get_market", "get_stock", "get_news", "get_corporate_actions"].includes(r.tool)).map(r => ({ tool: r.tool, symbols: r.symbols, date: r.data_time,
        ...(r.tool === "get_market" ? { quote_kind: r.data?.quote_kind || "daily_close", dates: r.data?.component_dates } : {}),
        ...(r.tool === "get_stock" ? { volume: volumeAssessment(r.data?.vol_ratio), wyckoff_status: r.data?.wyckoff_status, wyckoff_as_of: r.data?.wyckoff_as_of } : {}),
        ...(r.tool === "get_news" ? { news: summarizeNewsEvidence(r.data) } : {}),
        ...(r.tool === "get_corporate_actions" ? { actions: (r.data?.corporate_actions || []).map((a: any) => ({ title: a.title, symbol: a.symbol, ...corporateActionDates(a) })) } : {}),
    })))}`;
}

/** These checks run both in the rewrite loop and at the single publication boundary. */
export function evidenceViolations(reply: string, message: string, results: ToolResult[]): string[] {
    const reasons: string[] = [];
    const normalized = reply.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    const requestedPreset = explicitBollingerPreset(message);
    if (requestedPreset) {
        const scan = results.find(r => r.tool === "get_technical_scan" && r.data?.preset === requestedPreset);
        const rows = Array.isArray(scan?.data?.stocks) ? scan.data.stocks : [];
        const valid = scan && !scan.error && scan.availability !== "failed" && rows.every((r: any) => r.bollinger_evidence?.available === true && r.bollinger_evidence?.matches === true);
        const unavailable = /تعذر|غير متاح|لا تتوفر|لا توجد قائمه موثقه|لم اتمكن/.test(normalized);
        if (!valid && !unavailable) reasons.push("طلب بولينجر يحتاج فحص المعيار المحدد ودليل تطابق النطاق السعري مع الحد؛ الأداة الحالية لا تثبت القائمة. صرّح بتعذر التحقق.");
        if (!valid && /(?:الاسهم التاليه|قائمه الاسهم|اسهم).{0,45}(?:لامست|لمست|تلامس|المطابقه)/.test(normalized)) reasons.push("لا تعرض أسهماً على أنها لامست بولينجر دون نتيجة فحص موثقة مطابقة للطلب.");
        const partial = scan?.data?.scan_collection?.complete === false || scan?.data?.scan_collection?.missing_evidence_count > 0;
        if (valid && partial) {
            if (!/تغطيه.{0,15}جزئيه|فحص.{0,15}(?:جزئي|غير مكتمل)|قائمه.{0,15}(?:غير مكتمله|غير شامله)|لا يمكن.{0,30}(?:شامله|كل السوق)/.test(normalized)) reasons.push("تغطية فحص بولينجر جزئية؛ اذكر نقص السجلات أو أدلة الأسعار صراحة ولا تعرض النتائج كقائمة مكتملة.");
            const completeClaim = normalized.split(/[\n؛.!؟]/).some(clause => /(?:القائمه|قائمه|الفحص|فحص).{0,20}(?:كامله|كامل|شامله|شامل)|(?:كل|جميع|كافه).{0,15}اسهم.{0,15}السوق|(?:كل|جميع).{0,15}الاسهم.{0,30}(?:لمست|لامست|المطابقه)/.test(clause)
                && !/غير|ليست|ليس|لا يمكن|لا تشمل|لا تغطي/.test(clause));
            if (completeClaim) reasons.push("لا تدّعِ اكتمال قائمة بولينجر أو شمولها السوق مع وجود تغطية ناقصة؛ تنبيه منفصل لا يصحح ادعاء الاكتمال.");
        }
    }
    const market = results.find(r => r.tool === "get_market" && !r.error);
    if (market && !market.data?.is_live_intraday) {
        const refersToMarketData = /(?:egx\s*30|egx\s*100|المؤشر|مؤشر|مؤشرات|usd|دولار)/i.test(normalized)
            || /(?:حالة|وضع|اتجاه)\s+السوق/i.test(normalized);
        if (refersToMarketData && !/اغلاق|بيانات يوميه|لقطه يوميه|جلسه|اخر جلسه|نهايه الجلسه/.test(normalized)) reasons.push("بيانات السوق إغلاق يومي؛ صرّح بذلك ولا تقدمها كشاشة لحظية.");
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
    if (isTodayNewsRequest(message)) {
        const dated = summarizeToolNewsEvidence(results).today_count > 0;
        if (!dated && !/(?:لم\s+اجد|لا\s+يوجد|لا\s+توجد|لا\s+تتوفر|مفيش|لم\s+اعثر).{0,65}(?:خبر|اخبار).{0,65}(?:اليوم|النهارده|بتاريخ)/.test(normalized)) reasons.push("لا يوجد عنوان موثق بتاريخ اليوم؛ اذكر حدود التغطية صراحة حتى لو لم تسمّ الرد أخبار اليوم.");
        if (!dated && normalized.split(/[\n؛.!؟]/).some(clause => /(?:اخبار|خبر|اعلنت?|نشر).{0,25}(?:اليوم|النهارده)|(?:اليوم|النهارده).{0,25}(?:اعلنت?|نشر)/.test(clause)
            && !/لم اجد|لم اعثر|لا يوجد|لا توجد|لا تتوفر|مفيش|اقدم من اليوم|غير موثق|عدم صدور/.test(clause))) {
            reasons.push("لا تقدّم عنواناً قديماً أو غير مؤرخ كخبر منشور اليوم؛ الإفصاح عن نقص التغطية في جملة أخرى لا يصحح هذا الادعاء.");
        }
    }
    for (const result of results.filter(r => r.tool === "get_corporate_actions" && !r.error)) {
        const actions = Array.isArray(result.data?.corporate_actions) ? result.data.corporate_actions : [];
        const actualDates = actions.flatMap((a: any) => Object.values(corporateActionDates(a))).filter(Boolean);
        const retrievalDate = newsEventDate({ date: result.data_time });
        const clauses = normalized.split(/[\n؛.!؟]/);
        if (retrievalDate && !actualDates.includes(retrievalDate) && clauses.some(clause => clause.includes(retrievalDate)
            && !/^#|^\||\bجدول\b|\bتصدير\b|الأحداث|المالية|المؤثرة|توزيعات|أسهم|اكتتاب|discovered_at|published_at/i.test(clause.trim())
            && /نشر|اعلان|حدث|اكتتاب|توزيع|مجانيه|راس المال|تنفيذ|استحقاق/.test(clause)
            && !/جلب|استرجاع|فحص|تحديث البيانات/.test(clause))) {
            reasons.push("تاريخ جلب أداة أحداث الشركات ليس تاريخ نشر أو تنفيذ؛ اذكر published_at وaction_date كلٌّ باسمه أو وضّح غيابه.");
        }
        const causalClaim = clauses.some(clause => /بسبب|نتيجه|ادي|دفع|يفسر|تسبب|سبب|انعكس/.test(clause)
            && /سعر|حجم|ارتفاع|انخفاض|صعود|هبوط|تداول|حركه/.test(clause)
            && /اكتتاب|توزيع|مجانيه|تجزئه|راس المال|الخبر|الحدث|الاجراء/.test(clause)
            && !/بشكل عام|عموما|عاده|نظريا|من حيث المبدا|اذا|لو\s|لا يثبت|لا يمكن|لا يكفي|ليس دليلا|غير مثبت|غير موثق/.test(clause));
        if (actions.length && causalClaim) reasons.push("وجود حدث شركة لا يثبت أنه سبب حركة السعر أو حجم التداول؛ افصل الحدث الموثق عن التفسير السببي غير المدعوم.");
    }
    const stocks = results.filter(r => r.tool === "get_stock" && !r.error);
    for (const stock of stocks) {
        const symbol = String(stock.data?.symbol || stock.symbols[0] || "");
        const otherSymbols = stocks.map(r => String(r.data?.symbol || r.symbols[0] || "")).filter(Boolean);
        const quoteClauses = reply.split("\n").flatMap(line => {
            const lineSymbols = [...new Set((line.match(new RegExp(`\\b(?:${otherSymbols.join("|")})\\b`, "gi")) || []).map(value => value.toUpperCase()))];
            if (lineSymbols.length <= 1 && lineSymbols[0] === symbol.toUpperCase()) return [line];
            const named = [...line.matchAll(new RegExp(`\\b(?:${otherSymbols.join("|")})\\b`, "gi"))];
            return named.filter(match => match[0].toUpperCase() === symbol.toUpperCase()).map(match => {
                const next = named.find(candidate => (candidate.index ?? 0) > (match.index ?? 0));
                return line.slice(match.index, next?.index ?? line.length);
            });
        }).flatMap(clause => {
            const parts: string[] = [];
            for (const part of clause.split(/[؛،]|(?<=[.!?])\s+/)) {
                if (parts.length && /^\s*(?:بتاريخ|تاريخ|جلسة|جلسه)\s*\d{4}-/.test(part)) parts[parts.length - 1] += `، ${part}`;
                else parts.push(part);
            }
            return parts;
        }).filter(assertsMarketQuote);
        if (quoteClauses.length && !stock.data?.is_live_intraday) {
            const date = String(stock.data_time || "").slice(0, 10);
            const textHasDate = date && reply.includes(date);
            const textHasCloseLabel = /إغلاق|اغلاق|سعر مسجل|بيانات مسجلة|بيانات مسجله|يومي|غير لحظي/.test(normalized);
            const distinctStockDates = new Set(stocks.map(s => String(s.data_time || "").slice(0, 10)).filter(Boolean));
            const hasMultipleStockDates = distinctStockDates.size > 1;

            if (date) {
                if (!textHasDate) {
                    reasons.push(`${symbol}: اذكر تاريخ آخر إغلاق ${date} مع سعره صراحة في الرد.`);
                } else if (hasMultipleStockDates) {
                    if (quoteClauses.some(clause => !clause.includes(date))) {
                        reasons.push(`${symbol}: اذكر تاريخ آخر إغلاق ${date} مع سعره صراحة في الرد.`);
                    }
                } else {
                    const hasConflictingDate = quoteClauses.some(clause => {
                        const clauseDates: string[] = clause.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
                        return clauseDates.length > 0 && !clauseDates.includes(date);
                    });
                    if (hasConflictingDate) {
                        reasons.push(`${symbol}: اذكر تاريخ آخر إغلاق ${date} مع سعره صراحة في الرد.`);
                    }
                }
            }
            if (!textHasCloseLabel && quoteClauses.some(clause => !/إغلاق|اغلاق|سعر مسجل|بيانات مسجلة|بيانات مسجله/.test(clause))) reasons.push(`${symbol}: السعر المسجل إغلاق يومي؛ وضّح نوعه بجانب السعر.`);
            const affirmativeLive = quoteClauses.map(clause => clause.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه")).some(line => /بيانات تداول مباشره|(?:السعر|سعر|يتداول).{0,18}(?:لحظي|مباشر)/.test(line)
                && !/ليس|ليست|غير|لا يتوفر|لا تتوفر|مش/.test(line));
            if (affirmativeLive) reasons.push(`${symbol}: لا تصف بيانات الإغلاق اليومية بأنها تداول مباشر أو سعر لحظي.`);
        }
        const clauses = stocks.length === 1 ? normalized.split(/\n|[؛。]/) : normalized.split("\n").filter(line => line.includes(String(stock.data?.symbol || stock.symbols[0])));
        const ratio = volumeRatio(stock.data?.vol_ratio_num ?? stock.data?.vol_ratio);
        if (ratio != null && ratio < 1 && clauses.some(line => /(?:الحجم|حجم التداول)\s+(?:المرتفع|مرتفع)|حجم\s+(?:عال|عالي|كبير)/.test(line) && !/اذا|لو|ليس|مش|غير/.test(line))) reasons.push("نسبة الحجم أقل من المتوسط؛ لا تصف الحجم بأنه مرتفع.");
    }
    return reasons;
}

export function asksForRecommendationEvidence(message: string, plan?: IntentPlan): boolean {
    const normalizedMessage = normalizeArabicIntent(message);
    const explicitRequest = isBestBuyStockQuestion(message)
        || /(?:توصي|ترشيح|اشارات المنصه|سجل التوصيات|recommendations?|signals?)/i.test(normalizedMessage);
    const contextualRequest = Boolean(plan && (
        plan.request?.required_facts?.includes("recommendations")
        || plan.entities?.recommendation_order
        || (plan.intent === "historical_recall" && (plan.tools || []).some(tool => tool === "get_recommendations" || tool === "get_signals"))
    ));
    return explicitRequest || contextualRequest;
}

export function asksForAccumulationEvidence(message: string, plan?: IntentPlan): boolean {
    const normalizedMessage = normalizeArabicIntent(message);
    return /(?:تجميع|accumulation|wyckoff|سيوله.{0,12}(?:مؤسسي|ذكي)|(?:مؤسسي|ذكي).{0,12}سيوله)/i.test(normalizedMessage)
        || plan?.ranking_metric === "accumulation"
        || plan?.request?.required_facts?.includes("accumulation") === true
        || plan?.entities?.scan_direction === "accumulation";
}

export function safeEvidenceResponse(message: string, results: ToolResult[], plan?: IntentPlan): string {
    const sections: string[] = [];
    const normalizedMessage = normalizeArabicIntent(message);
    const asksRecommendations = asksForRecommendationEvidence(message, plan);
    const asksAccumulation = asksForAccumulationEvidence(message, plan);
    const asksDistribution = /(?:تصريف|distribution)/i.test(normalizedMessage);
    const asksMarket = /(?:السوق|البورصه|مؤشر(?:ات)?|شاشه|لحظي|مباشر|حركه السوق|الاسهم الاكثر ارتفاع|الاكثر ارتفاع|الاسهم الصاعده|الاعلى ارتفاع|اعلى هبوط|الدولار كام|سعر الدولار|usd\/egp|egp\/usd)/i.test(normalizedMessage);
    const asksNews = /(?:اخبار|خبر|news|عاجل)/i.test(normalizedMessage);
    const asksCorporateAction = /(?:حدث|احداث|اسهم مجانيه|توزيعات|اكتتاب|زياده راس المال|تجزئه|منحه|bonus shares|dividend|rights issue)/i.test(normalizedMessage);
    const asksSector = /(?:قطاع|القطاعات|البنوك|العقارات|الاتصالات|الادويه)/i.test(normalizedMessage);
    const decisionPlan = plan || { intent: "comparison", entities: { symbols: Array.from(new Set(results
        .filter(r => ["get_stock", "get_comparison"].includes(r.tool)).flatMap(r => r.symbols || []))) } } as IntentPlan;
    const decision = buildDecisionFallback(message, decisionPlan, results);
    if (decision) sections.push(decision);
    const image = results.find(r => r.tool === "image_context")?.data;
    if (image?.symbols?.length) {
        sections.push(image.image_type === "portfolio"
            ? "قراءة المحفظة من الصورة المرفقة؛ هذه بيانات ظاهرة في الصورة وليست محفظة الحساب المحفوظة."
            : "قراءة البيانات الظاهرة في الصورة المرفقة؛ نوعها لا يثبت ملكية الأسهم في الحساب.");
        for (const item of image.symbols) {
            sections.push(`- ${item.symbol}: الكمية ${item.visible_values?.quantity ?? "غير مقروءة"}؛ السعر الظاهر ${item.visible_values?.price ?? "غير مقروء"}؛ التغير الظاهر ${item.visible_values?.change_pct == null ? "غير مقروء" : `${item.visible_values.change_pct}%`}.`);
        }
        sections.push("لا أحسب تكلفة الشراء أو الربح الكلي عند غياب الكميات أو متوسطات الشراء.");
    }
    const todayNews = isTodayNewsRequest(message);
    const newsSummary = summarizeToolNewsEvidence(results);
    if (todayNews && !newsSummary.today_count) sections.push(`لم أجد خبراً موثقاً اليوم (${newsSummary.today}) في المصادر المتاحة؛ هذا لا يؤكد عدم صدور أخبار.`);
    const requestedPreset = explicitBollingerPreset(message);
    if (requestedPreset) {
        const scan = results.find(r => r.tool === "get_technical_scan" && r.data?.preset === requestedPreset);
        const rows = Array.isArray(scan?.data?.stocks) ? scan.data.stocks : [];
        const valid = scan && !scan.error && scan.availability !== "failed" && rows.every((r: any) => r.bollinger_evidence?.available === true && r.bollinger_evidence?.matches === true);
        if (!valid) sections.push("تعذر التحقق من فحص بولينجر المطلوب؛ لا توجد قائمة موثقة يمكن عرضها لهذا المعيار حالياً.");
        else {
            const side = requestedPreset === "bollinger_lower_touch" ? "السفلي" : "العلوي";
            const date = scan.data?.date || scan.data_time || "غير موثق";
            sections.push(rows.length ? [`نتائج لمس الحد ${side} لبولينجر بتاريخ ${date}:`,
                ...rows.map((row: any) => `- ${row.symbol}: الحد ${row.bollinger_evidence.band}؛ نطاق الجلسة ${row.bollinger_evidence.low} إلى ${row.bollinger_evidence.high}؛ التاريخ ${row.date || date}.`)].join("\n")
                : `لم يظهر تطابق موثق مع لمس الحد ${side} لبولينجر في البيانات المفحوصة بتاريخ ${date}.`);
            if (scan.data?.scan_collection?.complete === false || scan.data?.scan_collection?.missing_evidence_count > 0) sections.push("تغطية الفحص جزئية؛ بعض السجلات أو أدلة الأسعار غير متاحة، لذلك لا يمكن اعتبار القائمة شاملة للسوق.");
        }
    }
    for (const actionResult of results.filter(r => (asksCorporateAction || asksNews) && r.tool === "get_corporate_actions" && !r.error)) {
        const actions = Array.isArray(actionResult.data?.corporate_actions) ? actionResult.data.corporate_actions : [];
        if (actions.length) sections.push(["أحداث الشركات الموثقة:", ...actions.slice(0, 20).map((action: any) => {
            const kind = action.action_type_ar || ({ bonus_shares: "أسهم مجانية", dividend: "توزيعات نقدية",
                capital_increase: "زيادة رأس المال", rights_issue: "حقوق اكتتاب", stock_split: "تجزئة الأسهم",
                capital_decrease: "تخفيض رأس المال" } as Record<string, string>)[action.action_type] || "حدث مالي";
            const dates = corporateActionDates(action);
            return `- ${action.symbol || "الشركة"}: ${kind}؛ ${action.title || action.headline || "التفاصيل التنفيذية غير متاحة"}؛ تاريخ نشر الخبر ${dates.published_date || "غير موثق"}؛ تاريخ تنفيذ الإجراء ${dates.action_date || "غير موثق"}.`;
        })].join("\n"));
    }
    const recommendations = asksRecommendations ? results.find(r => r.tool === "get_recommendations" || r.tool === "get_signals") : undefined;
    if (recommendations) sections.push(renderRecommendationEvidence(recommendations));
    for (const scan of results.filter(r => (r.tool === "get_accumulation_stocks" && asksAccumulation)
        || (r.tool === "get_distribution_stocks" && asksDistribution))) {
        const metric = scan.tool === "get_distribution_stocks" ? "التصريف" : "التجميع";
        const field = scan.tool === "get_distribution_stocks" ? "dist_score" : "acc_score";
        const rows = Array.isArray(scan.data?.stocks) ? scan.data.stocks : [];
        const date = String(scan.data?.date || scan.data_time || "تاريخ غير محدد").slice(0, 10);
        if (scan.data?.note) sections.push(scan.data.note);
        sections.push(rows.length
            ? [`أحدث مسح ${metric} متاح بتاريخ ${date}:`, ...rows.slice(0, 15).map((row: any) =>
                row.is_market_alternative
                    ? `- ${row.symbol}: بديل نشط/زخم؛ السعر ${row.close}؛ التغير ${row.change_pct}%؛ RSI ${row.rsi_14 ?? "N/A"}؛ نسبة الحجم ${row.vol_ratio}x.`
                    : `- ${row.symbol}: درجة ${metric} ${row[field] ?? "غير متاحة"}/100؛ مرحلة وايكوف ${row.wyckoff_phase || "غير متاحة"}.`)].join("\n")
            : `لم تظهر أسهم موثقة في مسح ${metric} المتاح بتاريخ ${date}.`);
    }
    const sector = asksSector ? results.find(r => r.tool === "get_sector" && !r.error) : undefined;
    if (sector && sector.data?.sector) {
        const d = sector.data;
        sections.push(`المتاح لدي لقطة إغلاق يومية لقطاع ${d.sector} وليست بيانات لحظية (بتاريخ ${sector.data_time || "غير محدد"}).`);
        if (Array.isArray(d.gainers) && d.gainers.length > 0) {
            sections.push(`الأسهم الأكثر صعوداً بقطاع ${d.sector}:\n` + d.gainers.slice(0, 5).map((s: any) => `- ${s.symbol}: +${Number(s.tech?.change_pct || 0).toFixed(2)}%`).join("\n"));
        }
        if (Array.isArray(d.losers) && d.losers.length > 0) {
            sections.push(`الأسهم الأكثر تراجعاً بقطاع ${d.sector}:\n` + d.losers.slice(0, 5).map((s: any) => `- ${s.symbol}: ${Number(s.tech?.change_pct || 0).toFixed(2)}%`).join("\n"));
        }
    }
    const market = asksMarket ? results.find(r => r.tool === "get_market" && !r.error) : undefined;
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
    const news = asksNews ? results.filter(r => ["get_news", "search_web"].includes(r.tool)) : [];
    if (todayNews || (asksNews && news.length > 0)) {
        const selected = todayNews ? newsSummary.today_articles : newsSummary.articles;
        if (selected.length) sections.push(selected.slice(0, 5).map(a => `- ${a.title} (تاريخ النشر ${a.event_date || "غير موثق"})`).join("\n"));
        else if (todayNews) {
            const older = newsSummary.articles.filter(a => a.event_date && a.event_date < newsSummary.today).sort((a, b) => b.event_date!.localeCompare(a.event_date!)).slice(0, 3);
            if (older.length) sections.push(["أحدث أخبار أقدم من اليوم في المصادر المتاحة:", ...older.map(a => `- ${a.title} (تاريخ النشر ${a.event_date})`)].join("\n"));
        } else sections.push("لم أجد خبراً موثقاً في المصادر المتاحة للفترة المطلوبة؛ هذا لا يؤكد عدم صدور أخبار.");
    }
    for (const r of results.filter(r => !decision && r.tool === "get_stock" && !r.error)) {
        if (r.data?.price != null) sections.push(`${r.data?.symbol || r.symbols[0]}: السعر ${r.data?.is_live_intraday ? "اللحظي" : "آخر إغلاق مسجل"} ${r.data.price} جنيه بتاريخ ${r.data_time || "غير محدد"}.`);
        sections.push(`${r.data?.symbol || r.symbols[0]} — نسبة حجم التداول ${r.data?.vol_ratio ?? "غير متاحة"}: ${volumeAssessment(r.data?.vol_ratio)}. حجم التداول وحده لا يثبت التجميع أو التصريف.`);
        const rec = r.data?.recommendation;
        if (asksRecommendations && rec?.has_recommendation) sections.push(renderRecommendationEvidence({ ...r, tool: "get_recommendations", data: [{ ...rec, symbol: r.data?.symbol || r.symbols[0] }] }));
    }
    return sections.join("\n\n") || "تعذر التحقق من إجابة متسقة مع سؤالك والبيانات المتاحة. أعد المحاولة لاستكمال التحقق.";
}
