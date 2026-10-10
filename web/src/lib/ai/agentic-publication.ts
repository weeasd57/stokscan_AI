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
memoryTools.add("apply_chart_strategy"); memoryTools.add("compare_strategies_history");
memoryTools.add("screen_stocks"); memoryTools.add("analyze_portfolio_risk");
/** Remove duplicate aliases/payload text, without removing source, dates, identity or unknown values. */
export function compactEvidence(record: AgenticEvidence): AgenticEvidence {
    const data = { ...record.data };
    if (data.comparison) delete data.comparisons;
    if (data.stocks) delete data.accumulation_stocks;
    if (data.analysis) data.analysis = { strategyId: data.analysis.strategyId, warnings: data.analysis.warnings,
        overlay_labels: data.analysis.overlays?.map((o: any) => o.label), signal_count: data.analysis.signals?.length, last_signal: data.analysis.signals?.at(-1) };
    if (data.comparison?.results) data.comparison = { warnings: data.comparison.warnings,
        results: data.comparison.results.map((r: any) => ({ strategyId: r.strategyId,
            metrics: data.strategy_metrics?.some((m: any) => m.strategy_id === r.strategyId) ? r.metrics : undefined, warnings: r.warnings })) };
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
    const rows = ["stocks", "levels", "positions", "recommendations", "comparison", "accumulation_stocks", "top_gainers", "top_losers", "news", "sector_exposure", "industry_exposure", "scenario_metrics"]
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
    const verifiedEmptyScreen = tool === "screen_stocks" && data?.status === "success" && Boolean(data.date)
        && Array.isArray(data.stocks) && typeof data.scan_complete === "boolean";
    return { tool, arguments: args, data, source: tool === "list_chart_strategies" ? "deterministic:strategy-catalog" : "supabase:" + ({ get_stock: "stock_technical_indicators+stocks+stock_scans_summary", get_stock_levels: "stock_prices",
        apply_chart_strategy: "stock_prices+deterministic-strategy-engine", compare_strategies_history: "stock_prices+deterministic-backtest", list_chart_strategies: "strategy-catalog",
        manage_portfolio: "positions+stock_technical_indicators", get_market: "market_cache+stock_technical_indicators", get_news: "stock_news_sentiment+stocks",
        get_recommendations: "scan_results+stock_technical_indicators", get_accumulation_stocks: "stock_scans_summary", get_comparison: "stock_technical_indicators",
        get_technical_scan: args.preset === "smart_money_flow" ? "stock_scans_summary" : "stock_technical_indicators",
        screen_stocks: "stock_technical_indicators+stock_prices", analyze_portfolio_risk: "positions+stock_fundamentals+scenario-calculation" } as any)[tool],
        data_time: dates.length === 1 ? dates[0] : data?.date || data?.session_date || null, symbols,
        availability: data?.status === "error" ? "error" : data?.availability === "missing" || (!verifiedEmptyScreen && !rows.length && !data?.egx30?.close && !data?.persisted && !data?.strategies?.length)
            ? "missing" : missing || data?.valuation_complete === false || data?.scan_complete === false
                || data?.sector_concentration_complete === false || data?.industry_concentration_complete === false || data?.truncated ? "partial" : "available", data_type: "historical" };
}

export function agenticFacts(evidence: AgenticEvidence[]): FactRecord[] {
    const adapted: ToolResult[] = evidence.filter(e => e.availability !== "error").map(e => ({ tool: e.tool, source: e.source, symbols: e.symbols,
        data_type: e.data_type, data_time: e.data_time || "", data: evidenceRows(e.data).map(row => ({ ...row,
        vol_ratio: row.relative_volume ?? row.r_vol ?? row.vol_ratio,
        acc_score: row.accumulation_score ?? row.acc_score, dist_score: row.distribution_score ?? row.dist_score,
        target_price: row.take_profit_1 ?? row.target_price, profit_pct: row.profit_loss_pct ?? row.realized_return_pct ?? row.unrealized_return_pct,
        cost_basis: row.cost, profit_value: row.profit_loss_val,
        position_pct: row.allocation_pct, value: row.allocated_capital,
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
            for (const [key, field] of [["total", "chart_signal_count"], ["buy_count", "chart_buy_signal_count"], ["sell_count", "chart_sell_signal_count"]] as const) {
                const value = row.signal_summary?.[key];
                if (typeof value === "number" && Number.isFinite(value)) facts.push({ id: `${row.symbol}:${row.analysis?.strategyId}:${key}`, symbol: row.symbol, field, value, unit: "count", as_of: row.date ?? null, source: e.source, tool: e.tool, fetched_at: new Date().toISOString() });
            }
            for (const metrics of row.strategy_metrics || []) {
                const fields: Array<[string, FactRecord["field"], FactRecord["unit"]]> = [["totalReturnPct", "backtest_return_pct", "percent"], ["maxDrawdownPct", "backtest_drawdown_pct", "percent"], ["winRatePct", "backtest_win_rate_pct", "percent"], ["profitFactor", "backtest_profit_factor", "ratio"], ["closedTrades", "backtest_closed_trades", "count"], ["finalEquity", "backtest_final_equity", "egp"]];
                for (const [key, field, unit] of fields) if (typeof metrics[key] === "number" && Number.isFinite(metrics[key])) facts.push({ id: `${row.symbol}:${metrics.strategy_id}:${key}`, symbol: row.symbol, field, value: metrics[key], unit, as_of: row.date ?? null, source: e.source, tool: e.tool, fetched_at: new Date().toISOString() });
            }
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
        [/^(?!.*سعر).*(?:إشارات.*شراء|buy.*signals|(?:إشارات|صفقات)\s*شراء|^شراء$)/i,["chart_buy_signal_count"]], [/^(?!.*سعر).*(?:إشارات.*بيع|sell.*signals|(?:إشارات|صفقات)\s*بيع|^بيع$)/i,["chart_sell_signal_count"]], [/(?:عدد|إجمالي|مجموع|كل)?\s*إشارات|signal.*count|إشارات/i,["chart_signal_count"]],
        [/هبوط|drawdown/i,["backtest_drawdown_pct"]], [/فوز|نجاح|win.?rate|صفقات.*رابح|رابح/i,["backtest_win_rate_pct"]], [/معامل.*ربح|profit.?factor/i,["backtest_profit_factor"]], [/(?:عدد|إجمالي|مجموع)?\s*صفقات(?!.*(?:رابح|شراء|بيع))|trades/i,["backtest_closed_trades"]], [/قيمة.*نهاي|رأس.*مال.*نهاي|equity/i,["backtest_final_equity"]], [/عائد|total.?return/i,["backtest_return_pct"]],
        [/RSI|القوة النسبية/i,["rsi"]], [/هيست|hist/i,["macd_hist"]], [/MACD.*(?:signal|إشار|اشار)|(?:signal|إشار|اشار).*MACD/i,["macd_signal"]], [/MACD/i,["macd","macd_signal","macd_hist"]],
        [/EMA\s*50/i,["ema_50"]], [/EMA\s*200/i,["ema_200"]], [/حجم.*نسبي|الحجم النسبي|r_vol|vol_ratio/i,["vol_ratio"]],
        [/KING/i,["king_ai_score"]], [/EGX.*AI/i,["egx_ai_score"]], [/تجميع/i,["acc_score"]], [/تصريف/i,["dist_score"]],
        [/سعر.*(?:شراء|دخول)|الدخول/i,["entry_price","cost_basis"]], [/وقف/i,["stop_loss"]], [/هدف|مستهدف/i,["target_price"]], [/دعم/i,["support"]], [/مسافة.*مقاوم|بعد.*مقاوم|القرب.*مقاوم/i,["distance_from_resistance_pct"]], [/مقاوم/i,["resistance"]],
        [/تكلف/i,["cost_basis"]], [/توزيع|وزن|نسبة.*المحفظة|تركيز.*قطاع/i,["position_pct"]], [/مبلغ.*مخصص|قيمة.*مخصصة|رأس.*مال.*موزع/i,["value"]], [/قيمة.*سوق|القيمة السوقية/i,["market_value"]], [/ربح|خسار|عائد|النسبة/i,["profit_pct","profit_value","backtest_return_pct"]],
        [/خسارة.*افتراضية|خسارة.*سيناريو|هبوط.*مفترض/i,["scenario_loss_amount","scenario_loss_pct"]], [/رأس.*مال|إجمالي.*رأس المال/i,["scenario_capital"]],
        [/تغير|التغيّر/i,["change_pct"]], [/كمية|الكمية|عدد|مراكز/i,["quantity"]], [/إغلاق|اغلاق|السعر|سعر|price|close/i,["price","close"]],
    ];
    return labels.find(([pattern]) => pattern.test(text))?.[1];
}

/** Bind backtest claims to the selected strategy as well as the stock. */
function checkStrategyClaims(reply: string, evidence: AgenticEvidence[]): string[] {
    const reasons: string[] = [];
    const latest = new Map<string, any>();
    for (const e of evidence.filter(e => e.availability !== "error")) for (const row of evidenceRows(e.data)) for (const m of row.strategy_metrics || []) latest.set(`${row.symbol}:${m.strategy_id}`, { ...m, symbol: row.symbol });
    const rows = [...latest.values()];
    const labels: Array<[RegExp, string]> = [[/هبوط|drawdown/i, "maxDrawdownPct"], [/فوز|نجاح|win.?rate|صفقات.*رابح|رابح/i, "winRatePct"], [/معامل.*ربح|profit.?factor/i, "profitFactor"], [/(?:عدد|إجمالي|مجموع)?\s*صفقات(?!.*رابح)|trades/i, "closedTrades"], [/قيمة.*نهاي|رأس.*مال.*نهاي|equity/i, "finalEquity"], [/عائد|return/i, "totalReturnPct"]];
    let headers: string[] = [], owner: any = null, stockOwner: string | null = null;
    for (const line of reply.split("\n")) {
        const stockNames = [...new Set(rows.map(r => r.symbol))].filter(s => line.includes(s));
        if (stockNames.length === 1) stockOwner = stockNames[0];
        const selected = rows.filter((r: any) => (!stockOwner || r.symbol === stockOwner) && (line.includes(r.strategy_id) || line.includes(r.strategy_name)));
        if (selected.length === 1) owner = selected[0];
        if (line.trim().startsWith("|")) {
            if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
            const cells = line.split("|").slice(1, -1);
            if (!selected.length && cells.some(c => /استراتيجية|strategy/i.test(c))) { headers = cells; continue; }
            if (selected.length !== 1) continue;
            cells.forEach((cell, i) => {
                const key = labels.find(([pattern]) => pattern.test(headers[i] || ""))?.[1];
                if (!key) return;
                const n = Number(cleanCellText(cell).replace(/[%٪]/g, "").trim());
                if (!Number.isFinite(n) || !/\d/.test(cell)) return;
                const expected = selected[0][key];
                if (typeof expected !== "number" || Math.abs(n - expected) > Math.max(0.02, Math.abs(expected) * 0.005)) reasons.push(`strategy_metric_mismatch:${selected[0].symbol}:${selected[0].strategy_id}:${key}`);
            });
        } else if (owner && selected.length <= 1) {
            for (const match of line.matchAll(/[-+]?\d+(?:\.\d+)?\s*(?:%|٪|جنيه)/g)) {
                const prefix = line.slice(0, match.index);
                const candidates = labels.flatMap(([pattern, key]) => { const found = [...prefix.matchAll(new RegExp(pattern.source, pattern.flags + "g"))].at(-1); return found ? [{ key, index: found.index! }] : []; }).sort((a, b) => b.index - a.index);
                if (!candidates.length) continue;
                const key = candidates[0].key, n = Number(match[0].replace(/[%٪\s]|جنيه/g, "")), expected = owner[key];
                if (["closedTrades", "profitFactor"].includes(key) && /[%٪]/.test(match[0])) continue;
                if (typeof expected !== "number" || Math.abs(n - expected) > Math.max(0.02, Math.abs(expected) * 0.005)) reasons.push(`strategy_metric_mismatch:${owner.symbol}:${owner.strategy_id}:${key}`);
            }
        }
    }
    return reasons;
}

function normalizeDigitsAndNumberFormatting(value: string): string {
    return value.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
        .replace(/[۰-۹]/g, d => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/٫/g, ".").replace(/,/g, ".");
}

/** Bind allocations to one scenario row, never to an arbitrary sum of stock facts. */
function scenarioTableRow(evidence: AgenticEvidence[], cells: string[], symbols: string[], headers: string[]) {
    const scenario = [...evidence].reverse().find(e => e.tool === "analyze_portfolio_risk"
        && e.availability !== "error" && e.data?.status === "success" && e.data?.mode === "scenario");
    if (!scenario) return null;
    const clean = (text: string) => text.replace(/[*_`]/g, "").trim().toLowerCase();
    if (symbols.length === 0 && headers.some(h => /خسار|loss|متبقي|متبقية|بعد (?:الهبوط|الانخفاض|التراجع)|remaining|after.*drop/i.test(h)) && headers.some(h => /هبوط|انخفاض|تراجع|drop/i.test(h))) {
        const declineIndex = headers.findIndex(h => /هبوط|انخفاض|تراجع|drop/i.test(h) && !/متبقي|متبقية|بعد (?:الهبوط|الانخفاض|التراجع)|remaining|after.*drop/i.test(h));
        if (declineIndex < 0) return null;
        const decline = Number(normalizeDigitsAndNumberFormatting(cells[declineIndex] || "").replace(/[%٪\s]/g, ""));
        const stress = scenario.data.stress_scenarios_not_forecasts?.find((row: any) => Math.abs(row.change_pct) === Math.abs(decline));
        if (stress) return { symbol: "PORTFOLIO", scenario_loss_pct: stress.change_pct, scenario_loss_amount: -stress.loss, allocated_capital: scenario.data.capital - stress.loss };
    }
    const groupTable = headers.some(h => /قطاع|صناع|sector|industry/i.test(h));
    const groups = [...(scenario.data.sector_exposure || []), ...(scenario.data.industry_exposure || [])];
    if (groupTable) {
        const exactMembers = (members: string[]) => symbols.length === members.length
            && symbols.every(s => members.includes(s));
        return groups.find(row => {
            const label = row.industry ?? row.sector;
            const labelMatches = typeof label === "string" && cells.some(cell => clean(cell) === clean(label));
            // A sector label cannot turn a subset or a different set of stocks into its total.
            return symbols.length ? Array.isArray(row.symbols) && exactMembers(row.symbols) : labelMatches;
        }) || (symbols.length === 1 ? scenario.data.stocks?.find((row: any) => row.symbol === symbols[0]) : null);
    }
    if ((!symbols.length || symbols.every(symbol => symbol === "PORTFOLIO")) && cells.some(cell => /^(?:الإجمالي|إجمالي|المجموع|مجموع|total)$/i.test(clean(cell))))
        return { symbol: "PORTFOLIO", allocation_pct: 100, allocated_capital: scenario.data.capital };
    if (symbols.length === 1) return scenario.data.stocks?.find((row: any) => row.symbol === symbols[0]) || null;
    return null;
}

function scenarioMetricFields(label: string): FactRecord["field"][] | undefined {
    if (/متبقي|متبقية|بعد (?:الهبوط|الانخفاض|التراجع)|remaining|after.*drop/i.test(label)) return ["value"];
    if (/هبوط|انخفاض|تراجع|drop/i.test(label)) return ["scenario_loss_pct"];
    if (/خسار|loss/i.test(label)) return /%|٪|نسب|percent|pct/i.test(label) ? ["scenario_loss_pct"] : ["scenario_loss_amount"];
    if (/توزيع|وزن|نسب|تركيز|allocation|weight/i.test(label)) return ["position_pct"];
    if (/مبلغ|قيمة|رأس.*مال|جنيه|capital|amount/i.test(label)) return ["value"];
    return tableMetricFields(label);
}

function checkResistanceRelations(reply: string, evidence: AgenticEvidence[]): string[] {
    const rows = new Map<string, any>();
    for (const e of evidence) if (e.availability !== "error") for (const row of evidenceRows(e.data))
        if (row.symbol && Number.isFinite(row.close) && Number.isFinite(row.resistance)) rows.set(row.symbol, row);
    const reasons: string[] = [];
    for (const sentence of reply.replace(/[*_`]/g, "").split(/\n|[.!؟]\s+/)) {
        if (sentence.trim().startsWith("|") || /إذا|اذا|(?:^|\s)لو(?:\s|$)|عند اختراق|شرط|يتطلب|يحتاج/.test(sentence)) continue;
        for (const [symbol, row] of rows) {
            if (!new RegExp(`\\b${symbol}\\b`, "i").test(sentence)) continue;
            for (const relation of sentence.matchAll(/(تحت|أدنى من|ادنى من|أسفل|اسفل|فوق|أعلى من|اعلى من|عند|اخترق(?:ت|ا|وا)?)\s*(?:الـ\s*)?(المقاومة|مقاومتها|مقاومته|تحتها|فوقها)|(تحتها|فوقها)(?=\s|[.,،؛!?؟]|$)/g)) {
                const prefix = sentence.slice(0, relation.index);
                if (/(?:ليس|ليست|ليسا|لم|لن|مش|لا|غير|لم يكن|لم تكن)\s*$/.test(prefix)) continue;
                const term = relation[1] || relation[3];
                const tolerance = Math.max(1e-9, Math.abs(row.resistance) * 1e-9);
                const delta = row.close - row.resistance;
                const valid = /تحت|أدنى|ادنى|أسفل|اسفل/.test(term) ? delta < -tolerance
                    : term === "عند" ? Math.abs(delta) <= tolerance : delta > tolerance;
                if (!valid) reasons.push(`price_resistance_relation_contradiction:${symbol}`);
            }
        }
    }
    return [...new Set(reasons)];
}

/** Explicit position inputs in the current request are part of the answer contract. */
export function checkUserPositionInputs(reply: string, request: string): string[] {
    const normalizedRequest = normalizeDigitsAndNumberFormatting(request);
    const normalizedReply = normalizeDigitsAndNumberFormatting(reply);
    const reasons: string[] = [];
    const average = normalizedRequest.match(/(?:متوسطي|متوسط(?:ي)?(?:\s+(?:الشراء|سعر\s+الشراء))?|سعر\s+شرائي|اشتريت(?:ه)?\s+بسعر)\s*(?:(?:هو|فيه|عند)\s*)?[:=]?\s*(\d+(?:\.\d+)?)/i);
    const quantity = normalizedRequest.match(/(?:معايا|معي|عندي)\s*(\d+(?:\.\d+)?)\s*(?:سهم|أسهم|اسهم)(?=\s|$|[،,.!?])/i)
        || normalizedRequest.match(/(?:كمية(?:\s+الأسهم)?|عدد\s+الأسهم)\s*(?:هي\s*)?[:=]?\s*(\d+(?:\.\d+)?)/i);
    if (average && !new RegExp(`(?<![\\d.])${average[1].replace(".", "\\.")}(?![\\d.])`).test(normalizedReply))
        reasons.push(`user_position_average_omitted:${average[1]}`);
    if (quantity && !new RegExp(`(?<![\\d.])${quantity[1].replace(".", "\\.")}(?![\\d.])`).test(normalizedReply))
        reasons.push(`user_position_quantity_omitted:${quantity[1]}`);
    return reasons;
}

/** This validates output evidence/protocol only. It never routes user intent. */
export function checkAgenticDraft(reply: string, evidence: AgenticEvidence[], request = ""): string[] {
    const reasons: string[] = [];
    if (!reply.trim()) reasons.push("empty_response");
    if (/\b(?:get_stock(?:_levels)?|get_market|get_comparison|get_news|get_recommendations|get_technical_scan|get_accumulation_stocks|manage_portfolio|screen_stocks|analyze_portfolio_risk|list_chart_strategies|apply_chart_strategy|compare_strategies_history|stock_prices|stock_technical_indicators|stock_scans_summary|ai_chat_sessions|ai_chat_messages)\b/.test(reply)) reasons.push("internal_implementation_names_in_response");
    const substantive = reply.replace(/\[[^\]]*\]\(https?:\/\/[^)]*\)/g, "").replace(/https?:\/\/\S+/g, "")
        .replace(/✅ تحليل EGX Bots[^\n]*/g, "").replace(/📢[^\n]*/g, "");
    if (!/[\p{L}]{2}/u.test(substantive)) reasons.push("response_has_no_substantive_answer");
    if (/DSML|<\/?tool_call|<\/?function_call/i.test(reply)) reasons.push("internal_tool_protocol_in_response");
    const facts = agenticFacts(evidence);
    reasons.push(...checkResistanceRelations(reply, evidence));
    reasons.push(...checkStrategyClaims(reply, evidence));
    reasons.push(...checkAttribution(reply, facts));
    if (request) reasons.push(...checkUserPositionInputs(reply, request));
    if (request && /(?:أخبار|اخبار|خبر|news)/i.test(request)) {
        const requestedNewsSymbols = [...new Set(evidence.filter(e=>e.tool === "get_news" && e.availability !== "error")
            .flatMap(e=>Array.isArray(e.arguments?.symbols) ? e.arguments.symbols : []).map((s:any)=>String(s).toUpperCase()))];
        const plain = reply.replace(/[*_`]/g, "");
        const heading = plain.search(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:أحدث\s+)?(?:الأخبار?|خبر\s+متاح|news)\s*[:：]?/im);
        const newsText = heading >= 0 ? plain.slice(heading).split(/\n\s*(?:#{1,6}\s+|\*\*[^\n]{2,50}\*\*)/)[0] : plain;
        for (const symbol of requestedNewsSymbols)
            if (!new RegExp(`(?<![A-Z0-9])${symbol}(?![A-Z0-9])`, "i").test(newsText)) reasons.push(`requested_news_symbol_omitted:${symbol}`);
    }
    // Verify comparative distance statements from the same dated comparison,
    // independently of whether all quoted values themselves are grounded.
    const latestComparisons=new Map<string,AgenticEvidence>();
    for (const e of evidence.filter(e=>e.tool === "get_comparison" && e.availability !== "error"))
        latestComparisons.set(evidenceRows(e.data).map(r=>r.symbol).filter(Boolean).sort().join("/"),e);
    for (const e of latestComparisons.values()) {
        const quotes=evidenceRows(e.data).filter(r=>r.symbol && r.close != null);
        if (quotes.length < 2) continue;
        const dates=quotes.map(r=>String(r.date || r.as_of || e.data_time || "").slice(0,10));
        if (!dates[0] || dates.some(d=>d !== dates[0])) continue;
        for (const raw of reply.split("\n")) {
            const line=raw.replace(/[*_`]/g, "");
            // Plural claims apply to every stock in the comparison, even when
            // the sentence omits tickers (for example, "both are below EMA50").
            const blanket = /(?:الاثنان|الاثنين|كلاهما|كلا السهمين|both|all\s+(?:stocks|shares))/i.test(line);
            const blanketRelation = line.match(/(فوق|أعلى من|اعلى من|تحت|أسفل|اسفل|above|below)\s*(?:الـ\s*)?EMA\s*(50|200)/i);
            const beforeRelation = line.slice(Math.max(0, blanketRelation ? blanketRelation.index! - 35 : 0), blanketRelation?.index || 0);
            const hypotheticalOrNegated = /إذا|اذا|لو|أمس|امس|سابق|\bif\b/i.test(beforeRelation)
                || /(?:ليس|مش|غير|(?:^|\s)لا(?:\s|$))\s*(?:كان|يكون|هو|were|was|is|are)?\s*$/i.test(beforeRelation.slice(-18));
            if (blanket && blanketRelation && !hypotheticalOrNegated) {
                const above = /فوق|أعلى|اعلى|above/i.test(blanketRelation[1]);
                for (const row of quotes) {
                    const close = Number(row.close), average = Number(row[`ema_${blanketRelation[2]}`]);
                    if (!Number.isFinite(close) || !Number.isFinite(average)) continue;
                    if ((above && close <= average) || (!above && close >= average))
                        reasons.push(`price_average_relation_contradiction:${row.symbol}:ema_${blanketRelation[2]}`);
                }
            }
            const named=quotes.filter(r=>new RegExp(`\\b${r.symbol}\\b`,"i").test(line));
            if (named.length !== 1 || /إذا|اذا|لو|أمس|امس|سابق/.test(line)) continue;
            const periods=[...line.matchAll(/EMA\s*(50|200)/gi)].map(m=>m[1]);
            if (new Set(periods).size !== 1) continue;
            const relation=line.match(/أقرب|اقرب|أبعد|ابعد/);
            if (!relation || /(?:ليس|مش|غير)\s*$/.test(line.slice(0,relation.index))) continue;
            const field=`ema_${periods[0]}`;
            const distances=quotes.map(r=>({symbol:r.symbol,average:Number(r[field]),close:Number(r.close)}))
                .filter(r=>Number.isFinite(r.average) && r.average > 0 && Number.isFinite(r.close))
                .map(r=>({...r,distance:Math.abs(r.close-r.average)/r.average}));
            const subject=distances.find(r=>r.symbol === named[0].symbol);
            if (!subject || distances.length !== quotes.length) continue;
            const closer=/أقرب|اقرب/.test(relation[0]);
            if (distances.some(r=>r.symbol !== subject.symbol && (closer ? r.distance < subject.distance-0.0001 : r.distance > subject.distance+0.0001)))
                reasons.push(`average_distance_ranking_contradiction:${subject.symbol}:${field}`);
        }
    }
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
            const fractionalScreenPrice = f.tool === "screen_stocks" && Math.abs(f.value) < 1
                && ["price", "close", "resistance"].includes(f.field);
            const tol = fractionalScreenPrice ? Math.max(0.00005, Math.abs(f.value) * 0.0005) : Math.max(0.02, Math.abs(f.value) * 0.005);
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

        const scenarioRow = scenarioTableRow(evidence, cells, lineSymbols, headers);
        if (scenarioRow?.symbol === "PORTFOLIO") symbol = "PORTFOLIO";
        else if (!symbol && scenarioRow) symbol = scenarioRow.symbol || "PORTFOLIO";
        if (!symbol) continue;
        for (const date of line.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []) {
            const dates = evidence.flatMap(e => evidenceRows(e.data)).filter(r => r.symbol === symbol)
                .flatMap(r => [r.date, r.current_date, r.scan_date, r.signal_date]);
            if (!dates.some(d => String(d || "").slice(0,10) === date)) reasons.push(`table_date_not_grounded:${symbol}:${date}`);
        }

        for (let idx = 0; idx < cells.length; idx++) {
            if (idx === rankColIdx || cells[idx].includes(symbol)) continue;
            const fields = (scenarioRow ? scenarioMetricFields(headers[idx]) : tableMetricFields(headers[idx]))
                || (currentSymbol ? tableMetricFields(cells[0]) : undefined);
            const allocationFacts = scenarioRow ? buildFactRecords([{ tool: "analyze_portfolio_risk", source: "scenario-calculation",
                data: [{ symbol, position_pct: scenarioRow.allocation_pct, value: scenarioRow.allocated_capital,
                    scenario_loss_pct: scenarioRow.scenario_loss_pct, scenario_loss_amount: scenarioRow.scenario_loss_amount }] }]) : [];
            const relevant = scenarioRow && fields?.some(field => ["position_pct", "value", "scenario_loss_pct", "scenario_loss_amount"].includes(field)) ? allocationFacts
                : symbol === "PORTFOLIO" ? portfolioFacts : facts.filter(f => f.symbol === symbol);
            const strategyRows = evidence.flatMap(e => evidenceRows(e.data));
            const knownStrategies = [
                ...strategyRows.flatMap(r => r.strategy_metrics || []),
                ...strategyRows.filter(r => r.analysis?.strategyId).map(r => ({
                    strategy_id: r.analysis.strategyId,
                    strategy_name: r.analysis.strategyId
                }))
            ];
            const namedStrategy = knownStrategies.find(m => line.includes(m.strategy_id) || (m.strategy_name && line.includes(m.strategy_name)));
            const strategyRelevant = namedStrategy ? relevant.filter(f => (!f.field.startsWith("backtest_") && !f.field.startsWith("chart_")) || f.id.includes(`:${namedStrategy.strategy_id}:`)) : relevant;
            const targetFacts = fields ? strategyRelevant.filter(f => fields.includes(f.field)) : strategyRelevant;
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
    // Evidence passed here should already be scoped to the current request. Keep
    // the first available rows only as a bounded fallback and never resurrect
    // unrelated symbols from an older turn.
    const rows = evidence.filter(e => e.availability !== "error").flatMap(e => evidenceRows(e.data));
    for (const e of evidence.filter(e => e.availability !== "error")) {
        if (e.tool === "screen_stocks" && e.data?.status === "success") {
            const d=e.data;
            if (d.date && d.filters) {
                lines.push(`\nشاشة فنية بتاريخ ${d.date}: الشروط RSI بين ${d.filters.rsi_min} و${d.filters.rsi_max}، والحجم النسبي ${d.filters.relative_volume_inclusive === false ? ">" : "≥"} ${d.filters.relative_volume_min}، والمسافة من مقاومة أعلى 20 جلسة ${d.filters.resistance_distance_inclusive === false ? "<" : "≤"} ${d.filters.max_resistance_distance_pct}%.`);
                if (d.stocks?.length) {
                    lines.push("| السهم | الإغلاق | RSI | الحجم النسبي | المقاومة | البعد عنها % |","|---|---:|---:|---:|---:|---:|");
                    for(const r of d.stocks.slice(0,10)) lines.push(`| ${r.symbol} | ${r.close} | ${r.rsi_14} | ${r.r_vol} | ${r.resistance} | ${r.distance_from_resistance_pct} |`);
                } else lines.push("لم تظهر أسهم تطابق الشروط في البيانات المتاحة لهذه الجلسة.");
                lines.push("المساوي للمقاومة عندها، والأقل تحتها؛ أعلى 20 جلسة يشمل جلسة اللقطة، فلا يثبت قرب السعر أو مساواته اختراق مقاومة سابقة.");
                if(d.scan_complete===false) lines.push("المسح جزئي: بعض المرشحين تجاوزوا حد الفحص أو لا يتوفر لهم تاريخ 20 جلسة.");
            } else lines.push("لا تتوفر لقطة مؤرخة لإتمام المسح الفني حالياً.");
        }
        if (e.tool === "analyze_portfolio_risk" && e.data?.mode === "scenario") {
            const d=e.data;
            lines.push(`\nهذا سيناريو افتراضي من رأس مال ${d.capital} جنيه، بتوزيع ${d.assumption === "equal_weight" ? "متساوٍ مفترض" : "النسب التي حددتها"}؛ لا يمثل المراكز المحفوظة ولم يتم حفظه.`);
            lines.push("| السهم | القطاع من بيانات الشركة | الصناعة | التوزيع % | المبلغ بالجنيه | محفوظ بالحساب؟ |","|---|---|---|---:|---:|---|");
            for(const r of d.stocks) lines.push(`| ${r.symbol} | ${r.sector || "غير متاح"} | ${r.industry || "غير متاح"} | ${r.allocation_pct} | ${r.allocated_capital} | ${r.saved ? "نعم" : "لا"} |`);
            for(const r of d.sector_exposure) lines.push(`قطاع ${r.sector || "غير محدد"}: ${r.allocation_pct}% (${r.allocated_capital} جنيه).`);
            for(const r of d.industry_exposure || []) lines.push(`صناعة ${r.industry || "غير محدد"}: ${r.allocation_pct}% (${r.allocated_capital} جنيه).`);
            if(d.classification_note) lines.push(d.classification_note);
            if(d.rounding_note)lines.push(d.rounding_note);
            if(!d.sector_concentration_complete) lines.push("بيانات قطاع سهم أو أكثر غير متاحة؛ تجميع القطاعات جزئي ولا يصح اعتباره كاملاً.");
            lines.push(`اختبار حساسية حسابي فقط، وليس توقعاً: هبوط افتراضي 5% = ${d.stress_scenarios_not_forecasts[0].loss} جنيه، و10% = ${d.stress_scenarios_not_forecasts[1].loss} جنيه.`);
        }
    }
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

