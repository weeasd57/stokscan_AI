const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { runPipeline } = require("../ai/pipeline");
const { loadSessionSummary } = require("../ai/session");

const liveTest = process.env.RUN_LIVE_CHAT_TESTS === "1" ? it : it.skip;

function dataUrl(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

describe("LIVE chatbot user scenario: portfolio, filters, stocks, images", () => {
    liveTest("runs the complete 5/5/5 + two image session", async () => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: `live-user-scenario-${Date.now()}@example.invalid`,
            password: crypto.randomUUID(),
            email_confirm: true,
        });
        if (authError || !authData.user) throw new Error(authError?.message || "Could not create live test user");

        const userId = authData.user.id;
        const sessionId = crypto.randomUUID();
        const report = [];
        let state = { current_symbol: null, last_symbols: [], summary: null };
        let summary = null;
        let history = [];
        const keys = [process.env.NVIDIA_API_KEY, process.env.NVIDIA_SECONDARY_API_KEY].filter(Boolean);
        const reportPath = path.resolve(process.env.TEMP || process.env.TMP || ".", "live_user_scenario_report.json");
        let testError = null;

        const ask = async (category, message, images = []) => {
            const started = Date.now();
            const result = await runPipeline(message, images, state, summary, history, supabase, keys, userId, sessionId, `live-scenario-${Date.now()}`);
            const elapsed = Date.now() - started;
            report.push({ category, message, elapsed_ms: elapsed, intent: result.plan.intent, tools: result.plan.tools, symbols: result.plan.entities.symbols, clarification_needed: result.plan.clarification_needed, vision_error: result.vision_error, response: result.response });
            history.push({ role: "user", content: message }, { role: "assistant", content: result.response });
            state = { ...state, ...result.session_update };
            summary = await loadSessionSummary(supabase, sessionId, userId);
            return result;
        };

        try {
            await supabase.from("ai_chat_sessions").insert({ id: sessionId, user_id: userId, title: "live user scenario" });

            const portfolio = [
                "اعرض محفظتي",
                "ضيف في محفظتي سهم AMER 200 بسعر 45.65",
                "عدل كمية AMER إلى 150 سهم ومتوسط الشراء إلى 40 جنيه",
                "ضيف 10000 جنيه سيولة",
                "حلل محفظتي وقولي أكبر مركز ونسبة السيولة",
            ];
            for (const message of portfolio) await ask("portfolio", message);

            const filters = [
                "هات أسهم تقاطع MACD الصاعد",
                "هات الأسهم اللي RSI بتاعها أقل من 30",
                "هات الأسهم اللي كسرت SMA 200",
                "هات أسهم اختراق حجم التداول",
                "هات أسهم التجميع المتتالي لمدة يومين",
            ];
            for (const message of filters) await ask("technical_filter", message);

            const stocks = ["حلل COMI", "حلل EAST", "حلل AMER", "حلل WCDF", "حلل ABUK"];
            for (const message of stocks) await ask("stock_analysis", message);

            // Pull a small random sample of old user prompts from Supabase to
            // catch regressions that curated cases miss. Never copy likely
            // private portfolio/cash/image commands into the temporary user.
            const { data: oldRows } = await supabase
                .from("ai_chat_messages")
                .select("content")
                .eq("role", "user")
                .not("content", "is", null)
                .limit(250);
            const safeOldPrompts = (oldRows || [])
                .map(row => String(row.content || "").trim())
                .filter(text => text.length >= 5 && text.length <= 180)
                .filter(text => !/(محفظ|سيول|صورة|بعت|ضيف|عندي\s+\d+|كلمة السر|password|token)/i.test(text));
            const randomPrompts = safeOldPrompts.sort(() => Math.random() - 0.5).slice(0, 5);
            for (const message of randomPrompts) await ask("random_historical_user_prompt", message);

            const desktop = path.join(require("os").homedir(), "Desktop");
            const imageOne = dataUrl(path.join(desktop, "b0d66447-8fab-40cd-af32-c8103b959040.jpg"));
            const imageTwo = dataUrl(path.join(desktop, "778034194_122134681455205551_5688978777921724987_n.jpg"));
            await ask("image_1", "اقرأ صورة المحفظة دي", [imageOne]);
            await ask("image_1_confirmation", "دي محفظتي", []);
            await ask("image_2", "اقرأ صورة المحفظة الثانية دي", [imageTwo]);
            await ask("image_2_confirmation", "دي محفظتي", []);

            const finalSnapshot = await supabase.from("positions").select("symbol,quantity,entry_price,status").eq("user_id", userId).order("symbol");
            const finalProfile = await supabase.from("profiles").select("cash_balance").eq("id", userId).maybeSingle();
            fs.writeFileSync(reportPath, JSON.stringify({ user_id: userId, session_id: sessionId, report, final_positions: finalSnapshot.data, final_cash: finalProfile.data?.cash_balance ?? null }, null, 2), "utf8");
        } catch (error) {
            testError = error?.message || String(error);
            throw error;
        } finally {
            fs.writeFileSync(reportPath, JSON.stringify({ user_id: userId, session_id: sessionId, report, error: testError }, null, 2), "utf8");
            await supabase.from("ai_chat_messages").delete().eq("session_id", sessionId);
            await supabase.from("ai_chat_facts").delete().eq("session_id", sessionId);
            await supabase.from("ai_chat_sessions").delete().eq("id", sessionId);
            await supabase.auth.admin.deleteUser(userId);
        }
    }, 900000);
});
