import { SessionState, PlannerResult } from "./types";
import { createHash } from "crypto";

// In-Memory Image Cache
const imageCache = new Map<string, PlannerResult>();

function validateImageExtraction(summary: string | null): boolean {
    if (!summary) return false;
    const hasSymbols = /[A-Z]{3,5}/.test(summary);
    const hasNumbers = /\d+/.test(summary);
    return hasSymbols || hasNumbers;
}

export async function runPlanner(
    message: string,
    imageList: string[],
    session: SessionState,
    history: any[],
    apiKeys: string[]
): Promise<PlannerResult> {
    const hasImages = imageList && imageList.length > 0;

    // Image Caching Check
    const imageKey = hasImages ? createHash("sha256").update(imageList[0]).digest("hex") : "";
    if (hasImages && imageKey && imageCache.has(imageKey)) {
        const cached = imageCache.get(imageKey)!;
        return {
            ...cached,
            session_update: {
                current_symbol: cached.entities.symbols[0] || session.current_symbol,
                last_symbols: Array.from(new Set([...cached.entities.symbols, ...(session.last_symbols || [])])).slice(0, 15),
                summary: cached.session_update.summary
            }
        };
    }

    // Fully General & Dynamic Intent & Tool Router Prompt
    const plannerSystemPrompt = `You are EGX Bots Master Planner for the Egyptian Stock Exchange.

${hasImages ? `**ANALYZE THE IMAGE:**
Look at the financial image and extract ONLY the stock symbols, prices, and values visible in this new image.
⚠️ CRITICAL: Ignore any stock symbols mentioned in 'Current Session' or 'Recent History' unless they are clearly visible in the new image itself. Do not carry over old symbols.
Provide clear description in Arabic of what financial content is visible.

` : ""}**YOUR TASK:**
Analyze user request and return JSON with this exact structure:
{
  "intent": "portfolio",
  "confidence": 0.95,
  "entities": {
    "symbols": ["STOCK_SYMBOLS_FROM_IMAGE"],
    "sector": null,
    "wants_table": true,
    "timeframe": null
  },
  "tools": ["get_stock"],
  "image_summary": "Arabic description of image content",
  "session_update": {
    "current_symbol": "FIRST_SYMBOL",
    "last_symbols": ["ALL_SYMBOLS"],
    "summary": "portfolio analysis"
  }
}

**RULES:**
- For images: use intent "portfolio" and extract visible stock symbols
- For USD/market queries: use intent "market_summary" with tools ["get_market","get_indices"]  
- For news: use intent "stock_news" with tools ["get_news"]
- For recommendations or signals: use intent "recommendation" with tools ["get_recommendations"]
- If the request is a general market, news, index, or recommendation query, do NOT include stock symbols from the session context in the entities.symbols list.
- ⚠️ CRITICAL: In "image_summary" or "summary" or any other string value in your JSON, NEVER use double quotes ("). If you need to quote a stock symbol, name, or index, use single quotes (') instead. This is extremely important to prevent JSON parsing syntax errors!
- Return ONLY the JSON, no extra text`;

    const recentHistoryText = (history || []).slice(-6).map((h: any) => `${h.role}: ${h.content}`).join("\n");
    const userPromptText = `Current Session:\n${JSON.stringify(session)}\n\nRecent History:\n${recentHistoryText}\n\nUser Request:\n${message || "Analyze input"}`;

    const plannerModels = hasImages 
        ? ["meta/llama-3.2-11b-vision-instruct", "meta/llama-3.2-90b-vision-instruct"] 
        : ["meta/llama-3.1-8b-instruct", "meta/llama-3.1-70b-instruct"];

    let userContent: any;
    if (hasImages) {
        userContent = [
            { type: "text", text: userPromptText },
            { type: "image_url", image_url: { url: imageList[0] } }
        ];
    } else {
        userContent = userPromptText;
    }

    for (const key of apiKeys) {
        for (const modelName of plannerModels) {
            try {
                const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${key}`
                    },
                    body: JSON.stringify({
                        model: modelName,
                        messages: [
                            { role: "system", content: plannerSystemPrompt },
                            { role: "user", content: userContent }
                        ],
                        max_tokens: 500,
                        temperature: 0.1
                    })
                });

                if (res.ok) {
                    const json = await res.json();
                    const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                    
                    // ⚠️ DEBUG: Log vision model response for images
                    if (hasImages) {
                        console.log(`🔍 Vision Model (${modelName}) Raw Response:`, rawContent.substring(0, 200));
                    }
                    
                    let jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        let parsed;
                        try {
                            parsed = JSON.parse(jsonMatch[0]);
                            
                            // ⚠️ DEBUG: Log parsed result for images
                            if (hasImages) {
                                console.log(`🔍 Vision Parsed Result:`, {
                                    intent: parsed.intent,
                                    symbols: parsed.entities?.symbols,
                                    image_summary_length: parsed.image_summary?.length || 0,
                                    image_summary_preview: parsed.image_summary?.substring(0, 100) || "EMPTY"
                                });
                            }
                        } catch (parseError) {
                            console.warn(`JSON parse error with model ${modelName}:`, parseError);
                            // Try to clean up common JSON issues and retry
                            let cleanedJson = jsonMatch[0]
                                .replace(/,(\s*[}\]])/g, '$1')  // Remove trailing commas
                                .replace(/([{,]\s*)(\w+):/g, '$1"$2":')  // Quote unquoted keys
                                .replace(/:\s*([^",{\[\]0-9\-][^",}\]]*[^",}\]\s])\s*([,}])/g, ': "$1"$2');  // Quote unquoted string values
                            
                            try {
                                parsed = JSON.parse(cleanedJson);
                                console.log(`✅ JSON cleanup successful for model ${modelName}`);
                                
                                if (hasImages) {
                                    console.log(`🔍 Vision Parsed Result (cleaned):`, {
                                        intent: parsed.intent,
                                        symbols: parsed.entities?.symbols,
                                        image_summary_length: parsed.image_summary?.length || 0
                                    });
                                }
                            } catch (cleanupError) {
                                console.warn(`Cleanup also failed for model ${modelName}:`, cleanupError);
                                continue;  // Try next model
                            }
                        }
                        
                        // Continue with processing if parsed successfully
                        if (parsed) {
                        const rawSymbols = Array.isArray(parsed.entities?.symbols) 
                            ? parsed.entities.symbols 
                            : (parsed.session_update?.current_symbol ? [parsed.session_update.current_symbol] : []);

                        const symbols = rawSymbols
                            .map((s: string) => String(s).toUpperCase())
                            .filter((s: string) => s !== "EXTRACTED_SYMBOL" && s !== "SYMBOL1" && s !== "PRIMARY_SYMBOL");

                        const isAggregateTableRequest = /كل البيانات|جدول|كل الأسهم|جدول بالشات|ملخص المحادثة/i.test(message);
                        const resolvedSymbols = isAggregateTableRequest && session.last_symbols?.length 
                            ? Array.from(new Set([...symbols, ...session.last_symbols])) 
                            : symbols;

                        const toolsList: string[] = Array.isArray(parsed.tools) ? parsed.tools : [];
                        if (resolvedSymbols.length > 0 && !toolsList.includes("get_stock")) {
                            toolsList.push("get_stock");
                        }

                        const imageSummary = parsed.image_summary || null;
                        const isValidVision = validateImageExtraction(imageSummary);

                        const result: PlannerResult = {
                            intent: parsed.intent || (hasImages ? "portfolio" : "general_chat"),
                            confidence: parsed.confidence || 0.95,
                            entities: {
                                symbols: resolvedSymbols,
                                sector: parsed.entities?.sector || null,
                                wants_table: Boolean(parsed.entities?.wants_table || isAggregateTableRequest || hasImages)
                            },
                            tools: Array.from(new Set(toolsList)),
                            image_summary: imageSummary || (hasImages ? "تحليل البيانات والصورة المرفقة من المحفظة." : null),
                            session_update: {
                                current_symbol: parsed.session_update?.current_symbol || resolvedSymbols[0] || session.current_symbol,
                                last_symbols: Array.isArray(parsed.session_update?.last_symbols)
                                    ? parsed.session_update.last_symbols.map((s: string) => String(s).toUpperCase())
                                    : Array.from(new Set([...resolvedSymbols, ...(session.last_symbols || [])])).slice(0, 15),
                                summary: message || parsed.session_update?.summary || (hasImages ? "تحليل صورة" : null)
                            }
                        };

                        if (hasImages && imageSummary && imageKey) {
                            imageCache.set(imageKey, result);
                        }

                        return result;
                    }
                }
            }
        } catch (e) {
                console.warn(`Planner model ${modelName} attempt warning:`, e);
            }
        }
    }

    const fallbackSymbols = hasImages ? [] : (session.current_symbol ? [session.current_symbol] : []);
    return {
        intent: hasImages ? "portfolio" : "general_chat",
        confidence: 0.8,
        entities: { symbols: fallbackSymbols, sector: null, wants_table: Boolean(hasImages) },
        tools: fallbackSymbols.length > 0 ? ["get_stock"] : [],
        image_summary: hasImages ? "تحليل البيانات والصورة المرفقة من المحفظة." : undefined,
        session_update: { current_symbol: fallbackSymbols[0] || session.current_symbol, last_symbols: session.last_symbols, summary: message }
    };
}
