import { AI_CONFIG } from "./config";

export function extractTickerFromLine(line: string): string | null {
    const clean = line.replace(/\b(RSI|MACD|VWAP|ADX|NULL|EGX)\b/gi, "");
    const ignoredWords = ["RSI", "MACD", "EGYPT", "CO", "SAE", "INC", "LTD", "EGX30", "EGX70", "EGX100", "30", "70", "100"];

    // Reject pure numbers (e.g. 30, 70, 100)
    const isPureNumber = (s: string) => /^\d+$/.test(s);

    // 1. Match (TICKER) or (سهم TICKER)
    const parenMatch = clean.match(/\(\s*(?:سهم\s+)?([A-Z0-9]{2,10})\s*\)/i);
    if (parenMatch) {
        const sym = parenMatch[1].toUpperCase();
        if (!ignoredWords.includes(sym) && !isPureNumber(sym)) return sym;
    }

    // 2. Match سهم TICKER or سهم الـ TICKER
    const arabMatch = clean.match(/سهم\s+(?:الـ\s*)?([A-Z0-9]{2,10})/i);
    if (arabMatch) {
        const sym = arabMatch[1].toUpperCase();
        if (!ignoredWords.includes(sym)) return sym;
    }

    // 3. Match **TICKER** or **سهم TICKER...**
    const boldMatch = clean.match(/\*\*([A-Z0-9_\s\u0600-\u06FF\(\)\.\,]+)\*\*/i);
    if (boldMatch) {
        const innerText = boldMatch[1];
        const innerTicker = innerText.match(/\b([A-Z0-9]{2,10})\b/);
        if (innerTicker) {
            const sym = innerTicker[1].toUpperCase();
            if (!ignoredWords.includes(sym)) return sym;
        }
    }

    // 4. Standard word boundary match
    const wordMatch = clean.match(/(?:\*\*|__|\b)([A-Z]{2,10})(?:\*\*|__|\b)/);
    if (wordMatch) {
        const sym = wordMatch[1].toUpperCase();
        if (!ignoredWords.includes(sym)) return sym;
    }

    return null;
}

export function convertStockBulletsToTable(replyText: string): string {
    const hasDummyHyphens = /\|[\s\-]*\-[\s\-]*\|/.test(replyText) || replyText.includes("| SIDEWAYS |") || replyText.includes("| - |") || replyText.includes("|-|");
    if (!hasDummyHyphens && (replyText.includes("| السهم |") || replyText.includes("|السهم|"))) {
        return replyText;
    }

    let cleanReply = replyText;
    if (hasDummyHyphens) {
        const lines = cleanReply.split("\n");
        // Remove dummy table header & hyphen rows
        cleanReply = lines.filter(l => {
            const trimmed = l.trim();
            if (!trimmed.startsWith("|")) return true;
            if (trimmed.includes("السهم") && trimmed.includes("السعر")) return false;
            if (/^\|[\s\-\|:]+\|$/.test(trimmed)) return false;
            if (/\|[\s\-]*\-[\s\-]*\|/.test(trimmed) || trimmed.includes("SIDEWAYS") || /^\|\s*\d+\s*\|/.test(trimmed)) return false;
            return true;
        }).join("\n");
    }

    const stockItemsMap = new Map<string, { symbol: string; price: string; change: string; volRatio: string; rsi: string; macd: string; signal: string }>();

    const getOrCreateStock = (sym: string) => {
        if (!stockItemsMap.has(sym)) {
            stockItemsMap.set(sym, {
                symbol: sym,
                price: "-",
                change: "-",
                volRatio: "-",
                rsi: "-",
                macd: "-",
                signal: "محايد ⚪"
            });
        }
        return stockItemsMap.get(sym)!;
    };

    const lines = cleanReply.split("\n");
    let currentSection = "";
    let currentActiveSymbol: string | null = null;

    // Parse lines using extractTickerFromLine
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "•") continue;

        if (trimmed.includes("RSI") && !trimmed.includes("=")) {
            currentSection = "rsi";
            continue;
        } else if (trimmed.includes("MACD") && !trimmed.includes("=")) {
            currentSection = "macd";
            continue;
        } else if ((trimmed.includes("إشارة السيولة") || trimmed.includes("إشارة")) && !trimmed.includes("=") && !trimmed.includes("MACD")) {
            currentSection = "signal";
            continue;
        }

        const sym = extractTickerFromLine(trimmed);
        if (sym && sym !== "NULL" && sym !== "EGX") {
            currentActiveSymbol = sym;
            getOrCreateStock(sym);
        }

        const targetSym = sym || currentActiveSymbol;
        if (targetSym && targetSym !== "NULL" && targetSym !== "EGX") {
            const stock = getOrCreateStock(targetSym);

            const priceMatch = trimmed.match(/السعر(?: اللحظي)?\s*[:=]\s*([0-9\.\,\s]+(?:ج\.م)?)/i);
            const changeMatch = trimmed.match(/التغير\s*[:=]\s*([+\-]?\s*[0-9\.\,]+\s*%)/i);
            const rsiMatch = trimmed.match(/RSI\s*(?:\(14\))?\s*[:=]\s*([0-9\.\,]+)/i);
            const macdMatch = trimmed.match(/MACD\s*[:=]\s*([+\-]?\s*[0-9\.\,]+)/i);
            const ratioMatch = trimmed.match(/نسبة (?:السيولة|الحجم)\s*[:=]\s*([0-9\.\,]+\s*x?)/i);
            const signalMatch = trimmed.match(/الإشارة\s*[:=]\s*([^\,\n\.]+)/i) || trimmed.match(/(تجميع|تصريف|محايد|صعود ضعيف|هبوط ضعيف)/i);

            if (priceMatch && priceMatch[1] && (sym || stock.price === "-")) stock.price = priceMatch[1].trim().replace(/,$/, "");
            if (changeMatch && changeMatch[1] && (sym || stock.change === "-")) stock.change = changeMatch[1].trim().replace(/,$/, "");
            if (ratioMatch && ratioMatch[1] && (sym || stock.volRatio === "-")) stock.volRatio = ratioMatch[1].trim().replace(/,$/, "");
            if (rsiMatch && rsiMatch[1] && (sym || stock.rsi === "-")) stock.rsi = rsiMatch[1].trim().replace(/,$/, "");
            if (macdMatch && macdMatch[1] && (sym || stock.macd === "-")) stock.macd = macdMatch[1].trim().replace(/,$/, "");
            if (signalMatch && signalMatch[1] && (sym || stock.signal === "محايد ⚪")) stock.signal = signalMatch[1].trim().replace(/,$/, "");

            if (!priceMatch && !changeMatch && !rsiMatch && !macdMatch && !ratioMatch && sym) {
                // Section-based fallback
                const rawVal = trimmed
                    .replace(new RegExp(`\\*\\*${sym}\\*\\*`, "gi"), "")
                    .replace(new RegExp(`${sym}`, "gi"), "")
                    .replace(/^[\*\:\s•\-%+]+|[\*\:\s•\-%+]+$/g, "")
                    .trim();

                if (currentSection === "rsi" && rawVal) stock.rsi = rawVal;
                else if (currentSection === "macd" && rawVal) stock.macd = rawVal;
                else if (currentSection === "signal" && rawVal) stock.signal = rawVal;
            }
        }
    }

    const validItems = Array.from(stockItemsMap.values()).filter(s => s.symbol && s.symbol !== "NULL" && s.symbol !== "EGX" && s.symbol.length >= 2);
    if (validItems.length === 0) return replyText;

    // If replyText already has a clean table header, don't prepend another table header
    if (replyText.includes("| السهم |") || replyText.includes("|السهم|")) {
        return replyText;
    }

    const tableRows = validItems.map(s => `| ${s.symbol} | ${s.price} | ${s.change} | ${s.volRatio} | ${s.rsi} | ${s.macd} | ${s.signal} |`);
    const tableMarkdown = `| السهم | السعر اللحظي | التغير اليومي | نسبة السيولة | RSI (14) | إشارة MACD | إشارة السيولة |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n` + tableRows.join("\n");

    return tableMarkdown + "\n\n" + cleanReply;
}

export function sanitizeReply(reply: string): string {
    let cleanReply = reply.trim();

    // 1. Clean raw Python array/dict repr if model echoed input payload structure
    if (cleanReply.startsWith("[{'type'") || cleanReply.startsWith('[{"type"')) {
        cleanReply = cleanReply
            .replace(/^\[\s*\{['"]type['"]\s*:\s*['"]text['"]\s*,\s*['"]text['"]\s*:\s*['"]/i, "")
            .replace(/['"]\s*\}\s*\]$/i, "")
            .replace(/\\n/g, "\n");
    }

    // 2. Automatically transform bullet stock items into a Markdown Table if LLM outputted bullets
    cleanReply = convertStockBulletsToTable(cleanReply);

    // 3. Strict Anti-Repetition Sanitizer (Ensures headers and bullet items appear EXACTLY ONCE)
    const lines = cleanReply.split("\n");
    const cleanLines: string[] = [];
    const lineCountMap = new Map<string, number>();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            cleanLines.push(line);
            continue;
        }
        // Filter out dummy NULL stock lines
        if (trimmed.includes("سهم NULL") || trimmed.includes("(NULL)") || trimmed.includes("سهم null")) {
            continue;
        }
        // Table markup divider lines (e.g. |---|---|) should be preserved
        if (/^\|[\s\-\|]+\|$/.test(trimmed)) {
            cleanLines.push(line);
            continue;
        }
        const key = trimmed.replace(/[\*\_\:\-\s]/g, "").toLowerCase();
        const count = lineCountMap.get(key) || 0;
        
        // Strict 1-occurrence limit for headings (###) and bullet items (• or *)
        const isHeaderOrBullet = trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("•") || trimmed.includes("تحليل السيولة");
        const maxAllowed = isHeaderOrBullet ? 1 : 2;

        if (count < maxAllowed) {
            lineCountMap.set(key, count + 1);
            cleanLines.push(line);
        }
    }
    cleanReply = cleanLines.join("\n").trim();

    // 4. Clean up disclaimer duplicates
    const escapedDisclaimer = AI_CONFIG.disclaimer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const disclaimerRegex = new RegExp(`\\s*${escapedDisclaimer}`, "g");
    cleanReply = cleanReply.replace(disclaimerRegex, "").replace(/\s*✅\s*تحليل EGX Bots مبني على بيانات حية[^\n]*/g, "").trim();
    cleanReply += `\n\n${escapedDisclaimer}`;

    return cleanReply;
}
