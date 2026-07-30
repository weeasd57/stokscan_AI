import { IntentPlan, VisionContext, ToolResult, FactSnapshot } from "./types";
import { AI_CONFIG } from "./config";
import { sanitizeReply } from "./sanitizer";

const MAX_CONTEXT_CHARS = 30000;

export function buildV2FinalMessages(
    userMessage: string,
    plan: IntentPlan,
    visionContext: VisionContext | null,
    toolResults: ToolResult[],
    relevantFacts: FactSnapshot[],
    recentHistory: Array<{ role: string; content: string }>,
    resolvedReference: { symbol: string | null; message_id: string | null; confidence: number }
): { role: string; content: any }[] {
    const sections: string[] = [];

    sections.push("=== USER REQUEST ===\n" + (userMessage || "(بدون رسالة)"));

    sections.push("=== INTENT PLAN ===");
    sections.push(JSON.stringify({
        intent: plan.intent,
        confidence: plan.confidence,
        entities: plan.entities,
        needs_live_data: plan.needs_live_data,
        needs_historical_data: plan.needs_historical_data
    }, null, 2));

    if (visionContext) {
        sections.push("=== IMAGE ANALYSIS ===");
        sections.push(JSON.stringify({
            image_type: visionContext.image_type,
            symbols: visionContext.symbols.map(s => `${s.symbol}: ${JSON.stringify(s.visible_values)}`),
            technical_observations: visionContext.technical_observations,
            market_depth: visionContext.market_depth,
            summary: visionContext.user_relevant_summary,
            confidence: visionContext.confidence
        }, null, 2));
    }

    if (recentHistory.length > 0) {
        sections.push("=== RECENT MESSAGES ===");
        recentHistory.forEach(m => {
            sections.push(`${m.role}: ${String(m.content).substring(0, 500)}`);
        });
    }

    if (resolvedReference.symbol) {
        sections.push("=== RESOLVED REFERENCE ===");
        sections.push(`المرجع "${userMessage.match(/ده|دا|دي|هذا/)?.[0] || "السابق"}" يشير إلى: ${resolvedReference.symbol} (ثقة: ${Math.round(resolvedReference.confidence * 100)}%)`);
    }

    if (relevantFacts.length > 0) {
        sections.push("=== HISTORICAL DATA ===");
        relevantFacts.forEach(f => {
            const label = f.data_type === "image-derived" ? "صورة" : f.data_type === "live" ? "بيانات حية" : "تاريخية";
            sections.push(`المصدر: ${f.source} | التاريخ: ${f.as_of} | الرموز: ${f.symbols.join(", ")} | النوع: ${label}`);
            for (const [key, val] of Object.entries(f.facts)) {
                sections.push(`  ${key}: ${val}`);
            }
        });
    }

    if (toolResults.length > 0) {
        const liveResults = toolResults.filter(r => r.data_type !== "historical");
        const historicalResults = toolResults.filter(r => r.data_type === "historical");

        if (liveResults.length > 0) {
            sections.push("=== LIVE DATA ===");
            liveResults.forEach(r => {
                sections.push(`الأداة: ${r.tool} | المصدر: ${r.source} | الوقت: ${r.data_time} | نوع: ${r.data_type}`);
                if (typeof r.data === "object" && r.data !== null) {
                    for (const [key, val] of Object.entries(r.data)) {
                        sections.push(`  ${key}: ${val}`);
                    }
                }
            });
        }

        if (historicalResults.length > 0) {
            sections.push("=== HISTORICAL DATA ===");
            historicalResults.forEach(r => {
                sections.push(`الأداة: ${r.tool} | المصدر: ${r.source} | الوقت: ${r.data_time} | نوع: ${r.data_type}`);
                if (typeof r.data === "object" && r.data !== null) {
                    for (const [key, val] of Object.entries(r.data)) {
                        sections.push(`  ${key}: ${val}`);
                    }
                }
            });
        }
    }

    sections.push("=== RESPONSE RULES ===");
    sections.push("- استخدم طلب المستخدم الحالي كأولوية أولى");
    sections.push("- استخدم نية الـ planner كأولوية ثانية");
    sections.push("- استخدم بيانات الصورة فقط إذا كانت موجودة في === IMAGE ANALYSIS ===");
    sections.push("- استخدم نتائج الأدوات الحالية من === LIVE DATA ===");
    sections.push("- استخدم البيانات التاريخية من === HISTORICAL DATA ===");
    sections.push("- لا تخترع أرقاماً غير موجودة في الأقسام أعلاه");
    sections.push("- لا تعطِ توصيات شراء أو بيع صريحة");
    sections.push("- اذكر مصدر كل رقم (صورة، بيانات حية، بيانات تاريخية)");
    sections.push("- اكتب بالعربية الفصحى المفهومة");
    sections.push("- تحليل السيولة المصاحب: اشرح RSI و MACD ونسبة السيولة من البيانات إن وجدت");

    let contextText = sections.join("\n\n");
    if (contextText.length > MAX_CONTEXT_CHARS) {
        contextText = contextText.substring(0, MAX_CONTEXT_CHARS) + "\n\n[تم اقتطاع السياق - تجاوز الحد الأقصى]";
    }

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `أنت محلل البورصة المصرية (EGX Bots). اليوم: ${today}.

استخدم الأقسام التالية للإجابة بدقة. كل قسم يمثل مصدر معلومات منفصل.
لا تخلط بين المصادر. لا تخترع بيانات غير موجودة في الأقسام.
قدم تحليلاً فنياً موضوعياً بناءً على البيانات المتاحة فقط.
لا تعطِ توصيات شراء أو بيع صريحة.
اذكر مصدر كل معلومة (صورة، بيانات حية، بيانات تاريخية) عند الإشارة إلى أرقام.`;

    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: contextText }
    ];
}

async function callNvidiaApi(
    modelName: string,
    messages: { role: string; content: any }[],
    apiKeys: string[],
    stream: boolean = false
): Promise<{ response: string | null; streamGen?: AsyncGenerator<string> }> {
    let keyIndex = 0;
    while (keyIndex < apiKeys.length) {
        const key = apiKeys[keyIndex];
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);

            const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${key}`
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: modelName,
                    messages,
                    temperature: 0.15,
                    max_tokens: 4096,
                    stream
                })
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                const reply = data.choices?.[0]?.message?.content?.trim();
                if (reply) return { response: reply };
                break;
            } else {
                if (res.status === 401 || res.status === 403 || res.status === 429) {
                    keyIndex++;
                    continue;
                }
                break;
            }
        } catch (err: any) {
            if (err.name === "AbortError") break;
            keyIndex++;
        }
    }
    return { response: null };
}

export async function generateV2Response(
    userMessage: string,
    plan: IntentPlan,
    visionContext: VisionContext | null,
    toolResults: ToolResult[],
    relevantFacts: FactSnapshot[],
    recentHistory: Array<{ role: string; content: string }>,
    resolvedReference: { symbol: string | null; message_id: string | null; confidence: number },
    apiKeys: string[]
): Promise<string> {
    const messages = buildV2FinalMessages(
        userMessage, plan, visionContext, toolResults,
        relevantFacts, recentHistory, resolvedReference
    );

    const model = AI_CONFIG.models.response.default;
    const result = await callNvidiaApi(model, messages, apiKeys);
    return result.response ? sanitizeReply(result.response) : "عذراً، لم أتمكن من إنشاء الرد.";
}

export async function* generateV2Stream(
    userMessage: string,
    plan: IntentPlan,
    visionContext: VisionContext | null,
    toolResults: ToolResult[],
    relevantFacts: FactSnapshot[],
    recentHistory: Array<{ role: string; content: string }>,
    resolvedReference: { symbol: string | null; message_id: string | null; confidence: number },
    apiKeys: string[]
): AsyncGenerator<string, void, unknown> {
    const messages = buildV2FinalMessages(
        userMessage, plan, visionContext, toolResults,
        relevantFacts, recentHistory, resolvedReference
    );

    const textModels = [
        AI_CONFIG.models.response.default,
        ...AI_CONFIG.models.response.fallbacks
    ];

    for (const model of textModels) {
        let keyIndex = 0;
        while (keyIndex < apiKeys.length) {
            const key = apiKeys[keyIndex];
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 25000);

                const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${key}`
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        model,
                        messages,
                        temperature: 0.15,
                        max_tokens: 4096,
                        stream: true
                    })
                });
                clearTimeout(timeoutId);

                if (res.ok && res.body) {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop() || "";

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed.startsWith("data: ")) {
                                const dataStr = trimmed.slice(6);
                                if (dataStr === "[DONE]") continue;
                                try {
                                    const parsed = JSON.parse(dataStr);
                                    const token = parsed.choices?.[0]?.delta?.content || "";
                                    if (token) yield token;
                                } catch {}
                            }
                        }
                    }
                    return;
                } else {
                    if (res.status === 401 || res.status === 403 || res.status === 429) {
                        keyIndex++;
                        continue;
                    }
                    break;
                }
            } catch {
                keyIndex++;
            }
        }
    }

    yield "عذراً، لم أتمكن من إنشاء الرد.";
}

export { sanitizeReply } from "./sanitizer";