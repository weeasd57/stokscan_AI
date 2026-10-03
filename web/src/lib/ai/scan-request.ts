import type { IntentPlan } from "./types";

export function explicitBollingerPreset(message: string): IntentPlan["entities"]["technical_preset"] {
    const value = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
    if (!/bollinger|بولينجر|بولنجر|بولينغر/.test(value)) return null;
    if (/(?:ما\s*هو|ماذا\s*يعني|شرح|يعني\s*ايه|طريقه|كيف|ازاي|مفهوم|معنى|معني|definition|explain|what\s+is)/.test(value)) return null;
    // A band name alone has no side or market discovery intent. Never turn
    // single-stock analysis, two-sided requests, or a different band condition
    // into a lower-touch scan.
    if (!/اسهم|الاسهم|قائمه|قايمه|scan|screener|stocks|which|فلتر|هات|طلع/.test(value)) return null;
    if (/حلل|تحليل|analy[sz]e|analysis|\b[A-Z]{2,6}\b/.test(message)) return null;
    if (bollingerScanUnsupportedReason(message)) return null;
    const upper = /قمه|علوي|اعلي|upper|top/.test(value);
    const lower = /قاع|سفلي|اسفل|lower|bottom/.test(value);
    if (upper === lower) return null;
    return upper ? "bollinger_upper_touch" : "bollinger_lower_touch";
}

export function bollingerScanUnsupportedReason(message: string): string | null {
    const value = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
    if (!/bollinger|بولينجر|بولنجر|بولينغر/.test(value)) return null;
    const upper = /قمه|علوي|اعلي|upper|top/.test(value);
    const lower = /قاع|سفلي|اسفل|lower|bottom/.test(value);
    if (upper && lower || /both|الحدين|الطرفين/.test(value)) return "bollinger_both_sides_unsupported";
    if (/اختراق|اخترق|كسر|اغلاق|اقفل|يقفل|اغلق|فوق|تحت|cross|break|close|squeeze|ضغط|ضيق|اتساع|width|%b/.test(value)) return "bollinger_condition_unsupported";
    if (!upper && !lower) return "bollinger_side_unspecified";
    return null;
}

export type NumericScanCriterion = { operator: "<" | "<=" | ">" | ">="; threshold: number };

export function requestedRsiCriterion(message: string): NumericScanCriterion | null {
    const value = message.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const match = value.match(/rsi\s*(?:14\s*)?(<=|>=|<|>|اقل\s*(?:من\s*)?(?:او\s*يساوي)?|اكثر\s*(?:من\s*)?(?:او\s*يساوي)?|اعلي\s*(?:من\s*)?|فوق|تحت|دون)\s*(\d+(?:\.\d+)?)/i);
    if (!match) return null;
    const token = match[1];
    const operator = token === "<=" || token === ">=" || token === "<" || token === ">" ? token
        : /اقل|تحت|دون/.test(token) ? (/يساوي/.test(token) ? "<=" : "<") : (/يساوي/.test(token) ? ">=" : ">");
    return { operator, threshold: Number(match[2]) };
}

export function satisfiesNumericCriterion(value: unknown, criterion: NumericScanCriterion): boolean {
    if (value == null || !Number.isFinite(Number(value))) return false;
    const number = Number(value);
    return criterion.operator === "<" ? number < criterion.threshold : criterion.operator === "<=" ? number <= criterion.threshold
        : criterion.operator === ">" ? number > criterion.threshold : number >= criterion.threshold;
}

export function requestedAllScanRows(message: string): boolean {
    return /(?:^|\s)(?:كل|جميع|كافه|كافة|all)(?:\s|$)/i.test(message);
}

export function scanSessionRows(rows: any[], requestedDate?: string | null) {
    const dated = rows.filter(row => /^\d{4}-\d{2}-\d{2}/.test(String(row.date)));
    const date = requestedDate || dated.map(row => String(row.date).slice(0, 10)).sort().at(-1) || null;
    const selected = dated.filter(row => String(row.date).slice(0, 10) === date);
    return { date, rows: selected, excluded_count: rows.length - selected.length };
}

export function consistentDailyRange(rows: any[]) {
    if (!rows.length) return undefined;
    const first = rows[0];
    return rows.every(row => row.low != null && row.high != null && Number(row.low) === Number(first.low) && Number(row.high) === Number(first.high)) ? first : undefined;
}

export function bollingerTouchEvidence(indicator: any, quote: any, side: "lower" | "upper") {
    const band = Number(indicator?.[side === "lower" ? "bb_lower" : "bb_upper"]);
    const low = Number(quote?.low), high = Number(quote?.high);
    const valid = indicator?.[side === "lower" ? "bb_lower" : "bb_upper"] != null && quote?.low != null && quote?.high != null
        && band > 0 && low > 0 && high >= low && [band, low, high].every(Number.isFinite)
        && String(indicator?.symbol).toUpperCase() === String(quote?.symbol).toUpperCase()
        && /^\d{4}-\d{2}-\d{2}/.test(String(indicator?.date)) && /^\d{4}-\d{2}-\d{2}/.test(String(quote?.date))
        && String(indicator?.date).slice(0, 10) === String(quote?.date).slice(0, 10);
    return { available: valid, matches: Boolean(valid && low <= band && high >= band), band, low, high };
}
