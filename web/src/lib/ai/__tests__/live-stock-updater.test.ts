import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";

import { fetchLiveStockIndicators, isEgxSessionOpen } from "../live-stock-updater";

function tradingViewResponse() {
    return {
        ok: true,
        json: async () => ({
            data: [{
                d: ["Test", 123.45, 1.25, 1.52, 125, 120, 121, 50000, 55, 1.1, 0.8, 110, 100, 108, 98, 130, 95, 70, 65, 250000],
            }],
        }),
    };
}

function fakeSupabase(options: { technicalError?: boolean } = {}) {
    const calls: Array<{ table: string; payload: any; options?: any }> = [];
    const technical = {
        select: () => technical,
        eq: () => technical,
        limit: () => technical,
        maybeSingle: async () => ({ data: { king_ai_score: 0.4, egx_ai_score: 0.5 } }),
        upsert: async (payload: any, upsertOptions: any) => {
            calls.push({ table: "stock_technical_indicators", payload, options: upsertOptions });
            if (options.technicalError) throw new Error("technical write failed");
            return { error: null };
        },
    };
    const prices = {
        upsert: async (payload: any, upsertOptions: any) => {
            calls.push({ table: "stock_prices", payload, options: upsertOptions });
            return { error: null };
        },
    };
    return {
        calls,
        from: (table: string) => table === "stock_technical_indicators" ? technical : prices,
    };
}

describe("live quote precedence and Supabase persistence", () => {
    beforeEach(() => {
        jest.useFakeTimers({ now: new Date("2026-09-16T08:30:00.000Z") });
        jest.spyOn(global, "fetch").mockResolvedValue(tradingViewResponse() as Response);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("uses the Cairo session window and closes at 14:30", () => {
        expect(isEgxSessionOpen(new Date("2026-09-16T08:30:00.000Z"))).toBe(true);
        expect(isEgxSessionOpen(new Date("2026-09-16T11:30:00.000Z"))).toBe(true);
        expect(isEgxSessionOpen(new Date("2026-09-16T12:00:00.000Z"))).toBe(false);
        expect(isEgxSessionOpen(new Date("2026-09-18T08:30:00.000Z"))).toBe(false);
    });

    it("writes the live quote to the deployed Supabase table shapes", async () => {
        const supabase = fakeSupabase();
        const result = await fetchLiveStockIndicators("TESTLVA", supabase);

        expect(result.success).toBe(true);
        expect(result.data?.close).toBe(123.45);
        expect(result.persisted).toBe(true);
        expect(result.daily_persisted).toBe(true);
        expect(supabase.calls).toHaveLength(2);

        const technical = supabase.calls.find(call => call.table === "stock_technical_indicators")!;
        expect(technical.options).toEqual({ onConflict: "symbol,exchange,date" });
        expect(technical.payload).toEqual(expect.objectContaining({ symbol: "TESTLVA", date: "2026-09-16", close: 123.45 }));
        expect(technical.payload).not.toHaveProperty("updated_at");
        expect(technical.payload).toHaveProperty("calculated_at");

        const daily = supabase.calls.find(call => call.table === "stock_prices")!;
        expect(daily.options).toEqual({ onConflict: "symbol,exchange,date" });
        expect(daily.payload).toEqual(expect.objectContaining({ symbol: "TESTLVA", exchange: "EGX", date: "2026-09-16", close: 123.45 }));
        expect(daily.payload).toHaveProperty("updated_at");
        expect(daily.payload).not.toHaveProperty("source");
        expect(daily.payload).not.toHaveProperty("stock_id");
    });

    it("keeps the live quote usable but reports a Supabase persistence failure", async () => {
        const supabase = fakeSupabase({ technicalError: true });
        const result = await fetchLiveStockIndicators("TESTLVB", supabase);

        expect(result.success).toBe(true);
        expect(result.data?.close).toBe(123.45);
        expect(result.persisted).toBe(false);
        expect(result.daily_persisted).toBe(false);
        expect(result.persistence_error).toContain("technical write failed");
    });
});
