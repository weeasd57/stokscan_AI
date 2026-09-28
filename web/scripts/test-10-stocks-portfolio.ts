import fs from "fs";
import path from "path";

// Load environment variables manually
function loadEnv(filePath: string) {
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
            if (!process.env[key]) process.env[key] = val;
        }
    }
}

loadEnv(path.resolve(__dirname, "../.env.local"));
loadEnv(path.resolve(__dirname, "../../.env"));

import { getSupabaseClient } from "../src/lib/supabase/route-data";
import { runPipelineStream } from "../src/lib/ai/pipeline";
import { SessionState, SessionSummary } from "../src/lib/ai/types";
import { getNvidiaApiKeys, getDeepSeekApiKey } from "../src/lib/ai/server-secrets";

async function main() {
    console.log("=== Testing 10-Stock Real Portfolio & Multi-Timeframe Compound Queries ===");
    const supabase = getSupabaseClient();
    const nvidiaKeys = getNvidiaApiKeys();
    const deepseekKey = getDeepSeekApiKey();
    const apiKeys = deepseekKey ? [deepseekKey, ...nvidiaKeys] : nvidiaKeys;
    const userId = "d155893c-655a-4a4c-85e4-d16c310bb109";
    const sessionId = crypto.randomUUID();

    let sessionState: SessionState = {
        current_symbol: null,
        last_symbols: [],
        summary: null,
    };
    let sessionSummary: SessionSummary = {
        current_symbols: [],
        last_image_symbols: [],
        last_topic: null,
        open_references: [],
        last_data_date: null,
        last_vision_context: null,
        updated_at: new Date().toISOString(),
    };
    const history: Array<{ role: string; content: string }> = [];

    const questions = [
        {
            title: "السؤال 1: تحليل محفظة 10 أسهم بالكامل",
            text: "حلل محفظتى",
        },
        {
            title: "السؤال 2: سؤال مركب متعدد المدد الزمنية (متوسط 200 يوم طويل الأجل مقابل تشبع بيعي قصير الأجل)",
            text: "بناءً على المحفظة دي، مين من الأسهم متماسك فوق متوسط 200 يوم على المدى الطويل، وفي نفس الوقت بيتراجع أو في تشبع بيعي على المدى القصير (RSI) وينفع أزود فيه تدريجياً؟",
        },
        {
            title: "السؤال 3: سؤال مركب وقائي (تخفيف المراكز الضعيفة مقابل الاحتفاظ بالأسهم الدفاعية)",
            text: "لو السوق العام كسر دعمه وصحح في الأيام اللي جاية، رتبلي أول 3 أسهم مفروض أخفف منها بناءً على كسر الدعم وضعف السيولة والماكد، ومين الأسهم الدفاعية اللي تفضل معايا كاستثمار طويل الأجل؟",
        },
    ];

    const results: any[] = [];

    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        console.log(`\n======================================================`);
        console.log(`💬 ${q.title}`);
        console.log(`❓ السؤال: "${q.text}"`);
        console.log(`======================================================`);

        const startTime = Date.now();
        const messageId = `msg_${Date.now()}_${i}`;
        let capturedPlan: any = null;
        let capturedTools: any[] = [];
        let finalReply = "";

        const stream = runPipelineStream(
            q.text,
            [],
            sessionState,
            sessionSummary,
            history,
            supabase,
            apiKeys,
            userId,
            sessionId,
            messageId
        );

        for await (const event of stream) {
            if (event.type === "plan") {
                capturedPlan = event.data;
            } else if (event.type === "tools") {
                capturedTools = event.data?.results || [];
            } else if (event.type === "done") {
                finalReply = event.data?.response || "";
                if (event.data?.session_update) {
                    sessionState = { ...sessionState, ...event.data.session_update };
                }
            }
        }

        const durationMs = Date.now() - startTime;
        const durationSec = (durationMs / 1000).toFixed(2);
        console.log(`⏱️ وقت الاستجابة: ${durationSec} ثانية (${durationMs}ms)`);
        console.log(`🔍 Intent: ${capturedPlan?.intent} | Symbols: ${capturedPlan?.entities?.symbols?.join(", ")}`);
        console.log(`🛠️ Tools: [${capturedTools.map(t => t.tool).join(", ")}]`);
        console.log(`\n📄 الرد بالكامل:\n${finalReply}`);

        history.push({ role: "user", content: q.text });
        history.push({ role: "assistant", content: finalReply });

        results.push({
            title: q.title,
            question: q.text,
            durationMs,
            durationSec: Number(durationSec),
            plan: capturedPlan,
            tools: capturedTools.map(t => t.tool),
            response: finalReply,
        });
    }

    const outPath = path.resolve(__dirname, "../../portfolio_10_stocks_test_result.json");
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
    console.log(`\n✅ Results successfully written to ${outPath}`);
}

main().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
