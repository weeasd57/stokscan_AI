import { describe, expect, it, jest } from "@jest/globals";
import { isDailySyncComplete, shouldPreferLiveBeforeSync } from "../sync-gate";

describe("daily sync source gate", () => {
    it("keeps live preference during the post-close sync window", () => {
        expect(shouldPreferLiveBeforeSync(new Date("2026-09-16T15:30:00+03:00"))).toBe(true);
        expect(shouldPreferLiveBeforeSync(new Date("2026-09-16T18:01:00+03:00"))).toBe(false);
    });

    it("requires a completed daily job and current stock date", async () => {
        const from = jest.fn((table: string) => {
            if (table === "daily_job_runs") {
                return {
                                    select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ status: "completed", completed_at: "2026-09-16T17:45:00Z", steps: [{ name: "sync_prices", status: "started" }, { name: "sync_prices", status: "success" }] }] }) }) }) }) }),
                };
            }
            return {
                select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ date: "2026-09-16" }] }) }) }) }),
            };
        });
        expect(await isDailySyncComplete({ from })).toBe(true);
    });

    it("rejects a completed job whose price snapshot is stale", async () => {
        const from = jest.fn((table: string) => table === "daily_job_runs"
            ? { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ status: "completed", completed_at: "2026-09-16T17:45:00Z", steps: [] }] }) }) }) }) }) }
            : { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ date: "2026-09-15" }] }) }) }) }) });
        expect(await isDailySyncComplete({ from })).toBe(false);
    });

    it("rejects a completed job without an explicit price-sync step", async () => {
        const from = jest.fn((table: string) => table === "daily_job_runs"
            ? { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ status: "completed", completed_at: "2026-09-16T17:45:00Z", steps: [] }] }) }) }) }) }) }
            : { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ date: "2026-09-16" }] }) }) }) }) });
        expect(await isDailySyncComplete({ from })).toBe(false);
    });

    it("rejects newer prices from an older completed job", async () => {
        const from = jest.fn((table: string) => table === "daily_job_runs"
            ? { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ status: "completed", completed_at: "2026-09-15T17:45:00Z", steps: [{ name: "sync_prices", status: "success" }] }] }) }) }) }) }) }
            : { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ date: "2026-09-16" }] }) }) }) }) });
        expect(await isDailySyncComplete({ from })).toBe(false);
    });

    it("rejects a lone success step without a recorded start", async () => {
        const from = jest.fn((table: string) => table === "daily_job_runs"
            ? { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ status: "completed", completed_at: "2026-09-16T17:45:00Z", steps: [{ name: "sync_prices", status: "success" }] }] }) }) }) }) }) }
            : { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ date: "2026-09-16" }] }) }) }) }) });
        expect(await isDailySyncComplete({ from })).toBe(false);
    });
});
