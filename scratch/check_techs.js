const { createClient } = require("./web/node_modules/@supabase/supabase-js/dist/index.js");
const fs = require("fs");

function loadEnv() {
    const data = fs.readFileSync("./web/.env.local", "utf8");
    for (const line of data.split("\n")) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match) process.env[match[1]] = match[2].trim();
    }
}
loadEnv();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    const { data } = await supabase.from("stock_technical_indicators").select("*").limit(1);
    console.log(Object.keys(data[0]));
})();
