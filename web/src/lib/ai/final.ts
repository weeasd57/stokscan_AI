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
        // Parse live data and build tables programmatically to prevent hallucination
        const parsedMarketData = parseToolsOutput(liveDataString || "");
        const marketProgrammaticTable = buildStockTable(parsedMarketData.stocks);
        const marketSectorTable = parsedMarketData.market ? buildMarketTable(parsedMarketData.market) : "";
        const marketRecsTable = buildRecommendationTable(parsedMarketData.recommendations);

        finalSystemPrompt += `

🚨 ANTI-HALLUCINATION — DATABASE-DATA ONLY — NO FABRICATION 🚨

1. ⛔️ اختراع أي رقم أو سعر أو نسبة أو مؤشر = ممنوع. استخدم فقط الأرقام الموجودة في === DATABASE DATA ===.
2. ⛔️ اختراع رموز أسهم (tickers) غير موجودة في === DATABASE DATA === = ممنوع. لا تستخدم ESER أو أي رمز مخترع.
3. ⛔️ نسب أسماء شركات لرموز خطأ = ممنوع. تأكد أن اسم الشركة ورمزها متطابقان في === DATABASE DATA ===.
4. ✅ اعرض البيانات الفعلية كما هي من === DATABASE DATA === مباشرة. لا تعد صياغة الجدول — الجدول أدناه هو المصدر الوحيد.
5. ✅ إذا كانت === DATABASE DATA === محدودة: اذكر المتوفر فقط. لا تكمل الباقي من خيالك.
6. ✅ للرد: اكتب 3-4 أسطر تحليلية فقط عن البيانات الموجودة. لا تخترع أقساماً أو قطاعات جديدة.
7. ✅ مستخدمك خبير ويعرف السوق. أي رقم مخترع سيكتشفه فوراً.

${marketProgrammaticTable ? `\nالجدول البرمجي (للقراءة فقط - لا تعد كتابته):\n${marketProgrammaticTable}\n` : ""}
${marketSectorTable ? `\n${marketSectorTable}\n` : ""}
${marketRecsTable ? `\n${marketRecsTable}\n` : ""}

=== DATABASE DATA ===
${liveDataString || "لا توجد بيانات إضافية متاحة حالياً"}
=== END ===

⚠️ تحذير نهائي: استخدم فقط الأرقام والرموز الموجودة أعلاه. لا تختلق شيئاً.`;
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
          finalSystemPrompt = `🚨 STRICT ANTI-HALLUCINATION: DATABASE ONLY ANALYSIS 🚨

اكتب 3 أسطر تحليل فني فقط بالعربية عن الأسهم في الجدول أدناه.

CRITICAL RULES:
❌ لا تكرر التعليمات أو الجدول
❌ لا تخترع أرقام أو بيانات غير موجودة في الجدول
❌ لا تكتب BUY/SELL كأنها أسهم
❌ لا تخلط بيانات من أسهم مختلفة
✅ اكتب تحليل مختصر فقط بناءً على البيانات الفعلية

ملاحظة هامة: بعض الأسهم قد لا تتوفر لها بيانات — اذكر ذلك ببساطة بدون تخيل أرقام.

الجدول (للقراءة فقط - لا تعيد كتابته):
${programmaticTable}

=== DATABASE DATA ===
${liveDataString || "لا توجد بيانات إضافية"}
=== END ===

⚠️ تحذير أخير: استخدم فقط الأرقام الموجودة في الجدول والبيانات أعلاه. أي رقم آخر مرفوض.`;
        } else if (noDataForRequested) {
          finalSystemPrompt = `المستخدم طلب أسهم لكن مفيش بيانات متاحة ليها في قاعدة البيانات.
قل ببساطة: البيانات مش متوفرة للأسهم دي حالياً.
لا تخترع أرقام.`;
        } else {
          // Fallback for general analysis
          finalSystemPrompt = `🚨 CRITICAL: ZERO HALLUCINATION POLICY - STRICT DATABASE ONLY ANALYSIS 🚨

RULES:
1. ❌ NEVER invent stock prices, percentages, or numbers NOT in === DATABASE DATA ===
2. ❌ NEVER create fake RSI, MACD, or technical indicators
3. ❌ NEVER mix data from different stocks or sources
4. ✅ ONLY use the EXACT numbers provided in === DATABASE DATA ===
5. ✅ If a stock has no data → clearly state "البيانات غير متوفرة"
6. ✅ If a field is missing → write "N/A" or "-"

اكتب تحليل فني بسيط بالعربية بناءً على البيانات الحقيقية أدناه فقط.
لا تخترع أي أرقام. لا تخلط بيانات مختلفة. استخدم البيانات كما هي بالضبط.

${liveDataString ? `=== DATABASE DATA ===\n${liveDataString}\n=== END ===` : "لا توجد بيانات حقيقية متاحة حالياً."}

⚠️ تذكير نهائي: أي رقم غير موجود في === DATABASE DATA === أعلاه يُعتبر اختراع ومرفوض تماماً.`;
        }
	    }

    // Build history messages — when an image is present, strip history to prevent old text questions from confusing image analysis.
    // Also strip any "image.png" / "cannot read image" leak from history that could cause non-vision models to error.
    const historySlice = (aiMessages || []).slice(1, -1);
    const stripImageRefs = (text: string) => text
        .replace(/\bimage\.\w+\b/gi, "[صورة]")
        .replace(/cannot read image[^.]*\./gi, "")
        .replace(/ERROR:.*image.*model does not support image input[^.]*\./gi, "")
        .trim();
    const sanitizedAiMessages = hasImages ? [] : historySlice.map((msg: any) => {
        if (Array.isArray(msg.content)) {
            const textParts = msg.content
                .filter((part: any) => part && part.type === "text" && part.text)
                .map((part: any) => part.text)
                .join(" ");
            return { role: msg.role, content: textParts || message || "تحليل البيانات والصورة" };
        }
        const safeContent = typeof msg.content === "string" ? stripImageRefs(msg.content) : msg.content;
        return { role: msg.role, content: safeContent };
    });

    // Build the final user message
    let finalUserMessage: any;
    if (hasImages && isVisionModel) {
        const userTextContent = message
            ? `${message}\n\nيرجى تحليل الصورة المرفقة بالكامل وتقديم تحليل شامل وموجز لجميع الأسهم الموجودة بها. اكتب التحليل باختصار شديد في نقاط محددة ودون أي مقدمات أو كلام إنشائي لتسريع الرد.`
            : "يرجى تحليل هذه الصورة وتقديم تحليل شامل وموجز لجميع الأسهم الموجودة بها. اكتب التحليل باختصار شديد في نقاط محددة ودون أي مقدمات أو كلام إنشائي لتسريع الرد.";
        finalUserMessage = {
            role: "user",
            content: [
                { type: "text", text: userTextContent },
                ...imageList.map(imgUrl => ({ type: "image_url", image_url: { url: imgUrl } }))
            ]
        };
    } else {
        const baseText = hasImages && !isVisionModel
            ? (message ? `${message}\n\n[ملاحظة: تم تحليل الصورة مسبقاً بواسطة نموذج الرؤية — أجب بناءً على البيانات والجداول أعلاه فقط.]` : "أجب بناءً على البيانات والجداول أعلاه.")
            : (message || (hasImages ? "تحليل الصورة والبيانات" : "تحليل البيانات"));
        const userTextContent = stripImageRefs(baseText);
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

    let keyIndex = 0;
    for (const modelName of modelsToTry) {
        while (keyIndex < apiKeys.length) {
            const key = apiKeys[keyIndex];
            try {
                const isVisionModel = visionModels.includes(modelName);
                const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages, isVisionModel);
                const controller = new AbortController();
                const timeoutMs = isVisionModel ? 15000 : 10000;
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
                    if (reply && !isNvidiaContentRefusal(reply)) {
                        return sanitizeReply(reply, liveDataString);
                    }
                    if (reply && isNvidiaContentRefusal(reply)) {
                        console.warn(`NVIDIA content refusal from model ${modelName}`);
                        break; // Refusal - try next model
                    }
                } else {
                    const errText = await res.text();
                    console.warn(`Model ${modelName} failed (${res.status}):`, errText.substring(0, 150));
                    if (res.status === 401 || res.status === 403 || res.status === 429) {
                        keyIndex++;
                        continue; // Key auth issue - try next key
                    } else {
                        break; // Server/model issue - try next model
                    }
                }
            } catch (err: any) {
                console.warn(`Fetch error with model ${modelName}:`, err.message || err);
                if (err.name === "AbortError" || err.message?.includes("aborted")) {
                    break; // Timeout - try next model
                }
                keyIndex++; // Network/unknown error - try next key
            }
        }
        keyIndex = 0;
    }

    return `أهلاً بك! يمكنك إرسال الصورة بوضوح أو كتابة اسم السهم المطلوب وسأقوم بتحليله لك فوراً.\n\n${AI_CONFIG.disclaimer}`;
}

const NVIDIA_REFUSAL_PATTERNS = [
    "sorry, i cannot provide a response",
    "i cannot provide a response",
    "i cannot help with",
    "unable to provide",
    "cannot comply",
    "i cannot answer",
    "i can't answer",
    "i'm unable to",
    "i'm not able to",
    "i am unable to",
    "i am not able to",
];

function isNvidiaContentRefusal(text: string): boolean {
    if (!text || text.length < 10) return false;
    const lowered = text.toLowerCase().trim();
    if (lowered.length > 300) return false; // refusal texts are typically short
    return NVIDIA_REFUSAL_PATTERNS.some(p => lowered.startsWith(p));
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

    // 4. Check for repeating phrases (length >= 15 repeating 3+ times)
    if (accumulatedText.length > 50) {
        const sentencePattern = /([^.!?\n]{15,})[\s\S]*?\1[\s\S]*?\1/i;
        if (sentencePattern.test(accumulatedText)) return true;
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
      hasStreamTable = Boolean(streamProgrammaticTable && parsedStreamData.stocks.length > 0);
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

    let keyIndex = 0;
    for (const modelName of modelsToTry) {
        while (keyIndex < apiKeys.length) {
            const key = apiKeys[keyIndex];
            try {
                const controller = new AbortController();
                const isVisionModel = visionModels.includes(modelName);
                const messagesToSend = buildFinalMessages(message, imageList, liveDataString, plannerResult, aiMessages, isVisionModel);
                const timeoutMs = isVisionModel ? 15000 : 10000;
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
                    let refusalChecked = false;
                    let refusalBuffer = "";
                    let refused = false;

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
                                    if (!refusalChecked && refusalBuffer.trim()) {
                                        yield refusalBuffer;
                                    }
                                    yield `\n\n${AI_CONFIG.disclaimer}`;
                                    return;
                                }
                                try {
                                    const parsed = JSON.parse(dataStr);
                                    const delta = parsed.choices?.[0]?.delta?.content;
                                    if (delta) {
                                        if (!refusalChecked) {
                                            refusalBuffer += delta;
                                            if (refusalBuffer.length >= 120 || delta.includes(".") || delta.includes("\n") || delta.includes("!") || delta.includes("?")) {
                                                refusalChecked = true;
                                                if (isNvidiaContentRefusal(refusalBuffer)) {
                                                    console.warn(`NVIDIA content refusal from stream model ${modelName}`);
                                                    refused = true;
                                                    reader.cancel();
                                                    break; // break inner for
                                                }
                                                // flush buffer
                                                yield refusalBuffer;
                                            }
                                        } else {
                                            yield delta;
                                        }
                                        accumulatedStreamText += delta;
                                        if (checkStreamCircuitBreaker(accumulatedStreamText)) {
                                            console.warn("🛑 Anti-repetition circuit breaker triggered in NVIDIA loop! Truncating infinite stream loop.");
                                            reader.cancel();
                                            yield `\n\n${AI_CONFIG.disclaimer}`;
                                            return;
                                        }
                                    }
                                } catch {
                                    // Ignore JSON parse errors on partial lines
                                }
                            }
                        }
                        if (refused) break; // break outer while
                    }
                    if (refused) {
                        break; // Refusal - try next model
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

                    if (!refusalChecked && refusalBuffer.trim()) {
                        yield refusalBuffer;
                    }

                    yield `\n\n${AI_CONFIG.disclaimer}`;
                    return;
                } else {
                    const errText = res.ok ? "" : await res.text();
                    console.warn(`Stream model ${modelName} failed (${res.status}):`, errText.substring(0, 150));
                    if (res.status === 401 || res.status === 403 || res.status === 429) {
                        keyIndex++;
                        continue; // try next key
                    } else {
                        break; // try next model
                    }
                }
            } catch (err: any) {
                console.warn(`Stream fetch error with model ${modelName}:`, err.message || err);
                if (err.name === "AbortError" || err.message?.includes("aborted")) {
                    break; // Timeout - try next model
                }
                keyIndex++; // try next key
            }
        }
        keyIndex = 0;
    }

    yield `أهلاً بك! يمكنك إرسال الصورة بوضوح أو كتابة اسم السهم المطلوب وسأقوم بتحليله لك فوراً.\n\n${AI_CONFIG.disclaimer}`;
}
