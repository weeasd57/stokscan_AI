import { runPlanner } from "../web/src/lib/ai/planner";
import { generateFinalResponse } from "../web/src/lib/ai/final";
import { getSupabaseClient } from "../web/src/lib/supabase/route-data";
import * as path from "path";
import * as fs from "fs";

function loadEnvFile(filePath: string) {
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        content.split("\n").forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
                const parts = trimmed.split("=");
                const key = parts[0].trim();
                let value = parts.slice(1).join("=").trim();
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.substring(1, value.length - 1);
                }
                process.env[key] = value;
            }
        });
    }
}

loadEnvFile(path.resolve(__dirname, "../.env"));
loadEnvFile(path.resolve(__dirname, "../web/.env.local"));

async function main() {
    console.log("🧪 Testing AI Chat Flow with Updated Vision Configuration...");
    console.log("============================================================");

    const imagePath = "C:\\Users\\MR__CODER__\\.gemini\\antigravity\\brain\\d86860c0-464a-43c2-b9a7-81fa66370ce2\\media__1784634516280.png";
    if (!fs.existsSync(imagePath)) {
        console.error(`❌ Real portfolio image not found at: ${imagePath}`);
        process.exit(1);
    }

    const imgData = fs.readFileSync(imagePath);
    const b64Str = imgData.toString("base64");
    const imageList = [`data:image/png;base64,${b64Str}`];

    console.log("🖼️ Real image loaded and encoded successfully.");

    const supabase = getSupabaseClient();
    const { data: dbSettings } = await supabase.from("ai_chatbot_settings").select("api_key").eq("id", 1).maybeSingle();
    const dbApiKey = dbSettings?.api_key || null;

    const keysToTry = Array.from(new Set([
        process.env.NVIDIA_API_KEY,
        process.env.NVIDIA_SECONDARY_API_KEY,
        process.env.NVIDIA_NIM_API_KEY,
        dbApiKey
    ].filter((k): k is string => Boolean(k))));

    if (keysToTry.length === 0) {
        console.error("❌ No NVIDIA API keys available!");
        process.exit(1);
    }

    console.log(`🔑 Keys to test: ${keysToTry.length}`);

    const sessionState = {
        current_symbol: null,
        last_symbols: [],
        summary: null
    };

    console.log("\n🏃 Running Planner Stage...");
    const plannerStart = Date.now();
    try {
        const plannerResult = await runPlanner("Analyze the portfolio screenshot", imageList, sessionState, [], keysToTry);
        console.log(`✅ Planner completed in ${((Date.now() - plannerStart) / 1000).toFixed(2)}s`);
        console.log("Planner Result:", JSON.stringify(plannerResult, null, 2));

        console.log("\n🏃 Running Final Response Generation...");
        const finalStart = Date.now();
        const finalResponse = await generateFinalResponse(
            "Analyze the portfolio screenshot",
            imageList,
            "ABUK (Abu Qir Fertilizers): 72.89 EGP",
            plannerResult,
            [],
            keysToTry,
            ""
        );
        console.log(`✅ Final response completed in ${((Date.now() - finalStart) / 1000).toFixed(2)}s`);
        console.log("-------------------- FINAL RESPONSE --------------------");
        console.log(finalResponse);
        console.log("--------------------------------------------------------");
    } catch (err) {
        console.error("❌ Error running flow:", err);
    }
}

main().catch(err => {
    console.error("Fatal Error:", err);
    process.exit(1);
});
