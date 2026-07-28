import { PlannerResult } from "./types";
import { AI_CONFIG } from "./config";
import { selectOptimalModel } from "./router";
import { sanitizeReply } from "./sanitizer";

export function buildFinalMessages(
    message: string,
    imageList: string[],
    liveDataString: string,
    plannerResult: PlannerResult,
    aiMessages: any[],
    isVisionModel: boolean = true
): { role: string; content: any }[] {
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

⚠️⚠️⚠️ MANDATORY TABLE FORMAT ⚠️⚠️⚠️
You MUST ALWAYS present stock data in a proper Markdown table. NEVER list indicators as separate bullet points.

CORRECT FORMAT (you MUST follow this):
| السهم | السعر | التغير | RSI | MACD | حجم التداول | نسبة السيولة | الإشارة |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| BIOC جلاكسو | 166.50 ج.م | +16.60% | 75.23 | +0.82 | 526,125 | x18.86 | تجميع 📈 |
| SIPC سيناء | 4.01 ج.م | -2.20% | 45.12 | -0.03 | 3,583 | x3.48 | تصريف 📉 |

WRONG FORMAT (NEVER do this):
• VWAP: 29.22 ج.م
• ADX: 37.80
• RSI: 75.23
• MACD: 0.87

1. 📊 CRITICAL: YOUR VERY FIRST LINE MUST BE THE MARKDOWN TABLE HEADER:
   | السهم | السعر اللحظي | التغير اليومي | نسبة السيولة | RSI (14) | إشارة MACD | إشارة السيولة |
   | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
   DO NOT write any text, titles, or intro before the table. START DIRECTLY WITH THE TABLE ("|"). Put ALL analyzed stocks in rows of this single table. NEVER break stock indicators into separate bullet points.

2. After the table, do NOT write bullet points for every stock. Instead, add a brief **تحليل السيولة الفنية** section of 3-4 lines in total, highlighting only the top 3 stocks with the strongest setup (highest volume ratio with positive change) and the top 3 with the weakest setup (highest volume ratio with negative change). This keeps the response extremely concise and fast.

3. 🔒 ACCUMULATION/DISTRIBUTION signals:
   - "تجميع 📈" = volume ratio >= 1.2x with positive change
   - "تصريف 📉" = volume ratio >= 1.2x with negative change
   - "محايد ⚪" = otherwise

4. 🚫 NEVER invent prices, RSI, MACD, or volume numbers. Use ONLY === DATABASE DATA === values.

5. ⛔ MISSING SYMBOLS: If DATABASE DATA has a "⛔" block for missing symbols, say data is unavailable. Do NOT guess.

6. ⚠️ Always use "سهم" (stock). NEVER use "سيارة" or other mangled terms.

7. FOR IMAGES: Analyze ONLY stocks visible in the image. Do NOT pull in stocks from chat history.

8. 🛑 ANTI-LOOP RULE: Analyze each stock EXACTLY ONCE. NEVER repeat introductory phrases like "من وجهة نظرك..." or duplicate paragraph blocks. Stop immediately after completing the technical analysis section.

${plannerResult.image_summary ? `\n=== IMAGE DATA ===\n${plannerResult.image_summary}\n=== END ===\n` : ""}
${liveDataString ? `\n=== DATABASE DATA ===\n${liveDataString}\n=== END ===\n` : ""}

Respond in professional Arabic. Be factual, concise, and structured. START WITH THE TABLE.`;
    }

    // Build history messages — when an image is present, strip history to prevent old text questions from confusing image analysis
    const hasImages = Array.isArray(imageList) && imageList.length > 0;
    const sanitizedAiMessages = hasImages ? [] : (aiMessages || []).slice(1).map((msg: any) => {
        if (Array.isArray(msg.content)) {
            const textParts = msg.content
                .filter((part: any) => part && part.type === "text" && part.text)
                .map((part: any) => part.text)
                .join(" ");
            return { role: msg.role, content: textParts || message || "تحليل البيانات والصورة" };
        }
        return msg;
    });

    // Build the final user message
    let finalUserMessage: any;
    if (hasImages && isVisionModel) {
        const userTextContent = message
            ? `${message}\n\nيرجى تحليل الصورة المرفقة بالكامل وتقديم تحليل شامل لجميع الأسهم الموجودة بها.`
            : "يرجى تحليل هذه الصورة وتقديم تحليل شامل لجميع الأسهم الموجودة بها.";
        finalUserMessage = {
            role: "user",
            content: [
                { type: "text", text: userTextContent },
                ...imageList.map(imgUrl => ({ type: "image_url", image_url: { url: imgUrl } }))
            ]
        };
    } else {
        const userTextContent = message || (hasImages ? "تحليل الصورة والبيانات" : "تحليل البيانات");
        finalUserMessage = {
            role: "user",
            content: userTextContent
        };
    }

    return [
        { role: "system", content: finalSystemPrompt },
        ...sanitizedAiMessages,
        finalUserMessage
    ];
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

    const hasImages = imageList && imageList.length > 0;

    // When images are present, use vision models FIRST, then fall back to text models
    const visionModels: string[] = (AI_CONFIG.models.response as any).vision || ["meta/llama-3.2-90b-vision-instruct", "meta/llama-3.2-11b-vision-instruct"];
    const textModels = Array.from(new Set([
        userSelectedModel,
        ...AI_CONFIG.models.response.fallbacks,
        defaultTextModel
    ]));

    const modelsToTry = hasImages
        ? [...visionModels, ...textModels]  // vision first when image present
        : textModels;

    if (hasImages) {
        console.log("🖼️ Image analysis detected - using vision models:", visionModels.join(", "));
    }

    for (const key of apiKeys) {
        for (const modelName of modelsToTry) {
            try {
                const isVisionModel = visionModels.includes(modelName);
                const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages, isVisionModel);
                const controller = new AbortController();
                const timeoutMs = isVisionModel ? 55000 : (modelName === userSelectedModel ? AI_CONFIG.limits.responseTimeoutMs : 12000);
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
                        presence_penalty: 0.1,
                        frequency_penalty: 0.1,
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

    const hasImages = imageList && imageList.length > 0;
    const visionModels: string[] = (AI_CONFIG.models.response as any).vision || ["meta/llama-3.2-90b-vision-instruct", "meta/llama-3.2-11b-vision-instruct"];
    const textModels = Array.from(new Set([
        userSelectedModel,
        ...AI_CONFIG.models.response.fallbacks,
        defaultTextModel
    ]));

    const modelsToTry = hasImages
        ? [...visionModels, ...textModels]  // vision first when image present
        : textModels;

    if (hasImages) {
        console.log("🖼️ Stream: Image analysis detected - using vision models:", visionModels.join(", "));
    }

    for (const key of apiKeys) {
        for (const modelName of modelsToTry) {
            try {
                const controller = new AbortController();
                const isVisionModel = visionModels.includes(modelName);
                const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages, isVisionModel);
                const timeoutMs = isVisionModel
                    ? 55000  // vision models need more time for image analysis
                    : (modelName === userSelectedModel
                        ? AI_CONFIG.limits.responseTimeoutMs
                        : (AI_CONFIG.limits.responseTimeoutFallbackMs || 12000));
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
                        presence_penalty: 0.1,
                        frequency_penalty: 0.1,
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
