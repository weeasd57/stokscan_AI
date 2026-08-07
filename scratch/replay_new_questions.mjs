import fs from "node:fs";
import { createClient } from "../web/node_modules/@supabase/supabase-js/dist/index.mjs";

for (const line of fs.readFileSync(new URL("../web/.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const cases = [
    { email: "weeessd57@gmail.com", messages: ["الاسكندرية والمطاحن والشمس - اشتري مين بكره؟"] },
    { email: "b.ahmed2113@gmail.com", messages: ["اية الاسهم اللى عليها تجميع كبير الفترة الحالية وفرصتهم فالصعود عالية خلال فترة قريبه", "سهم جدوى حاليا فى اي منطقة", "هل سهم CPME الآن في مرحلة تجميع أم تصريف؟ اذكر الأسباب.", "تحليل السيولة لـ NINH"] },
    { email: "abdallahsaied912@gmail.com", messages: ["انا شاري سهم راية ب 8.14 وهو قعد ينزل ابيعه بكام؟\nو اية الاسهم اللى عليها تجميع كبير الفترة الحالية وفرصتهم فالصعود عالية خلال فترة قريبه"] }
];
const report = [];
for (const testCase of cases) {
    let userId = null;
    let sessionId = null;
    try {
        const link = await admin.auth.admin.generateLink({ type: "magiclink", email: testCase.email });
        if (link.error) throw link.error;
        const verified = await anon.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
        if (verified.error || !verified.data.session?.access_token) throw verified.error || new Error("No access token");
        userId = verified.data.user.id;
        for (const message of testCase.messages) {
            const startedAt = Date.now();
            const response = await fetch("http://127.0.0.1:3000/api/ai-chat", {
                method: "POST",
                headers: { Authorization: `Bearer ${verified.data.session.access_token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ message, session_id: sessionId, stream: false })
            });
            const body = await response.json();
            sessionId = body.session_id || sessionId;
            report.push({ email: testCase.email, message, status: response.status, latency_ms: Date.now() - startedAt, reply: body.reply || body.detail || "", tables: body.tables || [] });
        }
    } finally {
        if (sessionId && userId) {
            await admin.from("ai_chat_messages").delete().eq("session_id", sessionId).eq("user_id", userId);
            await admin.from("ai_chat_sessions").delete().eq("id", sessionId).eq("user_id", userId);
            await admin.from("ai_chat_facts").delete().eq("session_id", sessionId).eq("user_id", userId);
            await admin.from("ai_session_state").delete().eq("session_id", sessionId).eq("user_id", userId);
            await admin.from("ai_session_summaries").delete().eq("session_id", sessionId).eq("user_id", userId);
        }
    }
}
fs.writeFileSync(new URL("./new_results.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
