const { createClient } = require("@supabase/supabase-js");
const { buildCompoundDeterministicPlan } = require("../ai/pipeline");
const { runPipeline } = require("../ai/pipeline");
const { executeStructuredTools } = require("../ai/tools-v2");
const { buildDeterministicResponse } = require("../ai/final-v2");

const liveTest = process.env.RUN_LIVE_CHAT_TESTS === "1" ? it : it.skip;

describe("Live Supabase chatbot integration", () => {
    const retry = async (operation, attempts = 3) => {
        let last;
        for (let i = 0; i < attempts; i++) {
            last = await operation();
            if (!last?.error) return last;
            await new Promise(resolve => setTimeout(resolve, 500 * (i + 1)));
        }
        throw new Error(last?.error?.message || "Supabase operation failed");
    };
    const buildPlan = (message, session = { current_symbol: null, last_symbols: [], summary: null }) => {
        const rawPlan = buildCompoundDeterministicPlan(message, session);
        return {
            intent: rawPlan.intent,
            confidence: rawPlan.confidence,
            entities: { reference: null, timeframe: null, requested_date: null, requested_start_date: null, requested_end_date: null, scan_direction: null, ...rawPlan.entities },
            needs_vision_context: false,
            needs_history: false,
            needs_live_data: true,
            needs_historical_data: false,
            tools: rawPlan.tools,
            clarification_needed: false,
            resolved_from: { symbol: null, message_id: null }
        };
    };

    liveTest.each([
        ["ABUK", "66.66"],
        ["ELSH", null]
    ])("answers every command in a compound %s message", async (symbol, expectedSupport) => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const message = `حلل ${symbol} هات أخباره لو كسر الدعم أعمل إيه؟`;
        const plan = buildPlan(message);

        const output = await executeStructuredTools(supabase, plan, [], "live-eval-user", "live-eval-session");
        const resultTools = output.results.map(result => result.tool);
        const response = buildDeterministicResponse(message, plan, output.results);

        expect(plan.tools).toEqual(expect.arrayContaining(["get_stock", "get_stock_levels", "get_news"]));
        expect(resultTools).toContain("get_stock");
        expect(resultTools).toContain("get_stock_levels");
        expect(resultTools).toContain("get_news");
        expect(response).toContain(`${symbol}: السعر`);
        expect(response).toContain("الدعم");
        if (expectedSupport) expect(response).toContain(expectedSupport);
        expect(response).toContain("كسر الدعم");
        expect(response).toContain("الأخبار:");
        expect(response).not.toContain("environment_details");
    }, 60000);

    liveTest("scopes sector news and accumulation to banks, not the previous stock", async () => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const message = "قطاع البنوك أخباره إيه، ومين أسهم التجميع اللي فيه؟";
        const plan = buildPlan(message, { current_symbol: "ELSH", last_symbols: ["ELSH"], summary: "حلل ELSH" });
        const output = await executeStructuredTools(supabase, plan, [], "live-eval-user", "live-eval-sector-session");
        const news = output.results.find(result => result.tool === "get_news");
        const scan = output.results.find(result => result.tool === "get_accumulation_stocks");

        expect(plan.entities.symbols).toEqual([]);
        expect(plan.entities.sector).toBe("بنوك");
        expect(plan.tools).toEqual(expect.arrayContaining(["get_sector", "get_news", "get_accumulation_stocks"]));
        expect(news?.symbols).not.toContain("ELSH");
        expect(scan?.symbols).not.toContain("ELSH");
    }, 60000);

    liveTest("returns a fair-value scan instead of market liquidity", async () => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const message = "هات الأسهم اللي بتتداول فوق القيمة العادلة ل";
        const plan = buildPlan(message, { current_symbol: "ELKA", last_symbols: ["ELKA"], summary: "ملخص السوق" });
        const output = await executeStructuredTools(supabase, plan, [], "live-eval-user", "live-eval-fair-value-session");
        const response = buildDeterministicResponse(message, plan, output.results);

        expect(plan.tools).toEqual(["get_fair_value_scan"]);
        expect(output.results.some(result => result.tool === "get_fair_value_scan")).toBe(true);
        expect(response).toContain("تقييم فني");
        expect(response).not.toContain("ملخص سيولة السوق");
    }, 60000);

    liveTest("answers a live sector-entry question while excluding prior winners", async () => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const message = "معايا سيولة ادخل في اي دلوقتي غير قطاع الادوية والمخابز علشان فيهم وطلعو الحمدالله خلاص";
        const email = `live-sector-${Date.now()}@example.invalid`;
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true });
        if (authError || !authData.user) throw new Error(authError?.message || "Unable to create evaluation user");
        const sessionId = crypto.randomUUID();
        try {
            const session = await supabase.from("ai_chat_sessions").insert({ id: sessionId, user_id: authData.user.id, title: "live sector evaluation" });
            if (session.error) throw new Error(session.error.message);
            const result = await runPipeline(
                message,
                [],
                { current_symbol: "COMI", last_symbols: ["COMI"], summary: "تحليل COMI" },
                null,
                [],
                supabase,
                [],
                authData.user.id,
                sessionId,
                `live-sector-${Date.now()}`
            );
            const { plan, response } = result;
            const output = result.tools;

            console.log(`[LIVE SECTOR RESPONSE]\n${response}`);
            expect(plan.tools).toEqual(["get_sector_liquidity"]);
            expect(plan.entities.sector).toBeNull();
            expect(plan.entities.excluded_sectors).toEqual(expect.arrayContaining(["أدوية", "مخابز ومطاحن"]));
            expect(output.results.find(result => result.tool === "get_sector_liquidity")?.data?.sectors?.length).toBeGreaterThan(0);
            expect(response).toContain("تم استبعاد: أدوية ومخابز ومطاحن");
            expect(response).not.toMatch(/Health Technology|Pharmaceutical|Milling|Bakery/i);
        } finally {
            await supabase.from("ai_chat_sessions").delete().eq("id", sessionId);
            await supabase.auth.admin.deleteUser(authData.user.id);
        }
    }, 60000);

    liveTest("runs a sequential user session through the full pipeline and persistence", async () => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const email = `live-eval-${Date.now()}@example.invalid`;
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({ email, password: crypto.randomUUID(), email_confirm: true });
        if (authError || !authData.user) throw new Error(authError?.message || "Unable to create evaluation user");
        const userId = authData.user.id;
        const sessionId = crypto.randomUUID();
        let state = { current_symbol: null, last_symbols: [], summary: null };
        let summary = null;
        const history = [];
        const turns = [
            ["ايه رأيك في سهم القلعة", "CCAP"],
            ["أبيع ولا أستنى؟", "CCAP"],
            ["قارن بين التجاري الدولي والشرقية للدخان", "COMI"],
        ];

        try {
            await retry(() => supabase.from("ai_chat_sessions").insert({ id: sessionId, user_id: userId, title: "live evaluation" }));
            for (const [message, expectedSymbol] of turns) {
                const startedAt = Date.now();
                const result = await runPipeline(message, [], state, summary, history, supabase, [], userId, sessionId, `eval-${Date.now()}`);
                console.log(`[SESSION EVAL] ${message}: ${Date.now() - startedAt}ms | ${result.plan.intent} | ${result.plan.tools.join(",")}`);
                expect(result.plan.entities.symbols).toContain(expectedSymbol);
                expect(result.response.length).toBeGreaterThan(40);
                expect(result.response).toMatch(/رأي|رأيي|تحليل|مقارنة|مخاطر|السعر/);
                await retry(() => supabase.from("ai_chat_messages").insert([
                    { session_id: sessionId, user_id: userId, role: "user", content: message },
                    { session_id: sessionId, user_id: userId, role: "assistant", content: result.response },
                ]));
                history.push({ role: "user", content: message }, { role: "assistant", content: result.response });
                state = { ...state, ...result.session_update };
                if (/المؤشر|أقدم توصية/.test(message)) expect(result.session_update.current_symbol).toBeNull();
            }

            const { data: session } = await supabase.from("ai_chat_sessions").select("state,summary_state").eq("id", sessionId).single();
            const { count } = await supabase.from("ai_chat_messages").select("*", { count: "exact", head: true }).eq("session_id", sessionId);
            const { count: factsCount } = await supabase.from("ai_chat_facts").select("*", { count: "exact", head: true }).eq("session_id", sessionId);
            expect(session?.state?.last_symbols).toEqual(expect.arrayContaining(["CCAP", "COMI", "EAST"]));
            expect(count).toBe(6);
            expect(factsCount).toBeGreaterThan(0);
        } finally {
            await supabase.from("ai_chat_sessions").delete().eq("id", sessionId);
            await supabase.auth.admin.deleteUser(userId);
        }
    }, 240000);

    liveTest("handles advanced financial follow-ups without stale context", async () => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({ email: `advanced-eval-${Date.now()}@example.invalid`, password: crypto.randomUUID(), email_confirm: true });
        if (authError || !authData.user) throw new Error(authError?.message || "Unable to create advanced evaluation user");
        const userId = authData.user.id;
        const sessionId = crypto.randomUUID();
        let state = { current_symbol: null, last_symbols: [], summary: null };
        const history = [];
        const turns = [
            ["حلل لي سهم KWIN", /رأيي الفني/],
            ["طيب ده قريب من الحد اليومي؟", /حد السعري|حد الصعود/],
            ["طيب ارجعلي لـ KWIN تاني، إيه أعلى سعر وصله؟", /أعلى سعر مسجل/],
            ["ولي رأيك في أداء المؤشر النهارده", /ملخص سيولة السوق|EGX30/],
            ["هات أقدم توصية عندك", /إشارات فنية تاريخية|إشارة|إشارة قديمة|الإشارات/],
            ["الأسهم فوق القيمة الفنية", /فوق القيمة الوسطية/],
            ["والأقل من القيمة العادلة", /تحت القيمة الوسطية/],
            ["هات الأسهم اللي تحت القيمة الفنية وفيها تصريف", /تحت القيمة الوسطية.*تصريف/s],
            ["تحت القيمة مع تجميع", /تحت القيمة الوسطية.*تجميع/s],
        ];
        try {
            await retry(() => supabase.from("ai_chat_sessions").insert({ id: sessionId, user_id: userId, title: "advanced live evaluation" }));
            for (const [message, expected] of turns) {
                const result = await runPipeline(message, [], state, null, history, supabase, [], userId, sessionId, `advanced-${Date.now()}`);
                expect(result.response).toMatch(expected);
                if (/المؤشر|أقدم توصية|تحت القيمة/.test(message)) expect(result.plan.entities.symbols).toEqual([]);
                history.push({ role: "user", content: message }, { role: "assistant", content: result.response });
                state = { ...state, ...result.session_update };
            }
        } finally {
            await supabase.from("ai_chat_sessions").delete().eq("id", sessionId);
            await supabase.auth.admin.deleteUser(userId);
        }
    }, 240000);
});
