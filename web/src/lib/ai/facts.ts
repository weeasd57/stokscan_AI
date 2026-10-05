/**
 * facts.ts
 *
 * Provenance-bound fact records. Every numeric fact the responder may cite is
 * bound to (symbol, field, unit, as_of, source) BEFORE the answer is written,
 * so the pre-send gate can reject a number that is not attributed to the right
 * stock and metric. A number merely appearing somewhere in the tool payload is
 * not evidence for a claim about a specific stock/field.
 */

export type FactField =
    | "price"
    | "change_pct"
    | "rsi"
    | "macd"
    | "macd_signal"
    | "vol_ratio"
    | "volume"
    | "value"
    | "support"
    | "resistance"
    | "sma_50"
    | "sma_200"
    | "ema_50"
    | "ema_200"
    | "bb_upper"
    | "bb_lower"
    | "acc_score"
    | "dist_score"
    | "consecutive_acc_days"
    | "consecutive_dist_days"
    | "highest_price"
    | "king_ai_score"
    | "egx_ai_score"
    | "premium_pct"
    | "close"
    | "market_value"
    | "cost_basis"
    | "profit_pct"
    | "profit_value"
    | "quantity"
    | "entry_price"
    | "target_price"
    | "stop_loss"
    | "exit_price"
    | "distance_from_support_pct"
    | "distance_from_resistance_pct"
    | "position_pct";

export type FactUnit = "egp" | "percent" | "ratio" | "points" | "count" | "unitless" | "shares";

export interface FactRecord {
    id: string;
    symbol: string | null;
    field: FactField;
    value: number;
    unit: FactUnit;
    as_of: string | null;
    source: string;
    tool: string;
    fetched_at: string;
    /** Populated for derived values so the gate can verify the formula, not just the number. */
    derived_from?: { field: FactField; symbol: string | null }[];
    formula?: string;
}

const FIELD_UNITS: Record<FactField, FactUnit> = {
    price: "egp",
    close: "egp",
    change_pct: "percent",
    rsi: "points",
    macd: "unitless",
    macd_signal: "unitless",
    vol_ratio: "ratio",
    volume: "shares",
    value: "egp",
    support: "egp",
    resistance: "egp",
    sma_50: "egp",
    sma_200: "egp",
    ema_50: "egp",
    ema_200: "egp",
    bb_upper: "egp",
    bb_lower: "egp",
    acc_score: "points",
    dist_score: "points",
    consecutive_acc_days: "count",
    consecutive_dist_days: "count",
    highest_price: "egp",
    king_ai_score: "unitless",
    egx_ai_score: "unitless",
    premium_pct: "percent",
    market_value: "egp",
    cost_basis: "egp",
    profit_pct: "percent",
    profit_value: "egp",
    quantity: "shares",
    entry_price: "egp",
    target_price: "egp",
    stop_loss: "egp",
    exit_price: "egp",
    distance_from_support_pct: "percent",
    distance_from_resistance_pct: "percent",
    position_pct: "percent",
};

const VALUE_KEYS: Array<{ key: string; field: FactField }> = [
    { key: "price", field: "price" },
    { key: "close", field: "close" },
    { key: "current_price", field: "price" },
    { key: "valuation_price", field: "price" },
    { key: "change_pct", field: "change_pct" },
    { key: "change_pct_num", field: "change_pct" },
    { key: "change", field: "change_pct" },
    { key: "return_pct", field: "profit_pct" },
    { key: "rsi_14", field: "rsi" },
    { key: "rsi_14_num", field: "rsi" },
    { key: "macd", field: "macd" },
    { key: "macd_signal", field: "macd_signal" },
    { key: "macd_signal_num", field: "macd_signal" },
    { key: "vol_ratio", field: "vol_ratio" },
    { key: "vol_ratio_num", field: "vol_ratio" },
    { key: "volRatio", field: "vol_ratio" },
    { key: "volume", field: "volume" },
    { key: "value", field: "value" },
    { key: "support", field: "support" },
    { key: "resistance", field: "resistance" },
    { key: "sma_50", field: "sma_50" },
    { key: "sma_200", field: "sma_200" },
    { key: "ema_50", field: "ema_50" },
    { key: "ema_200", field: "ema_200" },
    { key: "bb_upper", field: "bb_upper" },
    { key: "bb_lower", field: "bb_lower" },
    { key: "acc_score", field: "acc_score" },
    { key: "dist_score", field: "dist_score" },
    { key: "consecutive_acc_days", field: "consecutive_acc_days" },
    { key: "consecutive_dist_days", field: "consecutive_dist_days" },
    { key: "king_ai_score", field: "king_ai_score" },
    { key: "egx_ai_score", field: "egx_ai_score" },
    { key: "premium_pct", field: "premium_pct" },
    { key: "quantity", field: "quantity" },
    { key: "entry_price", field: "entry_price" },
    { key: "entry", field: "entry_price" },
    { key: "target_price", field: "target_price" },
    { key: "target", field: "target_price" },
    { key: "stop_loss", field: "stop_loss" },
    { key: "stop", field: "stop_loss" },
    { key: "exit_price", field: "exit_price" },
    { key: "exit", field: "exit_price" },
    { key: "profit_loss_pct", field: "profit_pct" },
    { key: "market_value", field: "market_value" },
    { key: "cost_basis", field: "cost_basis" },
    { key: "profit_pct", field: "profit_pct" },
    { key: "profit_value", field: "profit_value" },
    { key: "distance_from_support_pct", field: "distance_from_support_pct" },
    { key: "distance_from_resistance_pct", field: "distance_from_resistance_pct" },
    { key: "position_pct", field: "position_pct" },
];

function toNumber(value: unknown): number | null {
    if (value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const cleaned = String(value).replace(/,/g, "").replace(/[%xX×✕]/g, "").replace(/^[+]/, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSymbol(symbol: unknown): string | null {
    if (symbol == null) return null;
    const clean = String(symbol).trim().toUpperCase();
    return clean || null;
}

function recordKey(symbol: string | null, field: FactField, asOf: string | null): string {
    return `${symbol || "MARKET"}::${field}::${asOf || "unknown"}`;
}

/**
 * Flattens tool results into provenance-bound fact records. Values are read
 * once at the tool boundary; the answer writer may only cite these records.
 */
export function buildFactRecords(toolResults: any[], fetchedAt = new Date().toISOString()): FactRecord[] {
    const records: FactRecord[] = [];
    const seen = new Set<string>();

    const push = (
        symbol: string | null,
        field: FactField,
        raw: unknown,
        meta: { as_of: string | null; source: string; tool: string }
    ) => {
        const value = toNumber(raw);
        if (value == null) return;
        const id = recordKey(symbol, field, meta.as_of);
        if (seen.has(id)) return;
        seen.add(id);
        records.push({
            id,
            symbol,
            field,
            value,
            unit: FIELD_UNITS[field] || "unitless",
            as_of: meta.as_of || null,
            source: meta.source || "unknown",
            tool: meta.tool || "unknown",
            fetched_at: fetchedAt,
        });
    };

    const ingestObject = (symbol: string | null, data: any, meta: { as_of: string | null; source: string; tool: string }) => {
        if (!data || typeof data !== "object") return;
        for (const { key, field } of VALUE_KEYS) {
            if (data[key] != null) {
                const quoteBased = ["close", "distance_from_support_pct", "distance_from_resistance_pct", "position_pct"].includes(field);
                let factMeta = data.quote_basis && quoteBased ? { ...meta, as_of: data.quote_basis.as_of || null,
                    source: data.quote_basis.source || meta.source } : meta;
                const dateKey = Object.prototype.hasOwnProperty.call(data.metric_dates || {}, key) ? key
                    : key.endsWith("_num") && Object.prototype.hasOwnProperty.call(data.metric_dates || {}, key.slice(0, -4)) ? key.slice(0, -4) : field;
                if (Object.prototype.hasOwnProperty.call(data.metric_dates || {}, dateKey)) {
                    const observedDate = data.metric_dates[dateKey];
                    factMeta = { ...factMeta, as_of: observedDate && Number.isFinite(Date.parse(observedDate)) ? observedDate : null };
                }
                push(symbol, field, data[key], factMeta);
            }
        }
        if (data.highest_250_sessions?.price != null) {
            push(symbol, "highest_price", data.highest_250_sessions.price, meta);
        }
    };

    if (!Array.isArray(toolResults)) return records;

    for (const result of toolResults) {
        const meta = {
            as_of: result?.data_time && Number.isFinite(Date.parse(result.data_time)) ? String(result.data_time) : null,
            source: result?.source || "unknown",
            tool: result?.tool || "unknown",
        };
        const data = result?.data;
        if (!data || typeof data !== "object") continue;

        if (Array.isArray(data)) {
            for (const item of data) {
                if (item?.symbol) {
                    const itemDate = item.signal_date || item.created_at || item.current_date || item.date || meta.as_of;
                    const itemMeta = {
                        ...meta,
                        as_of: itemDate && Number.isFinite(Date.parse(itemDate)) ? String(itemDate) : meta.as_of,
                    };
                    ingestObject(normalizeSymbol(item.symbol), item, itemMeta);
                }
            }
        }
        if (data.symbol) {
            ingestObject(normalizeSymbol(data.symbol), data, meta);
            if (data.recommendation?.has_recommendation) {
                const recDate = data.recommendation.created_at;
                ingestObject(normalizeSymbol(data.symbol), data.recommendation, { ...meta,
                    as_of: recDate && Number.isFinite(Date.parse(recDate)) ? recDate : null });
            }
        }
        if (Array.isArray(data.stocks)) {
            for (const stock of data.stocks) {
                if (stock?.symbol) ingestObject(normalizeSymbol(stock.symbol), stock, meta);
            }
        }
        if (Array.isArray(data.scan_rows)) {
            for (const row of data.scan_rows) {
                if (row?.symbol) ingestObject(normalizeSymbol(row.symbol), row, { ...meta, as_of: row.as_of ?? meta.as_of, source: row.source || meta.source });
            }
        }
        if (Array.isArray(data.comparisons)) {
            for (const row of data.comparisons) {
                if (row?.symbol) ingestObject(normalizeSymbol(row.symbol), row, { ...meta,
                    as_of: Object.prototype.hasOwnProperty.call(row, "as_of") ? row.as_of : meta.as_of,
                    source: row.source || meta.source });
            }
        }
        if (Array.isArray(data.top_gainers)) {
            for (const item of data.top_gainers) {
                if (item?.symbol) ingestObject(normalizeSymbol(item.symbol), item, meta);
            }
        }
        if (Array.isArray(data.top_losers)) {
            for (const item of data.top_losers) {
                if (item?.symbol) ingestObject(normalizeSymbol(item.symbol), item, meta);
            }
        }
        if (Array.isArray(data.gainers)) {
            for (const item of data.gainers) {
                if (item?.symbol) ingestObject(normalizeSymbol(item.symbol), item, meta);
            }
        }
        if (Array.isArray(data.losers)) {
            for (const item of data.losers) {
                if (item?.symbol) ingestObject(normalizeSymbol(item.symbol), item, meta);
            }
        }
        if (Array.isArray(data.market_period_ranking)) {
            for (const item of data.market_period_ranking) {
                if (item?.symbol) ingestObject(normalizeSymbol(item.symbol), item, meta);
            }
        }
        if (result?.tool === "get_comparison") {
            for (const key of Object.keys(data)) {
                const upper = normalizeSymbol(key);
                if (!upper || !/^[A-Z]{2,6}$/.test(upper) || ["SYM1", "SYM2"].includes(upper)) continue;
                const nested = data[key];
                if (nested && typeof nested === "object") {
                    const nestedDate = Object.prototype.hasOwnProperty.call(nested, "as_of") ? nested.as_of : nested.price?.date || nested.tech?.date || meta.as_of;
                    const nestedMeta = { ...meta, as_of: nestedDate && Number.isFinite(Date.parse(nestedDate)) ? nestedDate : null };
                    ingestObject(upper, nested, nestedMeta);
                    if (nested.price && typeof nested.price === "object") ingestObject(upper, nested.price, nestedMeta);
                    if (nested.tech && typeof nested.tech === "object") ingestObject(upper, nested.tech, nestedMeta);
                    if (nested.info && typeof nested.info === "object") ingestObject(upper, nested.info, nestedMeta);
                }
            }
        }
        if (Array.isArray(data.positions)) {
            for (const position of data.positions) {
                if (position?.symbol) ingestObject(normalizeSymbol(position.symbol), position, meta);
            }
        }
    }

    return records;
}

/**
 * Finds a fact bound to a specific symbol + field. This is the ONLY lookup the
 * answer gate trusts: a number that matches some other stock or field is not a
 * source for the claim under review.
 */
export function findFact(
    records: FactRecord[],
    symbol: string | null,
    field: FactField,
    asOf?: string | null
): FactRecord | null {
    const targetSymbol = normalizeSymbol(symbol);
    const candidates = records.filter(
        record => record.field === field && normalizeSymbol(record.symbol) === targetSymbol
    );
    if (candidates.length === 0) return null;
    if (asOf) {
        const exact = candidates.find(record => record.as_of === asOf);
        if (exact) return exact;
    }
    // Prefer the freshest as_of for the same symbol+field binding.
    return candidates.slice().sort((a, b) => String(b.as_of || "").localeCompare(String(a.as_of || "")))[0];
}

/** All fact values recorded for a symbol+field pair, so alternate legitimate prices still match. */
export function factValues(records: FactRecord[], symbol: string | null, field: FactField): number[] {
    const targetSymbol = normalizeSymbol(symbol);
    return records
        .filter(record => record.field === field && normalizeSymbol(record.symbol) === targetSymbol)
        .map(record => record.value);
}
