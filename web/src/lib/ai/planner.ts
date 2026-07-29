import { SessionState, PlannerResult } from "./types";
import { AI_CONFIG } from "./config";
import { createHash } from "crypto";
import { getSupabaseClient } from "@/lib/supabase/route-data";

let cachedStocks: Array<{ symbol: string; name: string }> | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

export interface StocksListData {
    stocksListStr: string;
    stockMappings: Record<string, string | string[]>;
}

// EGX30 Index Constituent Stocks (top 30 most liquid stocks on Egyptian Exchange)
// Cross-referenced with stocks available in our database
const EGX30_CONSTITUENTS: string[] = [
    'COMI',  // Commercial International Bank
    'TMGH',  // Talaat Moustafa Group
    'HRHO',  // EFG Hermes
    'EAST',  // Eastern Company
    'SWDY',  // El Sewedy Electric
    'EFIH',  // E-Finance
    'ABUK',  // Abu Qir Fertilizers
    'ETEL',  // Telecom Egypt
    'FWRY',  // Fawry
    'AMOC',  // Alexandria Mineral Oils
    'EGAL',  // Egypt Aluminum
    'PHDC',  // Palm Hills Development
    'CCAP',  // Qalaa Holdings
    'ORAS',  // Orascom Construction
    'ORHD',  // Orascom Development
    'ORWE',  // Oriental Weavers
    'SKPC',  // Sidi Kerir Petrochemicals
    'ESRS',  // Ezz Steel
    'CLHO',  // B Investments Holding
    'ISPH',  // Ibnsina Pharma
    'JUFO',  // Juhayna Food Industries
    'MNHD',  // Madinet Nasr Housing
    'MASR',  // Misr Italia Properties
    'HELI',  // Heliopolis Housing
    'CIRA',  // Cairo for Investment & Real Estate
    'EMFD',  // Emaar Misr
    'BTFH',  // Beltone Financial Holding
    'EKHO',  // Edita Food Industries
    'GBCO',  // GB Auto
    'EGAS',  // Egypt Gas
];

// Phrases that indicate user wants individual stocks of an index, not the index itself
const INDEX_TRIGGER_PHRASES = [
    /اسهم\s*(مؤشر|موشر|مأشر)\s*(التلاتين|الثلاثين|التلتين|ال30|30)/i,
    /اسهم\s*(ال|)مؤشر/i,
    /مكونات\s*(ال|)(مؤشر|موشر)/i,
    /كل\s*اسهم\s*(ال|)(مؤشر|موشر)/i,
    /(مؤشر|موشر)\s*(التلاتين|الثلاثين|التلتين|ال30|30)\s*(اسهم|أسهم)/i,
    /اسهم\s*(التلاتين|الثلاثين|التلتين)/i,
];

const ARABIC_NAME_MAPPINGS: Record<string, string | string[]> = {
    "تايكون": "TYCN",
    "تايكون القابضة": "TYCN",
    "اسكندرية": ["AMOC", "AFMC", "AIDC", "ALEX", "ALCN"],
    "الاسكندرية": ["AMOC", "AFMC", "AIDC", "ALEX", "ALCN"],
    "الاسكندريه": ["AMOC", "AFMC", "AIDC", "ALEX", "ALCN"],
    "الإسكندرية": ["AMOC", "AFMC", "AIDC", "ALEX", "ALCN"],
    "الاسكندرية للزيوت": "AMOC",
    "اسكندرية للزيوت": "AMOC",
    "أموك": "AMOC",
    "مطاحن الاسكندرية": "AFMC",
    "الاسكندرية للمطاحن": "AFMC",
    "اسكندرية للأدوية": "AIDC",
    "الاسكندرية للادوية": "AIDC",
    "الاسكندرية لتداول البضائع": "ALCN",
    "اسكندرية لتداول البضائع": "ALCN",
    "اسمنت الاسكندرية": "ALEX",
    "الاسكندرية للاسمنت": "ALEX",
    "الشرقية للدخان": "EAST",
    "ايسترن كومباني": "EAST",
    "إيسترن كومباني": "EAST",
    "ايسترن": "EAST",
    "غاز مصر": "EGAS",
    "ايجاس": "EGAS",
    "إيجاس": "EGAS",
    "البنك التجاري الدولي": "COMI",
    "التجاري الدولي": "COMI",
    "تجاري دولي": "COMI",
    "سوديك": "SODIC",
    "طلعت مصطفى": "TMGH",
    "مجموعة طلعت مصطفى": "TMGH",
    "فوري": "FWRY",
    "هيرميس": "HRHO",
    "إي فاينانس": "EFIH",
    "السويدي": "SWDY",
    "السويدى": "SWDY",
    "السويدي الكتريك": "SWDY",
    "ابوقير": "ABUK",
    "أبو قير": "ABUK",
    "أبوقير للأسمدة": "ABUK",
    "موبكو": "MFPC",
    "مصر لصناعة الكيماويات": "MICH",
    "مصر للالومنيوم": "EGAL",
    "سيدي كرير": "SKPC",
    "حديد عز": "ESRS",
    "بلتون": "BTFH",
    "القلعة": "CCAP",
    "مدينة نصر": "MNHD",
    "مدينة مصر": "MASR",
    "إعمار": "EMFD",
    "اعمار مصر": "EMFD",
    "المصرية للاتصالات": "ETEL",
    "اوراسكوم": "ORAS",
    "جهينة": "JUFO",
    "ابن سينا": "ISPH",
    "ابن سينا فارما": "ISPH",
    "القاهرة للدواجن": "POUL",
    "كابو": "KABO",
    "الحاويات": "ALCN",
    "حاويات": "ALCN",
    "حاويات الاسكندرية": "ALCN",
    "الاسكندرية للحاويات": "ALCN",
    "التنمية للاسكان": "HDBK",
    "التنميه للاسكان": "HDBK",
    "تنمية الاسكان": "HDBK",
    "العربية للاسمنت": "ARCC",
    "اسمنت بورتلاند": "SWPC",
    "النساجون الشرقيون": "ORWE",
    "النساجون": "ORWE",
    "بالم هيلز": "PHDC",
    "اوراسكوم للتنمية": "ORHD",
    "اوراسكوم كونستراكشن": "ORAS",
    "سي آي بي": "COMI",
    "البنك": "COMI",
    "بنك": "COMI",
    "البنك الأهلي": "NBKE",
    "مصر الجديدة للاسكان": "HELI",
    "مصر الجديده للاسكان": "HELI",
    "aihc": "AIH",
    "ايه اي اتش": "AIH",
    "اي اتش": "AIH",
    "العربية للاستثمارات": "AIH",
    "العربية للاستثمارات والتنمية": "AIH",
    "كوبر": "COPR",
    "cooper": "COPR",
    "كوين": "KWIN",
    "القاهرة الوطنية": "KWIN",
    "القاهرة الوطنية للاستثمار": "KWIN",
    "القاهرة دواجن": "POUL",
    "قاهرة للدواجن": "POUL",
    "دواجن القاهرة": "POUL",
    "poul": "POUL",
    "النيل": "NIPH",
    "نيل": "NIPH",
    "النيل للأدوية": "NIPH",
    "النيل للادويه": "NIPH",
    "النيل فارما": "NIPH",
    "النيل للحليج": "NCGC",
    "النيل حليج": "NCGC",
    "اسباير": "ASPI",
    "اسباير كابيتال": "ASPI",
    "aspire": "ASPI",
    "نهر الخير": "KRDI",
    "نهر الخير للتنمية": "KRDI",
    "krdi": "KRDI",
    "عبور": "OLFI",
    "عبور لاند": "OLFI",
    "العبور": ["OLFI", "OBRI"],
    "العبور لاند": "OLFI",
    "دومتي": "DMTY",
    "dmty": "DMTY",
    "فتنس": "FTNS",
    "فتنس برايم": "FTNS",
    "فتنس بريم": "FTNS",
    "ftns": "FTNS",
    "المنصورة": "MPCO",
    "المنصورة للدواجن": "MPCO",
    "منصورة للدواجن": "MPCO",
    "منصورة دواجن": "MPCO",
    "عامر": "AMER",
    "عامر جروب": "AMER",
    "amer": "AMER",
    "كرير": "SKPC",
    "كريست": "CRST",
    "كريست مارك": "CRST",
    "crst": "CRST"
};

async function getStocksList(): Promise<StocksListData> {
    const now = Date.now();
    if (!cachedStocks || (now - lastCacheTime > CACHE_TTL)) {
        try {
            const supabase = getSupabaseClient();
            const { data } = await supabase
                .from("stocks")
                .select("symbol, name")
                .eq("is_active", true);
            if (data && data.length > 0) {
                cachedStocks = data;
                lastCacheTime = now;
            }
        } catch (e) {
            console.warn("Failed to fetch stocks for planner cache", e);
        }
    }
    
    const stockMappings: Record<string, string | string[]> = { ...ARABIC_NAME_MAPPINGS };
    let stocksListStr = "";

    if (cachedStocks && cachedStocks.length > 0) {
        stocksListStr = cachedStocks
            .map(s => `- ${s.symbol}: ${s.name}`)
            .join("\n");
    }

    return { stocksListStr, stockMappings };
}

let cachedValidSymbols: string[] = [];
let lastSymbolsCacheTime = 0;

async function loadValidSymbols(): Promise<string[]> {
    const now = Date.now();
    if (cachedValidSymbols.length === 0 || (now - lastSymbolsCacheTime > CACHE_TTL)) {
        try {
            const supabase = getSupabaseClient();
            const { data } = await supabase
                .from("stocks")
                .select("symbol")
                .eq("is_active", true);
            if (data && data.length > 0) {
                cachedValidSymbols = data.map((s: any) => s.symbol.toUpperCase());
                lastSymbolsCacheTime = now;
            }
        } catch (e) {
            console.warn("Failed to fetch symbols from DB for validation cache", e);
        }
    }
    
    if (cachedValidSymbols.length === 0) {
        cachedValidSymbols = STATIC_VALID_SYMBOLS;
    }
    return cachedValidSymbols;
}

const STATIC_VALID_SYMBOLS = [
    'AALR', 'ABUK', 'ACAMD', 'ACAP', 'ADCI', 'ADPC', 'AFMC', 'AIH', 'AJWA', 'ALCN', 'ALUM', 'AMOC',
    'APPC', 'ARAB', 'AREH', 'ARVA', 'ATQA', 'AXPH', 'BIOC', 'BTFH', 'CCAP', 'CIEB', 'CIRA', 'CLHO',
    'CNFN', 'COMI', 'COPR', 'CPCI', 'CRST', 'EAST', 'EEII', 'EFID', 'EFIH', 'EGAL', 'EGAS', 'EGBE',
    'EGCH', 'EGREF', 'EGSA', 'EGTS', 'EGX30', 'EHDR', 'EITP', 'EKHO', 'ELKA', 'ELSH', 'EMFD', 'EOSB',
    'ESRS', 'ETEL', 'ETRS', 'FAIT', 'FERC', 'FWRY', 'GBCO', 'GDWA', 'GGCC', 'GGRN', 'GMCI', 'GOUR',
    'GSSC', 'HELI', 'HRHO', 'ICFC', 'IDRE', 'INFI', 'IRON', 'ISMA', 'ISPH', 'JUFO', 'KABO', 'KASABF',
    'KRDI', 'KZPC', 'LUTS', 'MASR', 'MBSC', 'MCQE', 'MENA', 'MFPC', 'MFSC', 'MICH', 'MILS', 'MNHD',
    'MOIL', 'MOSC', 'MPCO', 'MTIE', 'NEDA', 'NHPS', 'NINH', 'ORAS', 'ORHD', 'ORWE', 'PHDC', 'PHTV',
    'POUL', 'PRDC', 'RACC', 'RTVC', 'RUBX', 'SAUD', 'SCEM', 'SCTS', 'SEIG', 'SIPC', 'SKPC', 'SNFC',
    'SPIN', 'SWDY', 'TANM', 'TMGH', 'TRTO', 'TWSA', 'TYCN', 'UEFM', 'UNIT', 'USDEGP', 'VALU', 'VLMRA', 'WATP'
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

export function correctStockSymbol(symbol: string, validSymbols: string[]): string {
    const upperSym = symbol.trim().toUpperCase();
    if (validSymbols.includes(upperSym)) {
        return upperSym;
    }

    let bestMatch = upperSym;
    let minDistance = 2; // Maximum edit distance allowed

    for (const valid of validSymbols) {
        const dist = getLevenshteinDistance(upperSym, valid);
        if (dist < minDistance) {
            minDistance = dist;
            bestMatch = valid;
        }
    }

    return bestMatch;
}

export function extractSymbolsFromText(
    text: string, 
    validSymbols: string[], 
    stockMappings: Record<string, string | string[]> = {}
): string[] {
    const textUpper = text.toUpperCase();
    const found: string[] = [];

    // Check if user is asking about index constituent stocks
    const isIndexQuery = INDEX_TRIGGER_PHRASES.some(pattern => pattern.test(text));
    if (isIndexQuery) {
        // Return all EGX30 constituent stocks that exist in our database
        const validConstituents = EGX30_CONSTITUENTS.filter(s => validSymbols.includes(s));
        found.push(...validConstituents);
        return Array.from(new Set(found));
    }

    const tokens = textUpper.split(/[^A-Z0-9]/).map(t => t.trim()).filter(Boolean);
    for (const token of tokens) {
        if (validSymbols.includes(token)) {
            found.push(token);
        } else if (token.length >= 3) {
            const corrected = correctStockSymbol(token, validSymbols);
            if (corrected && validSymbols.includes(corrected) && corrected !== token) {
                found.push(corrected);
            }
        }
    }

    const normalizedText = text
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .toLowerCase();

    for (const [key, symbolOrArr] of Object.entries(stockMappings)) {
        const normalizedKey = key
            .replace(/[أإآ]/g, "ا")
            .replace(/ة/g, "ه")
            .toLowerCase();

        if (normalizedText.includes(normalizedKey)) {
            if (Array.isArray(symbolOrArr)) {
                found.push(...symbolOrArr);
            } else {
                found.push(symbolOrArr);
            }
        }
    }

    return Array.from(new Set(found)).filter(s => validSymbols.includes(s));
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
    const validSymbols = await loadValidSymbols();
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
    const { stocksListStr, stockMappings } = await getStocksList();
    const plannerSystemPrompt = `You are EGX Bots Master Planner for the Egyptian Stock Exchange.

${stocksListStr ? `=== ACTIVE EGX STOCKS IN DATABASE (Use this list to map Arabic or English stock queries to their exact symbols) ===
${stocksListStr}
=== END OF LIST ===` : ""}

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
- For accumulation or distribution queries (e.g. 'تجميع', 'تصريف', 'accumulation', 'distribution'): use intent "accumulation" with tools ["get_accumulation_stocks"]
- For greetings, general chat, or conversational requests (e.g. 'hello', 'say X', 'how are you', etc.): use intent "general_chat" with tools [] and entities.symbols [].
- If the request is a general market, news, index, or recommendation query, do NOT include stock symbols from the session context in the entities.symbols list.
- ⚠️ CRITICAL: In "image_summary" or "summary" or any other string value in your JSON, NEVER use double quotes ("). If you need to quote a stock symbol, name, or index, use single quotes (') instead. This is extremely important to prevent JSON parsing syntax errors!
- ⚠️ FOR IMAGES: Count the visible stocks carefully and ensure your symbols array length matches the count
- Return ONLY the JSON, no extra text`;

    const recentHistoryText = hasImages ? "" : (history || []).slice(-6).map((h: any) => `${h.role}: ${h.content}`).join("\n");
    const imageInstructions = hasImages 
        ? `\n\n⚠️⚠️⚠️ CRITICAL IMAGE EXTRACTION RULES ⚠️⚠️⚠️\n- Extract ONLY uppercase stock TICKERS (e.g. KRDI, ELEC, PHAR, MOED, MFPC, IEEC, PHDC, BIOC, DTPP, AMES, AJWA).\n- NEVER put prices, numeric values (e.g. 14,040.70, 7,700.00), or change percentages in the symbols array.\n- Look at the text next to logos, icons, or names for 2-5 letter stock TICKERS.\n- Count visible stocks carefully: if 7 stocks are shown, extract EXACTLY 7 stock TICKERS.\n` 
        : "";
    const sessionContext = hasImages ? "" : `Current Session:\n${JSON.stringify(session)}\n\nRecent History:\n${recentHistoryText}\n\n`;
    const userPromptText = `${sessionContext}User Request:\n${message || "Analyze input"}${imageInstructions}\n\n⚠️ CRITICAL instruction: You MUST return ONLY a valid JSON object starting with '{' and ending with '}'. Do NOT write any conversational text, explanations, or steps (like 'To analyze the image...'). Respond only with the JSON data.`;

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

    const officialKey = process.env.DEEPSEEK_OFFICIAL_API_KEY || "sk-7d19a8fd6cb943c3b71eaca8e55cef3b";
    if (officialKey && !hasImages) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), AI_CONFIG.limits.plannerTimeoutMs || 8000);
            const res = await fetch(AI_CONFIG.api.deepseekOfficialBaseUrl || "https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${officialKey}`
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: "deepseek-v4-flash",
                    messages: [
                        { role: "system", content: plannerSystemPrompt },
                        { role: "user", content: userPromptText }
                    ],
                    response_format: { type: "json_object" },
                    max_tokens: 1500,
                    temperature: 0.05
                })
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const json = await res.json();
                const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                let parsed: any = null;
                try { parsed = JSON.parse(rawContent); } catch {
                    const match = rawContent.match(/\{[\s\S]*\}/);
                    if (match) try { parsed = JSON.parse(match[0]); } catch {}
                }
                if (parsed && parsed.intent) {
                    const validSymbols = await loadValidSymbols();
                    const { stockMappings } = await getStocksList();
                    const extracted = extractSymbolsFromText(message || "", validSymbols, stockMappings);
                    const rawSymbols = Array.isArray(parsed.entities?.symbols) ? parsed.entities.symbols : [];
                    const normalizedSymbols = rawSymbols.map((s: string) => correctStockSymbol(s, validSymbols)).filter((s: string) => validSymbols.includes(s));
                    const finalSymbols = Array.from(new Set([...extracted, ...normalizedSymbols]));
                    return {
                        intent: parsed.intent || "stock_analysis",
                        confidence: parsed.confidence || 0.95,
                        entities: { symbols: finalSymbols, sector: parsed.entities?.sector || null, wants_table: parsed.entities?.wants_table ?? true, timeframe: parsed.entities?.timeframe || "1d" },
                        tools: Array.isArray(parsed.tools) ? parsed.tools : ["get_stock"],
                        session_update: { current_symbol: finalSymbols[0] || session?.current_symbol, last_symbols: finalSymbols.length > 0 ? finalSymbols : session?.last_symbols, summary: parsed.session_update?.summary || "" }
                    };
                }
            }
        } catch (err) {
            console.warn("DeepSeek Official Planner fetch failed, falling back to NVIDIA keys:", err);
        }
    }

    for (const key of apiKeys) {
        for (const modelName of plannerModels) {
            try {
                const controller = new AbortController();
                const timeoutMs = hasImages ? 25000 : (AI_CONFIG.limits.plannerTimeoutMs || 8000);
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                const reqBody: any = {
                    model: modelName,
                    messages: [
                        { role: "system", content: plannerSystemPrompt },
                        { role: "user", content: userContent }
                    ],
                    max_tokens: 1500,
                    temperature: 0.05
                };
                if (!hasImages) {
                    reqBody.response_format = { type: "json_object" };
                }

                const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${key}`
                    },
                    signal: controller.signal,
                    body: JSON.stringify(reqBody)
                });

                clearTimeout(timeoutId);

                if (res.ok) {
                    const json = await res.json();
                    const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                    
                    // ⚠️ DEBUG: Log vision model response for images
                    if (hasImages) {
                        console.log(`🔍 Vision Model (${modelName}) Raw Response:`, rawContent.substring(0, 300));
                        console.log(`🔍 Full Raw Content Length: ${rawContent.length} characters`);
                    }
                    
                    let parsed: any = null;
                    try {
                        parsed = JSON.parse(rawContent);
                    } catch {
                        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            try {
                                parsed = JSON.parse(jsonMatch[0]);
                            } catch (parseError) {
                                console.warn(`JSON parse error with model ${modelName}:`, parseError);
                            }
                        }
                    }

                    if (parsed) {
                        if (hasImages) {
                            console.log(`🔍 Vision Parsed Result:`, {
                                intent: parsed.intent,
                                symbols: parsed.entities?.symbols,
                                symbolsCount: parsed.entities?.symbols?.length || 0,
                                image_summary_length: parsed.image_summary?.length || 0,
                                image_summary_preview: parsed.image_summary?.substring(0, 150) || "EMPTY"
                            });
                        }

                        const fullVisionText = (rawContent || "") + " " + (parsed.image_summary || "");
                        const symbolsTextExtracted = hasImages 
                            ? extractSymbolsFromText(fullVisionText, validSymbols, stockMappings)
                            : extractSymbolsFromText(message, validSymbols, stockMappings);

                        const rawSymbols = Array.isArray(parsed.entities?.symbols) 
                            ? parsed.entities.symbols 
                            : (parsed.session_update?.current_symbol ? [parsed.session_update.current_symbol] : []);

                        const symbols = Array.from(new Set([
                            ...rawSymbols.map((s: string) => correctStockSymbol(String(s).toUpperCase(), validSymbols)),
                            ...symbolsTextExtracted
                        ]))
                        .filter((s: string) => validSymbols.includes(s))
                        .filter((s: string) => s !== "EXTRACTED_SYMBOL" && s !== "SYMBOL1" && s !== "PRIMARY_SYMBOL");

                        if (hasImages) {
                            console.log(`🖼️ Image symbols (vision-only, verified against validSymbols): [${symbols.join(', ')}] (${symbols.length} stocks)`);
                        }

                        const isFollowupQuery = /الاتنين|الإثنين|الاطنين|كلاهما|مع بعض|السهمين|تحليلهم|هاتهم|قولي عنهم|حللهم|بياناتهم|سعرهم|أخبارهم/i.test(message);
                        const isAggregateTableRequest = /كل البيانات|جدول|كل الأسهم|جدول بالشات|ملخص المحادثة/i.test(message);

                        let resolvedSymbols: string[] = [];
                        if (symbols.length > 0) {
                            resolvedSymbols = symbols;
                        } else if (!hasImages && (isFollowupQuery || isAggregateTableRequest) && session.last_symbols?.length) {
                            resolvedSymbols = session.last_symbols;
                        } else if (!hasImages && session.current_symbol) {
                            resolvedSymbols = [session.current_symbol];
                        } else if (!hasImages && session.last_symbols?.length) {
                            resolvedSymbols = session.last_symbols;
                        }

                        let finalIntent = parsed.intent || (hasImages ? "portfolio" : "general_chat");
                        const isHistoryQuery = /سيره كام سهم|ذكرنا كام سهم|سيرة كام سهم|سياق المحادثة|تاريخ الشات|الملخص|قلنا ايه/i.test(message);
                        
                        if (isHistoryQuery) {
                            finalIntent = "general_chat";
                        } else if (resolvedSymbols.length > 0 && finalIntent === "general_chat") {
                            finalIntent = "portfolio";
                        }

                        const toolsList: string[] = finalIntent === "general_chat" 
                            ? [] 
                            : (Array.isArray(parsed.tools) ? parsed.tools : []);
                        if (resolvedSymbols.length > 0 && !toolsList.includes("get_stock") && finalIntent !== "general_chat") {
                            toolsList.push("get_stock");
                        }

                        const imageSummary = hasImages ? (parsed.image_summary || "تحليل البيانات والصورة المرفقة من المحفظة.") : null;

                        const result: PlannerResult = {
                            intent: finalIntent,
                            confidence: parsed.confidence || 0.95,
                            entities: {
                                symbols: resolvedSymbols,
                                sector: parsed.entities?.sector || null,
                                wants_table: Boolean(parsed.entities?.wants_table || isAggregateTableRequest || hasImages) && finalIntent !== "general_chat"
                            },
                            tools: Array.from(new Set(toolsList)),
                            image_summary: imageSummary,
                            session_update: {
                                current_symbol: finalIntent === "general_chat" 
                                    ? session.current_symbol 
                                    : (parsed.session_update?.current_symbol 
                                        ? correctStockSymbol(parsed.session_update.current_symbol, validSymbols) 
                                        : resolvedSymbols[0] || session.current_symbol),
                                last_symbols: finalIntent === "general_chat"
                                    ? (session.last_symbols || [])
                                    : (Array.isArray(parsed.session_update?.last_symbols) && parsed.session_update.last_symbols.length > 0
                                        ? parsed.session_update.last_symbols.map((s: string) => correctStockSymbol(String(s).toUpperCase(), validSymbols))
                                        : Array.from(new Set([...resolvedSymbols, ...(session.last_symbols || [])])).slice(0, 15)),
                                summary: message || (hasImages ? "تحليل صورة" : null)
                            }
                        };

                        if (hasImages && imageSummary && imageKey) {
                            imageCache.set(imageKey, result);
                        }

                        return result;
                    }
                }
            } catch (e) {
                console.warn(`Planner model ${modelName} attempt warning:`, e);
            }
        }
    }

    const fallbackSymbols = hasImages ? [] : (session.current_symbol ? [correctStockSymbol(session.current_symbol, validSymbols)] : []);
    return {
        intent: hasImages ? "portfolio" : "general_chat",
        confidence: 0.8,
        entities: { symbols: fallbackSymbols, sector: null, wants_table: Boolean(hasImages) },
        tools: fallbackSymbols.length > 0 ? ["get_stock"] : [],
        image_summary: hasImages ? "تحليل البيانات والصورة المرفقة من المحفظة." : undefined,
        session_update: { 
            current_symbol: fallbackSymbols[0] || session.current_symbol, 
            last_symbols: session.last_symbols ? session.last_symbols.map((s: string) => correctStockSymbol(s, validSymbols)) : [], 
            summary: message 
        }
    };
}
