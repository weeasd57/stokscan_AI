import { sanitizeReply } from "../ai/sanitizer";

describe("Table Rendering & Sanitization Integrity", () => {
    test("sanitizeReply preserves multi-column portfolio tables without collapsing rows", () => {
        const markdown = `# 💼 تحليل محفظتك — EGX Bots

## 📊 الملخص العام

| البند | القيمة |
|---|---|
| عدد المراكز | 3 |
| إجمالي التكلفة | 1,369 ج.م |
| القيمة السوقية الحالية | 1,228.71 ج.م |
| الربح/الخسارة غير المحققة | **−140.29 ج.م (−10.25%)** |

## 📋 تفصيل المراكز

| السهم | الكمية | سعر الشراء | الإغلاق الحالي | القيمة السوقية | الربح/الخسارة | النسبة | RSI | KING AI | EGX AI |
|---|---|---|---|---|---|---|---|---|---|
| **ACAMD** | 115 | 6.30 | 2.05 | 235.75 | −489.25 | **−67.48%** | 45.65 | 0.409 | 0.463 |
| **ACAP** | 100 | 5.00 | 8.21 | 821.00 | +321.00 | **+64.20%** | 36.36 | 0.506 | 0.425 |
| **ACGC** | 12 | 12.00 | 14.33 | 171.96 | +27.96 | **+19.42%** | 51.88 | 0.494 | 0.479 |

## 🧭 قراءة فنية لكل مركز
- ACAMD خاسر
`;

        const cleaned = sanitizeReply(markdown);

        // Header and divider of both tables must be intact
        expect(cleaned).toContain("| البند | القيمة |");
        expect(cleaned).toContain("|---|---|");
        expect(cleaned).toContain("| عدد المراكز | 3 |");

        expect(cleaned).toContain("| السهم | الكمية | سعر الشراء | الإغلاق الحالي | القيمة السوقية | الربح/الخسارة | النسبة | RSI | KING AI | EGX AI |");
        expect(cleaned).toContain("|---|---|---|---|---|---|---|---|---|---|");

        // Every row must remain on its own line
        expect(cleaned).toMatch(/\|\s*\*\*ACAMD\*\*\s*\|\s*115\s*\|\s*6\.30\s*\|\s*2\.05/);
        expect(cleaned).toMatch(/\|\s*\*\*ACAP\*\*\s*\|\s*100\s*\|\s*5\.00\s*\|\s*8\.21/);
        expect(cleaned).toMatch(/\|\s*\*\*ACGC\*\*\s*\|\s*12\s*\|\s*12\.00\s*\|\s*14\.33/);
    });

    test("sanitizeReply preserves technical indicators tables with dashed ranges and numbers", () => {
        const text = `| السهم | الدخول | الوقف | الهدف 1 | الهدف 2 |
|---|---|---|---|---|
| COMI | 85.50 – 86.00 | 83.20 | 90.00 | 94.50 |
| TMGH | 87.00 – 87.50 | 84.80 | 92.00 | 96.00 |
`;

        const cleaned = sanitizeReply(text);
        expect(cleaned).toContain("| السهم | الدخول | الوقف | الهدف 1 | الهدف 2 |");
        expect(cleaned).toContain("|---|---|---|---|---|");
        expect(cleaned).toContain("| COMI | 85.50 – 86.00 | 83.20 | 90.00 | 94.50 |");
        expect(cleaned).toContain("| TMGH | 87.00 – 87.50 | 84.80 | 92.00 | 96.00 |");
    });
});
