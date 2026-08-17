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
    "CHAT", "LIVE", "DATA", "FREE", "PRO", "PLUS", "VIP", "MAX", "MIN", "SMA20", "SMA50", "SMA200"
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
 * Extracts all uppercase words of length 3-6 that could represent stock tickers.
 */
export function extractSymbols(text: string): string[] {
    const matches = text.match(/\b[A-Z]{3,6}\b/g) || [];
    return Array.from(new Set(matches)).filter(sym => !TECHNICAL_EXCLUSIONS.has(sym));
}

/**
 * Extracts all numeric values (integers and decimals) from a text block.
 * Supports both the ASCII decimal point and the Arabic decimal separator (٫).
 */
export function extractNumbers(text: string): number[] {
    if (!text) return [];
    const normalized = text
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
            if (data.price != null) factsBySymbol[s].price = Number(data.price);
            if (data.change_pct != null) factsBySymbol[s].change_pct = parseFloat(String(data.change_pct).replace(/[%+]/g, ""));
            if (data.rsi_14 != null) factsBySymbol[s].rsi = Number(data.rsi_14);
            if (data.rsi != null) factsBySymbol[s].rsi = Number(data.rsi);
            if (data.macd != null) factsBySymbol[s].macd = Number(data.macd);
            if (data.macd_signal != null) factsBySymbol[s].macd_signal = Number(data.macd_signal);

            if (data.vol_ratio != null) factsBySymbol[s].vol_ratio = Number(data.vol_ratio);
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
        };

        if (r.data?.symbol) {
            processSymbolData(r.data.symbol, r.data);
        }
        if (Array.isArray(r.data?.stocks)) {
            r.data.stocks.forEach((s: any) => {
                if (s.symbol) processSymbolData(s.symbol, s);
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

    return false;
}

/**
 * Extracts typed semantic claims from a sentence for a target symbol.
 */
export function extractSentenceClaims(sentence: string, activeSymbol: string, facts: Record<string, any>): SemanticClaim[] {
    const claims: SemanticClaim[] = [];
    const numbers = extractNumbers(sentence);
    if (numbers.length === 0) return claims;

    const percentMatches = new Set((sentence.match(/\d+(?:[.٫]\d+)?\s*(?:%|٪)/g) || [])
        .map(m => Number(m.replace(/[\s%٪]/g, "").replace("٫", "."))));

    for (const num of numbers) {
        const isPercent = percentMatches.has(num);

        // A. Price Claims: "السعر 120.78", "إغلاق 120.78", "يتداول عند 120.78"
        const escapedNum = String(num).replace(".", "\\.");
        const isPriceSpecific = new RegExp(`(?:السعر|سعر|إغلاق|اغلاق|يتداول عند|تداول عند|أغلق عند|اغلق عند)[^0-9\\n]{0,25}?\\b${escapedNum}\\b`, "i").test(sentence)
            && !/(?:أعلى|اعلى|أقصى|اقصى|أدنى|ادنى|دعم|مقاومة|مقاومه|متوسط)/i.test(sentence);
        if (isPriceSpecific && !isPercent) {
            claims.push({ type: "current_price", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // B. RSI Claims: "RSI عند 54.31", "مؤشر القوة النسبية 54.31"
        if (/(?:rsi|قوة نسبية|قوه نسبيه)/i.test(sentence) && num <= 100 && !isPercent) {
            claims.push({ type: "rsi", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // C. MACD Claims: "MACD عند 11.97", "مؤشر الماكد 11.97"
        if (/(?:macd|ماكد)/i.test(sentence) && !isPercent) {
            claims.push({ type: "macd", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // D. Volume Ratio Claims: "نسبة الحجم 0.30x", "السيولة 0.30" — but a level
        // sentence ("تصحيح قرب 2.50 بحجم تداول أعلى") must not swallow its numbers here.
        if (/(?:نسبة الحجم|حجم التداول|السيولة|السيوله|vol_ratio)/i.test(sentence)
            && !isPercent
            && !/(?:دعم|مقاوم[ةه]|سعر|إغلاق|اغلاق)/i.test(sentence)) {
            claims.push({ type: "volume_ratio", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // E. Support Claims: "الدعم عند 45.15", "مستوى الدعم 45.15"
        if (/(?:دعم|مستوى الدعم|الدعم)/i.test(sentence) && !isPercent) {
            claims.push({ type: "support", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // F. Resistance Claims: "المقاومة عند 144.94", "مستوى المقاومة 144.94"
        if (/(?:مقاومة|مقاومه|مستوى المقاومة|المقاومة)/i.test(sentence) && !isPercent) {
            claims.push({ type: "resistance", value: num, symbol: activeSymbol, rawText: String(num), sentence });
            continue;
        }

        // G. Moving Average Claims: "متوسط 50 يوم (84.87)"
        if (/(?:متوسط|متوسطات|sma|ema)/i.test(sentence)) {
            claims.push({ type: "moving_average", value: num, symbol: activeSymbol, rawText: String(num), sentence });
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
    userMessage?: string
): string[] {
    const errors: string[] = [];
    const userNumbers = userMessage ? extractNumbers(userMessage) : [];
    const sentences = splitSentences(replyText);
    const factsBySymbol = buildFactsBySymbol(toolResults);

    let activeSymbol: string | null = null;

    for (const sentence of sentences) {
        const symbols = extractSymbols(sentence);
        if (symbols.length > 0) {
            activeSymbol = symbols[0];
        }
        
        if (!activeSymbol || !factsBySymbol[activeSymbol]) continue;
        const facts = factsBySymbol[activeSymbol];

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
        const isNegatedClaim = /(?:لا\s+(?:يوجد|توجد|يمكن\s+تأكيد)|مفيش|ليس\s+هناك|غير\s+متاح|لا\s+تتوفر|انعدام)/i.test(sentence);
        const claimsDistribution = /(?:مرحل[ةه]\s*تصريف|إشار[ةه]\s*تصريف|سيول[ةه]\s*توزيعية|(?:عليه|فيه|به|لديه)\s*تصريف|درج[ةه]\s*(?:ال)?تصريف|يتم\s+(?:عليه\s+)?تصريف|سهم\s*تصريف)/i.test(sentence);
        const hasDistEvidence = (facts.dist_score != null && Number(facts.dist_score) > 0) || toolResults.some(r => (r.tool === "get_distribution_stocks" || r.tool === "get_accumulation_stocks") && Array.isArray(r.data?.stocks) && r.data.stocks.some((st: any) => String(st.symbol).toUpperCase() === activeSymbol?.toUpperCase() && (Number(st.dist_score) > 0 || String(st.wyckoff_phase).toLowerCase().includes("dist") || String(st.wyckoff_phase).toLowerCase().includes("mark"))));
        if (!isNegatedClaim && claimsDistribution && !hasDistEvidence) {
            errors.push(`ادعاء تصريف غير مثبت بدليل لسهم ${activeSymbol}: لا تتوفر بيانات مسح Wyckoff/تصريف صريحة — قل إن البيانات غير متاحة بدلاً من الاستنتاج من مؤشرات أخرى.`);
        }

        // EVIDENCE VERIFIER CHECK 3: Unproven Wyckoff Accumulation assertion
        // Exclude: negated/absent claims, Wyckoff-educational context, NONE labels
        const claimsAccumulation = /(?:مرحل[\u0629\u0647]\s*(?:ال)?تجميع|(?:\u0639\u0644\u064a\u0647|\u0641\u064a\u0647|\u0628\u0647|\u0644\u062f\u064a\u0647)\s*تجميع|\u064a\u062a\u0645\s*(?:\u0639\u0644\u064a\u0647\s*)?\u062a\u062c\u0645\u064a\u0639|\u062f\u0631\u062c[\u0629\u0647]\s*(?:ال)?تجميع|\u0625\u0634\u0627\u0631[\u0629\u0647]\s*تجميع|سيول[\u0629\u0647]\s*تجميعية)/i.test(sentence)
            && !/(?:NONE|\u063a\u064a\u0631\s*\u0645\u062a\u0627\u062d|\u0644\u0627\s*\u062a\u062a\u0648\u0641\u0631|\u0644\u064a\u0633\s*\u0647\u0646\u0627\u0643|\u0628\u064a\u0627\u0646\u0627\u062a.*\u0627\u0644\u062a\u062c\u0645\u064a\u0639.*\u063a\u064a\u0631|\u062e\u0627\u0631\u062c.*\u0645\u0633\u062d)/i.test(sentence);
        const hasAccEvidence = (facts.acc_score != null && Number(facts.acc_score) > 0) || toolResults.some(r => (r.tool === "get_accumulation_stocks" || r.tool === "get_distribution_stocks") && Array.isArray(r.data?.stocks) && r.data.stocks.some((st: any) => String(st.symbol).toUpperCase() === activeSymbol?.toUpperCase() && (Number(st.acc_score) > 0 || String(st.wyckoff_phase).toLowerCase().includes("acc"))));
        if (!isNegatedClaim && claimsAccumulation && !hasAccEvidence) {
            errors.push(`ادعاء تجميع غير مثبت بدليل لسهم ${activeSymbol}: لا تتوفر بيانات مسح Wyckoff/تجميع صريحة — قل إن البيانات غير متاحة بدلاً من الاستنتاج من مؤشرات أخرى.`);
        }

        // EVIDENCE VERIFIER CHECK 4: Phase conflict between claim and actual Wyckoff data
        const hasPhaseConflict = toolResults.some(r => {
            if (!Array.isArray(r.data?.stocks)) return false;
            return r.data.stocks.some((st: any) => {
                const symMatch = String(st.symbol).toUpperCase() === activeSymbol?.toUpperCase();
                if (!symMatch) return false;
                const accScore = Number(st.acc_score || 0);
                const distScore = Number(st.dist_score || 0);
                const wyckoffPhase = String(st.wyckoff_phase || "").toLowerCase();
                const signal = String(st.signal || "").toLowerCase();
                if (claimsDistribution && accScore > distScore && (wyckoffPhase.includes("accumulation") || signal === "accumulation")) return true;
                if (claimsAccumulation && distScore > accScore && (wyckoffPhase.includes("distribution") || signal === "distribution")) return true;
                return false;
            });
        });
        if (hasPhaseConflict) {
            errors.push(`تعارض في بيانات Wyckoff لسهم ${activeSymbol}: الادعاء يتناقض مع بيانات المسح الفني.`);
        }


        const claims = extractSentenceClaims(sentence, activeSymbol, facts);

        for (const claim of claims) {
            if (userNumbers.includes(claim.value)) continue;

            // Universal Fact Exemption:
            // If the number perfectly matches ANY of the three core facts, it is a true data point.
            // We exempt it to prevent greedy sentence/clause parsing from falsely penalizing a correct
            // number just because it was mislabeled (e.g. tagging resistance as support).
            const isExactCoreFact = 
                (facts.price != null && Math.abs(claim.value - facts.price) <= 0.05) ||
                (facts.support != null && Math.abs(claim.value - facts.support) <= 0.05) ||
                (facts.resistance != null && Math.abs(claim.value - facts.resistance) <= 0.05);

            if (isExactCoreFact) continue;

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
    userMessage?: string
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

    const percentNumbers = new Set((replyText.match(/\d+(?:\.\d+)?\s*(?:%|٪)/g) || [])
        .map(m => Number(m.replace(/[\s%٪]/g, ""))));

    const hasDbData = toolResults.some(r => r.tool !== "search_web" && r.tool !== "get_news");
    const hasSourceData = hasDbData && ((toolResults && toolResults.length > 0) || sourceNumbers.length > 0);

    if (hasSourceData) {
        for (const num of replyNumbers) {
            if (ALLOWED_GENERIC_NUMBERS.has(num)) continue;
            if (userNumbers.includes(num)) continue;
            if (percentNumbers.has(num)) continue;

            // Check if matches any raw source number
            let isMatched = false;
            for (const srcNum of sourceNumbers) {
                const absDiff = Math.abs(num - srcNum);
                const relDiff = srcNum > 0 ? absDiff / srcNum : absDiff;
                if (absDiff <= 0.05 || relDiff <= 0.01) {
                    isMatched = true;
                    break;
                }
            }

            if (!isMatched && liveDataString.includes(String(num))) {
                isMatched = true;
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
    const deterministicErrors = validateDeterministicRules(replyText, toolResults, userMessage);

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
