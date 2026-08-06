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
    const above = /(فوق|اعلي|مبالغ|غالي|اغلي)/i.test(value);
    const below = /(تحت|اقل|رخيص|ارخص|اقل من)/i.test(value);
    const requireDistribution = /تصريف|distribution/i.test(value);
    return { fair_value_direction: below ? "below" : "above", require_distribution: requireDistribution, require_accumulation: /تجميع|accumulation/i.test(value) };
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

export type InvestorGuidanceIntent = "onboarding" | "allocation" | "product_comparison" | "product_explainer";

export function getInvestorGuidanceIntent(message: string, hasNamedStock = false): InvestorGuidanceIntent | null {
    const normalized = normalizeArabicIntent(message);
    const mentionsDefensiveProduct = /(صندوق|صناديق|دخل\s+(?:ال)?ثابت|عائد\s+(?:ال)?يومي|عائد\s+(?:ال)?ثابت|شهاده|وديعه|حساب توفير|سوق المال|money market|cash|cloud|ثاندر|ثندر|thndr)/i.test(normalized);
    const asksComparison = /(مقارن|قارن|compare|افضل.*ولا|ولا.*افضل|فرق.*بين|(?:سيب|اسيب|احط|اختار).{0,50}ولا)/i.test(normalized);
    const asksHowItWorks = /(بيشتغل.*ازاي|ازاي.*بيشتغل|يعني ايه|ايه.*فكره|مخاطر.*ايه|امان.*ولا|مضمون.*ولا)/i.test(normalized);
    const asksAllocation = /(محفظ|اوزع|وزع|توزيع|تقسيم|قسم|قسمها|اوزعها|أوزعها|نصف\s*مليون|نص\s*مليون|مليون|معايا\s+مبلغ|عندي\s+مبلغ|معايا\s+سيول|عندي\s+سيول|سيولتي|\d+\s*(?:الف|ألف)|راس المال|كل الفلوس|كل المبلغ|المدخرات|مدخراتي|ميزاني|استثمر|فرص الاستثمار|ادخل.*اسهم|اشتري.*اسهم|اشتري.*ايه|فلوسي.*فين|نهايه\s*السنه|نهاية\s*السنة|اخر\s*السنه|آخر\s*السنة)/i.test(normalized) || egyptianMarketTerms.concentrationRisk.test(normalized) || egyptianMarketTerms.leverageRisk.test(normalized);
    const signalsInexperience = /(معنديش خبر|ما عنديش خبر|بدون خبر|مبتدئ|اول مره|ابني|بناء.*محفظ|ابدا.*استثمر|بدايه.*استثمار|(?:عايز|عاوز|مش فاهم|مش عارف).{0,40}(?:استثمار|الاسهم|اسهم|البورصه))/i.test(normalized);
    if (asksComparison && mentionsDefensiveProduct && (hasNamedStock || /سهم|اسهم|الاسهم/.test(normalized))) return "product_comparison";
    if (mentionsDefensiveProduct && asksHowItWorks && !hasNamedStock) return "product_explainer";
    if (asksAllocation && !hasNamedStock) return "allocation";
    if (signalsInexperience && !hasNamedStock) return "onboarding";
    return null;
}

export function isBestBuyStockQuestion(message: string): boolean {
    const value = normalizeArabicIntent(message);
    return /(?:افضل|أفضل|احسن|أحسن|ترشح|أشتري|اشتري|ايه\s+افضل|إيه\s+أفضل|ايه\s+احسن).{0,30}(?:سهم|أسهم|الأسهم|الاسهم|فرصة|فرصه).{0,30}(?:للشراء|شراء|بكره|بكرة|النهاردة|النهارده|الجلسة|الجلسه|طالعة|طالعه)/i.test(value)
        || /^(?:ايه\s+افضل\s+سهم\s+للشراء|افضل\s+سهم\s+للشراء|أفضل\s+سهم\s+للشراء|اشتري\s+ايه\s+بكره|أشتري\s+إيه\s+بكرة)/i.test(value);
}

export function isFairValueScanRequest(message: string): boolean {
    const normalized = normalizeArabicIntent(message).replace(/[؟?]/g, " ");
    return /(?:الاسهم|اسهم|السهم|سهم).{0,45}(?:فوق|تحت|اعلي|اقل|متداول|بتتداول|يتداول).{0,35}(?:القيمه|قيمه|قيمتها|التقييم).{0,20}(?:العادله|العادل|الفنيه|الفنيه|الوسطيه)/i.test(normalized)
        || /(?:القيمه|قيمه|التقييم).{0,20}(?:العادله|العادل|الفنيه|الوسطيه).{0,45}(?:الاسهم|اسهم|السهم|سهم)/i.test(normalized)
        || /(?:فوق|تحت|اعلي|اقل).{0,10}(?:القيمه|قيمه).{0,10}(?:العادله|العادل|الفنيه|الوسطيه)/i.test(normalized)
        || /(?:الاسهم|اسهم).{0,25}(?:القيمه|قيمه).{0,10}(?:العادله|العادل|الفنيه|الوسطيه)/i.test(normalized)
        || /(?:فوق|تحت|اعلي|اقل).{0,12}(?:القيمه|قيمه).{0,20}(?:تجميع|تصريف)/i.test(normalized);
}

export function describeDatedFallback(requestedDate: string | null | undefined, dataDate: string | null | undefined): string | null {
    if (!requestedDate || !dataDate || requestedDate === dataDate) return null;
    const parsed = new Date(`${requestedDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && (parsed.getUTCDay() === 5 || parsed.getUTCDay() === 6)) {
        return `التاريخ المطلوب ${requestedDate} وافق ${parsed.getUTCDay() === 5 ? "الجمعة" : "السبت"}، وهو عطلة أسبوعية معتادة للبورصة المصرية؛ استخدمت آخر جلسة متاحة بتاريخ ${dataDate}.`;
    }
    return `لا توجد بيانات جلسة مسجلة بتاريخ ${requestedDate}؛ استخدمت آخر جلسة سابقة متاحة بتاريخ ${dataDate}. قد يكون السبب عطلة رسمية أو عدم اكتمال البيانات.`;
}
