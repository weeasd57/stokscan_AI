
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });
process.env.NEXT_PHASE = "phase-development-server";

const question = process.argv[2] || "";
async function main() {
    try {
        const { runPipeline } = require("../src/lib/ai/pipeline");
        const { getSupabaseClient } = require("../src/lib/supabase/route-data");
        const supabase = getSupabaseClient();
        
        const fakeSession = {
            current_symbol: null,
            last_symbols: [],
            summary: "",
            context: ""
        };
        
        const result = await runPipeline({
            message: question,
            history: [],
            session: fakeSession,
            model: "auto",
            supabase,
            stream: false,
            hasImages: false,
            imageList: []
        });
        
        // extract symbols from planner result
        const symbols = result?.plannerResult?.entities?.symbols || [];
        const tools = result?.plannerResult?.tools || [];
        const intent = result?.plannerResult?.intent || "unknown";
        const reply = (result?.text || result?.reply || "").slice(0, 600);
        
        console.log(JSON.stringify({ ok: true, symbols, tools, intent, reply }));
    } catch(err) {
        console.log(JSON.stringify({ ok: false, error: err.message }));
    }
}
main();
