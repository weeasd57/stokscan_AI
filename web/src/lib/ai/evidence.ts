import { ToolResult } from "./types";

type ToolOutputLike = {
    results: ToolResult[];
    formattedText: string;
};

function freshnessFor(asOf: string | null, isLiveQuote = false): "live" | "fresh" | "stale" | "unknown" {
    if (!asOf) return "unknown";
    const age = Date.now() - Date.parse(asOf);
    if (!Number.isFinite(age) || age < -60_000) return "unknown";
    if (isLiveQuote && age <= 5 * 60_000) return "live";
    return age <= 7 * 86400000 ? "fresh" : "stale";
}

/**
 * Normalises the evidence/availability contract at the tool boundary.
 * Keeping this here means direct tool callers and the full pipeline receive
 * the same metadata; callers no longer have to repair partial tool results.
 */
export function attachEvidenceContract<T extends ToolOutputLike>(tools: T): Omit<T, "results"> & ToolOutputLike {
    const fetchedAt = new Date().toISOString();
    return {
        ...tools,
        results: tools.results.map((result: ToolResult) => {
            const hasData = result.data != null
                && (Array.isArray(result.data)
                        ? result.data.length > 0
                        : typeof result.data === "object"
                            ? Object.keys(result.data).length > 0
                            : typeof result.data === "string" ? result.data.trim().length > 0 : true);
            const availability = result.availability
                || (result.data?.live_refresh_unsupported || result.data?.unsupported ? "unsupported"
                    : result.error ? (hasData ? "partial" : "failed")
                        : result.data?.live_refresh_failed ? "stale"
                            : result.data_type === "historical" || result.data_type === "cached" ? "stale"
                                : hasData ? "available" : "empty");

            if (Array.isArray(result.evidence) && result.evidence.length > 0) {
                return { ...result, availability };
            }

            const webResults = Array.isArray(result.data?.results) ? result.data.results
                : Array.isArray(result.data?.corporate_actions) ? result.data.corporate_actions : [];
            const evidence = webResults.length > 0
                ? webResults.slice(0, 10).map((item: any, index: number) => ({
                    id: `${result.tool}-${index}`,
                    source: item.domain || item.source || result.source,
                    url: item.url || null,
                    title: item.title || null,
                    as_of: item.published_at || null,
                    fetched_at: fetchedAt,
                    freshness: freshnessFor(item.published_at || null),
                    confidence: item.confidence ?? null,
                    claim: item.snippet || null,
                }))
                : result.source
                    ? [{
                        source: result.source,
                        as_of: result.data_time || null,
                        fetched_at: fetchedAt,
                        freshness: freshnessFor(result.data_time || null, result.source === "live_session" && result.data?.is_live_intraday === true),
                        confidence: null,
                        claim: null,
                    }]
                    : [];

            return { ...result, availability, evidence };
        }),
    };
}
