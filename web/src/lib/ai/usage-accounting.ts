/** Versioned estimates, never a replacement for the provider's invoice.
 * Source: https://api-docs.deepseek.com/quick_start/pricing/ (2026-10-10).
 * Weekday peak estimates may overstate Chinese public-holiday charges.
 */
export interface UsageCall {
    provider: string; model: string; stage: string; created_at: string;
    prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null;
    cache_hit_tokens: number | null; cache_miss_tokens: number | null;
    cost_usd: number | null; pricing_version: string | null;
}
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function priceCall(call: UsageCall): number | null {
    if (call.provider !== "deepseek" || call.prompt_tokens === null || call.completion_tokens === null) return null;
    const flash = ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(call.model);
    if (!flash && call.model !== "deepseek-v4-pro") return null;
    const date = new Date(call.created_at);
    if (!Number.isFinite(date.getTime())) return null;
    const weekday = date.getUTCDay() !== 0 && date.getUTCDay() !== 6;
    const hour = date.getUTCHours();
    const factor = weekday && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)) ? 1 : 0.5;
    const [hitRate, missRate, outputRate] = flash ? [0.006, 0.3, 1.2] : [0.044, 1.32, 3.96];
    // Missing cache breakdown uses the cache-miss rate: a visible upper estimate.
    const hit = Math.min(call.prompt_tokens, call.cache_hit_tokens ?? 0);
    return ((hit * hitRate + (call.prompt_tokens - hit) * missRate + call.completion_tokens * outputRate) * factor) / 1_000_000;
}
export function createUsageAccounting() {
    const calls: UsageCall[] = [];
    const start = (provider: string, model: string, stage: string) => {
        const call: UsageCall = { provider, model, stage, created_at: new Date().toISOString(), prompt_tokens: null,
            completion_tokens: null, total_tokens: null, cache_hit_tokens: null, cache_miss_tokens: null, cost_usd: null, pricing_version: null };
        calls.push(call);
        return (json: any) => {
            if (typeof json?.model === "string") call.model = json.model;
            const usage = json?.usage;
            call.prompt_tokens = count(usage?.prompt_tokens);
            call.completion_tokens = count(usage?.completion_tokens);
            call.total_tokens = count(usage?.total_tokens);
            call.cache_hit_tokens = count(usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens);
            call.cache_miss_tokens = count(usage?.prompt_cache_miss_tokens);
            call.cost_usd = priceCall(call);
            call.pricing_version = call.cost_usd === null ? null : "deepseek-2026-10-10";
        };
    };
    const summary = (toolCalls = 0) => {
        const missing = calls.filter(call => call.cost_usd === null).length;
        const sum = (key: "prompt_tokens" | "completion_tokens" | "total_tokens") => calls.reduce((total, call) => total + (call[key] ?? 0), 0);
        const known = calls.reduce((total, call) => total + (call.cost_usd ?? 0), 0);
        return { prompt_tokens: sum("prompt_tokens"), completion_tokens: sum("completion_tokens"), total_tokens: sum("total_tokens"),
            provider_calls: calls.length, tool_calls: toolCalls, model: calls.find(call => call.stage === "chat")?.model ?? calls[0]?.model ?? null,
            cost_usd: missing ? null : known, known_cost_usd: known, unpriced_calls: missing, cost_status: missing ? "unavailable" : "estimated",
            calls: calls.map(call => ({ ...call })) };
    };
    return { start, summary };
}
export function summarizeUsage(rows: Array<{ metadata?: any }>) {
    let cost = 0, unpriced = 0, tokens = 0;
    for (const row of rows) {
        const usage = row.metadata?.usage;
        const value = usage?.cost_usd;
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) cost += value;
        else { unpriced++; if (typeof usage?.known_cost_usd === "number" && Number.isFinite(usage.known_cost_usd) && usage.known_cost_usd >= 0) cost += usage.known_cost_usd; }
        if (typeof usage?.total_tokens === "number" && Number.isFinite(usage.total_tokens) && usage.total_tokens >= 0) tokens += usage.total_tokens;
    }
    return { cost_usd: cost, unpriced_messages: unpriced, total_tokens: tokens, messages: rows.length };
}
