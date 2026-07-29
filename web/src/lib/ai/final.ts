import { PlannerResult } from "./types";
import { AI_CONFIG } from "./config";
import { selectOptimalModel } from "./router";
import { sanitizeReply } from "./sanitizer";
import { parseToolsOutput, buildStockTable, buildMarketTable, buildRecommendationTable, isSuspiciousValue, ParsedStockData } from "./table-builder";

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

🚨 GLOBAL ZERO DISCLAIMER POLICY FOR ALL MARKET & DATABASE QUERIES 🚨

1. 🚫 STRICTLY FORBIDDEN TO SAY "لا أملك بيانات" OR "لا تتوفر لدي بيانات محدثة" FOR ANY MARKET QUERY!
   YOU HAVE FULL LIVE DATABASE DATA IN === DATABASE DATA === INCLUDING:
   - المؤشر الرئيسي EGX30 ومؤشر EGX100
   - سعر صرف الدولار مقابل الجنيه (USD/EGP)
   - اتجاه السوق العام (Market Regime) وأعلى الأسهم ارتفاعاً وانخفاضاً (Top Gainers & Losers)
   - تدفقات السيولة الحية وأسهم التجميع والتصريف (Accumulation & Distribution)
   - أحدث التوصيات وإشارات التداول المسجلة في الداتابيز (scan_results)

2. WHEN USER ASKS ABOUT MARKET NEWS, MARKET STATUS, OR TODAY'S MARKET ("أخبار السوق", "النهاردة", "حالة البورصة", "المؤشر والدولار", "اتجاه السيولة"):
   - ⚡ You MUST IMMEDIATELY read and summarize ALL exact values from === DATABASE DATA ===!
   - State the exact EGX30 index value and change percentage provided in === DATABASE DATA ===.
   - State the exact USD/EGP exchange rate provided in === DATABASE DATA ===.
   - State the overall market regime and top moving stocks provided in === DATABASE DATA ===.
   - Summarize active market recommendations or liquidity trends provided in === DATABASE DATA ===.

3. 🚫 NEVER instruct the user to check news websites, newspapers, or external apps when data is available in === DATABASE DATA ===!
4. 🚫 ABSOLUTE PROHIBITION ON REFUSAL DISCLAIMERS ("لا أستطيع تقديم توصيات استثمارية" OR "ترخيص الرقابة المالية"):
   - You are EGX Bots Automated Technical Scanner. When user asks "هات توصيات" or "توصيات المنصة" or "إشارات تداول" or "توصيات من عندك":
   - You MUST IMMEDIATELY present the quantitative platform signals from scan_results in === DATABASE DATA === in a clean Markdown Table (listing Symbol, Signal, Entry Price, Target Price, Stop Loss, Recommendation Date).
   - NEVER output legal refusal disclaimers like "شكراً لانتقائك لكنني لا أستطيع تقديم توصيات استثمارية". Output the platform signals from === DATABASE DATA === directly!
5. ⚠️ PRIORITIZE LISTING SPECIFIC STOCKS: When summarizing market liquidity, accumulation, or news:
   - YOU MUST ALWAYS prioritize listing the specific stock symbols (like COMI, TMGH, FWRY) that are experiencing high volume or accumulation/distribution.
   - Do NOT focus on general investor statistics (Egyptians, Arabs, Foreigners) or sector percentages. The user wants to see specific stocks and tickers first and foremost!
6. لا تقم باختراع بيانات مالية أو أسعار من عندك. استخدم فقط البيانات المتاحة في === DATABASE DATA ===.`;
    } else {
        // Parse live data and build the stock table programmatically
        const parsedData = parseToolsOutput(liveDataString || "");
        let programmaticTable = buildStockTable(parsedData.stocks);
        const hasSymbolsRequested = Array.isArray(plannerResult.entities?.symbols) && plannerResult.entities.symbols.length > 0;
        const noDataForRequested = hasSymbolsRequested && parsedData.stocks.length === 0;

        // Build minimal, clear prompt - simple enough the LLM won't regurgitate it
        let userContentForAnalysis = "";

        if (programmaticTable) {
          // ✅ We have real data - table is pre-built server-side
          // The table is yielded separately in streaming; for non-streaming,
          // we prepend it after LLM generation (in sanitizeReply).
          // Tell LLM only to write 2-line analysis
          finalSystemPrompt = `اكتب 3 أسطر تحليل فني فقط بالعربية عن الأسهم في جدول البيانات أدناه.
مهم جدا: لا تكرر التعليمات. لا تكتب جدول. لا تكتب نقاط. لا تكتب BUY/SELL كأنها أسهم. اكتب تحليل فقط.

ملاحظة: بعض الأسهم قد لا تتوفر لها بيانات — اذكر ذلك ببساطة بدون تخيل أرقام.

الجدول (لقراءتك فقط):
${programmaticTable}

=== DATABASE DATA ===
${liveDataString || ""}
=== END ===`;
        } else if (noDataForRequested) {
          finalSystemPrompt = `المستخدم طلب أسهم لكن مفيش بيانات متاحة ليها في قاعدة البيانات.
قل ببساطة: البيانات مش متوفرة للأسهم دي حالياً.
لا تخترع أرقام.`;
        } else {
          // Fallback for general analysis
          finalSystemPrompt = `اكتب تحليل فني بسيط بالعربية عن الأسهم أو السوق بناءً على البيانات أدناه.
استخدم الأرقام الصحيحة فقط من البيانات ولا تخترع أي شيء.

${liveDataString ? `=== DATABASE DATA ===\n${liveDataString}\n=== END ===` : ""}`;
        }
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
                    return sanitizeReply(reply, liveDataString);
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
                        return sanitizeReply(reply, liveDataString);
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

    // Build programmatic table from live database data (used for all streaming paths)
    let streamProgrammaticTable = "";
    let hasStreamTable = false;
    try {
      const parsedStreamData = parseToolsOutput(liveDataString || "");
      streamProgrammaticTable = buildStockTable(parsedStreamData.stocks);
      hasStreamTable = Boolean(streamProgrammaticTable && parsedStreamData.stocks.length > 0 && !hasImages && plannerResult.intent !== "general_chat" && plannerResult.intent !== "market_summary");
    } catch (tableBuildError) {
      console.warn("[generateFinalStream] Error building programmatic table:", tableBuildError);
    }

    // Yield programmatic table ONCE before any streaming attempts
    if (hasStreamTable) {
        yield streamProgrammaticTable + "\n\n### تحليل السيولة الفنية\n";
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
