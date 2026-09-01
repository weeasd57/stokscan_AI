/**
 * Regression tests for Arabic company-name resolution.
 * Covers the "التعمير والاستشارات" (DAPH) incident: the name must resolve to DAPH,
 * and unknown company names must NOT silently fall back to the previous session symbol.
 * Covers the "اي فاينس" (EFIH) incident (2026-09-01): a typo'd short name must resolve
 * to EFIH instead of falling through to the session's distribution-scan context.
 */
const { extractSymbolsFromText, isUnresolvedCompanyNameMention } = require("../ai/planner");

const VALID_SYMBOLS = [
    "DAPH", "HDBK", "TMGH", "FCMD", "COMI", "AFMC", "ELKA", "PHDC", "EHDR", "EAST", "SWDY", "EFIH", "VALU"
];

describe("Arabic company name resolution (DAPH incident)", () => {
    test("resolves 'التعمير والاستشارات' to DAPH", () => {
        const syms = extractSymbolsFromText("التعمير والاستشارات وضعه ايه؟", VALID_SYMBOLS, {});
        expect(syms).toContain("DAPH");
    });

    test("resolves full name 'التعمير والاستشارات الهندسية' to DAPH", () => {
        const syms = extractSymbolsFromText("تحليل سهم التعمير والاستشارات الهندسية", VALID_SYMBOLS, {});
        expect(syms).toContain("DAPH");
    });

    test("resolves bare 'تعمير' to DAPH", () => {
        const syms = extractSymbolsFromText("سهم تعمير نزل النهاردة", VALID_SYMBOLS, {});
        expect(syms).toContain("DAPH");
    });

    test("'بنك التعمير' still resolves to HDBK (longest match wins)", () => {
        const syms = extractSymbolsFromText("بنك التعمير وضعه ايه؟", VALID_SYMBOLS, {});
        expect(syms).toContain("HDBK");
        expect(syms).not.toContain("DAPH");
    });

    test("'التعمير والاسكان' still resolves to HDBK", () => {
        const syms = extractSymbolsFromText("التعمير والاسكان ايه وضعه؟", VALID_SYMBOLS, {});
        expect(syms).toContain("HDBK");
        expect(syms).not.toContain("DAPH");
    });

    test("'بالم هيلز للتعمير' still resolves to PHDC", () => {
        const syms = extractSymbolsFromText("بالم هيلز للتعمير ايه الاخبار؟", VALID_SYMBOLS, {});
        expect(syms).toContain("PHDC");
    });
});

describe("Unresolved company-name guard", () => {
    test("flags an unmappable company-like name", () => {
        expect(isUnresolvedCompanyNameMention("شركة الدلتا العظمى للاستصلاح والتعمير وضعه ايه؟", [])).toBe(true);
    });

    test("does not flag when a symbol was resolved", () => {
        expect(isUnresolvedCompanyNameMention("التعمير والاستشارات وضعه ايه؟", ["DAPH"])).toBe(false);
    });

    test("does not flag plain follow-up questions", () => {
        expect(isUnresolvedCompanyNameMention("وضعه ايه؟", [])).toBe(false);
        expect(isUnresolvedCompanyNameMention("كم سعره دلوقتي؟", [])).toBe(false);
    });

    test("does not flag sector/market queries", () => {
        expect(isUnresolvedCompanyNameMention("قطاع العقارات ايه افضل سهم فيه؟", [])).toBe(false);
        expect(isUnresolvedCompanyNameMention("حالة السوق النهاردة؟", [])).toBe(false);
    });
});

describe("e-finance name resolution (typo incident)", () => {
    test("resolves the full name 'اي فاينانس' to EFIH", () => {
        const syms = extractSymbolsFromText("اي فاينانس ممكن ينزل لفين؟", VALID_SYMBOLS, {});
        expect(syms).toContain("EFIH");
    });

    test("resolves the typo'd 'اي فاينس' (missing letters) to EFIH", () => {
        const syms = extractSymbolsFromText("اي فاينس ممكن ينزل لفين عشان عاوز اشتري ببمبلغ كبير شوية", VALID_SYMBOLS, {});
        expect(syms).toContain("EFIH");
    });

    test("resolves bare 'فينس' and 'فاينس' typos to EFIH", () => {
        expect(extractSymbolsFromText("رأيكم في سهم فينس؟", VALID_SYMBOLS, {})).toContain("EFIH");
        expect(extractSymbolsFromText("فاينس نازل النهارده", VALID_SYMBOLS, {})).toContain("EFIH");
    });

    test("resolves Latin 'e-finance' / 'efinance' to EFIH", () => {
        expect(extractSymbolsFromText("e-finance ينزل لفين؟", VALID_SYMBOLS, {})).toContain("EFIH");
        expect(extractSymbolsFromText("efinance forecast", VALID_SYMBOLS, {})).toContain("EFIH");
    });

    test("'فاليو فاينانس' still resolves to VALU (longest match wins)", () => {
        const syms = extractSymbolsFromText("فاليو فاينانس وضعها ايه؟", VALID_SYMBOLS, {});
        expect(syms).toContain("VALU");
        expect(syms).not.toContain("EFIH");
    });
});
