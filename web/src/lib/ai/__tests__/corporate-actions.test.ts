// Corporate Actions module tests — classifier, formatting, and graceful degradation
import { classifyCorporateAction, formatCorporateActionsSummary, getCorporateActionsForSymbols, CorporateActionsResult } from "../corporate-actions";

describe("classifyCorporateAction", () => {
    it("classifies rights issues (Arabic)", () => {
        const result = classifyCorporateAction("اعتماد حقوق اكتتاب البنك التجاري الدولي لزيادة رأس المال");
        expect(result?.type).toBe("rights_issue");
    });

    it("prefers rights_issue over capital_increase when both appear", () => {
        const result = classifyCorporateAction("زيادة رأس المال عبر حقوق اكتتاب");
        expect(result?.type).toBe("rights_issue");
    });

    it("classifies dividends and extracts the amount", () => {
        const result = classifyCorporateAction("توزيعات نقدية بقيمة 1.25 جنيه للسهم");
        expect(result?.type).toBe("dividend");
        expect(result?.details?.amount_egp).toBe(1.25);
        expect(result?.details?.amount_per_share_egp).toBe(1.25);
    });

    it("classifies dividends (English)", () => {
        expect(classifyCorporateAction("ABUK declares cash dividend of 0.5 EGP")?.type).toBe("dividend");
    });

    it("classifies stock splits", () => {
        expect(classifyCorporateAction("موافقة على تجزئة سهم القاهرة للإسكان")?.type).toBe("stock_split");
    });

    it("does not confuse retail trade (تجارة التجزئة) with stock splits", () => {
        expect(classifyCorporateAction("تجارة التجزئة في مصر تنمو 3%")).toBeNull();
    });

    it("classifies bonus shares", () => {
        expect(classifyCorporateAction("منحة سهم مجاني لكل سهم")?.type).toBe("bonus_shares");
    });

    it("classifies par value reduction", () => {
        expect(classifyCorporateAction("تخفيض القيمة الاسمية للسهم")?.type).toBe("par_value_reduction");
    });

    it("classifies buyback and earnings (English)", () => {
        expect(classifyCorporateAction("board approves share buyback program")?.type).toBe("buyback");
        expect(classifyCorporateAction("CIB Q1 earnings results announcement")?.type).toBe("earnings");
    });

    it("returns null for unrelated headlines", () => {
        expect(classifyCorporateAction("البورصة المصرية ترتفع 1.5%")).toBeNull();
        expect(classifyCorporateAction("شركة تريد شراء سيارة")).toBeNull();
        expect(classifyCorporateAction("")).toBeNull();
    });
});

describe("getCorporateActionsForSymbols", () => {
    function fakeSupabase(dbRows: any[], dbError: any = null, upsertError: any = null) {
        return {
            from(table: string) {
                if (table === "corporate_actions") {
                    return {
                        select: () => ({
                            in: () => ({
                                gte: () => ({
                                    order: () => ({
                                        limit: async () => ({ data: dbRows, error: dbError })
                                    })
                                })
                            })
                        }),
                        upsert: async () => ({ error: upsertError })
                    };
                }
                if (table === "stocks") {
                    return {
                        select: () => ({
                            in: async () => ({ data: [{ symbol: "COMI", name: "Commercial Bank", name_ar: null }] })
                        })
                    };
                }
                return { select: () => ({ in: async () => ({ data: [] }) }) };
            }
        };
    }

    it("returns database rows without web search when the symbol is covered", async () => {
        const row = {
            symbol: "COMI", exchange: "EGX", action_type: "dividend", title: "توزيعات كومي",
            action_date: null, published_at: new Date().toISOString(), url: "https://x.com/1",
            source: "Google News", sentiment_score: 1, sentiment_label: "positive",
            confidence: 0.9, details: null, origin: "scheduler"
        };
        const result = await getCorporateActionsForSymbols(fakeSupabase([row]), ["COMI"], { enableWebSearch: true });
        expect(result.fromDatabase).toBe(1);
        expect(result.fromWeb).toBe(0);
        expect(result.items[0].action_type).toBe("dividend");
    });

    it("degrades gracefully when the table is missing (DB error)", async () => {
        const result = await getCorporateActionsForSymbols(fakeSupabase([], { message: "table not found" }), ["COMI"], { enableWebSearch: false });
        expect(result.items).toHaveLength(0);
        expect(result.fromDatabase).toBe(0);
    });
});

describe("formatCorporateActionsSummary", () => {
    it("renders items with type, title and source", () => {
        const ca: CorporateActionsResult = {
            items: [{
                symbol: "ABUK", exchange: "EGX", action_type: "dividend", action_type_ar: "توزيعات أرباح",
                title: "توزيعات نقدية بقيمة 1 جنيه", action_date: null, published_at: "2026-09-01T00:00:00Z",
                url: "https://example.com", source: "example.com", sentiment_score: null, sentiment_label: null,
                confidence: 0.9, details: { amount_egp: 1 }, origin: "chat_cache"
            }],
            fromDatabase: 0, fromWeb: 1, savedToDatabase: 1, symbolsCovered: ["ABUK"]
        };
        const text = formatCorporateActionsSummary(ca);
        expect(text).toContain("ABUK");
        expect(text).toContain("توزيعات أرباح");
        expect(text).toContain("example.com");
        expect(text).toContain("amount_egp=1");
        expect(text).toContain("تم جلب 1 حدث");
    });

    it("returns empty string for empty results", () => {
        const ca: CorporateActionsResult = { items: [], fromDatabase: 0, fromWeb: 0, savedToDatabase: 0, symbolsCovered: [] };
        expect(formatCorporateActionsSummary(ca)).toBe("");
    });
});
