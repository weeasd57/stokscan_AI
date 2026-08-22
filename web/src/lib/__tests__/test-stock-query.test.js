const { createClient } = require("@supabase/supabase-js");
const { runPipeline } = require("../ai/pipeline");

const liveTest = process.env.RUN_LIVE_CHAT_TESTS === "1" ? it : it.skip;

describe("Live test stock query", () => {
    liveTest("queries AALR and AFMC stocks", async () => {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const suffix = `${Date.now()}`;
        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: `aalr-afmc-eval-${suffix}@example.invalid`,
            password: crypto.randomUUID(),
            email_confirm: true
        });
        if (authError || !authData.user) throw new Error(authError?.message || "Unable to create test user");
        const sessionId = crypto.randomUUID();
        try {
            const session = await supabase.from("ai_chat_sessions").insert({ id: sessionId, user_id: authData.user.id, title: "Test AALR AFMC" });
            if (session.error) throw new Error(session.error.message);
            
            const message = "حلل سهمي aalr و afmc بالتفصيل ورأيك الإحصائي في الموديلين";
            const result = await runPipeline(
                message,
                [],
                { current_symbol: null, last_symbols: [] },
                null,
                [],
                supabase,
                [],
                authData.user.id,
                sessionId,
                `aalr-afmc-${suffix}`
            );

            console.log("\n==================== TEST RESPONSE START ====================\n");
            console.log(result.response);
            console.log("\n==================== TEST RESPONSE END ====================\n");

            if (result.tables && result.tables.length > 0) {
                console.log("\n==================== TABLES START ====================\n");
                result.tables.forEach(table => {
                    console.log(`\nTable: ${table.title} (Source: ${table.source})`);
                    console.log("Headers:", table.headers.join(" | "));
                    table.rows.forEach(row => {
                        console.log("Row:", row.join(" | "));
                    });
                });
                console.log("\n==================== TABLES END ====================\n");
            }
        } finally {
            await supabase.from("ai_chat_sessions").delete().eq("id", sessionId);
            await supabase.auth.admin.deleteUser(authData.user.id);
        }
    }, 180000);
});
