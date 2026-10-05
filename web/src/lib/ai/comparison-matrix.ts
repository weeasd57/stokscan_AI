import { ToolResult } from "./types";
import { finiteMetric, synchronizeMarketSnapshot } from "./market-snapshot";

export interface ComparisonStock {
    symbol: string;
    name: string;
    price: number | null;
    change_pct: number | null;
    rsi: number | null;
    vol_ratio: number | null;
    macd: number | null;
    macd_signal: number | null;
    king_ai_score: number | null;
    egx_ai_score: number | null;
    support: number | null;
    resistance: number | null;
    as_of: string | null;
    metric_dates: Record<string, string | null>;
    levels_as_of: string | null;
    quote_kind: string;
}

/** Observations, not an unvalidated investment scoring model. There is no
 * statistical significance or overall winner without an actual tested model. */
export function buildComparisonMatrix(input: ToolResult[]) {
    const results = synchronizeMarketSnapshot(input.filter(r => !r.error && !["failed", "unsupported", "empty"].includes(r.availability || "available")));
    const stocks = new Map<string, ComparisonStock>();
    const put = (raw: any, fallback: string, date: string | null, kind?: string) => {
        const symbol = String(raw?.symbol || raw?.info?.symbol || fallback).toUpperCase();
        if (!symbol) return;
        const tech = raw?.tech || raw;
        const old = stocks.get(symbol);
        stocks.set(symbol, {
            symbol, name: raw?.name || raw?.info?.name || symbol,
            price: finiteMetric(raw?.price?.close ?? raw?.price ?? tech?.close),
            change_pct: finiteMetric(tech?.change_pct_num ?? tech?.change_pct),
            rsi: finiteMetric(tech?.rsi_14_num ?? tech?.rsi_14),
            vol_ratio: finiteMetric(tech?.vol_ratio_num ?? tech?.vol_ratio ?? tech?.volume_ratio
                ?? (finiteMetric(tech?.volume) != null && (finiteMetric(tech?.vol_sma20) ?? 0) > 0 ? Number(tech.volume) / Number(tech.vol_sma20) : null)),
            macd: finiteMetric(tech?.macd), macd_signal: finiteMetric(tech?.macd_signal_num ?? tech?.macd_signal),
            king_ai_score: finiteMetric(tech?.king_ai_score), egx_ai_score: finiteMetric(tech?.egx_ai_score),
            support: old?.support ?? null, resistance: old?.resistance ?? null, levels_as_of: old?.levels_as_of ?? null,
            as_of: date && Number.isFinite(Date.parse(date)) ? date : null,
            metric_dates: tech?.metric_dates || raw?.metric_dates || {},
            quote_kind: kind || raw?.quote_kind || (raw?.is_live_intraday ? "live_intraday" : "daily_close"),
        });
    };
    // Comparison rows first, canonical stock observations afterwards. A stale
    // comparison projection must not erase fresh per-symbol facts.
    for (const result of results.filter(r => r.tool === "get_comparison" && !r.error)) {
        const data = result.data || {};
        if (Array.isArray(data.comparisons)) {
            for (const row of data.comparisons) put(row, row.symbol, Object.prototype.hasOwnProperty.call(row, "as_of") ? row.as_of : result.data_time);
        } else {
            const entries = data.sym1 && data.sym2 ? [data.sym1, data.sym2] : (result.symbols || []).map(s => data[s]);
            entries.forEach((row: any, i: number) => {
                if (row) put(row, result.symbols?.[i] || "", Object.prototype.hasOwnProperty.call(row, "as_of") ? row.as_of : row.price?.date || row.tech?.date || result.data_time);
            });
        }
    }
    for (const result of results.filter(r => r.tool === "get_stock" && !r.error)) {
        const symbol = String(result.data?.symbol || result.symbols?.[0] || "").toUpperCase();
        const prior = stocks.get(symbol);
        if (prior?.as_of && (!result.data_time || Date.parse(result.data_time) < Date.parse(prior.as_of))) continue;
        put(result.data, symbol, result.data_time);
    }
    for (const result of results.filter(r => r.tool === "get_stock_levels" && !r.error)) {
        const symbol = String(result.data?.symbol || result.symbols?.[0] || "").toUpperCase();
        const row = stocks.get(symbol);
        if (!row) continue;
        row.support = finiteMetric(result.data?.support);
        row.resistance = finiteMetric(result.data?.resistance);
        row.levels_as_of = result.data?.levels_as_of || result.data_time || null;
    }
    const values = [...stocks.values()];
    if (values.length < 2) return null;
    return { stocks: values, formatted_prompt_block: [
        "=== COMPARISON OBSERVATIONS ===",
        JSON.stringify(values),
        "No heuristic scores, risk winner, statistical significance, or guaranteed future return are supplied.",
        "Volume ratio measures activity relative to EACH stock's own average, not absolute liquidity or institutional buying.",
        "A lower RSI only means less RSI extension, not overall safety. MACD above zero is not a crossover.",
        "Each field retains its observation date; unequal/unknown dates cannot establish a current comparative leader.",
    ].join("\n") };
}
