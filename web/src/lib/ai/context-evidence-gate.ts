import { IntentPlan, ToolResult, VisionContext } from "./types";
import { finiteMetric } from "./market-snapshot";
import { normalizeArabicIntent } from "./intent-policy";

/** Validate relationships, source selection and compound coverage, not merely
 * whether a number appears somewhere in a heterogeneous tool payload. */
export function checkContextEvidence(reply: string, plan: IntentPlan, results: ToolResult[], vision?: VisionContext | null): string[] {
    const reasons = new Set<string>();
    const text = normalizeArabicIntent(reply).replace(/[*_`]/g, "");
    const stocks = results.filter(r => r.tool === "get_stock" && !r.error && r.data?.symbol);
    const levels = results.filter(r => r.tool === "get_stock_levels");
    const image = vision || results.find(r => r.tool === "image_context")?.data;
    if (image?.symbols?.length) {
        if (image.image_type === "portfolio" && /محفظتك.{0,25}(فاضيه|فارغه)|اجمالي قيمه المحفظه:\s*0/.test(text)) {
            reasons.add("الصورة تحتوي مراكز؛ لا تستبدل محفظة الصورة بمحفظة الحساب الفارغة أو تنفِ محتواها.");
        }
        if (!/صوره|(?:بيانات|اسهم|مراكز).{0,15}(?:المرفق|الظاهره)/.test(text)) reasons.add("اذكر أن تحليل المحفظة مستند إلى الصورة المرفقة، وافصله عن بيانات الحساب المحفوظة.");
        for (const item of image.symbols) {
            if (!new RegExp(`\\b${String(item.symbol).toLowerCase()}\\b`, "i").test(text)) reasons.add(`الرد تجاهل مركز الصورة ${item.symbol}؛ غطّه أو وضّح تعذر قراءة بياناته.`);
        }
    }
    if (["stock_analysis", "comparison"].includes(plan.intent) && (plan.entities.symbols?.length || 0) > 1 && stocks.length) {
        for (const symbol of plan.entities.symbols) {
            const stock = stocks.find(r => String(r.data.symbol).toUpperCase() === symbol.toUpperCase());
            const named = new RegExp(`\\b${symbol}\\b`, "i").test(reply) || (stock?.data.name && reply.includes(stock.data.name));
            if (!named) reasons.add(`الطلب يشمل ${symbol} لكن الرد لم يغطّه؛ حافظ على جميع أجزاء الطلب.`);
        }
    }
    let activeSymbol = stocks.length === 1 ? String(stocks[0].data.symbol).toUpperCase() : null;
    let conditionalSection = false;
    for (const raw of reply.split("\n")) {
        const line = normalizeArabicIntent(raw).replace(/[*_`]/g, "");
        if (/^\s*(?:#+\s*)?(?:شروط|شرط|سيناريو|للمراقبه)/.test(line)) conditionalSection = true;
        else if (/^\s*#+|^\s*(?:الخلاصه|القراءه الحاليه|المؤشرات|الراي|وايكوف|التوصيه|بيانات)/.test(line)) conditionalSection = false;
        const named = stocks.filter(r => new RegExp(`\\b${String(r.data.symbol)}\\b`, "i").test(raw));
        if (named.length === 1) activeSymbol = String(named[0].data.symbol).toUpperCase();
        if (named.length > 1) continue;
        const stock = stocks.find(r => String(r.data.symbol).toUpperCase() === activeSymbol);
        if (!stock) continue;
        const symbol = stock.data.symbol;
        const level = levels.find(r => String(r.data?.symbol || r.symbols?.[0]).toUpperCase() === String(symbol).toUpperCase());
        const price = finiteMetric(stock.data.price);
        const quoteMatches = Array.from(line.matchAll(/(?:(?<!اعلى\s+|أعلى\s+|ادنى\s+|أدنى\s+|افتتاح\s+|فتح\s+|متوسط\s+|عادل\s+|عادلة\s+|سابق\s+|امس\s+|أمس\s+)(?:سعر(?:\s+(?:السهم|الحالي|اللحظي|مسجل))|السعر(?:\s+(?:الحالي|اللحظي|مسجل))?|(?:آخر\s+|اخر\s+)?اغلاق(?:\s+مسجل)?))\s*[:(]?\s*(?!\d{4}-\d{2}-\d{2})(\d+(?:\.\d+)?)(?![\d.])/g));
        if (quoteMatches.length > 0 && price != null) {
            const hasCorrectPrice = quoteMatches.some(m => Math.abs(Number(m[1]) - price) <= 0.006 || (price > 0 && Math.abs(Number(m[1]) - price) / price <= 0.002));
            if (!hasCorrectPrice && !/اذا|لو|مستهدف|هدف|دخول|شراء|خروج|توصيه|سابق|امس|أمس|اعلى|أعلى|ادنى|أدنى|فتح|افتتاح|متوسط|عادل|عادلة|دعم|مقاوم|نطاق/.test(line)) {
                reasons.add(`${symbol}: السعر المذكور لا يطابق لقطة السعر المعتمدة ${price} بتاريخ ${stock.data_time}؛ لا تستبدله بسعر أقدم من أداة أخرى.`);
            }
        }
        if (level?.data && /مسافه|بنحو|يبعد|تبعد|يبعدان|تبعدان/.test(line)) {
            for (const match of line.matchAll(/([-+]?\d+(?:\.\d+)?)\s*[%٪]/g)) {
                const prefix = line.slice(0, match.index);
                const currentClause = prefix.split(/[؛،]/).at(-1) || "";
                if (/positionpct|موقع|من نطاق/.test(currentClause) || !/مسافه|بنحو|يبعد|تبعد/.test(currentClause)) continue;
                const target = prefix.lastIndexOf("دعم") > prefix.lastIndexOf("مقاوم") ? "distance_from_support_pct" : "distance_from_resistance_pct";
                if (!/دعم|مقاوم/.test(prefix)) continue;
                const expected = finiteMetric(level.data[target]);
                if (expected != null && Math.abs(Number(match[1]) - expected) > .15) reasons.add(`${symbol}: مسافة المستوى ${match[1]}% لا تطابق ${expected}% المحسوبة من سعر ${level.data.quote_basis?.price ?? level.data.close}؛ استخدم أساس الحساب المعتمد.`);
            }
        }
        const positionMatch = line.match(/(?:positionpct|موقع.{0,15}(?:النطاق|السهم)|من نطاق).{0,15}?(\d+(?:\.\d+)?)\s*%/);
        if (positionMatch && level?.data?.position_pct != null && Math.abs(Number(positionMatch[1]) - Number(level.data.position_pct)) > .2) reasons.add(`${symbol}: موقع السعر داخل النطاق لا يطابق السعر المعتمد.`);
        for (const clause of line.split(/[؛،]/)) {
            const isNegatedCross = /(?:دون|بدون|عدم|غياب|لا\s*(?:يوجد|يظهر|يشير|يعكس|يمثل|يعني|يثبت|نرى|نلحظ)|لم\s*(?:يحدث|يسجل|يظهر|يكن|يسبق)|ليس|غير)\s+(?:حدوث\s+|وجود\s+|اي\s+|أي\s+)?تقاطع/i.test(clause);
            const conditional = conditionalSection || isNegatedCross || /اذا|لو\s|يتطلب|يحتاج|مشروط|شرط|شروط|حتى|انتظار|قد يحدث|قبل|تحول|تحوّل|عند حدوث|لتاكيد|لا يثبت|لا تثبت|غير مثبت|لم يثبت/.test(clause);
            if (!conditional && /macd|ماكد/.test(line) && /تقاطع|cross/.test(clause) && !stock.data.macd_cross_evidence?.verified) reasons.add(`${symbol}: MACD أعلى/أقل خط الإشارة وصف للقطة؛ التقاطع يحتاج قيمة سابقة موثقة.`);
            if (!conditional && /(?:اخترق|اختراق).{0,45}(?:اليوم|الجلسه الحاليه)|(?:اليوم|الجلسه الحاليه).{0,45}(?:اخترق|اختراق)/.test(clause) && !stock.data.breakout_evidence?.verified) reasons.add(`${symbol}: لا تثبت اللقطة وقت اختراق المقاومة؛ صف موقع السعر فقط.`);
        }
        if (stock.data.wyckoff_status === "observed" && /وايكوف|wyckoff|مسح/.test(line)
            && /غير متاح|غياب البيانات|لا توجد بيانات/.test(line)) reasons.add(`${symbol}: وايكوف حالة رصد مسجلة؛ الحياد والأصفار لا تعني غياب البيانات.`);
        if (price != null && level?.data?.support != null && level?.data?.resistance != null) {
            const position = finiteMetric(level.data.position_pct);
            if (position != null && position > 25 && /منطقه دعم فنيه|قريب جدا من الدعم|عند الدعم تماما/.test(line)) reasons.add(`${symbol}: وصف القرب من الدعم يناقض موقع السعر المحسوب؛ استخدم trading_zone المعتمد.`);
        }
    }
    const comparison = results.find(r => r.tool === "get_comparison");
    if (comparison) {
        for (const row of comparison.data?.comparisons || []) {
            const line = reply.split("\n").find(l => new RegExp(`\\b${row.symbol}\\b`, "i").test(l) && /سعر|السعر|إغلاق|اغلاق/.test(l));
            if (line && row.as_of && !line.includes(String(row.as_of).slice(0, 10))) reasons.add(`${row.symbol}: المقارنة يجب أن تذكر تاريخ السعر ${String(row.as_of).slice(0, 10)} بجانب قيمته.`);
        }
    }
    if ((stocks.length || comparison) && text.split(/[\n؛.!؟]/).some(clause => {
        const trimmed = clause.trim();
        if (!trimmed || /^[#*_\s-]+$/.test(trimmed)) return false;
        if (/^[#\s]+/.test(trimmed) || /^(?:هل|ماذا|ما|لماذا|ليه)\s/.test(trimmed) || /[؟?]\s*$/.test(trimmed) || /^[*_]{2}[^*_]+[*_]{2}[:：]?$/.test(trimmed)) return false;
        return /فرق احصائي ملحوظ|دلاله احصائيه|دال احصائيا/.test(clause)
            && !/لا يثبت|لا يكفي|لا تكفي|لا يمكن|لا استطيع|لا نستطيع|لم نختبر|لم يجر.{0,10}اختبار|لا يوجد اختبار|لا تتوفر.{0,15}(?:اختبار|نتائج)|غير موثق|دون اختبار|من غير اختبار|ليس دليلا|لا يدل|لا يعني|لا يمثل|لا يحمل|دون دلاله|بلا دلاله|غير دال/.test(clause);
    })) reasons.add("لم يجر اختبار للدلالة الإحصائية؛ لا تجزم بوجودها أو غيابها، وصف فرق الدرجات بالنقاط فقط.");
    if (stocks.length && /(?:king|egx).{0,80}(?:يقرأ|يقرا|بسبب|يركز|يرجح|يرجّح).{0,70}(?:الطويل|القصير|الزخم|متوسطات|المتوسطات)/i.test(text)) reasons.add("لا تخترع تفسيراً لقرار نموذج ML؛ أسباب اختلاف النموذجين غير موثقة في درجاتهما وحدها.");
    if (stocks.length && text.split(/[\n؛.!؟]/).some(clause => {
        const trimmed = clause.trim();
        if (!trimmed || /^[#*_\s-]+$/.test(trimmed)) return false;
        if (/^[#\s]+/.test(trimmed) || /^(?:هل|ماذا|ما|لماذا|ليه)\s/.test(trimmed) || /[؟?]\s*$/.test(trimmed) || /^[*_]{2}[^*_]+[*_]{2}[:：]?$/.test(trimmed)) return false;
        return /(?:النموذجان|النموذجين|king|egx).{0,100}(?:يعملان|يستخدمان|لان|بسبب|مجموعات سمات|معايره مختلفه|سمات.{0,10}مختلفه)/.test(clause)
            && !/قد |بشكل عام|نظريا|لا نعرف|غير موثق|لا يمكن|لا استطيع/.test(clause);
    })) reasons.add("درجات النموذجين لا تتضمن تفسير السمات أو المعايرة؛ اذكر أن سبب اختلاف الدرجة غير متاح لهذه الحالة.");
    const market = results.find(r => r.tool === "get_market");
    if (market && !market.data?.market_breadth && /الجانب الشرائي.{0,20}اقوى|الجانب البيعي.{0,20}اضعف|اتساع المشاركه|صعود السوق كله/.test(text)
        && !/لا يثبت|لا تكفي|لا يكفي|لا يمكن/.test(text)) reasons.add("قائمة أعلى الرابحين والخاسرين لا تثبت اتساع المشاركة أو تفوق جانب السوق كله؛ يلزم إحصاء اتساع السوق.");
    return Array.from(reasons);
}
