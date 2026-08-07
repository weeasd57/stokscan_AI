import fs from "node:fs";
import { createClient } from "../web/node_modules/@supabase/supabase-js/dist/index.mjs";

for (const line of fs.readFileSync(new URL("../web/.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const baseUrl = process.env.CHAT_TEST_URL || "http://127.0.0.1:3000";

const conversations = [
    {
        email: "weeessd57@gmail.com",
        messages: ["الاسكندرية والمطاحن والشمس - اشتري مين بكره؟"]
    },
    {
        email: "b.ahmed2113@gmail.com",
        messages: [
            "اية الاسهم اللى عليها تجميع كبير الفترة الحالية وفرصتهم فالصعود عالية خلال فترة قريبه",
            "سهم جدوى حاليا فى اي منطقة",
            "اعمل مسح فني لسهم CPME واشرح المؤشرات الفنية الحالية فقط بدون توصية شراء أو بيع.\nما هو اتجاه سهم CPME الحالي؟\nهل سهم CPME في مرحلة تجميع أم تصريف؟ ولماذا؟\nاعرض قيم RSI وMACD والمتوسطات المتحركة لسهم CPME.\nما هي مستويات الدعم والمقاومة الحالية لسهم CPME؟",
            "هل سهم CPME الآن في مرحلة تجميع أم تصريف؟ اذكر الأسباب.",
            "درجة التجميع أعلى من 75. ✅ نسبة الحجم أكبر من 1.5×. ✅ لا يوجد تصريف (Distribution = 0). ✅ التجميع مستمر يومين أو أكثر.",
            "ابعتلى الاسهم اللى ينطبق عليها الشروط دى",
            "ابعتلى الاسهم اللى ينطبق عليها الشروط دى درجة التجميع أعلى من 75. ✅ نسبة الحجم أكبر من 1.5×. ✅ لا يوجد تصريف (Distribution = 0). ✅ التجميع مستمر يومين أو أكثر."
        ]
    },
    {
        email: "abdallahsaied912@gmail.com",
        messages: [
            "Bioc مشترية عند 383",
            "مستهدفاته ايه",
            "مستهدفاته ايه bioc ?",
            "Crst?",
            "Caed ؟",
            "Caed ?",
            "ايوة عن سهم caed ؟"
        ]
    }
];

const report = [];

for (const conversation of conversations) {
    let userId = null;
    let sessionId = null;
    try {
        const link = await admin.auth.admin.generateLink({ type: "magiclink", email: conversation.email });
        if (link.error) throw link.error;
        const tokenHash = link.data.properties?.hashed_token;
        const verified = await anon.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
        if (verified.error || !verified.data.session?.access_token) throw verified.error || new Error("No access token");
        userId = verified.data.user.id;

        for (const message of conversation.messages) {
            const startedAt = Date.now();
            const response = await fetch(`${baseUrl}/api/ai-chat`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${verified.data.session.access_token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ message, session_id: sessionId, stream: false })
            });
            const body = await response.json();
            sessionId = body.session_id || sessionId;
            report.push({
                email: conversation.email,
                message,
                status: response.status,
                latency_ms: Date.now() - startedAt,
                session_id: sessionId,
                reply: body.reply || body.detail || "",
                tables: body.tables || [],
                suggested_buttons: body.suggested_buttons || [],
                session_state: body.session_state || null
            });
        }
    } catch (error) {
        report.push({ email: conversation.email, error: String(error?.message || error) });
    } finally {
        if (sessionId && userId) {
            await admin.from("ai_chat_messages").delete().eq("session_id", sessionId).eq("user_id", userId);
            await admin.from("ai_chat_sessions").delete().eq("id", sessionId).eq("user_id", userId);
        }
        if (userId) {
            await admin.from("ai_chatbot_limits").delete().eq("user_id", userId);
            await admin.from("ai_session_state").delete().eq("user_id", userId);
            await admin.from("ai_session_summaries").delete().eq("user_id", userId);
            await admin.from("ai_chat_facts").delete().eq("user_id", userId);
        }
    }
}

fs.writeFileSync(new URL("./real_user_replay.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
