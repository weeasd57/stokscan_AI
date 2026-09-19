import { buildDeterministicPlannerResult, enforceIntentFromMessage, isImplicitStockFollowUp } from "../pipeline";
import { SessionState } from "../types";

const mockSessionWithBinv: SessionState = {
    current_symbol: "BINV",
    last_symbols: ["BINV"],
    summary: "تحليل سهم BINV",
    investment_budget: null,
    risk_tolerance: null,
    investment_horizon: null
};

describe("Session Follow-up and Risk/Loss Context Retention", () => {
    it("recognizes 'اشتريت السهم بسعر ٧٢.٧ هل اوقف خساير' as implicit stock follow-up", () => {
        const msg = "انا اشتريت السهم بسعر ٧٢.٧ هل اوقف خساير ولا فيه فرصة الخسارة تقل بكرا";
        expect(isImplicitStockFollowUp(msg)).toBe(true);
    });

    it("routes 'تحليل binv وتوقع اتجاهه' in enforceIntentFromMessage", () => {
        const route = enforceIntentFromMessage("تحليل binv وتوقع اتجاهه", "stock_analysis", ["BINV"]);
        expect(route.intent).toBe("stock_analysis");
        expect(route.tools).toEqual(["get_stock", "get_stock_levels"]);
    });

    it("routes user stop-loss follow-up to active session symbol (BINV) without erasing symbol", () => {
        const msg = "انا اشتريت السهم بسعر ٧٢.٧ هل اوقف خساير ولا فيه فرصة الخسارة تقل بكرا";
        const plan = buildDeterministicPlannerResult(msg, mockSessionWithBinv);
        expect(plan).not.toBeNull();
        expect(plan!.intent).toBe("risk_analysis");
        expect(plan!.entities.symbols).toEqual(["BINV"]);
        expect(plan!.tools).toContain("get_stock");
        expect(plan!.tools).toContain("get_stock_levels");
        expect(plan!.tools).toContain("get_distribution_stocks");
        expect(plan!.session_update.current_symbol).toBe("BINV");
    });

    it("enforceIntentFromMessage binds current_symbol for stop-loss queries when symbols array is empty", () => {
        const msg = "انا اشتريت السهم بسعر ٧٢.٧ هل اوقف خساير ولا فيه فرصة الخسارة تقل بكرا";
        const route: any = enforceIntentFromMessage(msg, "stock_analysis", [], mockSessionWithBinv);
        expect(route.intent).toBe("risk_analysis");
        expect(route.tools).toContain("get_stock");
        expect(route.tools).toContain("get_distribution_stocks");
    });

    it("retains current_symbol on various natural follow-up phrases", () => {
        const variations = [
            "السهم هيعمل ايه بكرا",
            "متوسطي في السهم ٦٥",
            "اوقف خساير ولا اكمل",
            "اشتريت السهم بسعر ٥٠",
            "خسران فيه كتير اعمل ايه",
            "ابيع السهم ولا استنى"
        ];
        for (const v of variations) {
            const plan = buildDeterministicPlannerResult(v, mockSessionWithBinv);
            expect(plan).not.toBeNull();
            expect(plan!.entities.symbols).toEqual(["BINV"]);
            expect(plan!.session_update.current_symbol).toBe("BINV");
        }
    });
});
