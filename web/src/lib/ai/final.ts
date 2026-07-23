import { PlannerResult } from "./types";

function normalizeArabic(str: string): string {
    return str
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .toLowerCase();
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
    const defaultTextModel = "meta/llama-3.1-8b-instruct";
    
    // Model 2: Uses the exact model requested by the user (e.g. deepseek-ai/deepseek-v4-flash)
    const userSelectedModel = requestedModel && requestedModel.includes("/") 
        ? requestedModel 
        : defaultTextModel;

    const modelsToTry = Array.from(new Set([
        userSelectedModel,
        "meta/llama-3.1-70b-instruct",
        defaultTextModel,
        "mistralai/mistral-7b-instruct-v0.3"
    ]));

    // ⚠️ CRITICAL FIX: If we have live data from database OR images, handle carefully
    const hasImages = imageList && imageList.length > 0;
    const hasLiveData = liveDataString && liveDataString.trim().length > 50;
    
    // For image analysis, use LLM with extracted data
    if (hasImages) {
        console.log("🖼️ Image analysis detected - proceeding with LLM");
        // Continue to LLM (below)
    }


    let finalSystemPrompt = `You are EGX Bots AI Assistant for the Egyptian Stock Exchange (EGX).`;

    if (plannerResult.intent === "general_chat") {
        finalSystemPrompt += `

You can respond to the user's message conversationally in Arabic. Be polite, friendly, and helpful.
Do NOT output any tables, charts, or fake financial data. If the user asks general questions about the stock market or greetings, you can answer them generally and friendly.`;
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
    const sanitizedAiMessages = aiMessages.slice(1).map((msg: any) => {
        if (Array.isArray(msg.content)) {
            const textParts = msg.content
                .filter((part: any) => part && part.type === "text" && part.text)
                .map((part: any) => part.text)
                .join(" ");
            return { role: msg.role, content: textParts || message || "تحليل البيانات والصورة" };
        }
        return msg;
    });

    const messagesToSend = [
        { role: "system", content: finalSystemPrompt },
        ...sanitizedAiMessages
    ];

    for (const key of apiKeys) {
        for (const modelName of modelsToTry) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 12000); // 12-second timeout per model try

                const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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
                    let reply = data.choices?.[0]?.message?.content?.trim();
                    if (reply) {
                        // 1. Clean raw Python array/dict repr if model echoed input payload structure
                        if (reply.startsWith("[{'type'") || reply.startsWith('[{"type"')) {
                            reply = reply
                                .replace(/^\[\s*\{['"]type['"]\s*:\s*['"]text['"]\s*,\s*['"]text['"]\s*:\s*['"]/i, "")
                                .replace(/['"]\s*\}\s*\]$/i, "")
                                .replace(/\\n/g, "\n");
                        }

                        // 2. Anti-Repetition Loop Sanitizer (Collapses duplicate header/line loops)
                        const lines = reply.split("\n");
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
                        reply = cleanLines.join("\n").trim();

                        // 3. Clean up disclaimer duplicates
                        reply = reply.replace(/\s*✅\s*تحليل EGX Bots مبني على بيانات حية[^\n]*/g, "").trim();
                        reply += "\n\n✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك.";

                        return reply;
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

    return "أهلاً بك! يمكنك إرسال الصورة بوضوح أو كتابة اسم السهم المطلوب وسأقوم بتحليله لك فوراً.\n\n✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك.";
}

// ⚠️ CRITICAL: Generate direct response from live data to avoid LLM hallucination
function generateDirectMarketResponse(liveDataString: string, plannerResult: PlannerResult, message: string): string {
    console.log("🔧 Generating direct market response from live data");
    
    // Extract data from liveDataString
    const lines = liveDataString.split('\n');
    let egx30Value = "";
    let egx30Date = "";
    let usdValue = "";
    let usdDate = "";
    let usdChange = "";
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Extract EGX30 value
        if (line.includes("EGX30:") && !egx30Value) {
            const match = line.match(/EGX30:\s*([\d,]+\.?\d*)/);
            if (match) {
                egx30Value = match[1];
                // Try to find date
                const dateMatch = line.match(/تاريخ حقيقي:\s*(\d{4}-\d{2}-\d{2})/);
                if (dateMatch) egx30Date = dateMatch[1];
            }
        }
        
        // Extract USD value
        if (line.includes("USD/EGP:") && !usdValue) {
            const match = line.match(/USD\/EGP:\s*([\d,]+\.?\d*)/);
            if (match) {
                usdValue = match[1];
                // Try to find date
                const dateMatch = line.match(/تاريخ حقيقي:\s*(\d{4}-\d{2}-\d{2})/);
                if (dateMatch) usdDate = dateMatch[1];
            }
        }
        
        // Extract USD change
        if (line.includes("التغيير الحقيقي:") && !usdChange) {
            usdChange = line.replace("• التغيير الحقيقي:", "").trim();
        }
    }
    
    // Generate response based on available data
    let response = "**معلومات عن المؤشر العام والدولار** [من قاعدة البيانات]\n\n";
    
    if (egx30Value) {
        response += `📊 **المؤشر العام (EGX 30)**\n`;
        response += `• التاريخ: ${egx30Date || "2026-07-22"}\n`;
        response += `• القيمة: ${parseFloat(egx30Value).toLocaleString('ar-EG')} نقطة\n`;
        response += `• المصدر: قاعدة بيانات البورصة المصرية\n\n`;
    }
    
    if (usdValue) {
        response += `💱 **الدولار الأمريكي (USD)**\n`;
        response += `• التاريخ: ${usdDate || "2026-07-22"}\n`;
        response += `• السعر: 1 USD = ${usdValue} جنيه مصري\n`;
        if (usdChange) {
            response += `• ${usdChange}\n`;
        }
        response += `• المصدر: قاعدة البيانات الحقيقية\n\n`;
    }
    
    // Add table if wanted
    if (plannerResult.entities.wants_table && (egx30Value || usdValue)) {
        response += `| المؤشر | القيمة | التاريخ |\n`;
        response += `|---------|--------|---------|\n`;
        if (egx30Value) {
            response += `| EGX30 | ${parseFloat(egx30Value).toLocaleString('ar-EG')} نقطة | ${egx30Date || "2026-07-22"} |\n`;
        }
        if (usdValue) {
            response += `| USD/EGP | ${usdValue} جنيه | ${usdDate || "2026-07-22"} |\n`;
        }
        response += `\n`;
    }
    
    response += "✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك.";
    
    // Log for debugging
    console.log("🔧 Generated direct response with:", { egx30Value, usdValue });
    
    return response;
}

// ⚠️ CRITICAL: Smart response generation that prevents ALL hallucination
function generateSmartResponse(liveDataString: string, plannerResult: PlannerResult, message: string, imageList: string[]): string {
    console.log("🔧 Generating smart response from live data only");
    
    // Extract all data sections from liveDataString
    const lines = liveDataString.split('\n');
    let response = "";
    
    // Check if user asked for analysis
    const isAnalysisRequest = message.includes("حلل") || message.includes("تحليل") || message.includes("analyze");
    
    // Check if there's image data
    const hasImageData = imageList && imageList.length > 0;
    
    if (hasImageData && isAnalysisRequest) {
        // For image analysis, return the raw data without LLM interpretation
        response = "**تحليل البيانات من الصورة:**\n\n";
        response += "يرجى مراجعة البيانات المستخرجة من الصورة أعلاه.\n\n";
        response += "⚠️ ملاحظة: التحليل الفني يتطلب بيانات إضافية من قاعدة البيانات.\n\n";
    } else {
        // Parse live data and format it properly
        let currentSection = "";
        let sectionData: string[] = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Detect section headers
            if (trimmed.startsWith("📊") || trimmed.startsWith("💱") || 
                trimmed.startsWith("🎯") || trimmed.startsWith("📰") ||
                trimmed.startsWith("📈")) {
                // Save previous section
                if (currentSection && sectionData.length > 0) {
                    response += currentSection + "\n";
                    response += sectionData.join("\n") + "\n\n";
                }
                // Start new section
                currentSection = trimmed;
                sectionData = [];
            } else if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
                // Add data point to current section
                sectionData.push(trimmed);
            } else if (trimmed.startsWith("✅") || trimmed.startsWith("⚠️")) {
                // Skip meta information
                continue;
            } else if (trimmed.length > 0 && !trimmed.startsWith("===")) {
                // Add other relevant text
                if (!trimmed.includes("LIVE DATABASE DATA") && !trimmed.includes("END OF")) {
                    sectionData.push(trimmed);
                }
            }
        }
        
        // Add final section
        if (currentSection && sectionData.length > 0) {
            response += currentSection + "\n";
            response += sectionData.join("\n") + "\n\n";
        }
        
        // If no data was extracted, show raw relevant parts
        if (!response || response.trim().length < 50) {
            response = "**البيانات من قاعدة البيانات:**\n\n";
            let addedLines = 0;
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("•") || trimmed.startsWith("📊") || 
                    trimmed.startsWith("💱") || trimmed.startsWith("🎯") ||
                    trimmed.startsWith("📰")) {
                    response += trimmed + "\n";
                    addedLines++;
                }
            }
            if (addedLines === 0) {
                response += "لا توجد أخبار أو بيانات محدثة متاحة حالياً لهذا السهم في قاعدة البيانات.\n";
            }
            response += "\n";
        }
        
        // Add analysis note if requested
        if (isAnalysisRequest) {
            response += "**ملاحظة عن التحليل:**\n";
            response += "التحليل أعلاه مبني على البيانات الحقيقية من قاعدة البيانات فقط. ";
            response += "لا يتم إضافة أي مؤشرات فنية أو توقعات غير موجودة في البيانات الأصلية.\n\n";
        }
    }
    
    // Add table if requested
    if (plannerResult.entities.wants_table) {
        // Try to extract symbols and their data for table
        const symbolData = extractSymbolsFromLiveData(liveDataString);
        if (symbolData.length > 0) {
            response += "| السهم | السعر | التغير | المصدر |\n";
            response += "|-------|-------|--------|--------|\n";
            symbolData.forEach(item => {
                response += `| ${item.symbol} | ${item.price} | ${item.change} | قاعدة البيانات |\n`;
            });
            response += "\n";
        }
    }
    
    response += "✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك.";
    
    return response;
}

// Helper function to extract symbol data from live data string
function extractSymbolsFromLiveData(liveDataString: string): Array<{symbol: string, price: string, change: string}> {
    const lines = liveDataString.split('\n');
    const symbols: Array<{symbol: string, price: string, change: string}> = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("•")) {
            // Match EGX30 pattern
            const egxMatch = trimmed.match(/(EGX\d+):\s*([\d,.]+)\s*نقطة/);
            if (egxMatch) {
                symbols.push({
                    symbol: egxMatch[1],
                    price: egxMatch[2] + " نقطة",
                    change: "N/A"
                });
                continue;
            }
            
            // Match USD pattern
            const usdMatch = trimmed.match(/USD\/EGP:\s*([\d,.]+)\s*جنيه/);
            if (usdMatch) {
                const changeMatch = liveDataString.match(/التغيير الحقيقي:\s*([^\n]+)/);
                symbols.push({
                    symbol: "USD/EGP",
                    price: usdMatch[1] + " ج.م",
                    change: changeMatch ? changeMatch[1].trim() : "N/A"
                });
                continue;
            }
            continue;
        }

        // Parse lines starting with bullet '•'
        let symbol = "";
        const symMatch = trimmed.match(/(?:سهم\s+|توصية\s+سهم\s+|•\s+)([A-Z]{3,5})\b/);
        if (symMatch) {
            symbol = symMatch[1];
        } else {
            // Fallback: look for any uppercase word
            const upperMatch = trimmed.match(/\b([A-Z]{3,5})\b/);
            if (upperMatch) symbol = upperMatch[1];
        }

        if (!symbol) continue;

        // Extract Price / Primary Value
        let price = "N/A";
        if (trimmed.includes("السعر اللحظي =")) {
            const match = trimmed.match(/السعر اللحظي\s*=\s*([^|]+)/);
            if (match) price = match[1].trim();
        } else if (trimmed.includes("سعر الدخول =")) {
            const match = trimmed.match(/سعر\s+الدخول\s*=\s*([^|]+)/);
            if (match) price = match[1].trim();
        } else if (trimmed.includes("معنويات الأخبار =")) {
            const match = trimmed.match(/معنويات\s+الأخبار\s*=\s*([^|]+)/);
            if (match) price = match[1].trim();
        }

        // Extract Change / Secondary Value
        let change = "N/A";
        if (trimmed.includes("التغير:")) {
            const match = trimmed.match(/التغير\s*:\s*([^|]+)/);
            if (match) change = match[1].trim();
        } else if (trimmed.includes("الإشارة =") && trimmed.includes("الهدف =")) {
            const sigMatch = trimmed.match(/الإشارة\s*=\s*([^|]+)/);
            const tarMatch = trimmed.match(/الهدف\s*=\s*([^|]+)/);
            if (sigMatch && tarMatch) {
                change = `${sigMatch[1].trim()} (الهدف: ${tarMatch[1].trim()})`;
            }
        } else if (trimmed.includes("عدد الأخبار:")) {
            const match = trimmed.match(/عدد\s+الأخبار\s*:\s*([^|]+)/);
            if (match) change = `أخبار: ${match[1].trim()}`;
        }

        symbols.push({ symbol, price, change });
    }
    
    return symbols;
}

// ⚠️ CRITICAL: Safe response when image analysis fails
function generateSafeImageResponse(): string {
    return `**تحليل الصورة**

عذراً، لا أستطيع استخراج بيانات مالية واضحة ومؤكدة من الصورة المرفقة.

**لضمان دقة المعلومات:**
• يرجى التأكد من وضوح الصورة وجودتها
• أو يمكنك كتابة أسماء الأسهم مباشرة للحصول على تحليل دقيق من قاعدة البيانات

**مثال:** اكتب "COMI" أو "EAST" للحصول على تحليل مفصل.

⚠️ **مبدأ مهم:** نحن لا نقدم معلومات مالية إلا إذا كنا متأكدين من دقتها 100%.

✅ تحليل EGX Bots مبني على بيانات حية — مش نصيحة استثمار، القرار ليك.`;
}
