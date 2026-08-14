import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const env = {};
for (const p of [resolve("web/.env.local"), resolve(".env")]) {
    if (!existsSync(p)) continue;
    for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
}
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: K, Authorization: `Bearer ${K}` };

let r = await fetch(`${U}/rest/v1/stock_prices?select=date,open,high,low,close&symbol=ilike.AFMC&order=date.desc&limit=8`, { headers: H });
console.log("AFMC stock_prices:", r.status, (await r.text()).slice(0, 900));

r = await fetch(`${U}/rest/v1/stock_prices?select=symbol,date&order=date.desc&limit=3`, { headers: H });
console.log("latest rows any symbol:", r.status, (await r.text()).slice(0, 400));
