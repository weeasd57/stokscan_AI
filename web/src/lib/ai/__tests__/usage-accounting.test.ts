import { createUsageAccounting, priceCall, summarizeUsage, UsageCall } from "../usage-accounting";
const call = (overrides: Partial<UsageCall> = {}): UsageCall => ({ provider: "deepseek", model: "deepseek-flash", stage: "chat", created_at: "2026-10-12T02:00:00Z", prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, cache_hit_tokens: 500, cache_miss_tokens: 500, cost_usd: null, pricing_version: null, ...overrides });
test("cache-aware peak and weekend rates, unknown prices remain unavailable", () => {
    expect(priceCall(call())).toBeCloseTo(0.000273, 10);
    expect(priceCall(call({ created_at: "2026-10-10T02:00:00Z" }))).toBeCloseTo(0.0001365, 10);
    expect(priceCall(call({ cache_hit_tokens: null }))).toBeCloseTo(0.00042, 10);
    expect(priceCall(call({ model: "unknown" }))).toBeNull();
    expect(priceCall(call({ provider: "nvidia" }))).toBeNull();
    expect(priceCall(call({ completion_tokens: null }))).toBeNull();
});
test("includes retries, vision, review and known usage before an aborted call", () => {
    const accounting = createUsageAccounting();
    accounting.start("deepseek", "deepseek-flash", "vision")({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
    accounting.start("deepseek", "deepseek-flash", "chat")({ usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 } });
    accounting.start("deepseek", "deepseek-flash", "chat");
    const result = accounting.summary(2);
    expect(result).toMatchObject({ prompt_tokens: 300, completion_tokens: 50, total_tokens: 350, provider_calls: 3, tool_calls: 2, cost_usd: null, unpriced_calls: 1 });
    expect(result.known_cost_usd).toBeGreaterThan(0);
    expect(result.calls[0].stage).toBe("vision");
});
test("historical unknown costs are counted and partial known cost retained", () => {
    expect(summarizeUsage([{metadata: {usage: {cost_usd: 0.01, total_tokens: 100}}}, {metadata: null}, {metadata: {usage: {cost_usd: null, known_cost_usd: 0.02}}}])).toEqual({cost_usd: 0.03, messages: 3, total_tokens: 100, unpriced_messages: 2});
});
