export function normalizeArabicIntent(value: string): string {
    return value.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLowerCase();
}

export function isUsageLimitQuestion(message: string): boolean {
    const value = normalizeArabicIntent(message);
    return /(فاضل كام رساله|كم رساله باقي|كوتا الحساب|الحد اليومي للشات|استهلاك الحساب|كم باقي من الرسائل)/i.test(value);
}

export function isDailyPriceLimitQuestion(message: string): boolean {
    return /(حدود|الحد الأقصى|الحد الادنى|نسبة الصعود|نسبة الهبوط|حد التداول|الحد اليومي)/i.test(message) && !isUsageLimitQuestion(message);
}

/**
 * "My Portfolio" (محفظتى) management intent detection.
 * Returns the operation the user wants, or null when the message is not about
 * managing their own portfolio holdings/cash.
 *
 * Careful wording: must NOT hijack generic questions like "أوزع محفظتي"
 * (allocation guidance) — those stay with investor guidance. This detector
 * targets direct holding management: view/add/edit/remove/sell + cash.
 */
export type PortfolioOperation =
    | "view"        // اعرض/إيه اللي معايا
    | "add"         // ضيف/عندي X سهم
    | "update"      // عدل/غيرت العدد
    | "remove"      // شيل
    | "sell"        // بعت
    | "cash_set"    // السيولة اللي معايا كذا / عدل السيولة
    | "cash_add";   // ضيف/زود/حط مبلغ للسيولة (إيداع)

export function detectPortfolioIntent(message: string): PortfolioOperation | null {
    const v = normalizeArabicIntent(message);

    // Any explicit portfolio-management keyword?
    const mentionsPortfolio = /(محفظتي|محفظتى|محفظه|البورتفوليو|portfolio)/i.test(v);
    // "معايا/عندي" + symbol/quantity phrasing also implies their holdings
    const holdsPhrasing = /((معايا|عندي|موجود عندي|معي)\s+(?:\d+|[A-Z]{2,10}\b))/i.test(v)
        || /((بصاصتي|حوزتي|ممتلكاتي))/i.test(v);
    // Money / cash wording (السيولة/فلوس/كاش/إيداع) also triggers portfolio ops.
    const mentionsCash = /(سيول|فلوس|كاش|cash|وديعه|وديعة)/i.test(v)
        && /(?:ضيف|اضيف|هضيف|زود|زد|حط|حطي?ت|اودع|ودع|ادخل\s+سيول|اضفت|زودت|السيول(?:ة|ه)?\s*(?:اللي|بتاعتي|بتاعى|عندي|معايا|دلوقتي|حالي)|سيولتي|عدل\s+السيول|غير\s+السيول|الكاش\s+(?:عندي|بتاعي))/i.test(v);
    // Direct management verbs over stocks/symbols (بعت/شيل/عدل + سهم/رمز) are
    // portfolio operations even without the word "محفظة".
    // Arabic word boundaries via lookaround: \b does not work with Arabic
    // letters, so verbs embedded inside other words (ابعتلى، يصحح) are ignored.
    const hasManagementVerb = /(?<![\u0621-\u064A])(?:بعت|شيل|احذف|امسح|عدلت|غيرت|عدل|صحح|ظبط|زود|زد|حط|ضيف|اضيف)(?![\u0621-\u064A])/i.test(v);
    const mentionsStocks = /(سهم|سهمين|اسهم|حصه|حصص)/i.test(v) || /\b[A-Z]{2,10}\b/.test(message);

    if (!mentionsPortfolio && !holdsPhrasing && !mentionsCash && !(hasManagementVerb && mentionsStocks)) return null;

    // Sell: بعت / بعت منها / خالص بيع
    if (/(بعت|بيع\s+\d+\s*سهم|بعت\s+كل|خلاص\s+بعت|سجّل\s+بيع|سجل\s+بيع)/i.test(v)) return "sell";
    // Remove: شيل / احذف
    if (/(شيل|احذف|حذف|امسح|مسح)/i.test(v) && !/(سيول|فلوس|كاش)/i.test(v)) return "remove";
    // Cash operations — must run before stock "add": "ضيف/زود 50 ألف سيولة"
    if (/(سيول|فلوس|كاش|وديعه|وديعة)/i.test(v)) {
        const hasAmount = /(\d[\d,.]*\s*(الف|ألف|الاف|آلاف|مليون|k|جنيه|ج\.م|egp)?|\d+)/i.test(v);
        const addVerb = /(ضيف|اضيف|هضيف|زود|زد|حط|حطي?ت|اودع|ودع|ادخل|اضفت|زودت|حطيت)/i.test(v);
        const setVerb = /(السيول|سيولتي|عندي\s+سيول|معايا\s+سيول|الكاش\s+عندي|عدل\s+السيول|غير\s+السيول)/i.test(v);
        if (addVerb && hasAmount) return "cash_add";
        if (hasAmount && setVerb) return "cash_set";
        if (addVerb || /سيب\s*(?:ها)?(?:فى|في)/i.test(v)) return "cash_add";
    }
    // Portfolio analysis / stats asks (تحليل محفظتي / اكبر مركز / نسبة السيولة) → view
    if (/(?:محفظت|البورتفوليو|portfolio)/i.test(v) && /(?:حلّل|حلل|تحليل|اكبر مركز|أكبر مركز|نسبة السيوله|نسبة السيولة|توزيع|إحصائيات|احصائيات|تقرير)/i.test(v) && !/(سيول|فلوس)\s*(?:ضيف|اضيف|زود|حط)/i.test(v)) return "view";
    // Add stock: ضيف / عندي 200 سهم
    if (/(ضيف|اضاف|هضيف|اضيف|اشتري?ت|عندي\s+\d+\s*(?:سهم|سهمين|حصه|حصص)|معايا\s+\d+\s*(?:سهم|سهمين|حصه|حصص))/i.test(v)) return "add";
    // Update: عدل / غيرت
    if (/(عدل|عدلت|غيرت|صحح|صححت|ظبط|ظبطت)/i.test(v)) return "update";
    // View: اعرض / إيه اللي معايا / وضع محفظتي
    if (/(اعرض|وريني|ايه اللي معايا|ايه اللي معي|وضع|مكون من|شو?ف)/i.test(v)) return "view";

    // Portfolio mentioned with a symbol + count but no explicit verb → add
    const qtySymbol = /(\d+)\s*(?:سهم|سهمين|حصه|حصص)\s*(?:من|في|بتاع)?\s*([A-Z]{2,10})/i.test(v)
        || /([A-Z]{2,10})\s*(?:معايا|عندي)\s*(\d+)/i.test(v)
        || /(عندي|معايا)\s+([A-Z]{2,10})\s+(\d+)\s*(?:سهم)?/i.test(v);
    if (qtySymbol) return "add";

    // Bare "محفظتي" mention with no other verb → view
    if (/(محفظتي|محفظتى|portfolio)/i.test(v) && !/(اوزع|وزع|توزيع|ابني|بناء)/i.test(v)) return "view";

    return null;
}

/**
 * True when the user asks for a full per-holding analysis of their portfolio
 * ("حلل محفظتي") rather than just listing it. Analysis requests must run the
 * same stock-analysis tools the user gets for typing a ticker manually, once
 * per held symbol, so they do not have to retype every position daily.
 */
export function isPortfolioAnalysisRequest(message: string): boolean {
    if (!detectPortfolioIntent(message)) return false;
    const v = normalizeArabicIntent(message);
    return /(?:حلل|حلّل|تحليل|راجع|مراجعه|مراجعة|قيّم|تقييم)/i.test(v);
}

/**
 * Confirmation of a pending portfolio-image import.
 * Matches short affirmative/negative replies to the bot's "هل دي محفظتك؟"
 * question — e.g. "أيوه", "نعم دي محفظتي", "لأ مش بتاعتي".
 * Returns true (confirm), false (reject), or null (not a confirmation).
 */
export function detectPortfolioConfirmation(message: string): boolean | null {
    const v = normalizeArabicIntent(message);
    const gate = /(محفظ|بتاعتي|ايوه|نعم|اكيد|yes|yep|لأ|لا مش|no|^\s*(?:لا|لأ)\s*$)/i.test(v);
    if (!gate) return null;
    // NOTE: \b word boundaries don't work with Arabic letters (they are not
    // \w), so we use a negative lookahead for Arabic letters instead.
    if (/^(?:لا|لأ|لا مش|لأ مش|no)(?![\u0621-\u064A])/i.test(v.trim())) return false;
    if (/(مش بتاعتي|مش محفظتي|دي مش محفظتي|لأ دي مش|لا دي مش)/i.test(v)) return false;
    if (/^(?:ايوه|نعم|اكيد|تمام|yes|yep|ا)(?![\u0621-\u064A])/i.test(v.trim()) || /(بتاعتي|محفظتي دي|دي محفظتي|ايوه دي|نعم دي)/i.test(v)) return true;
    return null;
}

export function isEarningsDataRequest(message: string): boolean {
    const norm = normalizeArabicIntent(message);
    if (/(ارباحي|ارباحى|احمي|حمايه|جني|جني\s*ارباح|توزيع\s*سيول|محفظت|سيولتي|تذبذب)/i.test(norm)) return false;
    return /(نتائج\s*اعمال|قوائم\s*ماليه|صافي\s*ربح|صافي\s*ارباح|ارباح\s*(?:الشرك|السهم|سهم|[A-Z]{2,6}|الربع|الشهر|السنه|السنة|العام|كام|قد\s*ايه|كم)|ايرادات\s*الشرك|ميزانيه\s*الشرك)/i.test(norm);
}

export function getFairValueFilters(message: string): { fair_value_direction: "above" | "below"; require_distribution: boolean; require_accumulation: boolean } {
    const value = normalizeArabicIntent(message);
    // Proximity-based check: تحت must appear near القيمة to count as "below"
    const belowNearValue = /(تحت|تحدت|اقل|رخيص|ارخص).{0,40}(القيمه|قيمه|قيمتها|التقييم)/i.test(value)
        || /(القيمه|قيمه|قيمتها).{0,40}(تحت|تحدت|اقل|رخيص|ارخص)/i.test(value);
    const below = belowNearValue || /(تحت|تحدت|اقل\s+من|ارخص).{0,10}(القيمه|قيمه)/i.test(value);
    const above = !below && /(فوق|اعلي|مبالغ|غالي|اغلي)/i.test(value);
    const requireDistribution = /تصريف|distribution/i.test(value) && !/(?:^|[\s،,.;:])(?:لا|بدون|مفيش|صفر|0|zero)(?:[\s،,.;:]|$).{0,15}(?:يوجد)?.{0,15}(?:تصريف|distribution)/i.test(value) && !/(?:تصريف|distribution)\s*(?:=|يساوي)\s*0/.test(value);
    const requireAccumulation = /تجميع|accumulation/i.test(value) && !/(?:^|[\s،,.;:])(?:لا|بدون|مفيش|صفر|0|zero)(?:[\s،,.;:]|$).{0,15}(?:يوجد)?.{0,15}(?:تجميع|accumulation)/i.test(value) && !/(?:تجميع|accumulation)\s*(?:=|يساوي)\s*0/.test(value);
    return { fair_value_direction: below ? "below" : "above", require_distribution: requireDistribution, require_accumulation: requireAccumulation };
}

export const egyptianMarketTerms = {
    accumulation: /تجميع|بياع خف|شراء مؤسسي|سيوله داخله/i,
    distribution: /تصريف|بياع مسيطر|ضغط بيعي|سيوله خارجه/i,
    breakout: /كسر|اختراق|كاسر المقاومه/i,
    momentum: /زخم|طالع بقوه|ماشي كويس|هيطير/i,
    correction: /تصحيح|واخد ريحته|استراحه/i,
    concentrationRisk: /كل فلوسي|المدخرات كلها|كل المبلغ|سهم واحد|هحطها كلها/i,
    leverageRisk: /اقتراض|استلف|هامش|مارجن/i,
    guaranteeRequest: /مضمون|اكيد|ضمان/i,
};

export type InvestorGuidanceIntent = "onboarding" | "allocation" | "product_comparison" | "product_explainer" | "terms_explainer";

export function isTermsDefinitionRequest(message: string): boolean {
    const norm = normalizeArabicIntent(message);
    if (/(الأسهم|الاسهم|اسهم|سهم|شركات|سهمين)/i.test(norm)) return false;
    const isShortFollowupTerm = /^(?:و\s*)?(?:الـ?\s*)?(?:rsi|macd|vwap|جمعية|جمعيه|مارجن|مقاومة|مقاومه|دعم|وقف\s+خسارة|وقف\s+خساره)[؟?\s]*$/i.test(norm.trim());
    if (isShortFollowupTerm) return true;
    const hasDefineVerb = /(عرف|تعريف|يعني\s+ايه|يعني\s+إيه|الفرق\s+بين|ايه\s+الفرق|إيه\s+الفرق|شرح|ما\s+هو|ما\s+هي|ما\s+المقصود|قصده\s+ايه|معنى|معني|ازاي|إزاي|كيف|طريقة|طريقه)/i.test(norm);
    if (!hasDefineVerb) return false;
    return /(تجميع|تصريف|سيوله|سيولة|دخلت\s+سيوله|دخلت\s+سيولة|دخل\s+فيه\s+سيوله|دخل\s+فيه\s+سيولة|جمعيه|جمعية|عموميه|عمومية|macd|rsi|مقاومه|مقاومة|دعم|مؤشر|مؤشرات|وقف\s+خساره|وقف\s+خسارة|ارباح|أرباح|مارجن|مضاربه|مضاربة)/i.test(norm);
}

export function getInvestorGuidanceIntent(message: string, hasNamedStock = false): InvestorGuidanceIntent | null {
    if (isBestBuyStockQuestion(message) && !/(?:مش\s*فاهم|مش\s*عارف|ابدأ|اول\s+يوم|مدخراتي|مدخرات|صندوق\s+دخل\s+ثابت|نصف\s*مليون|نص\s*مليون)/i.test(normalizeArabicIntent(message))) return null;
    const normalized = normalizeArabicIntent(message);
    if (isTermsDefinitionRequest(message)) return "terms_explainer";
    const mentionsDefensiveProduct = /(صندوق|صناديق|دخل\s+(?:ال)?ثابت|عائد\s+(?:ال)?يومي|عائد\s+(?:ال)?ثابت|شهاده|وديعه|حساب توفير|سوق المال|money market|cash|cloud|ثاندر|ثندر|thndr)/i.test(normalized);
    const asksComparison = /(مقارن|قارن|compare|افضل.*ولا|ولا.*افضل|فرق.*بين|(?:سيب|اسيب|احط|اختار).{0,50}ولا)/i.test(normalized);
    const asksHowItWorks = /(بيشتغل.*ازاي|ازاي.*بيشتغل|يعني ايه|ايه.*فكره|مخاطر.*ايه|امان.*ولا|مضمون.*ولا)/i.test(normalized);
    const asksAllocation = /(محفظ|اوزع|وزع|توزيع|تقسيم|قسم|قسمها|اوزعها|أوزعها|نصف\s*مليون|نص\s*مليون|مليون|معايا\s+مبلغ|عندي\s+مبلغ|معايا\s+سيول|عندي\s+سيول|سيولتي|\d+\s*(?:الف|ألف)|راس المال|كل الفلوس|كل المبلغ|المدخرات|مدخراتي|ميزاني|فلوسي.*فين|نهايه\s*السنه|نهاية\s*السنة|اخر\s*السنه|آخر\s*السنة)/i.test(normalized) || egyptianMarketTerms.concentrationRisk.test(normalized) || egyptianMarketTerms.leverageRisk.test(normalized);
    const signalsInexperience = /(معنديش خبر|ما عنديش خبر|بدون خبر|مبتدئ|اول مره|ابني|بناء.*محفظ|ابدا.*استثمر|بدايه.*استثمار|(?:عايز|عاوز|مش فاهم|مش عارف).{0,40}(?:استثمار|الاسهم|اسهم|البورصه))/i.test(normalized);
    const isSingleStockAdviceRequest = (hasNamedStock && /(اشتريت|نزل بي|نزل بيا|خسران|نازل بيا)/i.test(normalized)) || /(اشتريت.*في.*سهم.*و(?:نزل|خسر))/i.test(normalized);
    if (isSingleStockAdviceRequest) return null;

    if (asksComparison && mentionsDefensiveProduct && /سهم|اسهم|الاسهم/.test(normalized)) return "product_comparison";
    if (mentionsDefensiveProduct && asksHowItWorks && !hasNamedStock) return "product_explainer";
    if (asksAllocation && !hasNamedStock) return "allocation";
    if (signalsInexperience && !hasNamedStock) return "onboarding";
    return null;
}

export function isBestBuyStockQuestion(message: string): boolean {
    const value = normalizeArabicIntent(message);
    const mentionsDefensiveProduct = /(صندوق|صناديق|دخل\s+(?:ال)?ثابت|عائد|شهاده|وديعه|حساب توفير|سوق المال)/i.test(value);
    if (mentionsDefensiveProduct) return false;
    const isOwnedStockAdviceQuery = /(اشتريت|نزل بي|نزل بيا|خسران|نازل بيا|عمل ايه|اعمل ايه).{0,30}(سهم|لوتس|[a-z0-9]+)/i.test(value) || /(اشتريت.*في.*سهم)/i.test(value);
    if (isOwnedStockAdviceQuery) return false;
    // Follow-up asking if a specific/previous stock has a recommendation on the platform
    const isSingleStockRecCheck = /(?:هو\s+)?(?:ليه|له|عليه|عنده|فيها|ليها)\s+توصي/i.test(value);
    if (isSingleStockRecCheck) return false;
    return /(?:افضل|أفضل|احسن|أحسن|ترشح|رشح|رشحلى|رشحلي|أشتري|اشتري|اشتريه|أشتريه|ادخل|أدخل|ادخله|أدخله|ايه\s+افضل|إيه\s+أفضل|ايه\s+احسن|مين\s+ادخل|مين\s+أدخل|مين\s+اشتري|مين\s+أشتري|شغل|واعده|واعدة|كسبانه|كسبانة).{0,35}(?:سهم|أسهم|الأسهم|الاسهم|فرصة|فرصه|فيه|فيها|بكره|بكرة|النهاردة|النهارده|الجلسة|الجلسه|طالعة|طالعه|الاسبوع|الأسبوع|اسبوع|فرص|ارباح|أرباح|السنة|السنه|نهاية|نهايه|نهايا)/i.test(value)
        || /(?:توصيات|توصية|توصيه|ترشيحات|فرص شراء|فرص دخول|اسهم ادخل فيها|اسهم اشتريها|اشتري ايه|ادخل في ايه|ادخل فيها|اسهم ممتازة|اسهم كويسة|تحقق ارباح|تحقق أرباح|توصيات كويسة|توصيات شراء|اسهم للشراء|فرص الشراء|شغل عالي|شغل عالى|حركة قوية|تتحرك قوية|أفضل أسهم|افضل اسهم|احسن اسهم|أحسن أسهم|اسهم واعدة|أسهم واعدة|اسهم كسبانة|أسهم كسبانة)/i.test(value)
        || /(?:مين\s+(?:ادخله|أدخله|ادخل\s+فيه|أدخل\s+فيه|اشتريه|أشتريه)|ادخل\s+في\s+(?:مين|ايه|إيه)|اشتري\s+في\s+(?:مين|ايه|إيه))/i.test(value)
        || /^(?:ايه\s+افضل\s+سهم\s+للشراء|افضل\s+سهم\s+للشراء|أفضل\s+سهم\s+للشراء|اشتري\s+ايه\s+بكره|أشتري\s+إيه\s+بكرة|مين\s+ادخله\s+بكره|مين\s+أدخله\s+بكرة|نجم\s+الاسبوع|نجم\s+الأسبوع|القطاع\s+اللي\s+هيطلع|القطاع\s+اللي\s+يرتفع|السهم\s+اللي\s+هيرتفع|افضل\s+الفرص\s+المتاحة\s+حالياً|أفضل\s+الفرص\s+المتاحة\s+حالياً|رشحلى|رشحلي|رشح)/i.test(value);
}

export function isFairValueScanRequest(message: string): boolean {
    if (isTermsDefinitionRequest(message)) return false;
    const normalized = normalizeArabicIntent(message).replace(/[؟?]/g, " ");
    return /(?:الاسهم|اسهم|السهم|سهم).{0,45}(?:فوق|تحت|تحدت|تحدث|تكون|اقل|اعلي|أعلى).{0,45}(?:القيمه|قيمه|قيمتها|القيمة|التقييم).{0,20}(?:العادله|العادل|الفنيه|الوسطيه)/i.test(normalized)
        || /(?:القيمه|قيمه|التقييم).{0,20}(?:العادله|العادل|الفنيه|الوسطيه).{0,45}(?:الاسهم|اسهم|السهم|سهم)/i.test(normalized)
        || /(?:فوق|تحت|تحدت|تحدث|اعلي|اقل).{0,10}(?:القيمه|قيمه).{0,10}(?:العادله|العادل|الفنيه|الوسطيه)/i.test(normalized)
        || /(?:فوق|تحت|تحدت|تحدث|اعلي|اقل).{0,12}(?:القيمه|قيمه).{0,20}(?:تجميع|تصريف)/i.test(normalized)
        || /(?:تجميع|تصريف).{0,35}(?:القيمه|قيمه|التقييم|تقييم)/i.test(normalized)
        || /(?:تجميع|تصريف).{0,50}(?:تحت|اقل|ارخص|رخيص|فوق|اعلي|أعلى).{0,35}(?:القيمه|قيمه|القيمة|التقييم|تقييم|السعر|السعره|قيمته)/i.test(normalized)
        || /(?:تحت|اقل|ارخص|فوق|اعلي|أعلى).{0,35}(?:القيمه|قيمه|القيمة|التقييم|تقييم|السعر|قيمته).{0,50}(?:تجميع|تصريف)/i.test(normalized)
        || /(?:تصريف|تجميع).{0,60}(?:بتتداول|تتداول|يتداول).{0,30}(?:فوق|تحت|اعلي|أعلى|اقل).{0,30}(?:السعر|القيمه|القيمة|التقييم).{0,20}(?:العادل|العادله|الفنيه|الوسطيه)/i.test(normalized);
}

export function describeDatedFallback(requestedDate: string | null | undefined, dataDate: string | null | undefined): string | null {
    if (!requestedDate || !dataDate || requestedDate === dataDate) return null;
    const parsed = new Date(`${requestedDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && (parsed.getUTCDay() === 5 || parsed.getUTCDay() === 6)) {
        return `التاريخ المطلوب ${requestedDate} وافق ${parsed.getUTCDay() === 5 ? "الجمعة" : "السبت"}، وهو عطلة أسبوعية معتادة للبورصة المصرية؛ استخدمت آخر جلسة متاحة بتاريخ ${dataDate}.`;
    }
    return `لا توجد بيانات جلسة مسجلة بتاريخ ${requestedDate}؛ استخدمت آخر جلسة سابقة متاحة بتاريخ ${dataDate}. قد يكون السبب عطلة رسمية أو عدم اكتمال البيانات.`;
}

export interface ExtractedInvestorPreferences {
    budget: number | null;
    horizon: "short_term" | "medium_term" | "long_term" | null;
    risk_tolerance: "low" | "medium" | "high" | null;
    sector: string | null;
}

export function extractInvestorPreferences(message: string): ExtractedInvestorPreferences {
    const value = normalizeArabicIntent(message);
    let budget: number | null = null;
    let horizon: "short_term" | "medium_term" | "long_term" | null = null;
    let risk_tolerance: "low" | "medium" | "high" | null = null;
    let sector: string | null = null;

    // Budget extraction
    if (/(?:نصف|نص)\s*مليون/i.test(value)) {
        budget = 500000;
    } else if (/(?:مليون)/i.test(value)) {
        budget = 1000000;
    } else {
        const numMatch = value.match(/(?:معايا|ميزانيتي|مبلغي|سيولة|سيولتي|عندي|بامكانية)\s*(\d+[\d,._]*)\s*(الف|ألف|الاف|آلاف|k|kilo|مليون|ملايين|جنيه)?/i)
            || value.match(/(\d+[\d,._]*)\s*(الف|ألف|الاف|آلاف|k|kilo|مليون|ملايين|جنيه)/i);
        if (numMatch) {
            let rawNum = parseFloat(numMatch[1].replace(/[,_]/g, ""));
            if (!isNaN(rawNum)) {
                const unit = (numMatch[2] || "").toLowerCase();
                if (/(الف|ألف|الاف|آلاف|k|kilo)/i.test(unit)) {
                    rawNum *= 1000;
                } else if (/(مليون|ملايين)/i.test(unit)) {
                    rawNum *= 1000000;
                }
                if (rawNum > 0) {
                    budget = rawNum;
                }
            }
        }
    }

    // Horizon extraction
    if (/(مضاربة|مضاربه|سريعة|سريعه|عدة أيام|عده ايام|اسبوع|أسبوع|يومي|قصير)/i.test(value)) {
        horizon = "short_term";
    } else if (/(استثمار متوسط|عدة شهور|عده شهور|سنة|سنه|لنهاية السنة|لنهاية السنه|اخر السنة|اخر السنه|متوسط الأجل|متوسط الاجل)/i.test(value)) {
        horizon = "medium_term";
    } else if (/(طويل|سنتين|سنوات|طويل الأجل|طويل الاجل|استثمار هادئ|استثمار طويل)/i.test(value)) {
        horizon = "long_term";
    }

    // Risk tolerance extraction
    if (/(بدون مخاطرة|بدون مخاطره|قليلة|منخفضة|منخفضه|محافظ|أمان|امان|متحفظ|بعيد عن الريسك)/i.test(value)) {
        risk_tolerance = "low";
    } else if (/(متوازنة|متوازنه|متوازن|معتدل|مخاطرة متوسطة|مخاطره متوسطه)/i.test(value)) {
        risk_tolerance = "medium";
    } else if (/(عالية|عاليه|مرتفعة|مرتفعه|مغامرة|مغامره|مجازف|مضارب جريء|مخاطرة عالية)/i.test(value)) {
        risk_tolerance = "high";
    }

    // Sector extraction
    const sectorMatch = value.match(/(?:قطاع|في|مجال)\s+(البنوك|العقارات|الاغذية|الأغذية|البتروكيماويات|الاتصالات|التكنولوجيا|الحديد|الادوية|الأدوية|الاسكان|الإسكان)/i);
    if (sectorMatch) {
        sector = sectorMatch[1];
    } else if (/(بنوك|عقارات|اغذية|أغذية|بتروكيماويات|اتصالات|تكنولوجيا|حديد|ادوية|أدوية)/i.test(value)) {
        const m = value.match(/(بنوك|عقارات|اغذية|أغذية|بتروكيماويات|اتصالات|تكنولوجيا|حديد|ادوية|أدوية)/i);
        if (m) sector = m[1];
    }

    return { budget, horizon, risk_tolerance, sector };
}

export function fuzzyArabicIntentMatch(message: string, targets: string[]): boolean {
    const normMsg = normalizeArabicIntent(message);
    return targets.some(target => {
        const normTarget = normalizeArabicIntent(target);
        return normMsg.includes(normTarget);
    });
}
