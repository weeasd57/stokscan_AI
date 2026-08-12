export function normalizeArabicIntent(value: string): string {
    return value.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
}

export function isUsageLimitQuestion(message: string): boolean {
    const value = normalizeArabicIntent(message);
    return /(فاضل كام رساله|كم رساله باقي|كوتا الحساب|الحد اليومي للشات|استهلاك الحساب|كم باقي من الرسائل)/i.test(value);
}

export function isDailyPriceLimitQuestion(message: string): boolean {
    return /(حدود|الحد الأقصى|الحد الادنى|نسبة الصعود|نسبة الهبوط|حد التداول|الحد اليومي)/i.test(message) && !isUsageLimitQuestion(message);
}

export function isEarningsDataRequest(message: string): boolean {
    return /(أرباح|ارباح|نتائج أعمال|قوائم مالية|إيرادات|ارباح الشركة)/i.test(message);
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
    const isShortFollowupTerm = /^(?:و\s*)?(?:الـ?\s*)?(?:rsi|macd|vwap|جمعية|جمعيه|مارجن|مقاومة|مقاومه|دعم|وقف\s+خسارة|وقف\s+خساره)[؟?\s]*$/i.test(norm.trim());
    if (isShortFollowupTerm) return true;
    const hasDefineVerb = /(عرف|تعريف|يعني\s+ايه|يعني\s+إيه|شرح|ما\s+هو|ما\s+هي|ما\s+المقصود|قصده\s+ايه|معنى|معني|ازاي|إزاي|كيف|طريقة|طريقه)/i.test(norm);
    if (!hasDefineVerb) return false;
    return /(تجميع|تصريف|سيوله|سيولة|دخلت\s+سيوله|دخلت\s+سيولة|دخل\s+فيه\s+سيوله|دخل\s+فيه\s+سيولة|جمعيه|جمعية|عموميه|عمومية|macd|rsi|مقاومه|مقاومة|دعم|مؤشر|مؤشرات|وقف\s+خساره|وقف\s+خسارة|ارباح|أرباح|مارجن|مضاربه|مضاربة)/i.test(norm);
}

export function getInvestorGuidanceIntent(message: string, hasNamedStock = false): InvestorGuidanceIntent | null {
    const normalized = normalizeArabicIntent(message);
    if (isTermsDefinitionRequest(message)) return "terms_explainer";
    const mentionsDefensiveProduct = /(صندوق|صناديق|دخل\s+(?:ال)?ثابت|عائد\s+(?:ال)?يومي|عائد\s+(?:ال)?ثابت|شهاده|وديعه|حساب توفير|سوق المال|money market|cash|cloud|ثاندر|ثندر|thndr)/i.test(normalized);
    const asksComparison = /(مقارن|قارن|compare|افضل.*ولا|ولا.*افضل|فرق.*بين|(?:سيب|اسيب|احط|اختار).{0,50}ولا)/i.test(normalized);
    const asksHowItWorks = /(بيشتغل.*ازاي|ازاي.*بيشتغل|يعني ايه|ايه.*فكره|مخاطر.*ايه|امان.*ولا|مضمون.*ولا)/i.test(normalized);
    const asksAllocation = /(محفظ|اوزع|وزع|توزيع|تقسيم|قسم|قسمها|اوزعها|أوزعها|نصف\s*مليون|نص\s*مليون|مليون|معايا\s+مبلغ|عندي\s+مبلغ|معايا\s+سيول|عندي\s+سيول|سيولتي|\d+\s*(?:الف|ألف)|راس المال|كل الفلوس|كل المبلغ|المدخرات|مدخراتي|ميزاني|استثمر|فرص الاستثمار|ادخل.*اسهم|اشتري.*اسهم|اشتري.*ايه|فلوسي.*فين|نهايه\s*السنه|نهاية\s*السنة|اخر\s*السنه|آخر\s*السنة)/i.test(normalized) || egyptianMarketTerms.concentrationRisk.test(normalized) || egyptianMarketTerms.leverageRisk.test(normalized);
    const signalsInexperience = /(معنديش خبر|ما عنديش خبر|بدون خبر|مبتدئ|اول مره|ابني|بناء.*محفظ|ابدا.*استثمر|بدايه.*استثمار|(?:عايز|عاوز|مش فاهم|مش عارف).{0,40}(?:استثمار|الاسهم|اسهم|البورصه))/i.test(normalized);
    const isSingleStockAdviceRequest = (hasNamedStock && /(اشتريت|نزل بي|نزل بيا|خسران|نازل بيا)/i.test(normalized)) || /(اشتريت.*في.*سهم.*و(?:نزل|خسر))/i.test(normalized);
    if (isSingleStockAdviceRequest) return null;

    if (asksComparison && mentionsDefensiveProduct && (hasNamedStock || /سهم|اسهم|الاسهم/.test(normalized))) return "product_comparison";
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
    return /(?:افضل|أفضل|احسن|أحسن|ترشح|رشح|رشحلى|رشحلي|أشتري|اشتري|اشتريه|أشتريه|ادخل|أدخل|ادخله|أدخله|ايه\s+افضل|إيه\s+أفضل|ايه\s+احسن|مين\s+ادخل|مين\s+أدخل|مين\s+اشتري|مين\s+أشتري).{0,35}(?:سهم|أسهم|الأسهم|الاسهم|فرصة|فرصه|فيه|فيها|بكره|بكرة|النهاردة|النهارده|الجلسة|الجلسه|طالعة|طالعه|الاسبوع|الأسبوع|اسبوع|فرص)/i.test(value)
        || /(?:مين\s+(?:ادخله|أدخله|ادخل\s+فيه|أدخل\s+فيه|اشتريه|أشتريه)|ادخل\s+في\s+(?:مين|ايه|إيه)|اشتري\s+في\s+(?:مين|ايه|إيه))/i.test(value)
        || /^(?:ايه\s+افضل\s+سهم\s+للشراء|افضل\s+سهم\s+للشراء|أفضل\s+سهم\s+للشراء|اشتري\s+ايه\s+بكره|أشتري\s+إيه\s+بكرة|مين\s+ادخله\s+بكره|مين\s+أدخله\s+بكرة|نجم\s+الاسبوع|نجم\s+الأسبوع|القطاع\s+اللي\s+هيطلع|القطاع\s+اللي\s+يرتفع|السهم\s+اللي\s+هيرتفع|افضل\s+الفرص\s+المتاحة\s+حالياً|أفضل\s+الفرص\s+المتاحة\s+حالياً|رشحلى|رشحلي|رشح)/i.test(value);
}

export function isFairValueScanRequest(message: string): boolean {
    if (isTermsDefinitionRequest(message)) return false;
    const normalized = normalizeArabicIntent(message).replace(/[؟?]/g, " ");
    return /(?:الاسهم|اسهم|السهم|سهم).{0,45}(?:فوق|تحت|تحدت|تحدث|تكون|اقل|اعلي).{0,45}(?:القيمه|قيمه|قيمتها|التقييم).{0,20}(?:العادله|العادل|الفنيه|الوسطيه)/i.test(normalized)
        || /(?:القيمه|قيمه|التقييم).{0,20}(?:العادله|العادل|الفنيه|الوسطيه).{0,45}(?:الاسهم|اسهم|السهم|سهم)/i.test(normalized)
        || /(?:فوق|تحت|تحدت|تحدث|اعلي|اقل).{0,10}(?:القيمه|قيمه).{0,10}(?:العادله|العادل|الفنيه|الوسطيه)/i.test(normalized)
        || /(?:فوق|تحت|تحدت|تحدث|اعلي|اقل).{0,12}(?:القيمه|قيمه).{0,20}(?:تجميع|تصريف)/i.test(normalized)
        || /(?:تجميع|تصريف).{0,35}(?:القيمه|قيمه|التقييم|تقييم)/i.test(normalized)
        || /(?:تجميع|تصريف).{0,35}(?:تحت|اقل|ارخص|رخيص|فوق|اعلي).{0,35}(?:القيمه|قيمه|التقييم|تقييم|السعر|السعره|قيمته)/i.test(normalized)
        || /(?:تحت|اقل|ارخص|فوق|اعلي).{0,35}(?:القيمه|قيمه|التقييم|تقييم|السعر|قيمته).{0,35}(?:تجميع|تصريف)/i.test(normalized);
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
