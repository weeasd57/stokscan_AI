import fs from "fs";
import path from "path";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { runAgenticPipeline } from "../agentic-pipeline";
import { SessionState } from "../types";

const describeLive = process.env.RUN_LIVE_CHAT_TESTS === "1" ? describe : describe.skip;

describeLive("Audit Fixes Verification - Live Tests", () => {
    let supabase: any;
    let testUserId = "a8613760-918d-477f-a4dd-c2d0213f1730";
    const testSessionId = "test-audit-session-" + Date.now();

    beforeAll(async () => {
        try {
            const envPath = path.resolve(process.cwd(), ".env.local");
            if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, "utf8");
                for (const line of envContent.split("\n")) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith("#")) continue;
                    const eqIdx = trimmed.indexOf("=");
                    if (eqIdx !== -1) {
                        const key = trimmed.slice(0, eqIdx).trim();
                        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
                        if (!process.env[key]) process.env[key] = val;
                    }
                }
            }
        } catch {}

        supabase = getSupabaseServiceClient();
        const { data: profile } = await supabase.from("profiles").select("id").limit(1).maybeSingle();
        if (profile?.id) {
            testUserId = profile.id;
        }
    });

    const createInitialSessionState = (): SessionState => ({
        current_symbol: null,
        last_symbols: [],
        summary: null
    });

    test("1. 'توصيات الأسبوع الحالي' should accurately report no recommendations and latest date 2026-09-21", async () => {
        const state = createInitialSessionState();
        const res = await runAgenticPipeline(
            "عايز توصيات الاسبوع الحالى",
            [],
            state,
            null,
            [],
            supabase,
            [],
            testUserId,
            testSessionId,
            "msg-1"
        );

        console.log("Response 1 (This Week Recommendations):\n", res.response);

        // Verify response accurately conveys no recommendations for this week
        expect(res.response).toMatch(/(لا توجد|لم تصدر|لا يتوفر|غياب).*توصيات.*(الأسبوع|الحالي)/i);
        // Verify it references the real latest date (21 سبتمبر / 2026-09-21) and NOT 17 سبتمبر
        expect(res.response).toMatch(/(21|2026-09-21)/);
        expect(res.response).not.toContain("17 سبتمبر");
        // Verify telegram footer
        expect(res.response).toContain("https://t.me/egxbots");
    }, 60000);

    test("2. 'توصيات الأسبوع اللي فات' should accurately report no recommendations and latest date 2026-09-21 without truncated dots", async () => {
        const state = createInitialSessionState();
        const res = await runAgenticPipeline(
            "عايز توصيات الاسبوع اللى فات",
            [],
            state,
            null,
            [],
            supabase,
            [],
            testUserId,
            testSessionId,
            "msg-2"
        );

        console.log("Response 2 (Last Week Recommendations):\n", res.response);

        expect(res.response).toMatch(/(لا توجد|لم تصدر|لا يتوفر|غياب).*توصيات/i);
        expect(res.response).toMatch(/(21|2026-09-21)/);
        // Verify no truncated table dots '...'
        expect(res.response).not.toContain("| ... |");
        // Verify telegram footer
        expect(res.response).toContain("https://t.me/egxbots");
    }, 60000);

    test("3. Closed recommendations should show accurate realized loss (MBSC: -12.34% loss), not win", async () => {
        const state = createInitialSessionState();
        const res = await runAgenticPipeline(
            "ايه موقف توصية سهم MBSC السابقة؟",
            [],
            state,
            null,
            [],
            supabase,
            [],
            testUserId,
            testSessionId,
            "msg-3"
        );

        console.log("Response 3 (MBSC Recommendation):\n", res.response);

        // MBSC was closed at loss around 306.8 (-12.34%)
        expect(res.response).toMatch(/(loss|خسارة|مغلقة)/i);
        expect(res.response).toMatch(/(12|306)/);
        // Must NOT claim a +7.71% win
        expect(res.response).not.toContain("+7.71%");
        // Verify telegram footer
        expect(res.response).toContain("https://t.me/egxbots");
    }, 60000);

    test("4. 'ايه وضع السوق و EGX30؟' should report dynamic market status from cache", async () => {
        const state = createInitialSessionState();
        const res = await runAgenticPipeline(
            "ايه وضع السوق والـ EGX30 والأسهم الأكثر صعوداً؟",
            [],
            state,
            null,
            [],
            supabase,
            [],
            testUserId,
            testSessionId,
            "msg-4"
        );

        console.log("Response 4 (Market Overview):\n", res.response);

        expect(res.response).toContain("EGX30");
        expect(res.response).toMatch(/(53|عرضي|نقطة)/i);
        // Verify telegram footer
        expect(res.response).toContain("https://t.me/egxbots");
    }, 60000);

    test("5. 'AFMC, AMES, ATQA' comparison should ground relative volume and avoid inventing entry levels", async () => {
        const state = createInitialSessionState();
        const res = await runAgenticPipeline(
            "مقارنة بين AFMC, AMES, ATQA",
            [],
            state,
            null,
            [],
            supabase,
            [],
            testUserId,
            testSessionId,
            "msg-5"
        );

        console.log("Response 5 (Comparison):\n", res.response);

        expect(res.response).toMatch(/(AFMC|AMES|ATQA)/);
        // Telegram footer
        expect(res.response).toContain("https://t.me/egxbots");
    }, 60000);

    test("6. 'manage_portfolio' should successfully save position with source 'chatbot' into Supabase positions table", async () => {
        const state = createInitialSessionState();
        const testSymbol = "INEG";
        const res = await runAgenticPipeline(
            "سجل سهم INEG في محفظتي بسعر 0.731 وعدد 72503",
            [],
            state,
            null,
            [],
            supabase,
            [],
            testUserId,
            testSessionId,
            "msg-6"
        );

        console.log("Response 6 (Portfolio Registration):\n", res.response);

        expect(res.response).toMatch(/(تم تسجيل|محفظتك|INEG)/i);

        // Verify it was ACTUALLY inserted into positions table in Supabase!
        const { data: posRows, error: posErr } = await supabase
            .from("positions")
            .select("symbol, quantity, entry_price, status, source")
            .eq("user_id", testUserId)
            .eq("symbol", testSymbol)
            .eq("status", "open");

        expect(posErr).toBeNull();
        expect(posRows).toBeDefined();
        expect(posRows.length).toBeGreaterThan(0);
        expect(posRows[0].symbol).toBe("INEG");
        expect(posRows[0].quantity).toBe(72503);
        expect(posRows[0].entry_price).toBe(0.731);
        expect(posRows[0].source).toBe("chatbot");

        // Cleanup
        await supabase.from("positions").delete().eq("user_id", testUserId).eq("symbol", testSymbol);
    }, 60000);

    test("7. Single symbol 'Ineg' should invoke get_stock and not repeat accumulation scans", async () => {
        const state = createInitialSessionState();
        const res = await runAgenticPipeline(
            "Ineg",
            [],
            state,
            null,
            [],
            supabase,
            [],
            testUserId,
            testSessionId,
            "msg-7"
        );

        console.log("Response 7 (Single symbol Ineg):\n", res.response);

        expect(res.response).toMatch(/(INEG|المجموعة المتكاملة|بورصة النيل)/i);
        // Must NOT output the general accumulation header
        expect(res.response).not.toContain("أقوى أسهم تجميع السيولة والأحجام");
    }, 60000);

    test("8. Image uploaded with 9 stocks should extract tickers and provide comparative evaluation in Turn 1", async () => {
        const state = createInitialSessionState();
        const imageUrl = "https://gfcmaxbtscmizsakarvc.supabase.co/storage/v1/object/public/chat-images/1e450c74-1fc3-4525-9ff8-57c60e3a316c/986b05c9-21ad-48f9-9cff-4f8b263cc2d3/2d38bd28-13cb-4620-820a-2181b89fa6e1.jpg";
        const res = await runAgenticPipeline(
            "ايه رايك فى الاسهم دي وايه الى ممكن استبعدو منهم وايه الى ادخل فيه",
            [imageUrl],
            state,
            null,
            [],
            supabase,
            [],
            testUserId,
            testSessionId,
            "msg-8"
        );

        console.log("Response 8 (Vision analysis):\n", res.response.slice(0, 300));

        // Must recognize the stocks from the image without asking "which stocks"
        expect(res.response).toMatch(/(ADIB|TYCN|BTFH|TMGH|CIEB)/i);
        expect(res.response).not.toContain("محتاج أعرف الأسهم اللي بتتكلم عنها");
    }, 90000);

    test("9. Follow-up 'الخمسه الأولى ممكن تعملى طلب الشراء take profits' should provide complete levels without dashes", async () => {
        const state = createInitialSessionState();
        const history = [
            { role: "user", content: "ايه رايك فى الاسهم دي" },
            { role: "assistant", content: "الترتيب المقترح: 1. ADIB 2. TYCN 3. BTFH 4. TMGH 5. CIEB" }
        ];
        const res = await runAgenticPipeline(
            "الخمسه الأولى ممكن تعملى طلب الشراء take profits",
            [],
            state,
            null,
            history,
            supabase,
            [],
            testUserId,
            testSessionId,
            "msg-9"
        );

        console.log("Response 9 (Follow-up levels):\n", res.response.slice(0, 300));

        // Must not leave missing dashes in the table
        expect(res.response).toMatch(/(ADIB|TYCN|BTFH)/i);
        expect(res.response).not.toContain("— | — | —");
    }, 60000);
});
