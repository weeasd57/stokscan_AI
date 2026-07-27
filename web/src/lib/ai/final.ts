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

🚨 ZERO HALLUCINATION POLICY & EXPERT EGX ANALYSIS RULES 🚨
Use ONLY provided data. Never invent financial information.

Rules & Output Formatting:
1. 📊 STRUCTURED RESPONSE FOR STOCK ANALYSIS:
   When analyzing any stock (e.g. "حلل سهم ABUK" or "إيه رأيك في سيدي كرير"):
   a. **جدول بيانات السهم اللحظية**: Always start with a clean Markdown table:
      | السهم | السعر اللحظي | التغير اليومي | نسبة السيولة (الحجم/المتوسط) | RSI (14) | إشارة MACD | إشارة السيولة |
   b. **تحليل السيولة الفنية والاتجاه**: Explain volume ratio clearly (e.g., "نسبة السيولة 2.5x تعني ضغط شراء مؤسسي قوي أعلى من المتوسط بـ 150%"). Explain RSI status (>70 overbought, <30 oversold, 40-55 accumulation zone). Mention VWAP and ADX trend strength if present.
   c. **الأهداف السعرية ونقاط الدخول**: Present entry price, target price, and stop-loss if present in DATABASE DATA.
   d. **الخلاصة والتوصية الفنية المباشرة**.

2. ⚔️ MULTI-STOCK COMPARISON MATRIX:
   When asked to compare 2 or more stocks (e.g. "قارن بين ABUK و SKPC و TYCN"):
   a. Present a single unified **جدول مقارنة شامل (Comparison Matrix Table)**.
   b. Rank the stocks by relative strength, volume ratio, and technical momentum.
   c. Conclude with a clear recommendation on which stock has the stronger setup.

3. 💼 PORTFOLIO SCREENSHOT ANALYSIS:
   When an image is provided:
   a. Extract all holding symbols, prices, and positions into a **جدول محتويات المحفظة (Portfolio Holdings Table)**.
   b. Evaluate sector diversification and risk level.
   c. Provide actionable suggestions on position sizing or weak holdings.

4. 🔒 CONSISTENCY & ACCUMULATION/DISTRIBUTION:
   - "تجميع 📈" = volume ratio >= 1.2x with positive change = institutional buying
   - "تصريف 📉" = volume ratio >= 1.2x with negative change = institutional selling
   - "صعود ضعيف ⚠️" / "هبوط ضعيف ⚠️" / "محايد ⚪"
   - Do NOT flip answers or guess. Use only DATABASE DATA and IMAGE DATA.

${plannerResult.image_summary ? `\n=== IMAGE DATA ===\n${plannerResult.image_summary}\n=== END ===\n` : ""}
${liveDataString ? `\n=== DATABASE DATA ===\n${liveDataString}\n=== END ===\n` : ""}

Respond in professional Arabic (Egyptian Stock Exchange terminology). Be factual, concise, and structured.`;
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
                        max_tokens: 4096
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
                const timeoutMs = modelName === userSelectedModel 
                    ? AI_CONFIG.limits.responseTimeoutMs 
                    : (AI_CONFIG.limits.responseTimeoutFallbackMs || 12000);
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
