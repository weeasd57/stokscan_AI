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
    captured_at?: string;
}

const memoryTools = new Set(["get_stock", "get_stock_levels", "get_market", "get_technical_scan", "get_accumulation_stocks", "get_comparison", "get_news", "get_recommendations"]);
/** Remove duplicate aliases/payload text, without removing source, dates, identity or unknown values. */
export function compactEvidence(record: AgenticEvidence): AgenticEvidence {
    const data = { ...record.data };
    if (data.comparison) delete data.comparisons;
    if (data.stocks) delete data.accumulation_stocks;
    return { ...record, data };
}

export function evidenceMemory(records: AgenticEvidence[], now = new Date()): Array<AgenticEvidence & { captured_at: string }> {
    const dedup = new Map<string, AgenticEvidence & { captured_at: string }>();
    for (const record of records) {
        if (!record || typeof record.source !== "string" || !record.data || typeof record.arguments !== "object") continue;
        if (!memoryTools.has(record.tool) || record.availability === "error" || !record.source.startsWith("supabase:")) continue;
        const captured = record.captured_at || now.toISOString();
        if (!Number.isFinite(Date.parse(captured)) || now.getTime() - Date.parse(captured) > 24 * 3600_000 || Date.parse(captured) > now.getTime() + 60_000) continue;
        dedup.set(record.tool + JSON.stringify(record.arguments), { ...compactEvidence(record), captured_at: captured });
    }
    const result: Array<AgenticEvidence & { captured_at: string }> = [];
    let bytes = 0;
    for (const record of [...dedup.values()].reverse()) {
        const size = JSON.stringify(record).length;
        if (bytes + size > 8000) continue;
        result.unshift(record); bytes += size;
        if (result.length === 6) break;
    }
    return result;
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

/** Metric labels describe generated evidence, never user intent routing. */
function tableMetricFields(label: string): FactRecord["field"][] | undefined {
    const text = label.replace(/[*_]/g, "");
    if (/EMA\s*50/i.test(text) && /EMA\s*200/i.test(text)) return ["ema_50","ema_200"];
    const labels: Array<[RegExp, FactRecord["field"][]]> = [
        [/RSI|القوة النسبية/i,["rsi"]], [/هيست|hist/i,["macd_hist"]], [/MACD.*(?:signal|إشار|اشار)|(?:signal|إشار|اشار).*MACD/i,["macd_signal"]], [/MACD/i,["macd","macd_signal","macd_hist"]],
        [/EMA\s*50/i,["ema_50"]], [/EMA\s*200/i,["ema_200"]], [/حجم.*نسبي|الحجم النسبي|r_vol|vol_ratio/i,["vol_ratio"]],
        [/KING/i,["king_ai_score"]], [/EGX.*AI/i,["egx_ai_score"]], [/تجميع/i,["acc_score"]], [/تصريف/i,["dist_score"]],
        [/سعر.*(?:شراء|دخول)|الدخول/i,["entry_price"]], [/وقف/i,["stop_loss"]], [/هدف|مستهدف/i,["target_price"]], [/دعم/i,["support"]], [/مقاوم/i,["resistance"]],
        [/تكلف/i,["cost_basis"]], [/قيمة.*سوق|القيمة السوقية/i,["market_value"]], [/ربح|خسار|عائد|النسبة/i,["profit_pct","profit_value"]],
        [/تغير|التغيّر/i,["change_pct"]], [/كمية|الكمية|عدد|مراكز/i,["quantity"]], [/إغلاق|اغلاق|السعر|سعر|price|close/i,["price","close"]],
    ];
    return labels.find(([pattern]) => pattern.test(text))?.[1];
}

/** This validates output evidence/protocol only. It never routes user intent. */
export function checkAgenticDraft(reply: string, evidence: AgenticEvidence[]): string[] {
    const reasons: string[] = [];
    if (!reply.trim()) reasons.push("empty_response");
    const substantive = reply.replace(/\[[^\]]*\]\(https?:\/\/[^)]*\)/g, "").replace(/https?:\/\/\S+/g, "")
        .replace(/✅ تحليل EGX Bots[^\n]*/g, "").replace(/📢[^\n]*/g, "");
    if (!/[\p{L}]{2}/u.test(substantive)) reasons.push("response_has_no_substantive_answer");
    if (/DSML|<\/?tool_call|<\/?function_call/i.test(reply)) reasons.push("internal_tool_protocol_in_response");
    const facts = agenticFacts(evidence);
    reasons.push(...checkAttribution(reply, facts));
    // Compare claimed above/below relations to the actual quote, not merely whether both numbers exist.
    let owner: string | null = null;
    const rows = evidence.flatMap(e => evidenceRows(e.data));
    const known = [...new Set(rows.map(r=>r.symbol).filter(Boolean))];
    for (const raw of reply.split("\n")) {
        const line = raw.replace(/[*_`]/g, "");
        const named = known.filter(s=>new RegExp(`\\b${s}\\b`).test(line));
        if (named.length === 1) owner=named[0];
        if (named.length > 1 || !owner || /(?:إذا|اذا|لو|عند اختراق|هدف|مستهدف|وقف)/.test(line)) continue;
        const row = [...rows].reverse().find(r=>r.symbol === owner && r.close != null);
        if (!row) continue;
        for (const relation of line.matchAll(/(فوق|أعلى من|اعلى من|تحت|أسفل|اسفل|above|below)\s*(?:الـ\s*)?EMA\s*(50|200)/gi)) {
            if (/(?:ليس|مش|لا|غير)\s*$/.test(line.slice(Math.max(0,relation.index!-12),relation.index))) continue;
            const close=Number(row.close), average=Number(row[`ema_${relation[2]}`]);
            if (!Number.isFinite(close) || !Number.isFinite(average)) continue;
            const above=/فوق|أعلى|اعلى|above/i.test(relation[1]);
            if ((above && close <= average) || (!above && close >= average)) reasons.push(`price_average_relation_contradiction:${owner}:ema_${relation[2]}`);
        }
    }
    // Check numbers in markdown rows against the named stock, including rows with no currency unit.
    const allSymbols = [...new Set(evidence.flatMap(e => e.symbols))];
    const portfolioFacts = facts.filter(f => f.symbol === "PORTFOLIO" || !f.symbol);
    let currentSymbol: string | null = allSymbols.length === 1 ? allSymbols[0] : null;
    let rankColIdx: number = -1;
    let inTable = false;
    let tableHadStockRow = false;
    let tableColSymbols: Array<string | null> = [];
    let isComparisonTable = false;
    let headers: string[] = [];

    const matchesFact = (val: number, targetFacts: FactRecord[]): boolean => {
        const candidateFacts = targetFacts;
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
            // Blank lines and explanatory prose do not erase the stock section.
            rankColIdx = -1;
            continue;
        }

        const isNewTable = !inTable;
        if (!inTable) {
            inTable = true;
            tableHadStockRow = false;
            tableColSymbols = [];
            isComparisonTable = false;
            headers = [];
        }

        if (/^\|[\s\-:|]+\|$/.test(line)) continue;

        const cells = line.split("|").slice(1, -1).map(c => c.trim());

        if (isNewTable && cells.some(c => /ترتيب|مركز|أولوية|تصنيف|أفضلية|^#$|^م$|^ت$|رقم|rank|tier|category/i.test(c))) {
            headers = cells;
            rankColIdx = cells.findIndex(c => /ترتيب|مركز|أولوية|تصنيف|أفضلية|^#$|^م$|^ت$|رقم|rank|tier|category/i.test(c));
            continue;
        }

        if (isNewTable) headers = cells;

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
                const clean = cleanCellText(cell);
                const matches = [...clean.matchAll(/[-+]?\d+(?:\.\d+)?/g)];
                const fields = tableMetricFields(cells[0]);
                const targetFacts = facts.filter(f => f.symbol === colSymbol && (!fields || fields.includes(f.field)));
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
        for (const date of line.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []) {
            const dates = evidence.flatMap(e => evidenceRows(e.data)).filter(r => r.symbol === symbol)
                .flatMap(r => [r.date, r.current_date, r.scan_date, r.signal_date]);
            if (!dates.some(d => String(d || "").slice(0,10) === date)) reasons.push(`table_date_not_grounded:${symbol}:${date}`);
        }

        for (let idx = 0; idx < cells.length; idx++) {
            if (idx === rankColIdx || cells[idx].includes(symbol)) continue;
            const fields = tableMetricFields(headers[idx]) || (currentSymbol ? tableMetricFields(cells[0]) : undefined);
            const relevant = symbol === "PORTFOLIO" ? portfolioFacts : facts.filter(f => f.symbol === symbol);
            const targetFacts = fields ? relevant.filter(f => fields.includes(f.field)) : relevant;
            const clean = cleanCellText(cells[idx]);
            for (const match of clean.matchAll(/[-+]?\d+(?:\.\d+)?/g)) {
                const n = Number(match[0]);
                if (!matchesFact(n, targetFacts) || (match[0].startsWith("+") && targetFacts.some(f => f.value < 0 && Math.abs(n + f.value) < 0.02)))
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
