import { describe, expect, it } from "@jest/globals";
import { attachEvidenceContract } from "../evidence";
import { buildSingleStockAccumulationDistributionResponse, normalizeStockFreshnessLanguage } from "../final-v2";

describe("tool evidence contract", () => {
    it("marks cached database facts as stale and attaches their source date", () => {
        const output = attachEvidenceContract({
            formattedText: "",
            results: [{
                tool: "get_stock",
                source: "database",
                data_time: "2026-09-14",
                data_type: "cached" as const,
                symbols: ["COMI"],
                data: { symbol: "COMI", price: 100 },
            }],
        });

        expect(output.results[0].availability).toBe("stale");
        expect(output.results[0].evidence?.[0]).toEqual(expect.objectContaining({
            source: "database",
            as_of: "2026-09-14",
        }));
    });

    it("answers a named accumulation question from the scoped scan without inventing a current price", () => {
        const response = buildSingleStockAccumulationDistributionResponse(
            "هل في تجميع على ELSH",
            {
                intent: "accumulation_distribution",
                confidence: 1,
                entities: { symbols: ["ELSH"], sector: null, timeframe: "current", reference: null },
                needs_vision_context: false,
                needs_history: false,
                needs_live_data: true,
                needs_historical_data: false,
                tools: ["get_accumulation_stocks"],
                clarification_needed: false,
                resolved_from: { symbol: null, message_id: null },
            },
            [{
                tool: "get_accumulation_stocks",
                source: "stock_scans_summary",
                data_time: "2026-09-15",
                data_type: "historical",
                symbols: ["ELSH"],
                data: {
                    direction: "accumulation",
                    scan_rows: [{ symbol: "ELSH", acc_score: 44, dist_score: 61, vol_ratio: 1.2, rsi_14: 48, wyckoff_phase: "distribution" }],
                },
            }],
        );

        expect(response).toContain("ELSH");
        expect(response).toContain("44/100");
        expect(response).toContain("61/100");
        expect(response).not.toContain("السعر الحالي");
    });

    it("normalizes midpoint-scan terminology before a reply reaches the user", () => {
        const response = normalizeStockFreshnessLanguage(
            "السهم أقل من قيمته العادلة، وهذه بيانات حية.",
            [{
                tool: "get_fair_value_scan",
                source: "stock_prices",
                data_time: "2026-09-15",
                data_type: "cached",
                symbols: ["COMI"],
                data: { metric: "price_below_60_session_midpoint", stocks: [{ symbol: "COMI" }] },
            }],
        );

        expect(response).toContain("القيمة الوسطية الفنية لنطاقه");
        expect(response).toContain("أحدث البيانات المتاحة");
        expect(response).not.toContain("قيمته العادلة");
        expect(response).not.toContain("بيانات حية");
    });
});
