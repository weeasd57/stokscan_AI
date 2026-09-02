/**
 * Regression tests for the price-conflict check, especially the LUTS incident
 * (2026-09-02): during market hours get_stock reports the live intraday price
 * (0.984) while get_stock_levels reports the latest EOD close from stock_prices
 * (1.03). The old validator kept only the LAST price (1.03) and rejected honest
 * replies quoting the live price ("0.98" — also hit by a float-precision miss:
 * |0.98 - 1.03| > 0.05 by 4.4e-17).
 */
const { validateDeterministicRules, buildFactsBySymbol } = require("../ai/validator");

const getStockLive = {
    tool: "get_stock",
    source: "live_updater",
    data_time: "2026-09-02 12:57",
    data_type: "live",
    symbols: ["LUTS"],
    data: {
        symbol: "LUTS",
        close: 0.984,
        change_pct: "-4.47%",
        rsi_14: "60.79",
        macd: 0.1265,
        vol_ratio: "0.27x"
    }
};

const getStockLevelsEod = {
    tool: "get_stock_levels",
    source: "stock_prices",
    data_time: "2026-09-01",
    data_type: "live",
    symbols: ["LUTS"],
    data: {
        symbol: "LUTS",
        close: 1.03,
        support: 0.358184,
        resistance: 1.265
    }
};

describe("Price candidates: live vs EOD (LUTS incident)", () => {
    test("buildFactsBySymbol collects BOTH live and EOD prices as candidates", () => {
        const facts = buildFactsBySymbol([getStockLive, getStockLevelsEod]);
        expect(facts.LUTS.price).toBe(1.03); // last writer still wins for derived metrics
        expect(facts.LUTS.price_candidates).toEqual([0.984, 1.03]);
    });

    test("reply quoting the exact live price passes", () => {
        const reply = "LUTS: السعر الحالي 0.984 جنيه بنسبة تغير -4.47%.";
        const errors = validateDeterministicRules(reply, [getStockLive, getStockLevelsEod], "لوتس", "stock_analysis");
        expect(errors).toEqual([]);
    });

    test("reply quoting the live price ROUNDED to 0.98 passes (float-precision fix)", () => {
        const reply = "LUTS يتداول عند 0.98 جنيه في الجلسة الحالية.";
        const errors = validateDeterministicRules(reply, [getStockLive, getStockLevelsEod], "لوتس", "stock_analysis");
        expect(errors).toEqual([]);
    });

    test("reply quoting the EOD close also passes", () => {
        const reply = "LUTS أغلق عند 1.03 جنيه في آخر جلسة.";
        const errors = validateDeterministicRules(reply, [getStockLive, getStockLevelsEod], "لوتس", "stock_analysis");
        expect(errors).toEqual([]);
    });

    test("a hallucinated price is still rejected", () => {
        const reply = "LUTS يتداول عند 5.55 جنيه.";
        const errors = validateDeterministicRules(reply, [getStockLive, getStockLevelsEod], "لوتس", "stock_analysis");
        expect(errors.some(e => e.includes("تضارب في سعر"))).toBe(true);
    });

    test("single-source facts keep working (no candidates array needed)", () => {
        const reply = "LUTS يتداول عند 0.99 جنيه.";
        const errors = validateDeterministicRules(reply, [getStockLive], "لوتس", "stock_analysis");
        expect(errors).toEqual([]);
    });
});
