import { AI_CONFIG } from "./config";

export function convertStockBulletsToTable(replyText: string): string {
    if (replyText.includes("| -") || replyText.includes("| السهم |") || replyText.includes("|السهم|")) {
        return replyText;
    }

    if (!replyText.includes("السعر اللحظي") && !replyText.includes("التغير")) {
        return replyText;
    }

    const lines = replyText.split("\n");
    const stockItems: { symbol: string; price: string; change: string; volRatio: string; rsi: string; macd: string; signal: string }[] = [];
    let currentStock: any = null;

    const getSymbolFromLine = (line: string): string | null => {
        const parenMatch = line.match(/\((?:\s*سهم\s+)?([A-Z0-9]{2,10})\)/i);
        if (parenMatch) return parenMatch[1].trim();

        const wordMatch = line.match(/(?:###?\s*)?([A-Z0-9]{2,10})/);
        if (wordMatch && !line.includes("RSI") && !line.includes("MACD") && !line.includes("VWAP") && !line.includes("ADX")) {
            return wordMatch[1].trim();
        }

        const arabMatch = line.match(/(?:###?\s*(?:السهم|سهم)?\s*:?\s*)([\u0600-\u06FF\s]{2,20})/);
        if (arabMatch && !line.includes("السعر") && !line.includes("التغير") && !line.includes("السيولة")) {
            return arabMatch[1].trim();
        }

        return null;
    };

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const detectedSymbol = getSymbolFromLine(trimmed);
        const isHeader = (trimmed.startsWith("**") && trimmed.endsWith("**")) || 
                         trimmed.startsWith("###") || 
                         trimmed.startsWith("##") ||
                         (detectedSymbol !== null && !trimmed.includes(":") && !trimmed.includes("•") && !trimmed.includes("-"));

        if (isHeader && detectedSymbol) {
            if (currentStock && currentStock.symbol) {
                stockItems.push(currentStock);
            }
            currentStock = {
                symbol: detectedSymbol,
                price: "-",
                change: "-",
                volRatio: "-",
                rsi: "-",
                macd: "-",
                signal: "محايد ⚪"
            };
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
            } else if (trimmed.includes("إشارة السيولة:") || trimmed.includes("الإشارة:") || trimmed.includes("إشارة تصريف/تجمع:")) {
                currentStock.signal = trimmed.split(/إشارة (?:السيولة|تصريف\/تجميع):|الإشارة:/)[1]?.trim().replace(/^[\*\:\s•\-]+/, "") || "محايد ⚪";
            }
        }
    }

    if (currentStock && currentStock.symbol) {
        stockItems.push(currentStock);
    }

    const validItems = stockItems.filter(s => s.symbol && s.symbol !== "NULL" && s.symbol.length >= 2);
    if (validItems.length === 0) return replyText;

    const tableRows = validItems.map(s => `| ${s.symbol} | ${s.price} | ${s.change} | ${s.volRatio} | ${s.rsi} | ${s.macd} | ${s.signal} |`);
    const tableMarkdown = `| السهم | السعر اللحظي | التغير اليومي | نسبة السيولة | RSI (14) | إشارة MACD | إشارة السيولة |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n` + tableRows.join("\n");

    return tableMarkdown + "\n\n" + replyText;
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
