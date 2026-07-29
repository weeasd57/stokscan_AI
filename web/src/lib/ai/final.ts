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
    const hasImages = Array.isArray(imageList) && imageList.length > 0;
    let finalSystemPrompt = `You are EGX Bots AI Assistant for the Egyptian Stock Exchange (EGX).`;

    const normMsg = (message || "").toLowerCase();
    const isGeneralOrMarketQuery = 
        plannerResult.intent === "general_chat" || 
        plannerResult.intent === "market_summary" || 
        normMsg.includes("كام سهم") || 
        normMsg.includes("كم سهم") || 
        normMsg.includes("المؤشر والدولار") || 
        normMsg.includes("مؤشر والدولار") || 
        ((!plannerResult.entities?.symbols || plannerResult.entities.symbols.length === 0) && !plannerResult.image_summary && !(imageList && imageList.length > 0));

    const isChartQuery = plannerResult.intent === "chart_analysis" || (plannerResult.entities?.wants_table === false && hasImages);

    if (isChartQuery) {
        finalSystemPrompt += `

📈 أنت الآن خبير التحليل الفني والرسوم البيانية وسوق المال (Expert Technical & Visual Chart Analyst).
توجيهات التحليل الشامل للصورة:
1. 🚫 لا تفرض جداول مالية أو صفوفاً جامدة عند تحليل الشارتات الرسمية أو الصور الفنية.
2. اقرأ الصورة المرفقة كاملةً باستخدام قدرات الرؤية البصرية الكاملة (Multimodal Vision): حلل الأشكال والأنماط الفنية، الاتجاهات، نماذج الموجات، خطوط الدعم والمقاومة، ومستويات فيبوناتشي الظاهرة.
3. اشرح كافة التفاصيل والأرقام والنسب والمؤشرات الفنية المرئية بالصورة بكل دقة ووضوح.
4. حدد النطاق السعري المتوقع، الأهداف التداولية، ومستويات الأمان ووقف الخسارة بناءً على المعطيات الظاهرة بالرسم البياني.
5. قدّم نصاً تحليلياً شاملاً، عميقاً، وبليغاً باللغة العربية يشرح للمستخدم كل ما تظهره الصورة بأسلوب احترافي رائع يضاهي أرقى بيوت الخبرة المالية.`;
    } else if (isGeneralOrMarketQuery) {
        finalSystemPrompt += `

أنت الآن في وضع الإجابة المباشرة العامة أو حالة السوق (Market / General Chat).
توجيهات الرد:
1. أجب على رسالة المستخدم بشكل طبيعي وودي باللغة العربية.
2. لا تقم بإنشاء جدول أسهم أو صفوف وهمية تحتوي على شخطات "-" إذا لم تكن هناك أسهم محددة مخصصة للتحليل الفني.
3. إذا كان الاستفسار عن المؤشر والدولار أو عدد الأسهم أو حالة البورصة، قدم ملخصاً واضحاً ومباشراً بالنص والأسطر المنسقة.
4. لا تقم باختراع بيانات مالية أو أسعار من عندك. استخدم فقط البيانات المتاحة في === DATABASE DATA ===.`;
    } else {
        finalSystemPrompt += `

🚨 ZERO HALLUCINATION POLICY & EXPERT EGX ANALYSIS RULES 🚨
Use ONLY provided data. Never invent financial information.

⚠️⚠️⚠️ MANDATORY TABLE FORMAT ⚠️⚠️⚠️
You MUST ALWAYS present stock data in a proper Markdown table. NEVER list indicators as separate bullet points.

CORRECT FORMAT (you MUST follow this):
| السهم | السعر اللحظي | التغير اليومي | نسبة السيولة | RSI (14) | إشارة MACD | إشارة السيولة |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| [SYMBOL_1] | [PRICE_1] | [CHANGE_1] | [RATIO_1] | [RSI_1] | [MACD_1] | [SIGNAL_1] |
| [SYMBOL_2] | [PRICE_2] | [CHANGE_2] | [RATIO_2] | [RSI_2] | [MACD_2] | [SIGNAL_2] |

WRONG FORMAT (NEVER do this):
• VWAP: [NUM]
• ADX: [NUM]

1. 📊 CRITICAL: YOUR VERY FIRST LINE MUST BE THE MARKDOWN TABLE HEADER:
   | السهم | السعر اللحظي | التغير اليومي | نسبة السيولة | RSI (14) | إشارة MACD | إشارة السيولة |
   | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
   DO NOT write any text, titles, or intro before the table. START DIRECTLY WITH THE TABLE ("|").
   - COPY THE EXACT NUMBERS (Price, Change%, RSI, MACD, Volume Ratio) FROM === DATABASE DATA === INTO THE TABLE.
   - NEVER USE DUMMY HYPHENS "-" WHEN VALUES ARE AVAILABLE IN === DATABASE DATA ===.
   - Put ALL analyzed stocks in rows of this single table.
   - DO NOT split analysis into separate indicator sections like "***تحليل RSI***" or "***تحليل MACD***". Put ALL indicators for each stock in its table row.

2. After the table, add a brief **تحليل السيولة الفنية** section of 2-3 lines summarizing the technical setup of the analyzed stocks.
   - Use ONLY the exact company name from === DATABASE DATA === for each ticker.
   - NEVER mix up company names. Always match the symbol to its exact name provided in === DATABASE DATA ===.
   - NEVER write "لا توجد أسهم أخرى" or list unrequested stocks from previous chat history.
   - If analyzing a single stock, summarize its technical status directly in 2 lines.

3. 🔒 ACCUMULATION/DISTRIBUTION signals:
   - "تجميع 📈" = volume ratio >= 1.2x with positive change
   - "تصريف 📉" = volume ratio >= 1.2x with negative change
   - "محايد ⚪" = otherwise

4. 🚫 NEVER invent prices, RSI, MACD, or volume numbers. Use ONLY === DATABASE DATA === values.

5. ⛔ MISSING SYMBOLS: If DATABASE DATA has a "⛔" block for missing symbols, say data is unavailable. Do NOT guess.

6. ⚠️ Always use "سهم" (stock). NEVER use "سيارة" or other mangled terms.

7. FOR IMAGES: Analyze ONLY stocks visible in the image. Do NOT pull in stocks from chat history.

8. 🛑 NO DUPLICATE SECTIONS: NEVER output "### تحليل السيولة الفنية" more than ONCE. NEVER repeat bullet point sections for stocks. Write the table ONCE, followed by a SINGLE concise 3-line analysis section. Stop immediately after that.

9. 💡 EGYPTIAN DIALECT QUESTIONS: When user asks "أبيع بكام؟" or "احط امر بيع بكام؟" (at what price to sell?), do NOT treat "بكام" as a stock name. Explain technical targets or resistance levels based on provided indicators.

10. ⚠️ INDICES ARE NOT STOCKS: NEVER list EGX30, EGX70, or EGX100 in tables of "أبرز الأسهم التي دخلها سيولة" or call them "أسهم".

11. 🚫 NEVER CLAIM LIMITED DATABASE: NEVER say or claim "ليس لدي قاعدة بيانات لكل الأسهم" or that data is restricted only to image stocks. EGX Bots database contains live technical data for over 293 EGX stocks. Always summarize top market stocks from === DATABASE DATA === when user asks about whole market liquidity ("بيانات السوق كله" or "مش من الصورة").

12. 🛑 NEVER LIST CHAT HISTORY STOCKS AS "THE ONLY AVAILABLE STOCKS": When a requested stock is missing or unlisted, state clearly and factually: "سهم (اسم السهم) غير مدرج حالياً ضمن الـ 293 سهم الأساسية المدرجة بالبورصة المصرية المتاحة بقاعدة البيانات." NEVER claim or list past chat history stocks (like TAQA or EAST) as if they are the "only available stocks in the database".

${(plannerResult.image_summary && (hasImages || plannerResult.intent === "portfolio")) ? `\n=== IMAGE DATA ===\n${plannerResult.image_summary}\n=== END ===\n` : ""}
${liveDataString ? `\n=== DATABASE DATA ===\n${liveDataString}\n=== END ===\n` : ""}

Respond in professional Arabic. Be factual, concise, and structured. START WITH THE TABLE.`;
    }

    // Build history messages — when an image is present, strip history to prevent old text questions from confusing image analysis
    const historySlice = (aiMessages || []).slice(1, -1);
    const sanitizedAiMessages = hasImages ? [] : historySlice.map((msg: any) => {
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

    const officialKey = process.env.DEEPSEEK_OFFICIAL_API_KEY || "sk-7d19a8fd6cb943c3b71eaca8e55cef3b";
    if (officialKey && !hasImages) {
        try {
            const targetDeepSeekModel = (requestedModel && (requestedModel.includes("pro") || requestedModel.includes("reasoner"))) ? "deepseek-reasoner" : "deepseek-v4-flash";
            console.log(`🚀 Attempting DeepSeek Official API (${targetDeepSeekModel})...`);
            const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages, false);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const res = await fetch(AI_CONFIG.api.deepseekOfficialBaseUrl || "https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${officialKey}`
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: targetDeepSeekModel,
                    messages: messagesToSend,
                    temperature: 0.1,
                    max_tokens: 4096
                })
            });

            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                const reply = data.choices?.[0]?.message?.content?.trim();
                if (reply) {
                    console.log(`✅ DeepSeek Official API (${targetDeepSeekModel}) response generated successfully!`);
                    return sanitizeReply(reply);
                }
            }
        } catch (err: any) {
            console.warn("⚠️ DeepSeek Official API non-stream failed, falling back to NVIDIA keys:", err.message || err);
        }
    }

    for (const key of apiKeys) {
        for (const modelName of modelsToTry) {
            try {
                const isVisionModel = visionModels.includes(modelName);
                const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages, isVisionModel);
                const controller = new AbortController();
                const timeoutMs = isVisionModel ? 18000 : 12000;
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

export function checkStreamCircuitBreaker(accumulatedText: string): boolean {
    if (!accumulatedText) return false;

    // 1. Check if 'تحليل السيولة' or '###' headers repeated 2+ times
    const headerMatches = accumulatedText.match(/تحليل السيولة/g);
    if (headerMatches && headerMatches.length >= 2) return true;

    // 2. Check if asterisk loop (* * * * * * *)
    if (/\*\s*\*\s*\*\s*\*\s*\*\s*\*/.test(accumulatedText)) return true;

    // 3. Check if any stock line repeated 3+ times
    const lines = accumulatedText.split("\n").map(l => l.trim()).filter(l => l.length > 8);
    const lineCounts = new Map<string, number>();
    for (const l of lines) {
        // Ignore table separator lines
        if (l.startsWith("|") && (l.includes("---") || l.includes("السهم"))) continue;
        const key = l.replace(/[\*\_\:\-\s]/g, "").toLowerCase();
        const cnt = (lineCounts.get(key) || 0) + 1;
        if (cnt >= 3) return true;
        lineCounts.set(key, cnt);
    }
    return false;
}

export async function* generateFinalStream(
    message: string,
    imageList: string[],
    liveDataString: string,
    plannerResult: PlannerResult,
    aiMessages: any[],
    apiKeys: string[],
    requestedModel?: string
): AsyncGenerator<string, void, unknown> {
    const defaultTextModel = AI_CONFIG.models.response.default;
    const symbolCount = plannerResult.entities?.symbols?.length || 0;
    const userSelectedModel = selectOptimalModel(
        plannerResult.intent,
        symbolCount,
        requestedModel || ""
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

    const officialKey = process.env.DEEPSEEK_OFFICIAL_API_KEY || "sk-7d19a8fd6cb943c3b71eaca8e55cef3b";
    if (officialKey && !hasImages) {
        try {
            const targetDeepSeekModel = (requestedModel && (requestedModel.includes("pro") || requestedModel.includes("reasoner"))) ? "deepseek-reasoner" : "deepseek-v4-flash";
            console.log(`🚀 Attempting DeepSeek Official API stream (${targetDeepSeekModel})...`);
            const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages, false);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const res = await fetch(AI_CONFIG.api.deepseekOfficialBaseUrl || "https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${officialKey}`
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: targetDeepSeekModel,
                    messages: messagesToSend,
                    temperature: 0.1,
                    frequency_penalty: 0.5,
                    presence_penalty: 0.3,
                    max_tokens: 4096,
                    stream: true
                })
            });

            clearTimeout(timeoutId);

            if (res.ok && res.body) {
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let accumulatedStreamText = "";
                let hasYieldedAny = false;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.startsWith("data: ")) {
                            const dataStr = trimmed.slice(6).trim();
                            if (dataStr === "[DONE]") continue;
                            try {
                                const parsed = JSON.parse(dataStr);
                                const token = parsed.choices?.[0]?.delta?.content || "";
                                if (token) {
                                    accumulatedStreamText += token;
                                    if (checkStreamCircuitBreaker(accumulatedStreamText)) {
                                        console.warn("🛑 Anti-repetition circuit breaker triggered! Truncating infinite stream loop.");
                                        reader.cancel();
                                        return;
                                    }
                                    hasYieldedAny = true;
                                    yield token;
                                }
                            } catch {}
                        }
                    }
                }
                if (hasYieldedAny) return;
            }
        } catch (err: any) {
            console.warn("⚠️ DeepSeek Official API stream failed, falling back to NVIDIA keys:", err.message || err);
        }
    }

    for (const key of apiKeys) {
        for (const modelName of modelsToTry) {
            try {
                const controller = new AbortController();
                const isVisionModel = visionModels.includes(modelName);
                const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages, isVisionModel);
                const timeoutMs = isVisionModel ? 18000 : 12000;
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
                        temperature: 0.15,
                        presence_penalty: 0.3,
                        frequency_penalty: 0.5,
                        max_tokens: 4096,
                        stream: true
                    })
                });

                clearTimeout(timeoutId);

                if (res.ok && res.body) {
                    const reader = res.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";
                    let accumulatedStreamText = "";

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
