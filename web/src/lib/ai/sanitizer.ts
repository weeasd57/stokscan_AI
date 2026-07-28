import { AI_CONFIG } from "./config";

export function convertStockBulletsToTable(replyText: string): string {
    const isDummyTable = replyText.includes("| - |") || replyText.includes("|-|") || replyText.includes("تحليل السهم") || replyText.includes("| -");
    if (!isDummyTable && (replyText.includes("| السهم |") || replyText.includes("|السهم|"))) {
        return replyText;
    }

    let cleanReply = replyText;
    if (isDummyTable) {
        const lines = cleanReply.split("\n");
        const nonTableLines = lines.filter(l => !l.trim().startsWith("|") || l.includes("السعر اللحظي"));
        cleanReply = nonTableLines.filter(l => !l.trim().startsWith("|")).join("\n");
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

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.includes("RSI")) {
            currentSection = "rsi";
            continue;
        } else if (trimmed.includes("MACD")) {
            currentSection = "macd";
            continue;
        } else if (trimmed.includes("إشارة السيولة") || (trimmed.includes("إشارة") && !trimmed.includes("MACD"))) {
            currentSection = "signal";
            continue;
        } else if (trimmed.includes("تغير") || trimmed.includes("أعلى") || trimmed.includes("أقل")) {
            currentSection = "change";
            continue;
        }

        const tickerMatch = trimmed.match(/\*\*([A-Z0-9_]{2,10})\*\*/i) || trimmed.match(/(?:•|-|\*)\s*(?:%[0-9\.\+\-]+\s*:?\s*)?([A-Z0-9_]{2,10})/i);
        if (tickerMatch) {
            const sym = tickerMatch[1].toUpperCase();
            if (sym !== "NULL" && sym !== "EGX" && sym.length >= 2) {
                const stock = getOrCreateStock(sym);
                const rawVal = trimmed
                    .replace(new RegExp(`\\*\\*${sym}\\*\\*`, "gi"), "")
                    .replace(new RegExp(`${sym}`, "gi"), "")
                    .replace(/^[\*\:\s•\-%+]+|[\*\:\s•\-%+]+$/g, "")
                    .trim();

                if (currentSection === "rsi" && rawVal) stock.rsi = rawVal;
                else if (currentSection === "macd" && rawVal) stock.macd = rawVal;
                else if (currentSection === "signal" && rawVal) stock.signal = rawVal;
                else if (currentSection === "change" && rawVal) stock.change = rawVal;
            }
        }
    }

    let currentStock: any = null;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parenMatch = trimmed.match(/\((?:\s*سهم\s+)?([A-Z0-9]{2,10})\)/i);
        const wordMatch = trimmed.match(/(?:###?\s*)?([A-Z0-9]{2,10})/);
        const headerSymbol = parenMatch ? parenMatch[1] : (wordMatch && !trimmed.includes("RSI") && !trimmed.includes("MACD") ? wordMatch[1] : null);

        const isHeader = (trimmed.startsWith("**") && trimmed.endsWith("**")) || trimmed.startsWith("###") || trimmed.startsWith("##");

        if (isHeader && headerSymbol && headerSymbol !== "NULL" && headerSymbol !== "EGX") {
            currentStock = getOrCreateStock(headerSymbol.toUpperCase());
            continue;
        }

        if (currentStock) {
            if (trimmed.includes("السعر اللحظي:") || trimmed.includes("السعر:")) {
                currentStock.price = trimmed.split(/السعر(?: اللحظي)?:/)[1]?.trim().replace(/^[\*\:\s•\-]+/, "") || "-";
            } else if (trimmed.includes("التغير اليومي:") || trimmed.includes("التغير:")) {
                currentStock.change = trimmed.split(/التغير(?: اليومي)?:/)[1]?.trim().replace(/^[\*\:\s•\-]+/, "") || "-";
            } else if (trimmed.includes("نسبة السيولة:") || trimmed.includes("نسبة الحجم:")) {
                currentStock.volRatio = trimmed.split(/نسبة (?:السيولة|الحجم):/)[1]?.trim().replace(/^[\*\:\s•\-]+/, "") || "-";
            } else if (trimmed.includes("RSI")) {
                currentStock.rsi = trimmed.split(/RSI\s*(?:\(14\))?:/)[1]?.trim().replace(/^[\*\:\s•\-]+/, "") || "-";
            } else if (trimmed.includes("MACD")) {
                currentStock.macd = trimmed.split(/إشارة MACD:|MACD:/)[1]?.trim().replace(/^[\*\:\s•\-]+/, "") || "-";
            } else if (trimmed.includes("إشارة السيولة:") || trimmed.includes("الإشارة:")) {
                currentStock.signal = trimmed.split(/إشارة (?:السيولة|تصريف\/تجميع):|الإشارة:/)[1]?.trim().replace(/^[\*\:\s•\-]+/, "") || "محايد ⚪";
            }
        }
    }

    const validItems = Array.from(stockItemsMap.values()).filter(s => s.symbol && s.symbol !== "NULL" && s.symbol !== "EGX" && s.symbol.length >= 2);
    if (validItems.length === 0) return replyText;

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

    // 3. Anti-Repetition Loop Sanitizer (Collapses duplicate header/line loops)
    const lines = cleanReply.split("\n");
    const cleanLines: string[] = [];
    const lineCountMap = new Map<string, number>();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            cleanLines.push(line);
            continue;
        }
        // Table markup divider lines (e.g. |---|---|) should be preserved
        if (/^\|[\s\-\|]+\|$/.test(trimmed)) {
            cleanLines.push(line);
            continue;
        }
        const key = trimmed.replace(/[\*\_\:\-\s]/g, "");
        const count = lineCountMap.get(key) || 0;
        if (count < 2) {
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
