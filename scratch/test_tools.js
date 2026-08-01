const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
function loadEnv() {
    const data = fs.readFileSync("web/.env.local", "utf8");
    for (const line of data.split("\n")) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match) process.env[match[1]] = match[2].trim();
    }
}
loadEnv();
const { executeStructuredTools } = require("./web/src/lib/ai/tools-v2");

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const plan = {
    intent: "follow_up",
    confidence: 0.9,
    entities: {
        symbols: ["ABUK"],
        sector: null,
        wants_table: false,
        timeframe: "1d",
        requested_date: null
    },
    tools: ["get_stock", "get_news", "get_stock_levels"],
    needs_live_data: true,
    needs_historical_data: false
};

(async () => {
    try {
        const results = await executeStructuredTools(supabase, plan, [], "test", "test");
        console.log("TOOL RESULTS:", JSON.stringify(results, null, 2));
    } catch(e) {
        console.error(e);
    }
})();
