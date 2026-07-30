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

    const allowedSymbols = Array.from(new Set([
        ...toolResults.flatMap(result => result.symbols || []),
        ...(visionContext?.symbols || []).map(symbol => symbol.symbol)
    ])).filter(Boolean);
    if (allowedSymbols.length > 0) {
        sections.push("=== ALLOWED SYMBOLS ===\n" + allowedSymbols.join(", "));
    }

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

    const imageDerivedFacts = relevantFacts.filter(f => f.data_type === "image-derived");
    const liveMemoryFacts = relevantFacts.filter(f => f.data_type === "live");
    const historicalFacts = relevantFacts.filter(f => f.data_type === "historical");

    const formatFactValue = (val: unknown): string => {
        if (val === null || val === undefined) return "N/A";
        if (typeof val === "object") {
            try {
                return JSON.stringify(val);
            } catch {
                return String(val);
            }
        }
        return String(val);
    };

    if (imageDerivedFacts.length > 0) {
        sections.push("=== IMAGE-DERIVED MEMORY ===");
        imageDerivedFacts.forEach(f => {
            sections.push(`المصدر: ${f.source} | التاريخ: ${f.as_of} | الرموز: ${f.symbols.join(", ")}`);
            for (const [key, val] of Object.entries(f.facts)) {
                sections.push(`  ${key}: ${formatFactValue(val)}`);
            }
        });
    }

    if (liveMemoryFacts.length > 0) {
        sections.push("=== LIVE DATA MEMORY ===");
        liveMemoryFacts.forEach(f => {
            sections.push(`المصدر: ${f.source} | التاريخ: ${f.as_of} | الرموز: ${f.symbols.join(", ")}`);
            for (const [key, val] of Object.entries(f.facts)) {
                sections.push(`  ${key}: ${formatFactValue(val)}`);
            }
        });
    }

    if (historicalFacts.length > 0) {
        sections.push("=== HISTORICAL DATA ===");
        historicalFacts.forEach(f => {
            sections.push(`المصدر: ${f.source} | التاريخ: ${f.as_of} | الرموز: ${f.symbols.join(", ")}`);
            for (const [key, val] of Object.entries(f.facts)) {
                sections.push(`  ${key}: ${formatFactValue(val)}`);
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
                        sections.push(`  ${key}: ${formatFactValue(val)}`);
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
                        sections.push(`  ${key}: ${formatFactValue(val)}`);
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
    sections.push("- لا تنشئ جدول Markdown من نفسك؛ سيضيف النظام الجدول المنظم المستخرج من البيانات بعد ردك");
    sections.push("- لا تذكر أو تسرد أي رمز أو اسم شركة غير موجود في مصادر البيانات والجداول أعلاه");
    sections.push("- لا تعيد سرد قوائم الأسهم في النص؛ اشرح الاتجاهات فقط واترك القائمة للجدول المنظم");
    sections.push("- RSI يقيس الزخم ولا يقيس كمية البيع أو الشراء؛ لا تقل إن RSI يعني أن السهم يباع بكميات كبيرة");
    sections.push("- MACD موجب يعني زخماً صاعداً نسبياً فقط، ولا يعني تلقائياً وجود بيع أو شراء");
    sections.push("- Vol Ratio = 0.20x يعني أن حجم التداول يساوي 20% من متوسطه، وليس أن السهم يباع بكميات صغيرة");
    sections.push("- في تحليل الأخبار والمعنويات، إذا لم توجد بيانات معنويات للأخبار (News Sentiment) في مصادر البيانات الحالية، اذكر أن بيانات معنويات الأخبار غير متاحة حالياً، ولا تحاول تخمين أو استنتاج معنويات الأخبار من مؤشرات RSI أو MACD.");
    sections.push("- عند سؤال المستخدم عن قرار البيع أو الشراء أو الاحتفاظ بسهم معين، لا تقدم قراراً شخصياً مباشراً بالبيع أو الشراء. اعرض الحقائق الحالية والمؤشرات الفنية ونقاط الدعم والمقاومة، ودع القرار النهائي للمستخدم.");
    sections.push("- إذا كانت هناك توصيات أو إشارات (مثل BUY أو SELL) متوفرة في بيانات الأدوات (المسترجعة من scan_results)، فقم بعرضها للمستخدم بوضوح مع ذكر تفاصيلها (سعر الدخول، الهدف، وقف الخسارة، وتاريخ صدورها)، مع توضيح أنها إشارة فنية تاريخية مسجلة بالنظام وليست توصية استثمارية مباشرة جديدة.");

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

function removeModelTables(text: string): string {
    const lines = text.split("\n");
    const output: string[] = [];
    let inTable = false;

    for (const line of lines) {
        const trimmed = line.trim();
        const tableRow = trimmed.startsWith("|") && trimmed.endsWith("|");
        const separator = tableRow && /^\|[\s:|-]+\|$/.test(trimmed);
        if (tableRow || separator) {
            inTable = true;
            continue;
        }
        if (inTable && !trimmed) {
            inTable = false;
            continue;
        }
        inTable = false;
        output.push(line);
    }

    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
    if (shouldReturnNoData(plan, visionContext, toolResults, relevantFacts)) {
        return "لا توجد بيانات حية أو تاريخية كافية لهذا الطلب حالياً. لم أستخدم معلومات عامة حتى لا أضيف أرقاماً أو أسماء غير مؤكدة.";
    }

    const messages = buildV2FinalMessages(
        userMessage, plan, visionContext, toolResults,
        relevantFacts, recentHistory, resolvedReference
    );

    const model = AI_CONFIG.models.response.default;
    const result = await callNvidiaApi(model, messages, apiKeys);
    return result.response
        ? sanitizeReply(removeModelTables(result.response))
        : "عذراً، لم أتمكن من إنشاء الرد.";
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
    if (shouldReturnNoData(plan, visionContext, toolResults, relevantFacts)) {
        yield "لا توجد بيانات حية أو تاريخية كافية لهذا الطلب حالياً. لم أستخدم معلومات عامة حتى لا أضيف أرقاماً أو أسماء غير مؤكدة.";
        return;
    }

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

function shouldReturnNoData(
    plan: IntentPlan,
    visionContext: VisionContext | null,
    toolResults: ToolResult[],
    relevantFacts: FactSnapshot[]
): boolean {
    if (visionContext || relevantFacts.length > 0) return false;
    if (!plan.needs_live_data && !plan.needs_historical_data) return false;
    return !toolResults.some(result => {
        if (!result.data) return false;
        if (Array.isArray(result.data)) return result.data.length > 0;
        return typeof result.data === "object" && Object.keys(result.data).length > 0;
    });
}

export { sanitizeReply } from "./sanitizer";
