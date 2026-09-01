import { getSyncStockMappings } from "./planner";

export type ClaimType =
    | "current_price"
    | "rsi"
    | "macd"
    | "volume_ratio"
    | "support"
    | "resistance"
    | "moving_average"
    | "change_pct"
    | "derived_metric"
    | "time_period"
    | "general_number";

export interface SemanticClaim {
    type: ClaimType;
    value: number;
    symbol?: string;
    rawText: string;
    sentence: string;
}

export interface ClaimViolation {
    claim: SemanticClaim;
    expected: string | number;
    message: string;
}

export interface ValidationResult {
    isValid: boolean;
    suspiciousSymbols: string[];
    suspiciousNumbers: string[];
    hasRepetitions: boolean;
    deterministicErrors: string[];
    englishThinking?: boolean;
    claimViolations?: ClaimViolation[];
    telemetryDetails?: {
        totalClaimsChecked: number;
        verifiedClaims: number;
        violationCount: number;
    };
}

// Common technical and market acronyms that should not be flagged as stock symbols
const TECHNICAL_EXCLUSIONS = new Set([
    "RSI", "MACD", "OBV", "ADX", "EMA", "SMA", "EGX", "EGX30", "EGX70", "EGX100", 
    "BUY", "SELL", "HOLD", "USD", "EGP", "API", "AI", "Wyckoff", "Volume", "EPS",
    "OTC", "PE", "PER", "PB", "PBV", "ROE", "ROA", "ROI", "NAV", "GDP", "CBE", "FRA",
    "IPO", "MFI", "ATR", "VWAP", "STOCH", "BB", "CCI", "SAR", "PGRST", "HTTP", "HTTPS",
    "URL", "HTML", "PDF", "FAQ", "JSON", "UTC", "GMT", "AM", "PM", "APP", "BOT", "BOTS",
    "CHAT", "LIVE", "DATA", "FREE", "PRO", "PLUS", "VIP", "MAX", "MIN", "SMA20", "SMA50", "SMA200",
    // ML model labels used in AI score output — must NOT be treated as stock tickers
    "KING", "EGX", "SCORE", "ML", "LLM", "GPT"
]);


// Numbers that represent valid universal time units, day numbers, or standard market parameters
const ALLOWED_GENERIC_NUMBERS = new Set([
    // Days of month & calendar parameters (0-31)
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    // Standard trading periods & moving average lookbacks
    5, 7, 9, 10, 14, 20, 21, 22, 50, 60, 90, 100, 120, 150, 180, 200, 250, 365,
    // Commonly used indicators & momentum levels / Fibonacci
    23.6, 30, 38.2, 40, 45, 49, 50, 55, 60, 61.8, 65, 68, 70, 75, 78.6, 80, 85, 90, 95, 100, 150, 161.8, 250, 320, 500, 1000, 1500,
    // Standard volume ratios & multipliers
    0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 5.0,
    // Years
    2023, 2024, 2025, 2026, 2027, 2028, 2030, 2032
]);

/**
 * Extracts all uppercase words of length 3-6 or mapped Arabic stock names that represent stock tickers.
 */
export function extractSymbols(text: string): string[] {
    const matches = text.match(/\b[A-Z]{3,6}\b/g) || [];
    const valid = Array.from(new Set(matches)).filter(sym => !TECHNICAL_EXCLUSIONS.has(sym));
    if (valid.length > 0) return valid;

    try {
        const mappings = getSyncStockMappings();
        const norm = text.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase();
        for (const [arName, symbol] of Object.entries(mappings)) {
            if (arName.length >= 3 && norm.includes(arName.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase())) {
                const sym = Array.isArray(symbol) ? symbol[0] : symbol;
                if (sym) return [sym.toUpperCase()];
            }
        }
    } catch {
        // ignore
    }
    return [];
}

/**
 * Extracts all numeric values (integers and decimals) from a text block.
 * Supports both the ASCII decimal point and the Arabic decimal separator (٫).
 */
export function extractNumbers(text: string): number[] {
    if (!text) return [];
    const normalized = text
        .replace(/,/g, "")
        .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
        .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
    const matches = normalized.match(/\b\d+(?:[.٫]\d+)?\b/g) || [];
    return Array.from(new Set(matches.map(m => Number(m.replace("٫", "."))))).filter(num => !isNaN(num));
}

/**
 * Splits a reply into sentence-level fragments or clauses without breaking decimal numbers.
 * Splitting on commas and conjunctions prevents greedy keyword extractors from tagging 
 * multiple distinct claims (e.g. "السعر 6، والدعم 5") as a single type.
 */
export function splitSentences(text: string): string[] {
    return text.split(/(?<!\d)\.(?!\d)|[\n؟?!؛،,]|(?:^|\s)و(?:\s|$)/).map(s => s.trim()).filter(Boolean);
}

/**
 * Builds a per-symbol facts dictionary (price/rsi/support/resistance/...) from tool results.
 */
export function buildFactsBySymbol(toolResults: any[]): Record<string, any> {
    const factsBySymbol: Record<string, any> = {};
    if (!Array.isArray(toolResults)) return factsBySymbol;

    toolResults.forEach(r => {
        const processSymbolData = (sym: string, data: any) => {
            if (!sym || typeof sym !== "string") return;
            const s = sym.toUpperCase();
            if (!factsBySymbol[s]) factsBySymbol[s] = {};

            if (data.close != null) factsBySymbol[s].price = Number(data.close);
            if (data.price != null && typeof data.price !== "object") factsBySymbol[s].price = Number(data.price);
            // change_pct: handles string formats like "+2.61%" and raw numeric
            if (data.change_pct != null) factsBySymbol[s].change_pct = parseFloat(String(data.change_pct).replace(/[%+]/g, ""));
            if (data.change_pct_num != null) factsBySymbol[s].change_pct = Number(data.change_pct_num);

            // rsi_14: handles string "52.88" and raw numeric
            if (data.rsi_14 != null) factsBySymbol[s].rsi = Number(data.rsi_14);
            if (data.rsi_14_num != null) factsBySymbol[s].rsi = Number(data.rsi_14_num);

            // macd: prefer raw numeric, fall back to signal/string
            if (data.macd != null && !Number.isNaN(Number(data.macd))) factsBySymbol[s].macd = Number(data.macd);
            if (data.macd_signal != null) factsBySymbol[s].macd_signal = Number(data.macd_signal);
            if (data.macd_signal_num != null) factsBySymbol[s].macd_signal = Number(data.macd_signal_num);
            if (data.macd_histogram != null) factsBySymbol[s].macd_histogram = Number(data.macd_histogram);

            // vol_ratio: handles string "1.10x", numeric, and _num variant
            if (data.vol_ratio != null) {
                const vrStr = String(data.vol_ratio);
                const parsed = Number(vrStr.replace(/[x٪%]/g, ""));
                if (!Number.isNaN(parsed)) factsBySymbol[s].vol_ratio = parsed;
            }
            if (data.vol_ratio_num != null) factsBySymbol[s].vol_ratio = Number(data.vol_ratio_num);
            if (data.volRatio != null) factsBySymbol[s].vol_ratio = Number(data.volRatio);

            if (data.support != null) factsBySymbol[s].support = Number(data.support);
            if (data.resistance != null) factsBySymbol[s].resistance = Number(data.resistance);
            if (data.sma_50 != null) factsBySymbol[s].sma_50 = Number(data.sma_50);
            if (data.sma_200 != null) factsBySymbol[s].sma_200 = Number(data.sma_200);
            if (data.ema_50 != null) factsBySymbol[s].ema_50 = Number(data.ema_50);
            if (data.ema_200 != null) factsBySymbol[s].ema_200 = Number(data.ema_200);
            if (data.bb_upper != null) factsBySymbol[s].bb_upper = Number(data.bb_upper);
            if (data.bb_lower != null) factsBySymbol[s].bb_lower = Number(data.bb_lower);
            if (data.acc_score != null) factsBySymbol[s].acc_score = Number(data.acc_score);
            if (data.dist_score != null) factsBySymbol[s].dist_score = Number(data.dist_score);
            if (data.wyckoff_phase != null) factsBySymbol[s].wyckoff_phase = String(data.wyckoff_phase);
            if (data.consecutive_acc_days != null) factsBySymbol[s].consecutive_acc_days = Number(data.consecutive_acc_days);
            if (data.consecutive_dist_days != null) factsBySymbol[s].consecutive_dist_days = Number(data.consecutive_dist_days);
            if (data.highest_250_sessions?.price != null) {
                factsBySymbol[s].highest_price = Number(data.highest_250_sessions.price);
            }
            if (data.king_ai_score != null) factsBySymbol[s].king_ai_score = Number(data.king_ai_score);
            if (data.egx_ai_score != null) factsBySymbol[s].egx_ai_score = Number(data.egx_ai_score);
            if (data.volume != null) {
                const v = Number(data.volume);
                if (!Number.isNaN(v)) factsBySymbol[s].volume = v;
            }
            if (data.vol_sma20 != null) factsBySymbol[s].vol_sma20 = Number(data.vol_sma20);
            if (data.value != null) factsBySymbol[s].value = Number(data.value);
        };

        if (r.data?.symbol) {
            processSymbolData(r.data.symbol, r.data);
        }
        if (Array.isArray(r.data?.stocks)) {
            r.data.stocks.forEach((s: any) => {
                if (s.symbol) processSymbolData(s.symbol, s);
            });
        }
        if (r.tool === "get_comparison" && r.data && typeof r.data === "object") {
            Object.keys(r.data).forEach(sym => {
                const upperSym = sym.toUpperCase();
                const sData = r.data[sym];
                if (sData && typeof sData === "object") {
                    if (sData.price) processSymbolData(upperSym, sData.price);
                    if (sData.tech) processSymbolData(upperSym, sData.tech);
                    if (sData.info) processSymbolData(upperSym, sData.info);
                }
            });
        }
    });
    return factsBySymbol;
}

/**
 * Checks whether a given numeric value can be legitimately derived from known facts
 * via standard mathematical and financial formulas.
 */
export function isVerifiableDerivedMetric(val: number, facts: Record<string, any>, tolerance = 0.6): boolean {
    const p = facts.price;
    const sup = facts.support;
    const res = facts.resistance;
    const rsi = facts.rsi;

    // 1. Distance to Support formula: ((p - sup) / sup) * 100
    if (typeof p === "number" && typeof sup === "number" && sup > 0) {
        const distSupPct = ((p - sup) / sup) * 100;
        if (Math.abs(val - distSupPct) <= 0.6 || Math.abs(val - Math.abs(distSupPct)) <= tolerance) return true;
        const distSupAbs = Math.abs(p - sup);
        if (Math.abs(val - distSupAbs) <= tolerance) return true;
    }

    // 2. Distance to Resistance formula: ((res - p) / res) * 100 or ((p - res) / res) * 100
    if (typeof p === "number" && typeof res === "number" && res > 0) {
        const distResPct = ((res - p) / res) * 100;
        if (Math.abs(val - distResPct) <= 0.6 || Math.abs(val - Math.abs(distResPct)) <= tolerance) return true;
        const distResAbs = Math.abs(res - p);
        if (Math.abs(val - distResAbs) <= tolerance) return true;
    }

    // 3. Channel Position formula: ((p - sup) / (res - sup)) * 100
    if (typeof p === "number" && typeof sup === "number" && typeof res === "number" && res > sup) {
        const channelWidth = res - sup;
        const posPct = ((p - sup) / channelWidth) * 100;
        if (Math.abs(val - posPct) <= tolerance) return true;
        if (Math.abs(val - channelWidth) <= tolerance) return true;
    }

    // 4. RSI threshold distances: |rsi - 50|, |rsi - 70|, |rsi - 30|
    if (typeof rsi === "number") {
        if (Math.abs(val - Math.abs(rsi - 50)) <= tolerance) return true;
        if (Math.abs(val - Math.abs(rsi - 70)) <= tolerance) return true;
        if (Math.abs(val - Math.abs(rsi - 30)) <= tolerance) return true;
    }

    // 5. Known indicators: SMAs, highest price
    if (typeof facts.sma_50 === "number" && Math.abs(val - facts.sma_50) <= 0.05) return true;
    if (typeof facts.sma_200 === "number" && Math.abs(val - facts.sma_200) <= 0.05) return true;
    if (typeof facts.highest_price === "number" && Math.abs(val - facts.highest_price) <= 0.05) return true;

    // 5b. Change percentage (already parsed as decimal number in buildFactsBySymbol)
    if (typeof facts.change_pct === "number" && Math.abs(val - facts.change_pct) <= 0.15) return true;

    // 5c. Volume / value traded
    if (typeof facts.volume === "number" && Math.abs(val - facts.volume) <= facts.volume * 0.02) return true;
    if (typeof facts.value === "number" && Math.abs(val - facts.value) <= facts.value * 0.02) return true;

    // 6. MACD value: exact match within tight tolerance (e.g., 0.27)
    if (typeof facts.macd === "number" && Math.abs(val - facts.macd) <= 0.05) return true;
    // 6b. MACD histogram: |macd - macd_signal|
    if (typeof facts.macd === "number" && typeof facts.macd_signal === "number" && Math.abs(val - Math.abs(facts.macd - facts.macd_signal)) <= 0.05) return true;
    // 6c. MACD histogram from explicit field
    if (typeof facts.macd_histogram === "number" && Math.abs(val - facts.macd_histogram) <= 0.05) return true;

    // 7. Volume ratio: exact match within tolerance (e.g., 0.32, 1.1)
    if (typeof facts.vol_ratio === "number" && Math.abs(val - facts.vol_ratio) <= 0.15) return true;

    // 8. ML scores: KING AI, EGX AI (stored as 0-1 decimals, LLM may state as 0-100 %)
    if (typeof facts.king_ai_score === "number") {
        if (Math.abs(val - facts.king_ai_score) <= 0.05) return true;           // decimal form (0.583)
        if (Math.abs(val - facts.king_ai_score * 100) <= 0.6) return true;       // percentage form (58.3)
    }
    if (typeof facts.egx_ai_score === "number") {
        if (Math.abs(val - facts.egx_ai_score) <= 0.05) return true;
        if (Math.abs(val - facts.egx_ai_score * 100) <= 0.6) return true;
    }

    // 9. ML score difference: |king_ai_score - egx_ai_score| (decimal or percentage-points)
    if (typeof facts.king_ai_score === "number" && typeof facts.egx_ai_score === "number") {
        const mlDiff = Math.abs(facts.king_ai_score - facts.egx_ai_score);
        if (Math.abs(val - mlDiff) <= 0.10) return true;                          // decimal (0.005)
        if (Math.abs(val - mlDiff * 100) <= 1.0) return true;                     // percentage points (0.5)
    }

    return false;
}

/**
 * Verifies cross-stock comparison metrics (price spreads, RSI differences, volume ratio multipliers).
 */
export function isVerifiableCrossSymbolMetric(val: number, factsBySymbol: Record<string, any>, tolerance = 0.6): boolean {
    const syms = Object.keys(factsBySymbol);
    if (syms.length < 2) return false;

    for (let i = 0; i < syms.length; i++) {
        for (let j = i + 1; j < syms.length; j++) {
            const f1 = factsBySymbol[syms[i]];
            const f2 = factsBySymbol[syms[j]];

            if (typeof f1.price === "number" && typeof f2.price === "number") {
                const diff = Math.abs(f1.price - f2.price);
                if (Math.abs(val - diff) <= tolerance) return true;
                if (f2.price > 0 && Math.abs(val - (f1.price / f2.price)) <= 0.1) return true;
                if (f1.price > 0 && Math.abs(val - (f2.price / f1.price)) <= 0.1) return true;
            }

            if (typeof f1.rsi === "number" && typeof f2.rsi === "number") {
                const rsiDiff = Math.abs(f1.rsi - f2.rsi);
                if (Math.abs(val - rsiDiff) <= tolerance) return true;
            }

            if (typeof f1.change_pct === "number" && typeof f2.change_pct === "number") {
                const chgDiff = Math.abs(f1.change_pct - f2.change_pct);
                if (Math.abs(val - chgDiff) <= tolerance) return true;
            }

            if (typeof f1.vol_ratio === "number" && typeof f2.vol_ratio === "number") {
                const vrDiff = Math.abs(f1.vol_ratio - f2.vol_ratio);
                if (Math.abs(val - vrDiff) <= 0.15) return true;
                if (f2.vol_ratio > 0 && Math.abs(val - (f1.vol_ratio / f2.vol_ratio)) <= 0.15) return true;
            }

            // Cross-symbol MACD difference and ratio
            if (typeof f1.macd === "number" && typeof f2.macd === "number") {
                const macdDiff = Math.abs(f1.macd - f2.macd);
                if (Math.abs(val - macdDiff) <= 0.10) return true;
                if (f2.macd !== 0 && typeof f1.macd === "number" && Math.abs(val - (f1.macd / f2.macd)) <= 0.15) return true;
            }

            // Cross-symbol ML score difference (decimal or percentage-points)
            if (typeof f1.king_ai_score === "number" && typeof f2.king_ai_score === "number") {
                const mlDiff = Math.abs(f1.king_ai_score - f2.king_ai_score);
                if (Math.abs(val - mlDiff) <= 0.10) return true;                   // decimal (0.005)
                if (Math.abs(val - mlDiff * 100) <= 1.0) return true;              // percentage points (0.5)
                if (f2.king_ai_score > 0 && Math.abs(val - (f1.king_ai_score / f2.king_ai_score)) <= 0.15) return true;
            }

            // Cross-symbol SMA difference
            if (typeof f1.sma_50 === "number" && typeof f2.sma_50 === "number") {
                const smaDiff = Math.abs(f1.sma_50 - f2.sma_50);
                if (Math.abs(val - smaDiff) <= 0.20) return true;
            }
        }
    }
    return false;
}

/**
 * Extracts typed semantic claims from a sentence for a target symbol.
 */
export function extractSentenceClaims(sentence: string, activeSymbol: string, facts: Record<string, any>): SemanticClaim[] {
    const claims: SemanticClaim[] = [];
    const numbers = extractNumbers(sentence);
    if (numbers.length === 0) return claims;

    const percentMatches = new Set((sentence.match(/(?:[%٪]\s*[-+]?\d+(?:[.٫]\d+)?|[-+]?\d+(?:[.٫]\d+)?\s*[%٪])/g) || [])
        .map(m => Number(m.replace(/[\s%٪+]/g, "").replace("٫", "."))));

    for (const num of numbers) {
        const isPercent = percentMatches.has(num);
        const escapedNum = String(num).replace(".", "\\.");

        // A. RSI Claims: "RSI عند 54.31", "مؤشر القوة النسبية 54.31"
        const isRsiSpecific = new RegExp(`(?:rsi|قوة نسبية|قوه نسبيه)[^0-9\\n]{0,25}?\\b${escapedNum}\\b`, "i").test(sentence);
        if (isRsiSpecific && num <= 100 && !isPercent) {
            claims.push({ type: "rsi", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // B. MACD Claims: "MACD عند 11.97", "مؤشر الماكد 11.97", "خط الإشارة 91.18"
        const isMacdSpecific = new RegExp(`(?:macd|ماكد|خط الإشارة|خط الاشارة|signal line|هيستوجرام|histogram)[^0-9\\n]{0,35}?\\b${escapedNum}\\b`, "i").test(sentence);
        if (isMacdSpecific && !isPercent) {
            claims.push({ type: "macd", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // C. Support Claims: specifically preceded by support keywords
        const isSupportSpecific = new RegExp(`(?:دعم|مستوى الدعم|الدعم)[^0-9\\n]{0,25}?\\b${escapedNum}\\b`, "i").test(sentence);
        if (isSupportSpecific && !isPercent) {
            claims.push({ type: "support", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // D. Resistance Claims: specifically preceded by resistance keywords
        const isResistanceSpecific = new RegExp(`(?:مقاومة|مقاومه|مستوى المقاومة|المقاومة)[^0-9\\n]{0,25}?\\b${escapedNum}\\b`, "i").test(sentence);
        if (isResistanceSpecific && !isPercent) {
            claims.push({ type: "resistance", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // E. Volume Ratio Claims: "نسبة الحجم 0.30x", "السيولة 0.30"
        if (/(?:نسبة الحجم|حجم التداول|السيولة|السيوله|vol_ratio)/i.test(sentence)
            && !isPercent
            && !/(?:دعم|مقاوم[ةه]|سعر|إغلاق|اغلاق)/i.test(sentence)) {
            claims.push({ type: "volume_ratio", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // F. Moving Average Claims: "متوسط 50 يوم (84.87)"
        if (/(?:متوسط|متوسطات|sma|ema)/i.test(sentence)) {
            claims.push({ type: "moving_average", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // G. Price Claims: specifically preceded by explicit price keywords AND NOT preceded by indicators
        const isPriceSpecific = new RegExp(`(?:السعر الحالي|سعر الإغلاق|سعر الاغلاق|السعر عند|سعر عند|يتداول عند|تداول عند|أغلق عند|اغلق عند|سعر السهم|السعر هو|السعر)[^0-9\\n]{0,20}?\\b${escapedNum}\\b`, "i").test(sentence)
            && !new RegExp(`(?:دعم|مقاومة|مقاومه|macd|ماكد|rsi|خط الإشارة|خط الاشارة|متوسط|sma|ema)[^0-9\\n]{0,25}?\\b${escapedNum}\\b`, "i").test(sentence);
        if (isPriceSpecific && !isPercent) {
            claims.push({ type: "current_price", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // H. Derived Math / Percentages
        if (isPercent || isVerifiableDerivedMetric(num, facts)) {
            claims.push({ type: "derived_metric", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // I. Time Periods & Universal Identifiers
        if (ALLOWED_GENERIC_NUMBERS.has(num)) {
            claims.push({ type: "time_period", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        claims.push({ type: "general_number", value: num, symbol: activeSymbol, rawText: String(num), sentence });
    }

    return claims;
}

/**
 * Validates semantic claims strictly against known ground truth facts.
 */
export function validateDeterministicRules(
    replyText: string,
    toolResults: any[],
    userMessage?: string,
    intent?: string
): string[] {
    const errors: string[] = [];
    const userNumbers = userMessage ? extractNumbers(userMessage) : [];
    const sentences = splitSentences(replyText);
    const factsBySymbol = buildFactsBySymbol(toolResults);

    // When the intent is a market-wide scan list (accumulation_distribution), symbols that appear
    // in the scan results are listed BECAUSE they belong to that direction — checking them again
    // for Wyckoff evidence is redundant and causes false positives (validator fires on valid data).
    const isScanListIntent = intent === "accumulation_distribution" || intent === "scan_list";
    const scanListSymbols = new Set<string>();
    if (isScanListIntent) {
        toolResults.forEach(r => {
            if ((r.tool === "get_accumulation_stocks" || r.tool === "get_distribution_stocks") && Array.isArray(r.data?.stocks)) {
                r.data.stocks.forEach((st: any) => { if (st?.symbol) scanListSymbols.add(String(st.symbol).toUpperCase()); });
            }
        });
    }

    let activeSymbol: string | null = null;

    for (const sentence of sentences) {
        const symbols = extractSymbols(sentence);
        if (symbols.length > 0) {
            activeSymbol = symbols[0];
        }
        
        if (!activeSymbol || !factsBySymbol[activeSymbol]) continue;
        const facts = factsBySymbol[activeSymbol];

        // For scan list responses, skip Wyckoff direction checks for symbols already in scan results.
        // They are correctly listed from the DB — re-checking them causes spurious validation errors.
        const skipWyckoffChecks = isScanListIntent && scanListSymbols.has(activeSymbol);

        // Suggestion/target sentences are skipped — but approximation words
        // ("تقريباً"، "حوالي") must NOT skip validation: hallucinated support levels
        // hide behind them ("ثم 2.50 تقريباً").
        const isSuggestionSentence = /(مستهدف|هدف|حد بيع|حد شراء|حد أمان|حد امان|≈|بسعر|بحد|كسعر|كدعم|كمقاومة|التالي|التالية|المقبل|المقبلة)/i.test(sentence);
        if (isSuggestionSentence) continue;

        // EVIDENCE VERIFIER CHECK 1: MACD Signal Line unproven assertion
        if (/(?:خط الإشارة|خط الاشارة|signal line|فوق خط|تحت خط)/i.test(sentence) && facts.macd_signal == null) {
            errors.push(`إسناد غير مثبت لخط الإشارة لسهم ${activeSymbol}: macd_signal غير ممررة في البيانات.`);
        }

        // EVIDENCE VERIFIER CHECK 2: Unproven Wyckoff Distribution assertion
        // Negated statements ("لا يوجد عليه تصريف") are honest answers — never flag them.
        // Skip for scan list stocks — they're listed from DB, not hallucinated.
        const isNegatedClaim = /(?:لا\s+(?:يوجد|توجد|يمكن\s+تأكيد)|مفيش|ليس\s+هناك|غير\s*متاح|لا\s+تتوفر|انعدام)/i.test(sentence);
        // Honest zero-value reporting ("درجة التجميع (acc_score) = 0") states the ABSENCE of a
        // Wyckoff signal — it must not be treated as a directional claim, otherwise truthful
        // answers are rejected and the pipeline falls back to the safe table.
        const mentionsAccumulationZero = /(?:تجميع|تجميعية)[^.\n]{0,30}?(?:صفر|\b0(?!\.\d))/i.test(sentence);
        const mentionsDistributionZero = /(?:تصريف|تصريفية|توزيع)[^.\n]{0,30}?(?:صفر|\b0(?!\.\d))/i.test(sentence);
        const claimsDistribution = /(?:مرحل[ةه]\s*تصريف(?:\s*وايكوف)?|إشار[ةه]\s*تصريف\s*مؤكد[ةه]|درج[ةه]\s*(?:ال)?تصريف|تصريف\s*وايكوف|سيولة\s*(?:توزيع|توزيعية|تصريف|تصريفية|بيعية))/i.test(sentence) && !/(?:توزيعات\s*أرباح|توزيع\s*نقدي|أرباح)/i.test(sentence);
        const hasDistEvidence = (facts.dist_score != null && Number(facts.dist_score) > 0) || toolResults.some(r => (r.tool === "get_distribution_stocks" || r.tool === "get_accumulation_stocks") && Array.isArray(r.data?.stocks) && r.data.stocks.some((st: any) => String(st.symbol).toUpperCase() === activeSymbol?.toUpperCase() && (Number(st.dist_score) > 0 || String(st.wyckoff_phase).toLowerCase().includes("dist") || String(st.wyckoff_phase).toLowerCase().includes("mark"))));
        if (!skipWyckoffChecks && !isNegatedClaim && !mentionsDistributionZero && claimsDistribution && !hasDistEvidence) {
            errors.push(`ادعاء تصريف أو سيولة توزيعية غير مثبت بدليل لسهم ${activeSymbol}: لا تتوفر بيانات مسح Wyckoff/تصريف صريحة — قل إن البيانات غير متاحة بدلاً من الاستنتاج من مؤشرات أخرى.`);
        }


        // EVIDENCE VERIFIER CHECK 3: Unproven Wyckoff Accumulation assertion
        // Exclude: negated/absent claims, Wyckoff-educational context, NONE labels, zero-value reports
        // Skip for scan list stocks — they're listed from DB, not hallucinated.
        const claimsAccumulation = /(?:مرحل[ةه]\s*(?:ال)?تجميع(?:\s*وايكوف)?|درج[ةه]\s*(?:ال)?تجميع|إشار[ةه]\s*تجميع\s*مؤكد[ةه]|تجميع\s*وايكوف|سيولة\s*(?:تجميع|تجميعية|شرائية))/i.test(sentence)
            && !/(?:NONE|غير\s*متاح|لا\s*تتوفر|ليس\s+هناك|بيانات.*التجميع.*غير|خارج.*مسح)/i.test(sentence);
        const hasAccEvidence = (facts.acc_score != null && Number(facts.acc_score) > 0) || toolResults.some(r => (r.tool === "get_accumulation_stocks" || r.tool === "get_distribution_stocks") && Array.isArray(r.data?.stocks) && r.data.stocks.some((st: any) => String(st.symbol).toUpperCase() === activeSymbol?.toUpperCase() && (Number(st.acc_score) > 0 || String(st.wyckoff_phase).toLowerCase().includes("acc"))));
        if (!skipWyckoffChecks && !isNegatedClaim && !mentionsAccumulationZero && claimsAccumulation && !hasAccEvidence) {
            errors.push(`ادعاء تجميع أو سيولة تجميعية غير مثبت بدليل لسهم ${activeSymbol}: لا تتوفر بيانات مسح Wyckoff/تجميع صريحة — قل إن البيانات غير متاحة بدلاً من الاستنتاج من مؤشرات أخرى.`);
        }

        // EVIDENCE VERIFIER CHECK 4: Phase conflict between claim and actual Wyckoff data
        // Skip for scan list stocks — the DB already confirmed their direction.
        const hasPhaseConflict = !skipWyckoffChecks && toolResults.some(r => {
            if (r.source === "performance_evaluator" || r.data_type === "historical") return false;
            if (!Array.isArray(r.data?.stocks)) return false;
            return r.data.stocks.some((st: any) => {
                const symMatch = String(st.symbol).toUpperCase() === activeSymbol?.toUpperCase();
                if (!symMatch) return false;
                const accScore = Number(st.acc_score || 0);
                const distScore = Number(st.dist_score || 0);
                const wyckoffPhase = String(st.wyckoff_phase || "").toLowerCase();
                const signal = String(st.signal || "").toLowerCase();
                if (claimsDistribution && !mentionsDistributionZero && accScore > distScore && (wyckoffPhase.includes("accumulation") || signal === "accumulation")) return true;
                if (claimsAccumulation && !mentionsAccumulationZero && distScore > accScore && (wyckoffPhase.includes("distribution") || signal === "distribution")) return true;
                return false;
            });
        });
        if (hasPhaseConflict) {
            errors.push(`تعارض في بيانات Wyckoff لسهم ${activeSymbol}: الادعاء يتناقض مع بيانات المسح الفني.`);
        }

        // EVIDENCE VERIFIER CHECK 5: Selling-pressure inference from vol_ratio without distribution evidence
        // A high vol_ratio alone (e.g. 1.69x) must NEVER be interpreted as "ضغط بيعي" or "توزيع"
        // unless dist_score > 0 or wyckoff_phase indicates distribution.
        const claimsSellingPressure = /(?:سيولة\s*توزيعية|سيولة\s*تصريفية|تصريف\s*بيعي|سيولة\s*تصريف|ضغط\s*تصريفي)/i.test(sentence);
        const sentenceMentionsVolRatio = /(?:نسبة\s*الحجم|vol_ratio|نسبة\s*السيولة|حجم\s*التداول|نسبة\s*الحجم)/i.test(sentence) || facts.vol_ratio != null;
        if (!skipWyckoffChecks && !isNegatedClaim && claimsSellingPressure && sentenceMentionsVolRatio && !hasDistEvidence) {
            errors.push(`استنتاج غير مثبت لضغط بيعي من نسبة حجم لسهم ${activeSymbol}: vol_ratio قد يكون عالياً (${facts.vol_ratio ?? "غير متوفر"}) لكنه لا يعني توزيع/تصريف دون دليل توزيع صريح (dist_score أو wyckoff_phase). استخدم مصطلح 'نشط' فقط.`);
        }

        // EVIDENCE VERIFIER CHECK 6: ML Score point-difference misreporting
        // When the response claims a large/clear advantage in ML scores ("تفوق كبير", "ميزة واضحة"),
        // the actual numeric difference must be > 1.0 point to avoid false emphasis.
        const claimsLargeMlAdvantage = /(?:تفوق\s*كبير|ميزة\s*واضحة|تفوق\s*واضح|فارق\s*كبير|تفوق\s*ملحوظ|ميزة\s*واضحة|بصورة\s*واضحة)/i.test(sentence);
        const mentionsMlScores = /(?:KING|ML|نموذج\s*الذكاء|ذكاء\s*اصطناعي|ai\s*score|king_ai|egx_ai)/i.test(sentence);
        if (claimsLargeMlAdvantage && mentionsMlScores) {
            const syms = Object.keys(factsBySymbol);
            if (syms.length >= 2) {
                let maxDiffFound = 0;
                for (let i = 0; i < syms.length; i++) {
                    for (let j = i + 1; j < syms.length; j++) {
                        for (const scoreKey of ["king_ai_score", "egx_ai_score"]) {
                            const v1 = factsBySymbol[syms[i]][scoreKey];
                            const v2 = factsBySymbol[syms[j]][scoreKey];
                            if (typeof v1 === "number" && typeof v2 === "number") {
                                maxDiffFound = Math.max(maxDiffFound, Math.abs(v1 - v2));
                            }
                        }
                    }
                }
                // ML scores are 0-1 scaled; multiply by 100 to get points
                const diffInPoints = maxDiffFound * 100;
                if (diffInPoints > 0 && diffInPoints <= 1.0) {
                    errors.push(`ادعاء تفوق كبير/ميزة واضحة لنقاط ML غير دقيق: الفرق الفعلي بين أفضل أزواج ML scores هو ${diffInPoints.toFixed(1)} نقطة (≤ 1.0) — اعتبره غير معنوي ولا تدّعِ تفوقاً كبيراً.`);
                }
            }
        }

        // EVIDENCE VERIFIER CHECK 8: False "آمن" / "قوي" / "إيجابية واضحة" claim with neutral RSI
        // When RSI is in the 40-70 neutral range, words like "آمن", "إشارة قوية",
        // "زخم قوي", "منطقة آمن", "إيجابية واضحة" overstate the evidence. These should
        // be downgraded to "محايد" or "يتميل للإيجابية".
        const rsi = facts?.rsi != null ? Number(facts.rsi) : null;
        if (rsi !== null && rsi >= 40 && rsi <= 70 && !Number.isNaN(rsi)) {
            const strongWords = /\bآمن\b|إشارة\s*قوي|زخم\s*قوي|منطقة\s*آمن|صاعد\s*إيجابي\s*وآمن|إيجابية\s*واضحة|تفوق\s*واضح/g;
            if (strongWords.test(sentence)) {
                errors.push(`ادعاء "آمن" أو "قوي" مبالغ فيه لسهم ${activeSymbol} مع RSI = ${rsi} (محايد 40-70): استخدم "محايد يميل للإيجابية" بدلاً من "آمن" أو "قوي".`);
            }
        }

        const claims = extractSentenceClaims(sentence, activeSymbol, facts);


        for (const claim of claims) {
            if (userNumbers.includes(claim.value)) continue;

            // Universal Multi-Symbol Fact Exemption:
            // If the number matches the price, support, resistance, RSI, or level of ANY queried symbol in factsBySymbol,
            // it is a verified true data point and should never be penalized as a mismatch for another symbol.
            const isExactAnyCoreFact = Object.values(factsBySymbol).some((f: any) => {
                return (f.price != null && (Math.abs(claim.value - f.price) <= 0.05 || (f.price > 0 && Math.abs(claim.value - f.price) / f.price <= 0.02))) ||
                    (f.support != null && (Math.abs(claim.value - f.support) <= 0.05 || (f.support > 0 && Math.abs(claim.value - f.support) / f.support <= 0.02))) ||
                    (f.resistance != null && (Math.abs(claim.value - f.resistance) <= 0.05 || (f.resistance > 0 && Math.abs(claim.value - f.resistance) / f.resistance <= 0.02))) ||
                    (f.rsi != null && (Math.abs(claim.value - f.rsi) <= 0.51 || (f.rsi > 0 && Math.abs(claim.value - f.rsi) / f.rsi <= 0.01)));
            });

            if (isExactAnyCoreFact) continue;

            switch (claim.type) {
                case "current_price": {
                    if (facts.price != null) {
                        const price = facts.price;
                        const isMatch = Math.abs(claim.value - price) <= 0.05 || (price > 0 && Math.abs(claim.value - price) / price <= 0.02);
                        if (!isMatch && !ALLOWED_GENERIC_NUMBERS.has(claim.value)) {
                            errors.push(`تضارب في سعر سهم ${activeSymbol}: السعر الفعلي هو ${price} ولكن الرد يحتوي على ${claim.value}.`);
                        }
                    }
                    break;
                }
                case "rsi": {
                    if (facts.rsi != null) {
                        const rsi = facts.rsi;
                        const isMatch = Math.abs(claim.value - rsi) <= 0.51 || (rsi > 0 && Math.abs(claim.value - rsi) / rsi <= 0.01);
                        if (!isMatch && !ALLOWED_GENERIC_NUMBERS.has(claim.value)) {
                            errors.push(`تضارب في قيمة RSI لسهم ${activeSymbol}: القيمة الفعلية هي ${rsi} ولكن الرد يحتوي على ${claim.value}.`);
                        }
                    }
                    break;
                }
                case "support": {
                    // A support figure must match the recorded support, the LOWER Bollinger
                    // band, or an average sitting below price — never an arbitrary "plausible"
                    // number, and never the generic-numbers whitelist.
                    const sup = facts.support;
                    const isMatch = typeof sup === "number" && Number.isFinite(sup)
                        && (Math.abs(claim.value - sup) <= 0.05 || (sup > 0 && Math.abs(claim.value - sup) / sup <= 0.02));
                    const isKnownLowerLevel = [facts.bb_lower, facts.sma_50, facts.sma_200, facts.ema_50, facts.ema_200]
                        .some(v => typeof v === "number" && Number.isFinite(v)
                            && Math.abs(claim.value - v) <= 0.05
                            && (facts.price == null || v <= facts.price * 1.02));
                    if (!isMatch && !isKnownLowerLevel && !isVerifiableDerivedMetric(claim.value, facts, 0.15)) {
                        errors.push(`تضارب في قيمة الدعم لسهم ${activeSymbol}: الدعم المسجل هو ${sup ?? "غير متاح"} ولا توجد مؤشرات معروفة تدعم قيمة ${claim.value} — اذكر الدعم المسجل فقط أو اذكر أن البيانات غير متاحة.`);
                    }
                    break;
                }
                case "resistance": {
                    // Mirror rule: resistance claims may cite the UPPER Bollinger band,
                    // the 250-session high, or an average above price — nothing else.
                    const res = facts.resistance;
                    const isMatch = typeof res === "number" && Number.isFinite(res)
                        && (Math.abs(claim.value - res) <= 0.05 || (res > 0 && Math.abs(claim.value - res) / res <= 0.02));
                    const isKnownUpperLevel = [facts.bb_upper, facts.sma_50, facts.sma_200, facts.ema_50, facts.ema_200, facts.highest_price]
                        .some(v => typeof v === "number" && Number.isFinite(v)
                            && Math.abs(claim.value - v) <= 0.05
                            && (facts.price == null || v >= facts.price * 0.98));
                    if (!isMatch && !isKnownUpperLevel && !isVerifiableDerivedMetric(claim.value, facts, 0.15)) {
                        errors.push(`تضارب في قيمة المقاومة لسهم ${activeSymbol}: المقاومة المسجلة هي ${res ?? "غير متاحة"} ولا توجد مؤشرات معروفة تدعم قيمة ${claim.value} — اذكر المقاومة المسجلة فقط أو اذكر أن البيانات غير متاحة.`);
                    }
                    break;
                }
            }
        }
    }
    
    return errors;
}

/**
 * Performs safe, context-bound inline repairs ONLY when an unambiguous factual field
 * (e.g. current_price) has a minor decimal rounding discrepancy.
 */
export function autoFixNumbers(replyText: string, toolResults: any[]): string {
    const factsBySymbol = buildFactsBySymbol(toolResults);
    let fixed = replyText;

    for (const [, facts] of Object.entries(factsBySymbol)) {
        if (facts.price != null && Number.isFinite(facts.price)) {
            const price = Number(facts.price);
            const strictPricePattern = new RegExp(`((?:السعر الحالي|سعر الإغلاق|سعر الاغلاق|أغلق عند|اغلق عند|يتداول عند|تداول عند)(?:\\s+هو|\\s+يسجل|\\s+يبلغ)?\\s*[:：]?\\s*)(\\d+(?:\\.\\d+)?)(?=\\s*جنيه|\\s*EGP|\\s*\\n|\\s*،|\\s*\\.|$)`, "gi");
            fixed = fixed.replace(strictPricePattern, (match, prefix, valStr) => {
                const val = parseFloat(valStr);
                if (Math.abs(val - price) > 0 && Math.abs(val - price) <= price * 0.03) {
                    return `${prefix}${price}`;
                }
                return match;
            });
            
            // P1: Fix derived percentage from support
            if (facts.support != null && Number.isFinite(facts.support)) {
                const support = Number(facts.support);
                if (support > 0 && price > support) {
                    const derivedPct = ((price - support) / support * 100);
                    const strictPctPattern = new RegExp(`((?:ارتفع|صعد|يبتعد|بنسبة|نحو)\\s+(?:حوالي|نحو|بمقدار)?\\s*)([0-9]+(?:\\.[0-9]+)?)(?=\\s*(?:%|بالمائة))`, "gi");
                    fixed = fixed.replace(strictPctPattern, (match, prefix, valStr) => {
                        const val = parseFloat(valStr);
                        if (Math.abs(val - derivedPct) > 0 && Math.abs(val - derivedPct) <= 2.5) {
                            return `${prefix}${derivedPct.toFixed(2)}`;
                        }
                        return match;
                    });
                }
            }
        }
    }
    return fixed;
}

/**
 * Comprehensive validation engine assessing symbols, numbers, semantic claims, and linguistic coherence.
 */
export function validateResponse(
    replyText: string,
    liveDataString: string,
    validSymbols: string[],
    toolResults: any[] = [],
    userMessage?: string,
    intent?: string
): ValidationResult {
    const replySymbols = extractSymbols(replyText);
    const replyNumbers = extractNumbers(replyText);

    const sourceSymbols = extractSymbols(liveDataString);
    const sourceNumbers = extractNumbers(liveDataString);

    // 1. Verify Symbols: Must exist in source data, valid DB symbols, or user's message
    const userSymbols = userMessage ? extractSymbols(userMessage) : [];
    const suspiciousSymbols = replySymbols.filter(sym => {
        const inSource = sourceSymbols.includes(sym);
        const inDb = validSymbols.includes(sym);
        const inUser = userSymbols.includes(sym);
        return !inSource && !inDb && !inUser;
    });

    // 2. Verify Numbers with Semantic Context
    const suspiciousNumbers: string[] = [];
    const factsBySymbol = buildFactsBySymbol(toolResults);
    const userNumbers = userMessage ? extractNumbers(userMessage) : [];

    const percentNumbers = new Set((replyText.match(/(?:[%٪]\s*[-+]?\d+(?:[.٫]\d+)?|[-+]?\d+(?:[.٫]\d+)?\s*[%٪])/g) || [])
        .map(m => Number(m.replace(/[\s%٪+]/g, "").replace("٫", "."))));

    const multiplierNumbers = new Set((replyText.match(/\d+(?:[.٫]\d+)?\s*[xX✕]/g) || [])
        .map(m => Number(m.replace(/[\sXx✕]/g, "").replace("٫", "."))));

    const hasDbData = toolResults.some(r => r.tool !== "search_web" && r.tool !== "get_news");
    const hasSourceData = hasDbData && ((toolResults && toolResults.length > 0) || sourceNumbers.length > 0);

    if (hasSourceData) {
        for (const num of replyNumbers) {
            if (ALLOWED_GENERIC_NUMBERS.has(num)) continue;
            if (userNumbers.includes(num)) continue;
            if (percentNumbers.has(num)) continue;
            if (multiplierNumbers.has(num)) continue;
            if (isVerifiableCrossSymbolMetric(num, factsBySymbol)) continue;

            // Check if matches any raw source number
            let isMatched = false;
            for (const srcNum of sourceNumbers) {
                const absDiff = Math.abs(num - srcNum);
                const relDiff = srcNum > 0 ? absDiff / srcNum : absDiff;
                if (absDiff <= 0.05 || relDiff <= 0.01) {
                    isMatched = true;
                    break;
                }

                // Allow LLM formatted scaled numbers (e.g., 2.72 for 2720000, "مليون")
                const scaledMillions = num * 1_000_000;
                if (Math.abs(scaledMillions - srcNum) <= 10000 || (srcNum > 0 && Math.abs(scaledMillions - srcNum) / srcNum <= 0.02)) {
                    isMatched = true;
                    break;
                }

                // Allow billions ("مليار")
                const scaledBillions = num * 1_000_000_000;
                if (Math.abs(scaledBillions - srcNum) <= 10000000 || (srcNum > 0 && Math.abs(scaledBillions - srcNum) / srcNum <= 0.02)) {
                    isMatched = true;
                    break;
                }

                // Allow thousands ("ألف")
                const scaledThousands = num * 1_000;
                if (Math.abs(scaledThousands - srcNum) <= 10 || (srcNum > 0 && Math.abs(scaledThousands - srcNum) / srcNum <= 0.02)) {
                    isMatched = true;
                    break;
                }
            }

            if (!isMatched) {
                const numStr = String(num);
                const escapedNum = numStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const numRegex = new RegExp(`(?:^|[^0-9.])${escapedNum}(?:[^0-9.]|$)`, "g");
                if (numRegex.test(liveDataString)) {
                    isMatched = true;
                }
            }

            // Check if matches any mathematically verifiable formula from facts
            if (!isMatched) {
                for (const sym of Object.keys(factsBySymbol)) {
                    if (isVerifiableDerivedMetric(num, factsBySymbol[sym])) {
                        isMatched = true;
                        break;
                    }
                }
            }

            // Check if level falls inside known support..resistance analyst band
            if (!isMatched) {
                for (const sym of Object.keys(factsBySymbol)) {
                    const f = factsBySymbol[sym];
                    const levels = [f.price, f.support, f.resistance].filter((v: any) => typeof v === "number" && Number.isFinite(v));
                    if (levels.length === 0) continue;
                    const lo = Math.min(...levels);
                    const hi = Math.max(...levels);
                    if (num >= lo && num <= hi) {
                        isMatched = true;
                        break;
                    }
                }
            }

            if (!isMatched) {
                suspiciousNumbers.push(String(num));
            }
        }
    }

    const hasRepetitions = hasExcessiveRepetitions(replyText);
    const deterministicErrors = validateDeterministicRules(replyText, toolResults, userMessage, intent);

    // Chain-of-thought leak guard
    const arabicChars = (replyText.match(/[\u0600-\u06FF]/g) || []).length;
    const asciiLetters = (replyText.match(/[A-Za-z]/g) || []).length;
    const hasCotMarkers = /The user is asking|Technical analysis perspective|Historical Data \(Sector|Analysis for|Gainers list matches|Let me (think|analyze|check|look|review)|I need to (check|analyze|look|find|compare)|thinking process|The question (is|asks)/i.test(replyText);
    
    // Only flag as English thinking if there's genuinely no Arabic at all, or it's overwhelmingly English with CoT markers
    const englishThinking = (arabicChars < 10 && asciiLetters > 20) || (asciiLetters > arabicChars * 2) || (hasCotMarkers && asciiLetters > arabicChars);

    return {
        isValid: suspiciousSymbols.length === 0 && suspiciousNumbers.length === 0 && !hasRepetitions && deterministicErrors.length === 0 && !englishThinking,
        suspiciousSymbols,
        suspiciousNumbers,
        hasRepetitions,
        deterministicErrors,
        englishThinking,
        telemetryDetails: {
            totalClaimsChecked: replyNumbers.length,
            verifiedClaims: replyNumbers.length - suspiciousNumbers.length,
            violationCount: deterministicErrors.length + suspiciousNumbers.length + suspiciousSymbols.length
        }
    };
}

/**
 * Detects if there are lines or phrases repeated too many times.
 */
export function hasExcessiveRepetitions(text: string): boolean {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 10);
    const counts = new Map<string, number>();
    for (const line of lines) {
        const normalized = line.replace(/[^\w\s\u0621-\u064a]/g, "").replace(/\s+/g, " ");
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
        if ((counts.get(normalized) || 0) > 2) {
            return true;
        }
    }
    return false;
}
