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

const email = `user-suite-${Date.now()}@example.com`;
const password = `Qa!${crypto.randomUUID()}aA1`;

const questions = [
    "EGBE UBEE CANA",
    "عندك كام قطاع",
    "هات قايمه بالقطاعات",
    "قطاع العقارات",
    "أقوى الأسهم النهارده",
    "مين اعلى سيوله فى السوق وهل قطاع البنوك عليه تجميع؟",
    "قارن بين COMI و EAST من حيث التحليل المالي ومين فرصته احسن؟",
    "ما سبب هبوط سهم القلعة",
    "ما هي الاسهم المتوقعة صعودها هذا الاسبوع",
    "النساجون الشرقيون ORWE"
];

(async () => {
    let userId = null;
    try {
        const { data: created, error: createError } = await admin.auth.admin.createUser({
            email, password, email_confirm: true
        });
        if (createError) {
            console.error("User creation failed:", createError);
            return;
        }
        userId = created.user.id;

        const client = createClient(url, anonKey, { auth: { persistSession: false } });
        const { data: signedIn, error: signError } = await client.auth.signInWithPassword({ email, password });
        if (signError) {
            console.error("Sign in failed:", signError);
            return;
        }

        const sessionId = `suite_${Date.now()}`;
        console.log(`=======================================================`);
        console.log(`Starting Chat Session ID: ${sessionId} for User: ${email}`);
        console.log(`=======================================================\n`);

        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            console.log(`\n-------------------------------------------------------`);
            console.log(`[Q${i + 1}/${questions.length}] User: "${q}"`);
            console.log(`-------------------------------------------------------`);
            
            const start = Date.now();
            const res = await fetch(`${baseUrl}/api/ai-chat`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${signedIn.session.access_token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: q,
                    sessionId: sessionId,
                    stream: false
                })
            });

            const elapsed = ((Date.now() - start) / 1000).toFixed(2);
            if (!res.ok) {
                console.error(`HTTP ${res.status} Error:`, await res.text());
                continue;
            }

            const data = await res.json();
            console.log(`AI Response (${elapsed}s):\n${data.reply}\n`);
            if (data.suggestedButtons) {
                console.log(`Suggested Buttons: [${data.suggestedButtons.join(", ")}]`);
            }
        }

        console.log(`\n=======================================================`);
        console.log(`All ${questions.length} questions completed successfully in 1 continuous session!`);
        console.log(`=======================================================`);

    } finally {
        if (userId) await admin.auth.admin.deleteUser(userId);
    }
})();
