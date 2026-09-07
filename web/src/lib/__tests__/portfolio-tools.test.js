/**
 * Tests for the "My Portfolio" (محفظتى) chat tools.
 * Uses a mocked Supabase client covering: view snapshot, add, update,
 * remove, sell (full/partial + cash proceeds), and cash set.
 */

const {
    getPortfolioSnapshot,
    addPortfolioPosition,
    updatePortfolioPosition,
    removePortfolioPosition,
    sellPortfolioPosition,
    setPortfolioCash,
    addPortfolioCash,
} = require("../ai/portfolio-tools");

// ---------- Supabase mock helpers ----------
function makeSupabaseMock({ positions = [], profile = { cash_balance: 1000 }, stockNames = {}, prices = {} } = {}) {
    const state = { positions: positions.map((p, i) => ({ id: `pos_${i + 1}`, status: "open", ...p })), profile: { ...profile } };
    const inserts = [];
    const events = [];

    function makeTable(table) {
        const t = {};
        for (const m of ["select", "delete", "neq", "gt", "gte", "lt", "lte", "in", "like", "order", "range", "upsert"]) {
            t[m] = () => t;
        }
        let lastSymbol = null;
        t.eq = (col, val) => {
            if (col === "symbol") lastSymbol = String(val).toUpperCase();
            t._lastEq = t._lastEq || {};
            t._lastEq[col] = val;
            return t;
        };
        t.limit = () => t;
        t.maybeSingle = () => t;
        t.single = () => t;

        t.insert = (payload) => {
            if (table === "positions") {
                const row = Array.isArray(payload) ? payload[0] : payload;
                const rowWithId = { id: `pos_${state.positions.length + 1}`, status: "open", ...row };
                state.positions.push(rowWithId);
                inserts.push(row);
                // Support .insert(...).select(...).single() and plain await
                const res = { data: [rowWithId], error: null };
                const chain = {
                    select: () => chain,
                    single: () => chain,
                    then: (resolve) => { resolve(res); return Promise.resolve(res); },
                };
                return chain;
            }
            if (table === "position_events") events.push(payload);
            return t;
        };

        t.update = (payload) => {
            const applied = { table, payload };
            if (table === "profiles") Object.assign(state.profile, payload);
            const u = {};
            for (const m of ["neq", "gt", "gte", "lt", "lte", "in", "order", "limit", "maybeSingle", "single"]) u[m] = () => u;
            u.eq = (col, val) => {
                if (table === "positions" && col === "id") {
                    const target = state.positions.find((p) => p.id === val);
                    if (target) Object.assign(target, payload);
                }
                return u;
            };
            u.then = (resolve) => { resolve({ data: [{}], error: null }); return Promise.resolve({ data: [{}], error: null }); };
            void applied;
            return u;
        };

        t.then = (resolve) => {
            let data;
            if (table === "positions") {
                data = state.positions.filter((p) => p.status === "open");
            } else if (table === "profiles") {
                data = state.profile;
            } else if (table === "stocks") {
                data = lastSymbol && stockNames[lastSymbol] ? [{ name: stockNames[lastSymbol] }] : [];
            } else if (table === "stock_prices") {
                data = lastSymbol && prices[lastSymbol] !== undefined ? [{ close: prices[lastSymbol] }] : [];
            } else if (table === "position_events") {
                data = null;
            } else {
                data = [];
            }
            resolve({ data, error: null });
            return Promise.resolve({ data, error: null });
        };

        return t;
    }

    const client = {
        _state: state,
        _inserts: inserts,
        _events: events,
        from(table) { return makeTable(table); },
    };

    return client;
}

// Await helper — mock chains resolve as promises
const run = async (fn) => fn;

describe("Portfolio tools (محفظتى)", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("returns an empty snapshot with zeroed totals when no positions exist", async () => {
        const sb = makeSupabaseMock({ positions: [], profile: { cash_balance: 500 } });
        const snap = await getPortfolioSnapshot(sb, "user_1");
        expect(snap.ok).toBe(true);
        expect(snap.positions).toHaveLength(0);
        expect(snap.cash_balance).toBe(500);
        expect(snap.totals.positions_count).toBe(0);
        expect(snap.totals.equity).toBe(500);
    });

    it("computes market value and P/L with latest close prices", async () => {
        const sb = makeSupabaseMock({
            positions: [
                { user_id: "user_1", symbol: "COMI", quantity: 100, entry_price: 80 },
                { user_id: "user_1", symbol: "EAST", quantity: 200, entry_price: 30 },
            ],
            prices: { COMI: 90, EAST: 27 },
            profile: { cash_balance: 1000 },
        });
        const snap = await getPortfolioSnapshot(sb, "user_1");
        expect(snap.positions).toHaveLength(2);
        const comi = snap.positions.find((p) => p.symbol === "COMI");
        expect(comi.last_price).toBe(90);
        expect(comi.market_value).toBe(9000);
        expect(comi.cost_basis).toBe(8000);
        expect(comi.profit_pct).toBeCloseTo(12.5, 1);
        // totals: COMI 8000->9000, EAST 6000->5400, cash 1000
        expect(snap.totals.cost_basis).toBe(14000);
        expect(snap.totals.market_value).toBe(14400);
        expect(snap.totals.equity).toBe(15400);
    });

    it("adds a new position with quantity and entry price", async () => {
        const sb = makeSupabaseMock({ positions: [], stockNames: { HRHO: "الهرم" } });
        const res = await addPortfolioPosition(sb, "user_1", "HRHO", 300, 15.5);
        expect(res.ok).toBe(true);
        expect(sb._state.positions).toHaveLength(1);
        const row = sb._state.positions[0];
        expect(row.symbol).toBe("HRHO");
        expect(row.quantity).toBe(300);
        expect(row.entry_price).toBe(15.5);
        expect(row.status).toBe("open");
    });

    it("rejects invalid symbols and non-positive quantities", async () => {
        const sb = makeSupabaseMock({ positions: [] });
        expect((await addPortfolioPosition(sb, "u", "TOOLONGSYMBOL", 10, 1)).ok).toBe(false);
        expect((await addPortfolioPosition(sb, "u", "COMI", 0, 1)).ok).toBe(false);
        expect((await addPortfolioPosition(sb, "u", "COMI", -5, 1)).ok).toBe(false);
    });

    it("updates quantity and entry price of an open position", async () => {
        const sb = makeSupabaseMock({ positions: [{ user_id: "u", symbol: "COMI", quantity: 100, entry_price: 80 }] });
        const res = await updatePortfolioPosition(sb, "u", "COMI", 250, 82);
        expect(res.ok).toBe(true);
        expect(sb._state.positions[0].quantity).toBe(250);
        expect(sb._state.positions[0].entry_price).toBe(82);
    });

    it("fails update/remove/sell for a symbol not held", async () => {
        const sb = makeSupabaseMock({ positions: [{ user_id: "u", symbol: "COMI", quantity: 10 }] });
        expect((await updatePortfolioPosition(sb, "u", "TMGH", 5, null)).ok).toBe(false);
        expect((await removePortfolioPosition(sb, "u", "TMGH")).ok).toBe(false);
        expect((await sellPortfolioPosition(sb, "u", "TMGH", null, null)).ok).toBe(false);
    });

    it("removes a holding without touching cash", async () => {
        const sb = makeSupabaseMock({ positions: [{ user_id: "u", symbol: "EAST", quantity: 50 }], profile: { cash_balance: 200 } });
        const res = await removePortfolioPosition(sb, "u", "EAST");
        expect(res.ok).toBe(true);
        expect(sb._state.positions[0].status).toBe("removed");
        expect(sb._state.profile.cash_balance).toBe(200);
    });

    it("full sell closes the position and adds proceeds to cash", async () => {
        const sb = makeSupabaseMock({
            positions: [{ user_id: "u", symbol: "COMI", quantity: 100, entry_price: 80 }],
            prices: { COMI: 95 },
            profile: { cash_balance: 500 },
        });
        const res = await sellPortfolioPosition(sb, "u", "COMI", null, null);
        expect(res.ok).toBe(true);
        expect(sb._state.positions[0].status).toBe("closed");
        expect(sb._state.profile.cash_balance).toBe(500 + 100 * 95);
    });

    it("partial sell reduces quantity and adds partial proceeds", async () => {
        const sb = makeSupabaseMock({
            positions: [{ user_id: "u", symbol: "COMI", quantity: 100, entry_price: 80 }],
            prices: { COMI: 90 },
            profile: { cash_balance: 0 },
        });
        const res = await sellPortfolioPosition(sb, "u", "COMI", 40, null);
        expect(res.ok).toBe(true);
        expect(sb._state.positions[0].quantity).toBe(60);
        expect(sb._state.positions[0].status).toBe("open");
        expect(sb._state.profile.cash_balance).toBe(40 * 90);
    });

    it("sets the cash balance", async () => {
        const sb = makeSupabaseMock({ profile: { cash_balance: 0 } });
        const res = await setPortfolioCash(sb, "u", 50000);
        expect(res.ok).toBe(true);
        expect(sb._state.profile.cash_balance).toBe(50000);
    });

    it("rejects negative cash", async () => {
        const sb = makeSupabaseMock({ profile: { cash_balance: 0 } });
        expect((await setPortfolioCash(sb, "u", -1)).ok).toBe(false);
    });

    it("adds cash without changing holdings", async () => {
        const sb = makeSupabaseMock({
            positions: [{ user_id: "u", symbol: "COMI", quantity: 10, entry_price: 80 }],
            profile: { cash_balance: 1000 },
        });
        const res = await addPortfolioCash(sb, "u", 2500);
        expect(res.ok).toBe(true);
        expect(sb._state.profile.cash_balance).toBe(3500);
        expect(sb._state.positions[0].quantity).toBe(10);
    });
});

describe("Portfolio intent detection (detectPortfolioIntent)", () => {
    const { detectPortfolioIntent } = require("../ai/intent-policy");

    it("detects view requests", () => {
        expect(detectPortfolioIntent("اعرض محفظتي")).toBe("view");
        expect(detectPortfolioIntent("إيه اللي معايا في المحفظة؟")).toBe("view");
        expect(detectPortfolioIntent("وريني وضع محفظتي")).toBe("view");
    });

    it("detects add requests with symbol and quantity", () => {
        expect(detectPortfolioIntent("عندي 200 سهم COMI")).toBe("add");
        expect(detectPortfolioIntent("ضيف 100 سهم EAST لمحفظتي")).toBe("add");
    });

    it("detects sell requests", () => {
        expect(detectPortfolioIntent("بعت 50 سهم COMI")).toBe("sell");
        expect(detectPortfolioIntent("بعت كل أسهم EAST")).toBe("sell");
    });

    it("detects remove requests", () => {
        expect(detectPortfolioIntent("شيل COMI من محفظتي")).toBe("remove");
        expect(detectPortfolioIntent("امسح EAST من المحفظة")).toBe("remove");
    });

    it("detects cash set requests", () => {
        expect(detectPortfolioIntent("السيولة اللي معايا 50 ألف جنيه")).toBe("cash_set");
    });

    it("detects cash deposits separately from setting the balance", () => {
        expect(detectPortfolioIntent("ضيف 5 آلاف سيولة")).toBe("cash_add");
        expect(detectPortfolioIntent("زود الكاش بـ 1000 جنيه")).toBe("cash_add");
    });

    it("detects update requests", () => {
        expect(detectPortfolioIntent("عدل عدد أسهم COMI لـ 300")).toBe("update");
    });

    it("does not hijack allocation guidance questions", () => {
        expect(detectPortfolioIntent("أوزع محفظتي إزاي؟")).toBeNull();
        expect(detectPortfolioIntent("عايز أبني محفظة من الأول")).toBeNull();
        expect(detectPortfolioIntent("تحليل سهم COMI")).toBeNull();
    });
});

describe("Portfolio image conversation helpers", () => {
    const { parsePortfolioAnswer, portfolioMissingQuestion } = require("../ai/pipeline");

    it("asks for missing quantity and average purchase price instead of saving incomplete image data", () => {
        const item = { symbol: "COMI", quantity: null, price: null };
        expect(portfolioMissingQuestion(item)).toContain("الكمية");
        expect(portfolioMissingQuestion(item)).toContain("متوسط سعر الشراء");
    });

    it("understands a conversational answer with quantity and average price", () => {
        const item = { symbol: "COMI", quantity: null, price: null };
        expect(parsePortfolioAnswer("معايا 200 سهم بمتوسط 45.65 جنيه", item)).toMatchObject({
            quantity: 200,
            price: 45.65,
        });
    });

    it("fills one missing value without overwriting a value read from the image", () => {
        const item = { symbol: "AMER", quantity: 50, price: null };
        expect(parsePortfolioAnswer("متوسط الشراء 5.75", item)).toMatchObject({
            quantity: 50,
            price: 5.75,
        });
    });
});

describe("Portfolio confirmation detection (detectPortfolioConfirmation)", () => {
    const { detectPortfolioConfirmation } = require("../ai/intent-policy");

    it("accepts affirmative replies", () => {
        expect(detectPortfolioConfirmation("أيوه")).toBe(true);
        expect(detectPortfolioConfirmation("أيوه دي محفظتي")).toBe(true);
        expect(detectPortfolioConfirmation("نعم")).toBe(true);
        expect(detectPortfolioConfirmation("أكيد")).toBe(true);
    });

    it("accepts negative replies", () => {
        expect(detectPortfolioConfirmation("لأ")).toBe(false);
        expect(detectPortfolioConfirmation("لأ مش بتاعتي")).toBe(false);
        expect(detectPortfolioConfirmation("لا مش دي")).toBe(false);
    });

    it("returns null for unrelated messages", () => {
        expect(detectPortfolioConfirmation("حلل سهم COMI")).toBeNull();
        expect(detectPortfolioConfirmation("إيه أخبار البورصة؟")).toBeNull();
    });
});
