import { IntentPlan, VisionContext, ToolResult, FactSnapshot } from "./types";
import { AI_CONFIG } from "./config";
import { describeDatedFallback } from "./pipeline";
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

    if (plan.needs_history && recentHistory.length > 0) {
        sections.push("=== RECENT MESSAGES ===");
        recentHistory.forEach(m => {
            sections.push(`${m.role}: ${String(m.content).substring(0, 500)}`);
        });
    }

    if (resolvedReference.symbol) {
        sections.push("=== RESOLVED REFERENCE ===");
        sections.push(`المرجع "${userMessage.match(/ده|دا|دي|هذا/)?.[0] || "السابق"}" يشير إلى: ${resolvedReference.symbol} (ثقة: ${Math.round(resolvedReference.confidence * 100)}%)`);
    }

    const memoryAllowed = plan.needs_historical_data || Boolean(resolvedReference.symbol);
    const scopedFacts = memoryAllowed ? relevantFacts : [];
    const imageDerivedFacts = scopedFacts.filter(f => f.data_type === "image-derived");
    const liveMemoryFacts = scopedFacts.filter(f => f.data_type === "live");
    const historicalFacts = scopedFacts.filter(f => f.data_type === "historical");

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
    sections.push("- عندما يسأل المستخدم عن سبب هبوط أو صعود أو حركة سهم معين (مثل: ما سبب هبوط/صعود... أو ليه نزل/طلع...):");
    sections.push("  1. إذا كانت هناك أخبار في === LIVE DATA ===، اشرح العوامل والأخبار المرتبطة بالسهم أولاً.");
    sections.push("  2. قدم تحليلاً فنياً ومالياً مفسراً لسبب الحركة (مثل: عمليات جني أرباح فنية طبيعية بعد وصول مؤشر RSI لمناطق تشبع شرائي مرتفعة، أو ضعف السيولة وانخفاض التداول عن المتوسط، أو اختبار مستويات مقاومة وتراجع السعر منها، أو حركات تصحيحية في المسار الصاعد).");
    sections.push("- عندما يسأل المستخدم عن القيمة العادلة أو التقييم لسهم معين (مثل: ما القيمة العادلة لسهم...):");
    sections.push("  1. قدّم تحليلاً شاملاً مستنداً إلى البيانات المتاحة (السعر الحالي، القيمة السوقية، ومستويات الدعم والمقاومة الحسابية).");
    sections.push("  2. وضح نطاق الحركة السعرية ومستويات القيمة العادلة الفنية بين الدعم والمقاومة والقيمة السوقية للشركة.");
    sections.push("  3. اجعل الإجابة مفسرة ومباشرة ترضي استفسار العميل.");
    sections.push("- عند سؤال المستخدم عن قرار البيع أو الشراء أو الاحتفاظ بسهم معين، لا تقدم قراراً شخصياً مباشراً بالبيع أو الشراء. اعرض الحقائق الحالية والمؤشرات الفنية ونقاط الدعم والمقاومة، ودع القرار النهائي للمستخدم.");
    sections.push("- إذا كانت هناك توصيات أو إشارات (مثل BUY أو SELL) متوفرة في بيانات الأدوات (المسترجعة من scan_results)، فقم بعرضها للمستخدم بوضوح مع ذكر تفاصيلها (سعر الدخول، الهدف، وقف الخسارة، وتاريخ صدورها)، مع توضيح أنها إشارة فنية تاريخية مسجلة بالنظام وليست توصية استثمارية مباشرة جديدة.");

    let contextText = sections.join("\n\n");
    if (contextText.length > MAX_CONTEXT_CHARS) {
        const requestEnd = contextText.indexOf("\n\n");
        const request = requestEnd >= 0 ? contextText.slice(0, requestEnd + 2) : "";
        const tail = contextText.slice(-Math.max(0, MAX_CONTEXT_CHARS - request.length));
        contextText = `${request}${tail}\n\n[تم اقتطاع السياق القديم - تجاوز الحد الأقصى]`;
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
                keyIndex++;
            } else {
                keyIndex++;
            }
        } catch (err: any) {
            keyIndex++;
        }
    }
    return { response: null };
}

async function callAgentRouterApi(
    modelName: string,
    messages: { role: string; content: any }[],
    stream = false
): Promise<{ response: string | null }> {
    const key = process.env.AGENT_ROUTER_API_KEY || process.env.AGENTROUTER_API_KEY;
    if (!key) return { response: null };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
        const res = await fetch(AI_CONFIG.api.agentRouterBaseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${key}`,
                "x-api-key": key
            },
            signal: controller.signal,
            body: JSON.stringify({ model: modelName, messages, temperature: 0.15, max_tokens: 4096, stream })
        });
        if (!res.ok) return { response: null };
        const data = await res.json();
        return { response: data.choices?.[0]?.message?.content?.trim() || null };
    } catch {
        return { response: null };
    } finally {
        clearTimeout(timeoutId);
    }
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
    apiKeys: string[],
    requestedModel?: string
): Promise<string> {
    if (visionContext && visionContext.symbols.length === 0 && toolResults.length === 0) {
        return buildVisionUncertaintyResponse(visionContext);
    }
    const isAnalyticalQuery = /(سبب|ليه|لماذا|ازاي|إزاي|تفسير|سر|ينزل|يهبط|يطلع|صعود|هبوط|فرص|أحسن|احسن|افضل|أفضل|توقعات|متوقع|مقارن|قارن|حالة|حالتها|رايك|رأيك|توجيه|تجميع|تصريف|تحليل|شراء|بيع|مناسب)/i.test(userMessage);
    const deterministic = !isAnalyticalQuery ? buildDeterministicResponse(userMessage, plan, toolResults) : null;
    if (deterministic) return deterministic;
    console.log("FINAL_V2 DEBUG PLAN:", JSON.stringify(plan, null, 2));
    if (shouldReturnNoData(plan, visionContext, toolResults, relevantFacts)) {
        const requestedDate = plan.entities.requested_date;
        return requestedDate
            ? `لا توجد بيانات موثقة لهذا الطلب بتاريخ ${requestedDate}. لم أستخدم تاريخاً آخر حتى لا أخلط بين البيانات.`
            : "لا توجد بيانات حية أو تاريخية كافية لهذا الطلب حالياً. لم أستخدم معلومات عامة حتى لا أضيف أرقاماً أو أسماء غير مؤكدة.";
    }

    const messages = buildV2FinalMessages(
        userMessage, plan, visionContext, toolResults,
        relevantFacts, recentHistory, resolvedReference
    );

    const textModels = requestedModel ? [requestedModel] : [AI_CONFIG.models.response.default, ...AI_CONFIG.models.response.fallbacks];
    for (const m of textModels) {
        const result = m === "gpt-5.6-sol"
            ? await callAgentRouterApi(m, messages)
            : await callNvidiaApi(m, messages, apiKeys);
        if (result?.response) {
            return sanitizeReply(removeModelTables(result.response));
        }
    }
    return buildDeterministicResponse(userMessage, plan, toolResults) || "عذراً، لم أتمكن من إنشاء الرد.";
}

export async function* generateV2Stream(
    userMessage: string,
    plan: IntentPlan,
    visionContext: VisionContext | null,
    toolResults: ToolResult[],
    relevantFacts: FactSnapshot[],
    recentHistory: Array<{ role: string; content: string }>,
    resolvedReference: { symbol: string | null; message_id: string | null; confidence: number },
    apiKeys: string[],
    requestedModel?: string
): AsyncGenerator<string, void, unknown> {
    if (visionContext && visionContext.symbols.length === 0 && toolResults.length === 0) {
        yield buildVisionUncertaintyResponse(visionContext);
        return;
    }
    const isAnalyticalQuery = /(سبب|ليه|لماذا|ازاي|إزاي|تفسير|سر|ينزل|يهبط|يطلع|صعود|هبوط|فرص|أحسن|احسن|افضل|أفضل|توقعات|متوقع|مقارن|قارن|حالة|حالتها|رايك|رأيك|توجيه|تجميع|تصريف|تحليل|شراء|بيع|مناسب|مكمل|مستمر|جلسه|جلسة|غدا|غداً|اشترى|اشتري)/i.test(userMessage);
    const deterministic = !isAnalyticalQuery ? buildDeterministicResponse(userMessage, plan, toolResults) : null;
    if (deterministic) {
        yield deterministic;
        return;
    }
    if (shouldReturnNoData(plan, visionContext, toolResults, relevantFacts)) {
        yield plan.entities.requested_date
            ? `لا توجد بيانات موثقة لهذا الطلب بتاريخ ${plan.entities.requested_date}. لم أستخدم تاريخاً آخر حتى لا أخلط بين البيانات.`
            : "لا توجد بيانات حية أو تاريخية كافية لهذا الطلب حالياً. لم أستخدم معلومات عامة حتى لا أضيف أرقاماً أو أسماء غير مؤكدة.";
        return;
    }

    const messages = buildV2FinalMessages(
        userMessage, plan, visionContext, toolResults,
        relevantFacts, recentHistory, resolvedReference
    );

    const textModels = requestedModel ? [requestedModel] : [AI_CONFIG.models.response.default, ...AI_CONFIG.models.response.fallbacks];

    if (textModels[0] === "gpt-5.6-sol") {
        const result = await callAgentRouterApi(textModels[0], messages, false);
        if (result.response) {
            yield sanitizeReply(removeModelTables(result.response));
            return;
        }
        yield "عذراً، نموذج AgentRouter غير متاح حالياً. تحقق من مفتاح AGENTROUTER_API_KEY.";
        return;
    }

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

    const fallbackText = buildDeterministicResponse(userMessage, plan, toolResults);
    yield fallbackText || "عذراً، لم أتمكن من إنشاء الرد.";
}

function buildVisionUncertaintyResponse(vision: VisionContext): string {
    const uncertainty = vision.uncertainties.length > 0
        ? ` السبب: ${vision.uncertainties.join(" ")}`
        : "";
    return `لم أجد في الصورة بيانات مالية مرئية مؤكدة يمكن تحويلها إلى تحليل سهم. لم أستخدم أي رمز أو رقم غير واضح حتى لا أختلق بيانات.${uncertainty}`;
}

export function buildDeterministicResponse(userMessage: string, plan: IntentPlan, toolResults: ToolResult[]): string | null {
    const levelResults = toolResults.filter(result => result.tool === "get_stock_levels");
    const stockResults = toolResults.filter(result => result.tool === "get_stock" && result.data?.symbol);
    const compoundNews = toolResults.find(result => result.tool === "get_news");
    const compoundMessage = /\n|\s+(?:هات|جيب|اعرض|حلل|شوف|قارن|لو\s+كسر)(?:\s|$)|[،,]\s*(?:و\s*)?(?:مين|ايه|إيه|هات|جيب|شوف|حلل)(?:\s|$)/i.test(userMessage);
    if (compoundMessage && (levelResults.length > 0 || stockResults.length > 0 || compoundNews)) {
        const parts: string[] = [];
        for (const result of stockResults) {
            const data = result.data;
            parts.push(`${data.symbol}: السعر ${data.price ?? "غير متاح"} جنيه، التغير ${data.change_pct ?? "غير متاح"}، RSI ${data.rsi_14 ?? "غير متاح"}، نسبة الحجم ${data.vol_ratio ?? "غير متاحة"}.`);
        }
        for (const result of levelResults) {
            const data = result.data || {};
            parts.push(data.support == null ? `${data.symbol || result.symbols[0]}: لا توجد بيانات مستويات كافية.` : `${data.symbol}: الدعم ${Number(data.support).toFixed(2)} جنيه، المقاومة ${Number(data.resistance).toFixed(2)} جنيه.`);
        }
        if (/(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(userMessage)) {
            for (const result of levelResults) {
                const data = result.data || {};
                if (data.support != null) parts.push(`${data.symbol}: كسر الدعم عند ${Number(data.support).toFixed(2)} جنيه يزيد المخاطر الفنية، ويحتاج تأكيد إغلاق وحجم قبل اتخاذ قرار.`);
            }
        }
        if (compoundNews) {
            const newsItems = Array.isArray(compoundNews.data) ? compoundNews.data : [];
            parts.push(newsItems.length
                ? `الأخبار: تم العثور على ${newsItems.length} سجل للأسهم ${compoundNews.symbols.join("، ")}.`
                : `الأخبار: لا توجد أخبار مسجلة حالياً للأسهم ${compoundNews.symbols.join("، ") || "المطلوبة"}.`);
        }
        const scan = toolResults.find(result => result.tool === "get_accumulation_stocks" || result.tool === "get_distribution_stocks");
        if (scan?.data?.stocks?.length) parts.push(`التجميع/التصريف: ${scan.data.stocks.slice(0, 8).map((stock: any) => stock.symbol).join("، ")}.`);
        if (parts.length) return Array.from(new Set(parts)).join("\n");
    }
    if (plan.intent === "general_chat" && toolResults.length === 0) {
        if (/(انت|إنت|انتا|أنت).{0,12}(مين|موديل|نموذج)|مين انت|مين إنت/i.test(userMessage)) {
            return "أنا مساعد EGX Bots لتحليل بيانات البورصة المصرية. أستخدم نموذج الذكاء الاصطناعي الذي تختاره من واجهة الشات لصياغة الرد، مع الاعتماد على بيانات النظام وأدواته عند تحليل الأسهم.";
        }
        if (/(انت|إنت|انتا|أنت).{0,12}(مين|موديل|نموذج)|مين انت|مين إنت/i.test(userMessage)) {
            return "أنا مساعد EGX Bots لتحليل بيانات البورصة المصرية. أستخدم نموذج الذكاء الاصطناعي الذي تختاره من واجهة الشات لصياغة الرد، مع الاعتماد على بيانات النظام وأدواته عند تحليل الأسهم.";
        }
        if (/(ازيك|إزيك|عامل ايه|عامل إيه|اهلا|أهلا|مرحبا|السلام عليكم)/i.test(userMessage)) {
            return "أهلاً بك. أقدر أساعدك في تحليل سهم، مقارنة سهمين، أخبار الشركات، أو تحليل قطاعات البورصة المصرية باستخدام البيانات المتاحة.";
        }
        return null;
    }

    const news = toolResults.find(result => result.tool === "get_news");
    if (news) {
        const items = Array.isArray(news.data) ? news.data : [];
        const rangeLabel = plan.entities.requested_start_date && plan.entities.requested_end_date
            ? ` من ${plan.entities.requested_start_date} إلى ${plan.entities.requested_end_date}`
            : " الحالية";
        if (items.length === 0 && !(compoundMessage && (stockResults.length || levelResults.length))) {
            return `لا توجد أخبار أو بيانات معنويات مسجلة خلال الفترة${rangeLabel}${news.symbols.length ? ` للأسهم ${news.symbols.join("، ")}` : ""}.`;
        }
        const headlines = items.filter((item: any) => item?.title).slice(0, 5);
        const sentiment = items.filter((item: any) => item?.sentiment_score != null).slice(0, 3);
        const lines = [`تم العثور على ${items.length} سجل أخبار ومعنويات من قاعدة البيانات خلال الفترة${rangeLabel}.`];
        headlines.forEach((item: any) => lines.push(`- ${item.symbol || "السهم"}: ${item.title} (${String(item.published_at || item.date || "").slice(0, 10)})`));
        sentiment.forEach((item: any) => lines.push(`- معنويات ${item.symbol}: ${Number(item.sentiment_score) > 0.15 ? "إيجابية" : Number(item.sentiment_score) < -0.15 ? "سلبية" : "محايدة"}، عدد الأخبار ${item.news_count || 0}.`));
        return lines.join("\n");
    }

    const recommendations = toolResults.find(result => result.tool === "get_recommendations" || result.tool === "get_signals");
    if (recommendations) {
        const rows = Array.isArray(recommendations.data) ? recommendations.data : [];
        if (rows.length === 0) return "لا توجد إشارات مسجلة يمكن تقييمها حالياً.";
        const evaluated = rows.filter((row: any) => row.return_pct != null);
        const profitable = evaluated.filter((row: any) => Number(row.return_pct) > 0).length;
        const average = evaluated.length ? evaluated.reduce((sum: number, row: any) => sum + Number(row.return_pct), 0) / evaluated.length : null;
        return [
            "هذه إشارات فنية تاريخية مسجلة بالنظام وليست توصيات جديدة.",
            `تم تقييم ${evaluated.length} من ${rows.length} إشارة مقابل آخر سعر متاح: ${profitable} رابحة غير محققة و${evaluated.length - profitable} خاسرة غير محققة.`,
            average == null ? "لا يتوفر سعر حالي كافٍ لحساب العائد." : `متوسط العائد الحسابي غير الموزون: ${average >= 0 ? "+" : ""}${average.toFixed(2)}%. لا يشمل عمولات أو أوزان المحفظة.`,
            ...rows.slice(0, 10).map((row: any) => row.return_pct == null ? `- ${row.symbol}: السعر الحالي غير متاح.` : `- ${row.symbol}: الدخول ${row.entry_price}، الحالي ${row.current_price}، العائد ${row.return_pct >= 0 ? "+" : ""}${Number(row.return_pct).toFixed(2)}%، ${row.status}.`),
            "بلوغ الهدف أو وقف الخسارة يحتاج بيانات أسعار تغطي الفترة كاملة؛ العائد هنا مقارنة بآخر سعر متاح فقط."
        ].join("\n");
    }

    const historical = toolResults.find(result => result.tool === "get_historical_facts");
    if (plan.intent === "historical_recall" && historical?.data?.prior_response) {
        const prior = String(historical.data.prior_response);
        const symbol = historical.symbols[0] || "السهم المشار إليه";
        const price = prior.match(/(?:السعر|price)\s*(?:(?:=|:)\s*)?([0-9]+(?:\.[0-9]+)?)/i)?.[1];
        if (price) return `آخر سعر موثق ظهر في الرد السابق للسهم ${symbol} كان ${price} جنيه. هذه قيمة تاريخية من رد سابق وليست سعراً حياً.`;
        return `وجدت رداً سابقاً موثقاً للسهم ${symbol}، لكن السعر غير ظاهر بشكل قابل للاستخراج منه. لا أستطيع اختراع قيمة غير موجودة.`;
    }

    const levels = levelResults[0];
    if (levels && /(كسر|يكسر).{0,12}الدعم|الدعم.{0,12}(اتكسر|انكسر)/i.test(userMessage)) {
        const data = levels.data || {};
        if (data.support == null) return `لا توجد بيانات كافية لتحديد دعم حسابي للسهم ${data.symbol || levels.symbols[0]}.`;
        return `إذا أغلق ${data.symbol || levels.symbols[0]} أسفل الدعم الحسابي ${Number(data.support).toFixed(2)} جنيه، فهذا يزيد المخاطر الفنية ولا يضمن استمرار الهبوط. راجع حجم مركزك وحد الخسارة الذي يناسب تحملك، وانتظر تأكيد الإغلاق والحجم بدلاً من الاعتماد على كسر لحظي. هذه قراءة فنية وليست أمراً بالبيع.`;
    }
    if (levelResults.length && /(مقاوم|مقوام|دعم|support|resistance)/i.test(userMessage)) {
        const lines = levelResults.map(result => {
            const data = result.data || {};
            return data.support == null || data.resistance == null
                ? `${data.symbol || result.symbols[0]}: لا توجد بيانات سعرية كافية لحساب الدعم والمقاومة.`
                : `${data.symbol}: الدعم الحسابي ${Number(data.support).toFixed(2)} جنيه، المقاومة الحسابية ${Number(data.resistance).toFixed(2)} جنيه، والإغلاق ${Number(data.close).toFixed(2)} جنيه بتاريخ ${result.data_time} (${data.lookback_sessions} جلسة).`;
        });
        return [...lines, "هذه مستويات نطاقية حسابية وليست ضماناً لحركة السعر أو توصية بيع وشراء."].join("\n");
    }

    const decision = /(أبيع|ابيع|بيع|أشتري|اشتري|شراء|احتفظ|أحتفظ|اخرج|أخرج)/i.test(userMessage);
    const stockData = toolResults.filter(result => result.tool === "get_stock" && result.data?.symbol);
    const riskQuestion = /(يخسر|خسار|يهبط|ينزل).{0,30}(تاني|اكتر|أكتر|اكثر|أكثر|%|في الميه|فى الميه)|(?:ممكن|هل).{0,20}(يخسر|يهبط|ينزل)/i.test(userMessage);
    if (riskQuestion && stockData.length > 0) {
        const scan = toolResults.find(result => result.tool === "get_distribution_stocks");
        const data = stockData[0].data;
        const scanRow = scan?.data?.scan_rows?.find((row: any) => String(row.symbol).toUpperCase() === String(data.symbol).toUpperCase());
        const unitText = (value: unknown, unit: string) => `${String(value).replace(new RegExp(`\\${unit}+$`), "")}${unit}`;
        const requestedLoss = userMessage.match(/(?:اكتر|أكتر|اكثر|أكثر|من)?\s*(\d+(?:\.\d+)?)\s*%?/i)?.[1];
        const riskFactors = [
            data.change_pct != null ? `التغير الأخير ${unitText(data.change_pct, "%")}` : null,
            data.vol_ratio != null ? `نسبة الحجم ${unitText(data.vol_ratio, "x")}` : null,
            data.rsi_14 != null ? `RSI ${data.rsi_14}` : null,
            scanRow?.dist_score != null ? `درجة التصريف المسجلة ${scanRow.dist_score}/100` : null,
            scanRow?.consecutive_dist_days != null ? `أيام التصريف المتتالية ${scanRow.consecutive_dist_days}` : null
        ].filter(Boolean);
        return [
            `نعم، من الناحية النظرية يمكن أن يخسر ${data.symbol}${requestedLoss ? ` أكثر من ${requestedLoss}%` : " أكثر"}؛ لا توجد بيانات تضمن سقفاً للخسارة أو تنفيه.`,
            riskFactors.length ? `عوامل الخطر الظاهرة في البيانات: ${riskFactors.join("، ")}.` : "لا توجد عوامل كمية كافية في البيانات الحالية لتقدير احتمال الخسارة.",
            "وجود إشارة تصريف أو هبوط سابق يرفع الحذر، لكنه لا يتنبأ بنسبة هبوط محددة. استخدم مستوى المخاطر وخطة وقف الخسارة الخاصة بك، فهذا ليس توصية استثمارية."
        ].join("\n");
    }
    if (decision && stockData.length > 0) {
        const levelData = levels?.data;
        const lines = stockData.map(result => {
            const data = result.data;
            return `- ${data.symbol}: السعر الحالي ${data.price} جنيه، التغير ${data.change_pct}، RSI ${data.rsi_14}، MACD ${data.macd_signal}، نسبة الحجم ${data.vol_ratio}.`;
        });
        const levelSymbol = levelData?.symbol || levels?.symbols?.[0] || stockData[0]?.data?.symbol;
        return [
            "لا أستطيع اتخاذ قرار البيع بدلاً منك، لكن يمكن ربط القرار بالمستويات السعرية الفعلية.",
            ...lines,
            levelData?.support != null && levelData?.resistance != null
                ? `الدعم الحسابي (لسهم ${levelSymbol}) ${Number(levelData.support).toFixed(2)} جنيه، والمقاومة الحسابية ${Number(levelData.resistance).toFixed(2)} جنيه، محسوبان من آخر ${levelData.lookback_sessions} جلسة حتى ${levels?.data_time}. كسر الدعم قد يزيد المخاطر، والاقتراب من المقاومة قد يستدعي مراجعة خطتك أو جني جزء من الربح حسب تحملك للمخاطر.`
                : "لا توجد بيانات سعرية كافية لحساب دعم ومقاومة يمكن الاستناد إليها، لذلك لن أحدد سعراً للبيع.",
            "هذه قراءة فنية وليست توصية بيع أو شراء."
        ].join("\n");
    }

    const comparison = toolResults.find(result => result.tool === "get_comparison");
    if (comparison?.data?.sym1 && comparison?.data?.sym2) {
        const entries = [comparison.data.sym1, comparison.data.sym2];
        const describe = (entry: any, fallback: string) => {
            const symbol = entry.info?.symbol || fallback;
            const price = entry.price?.close ?? "غير متاح";
            const change = entry.tech?.change_pct ?? "غير متاح";
            const rsi = entry.tech?.rsi_14 ?? "غير متاح";
            const ratio = entry.tech?.volume && entry.tech?.vol_sma20 ? Number(entry.tech.volume) / Number(entry.tech.vol_sma20) : null;
            return `- ${symbol}: السعر ${price} جنيه، التغير ${change}%، RSI ${rsi}${ratio != null ? `، حجم التداول ${ratio.toFixed(2)}x من المتوسط` : ""}.`;
        };
        const dateLabel = plan.entities.requested_date
            ? `مقارنة مباشرة من البيانات المتاحة بتاريخ ${plan.entities.requested_date}:`
            : "مقارنة مباشرة من أحدث بيانات متاحة:";
        const missing = entries
            .map((entry, index) => ({ entry, symbol: comparison.symbols[index] }))
            .filter(({ entry }) => !entry.price && !entry.tech)
            .map(({ symbol }) => symbol);
        const missingNote = missing.length > 0
            ? `لا توجد بيانات مسجلة لـ ${missing.join(" و")} في قاعدة البيانات لهذا التاريخ؛ لم أستخدم تاريخاً آخر.`
            : "ارتفاع RSI يعكس قوة الزخم فقط ولا يكفي منفرداً لاتخاذ قرار.";
        return [dateLabel, describe(entries[0], comparison.symbols[0]), describe(entries[1], comparison.symbols[1]), missingNote].join("\n");
    }

    const sectorLiquidity = toolResults.find(result => result.tool === "get_sector_liquidity");
    if (sectorLiquidity) {
        const sectors = Array.isArray(sectorLiquidity.data?.sectors) ? sectorLiquidity.data.sectors : [];
        if (sectors.length === 0) return sectorLiquidity.data?.requested_sector
            ? `لا توجد بيانات حجم وسعر مكتملة لقطاع ${sectorLiquidity.data.requested_sector} بتاريخ ${sectorLiquidity.data_time}.`
            : `لا توجد بيانات حجم وسعر مكتملة تكفي لمقارنة سيولة القطاعات بتاريخ ${sectorLiquidity.data_time}.`;
        const top = sectors[0];
        const formatMillions = (value: number) => `${(Number(value) / 1_000_000).toFixed(2)} مليون جنيه`;
        if (sectorLiquidity.data?.requested_sector) {
            return [
                `سيولة قطاع ${top.sector} بتاريخ ${sectorLiquidity.data_time}:`,
                `قيمة التداول التقديرية ${formatMillions(top.traded_value)} عبر ${top.stock_count} سهم متاح البيانات.`,
                top.average_volume_ratio != null ? `متوسط نسبة الحجم لأسهم القطاع: ${Number(top.average_volume_ratio).toFixed(2)}x.` : null,
                "المقياس المستخدم هو مجموع السعر × حجم التداول لأسهم القطاع فقط."
            ].filter(Boolean).join("\n");
        }
        return [
            describeDatedFallback(plan.entities.requested_date, sectorLiquidity.data_time),
            `أكبر قطاع من حيث قيمة التداول التقديرية بتاريخ ${sectorLiquidity.data_time} هو ${top.sector}.`,
            `قيمة التداول التقديرية: ${formatMillions(top.traded_value)} عبر ${top.stock_count} سهم متاح البيانات.`,
            ...sectors.slice(1, 5).map((sector: any, index: number) => `${index + 2}. ${sector.sector}: ${formatMillions(sector.traded_value)} عبر ${sector.stock_count} سهم.`),
            "المقياس المستخدم هو مجموع السعر × حجم التداول لأسهم القطاع في الجلسة، وليس RSI أو درجة التجميع."
        ].filter(Boolean).join("\n");
    }

    const sectorList = toolResults.find(result => result.tool === "get_sector_list");
    if (sectorList) {
        const sectors = Array.isArray(sectorList.data?.sectors) ? sectorList.data.sectors : [];
        if (sectors.length === 0) return "لا توجد أسماء قطاعات مسجلة حالياً في بيانات الشركات.";
        return [`القطاعات المسجلة في بيانات البورصة المصرية (${sectors.length} قطاع):`, ...sectors.map((item: any, index: number) => `${index + 1}. ${item.sector} (${item.stock_count} سهم)`) ].join("\n");
    }

    const sector = toolResults.find(result => result.tool === "get_sector");
    if (sector?.data?.stocks?.length) {
        const stocks = sector.data.stocks as any[];
        const largest = [...stocks].sort((a, b) => Number(b.tech?.close || 0) * Number(b.tech?.volume || 0) - Number(a.tech?.close || 0) * Number(a.tech?.volume || 0))[0];
        if (/اكبر|أكبر|largest|biggest/i.test(userMessage)) {
            const value = Number(largest?.tech?.close || 0) * Number(largest?.tech?.volume || 0);
            return `أكبر سهم في قطاع ${sector.data.sector} من حيث قيمة التداول التقديرية بتاريخ ${sector.data_time} هو ${largest.symbol} (${largest.name || largest.symbol})، بقيمة تقارب ${(value / 1000000).toFixed(2)} مليون جنيه. المقياس المستخدم هو السعر × حجم التداول، وليس القيمة السوقية أو توصية استثمارية.`;
        }
        const advancing = stocks.filter(stock => Number(stock.tech?.change_pct || 0) > 0).length;
        const declining = stocks.filter(stock => Number(stock.tech?.change_pct || 0) < 0).length;
        const strongest = [...stocks].sort((a, b) => Number(b.tech?.change_pct || 0) - Number(a.tech?.change_pct || 0)).slice(0, 3);
        return [
            `تحليل قطاع ${sector.data.sector} مبني على ${stocks.length} سهماً في أحدث بيانات بتاريخ ${sector.data_time}.`,
            `- مرتفعة: ${advancing}، منخفضة: ${declining}.`,
            `- الأفضل أداءً ضمن العينة: ${strongest.map(stock => `${stock.symbol} (${Number(stock.tech?.change_pct || 0).toFixed(2)}%)`).join("، ")}.`,
            "راجع الجدول للتفاصيل؛ المؤشرات الفنية تصف الزخم والسيولة ولا تمثل توصية استثمارية."
        ].join("\n");
    }

    const scanResult = toolResults.find(result => result.tool === "get_accumulation_stocks" || result.tool === "get_distribution_stocks");
    if (scanResult) {
        const direction = plan.entities.scan_direction || scanResult.data?.direction || (scanResult.tool === "get_distribution_stocks" ? "distribution" : "accumulation");
        const directionAr = direction === "distribution" ? "التصريف" : "التجميع";
        const scoreField = direction === "distribution" ? "dist_score" : "acc_score";
        const oppositeScoreField = direction === "distribution" ? "acc_score" : "dist_score";
        const consecutiveField = direction === "distribution" ? "consecutive_dist_days" : "consecutive_acc_days";
        const stocks = Array.isArray(scanResult.data?.stocks) ? scanResult.data.stocks as any[] : [];
        const scanRows = Array.isArray(scanResult.data?.scan_rows) ? scanResult.data.scan_rows as any[] : [];

        if (plan.entities.symbols.length > 0) {
            const requestedSymbols = plan.entities.symbols.map(symbol => symbol.toUpperCase());
            const row = scanRows.find(item => requestedSymbols.includes(String(item.symbol || "").toUpperCase())) || stocks[0];
            const symbol = row?.symbol || plan.entities.symbols[0];
            if (row) {
                const score = Number(row[scoreField] || 0);
                const oppositeScore = Number(row[oppositeScoreField] || 0);
                const matchesDirection = row.signal === direction || score >= 50;
                const oppositeDirectionAr = direction === "distribution" ? "التجميع" : "التصريف";
                const verdict = matchesDirection
                    ? `نعم، توجد إشارة ${directionAr} مسجلة على ${symbol} في مسح ${scanResult.data_time}.`
                    : row.signal === (direction === "distribution" ? "accumulation" : "distribution") || oppositeScore >= 50
                        ? `لا، أحدث مسح لا يسجل ${directionAr} على ${symbol}؛ الإشارة الأقرب هي ${oppositeDirectionAr}.`
                        : `لا توجد إشارة ${directionAr} مؤكدة على ${symbol} في أحدث مسح.`;
                const evidence = [
                    `الإشارة المسجلة: ${row.signal || "محايدة"}`,
                    `درجة ${directionAr}: ${row[scoreField] ?? "غير متاحة"}/100`,
                    `درجة ${oppositeDirectionAr}: ${row[oppositeScoreField] ?? "غير متاحة"}/100`,
                    row.vol_ratio != null ? `نسبة الحجم: ${row.vol_ratio}x` : null,
                    row[consecutiveField] != null ? `أيام ${directionAr}: ${row[consecutiveField]}` : null,
                    row.wyckoff_phase ? `مرحلة Wyckoff: ${row.wyckoff_phase}` : null
                ].filter(Boolean);
                return [describeDatedFallback(plan.entities.requested_date, scanResult.data_time), verdict, `الدليل: ${evidence.join("، ")}.`, "هذه قراءة لمسح فني مسجل وليست توصية شراء أو بيع."].filter(Boolean).join("\n");
            }

            const technicalRow = Array.isArray(scanResult.data?.technical_rows) ? scanResult.data.technical_rows[0] : null;
            const technicalDetails = technicalRow
                ? ` المتاح فنياً: نسبة الحجم ${technicalRow.vol_ratio ?? "غير متاحة"}x، RSI ${technicalRow.rsi_14 ?? "غير متاح"}، MACD ${technicalRow.macd_signal ?? "غير متاح"}.`
                : "";
            return `لا توجد بيانات مسح ${directionAr} كافية للسهم ${symbol} بتاريخ ${scanResult.data_time}.${technicalDetails} مؤشرات الحجم وRSI وMACD تصف السيولة والزخم، لكنها لا تثبت ${directionAr} وحدها.`;
        }

        if (stocks.length > 0) {
            const displayed = stocks.slice(0, 8);
            return [
                describeDatedFallback(plan.entities.requested_date, scanResult.data_time),
                `أبرز أسهم ${directionAr} حسب المسح المؤرخ ${scanResult.data_time}:`,
                ...displayed.map(stock => `- ${stock.symbol}: درجة ${directionAr} ${stock[scoreField] ?? "غير متاحة"}/100، نسبة الحجم ${stock.vol_ratio ?? "غير متاحة"}x، ${directionAr} متتالٍ ${stock[consecutiveField] ?? 0} يوم.`),
                "هذه نتائج مسح فني وليست توصية شراء أو بيع."
            ].filter(Boolean).join("\n");
        }

        if (plan.entities.requested_date) {
            return `لا توجد بيانات مسح ${directionAr} مسجلة بتاريخ ${plan.entities.requested_date}. لم أستخدم بيانات من تاريخ آخر حتى لا أخلط بين التواريخ.`;
        }
        return [
            `لا توجد إشارات ${directionAr} مطابقة لمعايير المسح في أحدث بيانات متاحة.`,
            "لم أستخدم RSI أو MACD وحدهما لإثبات الإشارة."
        ].join("\n");
    }

    const stocks = stockData;
    if (stocks.length > 0) {
        const lines = stocks.map(result => {
            const data = result.data;
            return `- ${data.symbol} (${data.name}): السعر ${data.price} جنيه، التغير ${data.change_pct}، RSI ${data.rsi_14}، MACD ${data.macd_signal}، حجم التداول ${data.vol_ratio} من متوسط 20 جلسة.`;
        });
        const levelLines = levelResults
            .map(lvl => {
                const lvlData = lvl?.data;
                const lvlSymbol = lvlData?.symbol || lvl?.symbols?.[0];
                if (lvlData?.support != null && lvlData?.resistance != null) {
                    return `الدعم الحسابي (لسهم ${lvlSymbol}): ${Number(lvlData.support).toFixed(2)} جنيه، المقاومة الحسابية: ${Number(lvlData.resistance).toFixed(2)} جنيه، من آخر ${lvlData.lookback_sessions} جلسة حتى ${lvl.data_time}.`;
                }
                return null;
            })
            .filter((line): line is string => line !== null);

        const levelFallback = levelLines.length === 0 && levelResults.some(r => r.source === "empty")
            ? "لا توجد بيانات سعرية كافية لحساب الدعم والمقاومة."
            : null;

        return [describeDatedFallback(plan.entities.requested_date, stocks[0]?.data_time), "ملخص أحدث البيانات المتاحة:", ...lines, ...levelLines, levelFallback, "RSI وMACD يقيسان الزخم، ونسبة الحجم تقارن التداول الحالي بمتوسطه ولا تثبت وحدها وجود تجميع أو تصريف."].filter(Boolean).join("\n");
    }

    return null;
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
