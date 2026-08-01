import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../web/node_modules/@supabase/supabase-js/dist/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(p) {
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
}
loadEnv(path.join(__dirname, "../web/.env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

(async () => {
    const { data: elka, error } = await supabase.from("stock_fundamentals").select("*").eq("symbol", "ELKA");
    console.log("ELKA Fundamentals:", JSON.stringify(elka, null, 2), error);

    const { data: allFun } = await supabase.from("stock_fundamentals").select("symbol, data").limit(5);
    console.log("Sample Fundamentals data structure:", JSON.stringify(allFun, null, 2));
})();
