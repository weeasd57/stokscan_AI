import { ToolResult } from "./types";

export function finiteMetric(value: unknown): number | null {
    if (value == null || value === "" || value === "N/A") return null;
    const n = Number(String(value).replace(/[%٪x,]/gi, ""));
    return Number.isFinite(n) ? n : null;
}

function symbolOf(result: ToolResult): string {
    return String(result.data?.symbol || result.symbols?.[0] || "").toUpperCase();
}

function timeOf(value: unknown): number {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : -Infinity;
}

export function pricePosition(price: number, support: number | null, resistance: number | null) {
    const supportDistance = support != null && support > 0 ? (price - support) / price * 100 : null;
    const resistanceDistance = resistance != null && resistance > 0 ? (resistance - price) / price * 100 : null;
    const position = support != null && resistance != null && resistance > support ? (price - support) / (resistance - support) * 100 : null;
    let zone = "منطقة حيادية للمراقبة (بين الدعم والمقاومة)";
    if (support != null && price < support) zone = "تحت مستوى الدعم";
    else if (resistance != null && price > resistance) zone = "فوق مستوى المقاومة المسجل؛ وقت الاختراق غير مثبت";
    else if (supportDistance != null && supportDistance <= 2.5) zone = "عند منطقة الدعم";
    else if (position != null && position <= 25) zone = "فوق مستوى الدعم وقريب منه";
    else if (resistanceDistance != null && resistanceDistance <= 2.5) zone = "عند منطقة المقاومة";
    else if (position != null && position >= 75) zone = "تحت مستوى المقاومة وقريب منها";
    const rounded = (n: number | null) => n == null ? null : Number(n.toFixed(2));
    return { distance_from_support_pct: rounded(supportDistance), distance_from_resistance_pct: rounded(resistanceDistance),
        position_pct: rounded(position), price_vs_support: support == null ? "غير متاح" : price >= support ? "فوق الدعم" : "تحت الدعم",
        price_vs_resistance: resistance == null ? "غير متاح" : price > resistance ? "فوق المقاومة" : "تحت المقاومة أو عندها", trading_zone: zone };
}

/** One quote basis per symbol. Levels keep their observation date; their distances
 * use the selected quote, never a hidden historical close beside a live price. */
export function synchronizeMarketSnapshot(input: ToolResult[]): ToolResult[] {
    const stocks = new Map<string, ToolResult>();
    for (const result of input) {
        if (result.tool !== "get_stock" || result.error || (finiteMetric(result.data?.price) ?? 0) <= 0) continue;
        const existing = stocks.get(symbolOf(result));
        if (!existing || timeOf(result.data_time) >= timeOf(existing.data_time)) stocks.set(symbolOf(result), result);
    }
    return input.map(result => {
        if (result.tool === "get_stock_levels" && result.data) {
            const stock = stocks.get(symbolOf(result));
            const basisDate = result.data.quote_basis?.as_of || result.data_time;
            const useStock = stock && Number.isFinite(timeOf(stock.data_time)) && Number.isFinite(timeOf(basisDate)) && timeOf(stock.data_time) >= timeOf(basisDate);
            const price = finiteMetric(useStock ? stock.data.price : result.data.close);
            if (price == null || price <= 0) return result;
            const support = finiteMetric(result.data.support), resistance = finiteMetric(result.data.resistance);
            return { ...result, data: { ...result.data, close: price,
                levels_as_of: result.data.levels_as_of || result.data_time,
                quote_basis: { price, as_of: useStock ? stock.data_time : Number.isFinite(timeOf(basisDate)) ? basisDate : null, source: useStock ? stock.source : result.source,
                    kind: useStock && stock.data.is_live_intraday ? "live_intraday" : "daily_close" },
                ...pricePosition(price, support, resistance) } };
        }
        if (result.tool !== "get_comparison" || !result.data) return result;
        const oldRows = Array.isArray(result.data.comparisons) ? result.data.comparisons : [];
        const symbols: string[] = result.symbols?.length ? result.symbols : oldRows.map((r: any) => r.symbol);
        const rows = symbols.map(symbol => {
            const upper = String(symbol).toUpperCase();
            const entry = result.data[upper] || (upper === result.symbols?.[0] ? result.data.sym1 : result.data.sym2);
            const old = oldRows.find((r: any) => String(r.symbol).toUpperCase() === upper) || {
                symbol: upper, name: entry?.info?.name || upper, price: entry?.price?.close ?? entry?.tech?.close,
                change_pct: entry?.tech?.change_pct, rsi_14: entry?.tech?.rsi_14,
                macd: entry?.tech?.macd, macd_signal: entry?.tech?.macd_signal,
                vol_ratio: entry?.tech?.volume_ratio ?? (Number(entry?.tech?.vol_sma20) > 0 ? Number(entry.tech.volume) / Number(entry.tech.vol_sma20) : null),
            };
            const oldDate = Object.prototype.hasOwnProperty.call(old, "as_of") ? old.as_of
                : Object.prototype.hasOwnProperty.call(entry || {}, "as_of") ? entry.as_of
                : entry?.price?.date || entry?.tech?.date || result.data_time;
            const stock = stocks.get(upper);
            if (!stock || !Number.isFinite(timeOf(stock.data_time)) || !Number.isFinite(timeOf(oldDate)) || timeOf(stock.data_time) < timeOf(oldDate)) return { ...old, symbol: upper, as_of: Number.isFinite(timeOf(oldDate)) ? oldDate : null,
                source: old.source || result.source, quote_kind: old.quote_kind || "daily_close" };
            const d = stock.data;
            return { ...old, symbol: upper, name: d.name || old.name, price: finiteMetric(d.price),
                change_pct: finiteMetric(d.change_pct_num ?? d.change_pct), rsi_14: finiteMetric(d.rsi_14_num ?? d.rsi_14),
                macd: finiteMetric(d.macd), macd_signal: finiteMetric(d.macd_signal_num ?? d.macd_signal),
                vol_ratio: finiteMetric(d.vol_ratio_num ?? d.vol_ratio),
                king_ai_score: d.king_ai_score ?? null, egx_ai_score: d.egx_ai_score ?? null,
                metric_dates: d.metric_dates || {},
                as_of: stock.data_time, source: stock.source, quote_kind: d.is_live_intraday ? "live_intraday" : "daily_close" };
        });
        if (!rows.length) return result;
        const data: any = { ...result.data, comparisons: rows };
        for (const row of rows) {
            const oldEntry = result.data[row.symbol] || {};
            data[row.symbol] = { ...oldEntry, info: { ...oldEntry.info, symbol: row.symbol, name: row.name },
                price: { close: row.price, date: row.as_of }, tech: { ...oldEntry.tech, close: row.price,
                    change_pct: row.change_pct, rsi_14: row.rsi_14, macd: row.macd, macd_signal: row.macd_signal,
                    volume_ratio: row.vol_ratio, metric_dates: row.metric_dates || {}, date: row.as_of }, as_of: row.as_of, quote_kind: row.quote_kind };
        }
        data.sym1 = data[rows[0].symbol]; data.sym2 = rows[1] ? data[rows[1].symbol] : null;
        const allLive = rows.every((r: any) => r.quote_kind === "live_intraday");
        data.snapshot_policy = "latest_quote_per_symbol";
        data.is_live_intraday = allLive;
        data.component_dates = Object.fromEntries(rows.map((r: any) => [r.symbol, r.as_of]));
        return { ...result, data, source: allLive ? "live_session" : "database",
            data_type: allLive ? "live" : "historical", data_time: rows.map((r: any) => r.as_of).filter(Boolean).sort()[0] || "" };
    });
}
