export interface ValidationResult {
    isValid: boolean;
    suspiciousSymbols: string[];
    suspiciousNumbers: string[];
    hasRepetitions: boolean;
    deterministicErrors?: string[];
    englishThinking?: boolean;
}

// Common technical terms that should not be flagged as stock symbols
const TECHNICAL_EXCLUSIONS = new Set([
    "RSI", "MACD", "OBV", "ADX", "EMA", "SMA", "EGX", "EGX30", "EGX70", "EGX100", 
    "BUY", "SELL", "HOLD", "USD", "EGP", "API", "AI", "Wyckoff", "Volume"
]);

// Numbers that are universally allowed (dates, standard parameters, index markers, etc.)
const ALLOWED_GENERIC_NUMBERS = new Set([
    // Days of month & months (1-31)
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    // Commonly used indicators/levels
    40, 45, 49, 50, 55, 60, 65, 68, 70, 75, 80, 100, 150, 250, 320, 500, 1000, 1500,
    // Years
    2024, 2025, 2026, 2027
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
 */
export function extractNumbers(text: string): number[] {
    // Regex matching numbers possibly followed by % or x, but capturing only the numeric part
    const matches = text.match(/\b\d+(?:\.\d+)?\b/g) || [];
    return Array.from(new Set(matches.map(Number))).filter(num => !isNaN(num));
}

/**
 * Builds a per-symbol facts dictionary (price/rsi/support/resistance/...) from tool results.
 */
export function buildFactsBySymbol(toolResults: any[]): Record<string, any> {
    const factsBySymbol: Record<string, any> = {};
    toolResults.forEach(r => {
        const processSymbolData = (sym: string, data: any) => {
            const s = sym.toUpperCase();
            if (!factsBySymbol[s]) factsBySymbol[s] = {};
            // close first, then price overwrites — matches the deterministic template's `tech.price ?? tech.close` precedence
            if (data.close != null) factsBySymbol[s].price = Number(data.close);
            if (data.price != null) factsBySymbol[s].price = Number(data.price);
            if (data.rsi_14 != null) factsBySymbol[s].rsi = Number(data.rsi_14);
            if (data.rsi != null) factsBySymbol[s].rsi = Number(data.rsi);
            if (data.vol_ratio != null) factsBySymbol[s].vol_ratio = Number(data.vol_ratio);
            if (data.volRatio != null) factsBySymbol[s].vol_ratio = Number(data.volRatio);
            if (data.support != null) factsBySymbol[s].support = Number(data.support);
            if (data.resistance != null) factsBySymbol[s].resistance = Number(data.resistance);
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
 * Validates logical correctness of financial metrics mentioned in assistant reply.
 */
export function validateDeterministicRules(
    replyText: string,
    toolResults: any[]
): string[] {
    const errors: string[] = [];
    const sentences = replyText.split(/[.\n؟?!؛]/).map(s => s.trim()).filter(Boolean);

    const factsBySymbol = buildFactsBySymbol(toolResults);

    let activeSymbol: string | null = null;

    for (const sentence of sentences) {
        const symbols = extractSymbols(sentence);
        if (symbols.length > 0) {
            activeSymbol = symbols[0];
        }
        
        if (!activeSymbol || !factsBySymbol[activeSymbol]) continue;
        
        const facts = factsBySymbol[activeSymbol];
        const numbers = extractNumbers(sentence);

        // Percent numbers (e.g. "0.60%") are changes/ratios, not price levels.
        const percentNumbers = new Set((sentence.match(/\d+(?:\.\d+)?\s*(?:%|٪)/g) || [])
            .map(m => Number(m.replace(/[\s%٪]/g, ""))));

        // Derived values the model legitimately computes from facts
        // (distance to support/resistance, gap percentages between levels).
        const factValues = [facts.price, facts.support, facts.resistance, facts.rsi]
            .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        const isDerivedValue = (n: number): boolean => {
            for (let i = 0; i < factValues.length; i++) {
                for (let j = 0; j < factValues.length; j++) {
                    if (i === j) continue;
                    const diff = Math.abs(factValues[i] - factValues[j]);
                    if (Math.abs(n - diff) <= 0.6) return true;
                    if (factValues[j] > 0) {
                        const pct = (diff / factValues[j]) * 100;
                        if (Math.abs(n - pct) <= 0.6) return true;
                    }
                }
            }
            return false;
        };
        const isExemptNumber = (n: number): boolean => percentNumbers.has(n) || isDerivedValue(n);

        // Sentences that PROPOSE targets/levels (مستهدف، حد أمان، حوالي، ≈، قبيل...)
        // carry analyst suggestions, not factual claims — skip strict fact matching for them.
        const isSuggestionSentence = /(مستهدف|هدف بيع|هدف شراء|حد بيع|حد شراء|حد أمان|حد امان|تقريباً|تقريبا|≈|حوالي|حوالى|قبيل)/i.test(sentence);
        if (isSuggestionSentence) continue;

        // 1. RSI Check
        if (/(?:rsi|قوة نسبية|قوه نسبيه)/i.test(sentence) && facts.rsi != null) {
            const rsiNum = facts.rsi;
            const hasCorrectRsi = numbers.some(n => Math.abs(n - rsiNum) <= 0.05 || (rsiNum > 0 && Math.abs(n - rsiNum) / rsiNum <= 0.01));
            const nonLevelNumbers = numbers.filter(n => n !== 30 && n !== 70 && n !== 14 && n !== 80 && n !== 50 && !percentNumbers.has(n));
            if (nonLevelNumbers.length > 0 && !hasCorrectRsi) {
                errors.push(`تضارب في قيمة RSI لسهم ${activeSymbol}: القيمة الفعلية هي ${rsiNum} ولكن الرد يحتوي على قيم مختلفة.`);
            }
        }
        
        // 2. Support Check
        if (/(?:دعم|مستوى الدعم|الدعم)/i.test(sentence) && facts.support != null) {
            const supportNum = facts.support;
            const hasCorrectSupport = numbers.some(n => Math.abs(n - supportNum) <= 0.05 || (supportNum > 0 && Math.abs(n - supportNum) / supportNum <= 0.02));
            const nonGenericNumbers = numbers.filter(n => n !== 1 && n !== 2 && n !== 3 && !isExemptNumber(n));
            if (nonGenericNumbers.length > 0 && !hasCorrectSupport) {
                errors.push(`تضارب في قيمة الدعم لسهم ${activeSymbol}: القيمة الفعلية هي ${supportNum} ولكن الرد يحتوي على قيم مختلفة.`);
            }
        }
        
        // 3. Resistance Check
        if (/(?:مقاومة|مقاومه|مستوى المقاومة|المقاومة)/i.test(sentence) && facts.resistance != null) {
            const resistanceNum = facts.resistance;
            const hasCorrectResistance = numbers.some(n => Math.abs(n - resistanceNum) <= 0.05 || (resistanceNum > 0 && Math.abs(n - resistanceNum) / resistanceNum <= 0.02));
            const nonGenericNumbers = numbers.filter(n => n !== 1 && n !== 2 && n !== 3 && !isExemptNumber(n));
            if (nonGenericNumbers.length > 0 && !hasCorrectResistance) {
                errors.push(`تضارب في قيمة المقاومة لسهم ${activeSymbol}: القيمة الفعلية هي ${resistanceNum} ولكن الرد يحتوي على قيم مختلفة.`);
            }
        }

        // 4. Price Check
        if (/(?:سعر|إغلاق|اغلاق|السعر)/i.test(sentence) && facts.price != null && !/(?:أعلى|اعلى|أقصى|اقصى|أدنى|ادنى)/i.test(sentence)) {
            const priceNum = facts.price;
            const hasCorrectPrice = numbers.some(n => Math.abs(n - priceNum) <= 0.05 || (priceNum > 0 && Math.abs(n - priceNum) / priceNum <= 0.02));
            const nonGenericNumbers = numbers.filter(n => n !== 1 && n !== 2 && n !== 3 && !isExemptNumber(n));
            if (nonGenericNumbers.length > 0 && !hasCorrectPrice) {
                errors.push(`تضارب في سعر سهم ${activeSymbol}: السعر الفعلي هو ${priceNum} ولكن الرد يحتوي على قيم مختلفة.`);
            }
        }
    }
    
    return errors;
}

/**
 * Validates the generated assistant response against the raw context data.
 */
export function validateResponse(
    replyText: string,
    liveDataString: string,
    validSymbols: string[],
    toolResults: any[] = []
): ValidationResult {
    const replySymbols = extractSymbols(replyText);
    const replyNumbers = extractNumbers(replyText);

    const sourceSymbols = extractSymbols(liveDataString);
    const sourceNumbers = extractNumbers(liveDataString);

    // 1. Verify Symbols: Any uppercase symbol mentioned in reply must either:
    //    - exist in the source data
    //    - or be a valid EGX symbol from DB
    //    If it's not a valid symbol in the DB, it's a hallucination!
    const suspiciousSymbols = replySymbols.filter(sym => {
        const inSource = sourceSymbols.includes(sym);
        const inDb = validSymbols.includes(sym);
        return !inSource && !inDb;
    });

    // 2. Verify Numbers: Any number mentioned in the reply must either:
    //    - be a standard allowed number (0-10, years, parameters)
    //    - exist in the source data (with fuzzy/rounding tolerance)
    const suspiciousNumbers: string[] = [];
    const factsBySymbol = buildFactsBySymbol(toolResults);

    for (const num of replyNumbers) {
        if (ALLOWED_GENERIC_NUMBERS.has(num)) {
            continue;
        }

        // Fuzzy match: check if the number is close to any number in the source data
        let isMatched = false;
        for (const srcNum of sourceNumbers) {
            // Absolute difference tolerance (e.g., 0.05) or relative tolerance (e.g., 1%)
            const absDiff = Math.abs(num - srcNum);
            const relDiff = srcNum > 0 ? absDiff / srcNum : absDiff;
            
            if (absDiff <= 0.05 || relDiff <= 0.01) {
                isMatched = true;
                break;
            }
        }

        if (!isMatched) {
            // Check if it's part of dates in the source text (sometimes dates are formatted differently)
            const numStr = String(num);
            if (liveDataString.includes(numStr)) {
                isMatched = true;
            }
        }

        if (!isMatched) {
            // A proposed level inside a symbol's known support..resistance band is a
            // plausible analyst suggestion (target/stop), not fabricated data.
            for (const sym of Object.keys(factsBySymbol)) {
                const f = factsBySymbol[sym];
                const levels = [f.price, f.support, f.resistance]
                    .filter((v: any) => typeof v === "number" && Number.isFinite(v));
                if (levels.length === 0) continue;
                const lo = Math.min(...levels);
                const hi = Math.max(...levels);
                if (num >= lo && num <= hi) { isMatched = true; break; }
            }
        }

        if (!isMatched) {
            suspiciousNumbers.push(String(num));
        }
    }

    const hasRepetitions = hasExcessiveRepetitions(replyText);
    const deterministicErrors = validateDeterministicRules(replyText, toolResults);

    // 🧠 English chain-of-thought leak guard: some free-tier upstream providers
    // merge their reasoning into content. A user-facing reply must be an
    // Arabic-dominant answer, not English thinking notes.
    const arabicChars = (replyText.match(/[\u0600-\u06FF]/g) || []).length;
    const asciiLetters = (replyText.match(/[A-Za-z]/g) || []).length;
    const hasCotMarkers = /The user is asking|Technical analysis perspective|Historical Data \(Sector|Analysis for|Gainers list matches|Let me (think|analyze|check|look|review)|I need to (check|analyze|look|find|compare)|thinking process|The question (is|asks)/i.test(replyText);
    // A usable reply is Arabic-dominant overall; English-heavy output means
    // leaked reasoning or an English data dump, not an answer for the user.
    const englishThinking = arabicChars < 40 || asciiLetters > arabicChars || (hasCotMarkers && asciiLetters * 2 > arabicChars);

    return {
        isValid: suspiciousSymbols.length === 0 && suspiciousNumbers.length === 0 && !hasRepetitions && deterministicErrors.length === 0 && !englishThinking,
        suspiciousSymbols,
        suspiciousNumbers,
        hasRepetitions,
        deterministicErrors,
        englishThinking
    };
}

/**
 * Detects if there are lines or phrases repeated too many times.
 */
export function hasExcessiveRepetitions(text: string): boolean {
    const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 10);
    const counts = new Map<string, number>();
    for (const line of lines) {
        // Strip out non-alphabetic/numeric helper chars to normalize comparisons
        const normalized = line.replace(/[^\w\s\u0621-\u064a]/g, "").replace(/\s+/g, " ");
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
        if ((counts.get(normalized) || 0) > 2) {
            return true; // A line repeated 3 or more times is excessive!
        }
    }
    return false;
}
