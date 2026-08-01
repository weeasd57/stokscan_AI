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
    console.log("Searching stocks table...");
    const { data: stocks, error: e1 } = await supabase.from("stocks").select("symbol, name").or("symbol.ilike.%ELKA%,name.ilike.%القاهرة%,name.ilike.%اسكان%,name.ilike.%إسكان%");
    console.log("Stocks result:", stocks, e1);

    console.log("Searching stock_fundamentals table...");
    const { data: fun, error: e2 } = await supabase.from("stock_fundamentals").select("symbol, company_name, fair_value").or("symbol.ilike.%ELKA%,company_name.ilike.%القاهرة%,company_name.ilike.%اسكان%");
    console.log("Fundamentals result:", fun, e2);
})();
