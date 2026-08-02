import { AI_CONFIG } from "./config";
import { parseToolsOutput, buildStockTable, isSuspiciousValue } from "./table-builder";

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

                if (currentSection === "rsi" && rawVal && rawVal.length <= 25) stock.rsi = rawVal;
                else if (currentSection === "macd" && rawVal && rawVal.length <= 25) stock.macd = rawVal;
                else if (currentSection === "signal" && rawVal && rawVal.length <= 25) stock.signal = rawVal;
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

export function sanitizeUiLabel(text: string): string {
    const markerIndex = text.toLowerCase().indexOf("environment_details");
    if (markerIndex >= 0) text = text.slice(0, markerIndex).replace(/<\s*$/g, "");
    const clean = text
        .replace(/<\s*environment_details[^>]*>[\s\S]*$/gi, "")
        .replace(/<\s*environment_details[\s\S]*$/gi, "")
        .replace(/<\s*environment_details\s*>[\s\S]*?(?:<\s*\/\s*environment_details\s*>|$)/gi, "")
        .replace(/environment_details[\s\S]*$/gi, "")
        .replace(/Current time:\s*[^\n]+/gi, "")
        .replace(/Working directory:\s*[^\n]+/gi, "")
        .replace(/Workspace root folder:\s*[^\n]+/gi, "")
        .replace(/<\s*environment_details[\s\S]*$/gi, "")
        .replace(/environment_details[\s\S]*$/gi, "")
        .replace(/شير في المدونة\s*$/gim, "")
        .replace(/\s*✅\s*تحليل EGX Bots مبني على بيانات حية[^\n]*/gi, "")
        .trim();
    return /environment_details|Current time:|Working directory:|Workspace root folder:/i.test(clean) ? "" : clean;
}

export function stripEnvironmentLeak(text: string): string {
    const marker = text.search(/<?\s*environment_details|Current time:|Working directory:|Workspace root folder:/i);
    return (marker >= 0 ? text.slice(0, marker) : text).replace(/<\s*$/g, "").trim();
}

export function sanitizeReply(reply: string, liveDataString?: string): string {
  try {
    let cleanReply = typeof reply === "string" ? stripEnvironmentLeak(sanitizeUiLabel(reply)).trim() : "";

    // 1. Clean raw Python array/dict repr if model echoed input payload structure
    if (cleanReply.startsWith("[{'type'") || cleanReply.startsWith('[{"type"')) {
        cleanReply = cleanReply
            .replace(/^\[\s*\{['"]type['"]\s*:\s*['"]text['"]\s*,\s*['"]text['"]\s*:\s*['"]/i, "")
            .replace(/['"]\s*\}\s*\]$/i, "")
            .replace(/\\n/g, "\n");
    }

    // Check if we have liveDataString with stock data for programmatic table
    let hasProgrammaticTable = false;
    let programmaticTableText = "";
    if (liveDataString) {
        const parsedData = parseToolsOutput(liveDataString);
        programmaticTableText = buildStockTable(parsedData.stocks);
        if (programmaticTableText && parsedData.stocks.length > 0) {
            hasProgrammaticTable = true;
        }
    }

    // 0. Strip leaked DATABASE DATA markers and environment metadata from LLM output
    cleanReply = cleanReply
        .replace(/=== DATABASE DATA ===/gi, "")
        .replace(/=== END ===/gi, "")
        .replace(/===END===/gi, "")
        .replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, "")
        .replace(/<\s*environment_details\s*>[\s\S]*?(?:<\s*\/\s*environment_details\s*>|$)/gi, "")
        .replace(/\[?\s*environment_details\s*\]?[\s\S]*$/gi, "")
        .replace(/environment_details[\s\S]*$/gi, "")
        .replace(/Current time:\s*[^\n]+/gi, "")
        .replace(/Working directory:\s*[^\n]+/gi, "")
        .replace(/Workspace root folder:\s*[^\n]+/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    if (hasProgrammaticTable) {
        cleanReply = cleanReply
            .replace(/^\|.+(?:\n\|.+\|)*$/gm, "")
            .replace(/^\|[\s\-\|:]+\|$/gm, "")
            .replace(/^#{1,6}\s*.+$/gm, "")
            .replace(/^\s*[\*]{2,}.*[\*]{2,}\s*$/gm, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        cleanReply = cleanReply
            .replace(/^•\s*سهم\s+\w+.*$/gm, "")
            .replace(/^توصية سهم\s+\w+.*$/gm, "")
            .replace(/\b(BUY|SELL|HOLD)\b\s*[:=]\s*.*$/gm, "")
            .replace(/^(مؤشر EGX30|مؤشر EGX100|سعر صرف USD\/EGP|اتجاه السوق).*$/gm, "")
            .replace(/يجب أن يكون المستخدم على دراية.*$/gm, "")
            .replace(/^###?\s*ملحوظة.*$/gm, "")
            .replace(/^.*حالة البورصة والأخبار.*$/gm, "")
            .replace(/من البيانات المتاحة لدي، يمكنني أن أقول لك عن سهم\s*\w+:\s*/gi, "")
            .replace(/السهم يظهر زيادة كبيرة في السوق اليوم\./g, "")
            .replace(/نسبة السيولة عالية جداً\./g, "")
            .replace(/RSI \(14\) يظهر قيمة عالية جداً\./g, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        // If after stripping the table the reply is mostly empty, just use the analysis part
        if (cleanReply.replace(/\s/g, "").length < 10) {
            cleanReply = "تحليل فني.";
        }

        // Build the final output: programmatic table + analysis

        // 🛡️ Numerical Safety Net: scan analysis text for suspicious numbers
        const lines = cleanReply.split("\n");
        for (const line of lines) {
            // Check for suspicious prices in analysis text
            const priceCandidates = line.match(/(?:(?:جنيه|ج\.م|EGP)\s*[:=]?\s*|سعر\s*[:=]?\s*)([0-9,]+(?:\.[0-9]+)?)/gi);
            if (priceCandidates) {
                for (const match of priceCandidates) {
                    const num = match.replace(/[^0-9.]/g, "");
                    if (isSuspiciousValue(num, "price")) {
                        // Replace suspicious price with "—" 
                        cleanReply = cleanReply.replace(match, match.replace(/[0-9,]+(?:\.[0-9]+)?/, "—"));
                    }
                }
            }
            // Check RSI values in analysis
            const rsiCandidates = line.match(/RSI\s*[:=]?\s*([0-9.]+)/gi);
            if (rsiCandidates) {
                for (const match of rsiCandidates) {
                    const num = match.replace(/[^0-9.]/g, "");
                    if (isSuspiciousValue(num, "rsi")) {
                        cleanReply = cleanReply.replace(match, match.replace(/[0-9.]+/, "—"));
                    }
                }
            }
        }
    } else if (!hasStructuredMarkdownTable(cleanReply)) {
        // 2. Automatically transform bullet stock items into a Markdown Table if LLM outputted bullets
        cleanReply = convertStockBulletsToTable(cleanReply);
    }

    cleanReply = cleanReply
        .replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, "")
        .replace(/<\s*environment_details\s*>[\s\S]*?(?:<\s*\/\s*environment_details\s*>|$)/gi, "")
        .replace(/\[?\s*environment_details\s*\]?[\s\S]*$/gi, "")
        .replace(/environment_details[\s\S]*$/gi, "")
        .replace(/Current time:\s*[^\n]+/gi, "")
        .replace(/Working directory:\s*[^\n]+/gi, "")
        .replace(/Workspace root folder:\s*[^\n]+/gi, "")
        .trim();

    // 🛡️ Post-processing safety: detect and remove tables with ALL empty/dash values
    // (indicates LLM generated a table but had no real data)
    const dashTableRegex = /^\|.+\|[\s\-]*\-[\s\-]*\|[\s\-]*\-[\s\-]*\|[\s\-]*\-[\s\-]*\|[\s\-]*\-[\s\-]*\|[\s\-]*\-[\s\-]*\|.+\|$/gm;
    if (dashTableRegex.test(cleanReply)) {
      cleanReply = cleanReply
        .replace(/^\|.+\|[\s\S]*?(?=\n\n|$)/m, "")
        .replace(/\|[\s\-\|:]+\|/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    // 🚨 CRITICAL: Remove any leaked system prompt text from LLM output
    // The LLM sometimes regurgitates the system prompt verbatim
    const systemPromptPatterns = [
      /أنا EGX Bots AI Assistant for the Egyptian Stock Exchange/g,
      /🚨 ZERO HALLUCINATION POLICY/g,
      /🚨 GLOBAL ZERO DISCLAIMER POLICY/g,
      /EXPERT EGX ANALYSIS RULES/g,
      /Use ONLY provided data/g,
      /INSTRUCTIONS \([^)]+\):/g,
      /AUTO-GENERATED STOCK TABLE/g,
      /THE TABLE ABOVE IS ALREADY CORRECT AND COMPLETE/g,
      /DO NOT output any table/g,
      /Write ONLY the analysis section/g,
    ];
    for (const pattern of systemPromptPatterns) {
      if (pattern.test(cleanReply)) {
        cleanReply = cleanReply
          .replace(pattern, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
    }

    // 🚨 Remove leaked instructions from the response
    // If the LLM outputs instructions like "1. Write a brief **تحليل السيولة الفنية**", strip them
    cleanReply = cleanReply
      .replace(/^\d+\.\s+Write a brief.*$/gm, "")
      .replace(/^\d+\.\s+🔒.*$/gm, "")
      .replace(/^- Use ONLY the exact company name.*$/gm, "")
      .replace(/^- NEVER mix up company names.*$/gm, "")
      .replace(/^\*\*النهاية\*\*.*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // 🚨 Remove garbled non-table lines that look like "BIOC  محايد  SIDEWAYS  محايد ⚪  STOCK  تجميع |"
    // These are malformed table rows without proper markdown table pipes
    cleanReply = cleanReply
      .replace(/^[A-Z]{2,6}\s+[^|]+?\s+\|[^\n]*$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // 🚨 Anti-repetition block detection: if a block of 3+ lines repeats 3+ times, truncate
    const cleanLinesArr = cleanReply.split("\n").map(l => l.trim()).filter(l => l.length > 20);
    if (cleanLinesArr.length > 10) {
      // Check for identical repeating blocks (e.g. the same 5 lines repeated)
      const seenBlocks = new Map<string, number>();
      for (let i = 0; i < cleanLinesArr.length; i++) {
        const blockKey = cleanLinesArr.slice(i, Math.min(i + 3, cleanLinesArr.length)).join("|");
        if (blockKey.length > 30) {
          const count = (seenBlocks.get(blockKey) || 0) + 1;
          if (count >= 3) {
            // Truncate at the start of the repetition
            const truncated = cleanReply.split("\n").slice(0, i + 3).join("\n");
            cleanReply = truncated;
            break;
          }
          seenBlocks.set(blockKey, count);
        }
      }
    }

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
    cleanReply += `\n\n${AI_CONFIG.disclaimer}`;

    return cleanReply;
  } catch (sanitizeError) {
    console.warn("[sanitizer] sanitizeReply error:", sanitizeError);
    // Return original reply with disclaimer as fallback
    const safeReply = typeof reply === "string" ? reply : "تحليل فني.";
    return safeReply + `\n\n${AI_CONFIG.disclaimer}`;
  }
}

function hasStructuredMarkdownTable(text: string): boolean {
  return /^\|[^\n]+\|\s*\r?\n\|\s*:?-{3,}/m.test(text);
}
