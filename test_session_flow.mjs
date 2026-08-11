/**
 * test_session_flow.mjs
 * ─────────────────────────────────────────────────────────────
 * اختبار تدفّق الجلسة الكامل ضد البيئة الحقيقية (localhost:3000)
 *
 * يشغّل السيناريو الحقيقي اللي بيواجهه المستخدم:
 *   1. طلب بدون تسجيل دخول        → متوقع 401 (الحماية شغالة)
 *   2. "المتوقع يرتفع الأسبوع ده"  → متوقع 200 + رد تحليلي (مش Unauthorized)
 *   3. سؤال متابعة بنفس الجلسة    → متوقع 200 + استمرارية السياق
 *   4. جلب جلسات المستخدم          → متوقع 200
 *
 * التشغيل:  node test_session_flow.mjs
 * يتطلب:    تشغيل سيرفر الويب (npm run dev داخل web/)
 * ─────────────────────────────────────────────────────────────
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ENV_PATH = resolve(process.cwd(), "web", ".env.local");

// ─── تحميل متغيرات البيئة ────────────────────────────────────
function loadEnv() {
    const paths = [ENV_PATH, resolve(process.cwd(), "web", ".env")];
    const env = {};
    for (const p of paths) {
        if (!existsSync(p)) continue;
        for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
    }
    return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const TEST_EMAIL = "session.flow.test@example.com";
const TEST_PASSWORD = "FlowTest@2026!";

let passed = 0;
let failed = 0;

function report(name, ok, detail = "") {
    if (ok) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ─── أدوات مساعدة ────────────────────────────────────────────
async function ensureTestUser() {
    // محاولة تسجيل دخول مباشرة أولاً
    let token = await signIn();
    if (token) return token;

    // إنشاء المستخدم عبر service role ثم إعادة تسجيل الدخول
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            email_confirm: true
        })
    });
    if (!createRes.ok && createRes.status !== 422) {
        throw new Error(`فشل إنشاء مستخدم الاختبار: ${createRes.status} ${await createRes.text()}`);
    }
    token = await signIn();
    if (!token) throw new Error("فشل تسجيل دخول مستخدم الاختبار بعد الإنشاء");
    return token;
}

async function signIn() {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
}

async function chat(token, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    try {
        const res = await fetch(`${BASE_URL}/api/ai-chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ stream: false, ...payload }),
            signal: controller.signal
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { status: res.status, json, text };
    } finally {
        clearTimeout(timer);
    }
}

function isRealAnalysisReply(reply) {
    if (!reply || typeof reply !== "string") return false;
    if (/unauthorized/i.test(reply)) return false;
    return reply.trim().length > 40;
}

// ─── الاختبارات ──────────────────────────────────────────────
async function main() {
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  اختبار تدفق الجلسة — البيئة الحقيقية             ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log(`السيرفر: ${BASE_URL}\n`);

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
        console.error("❌ متغيرات Supabase ناقصة في web/.env.local");
        process.exit(1);
    }

    // 0) التأكد من وصول السيرفر
    try {
        await fetch(BASE_URL, { signal: AbortSignal.timeout(8000) });
    } catch {
        console.error(`❌ السيرفر مش شغال على ${BASE_URL} — شغّل (cd web; npm run dev) أولاً`);
        process.exit(1);
    }

    // 1) بدون تسجيل دخول → 401
    console.log("[1] حماية المسار (بدون token):");
    const anon = await chat(null, { message: "المتوقع يرتفع الأسبوع ده" });
    report("يرفض الطلب غير المسجل بـ 401", anon.status === 401, `status=${anon.status}`);

    // 2) تسجيل دخول مستخدم الاختبار
    console.log("\n[2] تهيئة مستخدم الاختبار:");
    const token = await ensureTestUser();
    report("تم الحصول على access_token", Boolean(token));

    // 3) السؤال الأساسي: المتوقع يرتفع الأسبوع ده
    console.log("\n[3] السؤال: «المتوقع يرتفع الأسبوع ده»");
    const t0 = Date.now();
    const first = await chat(token, { message: "المتوقع يرتفع الأسبوع ده" });
    console.log(`    (status=${first.status} خلال ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    report("لا يرجع Unauthorized", first.status !== 401, `status=${first.status} body=${first.text.slice(0, 120)}`);
    report("يرجع 200", first.status === 200, `status=${first.status} body=${first.text.slice(0, 200)}`);
    const firstReply = first.json?.reply || "";
    report("الرد تحليلي فعلي (مش رسالة خطأ)", isRealAnalysisReply(firstReply), `reply=${firstReply.slice(0, 120)}`);
    const sessionId = first.json?.session_id || null;
    report("يرجع session_id", Boolean(sessionId));
    console.log("    ── مقتطف من الرد ──");
    console.log("    " + (firstReply || first.text).slice(0, 400).replace(/\n/g, "\n    "));
    console.log("    ───────────────────");

    // 4) متابعة بنفس الجلسة (استمرارية السياق)
    console.log("\n[4] سؤال متابعة بنفس الجلسة: «فين السيولة دلوقتي؟»");
    const second = await chat(token, { message: "فين السيولة دلوقتي؟", session_id: sessionId });
    report("يرجع 200", second.status === 200, `status=${second.status} body=${second.text.slice(0, 200)}`);
    const secondReply = second.json?.reply || "";
    report("رد المتابعة تحليلي فعلي", isRealAnalysisReply(secondReply), `reply=${secondReply.slice(0, 120)}`);
    report("نفس الجلسة مستمرة", !second.json?.session_id || second.json.session_id === sessionId,
        `session=${second.json?.session_id}`);

    // 5) سهم محدد + متابعة ضمير (سياق السهم)
    console.log("\n[5] سياق السهم: «حلل COMI» ثم «أخباره»");
    const stockQ = await chat(token, { message: "حلل COMI" });
    report("تحليل سهم يرجع 200", stockQ.status === 200, `status=${stockQ.status}`);
    const stockSession = stockQ.json?.session_id || null;
    const followUp = await chat(token, { message: "أخباره", session_id: stockSession });
    report("متابعة الضمير ترجع 200", followUp.status === 200, `status=${followUp.status}`);
    const followReply = followUp.json?.reply || "";
    report("رد المتابعة مرتبط بسهم (مش Unauthorized/خطأ)", isRealAnalysisReply(followReply), `reply=${followReply.slice(0, 120)}`);

    // 6) جلب الجلسات
    console.log("\n[6] جلب جلسات المستخدم:");
    const sessionsRes = await fetch(`${BASE_URL}/api/ai-chat?action=sessions`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const sessionsJson = await sessionsRes.json().catch(() => null);
    report("GET sessions يرجع 200", sessionsRes.status === 200, `status=${sessionsRes.status}`);
    report("قائمة الجلسات موجودة", Array.isArray(sessionsJson?.sessions) && sessionsJson.sessions.length > 0);

    // 7) سيناريوهات المستخدم التي كانت تفشل (ردود طبيعية مش قوالب)
    console.log("\n[7] سيناريوهات الجودة (ردود طبيعية بدل data dump):");
    const qualityCases = [
        { q: "scem افضل سعر بيع", expect: /SCEM/ },
        { q: "هل اسهم الأدوية مكملة فى الارتفاع ام سيحدث تصحيح من خلال البيانات المتاحة", expect: /(ارتفاع|تصحيح|زخم|مؤشر|RSI)/ },
        { q: "المتوقع يرتفع الأسبوع ده", expect: /\d/ }
    ];
    for (const c of qualityCases) {
        const r = await chat(token, { message: c.q });
        const reply = r.json?.reply || "";
        const isDump = reply.includes("تعذر صياغة التحليل النصي")
            || reply.includes("بيانات التداول اللحظية لـ")
            || /مبني على \d+ سهماً في أحدث بيانات/.test(reply);
        report(`«${c.q.slice(0, 30)}...» → 200`, r.status === 200, `status=${r.status}`);
        report(`«${c.q.slice(0, 30)}...» → رد طبيعي (مش fallback dump)`, !isDump && isRealAnalysisReply(reply), `reply=${reply.slice(0, 150).replace(/\n/g, " ")}`);
        report(`«${c.q.slice(0, 30)}...» → يجاوب على السؤال فعلاً`, c.expect.test(reply), `reply=${reply.slice(0, 120).replace(/\n/g, " ")}`);
    }

    // ─── الملخص ───
    console.log("\n══════════════════════════════════════════════════");
    console.log(`النتيجة: ${passed} ناجح / ${failed} فاشل`);
    console.log("══════════════════════════════════════════════════");
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error("❌ خطأ غير متوقع:", err.message);
    process.exit(1);
});
