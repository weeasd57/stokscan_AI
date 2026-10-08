import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/route-data";
import { runAgenticPipelineStream } from "../agentic-pipeline";
import { SessionState, SessionSummary } from "../types";

const describeLive = process.env.RUN_LIVE_CHAT_TESTS === "1" ? describe : describe.skip;

interface TurnResult {
    turn: number;
    prompt: string;
    expectedTool: string;
    actualTools: string[];
    responseSnippet: string;
    responseOrigin: string;
    reviewPassed: boolean;
    reviewRepaired: boolean;
    reviewReasons: string[];
    currentSymbol: string | null;
    lastSymbols: string[];
    sessionPersisted: boolean;
    durationMs: number;
    totalTokens: number;
}

describeLive("Full Live Session Audit - All 9 Tools, Memory, Summary & Governance", () => {
    let supabase: any;
    const testUserId = "a8613760-918d-477f-a4dd-c2d0213f1730";
    const sessionId = crypto.randomUUID();
    const history: Array<{ role: string; content: string }> = [];
    let sessionState: SessionState = {
        current_symbol: null,
        last_symbols: [],
        summary: null,
    };
    let sessionSummary: SessionSummary | null = null;
    const auditResults: TurnResult[] = [];

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

        // 1. Initialize real session row in ai_chat_sessions
        await supabase.from("ai_chat_sessions").insert({
            id: sessionId,
            user_id: testUserId,
            title: "جلسة اختبار حية شاملة لكافة أدوات وأركان الشات بوت",
            state: sessionState,
            summary_state: null,
        });

        // 2. Clean up any previous test positions for ETEL
        await supabase.from("positions").delete().eq("user_id", testUserId).eq("symbol", "ETEL");
    });

    afterAll(async () => {
        // Clean up test position for ETEL
        if (supabase) {
            await supabase.from("positions").delete().eq("user_id", testUserId).eq("symbol", "ETEL");
            await supabase.from("ai_chat_sessions").delete().eq("id", sessionId).eq("user_id", testUserId);
        }

        // Write summary report to scratch directory
        const reportPath = path.resolve(process.cwd(), "scratch_live_audit_report.json");
        try {
            fs.writeFileSync(reportPath, JSON.stringify(auditResults, null, 2), "utf8");
            console.log("\nSaved live audit report to:", reportPath);
        } catch {}
    });

    async function executeTurn(turnNumber: number, prompt: string, expectedTool: string): Promise<TurnResult> {
        const messageId = `live-msg-${turnNumber}-${Date.now()}`;
        const startTime = Date.now();
        const toolsUsed: string[] = [];
        let doneData: any = null;

        const stream = runAgenticPipelineStream(
            prompt,
            [],
            sessionState,
            sessionSummary,
            history,
            supabase,
            [],
            testUserId,
            sessionId,
            messageId
        );

        for await (const event of stream) {
            if (event.type === "tools_data" && event.data?.results) {
                for (const r of event.data.results) {
                    if (r.tool && !toolsUsed.includes(r.tool)) toolsUsed.push(r.tool);
                }
            }
            if (event.type === "done") {
                doneData = event.data;
            }
        }

        const durationMs = Date.now() - startTime;
        expect(doneData).not.toBeNull();

        // Update history
        history.push({ role: "user", content: prompt });
        history.push({ role: "assistant", content: doneData.response });

        // Update session state & summary
        if (doneData.session_update) {
            sessionState = {
                current_symbol: doneData.session_update.current_symbol ?? sessionState.current_symbol,
                last_symbols: doneData.session_update.last_symbols ?? sessionState.last_symbols,
                summary: doneData.session_update.summary ?? sessionState.summary,
            };
            sessionSummary = {
                current_symbols: sessionState.last_symbols,
                last_topic: prompt,
                open_references: [],
                last_data_date: sessionSummary?.last_data_date ?? null,
                last_image_symbols: [],
                last_vision_context: null,
                updated_at: new Date().toISOString(),
            };
        }

        const result: TurnResult = {
            turn: turnNumber,
            prompt,
            expectedTool,
            actualTools: toolsUsed,
            responseSnippet: doneData.response.slice(0, 150).replace(/\n/g, " "),
            responseOrigin: doneData.response_origin,
            reviewPassed: doneData.publication_review?.final_passed ?? false,
            reviewRepaired: doneData.publication_review?.repaired ?? false,
            reviewReasons: doneData.publication_review?.reasons ?? [],
            currentSymbol: sessionState.current_symbol,
            lastSymbols: sessionState.last_symbols,
            sessionPersisted: doneData.session_update?.persisted ?? false,
            durationMs,
            totalTokens: doneData.usage?.total_tokens ?? 0,
        };

        auditResults.push(result);
        console.log(`\n[Turn ${turnNumber}] "${prompt}" => Tools: [${toolsUsed.join(", ")}] | Origin: ${result.responseOrigin} | Passed: ${result.reviewPassed} | Latency: ${durationMs}ms`);
        return result;
    }

    test("Turn 1: Market Overview (get_market)", async () => {
        const res = await executeTurn(1, "إيه وضع السوق النهاردة ومؤشر EGX30؟", "get_market");
        expect(res.actualTools).toContain("get_market");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);
    }, 60000);

    test("Turn 2: Technical Scan (get_technical_scan)", async () => {
        const res = await executeTurn(2, "عايز أقوى الأسهم النهارده من حيث الزخم والسيولة", "get_technical_scan");
        expect(res.actualTools).toContain("get_technical_scan");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);
        expect(res.lastSymbols.length).toBeGreaterThan(0);
    }, 60000);

    test("Turn 3: Institutional Accumulation (get_accumulation_stocks)", async () => {
        const res = await executeTurn(3, "هل فيه أي أسهم بتمر بمرحلة تجميع مؤسسي وفق وايكوف؟", "get_accumulation_stocks");
        expect(res.actualTools).toContain("get_accumulation_stocks");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);
    }, 60000);

    test("Turn 4: Comparative Analysis (get_comparison)", async () => {
        const res = await executeTurn(4, "قارن لي بين سهمين COMI و EAST من الناحية الفنية ومؤشرات الذكاء الاصطناعي", "get_comparison");
        expect(res.actualTools).toContain("get_comparison");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);
        expect(res.lastSymbols).toEqual(expect.arrayContaining(["COMI", "EAST"]));
    }, 60000);

    test("Turn 5: Investment Recommendations (get_recommendations)", async () => {
        const res = await executeTurn(5, "هات أحدث التوصيات المفتوحة في المنصة", "get_recommendations");
        expect(res.actualTools).toContain("get_recommendations");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);
    }, 60000);

    test("Turn 6: Financial News (get_news)", async () => {
        const res = await executeTurn(6, "إيه آخر الأخبار المالية والإفصاحات لشركة طاقة عربية TAQA؟", "get_news");
        expect(res.actualTools).toContain("get_news");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);
    }, 60000);

    test("Turn 7: Single Stock Deep Analysis (get_stock)", async () => {
        const res = await executeTurn(7, "حلل لي سهم المصرية للاتصالات ETEL بالتفصيل", "get_stock");
        expect(res.actualTools).toContain("get_stock");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);
        expect(res.currentSymbol).toBe("ETEL");
    }, 60000);

    test("Turn 8: Memory & Contextual Follow-Up Levels (get_stock_levels)", async () => {
        // User does NOT mention ETEL - chatbot must resolve from sessionState.current_symbol
        const res = await executeTurn(8, "إيه نقاط الدخول ووقف الخسارة والمستهدفات للسهم ده؟", "get_stock_levels");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);
        expect(res.currentSymbol).toBe("ETEL");
    }, 60000);

    test("Turn 9: Portfolio Add Position (manage_portfolio - add)", async () => {
        const res = await executeTurn(9, "سجل في محفظتي شراء سهم ETEL عدد 200 بسعر 35.00", "manage_portfolio");
        expect(res.actualTools).toContain("manage_portfolio");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);

        // Verify position actually inserted into Supabase
        const { data: pos } = await supabase.from("positions")
            .select("id, symbol, quantity, entry_price, status, source")
            .eq("user_id", testUserId)
            .eq("symbol", "ETEL")
            .eq("status", "open")
            .limit(1)
            .maybeSingle();

        expect(pos).not.toBeNull();
        expect(pos.symbol).toBe("ETEL");
        expect(pos.quantity).toBe(200);
        expect(Number(pos.entry_price)).toBe(35);
        expect(pos.source).toBe("chatbot");
    }, 60000);

    test("Turn 10: Portfolio Analysis (manage_portfolio - view)", async () => {
        const res = await executeTurn(10, "حلل المحفظه دلوقتي بعد الإضافة وشوف أدائي", "manage_portfolio");
        expect(res.actualTools).toContain("manage_portfolio");
        expect(res.responseOrigin).toBe("llm");
        expect(res.reviewPassed).toBe(true);
        expect(res.reviewReasons).toHaveLength(0);

        // Verify session persistence in Supabase ai_chat_sessions table
        const { data: sessionRow } = await supabase.from("ai_chat_sessions")
            .select("id, state, summary_state")
            .eq("id", sessionId)
            .eq("user_id", testUserId)
            .limit(1)
            .maybeSingle();

        expect(sessionRow).not.toBeNull();
        expect(sessionRow.state).toHaveProperty("last_symbols");
        expect(sessionRow.summary_state).toHaveProperty("last_topic");
    }, 60000);
});
