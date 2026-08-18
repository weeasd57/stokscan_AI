import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { runPipeline, runPipelineStream } from "@/lib/ai/pipeline";
import { getDeepSeekApiKey, getNvidiaApiKeys } from "@/lib/ai/server-secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Lightweight test harness: runs the real pipeline (stream or non-stream) against
// the live database without auth/quota/idempotency so fix verification is
// reproducible via a local client.
export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const message = typeof body.message === "string" ? body.message.trim() : "";
        const useStream = body.stream === true;
        const sessionSummary = typeof body.session_summary === "string" ? body.session_summary : null;
        const sessionSymbol = typeof body.session_symbol === "string" && body.session_symbol.trim() ? body.session_symbol.trim() : null;
        const sessionLastSymbols = Array.isArray(body.session_last_symbols) ? body.session_last_symbols.filter((s: any) => typeof s === "string").slice(0, 15) : [];
        if (!message && !Array.isArray(body.messages)) {
            return NextResponse.json({ detail: "message required" }, { status: 400 });
        }

        const supabase = getSupabaseClient();
        const deepSeekKey = getDeepSeekApiKey();
        const apiKeys = [...getNvidiaApiKeys(), ...(deepSeekKey ? [deepSeekKey] : [])];

        // Conversation mode: run messages sequentially, threading session state and
        // history between turns the same way a real chat session does.
        if (Array.isArray(body.messages)) {
            const turns: any[] = [];
            let convState: any = { current_symbol: null, last_symbols: [], summary: null, current_sector: null };
            const convHistory: Array<{ role: string; content: string }> = [];
            for (const message of body.messages) {
                if (typeof message !== "string" || !message.trim()) continue;
                const t0 = Date.now();
                const result = await runPipeline(
                    message.trim(), [], convState, null, convHistory.slice(-8),
                    supabase, apiKeys, "test-user", "", `test-${Date.now()}`
                );
                convHistory.push({ role: "user", content: message.trim() });
                convHistory.push({ role: "assistant", content: (result.response || "").slice(0, 400) });
                turns.push({
                    q: message.trim(),
                    latency_ms: Date.now() - t0,
                    tools: (result.tools?.results || []).map((r: any) => ({
                        tool: r.tool,
                        stock_count: Array.isArray(r.data?.stocks)
                            ? r.data.stocks.length
                            : Array.isArray(r.data?.market_period_ranking)
                                ? r.data.market_period_ranking.length
                                : undefined,
                        symbols: (r.symbols || []).slice(0, 8)
                    })),
                    session_after: {
                        current_symbol: result.session_update?.current_symbol ?? convState.current_symbol,
                        last_symbols: (result.session_update?.last_symbols || []).slice(0, 6),
                        summary: (result.session_update?.summary || "").slice(0, 60)
                    },
                    response: (result.response || "").slice(0, 350)
                });
                if (result.session_update) convState = { ...convState, ...result.session_update };
            }
            return NextResponse.json({ mode: "conversation", turns });
        }

        const sessionState = { current_symbol: sessionSymbol, last_symbols: sessionLastSymbols, summary: sessionSummary, current_sector: null };
        const t0 = Date.now();

        if (useStream) {
            let response = "";
            let streamError: string | null = null;
            for await (const chunk of runPipelineStream(
                message, [], sessionState, null, [],
                supabase, apiKeys, "test-user", "", `test-${Date.now()}`
            )) {
                if (chunk.type === "token" && typeof chunk.data === "string") response += chunk.data;
                if (chunk.type === "error") streamError = String(chunk.data?.detail || chunk.data || "stream error");
            }
            return NextResponse.json({
                message,
                mode: "stream",
                latency_ms: Date.now() - t0,
                response,
                stream_error: streamError
            });
        }

        const result = await runPipeline(
            message,
            [],
            sessionState,
            null,
            [],
            supabase,
            apiKeys,
            "test-user",
            "",
            `test-${Date.now()}`
        );

        return NextResponse.json({
            message,
            latency_ms: Date.now() - t0,
            plan: {
                intent: result.plan.intent,
                tools: result.plan.tools,
                entities: result.plan.entities
            },
            tool_summary: (result.tools?.results || []).map((r: any) => ({
                tool: r.tool,
                source: r.source,
                stock_count: Array.isArray(r.data?.stocks)
                    ? r.data.stocks.length
                    : Array.isArray(r.data?.market_period_ranking)
                        ? r.data.market_period_ranking.length
                        : undefined,
                symbols: (r.symbols || []).slice(0, 20),
                symbol_count: Array.isArray(r.symbols) ? r.symbols.length : undefined,
                error: r.error || undefined
            })),
            response: result.response
        });
    } catch (err: any) {
        return NextResponse.json({ detail: err?.message || "error", stack: err?.stack }, { status: 500 });
    }
}
