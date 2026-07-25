import { SessionState, PlannerResult } from "./types";
import { createHash } from "crypto";

const VALID_SYMBOLS = [
    'AALR', 'ABUK', 'ACAMD', 'ACAP', 'ADCI', 'ADPC', 'AFMC', 'AIH', 'AJWA', 'ALUM',
    'APPC', 'ARAB', 'AREH', 'ARVA', 'ATQA', 'AXPH', 'BIOC', 'BTFH', 'CIEB', 'CNFN',
    'COPR', 'CPCI', 'CRST', 'EEII', 'EFID', 'EFIH', 'EGAL', 'EGBE', 'EGCH', 'EGREF',
    'EGSA', 'EGTS', 'EGX30', 'EHDR', 'EITP', 'ELKA', 'ELSH', 'EOSB', 'ETRS', 'FAIT',
    'FERC', 'FWRY', 'GBCO', 'GDWA', 'GGCC', 'GGRN', 'GMCI', 'GOUR', 'GSSC', 'ICFC',
    'IDRE', 'INFI', 'IRON', 'ISMA', 'ISPH', 'KABO', 'KASABF', 'KRDI', 'KZPC', 'LUTS',
    'MASR', 'MBSC', 'MCQE', 'MENA', 'MFPC', 'MFSC', 'MICH', 'MILS', 'MOIL', 'MOSC',
    'MPCO', 'MTIE', 'NEDA', 'NHPS', 'NINH', 'PHTV', 'POUL', 'PRDC', 'RACC', 'RTVC',
    'RUBX', 'SAUD', 'SCEM', 'SCTS', 'SEIG', 'SIPC', 'SNFC', 'SPIN', 'SWDY', 'TANM',
    'TMGH', 'TRTO', 'TWSA', 'UEFM', 'UNIT', 'USDEGP', 'VALU', 'VLMRA', 'WATP'
];

function getLevenshteinDistance(a: string, b: string): number {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

export function correctStockSymbol(symbol: string): string {
    const upperSym = symbol.trim().toUpperCase();
    if (VALID_SYMBOLS.includes(upperSym)) {
        return upperSym;
    }

    let bestMatch = upperSym;
    let minDistance = 2; // Maximum edit distance allowed

    for (const valid of VALID_SYMBOLS) {
        const dist = getLevenshteinDistance(upperSym, valid);
        if (dist < minDistance) {
            minDistance = dist;
            bestMatch = valid;
        }
    }

    return bestMatch;
}

const ARABIC_NAME_MAPPINGS: { [key: string]: string } = {
    "العربية لاستصلاح": "AALR",
    "العربيه لاستصلاح": "AALR",
    "ابوقير": "ABUK",
    "ابو قير": "ABUK",
    "المحابس": "ACAMD",
    "مطاحن الاسكندرية": "AFMC",
    "مطاحن الإسكندرية": "AFMC",
    "الاستثمار والتنمية": "AIH",
    "الاستثمار والتنميه": "AIH",
    "مصر للالومنيوم": "EGAL",
    "مصر للألومنيوم": "EGAL",
    "كيما": "EGCH",
    "المصرية للاتصالات": "ETEL",
    "المصريه للاتصالات": "ETEL",
    "بنك فيصل": "FAIT",
    "فوري": "FWRY",
    "فورى": "FWRY",
    "جي بي": "GBCO",
    "جى بى": "GBCO",
    "غبور": "GBCO",
    "الجيزة للمقاولات": "GGCC",
    "الجيزه للمقاولات": "GGCC",
    "التعمير والاسكان": "HDBK",
    "التعمير والإسكان": "HDBK",
    "مصر الجديدة": "HELI",
    "مصر الجديده": "HELI",
    "هيرميس": "HRHO",
    "هيرمس": "HRHO",
    "ابن سينا": "ISPH",
    "جهينة": "JUFO",
    "جهينه": "JUFO",
    "نهر الخير": "KRDI",
    "القاهرة الوطنية": "KWIN",
    "القاهره الوطنيه": "KWIN",
    "مدينة مصر": "MASR",
    "مدينه مصر": "MASR",
    "مدينة نصر": "MASR",
    "موبكو": "MFPC",
    "مابكو": "MFPC",
    "مطاحن شمال": "MILS",
    "مينا فارم": "MIPH",
    "ماريديف": "MOIL",
    "المنصورة للدواجن": "MPCO",
    "المنصوره للدواجن": "MPCO",
    "سوديك": "OCDI",
    "عبور لاند": "OLFI",
    "اوراسكوم": "ORAS",
    "أوراسكوم": "ORAS",
    "النساجون": "ORWE",
    "بالم هيلز": "PHDC",
    "القاهرة للدواجن": "POUL",
    "القاهره للدواجن": "POUL",
    "قطر الوطني": "QNBE",
    "راية": "RAYA",
    "رايه": "RAYA",
    "راميدا": "RMDA",
    "البركة": "SAUD",
    "البركه": "SAUD",
    "سيدي كرير": "SKPC",
    "سيدى كرير": "SKPC",
    "سماد مصر": "SMFR",
    "ايجيفرت": "SMFR",
    "إيجيفرت": "SMFR",
    "السويدي": "SWDY",
    "السويدى": "SWDY",
    "تنمية للاسكان": "TANM",
    "تنميه للاسكان": "TANM",
    "التنمية للإسكان": "TANM",
    "التنميه للاسكان": "TANM",
    "تنمية للاستثمار": "TANM",
    "طاقة عربية": "TAQA",
    "طاقه عربيه": "TAQA",
    "طلعت مصطفى": "TMGH",
    "طلعت مصطفى القابضة": "TMGH",
    "طلعت مصطفى القابضه": "TMGH",
    "طلعت مصطفي": "TMGH",
    "المتحدة للاسكان": "UNIT",
    "المتحده للاسكان": "UNIT",
    "فاليو": "VALU",
    "زهراء المعادي": "ZMID"
};

export function extractSymbolsFromText(text: string): string[] {
    const textUpper = text.toUpperCase();
    const found: string[] = [];

    const tokens = textUpper.split(/[^A-Z0-9]/).map(t => t.trim()).filter(Boolean);
    for (const token of tokens) {
        if (VALID_SYMBOLS.includes(token)) {
            found.push(token);
        }
    }

    const normalizedText = text
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .toLowerCase();

    for (const [key, symbol] of Object.entries(ARABIC_NAME_MAPPINGS)) {
        const normalizedKey = key
            .replace(/[أإآ]/g, "ا")
            .replace(/ة/g, "ه")
            .toLowerCase();

        if (normalizedText.includes(normalizedKey)) {
            found.push(symbol);
        }
    }

    return Array.from(new Set(found));
}

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

${hasImages ? `**ANALYZE THE IMAGE CAREFULLY:**
CRITICAL INSTRUCTIONS:
1. Extract ALL stock symbols visible in the image - do NOT miss any symbols.
2. Look at EVERY row, cell, and section of the financial image.
3. For each stock symbol, extract the exact values, numbers, and percentages shown next to it (such as the portfolio position value, current price, change amount, and change percentage).
4. Include all of these details (symbols, prices, values, changes) in a clear table format or list inside the "image_summary" field so that the final text model can read them.
5. ⚠️ IMPORTANT: Ignore any stock symbols mentioned in 'Current Session' or 'Recent History' unless they are clearly visible in the new image itself.
6. Provide a detailed Arabic description of ALL financial content visible in the image in the "image_summary" field.

EXAMPLE: If you see 4 stocks in the image, you MUST extract all 4 symbols, and list the exact prices and values for each in the "image_summary" description.

` : ""}**YOUR TASK:**
Analyze user request and return JSON with this exact structure:
{
  "intent": "portfolio",
  "confidence": 0.95,
  "entities": {
    "symbols": ["ALL_STOCK_SYMBOLS_FROM_IMAGE"],
    "sector": null,
    "wants_table": true,
    "timeframe": null
  },
  "tools": ["get_stock"],
  "image_summary": "وصف تفصيلي بالعربية لكل محتوى الصورة المالية بما في ذلك جميع رموز الأسهم المرئية",
  "session_update": {
    "current_symbol": "FIRST_SYMBOL",
    "last_symbols": ["ALL_SYMBOLS_IN_ORDER"],
    "summary": "portfolio analysis with all visible stocks"
  }
}

**RULES:**
- For images: use intent "portfolio" and extract ALL visible stock symbols (do not miss any)
- For USD/market queries: use intent "market_summary" with tools ["get_market","get_indices"]  
- For news: use intent "stock_news" with tools ["get_news"]
- For recommendations or signals: use intent "recommendation" with tools ["get_recommendations"]
- For greetings, general chat, or conversational requests (e.g. 'hello', 'say X', 'how are you', etc.): use intent "general_chat" with tools [] and entities.symbols [].
- If the request is a general market, news, index, or recommendation query, do NOT include stock symbols from the session context in the entities.symbols list.
- ⚠️ CRITICAL: In "image_summary" or "summary" or any other string value in your JSON, NEVER use double quotes ("). If you need to quote a stock symbol, name, or index, use single quotes (') instead. This is extremely important to prevent JSON parsing syntax errors!
- ⚠️ FOR IMAGES: Count the visible stocks carefully and ensure your symbols array length matches the count
- Return ONLY the JSON, no extra text`;

    const recentHistoryText = (history || []).slice(-6).map((h: any) => `${h.role}: ${h.content}`).join("\n");
    const imageInstructions = hasImages 
        ? `\n\n⚠️⚠️⚠️ CRITICAL IMAGE EXTRACTION RULES ⚠️⚠️⚠️\n- You MUST extract EVERY stock symbol visible in the image\n- Count the stocks carefully: if you see 5 stocks, extract 5 symbols\n- Look at ALL rows in tables, ALL items in lists\n- Do NOT skip any visible stock information\n- Double-check you haven't missed any symbols before responding\n` 
        : "";
    const userPromptText = `Current Session:\n${JSON.stringify(session)}\n\nRecent History:\n${recentHistoryText}\n\nUser Request:\n${message || "Analyze input"}${imageInstructions}\n\n⚠️ CRITICAL instruction: You MUST return ONLY a valid JSON object starting with '{' and ending with '}'. Do NOT write any conversational text, explanations, or steps (like 'To analyze the image...'). Respond only with the JSON data.`;

    const plannerModels = hasImages 
        ? ["meta/llama-3.2-90b-vision-instruct", "meta/llama-3.2-11b-vision-instruct"] 
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
                        max_tokens: 800,
                        temperature: 0.05
                    })
                });

                if (res.ok) {
                    const json = await res.json();
                    const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                    
                    // ⚠️ DEBUG: Log vision model response for images
                    if (hasImages) {
                        console.log(`🔍 Vision Model (${modelName}) Raw Response:`, rawContent.substring(0, 300));
                        console.log(`🔍 Full Raw Content Length: ${rawContent.length} characters`);
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
                                    symbolsCount: parsed.entities?.symbols?.length || 0,
                                    image_summary_length: parsed.image_summary?.length || 0,
                                    image_summary_preview: parsed.image_summary?.substring(0, 150) || "EMPTY"
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
                        const symbolsTextExtracted = extractSymbolsFromText(message);
                        const rawSymbols = Array.isArray(parsed.entities?.symbols) 
                            ? parsed.entities.symbols 
                            : (parsed.session_update?.current_symbol ? [parsed.session_update.current_symbol] : []);

                        const symbols = Array.from(new Set([
                            ...rawSymbols.map((s: string) => correctStockSymbol(String(s).toUpperCase())),
                            ...symbolsTextExtracted
                        ]))
                        .filter((s: string) => VALID_SYMBOLS.includes(s))
                        .filter((s: string) => s !== "EXTRACTED_SYMBOL" && s !== "SYMBOL1" && s !== "PRIMARY_SYMBOL");

                        const isHistoryQuery = /سيره كام سهم|ذكرنا كام سهم|سيرة كام سهم|سياق المحادثة|تاريخ الشات|الملخص|قلنا ايه/i.test(message);
                        let finalIntent = parsed.intent || (hasImages ? "portfolio" : "general_chat");
                        if (isHistoryQuery) {
                            finalIntent = "general_chat";
                        } else if (symbols.length > 0 && finalIntent === "general_chat") {
                            finalIntent = "portfolio";
                        }

                        const isAggregateTableRequest = /كل البيانات|جدول|كل الأسهم|جدول بالشات|ملخص المحادثة/i.test(message);
                        const resolvedSymbols = finalIntent === "general_chat"
                            ? []
                            : (isAggregateTableRequest && session.last_symbols?.length 
                                ? Array.from(new Set([...symbols, ...session.last_symbols])) 
                                : symbols);

                        const toolsList: string[] = finalIntent === "general_chat" 
                            ? [] 
                            : (Array.isArray(parsed.tools) ? parsed.tools : []);
                        if (resolvedSymbols.length > 0 && !toolsList.includes("get_stock") && finalIntent !== "general_chat") {
                            toolsList.push("get_stock");
                        }

                        const imageSummary = parsed.image_summary || null;
                        const isValidVision = validateImageExtraction(imageSummary);

                        const result: PlannerResult = {
                            intent: finalIntent,
                            confidence: parsed.confidence || 0.95,
                            entities: {
                                symbols: resolvedSymbols,
                                sector: parsed.entities?.sector || null,
                                wants_table: Boolean(parsed.entities?.wants_table || isAggregateTableRequest || hasImages) && finalIntent !== "general_chat"
                            },
                            tools: Array.from(new Set(toolsList)),
                            image_summary: imageSummary || (hasImages ? "تحليل البيانات والصورة المرفقة من المحفظة." : null),
                            session_update: {
                                current_symbol: finalIntent === "general_chat" 
                                    ? session.current_symbol 
                                    : (parsed.session_update?.current_symbol 
                                        ? correctStockSymbol(parsed.session_update.current_symbol) 
                                        : resolvedSymbols[0] || session.current_symbol),
                                last_symbols: finalIntent === "general_chat"
                                    ? (session.last_symbols || [])
                                    : (Array.isArray(parsed.session_update?.last_symbols)
                                        ? parsed.session_update.last_symbols.map((s: string) => correctStockSymbol(String(s).toUpperCase()))
                                        : Array.from(new Set([...resolvedSymbols, ...(session.last_symbols || [])])).slice(0, 15)),
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

    const fallbackSymbols = hasImages ? [] : (session.current_symbol ? [correctStockSymbol(session.current_symbol)] : []);
    return {
        intent: hasImages ? "portfolio" : "general_chat",
        confidence: 0.8,
        entities: { symbols: fallbackSymbols, sector: null, wants_table: Boolean(hasImages) },
        tools: fallbackSymbols.length > 0 ? ["get_stock"] : [],
        image_summary: hasImages ? "تحليل البيانات والصورة المرفقة من المحفظة." : undefined,
        session_update: { 
            current_symbol: fallbackSymbols[0] || session.current_symbol, 
            last_symbols: session.last_symbols ? session.last_symbols.map((s: string) => correctStockSymbol(s)) : [], 
            summary: message 
        }
    };
}
