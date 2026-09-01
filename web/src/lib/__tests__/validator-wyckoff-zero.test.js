/**
 * Regression tests for Wyckoff claim validation, especially the AMES incident
 * (2026-09-01): honest zero-value reporting like "درجة التجميع (acc_score) = 0"
 * must NOT be flagged as an unproven accumulation claim or a phase conflict,
 * while real unproven directional claims must still be rejected.
 */
const { validateDeterministicRules } = require("../ai/validator");

const getStockNeutral = {
    tool: "get_stock",
    source: "database",
    data_time: "2026-08-31",
    data_type: "live",
    symbols: ["AMES"],
    data: {
        symbol: "AMES",
        close: 130.73,
        change_pct: -5.95,
        rsi_14: 57.0,
        macd: 10.19,
        macd_signal: 11.48,
        vol_ratio: "0.52x",
        wyckoff_phase: "neutral",
        acc_score: 0,
        dist_score: 0
    }
};

const getDistributionFallback = {
    tool: "get_distribution_stocks",
    source: "stock_technical_indicators",
    data_time: "2026-08-31",
    data_type: "live",
    symbols: ["AMES"],
    data: {
        date: "2026-08-31",
        direction: "distribution",
        stocks: [
            {
                symbol: "AMES",
                name: "Alexandria New Medical Center Co.",
                scan_date: "2026-08-31",
                signal: "distribution",
                wyckoff_phase: "Distribution",
                dist_score: 60,
                acc_score: 0,
                vol_ratio: "0.52",
                change_pct: "-5.95",
                rsi_14: "57.00",
                close: 130.73
            }
        ]
    }
};

describe("Wyckoff zero-value honest reporting (AMES incident)", () => {
    test("honest zero accumulation score is not an unproven claim", () => {
        const reply = "AMES: مسح Wyckoff بتاريخ 2026-08-31 يُظهر السهم في مرحلة تصريف (Distribution) بدرجة تصريف 60. درجة التجميع (acc_score) = 0.";
        const errors = validateDeterministicRules(reply, [getStockNeutral, getDistributionFallback], "حلل AMES", "stock_analysis");
        expect(errors).toEqual([]);
    });

    test("reporting both scores in one sentence does not trigger a phase conflict", () => {
        const reply = "AMES في مرحلة تصريف بدرجة تصريف 60 ودرجة تجميع 0 حسب مسح 2026-08-31.";
        const errors = validateDeterministicRules(reply, [getStockNeutral, getDistributionFallback], "حلل AMES", "stock_analysis");
        expect(errors).toEqual([]);
    });

    test("zero distribution score with accumulation data is not a conflict", () => {
        const accStock = { ...getStockNeutral, data: { ...getStockNeutral.data, wyckoff_phase: "accumulation", acc_score: 80, dist_score: 0 } };
        const reply = "AMES في مرحلة تجميع بدرجة تجميع 80. درجة التصريف (dist_score) = 0.";
        const errors = validateDeterministicRules(reply, [accStock], "حلل AMES", "stock_analysis");
        expect(errors).toEqual([]);
    });

    test("'صفر' spelled out is also treated as zero-value reporting", () => {
        const reply = "AMES: درجة التجميع صفر والمرحلة الحالية محايدة، بينما درجة التصريف 60.";
        const errors = validateDeterministicRules(reply, [getStockNeutral, getDistributionFallback], "حلل AMES", "stock_analysis");
        expect(errors.filter(e => e.includes("تجميع") || e.includes("تعارض"))).toEqual([]);
    });

    test("real unproven accumulation claim is still rejected", () => {
        const reply = "AMES في مرحلة تجميع قوية جداً الآن.";
        const errors = validateDeterministicRules(reply, [getStockNeutral], "حلل AMES", "stock_analysis");
        expect(errors.some(e => e.includes("ادعاء تجميع"))).toBe(true);
    });

    test("real unproven distribution claim is still rejected", () => {
        const neutralNoScan = { ...getStockNeutral, data: { ...getStockNeutral.data, wyckoff_phase: null, acc_score: null, dist_score: null } };
        const reply = "AMES في مرحلة تصريف واضحة الآن.";
        const errors = validateDeterministicRules(reply, [neutralNoScan], "حلل AMES", "stock_analysis");
        expect(errors.some(e => e.includes("ادعاء تصريف"))).toBe(true);
    });

    test("distribution claim contradicting real accumulation scan is still a conflict", () => {
        const accScan = {
            tool: "get_accumulation_stocks",
            source: "stock_scans_summary",
            data_time: "2026-08-31",
            data_type: "live",
            symbols: ["AMES"],
            data: {
                date: "2026-08-31",
                direction: "accumulation",
                stocks: [
                    { symbol: "AMES", scan_date: "2026-08-31", signal: "accumulation", wyckoff_phase: "accumulation", acc_score: 80, dist_score: 0 }
                ]
            }
        };
        const neutralStock = { ...getStockNeutral, data: { ...getStockNeutral.data, wyckoff_phase: "accumulation", acc_score: 80, dist_score: 0 } };
        const reply = "AMES في مرحلة تصريف واضحة الآن.";
        const errors = validateDeterministicRules(reply, [neutralStock, accScan], "حلل AMES", "stock_analysis");
        expect(errors.some(e => e.includes("تعارض"))).toBe(true);
    });

    test("non-zero values are not excluded by the zero-value patterns", () => {
        // "0.52x" volume must NOT zero-exclude the accumulation claim below.
        const noEvidence = { ...getStockNeutral, data: { ...getStockNeutral.data, wyckoff_phase: null, acc_score: null, dist_score: null } };
        const reply = "AMES يجمع سيولة بنسبة حجم 0.52x وهو في مرحلة تجميع.";
        const errors = validateDeterministicRules(reply, [noEvidence], "حلل AMES", "stock_analysis");
        expect(errors.some(e => e.includes("ادعاء تجميع"))).toBe(true);
    });
});
