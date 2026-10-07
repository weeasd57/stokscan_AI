import { buildDeterministicPortfolioAnalysisResponse, buildV2FinalMessages } from "../final-v2";
import { IntentPlan, ToolResult } from "../types";

const plan = {
    intent: "stock_analysis",
    entities: { portfolio_operation: "view" },
    tools: ["manage_portfolio", "get_stock", "get_stock_levels"],
    ranking_metric: "unspecified",
} as IntentPlan;

const portfolio = (positions: unknown[]): ToolResult => ({
    tool: "manage_portfolio", source: "saved portfolio", data_time: "2026-10-07", symbols: [],
    data_type: "cached", data: { ok: true, positions },
});
const quote = (symbol: string, date: string, data: Record<string, unknown>): ToolResult => ({
    tool: "get_stock", source: "daily_prices", data_time: date, symbols: [symbol],
    data_type: "historical", data: { symbol, ...data },
});
const levels = (symbol: string, date: string, data: Record<string, unknown>): ToolResult => ({
    tool: "get_stock_levels", source: "support_resistance", data_time: date, symbols: [symbol],
    data_type: "historical", data: { symbol, ...data },
});
const render = (results: ToolResult[]) => buildDeterministicPortfolioAnalysisResponse("حلل محفظتي", plan, results);

describe("deterministic portfolio analysis factual boundaries", () => {
    test("RSI 30.9 stays neutral while the exact 30 boundary is oversold", () => {
        const reply = render([
            portfolio([{ symbol: "AMES", name: "AMES", quantity: 100, entry_price: 10, entry_at: "2026-09-20" }]),
            quote("AMES", "2026-10-07", { price: 11, rsi_14: 30.9, vol_ratio: 0.4 }),
        ])!;
        expect(reply).toContain("محايد (30–أقل من 70؛ 30.9)");
        expect(reply).not.toContain("تشبع بيعي (≤30؛ 30.9)");

        const boundary = render([
            portfolio([{ symbol: "AMES", quantity: 100, entry_price: 10 }]),
            quote("AMES", "2026-10-07", { price: 11, rsi_14: 30 }),
        ])!;
        expect(boundary).toContain("تشبع بيعي (≤30؛ 30.0)");

        const adjacent = render([
            portfolio([{ symbol: "AMES", quantity: 100, entry_price: 10 }]),
            quote("AMES", "2026-10-07", { price: 11, rsi_14: 31 }),
        ])!;
        expect(adjacent).toContain("محايد (30–أقل من 70؛ 31.0)");
    });

    test("missing quantity, quote, RSI, and volume do not become fabricated zeros or current data", () => {
        const reply = render([
            portfolio([{ symbol: "AMES", entry_price: 10, last_price: 12 }]),
            quote("AMES", "2026-10-07", { price: null, rsi_14: null, vol_ratio: null }),
        ])!;
        expect(reply).toContain("الكمية");
        expect(reply).toContain("التاريخ غير موثق");
        expect(reply).toContain("RSI: غير متاح");
        expect(reply).not.toContain("0.0%");
        expect(reply).not.toContain("0.00x");
        expect(reply).toContain("إجمالي القيمة أو الأوزان");

        for (const malformedPrice of ["12,34", "25x"]) {
            const malformed = render([
                portfolio([{ symbol: "AMES", quantity: 10, entry_price: 10 }]),
                quote("AMES", "2026-10-07", { price: malformedPrice, rsi_14: "   ", vol_ratio: true, king_ai_score: 1.2, egx_ai_score: -0.1 }),
            ])!;
            expect(malformed).toContain("السعر غير متاح");
            expect(malformed).toContain("RSI: غير متاح");
            expect(malformed).not.toContain("120%");
            expect(malformed).not.toContain("-10%");
            expect(malformed).not.toContain("1.00x");
            expect(malformed).toContain("التاريخ غير موثق");
        }

        const validArabic = render([
            portfolio([{ symbol: "AMES", quantity: "١٠", entry_price: "1,000.00" }]),
            quote("AMES", "2026-10-07", { price: "١٬٢٣٤٫٥", rsi_14: "٣٠٫٩", vol_ratio: "١٫٢٥x" }),
        ])!;
        expect(validArabic).toContain("آخر إغلاق مسجل 1234.50 ج.م بتاريخ 2026-10-07");
        expect(validArabic).toContain("محايد (30–أقل من 70؛ 30.9)");
        expect(validArabic).toContain("1.25x من متوسط حجم التداول (مقياس نسبي)");
    });

    test("different quote dates suppress combined valuation and compare no mismatched levels", () => {
        const reply = render([
            portfolio([
                { symbol: "AMES", quantity: 100, entry_price: 10 },
                { symbol: "ETEL", quantity: 20, entry_price: 15 },
            ]),
            quote("AMES", "2026-10-06", { price: 11, rsi_14: 45 }),
            quote("ETEL", "2026-10-07", { price: 16, rsi_14: 60 }),
            levels("AMES", "2026-10-05", { support: 10, resistance: 12 }),
            levels("ETEL", "2026-10-07", { support: 14, resistance: 18 }),
        ])!;
        expect(reply).toContain("الأسعار المؤرخة موزعة على 2 تواريخ");
        expect(reply).toContain("لا أقارن السعر بالمستويات لاختلاف التاريخ");
        expect(reply).toContain("إجمالي القيمة أو الأوزان");
        expect(reply).not.toContain("وزن المحفظة | 50.0%");
        expect(reply).not.toContain("التقييم الإجمالي للمراكز");
    });

    test("partial valuation shows only dated individual calculations and never promotes a core holding", () => {
        const reply = render([
            portfolio([
                { symbol: "AMES", quantity: 100, entry_price: 10 },
                { symbol: "ETEL", quantity: 20, entry_price: 15 },
            ]),
            quote("AMES", "2026-10-07", { price: 11, rsi_14: 45, vol_ratio: 0.4, king_ai_score: 0.7 }),
            quote("ETEL", "2026-10-07", { price: null, rsi_14: 72 }),
        ])!;
        expect(reply).toContain("(1/2 مركز له سعر وكمية وتاريخ موثقان");
        expect(reply).toContain("AMES: آخر إغلاق مسجل 11.00 ج.م");
        expect(reply).toContain("ETEL: السعر غير متاح");
        expect(reply).toContain("0.40x من متوسط حجم التداول (مقياس نسبي)");
        expect(reply).not.toContain("السيولة نشطة");
        expect(reply).not.toContain("المركز الأقوى");
        expect(reply).not.toContain("الركيزة الأساسية");
        expect(reply).not.toContain("التوجيه التكتيكي");
    });

    test("an invalid or suffixed date cannot authorize a market valuation", () => {
        for (const invalidDate of ["2026-02-30", "2026-10-07garbage"]) {
            const reply = render([
                portfolio([{ symbol: "AMES", quantity: 100, entry_price: 10 }]),
                quote("AMES", invalidDate, { price: 11, rsi_14: 45 }),
            ])!;
            expect(reply).toContain("التاريخ غير موثق");
            expect(reply).toContain("غير محسوب");
            expect(reply).not.toContain("التقييم الإجمالي للمراكز");
        }
    });

    test("a fully valued same-date portfolio can show computed total and individual weights", () => {
        const reply = render([
            portfolio([
                { symbol: "AMES", quantity: 100, entry_price: 10 },
                { symbol: "ETEL", quantity: 20, entry_price: 15 },
            ]),
                quote("AMES", "2026-10-06T22:00:00.123456Z", { price: 11, rsi_14: 45 }),
                quote("ETEL", "2026-10-07", { price: 16, rsi_14: 60 }),
        ])!;
        expect(reply).toContain("التقييم الإجمالي للمراكز** (2026-10-07)");
        expect(reply).toContain("آخر إغلاق مسجل 11.00 ج.م بتاريخ 2026-10-07");
        expect(reply).toContain("AMES: آخر إغلاق مسجل 11.00 ج.م بتاريخ 2026-10-07");
        expect(reply).toContain("وزن المحفظة");
        expect(reply).toContain("77.5%");
        expect(reply).toContain("22.5%");
    });

    test("the portfolio prompt asks for independent evidence, not an invented ranking", () => {
        const messages = buildV2FinalMessages(
            "حلل محفظتي", plan, null,
            [portfolio([{ symbol: "AMES", quantity: 100, entry_price: 10 }])],
            [], [], { symbol: null, message_id: null, confidence: 1 }
        );
        const prompt = JSON.stringify(messages);
        expect(prompt).toContain("لا تصنع درجة أداء أو مخاطر مركبة");
        expect(prompt).toContain("اذكر تاريخ ومصدر السعر والمستويات لكل مركز");
        expect(prompt).not.toContain("حدد بوضوح: المركز الأقوى");
        expect(prompt).not.toContain("Actionable Tactical Plan");
    });
});
