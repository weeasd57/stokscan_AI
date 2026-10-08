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
    })) }));
    const facts = buildFactRecords(adapted);
    for (const e of evidence) for (const row of evidenceRows(e.data)) {
        // Different calculated targets remain separate supported observations.
        if (row.symbol && Number.isFinite(row.take_profit_2)) facts.push({ id: `${row.symbol}:target2`, symbol: row.symbol,
            field: "target_price", value: row.take_profit_2, unit: "egp", as_of: row.date ?? null, source: e.source, tool: e.tool, fetched_at: new Date().toISOString() });
        if (row.symbol && typeof row.entry_zone === "string") for (const value of row.entry_zone.match(/\d+(?:\.\d+)?/g) || []) {
            facts.push({ id: `${row.symbol}:entry:${value}`, symbol: row.symbol, field: "entry_price", value: Number(value), unit: "egp",
                as_of: row.date ?? null, source: e.source, tool: e.tool, fetched_at: new Date().toISOString() });
        }
    }
    return facts;
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
    let currentSymbol: string | null = allSymbols.length === 1 ? allSymbols[0] : null;
    let rankColIdx: number = -1;

    for (const rawLine of reply.split("\n")) {
        const line = rawLine.trim();
        const lineSymbol = allSymbols.find(s => new RegExp(`\\b${s}\\b`, "i").test(line));
        if (lineSymbol) {
            currentSymbol = lineSymbol;
        }

        if (!line.startsWith("|")) {
            if (!line.startsWith("#") && allSymbols.length > 1) {
                currentSymbol = null;
            }
            rankColIdx = -1;
            continue;
        }

        if (/^\|[\s\-:|]+\|$/.test(line)) continue;

        const cells = line.split("|").slice(1, -1).map(c => c.trim());

        if (cells.some(c => /ترتيب|مركز|أولوية|تصنيف|أفضلية|^#$|^م$|^ت$|رقم|rank|tier|category/i.test(c))) {
            rankColIdx = cells.findIndex(c => /ترتيب|مركز|أولوية|تصنيف|أفضلية|^#$|^م$|^ت$|رقم|rank|tier|category/i.test(c));
            continue;
        }

        if (!cells.some(c => /\d/.test(c))) continue;

        const symbol = lineSymbol || currentSymbol;
        if (!symbol) continue;

        const filteredCells = cells.filter((cell, idx) => {
            if (idx === rankColIdx) return false;
            if (/^(?:[#№]?\s*\d{1,2}\.?|🥇|🥈|🥉|1️⃣|2️⃣|3️⃣|4️⃣|5️⃣|6️⃣|7️⃣|8️⃣|9️⃣|🔟)$/.test(cell)) return false;
            return true;
        });

        const clean = filteredCells.join(" | ")
            .replace(/\d{4}[-/]\d{2}[-/]\d{2}/g, "")
            .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
            .replace(/\b(?:RSI|EMA|SMA|BB)[ _-]?(?:\(\s*\d+(?:[\s,]+\d+)*\s*\)|\d+)\b/gi, "")
            .replace(/\bMACD\s*\(\s*\d+[\s,]+\d+[\s,]+\d+\s*\)/gi, "")
            .replace(/(?:متوسط|موفينج)\s*(?:14|20|50|100|200)\b/gi, "")
            .replace(/(?:الهدف|مستهدف|المستهدف|دعم|الدعم|مقاومة|المقاومة|المركز|ترتيب|الترتيب|مستوى|المستوى|فئة|الفئة)\s*[1-9]\b/gi, "");

        const matches = [...clean.matchAll(/[-+]?\d+(?:\.\d+)?/g)];
        if (!matches.length) continue;

        const stockFacts = facts.filter(f => f.symbol === symbol);
        for (const match of matches) {
            const n = Number(match[0]);
            if (!stockFacts.some(f => Math.abs(n - f.value) <= Math.max(0.015, Math.abs(f.value) * 0.005))) {
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
