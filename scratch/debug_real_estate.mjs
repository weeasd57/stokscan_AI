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
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = "http://127.0.0.1:3000";

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const email = `debug-re-${Date.now()}@example.com`;
const password = `Qa!${crypto.randomUUID()}aA1`;

(async () => {
    let userId = null;
    try {
        const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        userId = created.user.id;
        const client = createClient(url, anonKey, { auth: { persistSession: false } });
        const { data: signedIn } = await client.auth.signInWithPassword({ email, password });

        const q = "العقارات حالتها إيه وهل عليها تجميع؟";
        console.log(`Sending query: "${q}"`);
        const res = await fetch(`${baseUrl}/api/ai-chat`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${signedIn.session.access_token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ message: q, stream: false })
        });

        console.log("HTTP Status:", res.status);
        const json = await res.json();
        console.log("Response JSON:", JSON.stringify(json, null, 2));

    } catch (err) {
        console.error("Error:", err);
    } finally {
        if (userId) await admin.auth.admin.deleteUser(userId);
    }
})();
