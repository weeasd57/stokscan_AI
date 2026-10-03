const { createClient } = require("@supabase/supabase-js");
const { runPipeline } = require("../ai/pipeline");
const { getNvidiaApiKeys } = require("../ai/server-secrets");
const { evidenceViolations } = require("../ai/response-evidence");
const { checkStructuredClaims } = require("../ai/claim-evidence");
const liveTest = process.env.RUN_LIVE_CHAT_TESTS === "1" ? it : it.skip;

liveTest.each([
    "هاتلي كل الاسهم اللي لامست قاع وbollinger Band",
    "هات كل الأسهم اللي لمست الحد العلوي بولينجر",
    "أخبار KORA اليوم",
    "حلل TAQA وقولي موقف التوصية والعائد",
])("current production regression: %s", async message => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    // Non-UUID identifiers disable persistence. Only read market evidence.
    const result = await runPipeline(message, [], { current_symbol: "SWDY", last_symbols: ["SWDY"], summary: "حلل SWDY" }, null, [],
        supabase, getNvidiaApiKeys(), "architecture-evaluation", "architecture-evaluation", `architecture-${Date.now()}`);
    expect(result.publication_review?.passed).not.toBe(false);
    expect(evidenceViolations(result.response, message, result.tools.results)).toEqual([]);
    expect(checkStructuredClaims(result.response, result.tools.results, message)).toEqual([]);
    if (/بولينجر|bollinger/i.test(message)) {
        expect(result.plan.tools).toEqual(["get_technical_scan"]);
        expect(result.plan.entities.requested_date).toBeNull();
        const scan = result.tools.results.find(r => r.tool === "get_technical_scan");
        expect(scan.availability).not.toBe("failed");
        expect(scan.data.preset).toMatch(/^bollinger_/);
        for (const row of scan.data.stocks) expect(row.bollinger_evidence).toMatchObject({ available: true, matches: true });
        expect(scan.data.stocks.length).toBe(scan.data.matched_count);
        for (const row of scan.data.stocks) expect(result.response).toContain(row.symbol);
    }
    if (message.includes("TAQA")) {
        const stock = result.tools.results.find(r => r.tool === "get_stock" && r.data.symbol === "TAQA");
        expect(stock).toBeDefined();
        const rec = stock.data.recommendation;
        if (rec?.is_active && rec.return_pct != null) {
            const expected = ((Number(rec.current_price) - Number(rec.entry_price)) / Number(rec.entry_price)) * 100 * (rec.signal === "SELL" ? -1 : 1);
            expect(rec.return_pct).toBeCloseTo(expected, 2);
            expect(rec.return_basis).toBe("open_mark_to_market");
        }
    }
}, 120000);
