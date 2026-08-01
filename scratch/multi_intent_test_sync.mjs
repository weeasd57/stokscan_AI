import fs from "node:fs";
import { createClient } from "../web/node_modules/@supabase/supabase-js/dist/index.mjs";

function loadEnv(path) {
    if (!fs.existsSync(path)) return;
    for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
}

loadEnv(new URL("../web/.env.local", import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.CHAT_TEST_URL || "http://127.0.0.1:3000";

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const conversations = [
    [
        "حلل ABUK هات أخباره لو كسر الدعم أعمل إيه؟",
        "مين اعلى سيوله فى السوق وهل قطاع البنوك عليه تجميع؟",
        "قارن بين COMI و EAST من حيث التحليل المالي ومين فرصته احسن؟"
    ]
];

for (let conversationIndex = 0; conversationIndex < conversations.length; conversationIndex++) {
    const suffix = `${Date.now()}-${conversationIndex}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `chat-multiqa-${suffix}@example.com`;
    const password = `Qa!${crypto.randomUUID()}aA1`;
    let userId = null;

    try {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
            email, password, email_confirm: true
        });
        userId = created.user.id;

        const client = createClient(url, anonKey, { auth: { persistSession: false } });
        const { data: signedIn } = await client.auth.signInWithPassword({ email, password });

        for (const message of conversations[conversationIndex]) {
            console.log(`\n=== SENDING REQUEST ===\nQuery: ${message}`);
            
            const response = await fetch(`${baseUrl}/api/ai-chat`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${signedIn.session.access_token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ message, stream: false })
            });
            
            const data = await response.json();
            console.log(`Status: ${response.status}`);
            console.log(`\n--- BOT RESPONSE ---\n${data.reply}\n--------------------\n`);
        }
    } finally {
        if (userId) await admin.auth.admin.deleteUser(userId);
    }
}
