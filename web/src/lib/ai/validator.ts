export interface ValidationResult {
    isValid: boolean;
    suspiciousSymbols: string[];
    suspiciousNumbers: string[];
}

// Common technical terms that should not be flagged as stock symbols
const TECHNICAL_EXCLUSIONS = new Set([
    "RSI", "MACD", "OBV", "ADX", "EMA", "SMA", "EGX", "EGX30", "EGX70", "EGX100", 
    "BUY", "SELL", "HOLD", "USD", "EGP", "API", "AI", "Wyckoff", "Volume"
]);

// Numbers that are universally allowed (dates, standard parameters, index markers, etc.)
const ALLOWED_GENERIC_NUMBERS = new Set([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    14, 20, 25, 30, 40, 45, 49, 50, 55, 60, 65, 68, 70, 75, 80, 100, 150, 250, 320, 500, 1000, 1500,
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
 * Validates the generated assistant response against the raw context data.
 */
export function validateResponse(
    replyText: string,
    liveDataString: string,
    validSymbols: string[]
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
            suspiciousNumbers.push(String(num));
        }
    }

    return {
        isValid: suspiciousSymbols.length === 0 && suspiciousNumbers.length === 0,
        suspiciousSymbols,
        suspiciousNumbers
    };
}
