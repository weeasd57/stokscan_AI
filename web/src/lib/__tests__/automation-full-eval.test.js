/**
 * automation-full-eval.test.js
 * اختبار أتمتة شامل يحاكي بيئة المستخدم الحقيقية
 * يشغّل 18 سؤال ويولد تقرير كامل
 */

const { createClient } = require("@supabase/supabase-js");
const { runPipeline } = require("../ai/pipeline");

const liveTest = process.env.RUN_LIVE_CHAT_TESTS === "1" ? it : it.skip;

// ─── helper ──────────────────────────────────────────────────────────────────
function buildPlan(message, session = { current_symbol: null, last_symbols: [], summary: null }) {
    const rawPlan = buildCompoundDeterministicPlan(message, session);
    if (!rawPlan) {
        // بعض الجمل لا تُطابق أي pattern في الـ deterministic planner
        return {
            intent: "general_chat",
            confidence: 0.5,
            entities: { symbols: [], sector: null, reference: null, timeframe: null,
                requested_date: null, requested_start_date: null, requested_end_date: null, scan_direction: null },
            needs_vision_context: false, needs_history: false,
            needs_live_data: false, needs_historical_data: false,
            tools: [], clarification_needed: false,
            resolved_from: { symbol: null, message_id: null }
        };
    }
    return {
        intent: rawPlan.intent,
        confidence: rawPlan.confidence,
        entities: {
            reference: null, timeframe: null, requested_date: null,
            requested_start_date: null, requested_end_date: null,
            scan_direction: null, ...rawPlan.entities
        },
        needs_vision_context: false,
        needs_history: false,
        needs_live_data: true,
        needs_historical_data: false,
        tools: rawPlan.tools,
        clarification_needed: false,
        resolved_from: { symbol: null, message_id: null }
    };
}

// ─── الأسئلة ──────────────────────────────────────────────────────────────────
const QUESTIONS = [
    // سعر سهم
    { category: "سعر سهم",  q: "خبرني عن جنوب الوادي",                         expectSymbols: ["SVCE"], expectTools: ["get_stock"] },
    { category: "سعر سهم",  q: "سعر سهم فوري النهارده",                         expectSymbols: ["FWRY"], expectTools: ["get_stock"] },
    { category: "سعر سهم",  q: "مصر الجديدة بكم",                               expectSymbols: ["HELI"], expectTools: ["get_stock"] },
    { category: "سعر سهم",  q: "ابن سينا وصل فين",                               expectSymbols: ["ISPH"], expectTools: ["get_stock"] },
    // تحليل
    { category: "تحليل",    q: "حلل لي طلعت مصطفى",                             expectSymbols: ["TMGH"], expectTools: ["get_stock"] },
    { category: "تحليل",    q: "ايه رأيك في سهم القلعة",                         expectSymbols: ["CCAP"], expectTools: ["get_stock"], expectReply: /رأيي الفني.*لو ذكرت هدفك/s },
    { category: "تحليل",    q: "ممكن معلومات عن السويدي",                        expectSymbols: ["SWDY"], expectTools: ["get_stock"] },
    // مقارنة
    { category: "مقارنة",   q: "قارن بين التجاري الدولي والشرقية للدخان",       expectSymbols: ["COMI","EAST"], expectTools: ["get_comparison"] },
    { category: "مقارنة",   q: "حلل بالم هيلز وسوديك",                          expectSymbols: ["PHDC","OCDI"], expectTools: ["get_stock"] },
    // متعدد
    { category: "متعدد",    q: "ممكن العبور للاستثمار وجنوب الوادى وفوري",      expectSymbols: ["SVCE","FWRY"], expectTools: ["get_stock"] },
    // سوق
    { category: "سوق",      q: "ايه حالة البورصة النهارده",                     expectSymbols: [], expectTools: ["get_market"] },
    { category: "سوق",      q: "مين اقوى الأسهم النهارده",                      expectSymbols: [], expectTools: [] },
    { category: "سوق",      q: "أسهم فوق القيمة العادلة",                       expectSymbols: [], expectTools: ["get_fair_value_scan"], expectReply: /تقييم فني|القيمة الوسطية/ },
    // أخبار
    { category: "أخبار",    q: "أخبار سهم هيرميس",                              expectSymbols: ["HRHO"], expectTools: ["get_news"] },
    { category: "أخبار",    q: "أخبار قطاع البنوك",                             expectSymbols: [], expectTools: ["get_news"] },
    // حدود boundary
    { category: "حدود ✅",  q: "وي للاتصالات",                                  expectSymbols: ["ETEL"], expectTools: ["get_stock"], noSymbols: [] },
    { category: "حدود ✅",  q: "للأدوية وللاستثمار",                            expectSymbols: [], expectTools: [],  noSymbols: ["ETEL","ISPH"] },
    { category: "مركب",     q: "حلل ABUK هات أخباره لو كسر الدعم أعمل إيه؟",  expectSymbols: ["ABUK"], expectTools: ["get_stock","get_news"] },
];

// ─── تخزين النتائج ────────────────────────────────────────────────────────────
const report = [];
let supabase;
let userId;

beforeAll(async () => {
    supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data, error } = await supabase.auth.admin.createUser({
        email: `automation-eval-${Date.now()}@example.invalid`,
        password: crypto.randomUUID(),
        email_confirm: true,
    });
    if (error || !data.user) throw new Error(error?.message || "Unable to create automation user");
    userId = data.user.id;
});

// ─── تشغيل كل سؤال ───────────────────────────────────────────────────────────
describe("🤖 EGX Bots AI — اختبار أتمتة شامل (بيئة المستخدم)", () => {
    afterAll(async () => {
        // طباعة التقرير الكامل
        const fs = require("fs");
        const path = require("path");

        const passed  = report.filter(r => r.pass).length;
        const warned  = report.filter(r => !r.pass && r.responseOk).length;
        const failed  = report.filter(r => !r.responseOk).length;

        console.log("\n" + "═".repeat(72));
        console.log("  📊 تقرير الأتمتة الشامل — EGX Bots AI");
        console.log("═".repeat(72));
        console.log(`  ✅ نجح     : ${passed}`);
        console.log(`  ⚠️  تحذير   : ${warned}  (استجاب لكن رموز ناقصة)`);
        console.log(`  ❌ لا استجابة: ${failed}`);
        console.log("─".repeat(72));

        for (const r of report) {
            const icon = r.pass ? "✅" : r.responseOk ? "⚠️" : "❌";
            console.log(`${icon} [${r.category}] ${r.q}`);
            console.log(`   intent: ${r.intent} | tools: [${r.tools.join(",")}]`);
            console.log(`   symbols: [${r.symbols.join(",")}]`);
            if (r.missingSymbols.length) console.log(`   ↳ مفقود: ${r.missingSymbols.join(", ")}`);
            if (r.falsePositives.length) console.log(`   ↳ false+: ${r.falsePositives.join(", ")}`);
            if (r.missingTools.length)   console.log(`   ↳ tools مفقودة: ${r.missingTools.join(", ")}`);
            console.log(`   رد: ${r.reply.slice(0, 150).replace(/\n/g, " ")}...`);
            console.log();
        }
        console.log("═".repeat(72));

        // حفظ JSON
        const outPath = path.join(__dirname, "../../../../automation_report.json");
        try {
            fs.writeFileSync(outPath, JSON.stringify({
                generated_at: new Date().toISOString(),
                total: report.length, passed, warned, failed,
                results: report
            }, null, 2));
            console.log(`  📄 محفوظ: ${outPath}`);
        } catch (_) {}
        if (userId) await supabase.auth.admin.deleteUser(userId);
    });

    for (const { category, q, expectSymbols, expectTools, noSymbols = [], expectReply } of QUESTIONS) {
        liveTest(`[${category}] ${q}`, async () => {
            const sessionId = crypto.randomUUID();
            const { error: sessionError } = await supabase.from("ai_chat_sessions").insert({ id: sessionId, user_id: userId, title: q.slice(0, 80) });
            if (sessionError) throw sessionError;
            const result = await runPipeline(q, [], { current_symbol: null, last_symbols: [], summary: null }, null, [], supabase, [], userId, sessionId, `auto-${Date.now()}`);
            const plan = result.plan;
            const response = result.response;

            const symbols = plan.entities?.symbols || [];
            const tools   = plan.tools || [];
            const intent  = plan.intent || "?";
            const reply   = typeof response === "string" ? response : JSON.stringify(response);

            const missingSymbols = expectSymbols.filter(s => !symbols.includes(s));
            const falsePositives = noSymbols.filter(s => symbols.includes(s));
            const missingTools   = expectTools.filter(t => !tools.includes(t));

            const plannerLayerWorked = plan.intent !== "general_chat" || tools.length > 0;
            const gotResponse        = reply.length > 10;
            const symbolsOk          = missingSymbols.length === 0 && falsePositives.length === 0;
            const toolsOk            = missingTools.length === 0;
            const contentOk          = !expectReply || expectReply.test(reply);
            const pass               = symbolsOk && toolsOk && gotResponse && contentOk;

            // السبب التفصيلي للفشل
            const failReasons = [];
            if (!gotResponse)           failReasons.push(`رد قصير (${reply.length} حرف) — deterministic لا يغطي هذا النمط، يتحول للـ LLM في الإنتاج`);
            if (missingSymbols.length)  failReasons.push(`رموز مفقودة: ${missingSymbols.join(", ")}`);
            if (falsePositives.length)  failReasons.push(`false positive: ${falsePositives.join(", ")}`);
            if (!toolsOk && gotResponse) failReasons.push(`tools: توقعنا [${expectTools.join(",")}] وجاء [${tools.join(",")}]`);
            if (!contentOk) failReasons.push(`محتوى الرد لا يطابق العقد المتوقع: ${expectReply}`);

            report.push({
                category, q, pass, responseOk: gotResponse, plannerLayerWorked,
                intent, symbols, tools, reply: reply.slice(0, 300),
                missingSymbols, falsePositives, missingTools, failReasons
            });

            if (failReasons.length > 0) {
                console.warn(`  ⚠️  [${category}] "${q}"\n     ${failReasons.join("\n     ")}`);
            }
            if (!gotResponse && !plannerLayerWorked) {
                console.warn(`  → يُحوَّل للـ LLM planner في الإنتاج`);
            }

            expect(pass).toBe(true);
            await supabase.from("ai_chat_sessions").delete().eq("id", sessionId);
        }, 60000);
    }
});
