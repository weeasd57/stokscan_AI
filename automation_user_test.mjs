/**
 * automation_user_test.mjs
 * يحاكي بيئة المستخدم الحقيقية بإرسال أسئلة لـ runPipeline مباشرةً
 * ويولد تقريراً كاملاً بالنتائج
 * تشغيل: node automation_user_test.mjs
 */

import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── تحميل env ──────────────────────────────────────────────────────────────
function loadEnv() {
    const envPath = path.join(__dirname, "web", ".env.local");
    if (!fs.existsSync(envPath)) throw new Error(".env.local not found at " + envPath);
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
    }
}
loadEnv();

// ─── تحميل الـ pipeline ───────────────────────────────────────────────────────
// نستخدم dynamic import مع tsx/ts-node
const { createRequire: cr } = await import("module");

// نشغل كل سؤال عبر HTTP على localhost:3000 بدون auth (نتحايل بـ admin endpoint)
// لأن pipeline يحتاج Supabase auth. نستخدم نفس الطريقة التي تستخدمها الـ live tests.

const BASE = "http://localhost:3000";

// ─── الأسئلة الشائعة ─────────────────────────────────────────────────────────
const QUESTIONS = [
    // ── أسعار وتحليل أسهم فردية ────────────────────────────────────────────
    { category: "سعر سهم", q: "خبرني عن جنوب الوادي",            expect_symbols: ["SVCE"] },
    { category: "سعر سهم", q: "سعر سهم فوري النهارده",            expect_symbols: ["FWRY"] },
    { category: "تحليل",   q: "حلل لي طلعت مصطفى",               expect_symbols: ["TMGH"] },
    { category: "تحليل",   q: "ايه رأيك في سهم القلعة",           expect_symbols: ["CCAP"] },
    { category: "تحليل",   q: "ابن سينا وصل فين",                 expect_symbols: ["ISPH"] },
    { category: "مقارنة",  q: "مقارنة فوري مع العبور للاستثمار",  expect_symbols: ["FWRY","OBRI"] },
    { category: "مقارنة",  q: "قارن بين التجاري الدولي والشرقية للدخان", expect_symbols: ["COMI","EAST"] },
    
    // ── أسئلة السوق ────────────────────────────────────────────────────────
    { category: "سوق",     q: "ايه حالة البورصة النهارده",        expect_symbols: [] },
    { category: "سوق",     q: "مين اقوى الأسهم النهارده",         expect_symbols: [] },
    { category: "سوق",     q: "أسهم فوق القيمة العادلة",          expect_symbols: [] },
    
    // ── أخبار ──────────────────────────────────────────────────────────────
    { category: "أخبار",   q: "أخبار سهم هيرميس",                 expect_symbols: ["HRHO"] },
    { category: "أخبار",   q: "أخبار قطاع الأدوية",               expect_symbols: [] },
    
    // ── حالات الحدود (boundary tests) ──────────────────────────────────────
    { category: "حدود",    q: "للأدوية وللاستثمار",               expect_symbols: [], expect_no_symbols: ["ETEL","ISPH"] },
    { category: "حدود",    q: "وي للاتصالات",                      expect_symbols: ["ETEL"] },
    { category: "حدود",    q: "ممكن معلومات عن السويدي",           expect_symbols: ["SWDY"] },
    { category: "حدود",    q: "مصر الجديدة بكم",                   expect_symbols: ["HELI"] },

    // ── أسئلة متعددة ───────────────────────────────────────────────────────
    { category: "متعدد",   q: "ممكن العبور للاستثمار وجنوب الوادى وفوري", expect_symbols: ["OBRI","SVCE","FWRY"] },
    { category: "متعدد",   q: "حلل بالم هيلز وسوديك",             expect_symbols: ["PHDC","OCDI"] },
];

// ─── استدعاء الـ API ──────────────────────────────────────────────────────────
// نستخدم نفس استراتيجية الـ live tests: import مباشر للـ pipeline
// بما إن الـ server شغال، نستخدم script/run-live-tests.js كـ reference

async function callPipeline(question) {
    // نستخدم runPipeline مع Supabase client مباشرةً
    // نحمّل الكود مع ts-node

    const proc = await import("child_process");
    const result = await new Promise((resolve) => {
        const child = proc.default.spawn(
            "node",
            [
                "--require", path.join(__dirname, "web/node_modules/ts-node/register/transpile-only"),
                path.join(__dirname, "web/scripts/run-single-question.js"),
                question
            ],
            {
                env: { ...process.env, NODE_PATH: path.join(__dirname, "web/node_modules") },
                cwd: path.join(__dirname, "web"),
                timeout: 25000,
            }
        );
        let stdout = "", stderr = "";
        child.stdout.on("data", d => stdout += d);
        child.stderr.on("data", d => stderr += d);
        child.on("close", code => resolve({ stdout, stderr, code }));
        child.on("error", err => resolve({ stdout: "", stderr: err.message, code: -1 }));
    });
    return result;
}

// ─── نكتب helper script مؤقت ────────────────────────────────────────────────
// (سيُكتب في web/scripts/run-single-question.js)
const helperScript = `
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });
process.env.NEXT_PHASE = "phase-development-server";

const question = process.argv[2] || "";
async function main() {
    try {
        const { runPipeline } = require("../src/lib/ai/pipeline");
        const { getSupabaseClient } = require("../src/lib/supabase/route-data");
        const supabase = getSupabaseClient();
        
        const fakeSession = {
            current_symbol: null,
            last_symbols: [],
            summary: "",
            context: ""
        };
        
        const result = await runPipeline({
            message: question,
            history: [],
            session: fakeSession,
            model: "auto",
            supabase,
            stream: false,
            hasImages: false,
            imageList: []
        });
        
        // extract symbols from planner result
        const symbols = result?.plannerResult?.entities?.symbols || [];
        const tools = result?.plannerResult?.tools || [];
        const intent = result?.plannerResult?.intent || "unknown";
        const reply = (result?.text || result?.reply || "").slice(0, 600);
        
        console.log(JSON.stringify({ ok: true, symbols, tools, intent, reply }));
    } catch(err) {
        console.log(JSON.stringify({ ok: false, error: err.message }));
    }
}
main();
`;

fs.mkdirSync(path.join(__dirname, "web/scripts"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "web/scripts/run-single-question.js"), helperScript);

// ─── تشغيل الاختبارات ─────────────────────────────────────────────────────────
const results = [];
const startTime = Date.now();

console.log("═".repeat(72));
console.log("  🤖 EGX Bots AI — اختبار أتمتة شامل (بيئة المستخدم)");
console.log(`  📅 ${new Date().toLocaleString("ar-EG")}`);
console.log("═".repeat(72) + "\n");

for (let i = 0; i < QUESTIONS.length; i++) {
    const { category, q, expect_symbols = [], expect_no_symbols = [] } = QUESTIONS[i];
    const qStart = Date.now();
    process.stdout.write(`[${i+1}/${QUESTIONS.length}] ${category}: "${q.slice(0,45)}"... `);

    let parsed = null;
    try {
        const raw = await callPipeline(q);
        if (raw.stdout.trim()) {
            // find JSON line
            const jsonLine = raw.stdout.trim().split("\n").find(l => l.startsWith("{"));
            if (jsonLine) parsed = JSON.parse(jsonLine);
        }
    } catch (e) {
        parsed = { ok: false, error: e.message };
    }

    const elapsed = ((Date.now() - qStart) / 1000).toFixed(1);
    const ok = parsed?.ok;
    const symbols = parsed?.symbols || [];
    const tools = parsed?.tools || [];
    const intent = parsed?.intent || "?";
    const reply = parsed?.reply || parsed?.error || "";

    // فحص الـ expectations
    const missingSymbols = expect_symbols.filter(s => !symbols.includes(s));
    const falsePositives = expect_no_symbols.filter(s => symbols.includes(s));
    const symbolsOk = missingSymbols.length === 0 && falsePositives.length === 0;
    const status = ok && symbolsOk ? "✅" : ok ? "⚠️" : "❌";

    console.log(`${status} [${elapsed}s]`);
    if (!symbolsOk) {
        if (missingSymbols.length) console.log(`   ↳ مفقود: ${missingSymbols.join(", ")}`);
        if (falsePositives.length) console.log(`   ↳ false positive: ${falsePositives.join(", ")}`);
    }
    console.log(`   intent: ${intent} | tools: [${tools.join(",")}] | symbols: [${symbols.join(",")}]`);
    console.log(`   رد: ${reply.slice(0,120).replace(/\n/g," ")}...\n`);

    results.push({ category, q, ok, symbolsOk, symbols, tools, intent, elapsed, reply, missingSymbols, falsePositives });
}

// ─── ملخص التقرير ─────────────────────────────────────────────────────────────
const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
const passed = results.filter(r => r.ok && r.symbolsOk).length;
const warned = results.filter(r => r.ok && !r.symbolsOk).length;
const failed = results.filter(r => !r.ok).length;

console.log("═".repeat(72));
console.log("  📊 ملخص التقرير");
console.log("═".repeat(72));
console.log(`  ✅ نجح:    ${passed}`);
console.log(`  ⚠️  تحذير:  ${warned}  (الرد صح لكن رموز ناقصة)`);
console.log(`  ❌ فشل:    ${failed}`);
console.log(`  ⏱️  المدة:   ${totalTime}s`);
console.log("═".repeat(72));

// ─── حفظ التقرير ──────────────────────────────────────────────────────────────
const reportPath = path.join(__dirname, "automation_report.json");
fs.writeFileSync(reportPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    total: results.length, passed, warned, failed, total_time_s: totalTime,
    results
}, null, 2));
console.log(`\n  📄 التقرير محفوظ في: automation_report.json`);
