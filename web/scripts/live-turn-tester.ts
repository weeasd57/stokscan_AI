import fs from "fs";
import path from "path";

if (fs.existsSync(".env.local")) {
    const lines = fs.readFileSync(".env.local", "utf8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
            const idx = trimmed.indexOf("=");
            if (idx > 0) {
                const key = trimmed.slice(0, idx).trim();
                const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
                if (!process.env[key]) process.env[key] = val;
            }
        }
    }
}

import { runPipeline } from "../src/lib/ai/pipeline";
import { getSupabaseClient } from "../src/lib/supabase/route-data";
import { getNvidiaApiKeys, getDeepSeekApiKey } from "../src/lib/ai/server-secrets";
import { loadSessionState, loadSessionSummary } from "../src/lib/ai/session";

async function main() {
    console.log("=================================================");
    console.log("🚀 STARTING LIVE MULTI-TURN TEST (IMAGE + CONTEXT FOLLOW-UP)");
    console.log("=================================================");

    const supabase = getSupabaseClient();
    const userId = "3e985e18-840d-48e6-b502-51051760bbd0"; // test1@gmail.com
    const sessionId = `live_test_session_${Date.now()}`;
    const apiKeys = getNvidiaApiKeys();
    const deepseekKey = getDeepSeekApiKey();

    console.log(`User ID: ${userId}`);
    console.log(`Session ID: ${sessionId}`);
    console.log(`NVIDIA Keys: ${apiKeys.length}, DeepSeek Key present: ${Boolean(deepseekKey)}`);

    // 1. Read Image
    const imgPath = path.resolve("C:/Users/MR__CODER__/.gemini/antigravity/brain/d22a5115-9326-4ca5-8efc-7388e3d1a360/.user_uploaded/media_1790624762609.png");
    const imgBuffer = fs.readFileSync(imgPath);
    const imgBase64 = `data:image/png;base64,${imgBuffer.toString("base64")}`;
    console.log(`Image loaded: ${(imgBuffer.length / 1024).toFixed(1)} KB`);

    // ==========================================
    // TURN 1: Image + Portfolio Question
    // ==========================================
    const turn1Message = "شوف الصورة دي وقولي رأيك في الأسهم ومحفظتي واعمل ايه";
    console.log("\n-------------------------------------------------");
    console.log(`▶ TURN 1 [USER]: ${turn1Message}`);
    console.log("-------------------------------------------------");

    const t1Start = Date.now();
    let sessionState = await loadSessionState(supabase, sessionId, userId);
    let sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

    const result1 = await runPipeline(
        turn1Message,
        [imgBase64],
        sessionState,
        sessionSummary,
        [],
        supabase,
        apiKeys,
        userId,
        sessionId,
        `msg_1_${Date.now()}`
    );
    const t1Duration = ((Date.now() - t1Start) / 1000).toFixed(2);

    console.log(`\n⏱️ Turn 1 Completed in: ${t1Duration}s`);
    console.log(`Planned Intent: ${result1.plan.intent}`);
    console.log(`Planned Tools: ${result1.plan.tools.join(", ")}`);
    console.log(`Symbols extracted: ${(result1.plan.entities.symbols || []).join(", ")}`);
    console.log("\n--- [BOT RESPONSE - TURN 1] ---");
    console.log(result1.response);
    console.log("---------------------------------\n");

    // ==========================================
    // TURN 2: Short, Indirect Follow-up Answer
    // ==========================================
    // Check what the assistant asked at the end
    const lastParagraph = result1.response.trim().split("\n").filter(Boolean).slice(-3).join(" ");
    console.log(`Assistant closing question context: ${lastParagraph}`);

    // If assistant asked about مضاربة vs استثمار or small caps, let's reply with a short indirect answer
    let turn2Message = "صغيره";
    if (/مضارب|سريع/i.test(lastParagraph)) {
        turn2Message = "مضاربة";
    } else if (/قيادي|تلاتين|egx30/i.test(lastParagraph)) {
        turn2Message = "صغيره";
    } else if (/قطاع/i.test(lastParagraph)) {
        turn2Message = "عقارات";
    } else if (/تجميع|سيول/i.test(lastParagraph)) {
        turn2Message = "تجميع";
    } else {
        turn2Message = "صغيره";
    }

    console.log("\n-------------------------------------------------");
    console.log(`▶ TURN 2 [USER SHORT ANSWER]: "${turn2Message}"`);
    console.log("-------------------------------------------------");

    const history = [
        { role: "user", content: turn1Message },
        { role: "assistant", content: result1.response }
    ];

    sessionState = await loadSessionState(supabase, sessionId, userId);
    sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

    const t2Start = Date.now();
    const result2 = await runPipeline(
        turn2Message,
        [],
        sessionState,
        sessionSummary,
        history,
        supabase,
        apiKeys,
        userId,
        sessionId,
        `msg_2_${Date.now()}`
    );
    const t2Duration = ((Date.now() - t2Start) / 1000).toFixed(2);

    console.log(`\n⏱️ Turn 2 Completed in: ${t2Duration}s`);
    console.log(`Planned Intent: ${result2.plan.intent}`);
    console.log(`Planned Tools: ${result2.plan.tools.join(", ")}`);
    console.log(`needs_history: ${result2.plan.needs_history}`);
    console.log("\n--- [BOT RESPONSE - TURN 2] ---");
    console.log(result2.response);
    console.log("---------------------------------\n");

    const hasAmnesiaComplaint = /(?:سؤالك.*غير واضح|غير مسجل في الـ 236|لم أفهم|حدد السهم)/i.test(result2.response);
    if (hasAmnesiaComplaint) {
        console.error("❌ FAILED: Bot still complained about short answer!");
    } else {
        console.log("✅ SUCCESS: Bot seamlessly understood the short follow-up in context!");
    }

    // ==========================================
    // TURN 3: Short reference to prior result ("الاولاني")
    // ==========================================
    const turn3Message = "الاولاني";
    console.log("\n-------------------------------------------------");
    console.log(`▶ TURN 3 [USER SHORT REFERENCE]: "${turn3Message}"`);
    console.log("-------------------------------------------------");

    history.push({ role: "user", content: turn2Message });
    history.push({ role: "assistant", content: result2.response });

    sessionState = await loadSessionState(supabase, sessionId, userId);
    sessionSummary = await loadSessionSummary(supabase, sessionId, userId);

    const t3Start = Date.now();
    const result3 = await runPipeline(
        turn3Message,
        [],
        sessionState,
        sessionSummary,
        history,
        supabase,
        apiKeys,
        userId,
        sessionId,
        `msg_3_${Date.now()}`
    );
    const t3Duration = ((Date.now() - t3Start) / 1000).toFixed(2);

    console.log(`\n⏱️ Turn 3 Completed in: ${t3Duration}s`);
    console.log(`Planned Intent: ${result3.plan.intent}`);
    console.log(`Planned Tools: ${result3.plan.tools.join(", ")}`);
    console.log(`needs_history: ${result3.plan.needs_history}`);
    console.log(`Symbols: ${(result3.plan.entities.symbols || []).join(", ")}`);
    console.log("\n--- [BOT RESPONSE - TURN 3] ---");
    console.log(result3.response);
    console.log("---------------------------------\n");
}

main().catch(err => {
    console.error("Fatal test error:", err);
    process.exit(1);
});
