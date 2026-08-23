import { describe, it, expect } from "@jest/globals";
import { validateResponse } from "../validator";
import type { ToolResult, IntentPlan } from "../types";

describe("Validator with realistic multi-stock comparison data", () => {
    it("validates AFMC/AALR/CRST comparison with all numeric fields present", () => {
        const toolResults: ToolResult[] = [
            {
                tool: "get_stock",
                source: "database",
                data_time: "2026-08-20",
                symbols: ["AFMC"],
                data_type: "live",
                data: {
                    symbol: "AFMC",
                    name: "Arab African International Bank",
                    price: 8.5,
                    change_pct: "+2.61%",
                    change_pct_num: 2.61,
                    rsi_14: "67.88",
                    rsi_14_num: 67.88,
                    macd_signal: "0.0450",
                    macd_signal_num: 0.045,
                    macd: 0.032,
                    macd_histogram: -0.013,
                    vol_ratio: "0.32x",
                    vol_ratio_num: 0.32,
                    volume: 647000,
                    vol_sma20: 2022000,
                    king_ai_score: 0.583,
                    egx_ai_score: 0.556,
                    sma_50: "8.35",
                    bb_upper: "8.70",
                    bb_lower: "8.20",
                },
            },
            {
                tool: "get_stock",
                source: "database",
                data_time: "2026-08-20",
                symbols: ["AFMC"],
                data_type: "live",
                data: {
                    symbol: "AALR",
                    name: "Arab Light Industries",
                    price: 310,
                    change_pct: "+6.87%",
                    change_pct_num: 6.87,
                    rsi_14: "52.30",
                    rsi_14_num: 52.30,
                    macd_signal: "0.1200",
                    macd_signal_num: 0.12,
                    macd: 0.15,
                    macd_histogram: 0.03,
                    vol_ratio: "1.10x",
                    vol_ratio_num: 1.10,
                    volume: 193000,
                    vol_sma20: 175000,
                    king_ai_score: 0.592,
                    egx_ai_score: 0.670,
                    sma_50: "305",
                    bb_upper: "315",
                    bb_lower: "300",
                },
            },
            {
                tool: "get_stock",
                source: "database",
                data_time: "2026-08-20",
                symbols: ["AFMC"],
                data_type: "live",
                data: {
                    symbol: "CRST",
                    name: "Cairo Resorts",
                    price: 193.5,
                    change_pct: "-1.20%",
                    change_pct_num: -1.2,
                    rsi_14: "83.00",
                    rsi_14_num: 83,
                    macd_signal: "0.0080",
                    macd_signal_num: 0.008,
                    macd: 0.015,
                    macd_histogram: 0.007,
                    vol_ratio: "0.85x",
                    vol_ratio_num: 0.85,
                    volume: 592000,
                    vol_sma20: 696000,
                    king_ai_score: 0.45,
                    egx_ai_score: 0.38,
                    sma_50: "190",
                    bb_upper: "198",
                    bb_lower: "187",
                },
            },
        ];

        const liveDataString = toolResults
            .map(r => `\nالأداة: ${r.tool} | البيانات: ${JSON.stringify(r.data)}`)
            .join("");

        const response = `مصفوفة القرار للمقارنة بين AFMC و AALR و CRST:

| المعيار | AFMC | AALR | CRST |
|---|---|---|---|
| التقنية (Technical) | RSI = 67.88 (محايد يميل للإيجابية)، MACD = 0.032 | RSI = 52.30 (محايد يميل للإيجابية)، MACD = 0.15 | RSI = 83 (مطاغٍ) |
| السيولة (Liquidity) | vol_ratio = 0.32x (منخفض) | vol_ratio = 1.10x (نشط) | vol_ratio = 0.85x (منخفض) |
| التعلم الذكاء الاصطناعي (ML) | KING AI = 58.3%، EGX AI = 55.6% | KING AI = 59.2%، EGX AI = 67.0% | KING AI = 45.0%، EGX AI = 38.0% |
| المخاطر (Risk) | نطاق دعم/مقاومة: 8.20 - 8.70 | نطاق: 300 - 315 | نطاق: 187 - 198 |
| الثقة النهائية | منخفضة | متوسطة | منخفضة |

الفرق بين KING AI نقاط AALR و AFMC هو 0.9 نقطة (ضيقة / غير إحصائية ولا تعني تفوقاً كبيراً).`;

        const result = validateResponse(
            response,
            liveDataString,
            ["AFMC", "AALR", "CRST"],
            toolResults,
            "قارن بين afmc , aalr , crst" as any,
            "comparison" as any
        );

        console.log("isValid:", result.isValid);
        console.log("deterministicErrors:", JSON.stringify(result.deterministicErrors, null, 2));
        console.log("suspiciousNumbers:", result.suspiciousNumbers);
        console.log("hasRepetitions:", result.hasRepetitions);
        console.log("englishThinking:", result.englishThinking);

        expect(result.isValid).toBe(true);
        expect(result.suspiciousNumbers.length).toBe(0);
    });

    it("validates TMGH/AALR/ZEOT comparison with volume and MACD values", () => {
        const toolResults: ToolResult[] = [
            {
                tool: "get_stock",
                source: "database",
                data_time: "2026-08-20",
                symbols: ["AFMC"],
                data_type: "live",
                data: {
                    symbol: "TMGH",
                    name: "Talaat Mostafa Group",
                    price: 592.5,
                    change_pct: "+4.50%",
                    change_pct_num: 4.5,
                    rsi_14: "72.00",
                    rsi_14_num: 72,
                    macd_signal: "0.2500",
                    macd_signal_num: 0.25,
                    macd: 0.32,
                    macd_histogram: 0.07,
                    vol_ratio: "1.69x",
                    vol_ratio_num: 1.69,
                    volume: 340000,
                    vol_sma20: 200000,
                    king_ai_score: 0.67,
                    egx_ai_score: 0.52,
                    sma_50: "580",
                    bb_upper: "605",
                    bb_lower: "575",
                },
            },
            {
                tool: "get_stock",
                source: "database",
                data_time: "2026-08-20",
                symbols: ["AFMC"],
                data_type: "live",
                data: {
                    symbol: "AALR",
                    name: "Arab Light Industries",
                    price: 310,
                    change_pct: "+6.87%",
                    change_pct_num: 6.87,
                    rsi_14: "52.30",
                    rsi_14_num: 52.3,
                    macd_signal: "0.1200",
                    macd_signal_num: 0.12,
                    macd: 0.15,
                    macd_histogram: 0.03,
                    vol_ratio: "1.10x",
                    vol_ratio_num: 1.1,
                    volume: 193000,
                    vol_sma20: 175000,
                    king_ai_score: 0.592,
                    egx_ai_score: 0.67,
                    sma_50: "305",
                    bb_upper: "315",
                    bb_lower: "300",
                },
            },
            {
                tool: "get_stock",
                source: "database",
                data_time: "2026-08-20",
                symbols: ["AFMC"],
                data_type: "live",
                data: {
                    symbol: "ZEOT",
                    name: "El Zohul",
                    price: 12.8,
                    change_pct: "+1.20%",
                    change_pct_num: 1.2,
                    rsi_14: "45.00",
                    rsi_14_num: 45,
                    macd_signal: "-0.0200",
                    macd_signal_num: -0.02,
                    macd: -0.01,
                    macd_histogram: 0.01,
                    vol_ratio: "0.45x",
                    vol_ratio_num: 0.45,
                    volume: 83000,
                    vol_sma20: 184000,
                    king_ai_score: 0.38,
                    egx_ai_score: 0.45,
                    sma_50: "12.5",
                    bb_upper: "13.5",
                    bb_lower: "12.0",
                },
            },
        ];

        const liveDataString = toolResults
            .map(r => `\nالأداة: ${r.tool} | البيانات: ${JSON.stringify(r.data)}`)
            .join("");

        const response = `مصفوفة القرار للمقارنة بين TMGH و AALR و ZEOT:

| المعيار | TMGH | AALR | ZEOT |
|---|---|---|---|
| التقنية (Technical) | RSI = 72 (قريب من التشبع)، MACD = 0.32 (فوق خط الإشارة 0.25) | RSI = 52.30 (محايد)، MACD = 0.15 | RSI = 45 (محايد)، MACD = -0.01 |
| السيولة (Liquidity) | vol_ratio = 1.69x (نشط) | vol_ratio = 1.10x (نشط فوق المتوسط) | vol_ratio = 0.45x (منخفض) |
| التعلم الذكاء الاصطناعي (ML) | KING AI = 67%، EGX AI = 52% | KING AI = 59.2%، EGX AI = 67% | KING AI = 38%، EGX AI = 45% |
| المخاطر (Risk) | نطاق: 575 - 605 | نطاق: 300 - 315 | نطاق: 12.0 - 13.5 |
| الثقة النهائية | عالية | متوسطة | منخفضة |

الفرق بين KING AI بين TMGH و AALR هو 7.8 نقطة (كبير ومعنوي).`;

        const result = validateResponse(
            response,
            liveDataString,
            ["TMGH", "AALR", "ZEOT"],
            toolResults,
            "قارن بين tmgh , aalr , zeot" as any,
            "comparison" as any
        );

        console.log("isValid:", result.isValid);
        console.log("deterministicErrors:", JSON.stringify(result.deterministicErrors, null, 2));
        console.log("suspiciousNumbers:", result.suspiciousNumbers);
        console.log("hasRepetitions:", result.hasRepetitions);
        console.log("englishThinking:", result.englishThinking);

        expect(result.isValid).toBe(true);
        expect(result.suspiciousNumbers.length).toBe(0);
    });
});
