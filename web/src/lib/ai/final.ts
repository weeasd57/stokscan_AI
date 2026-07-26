import { PlannerResult } from "./types";
import { AI_CONFIG } from "./config";
import { selectOptimalModel } from "./router";

export function buildFinalMessages(
    message: string,
    imageList: string[],
    liveDataString: string,
    plannerResult: PlannerResult,
    aiMessages: any[]
): { role: string; content: string }[] {
    let finalSystemPrompt = `You are EGX Bots AI Assistant for the Egyptian Stock Exchange (EGX).`;

    if (plannerResult.intent === "general_chat") {
        finalSystemPrompt += `

أنت الآن في وضع الدردشة العامة (General Chat).
توجيهات الرد:
1. أجب على رسالة المستخدم بشكل طبيعي وودي باللغة العربية (الفصحى أو اللهجة المصرية حسب سياق العميل).
2. إذا سألك المستخدم عن سياق المحادثة أو تاريخ الشات (مثال: "ذكرنا كم سهم؟" أو "ماذا قلنا سابقاً؟")، قم بقراءة تاريخ الشات المرفق في الرسائل السابقة وأجب بدقة عما تم ذكره.
3. لا ترفض الإجابة بشكل آلي أو روبوتي لمجرد وجود كلمة "سهم" في السؤال. يُسمح لك تماماً بالإجابة على الأسئلة الحوارية والعامة مثل تعريفات الأسهم أو عدد الأسهم المذكورة في الشات.
4. تجنب التكرار أو العبارات الروبوتية مثل "قبل أن تبتعد في السهم". تحدث بلغة عربية سليمة وواضحة وطبيعية.
5. لا تقم باختراع بيانات مالية أو أسعار حية من عندك. إذا سألك عن سعر سهم معين أو تحليل مالي، وضح له بلطف أنه يمكنه كتابة اسم السهم للبحث عنه وجلب بياناته الحية.`;
    } else {
        finalSystemPrompt += `

🚨 ZERO HALLUCINATION POLICY 🚨
Use ONLY provided data. Never invent financial information.

Rules:
1. Use only DATABASE DATA or IMAGE DATA sections below
2. If no clear data available, say so honestly  
3. Never create fake numbers, companies, or financial metrics
4. Always cite your source
5. The user's query asks to analyze an image. Since you are a text model, we have extracted the image text/contents for you and provided them under the === IMAGE DATA === section below.
6. Do NOT apologize, do NOT mention that you are a text-only model or that you cannot see/view the image, and do NOT say "No image attached" (لا توجد صورة مرفقة). Directly perform the financial analysis and read the numbers from the === IMAGE DATA === block as if you are looking at the image yourself.
7. 📊 FORMATTING RULE: Whenever you present lists of stocks, prices, technical indicators, recommendations, signals, or news sentiments, you MUST organize and format them in a clean, beautiful Markdown table (جدول). Do NOT present them as plain text lists or numbered items. Ensure table headers are in Arabic and clearly represent the columns.

${plannerResult.image_summary ? `\n=== IMAGE DATA ===\n${plannerResult.image_summary}\n=== END ===\n` : ""}
${liveDataString ? `\n=== DATABASE DATA ===\n${liveDataString}\n=== END ===\n` : ""}

Respond in Arabic. Be factual and helpful.`;
    }

    // Sanitize aiMessages so text models (like DeepSeek V4 Flash) don't crash on image_url objects
    const sanitizedAiMessages = (aiMessages || []).slice(1).map((msg: any) => {
        if (Array.isArray(msg.content)) {
            const textParts = msg.content
                .filter((part: any) => part && part.type === "text" && part.text)
                .map((part: any) => part.text)
                .join(" ");
            return { role: msg.role, content: textParts || message || "تحليل البيانات والصورة" };
        }
        return msg;
    });

    return [
        { role: "system", content: finalSystemPrompt },
        ...sanitizedAiMessages
    ];
}

export function sanitizeReply(reply: string): string {
    let cleanReply = reply.trim();

    // 1. Clean raw Python array/dict repr if model echoed input payload structure
    if (cleanReply.startsWith("[{'type'") || cleanReply.startsWith('[{"type"')) {
        cleanReply = cleanReply
            .replace(/^\[\s*\{['"]type['"]\s*:\s*['"]text['"]\s*,\s*['"]text['"]\s*:\s*['"]/i, "")
            .replace(/['"]\s*\}\s*\]$/i, "")
            .replace(/\\n/g, "\n");
    }

    // 2. Anti-Repetition Loop Sanitizer (Collapses duplicate header/line loops)
    const lines = cleanReply.split("\n");
    const cleanLines: string[] = [];
    const lineCountMap = new Map<string, number>();

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            cleanLines.push(line);
            continue;
        }
        // Table markup divider lines (e.g. |---|---|) should be preserved
        if (/^\|[\s\-\|]+\|$/.test(trimmed)) {
            cleanLines.push(line);
            continue;
        }
        const key = trimmed.replace(/[\*\_\:\-\s]/g, "");
        const count = lineCountMap.get(key) || 0;
        if (count < 2) {
            lineCountMap.set(key, count + 1);
            cleanLines.push(line);
        }
    }
    cleanReply = cleanLines.join("\n").trim();

    // 3. Clean up disclaimer duplicates
    const escapedDisclaimer = AI_CONFIG.disclaimer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const disclaimerRegex = new RegExp(`\\s*${escapedDisclaimer}`, "g");
    cleanReply = cleanReply.replace(disclaimerRegex, "").replace(/\s*✅\s*تحليل EGX Bots مبني على بيانات حية[^\n]*/g, "").trim();
    cleanReply += `\n\n${AI_CONFIG.disclaimer}`;

    return cleanReply;
}

export async function generateFinalResponse(
    message: string,
    imageList: string[],
    liveDataString: string,
    plannerResult: PlannerResult,
    aiMessages: any[],
    apiKeys: string[],
    requestedModel: string
): Promise<string> {
    const defaultTextModel = AI_CONFIG.models.response.default;
    const symbolCount = plannerResult.entities?.symbols?.length || 0;
    const userSelectedModel = selectOptimalModel(
        plannerResult.intent,
        symbolCount,
        requestedModel
    );

    const modelsToTry = Array.from(new Set([
        userSelectedModel,
        ...AI_CONFIG.models.response.fallbacks,
        defaultTextModel
    ]));

    const hasImages = imageList && imageList.length > 0;
    if (hasImages) {
        console.log("🖼️ Image analysis detected - proceeding with LLM");
    }

    const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages);

    for (const key of apiKeys) {
        for (const modelName of modelsToTry) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.limits.responseTimeoutMs);

                const res = await fetch(AI_CONFIG.api.nvidiaBaseUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${key}`
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        model: modelName,
                        messages: messagesToSend,
                        temperature: 0.2,
                        max_tokens: 1024
                    })
                });

                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    const reply = data.choices?.[0]?.message?.content?.trim();
                    if (reply) {
                        return sanitizeReply(reply);
                    }
                } else {
                    const errText = await res.text();
                    console.warn(`Model ${modelName} with Key failed (${res.status}):`, errText.substring(0, 150));
                }
            } catch (err: any) {
                console.warn(`Fetch error with model ${modelName}:`, err.message || err);
            }
        }
    }

    return `أهلاً بك! يمكنك إرسال الصورة بوضوح أو كتابة اسم السهم المطلوب وسأقوم بتحليله لك فوراً.\n\n${AI_CONFIG.disclaimer}`;
}

export async function* generateFinalStream(
    message: string,
    imageList: string[],
    liveDataString: string,
    plannerResult: PlannerResult,
    aiMessages: any[],
    apiKeys: string[],
    requestedModel: string
): AsyncGenerator<string, void, unknown> {
    const defaultTextModel = AI_CONFIG.models.response.default;
    const symbolCount = plannerResult.entities?.symbols?.length || 0;
    const userSelectedModel = selectOptimalModel(
        plannerResult.intent,
        symbolCount,
        requestedModel
    );

    const modelsToTry = Array.from(new Set([
        userSelectedModel,
        ...AI_CONFIG.models.response.fallbacks,
        defaultTextModel
    ]));

    const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages);

    for (const key of apiKeys) {
        for (const modelName of modelsToTry) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.limits.responseTimeoutMs);

                const res = await fetch(AI_CONFIG.api.nvidiaBaseUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${key}`
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
                        model: modelName,
                        messages: messagesToSend,
                        temperature: 0.2,
                        max_tokens: 1024,
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
                                if (dataStr === "[DONE]") {
                                    yield `\n\n${AI_CONFIG.disclaimer}`;
                                    return;
                                }
                                try {
                                    const parsed = JSON.parse(dataStr);
                                    const delta = parsed.choices?.[0]?.delta?.content;
                                    if (delta) {
                                        yield delta;
                                    }
                                } catch {
                                    // Ignore JSON parse errors on partial lines
                                }
                            }
                        }
                    }

                    if (buffer.trim()) {
                        const trimmed = buffer.trim();
                        if (trimmed.startsWith("data: ") && trimmed.slice(6) !== "[DONE]") {
                            try {
                                const parsed = JSON.parse(trimmed.slice(6));
                                const delta = parsed.choices?.[0]?.delta?.content;
                                if (delta) {
                                    yield delta;
                                }
                            } catch {}
                        }
                    }

                    yield `\n\n${AI_CONFIG.disclaimer}`;
                    return;
                } else {
                    const errText = await res.text();
                    console.warn(`Stream model ${modelName} failed (${res.status}):`, errText.substring(0, 150));
                }
            } catch (err: any) {
                console.warn(`Stream fetch error with model ${modelName}:`, err.message || err);
            }
        }
    }

    yield `أهلاً بك! يمكنك إرسال الصورة بوضوح أو كتابة اسم السهم المطلوب وسأقوم بتحليله لك فوراً.\n\n${AI_CONFIG.disclaimer}`;
}
