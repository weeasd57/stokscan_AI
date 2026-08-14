import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSupabaseClient } from "@/lib/supabase/route-data";
import { runPipeline } from "@/lib/ai/pipeline";
import { AI_TEST_SUITE } from "@/lib/ai/evaluation-suite";
import { getDeepSeekApiKey, getNvidiaApiKeys } from "@/lib/ai/server-secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        const auth = await requireAdmin(req);
        if (auth instanceof Response) return auth;
        const adminUser = auth;

        const supabase = getSupabaseClient();
        const deepseekKey = await getDeepSeekApiKey();
        const nvidiaKeys = await getNvidiaApiKeys();

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                const sendEvent = (data: any) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                };

                sendEvent({ status: "started", total: AI_TEST_SUITE.length });

                for (let i = 0; i < AI_TEST_SUITE.length; i++) {
                    const testCase = AI_TEST_SUITE[i];
                    sendEvent({ status: "running", testId: testCase.id, name: testCase.name });

                    const startTime = Date.now();
                    
                    try {
                        const pipelineResult = await runPipeline(
                            testCase.prompt,
                            [],
                            { 
                                current_symbol: null, 
                                last_symbols: [], 
                                summary: null
                            },
                            null,
                            [],
                            supabase,
                            ([deepseekKey, ...nvidiaKeys].filter(Boolean) as string[]),
                            adminUser.user.id,
                            "eval_session_123",
                            "eval_msg_123",
                            "deepseek-chat",
                            { mockToolsResults: testCase.mockToolsResults }
                        );

                        const evalResult = testCase.evaluator(pipelineResult.response);
                        const duration = Date.now() - startTime;

                        sendEvent({
                            status: "completed",
                            testId: testCase.id,
                            name: testCase.name,
                            passed: evalResult.passed,
                            expected: evalResult.expected,
                            actual: evalResult.actual,
                            evidence: evalResult.evidence,
                            duration,
                            aiResponse: pipelineResult.response
                        });

                    } catch (error: any) {
                        sendEvent({
                            status: "completed",
                            testId: testCase.id,
                            name: testCase.name,
                            passed: false,
                            expected: "Successful execution",
                            actual: `Error: ${error.message}`,
                            evidence: "System Crash",
                            duration: Date.now() - startTime,
                            aiResponse: ""
                        });
                    }
                }

                sendEvent({ status: "finished" });
                controller.close();
            }
        });

        return new NextResponse(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive"
            }
        });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
