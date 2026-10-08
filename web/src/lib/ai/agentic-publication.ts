import { checkAttribution } from "./answer-gate";
import { buildFactRecords, FactRecord } from "./facts";
import { ToolResult } from "./types";

export interface AgenticEvidence {
    tool: string;
    arguments: Record<string, any>;
    data: any;
    source: string;
    data_time: string | null;
    symbols: string[];
    availability: "available" | "missing" | "partial" | "error";
    data_type: "historical";
}

export function evidenceRows(data: any): any[] {
    if (!data || typeof data !== "object") return [];
    const rows = ["stocks", "levels", "positions", "recommendations", "comparison", "accumulation_stocks", "top_gainers", "top_losers", "news"]
        .flatMap(key => Array.isArray(data[key]) ? data[key] : []);
    if (data.symbol) rows.push(data);
    return rows;
}

export function toAgenticEvidence(tool: string, args: any, data: any): AgenticEvidence {
    const rows = evidenceRows(data);
    const symbols = [...new Set<string>(rows.map(r => r.symbol).filter(Boolean))];
    // A scan's output symbols (not its empty input) are the ordered reference for follow-ups.
    const dates = [...new Set<string>(rows.map(r => r.date || r.scan_date || r.current_date || r.signal_date || r.published_at).filter(Boolean))];
    const missing = rows.some(r => r.error || r.availability === "missing");
    return { tool, arguments: args, data, source: "supabase:" + ({ get_stock: "stock_technical_indicators+stocks+stock_scans_summary", get_stock_levels: "stock_prices",
        manage_portfolio: "positions+stock_technical_indicators", get_market: "market_cache+stock_technical_indicators", get_news: "news+stocks",
        get_recommendations: "scan_results+stock_technical_indicators", get_accumulation_stocks: "stock_scans_summary", get_comparison: "stock_technical_indicators",
        get_technical_scan: args.preset === "smart_money_flow" ? "stock_scans_summary" : "stock_technical_indicators" } as any)[tool],
        data_time: dates.length === 1 ? dates[0] : data?.date || data?.session_date || null, symbols,
        availability: data?.status === "error" ? "error" : data?.availability === "missing" || (!rows.length && !data?.egx30?.close && !data?.persisted)
            ? "missing" : missing || data?.valuation_complete === false || data?.truncated ? "partial" : "available", data_type: "historical" };
}

export function agenticFacts(evidence: AgenticEvidence[]): FactRecord[] {
    const adapted: ToolResult[] = evidence.filter(e => e.availability !== "error").map(e => ({ tool: e.tool, source: e.source, symbols: e.symbols,
        data_type: e.data_type, data_time: e.data_time || "", data: evidenceRows(e.data).map(row => ({ ...row,
        vol_ratio: row.relative_volume ?? row.r_vol ?? row.vol_ratio,
        acc_score: row.accumulation_score ?? row.acc_score, dist_score: row.distribution_score ?? row.dist_score,
        target_price: row.take_profit_1 ?? row.target_price, profit_pct: row.profit_loss_pct ?? row.realized_return_pct ?? row.unrealized_return_pct,
        cost_basis: row.cost, profit_value: row.profit_loss_val,
        close: row.close ?? row.current_price, price: row.current_price ?? row.close,
        macd_hist: row.macd_hist ?? row.macd_histogram,
        rsi: row.rsi ?? row.rsi_14,
        king_ai_score: row.king_ai ?? row.king_ai_score,
        egx_ai_score: row.egx_ai ?? row.egx_ai_score,
        bollinger_upper: row.bollinger_upper ?? row.bb_upper,
        bollinger_lower: row.bollinger_lower ?? row.bb_lower,
    })) }));
    const facts = buildFactRecords(adapted);
    for (const e of evidence) {
        for (const row of evidenceRows(e.data)) {
            // Different calculated targets remain separate supported observations.
            if (row.symbol && Number.isFinite(row.take_profit_2)) facts.push({ id: `${row.symbol}:target2`, symbol: row.symbol,
                field: "target_price", value: row.take_profit_2, unit: "egp", as_of: row.date ?? null, source: e.source, tool: e.tool, fetched_at: new Date().toISOString() });
            if (row.symbol && typeof row.entry_zone === "string") for (const value of row.entry_zone.match(/\d+(?:\.\d+)?/g) || []) {
                facts.push({ id: `${row.symbol}:entry:${value}`, symbol: row.symbol, field: "entry_price", value: Number(value), unit: "egp",
                    as_of: row.date ?? null, source: e.source, tool: e.tool, fetched_at: new Date().toISOString() });
            }
        }
        if (e.tool === "manage_portfolio" && e.data?.summary) {
            const sum = e.data.summary;
            const meta = { as_of: e.data_time ?? null, source: e.source, tool: e.tool, fetched_at: new Date().toISOString() };
            if (Number.isFinite(sum.total_invested)) facts.push({ id: "PORTFOLIO:total_invested", symbol: "PORTFOLIO", field: "cost_basis", value: sum.total_invested, unit: "egp", ...meta });
            if (Number.isFinite(sum.total_market_value)) facts.push({ id: "PORTFOLIO:total_market_value", symbol: "PORTFOLIO", field: "market_value", value: sum.total_market_value, unit: "egp", ...meta });
            if (Number.isFinite(sum.unrealized_pl_val)) facts.push({ id: "PORTFOLIO:unrealized_pl_val", symbol: "PORTFOLIO", field: "profit_value", value: sum.unrealized_pl_val, unit: "egp", ...meta });
            if (Number.isFinite(sum.unrealized_pl_pct)) facts.push({ id: "PORTFOLIO:unrealized_pl_pct", symbol: "PORTFOLIO", field: "profit_pct", value: sum.unrealized_pl_pct, unit: "percent", ...meta });
            if (Number.isFinite(sum.positions_count)) facts.push({ id: "PORTFOLIO:positions_count", symbol: "PORTFOLIO", field: "quantity", value: sum.positions_count, unit: "count", ...meta });
        }
    }
    return facts;
}

function cleanCellText(text: string): string {
    return text
        .replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
        .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
        .replace(/٫/g, ".")
        // 1. Strip full dates FIRST (both YYYY-MM-DD and DD-MM-YYYY) before any dash/number normalization
        .replace(/(?:\b|\D)\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\b|\D)/g, " ")
        .replace(/(?:\b|\D)\d{1,2}[-/.]\d{1,2}[-/.]\d{4}(?:\b|\D)/g, " ")
        // 2. Disambiguate range dashes vs negative values
        .replace(/(?<=\d)\s*[-−–—]\s*(?=\d)/g, " ")
        .replace(/(\d+(?:\.\d+)?)\s*[%٪]?\s*[-−–](?!\s*\d)/g, "-$1")
        .replace(/[−–—]/g, "-")
        .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
        // 3. Strip ordinal targets, rank markers, and indicator parameters
        .replace(/(?:(?:ال)?هدف|(?:ال)?مستهدف|(?:ال)?دعم|(?:ال)?مقاوم[ةه]|(?:ال)?مركز|(?:ال)?ترتيب|(?:ال)?أولوية|(?:ال)?أفضلية|(?:ال)?خيار|(?:ال)?مستوى|(?:ال)?فئ[ةه]|target|tp|t|rank)\s*\(?\s*[1-9]\s*\)?/gi, " ")
        .replace(/\b(?:RSI|EMA|SMA|BB|MACD|ATR|STOCH)\s*[-_]?\s*(?:\(\s*\d+(?:[\s,]+\d+)*\s*\)|\d+)/gi, " ")
        .replace(/(?:مؤشر\s*(?:القوة\s*النسبية)?|فترة|إعداد)\s*\(?\s*14\s*\)?/gi, " ")
        .replace(/(?:(?:ال)?متوسط(?:\s*(?:ال)?متحرك)?|(?:ال)?موفينج(?:\s*(?:ال)?أفريج)?|EMA|SMA)\s*\(?\s*(?:14|20|50|100|200)\s*\)?(?:\s*يوم)?/gi, " ")
        .replace(/(?:فوق|تحت|أعلى\s*من|أسفل\s*من|مخترق|كسر)\s*(?:(?:ال)?متوسط(?:\s*(?:ال)?متحرك)?|(?:ال)?موفينج(?:\s*(?:ال)?أفريج)?|EMA|SMA)?\s*(?:14|20|50|100|200)/gi, " ")
        .replace(/\b(?:14|20|50|100|200)\s*يوماً?\b/gi, " ")
        .replace(/\b(?:RSI|EMA|SMA|BB|MACD|ATR|STOCH)\b/gi, " ");
}

/** This validates output evidence/protocol only. It never routes user intent. */
export function checkAgenticDraft(reply: string, evidence: AgenticEvidence[]): string[] {
    const reasons: string[] = [];
    if (!reply.trim()) reasons.push("empty_response");
    if (/DSML|<\/?tool_call|<\/?function_call/i.test(reply)) reasons.push("internal_tool_protocol_in_response");
    const facts = agenticFacts(evidence);
    reasons.push(...checkAttribution(reply, facts));
    // Check numbers in markdown rows against the named stock, including rows with no currency unit.
    const allSymbols = [...new Set(evidence.flatMap(e => e.symbols))];
    const portfolioFacts = facts.filter(f => f.symbol === "PORTFOLIO" || !f.symbol);
    let currentSymbol: string | null = allSymbols.length === 1 ? allSymbols[0] : null;
    let rankColIdx: number = -1;
    let inTable = false;
    let tableHadStockRow = false;
    let tableColSymbols: Array<string | null> = [];
    let isComparisonTable = false;

    const matchesFact = (val: number, targetFacts: FactRecord[]): boolean => {
        // Standard indicator parameter periods (RSI-14, MA-20, MA-50, MA-100, MA-200) are standard metric parameters, not prices
        if (val === 14 || val === 20 || val === 50 || val === 100 || val === 200) {
            return true;
        }
        const candidateFacts = [...targetFacts, ...portfolioFacts.filter(f => f.field === "quantity")];
        return candidateFacts.some(f => {
            const tol = Math.max(0.02, Math.abs(f.value) * 0.005);
            if (Math.abs(val - f.value) <= tol) return true;
            // If the recorded fact is negative (e.g. loss or drop), reporting the positive magnitude is standard in financial tables/prose.
            if (f.value < 0 && Math.abs(val - Math.abs(f.value)) <= tol) return true;
            return false;
        });
    };

    for (const rawLine of reply.split("\n")) {
        const line = rawLine.trim();
        const lineSymbols = allSymbols.filter(s => new RegExp(`\\b${s}\\b`, "i").test(line));
        const lineSymbol = lineSymbols.length === 1 ? lineSymbols[0] : null;
        if (lineSymbol) {
            currentSymbol = lineSymbol;
        } else if (lineSymbols.length > 1) {
            currentSymbol = null;
        }

        if (!line.startsWith("|")) {
            inTable = false;
            tableHadStockRow = false;
            tableColSymbols = [];
            isComparisonTable = false;
            if (!line.startsWith("#") && allSymbols.length > 1) {
                currentSymbol = null;
            }
            rankColIdx = -1;
            continue;
        }

        const isNewTable = !inTable;
        if (!inTable) {
            inTable = true;
            tableHadStockRow = false;
            tableColSymbols = [];
            isComparisonTable = false;
        }

        if (/^\|[\s\-:|]+\|$/.test(line)) continue;

        const cells = line.split("|").slice(1, -1).map(c => c.trim());

        if (cells.some(c => /ترتيب|مركز|أولوية|تصنيف|أفضلية|^#$|^م$|^ت$|رقم|rank|tier|category/i.test(c))) {
            rankColIdx = cells.findIndex(c => /ترتيب|مركز|أولوية|تصنيف|أفضلية|^#$|^م$|^ت$|رقم|rank|tier|category/i.test(c));
            continue;
        }

        // Detect comparison table where multiple columns are stock symbols (e.g. | وجه المقارنة | COMI | EAST |)
        if (isNewTable || tableColSymbols.length === 0) {
            const detectedCols = cells.map(cell => allSymbols.find(s => new RegExp(`\\b${s}\\b`, "i").test(cell)) || null);
            if (detectedCols.filter(Boolean).length >= 2) {
                isComparisonTable = true;
                tableColSymbols = detectedCols;
                continue;
            }
        }

        if (isComparisonTable) {
            for (let colIdx = 0; colIdx < cells.length; colIdx++) {
                const colSymbol = tableColSymbols[colIdx];
                if (!colSymbol) continue;
                const cell = cells[colIdx];
                if (!/\d/.test(cell)) continue;
                if (/^(?:[#№]?\s*\d{1,2}\.?|\(?\s*\d{1,2}\s*\)?|\*\*\d{1,2}\*\*|🥇|🥈|🥉|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣|🔟)$/.test(cell.replace(/[*_#]/g, "").trim())) continue;
                const clean = cleanCellText(cell);
                const matches = [...clean.matchAll(/[-+]?\d+(?:\.\d+)?/g)];
                const targetFacts = facts.filter(f => f.symbol === colSymbol || (f.symbol && allSymbols.includes(f.symbol)));
                for (const match of matches) {
                    const n = Number(match[0]);
                    if (!matchesFact(n, targetFacts)) {
                        reasons.push(`table_value_not_grounded:${colSymbol}:${n}`);
                    }
                }
            }
            continue;
        }

        if (!cells.some(c => /\d/.test(c))) continue;

        const isSummaryRow = cells.some(c => /^(?:(?:ال)?إجمالي|(?:ال)?مجموع|(?:ال)?محفظ[ةه]|(?:إجمالي|مجموع)\s*(?:ال)?محفظ[ةه]|(?:ال)?كلي|عدد\s*(?:المراكز|الأسهم|الصفقات)|المراكز(?:\s*المفتوحة)?|total|summary|overall)$/i.test(c.replace(/[*_#]/g, "").trim()));

        if (lineSymbols.length > 0) {
            tableHadStockRow = true;
        }

        let symbol: string | null = null;
        if (isSummaryRow) {
            symbol = "PORTFOLIO";
        } else if (lineSymbols.length === 1) {
            symbol = lineSymbols[0];
        } else if (lineSymbols.length > 1) {
            symbol = lineSymbols.join("/");
        } else if (!tableHadStockRow) {
            symbol = currentSymbol;
        } else {
            symbol = null;
        }

        if (!symbol) continue;

        const filteredCells = cells.filter((cell, idx) => {
            if (idx === rankColIdx) return false;
            if (/^(?:[#№]?\s*\d{1,2}\.?|\(?\s*\d{1,2}\s*\)?|\*\*\d{1,2}\*\*|🥇|🥈|🥉|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣|🔟)$/.test(cell.replace(/[*_#]/g, "").trim())) return false;
            return true;
        });

        const clean = cleanCellText(filteredCells.join(" | "));
        const matches = [...clean.matchAll(/[-+]?\d+(?:\.\d+)?/g)];
        if (!matches.length) continue;

        const targetFacts = symbol === "PORTFOLIO"
            ? (portfolioFacts.length ? portfolioFacts : facts)
            : lineSymbols.length > 1
                ? facts.filter(f => f.symbol && lineSymbols.includes(f.symbol))
                : facts.filter(f => f.symbol === symbol);

        for (const match of matches) {
            const n = Number(match[0]);
            if (!matchesFact(n, targetFacts)) {
                reasons.push(`table_value_not_grounded:${symbol}:${n}`);
            }
        }
    }
    return [...new Set(reasons)];
}

export function safeAgenticFallback(evidence: AgenticEvidence[], reason: string): string {
    const lines = ["تعذر إكمال إجابة متحقَّق منها لكل أجزاء طلبك. " + reason];
    const rows = evidence.filter(e => e.availability !== "error").flatMap(e => evidenceRows(e.data));
    const quotes = new Map<string, any>();
    for (const row of rows) if (row.symbol && (row.close != null || row.current_price != null)) quotes.set(row.symbol, row);
    if (quotes.size) {
        lines.push("\nالبيانات المتاحة من المصدر (إغلاقات يومية، وليست أسعاراً لحظية):", "| السهم | الإغلاق | التاريخ |", "|---|---|---|");
        for (const row of [...quotes.values()].slice(0, 10)) lines.push(`| ${row.symbol} | ${row.close ?? row.current_price} | ${row.date ?? row.current_date ?? "غير متاح"} |`);
    }
    for (const e of evidence) if (e.data?.persisted === true) lines.push(`عملية المحفظة ${e.data.operation} للسهم ${e.data.symbol}: تم تأكيد تعديل المركز؛ لا تكرر العملية تلقائياً.${e.data.cash_updated === false && e.data.operation === "sell" ? " لم يتغير الرصيد النقدي." : ""}`);
    if (evidence.some(e => e.availability === "error")) lines.push("تعذر تنفيذ بعض أدوات البيانات؛ لا تعتبر نتائجها فارغة أو عملياتها محفوظة.");
    if (evidence.some(e => e.availability === "missing" || e.availability === "partial")) lines.push("بعض البيانات المطلوبة غير متاحة أو غير مكتملة في المصدر.");
    return lines.join("\n");
}
