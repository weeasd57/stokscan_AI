import { percentageChangeSinceEntry } from "../recommendationMetrics";

export interface RecommendationCollection {
    matched_total: number | null;
    fetched_count: number;
    returned_count: number;
    excluded_count: number;
    complete: boolean;
    capped: boolean;
    fetch_failed: boolean;
}

export function positiveRecommendationPrice(value: unknown): number | null {
    if (value == null || typeof value === "boolean" || String(value).trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

/** Recomputes the displayed return from its displayed price evidence. Never
 * combines a fresh quote with a persisted percentage from an older snapshot. */
export function recommendationPerformance(row: any) {
    const entry = positiveRecommendationPrice(row?.entry_price);
    const status = String(row?.status || "").toLowerCase();
    const open = status === "open" || status === "active" || (!status.match(/^(win|loss|closed|target_hit|stop_hit)$/) && currentPricePresent(row));
    const closed = ["win", "loss", "closed", "target_hit", "stop_hit"].includes(status);
    const exit = positiveRecommendationPrice(row?.exit_price);
    const current = positiveRecommendationPrice(row?.current_price);
    const quoteDate = row?.quote_date || row?.current_date || null;
    const signalDate = row?.signal_date || row?.created_at || null;
    const quotePredatesSignal = quoteDate && signalDate && String(quoteDate).slice(0, 10) < String(signalDate).slice(0, 10);
    const price = open ? (quotePredatesSignal ? null : current) : closed ? exit : null;
    const change = entry != null && price != null ? percentageChangeSinceEntry(entry, price) : null;
    // SELL recommendations represent a bearish trade, not a long holding.
    const direction = String(row?.signal || "").toUpperCase() === "SELL" ? -1 : 1;
    const returnPct = change == null ? null : change * direction;
    return {
        return_pct: returnPct,
        return_basis: returnPct == null ? "unavailable" as const : open ? "open_mark_to_market" as const : "closed_realized" as const,
        valuation_price: price,
        valuation_date: open ? quoteDate : row?.exit_date || row?.closed_at || null,
        quote_date: quoteDate,
        signal_date: signalDate,
        outcome: returnPct == null ? "unknown" as const : returnPct > 0 ? "profit" as const : returnPct < 0 ? "loss" as const : "flat" as const,
    };
}

function currentPricePresent(row: any): boolean {
    return positiveRecommendationPrice(row?.current_price) != null;
}

export function summarizeRecommendationEvidence(data: unknown, collection?: RecommendationCollection) {
    const rows: any[] = Array.isArray(data) ? data : [];
    const performance = rows.map(recommendationPerformance);
    const counts = { profit: 0, loss: 0, flat: 0, unknown: 0 };
    performance.forEach(row => { counts[row.outcome] += 1; });
    const meta = collection || rows.find(row => row?.recommendation_collection)?.recommendation_collection || null;
    return {
        count: rows.length, ...counts,
        evaluated: rows.length - counts.unknown,
        open_count: rows.filter(row => ["open", "active"].includes(String(row?.status).toLowerCase())).length,
        realized_count: performance.filter(row => row.return_basis === "closed_realized").length,
        unrealized_count: performance.filter(row => row.return_basis === "open_mark_to_market").length,
        collection: meta as RecommendationCollection | null,
    };
}

/** Explicitly records truncation and mid-pagination failures instead of
 * presenting a first page as the complete recommendation list. */
export async function fetchRecommendationPages(
    fetchPage: (from: number, to: number) => PromiseLike<{ data: any[] | null; error?: unknown; count?: number | null }>,
    pageSize = 100,
    maxRows = 2000,
) {
    const rows: any[] = [];
    let matchedTotal: number | null = null;
    let complete = false;
    let fetchFailed = false;
    let error: unknown = null;
    while (rows.length < maxRows) {
        let page;
        try { page = await fetchPage(rows.length, Math.min(rows.length + pageSize, maxRows) - 1); }
        catch (failure) { error = failure; fetchFailed = true; break; }
        if (page.error) { error = page.error; fetchFailed = true; break; }
        if (typeof page.count === "number" && Number.isFinite(page.count)) matchedTotal = page.count;
        const batch = Array.isArray(page.data) ? page.data : [];
        rows.push(...batch);
        if (matchedTotal != null && rows.length >= matchedTotal) { complete = true; break; }
        if (!batch.length) {
            complete = matchedTotal == null || rows.length >= matchedTotal;
            if (complete && matchedTotal == null) matchedTotal = rows.length;
            break;
        }
    }
    return { rows, error, collection: {
        matched_total: matchedTotal, fetched_count: rows.length, returned_count: rows.length, excluded_count: 0,
        complete, capped: !complete && !fetchFailed && rows.length >= maxRows, fetch_failed: fetchFailed,
    } satisfies RecommendationCollection };
}
