import { ARABIC_STOCK_MAPPINGS } from "./symbol-aliases";

import { SessionState, PlannerResult, VisionContext } from "./types";
import { AI_CONFIG } from "./config";
import { getDeepSeekApiKey } from "./server-secrets";
import { isBestBuyStockQuestion, isTermsDefinitionRequest } from "./intent-policy";
import { createHash } from "crypto";
import { executionFetch } from "./execution";
import { getSupabaseClient } from "@/lib/supabase/route-data";

let cachedStocks: Array<{ symbol: string; name: string; name_ar?: string | null }> | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 1000 * 60 * 60 * 24;

export interface StocksListData {
    stocksListStr: string;
    stockMappings: Record<string, string | string[]>;
}

const EGX30_CONSTITUENTS: string[] = [
    'COMI', 'TMGH', 'HRHO', 'EAST', 'SWDY', 'EFIH',
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

export async function getStocksList(): Promise<StocksListData> {
    const now = Date.now();
    if (!cachedStocks || (now - lastCacheTime > CACHE_TTL)) {
        try {
            const supabase = getSupabaseClient();
            const { data } = await supabase
                .from("stocks")
                .select("symbol, name, name_ar")
                .eq("exchange", "EGX")
                .eq("is_active", true);
            if (data && data.length > 0) {
                cachedStocks = data;
                lastCacheTime = now;
            }
        } catch (e) {
            console.warn("Failed to fetch stocks for planner cache", e);
        }
    }
    
    const stockMappings: Record<string, string | string[]> = { ...ARABIC_STOCK_MAPPINGS };
    for (const stock of cachedStocks || []) {
        const nameEn = stock.name?.trim();
        if (nameEn) stockMappings[nameEn] = stock.symbol.toUpperCase();
        String(stock.name_ar || "").split(/[,،|/]/).map(name => name.trim()).filter(Boolean).forEach(name => { stockMappings[name] = stock.symbol.toUpperCase(); });
    }
    let stocksListStr = "";

    if (cachedStocks && cachedStocks.length > 0) {
        stocksListStr = cachedStocks
            .map(s => `- ${s.symbol}: ${s.name}`)
            .join("\n");
    }

    return { stocksListStr, stockMappings };
}

export function getSyncStockMappings(): Record<string, string | string[]> {
    const stockMappings: Record<string, string | string[]> = { ...ARABIC_STOCK_MAPPINGS };
    for (const stock of cachedStocks || []) {
        const nameEn = stock.name?.trim();
        if (nameEn) stockMappings[nameEn] = stock.symbol.toUpperCase();
        String(stock.name_ar || "").split(/[,،|/]/).map(name => name.trim()).filter(Boolean).forEach(name => { stockMappings[name] = stock.symbol.toUpperCase(); });
    }
    return stockMappings;
}

let cachedValidSymbols: string[] = [];
let lastSymbolsCacheTime = 0;
export async function loadValidSymbols(): Promise<string[]> {
    const now = Date.now();
    if (cachedValidSymbols.length === 0 || (now - lastSymbolsCacheTime > CACHE_TTL)) {
        try {
            const supabase = getSupabaseClient();
            const { data } = await supabase
                .from("stocks")
                .select("symbol")
                .eq("is_active", true);
            if (data && data.length > 0) {
                const dbSymbols = data.map((s: any) => s.symbol.toUpperCase());
                cachedValidSymbols = Array.from(new Set([...dbSymbols, ...STATIC_VALID_SYMBOLS]));
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

// Synchronous view of the known-symbol universe (DB cache + stocks cache + static
// fallback). Used to reject Latin tickers that match no listed stock (e.g. FTNS)
// so they never scope tools or leak into session state.
export function getSyncValidSymbols(): string[] {
    const symbols = new Set<string>(STATIC_VALID_SYMBOLS);
    if (cachedValidSymbols.length > 0) {
        cachedValidSymbols.forEach(s => symbols.add(s));
    }
    if (cachedStocks && cachedStocks.length > 0) {
        cachedStocks.forEach((s: any) => {
            if (s.symbol) symbols.add(String(s.symbol).toUpperCase());
        });
    }
    return Array.from(symbols);
}

export function getSyncSymbolOfficialNameMap(): Record<string, { name_en?: string; name_ar?: string }> {
    const map: Record<string, { name_en?: string; name_ar?: string }> = {
        TALM: { name_en: "Taaleem Management Services", name_ar: "تعليم لخدمات الإدارة" },
        AFMC: { name_en: "Alexandria Flour Mills", name_ar: "مطاحن ومخابز الإسكندرية" },
        TMGH: { name_en: "Talaat Moustafa Group Holding", name_ar: "مجموعة طلعت مصطفى القابضة" },
        COMI: { name_en: "Commercial International Bank", name_ar: "البنك التجاري الدولي" },
        EAST: { name_en: "Eastern Company", name_ar: "الشرقية - إيسترن كومباني" },
        PHAR: { name_en: "EIPICO", name_ar: "المصرية الدولية للصناعات الدوائية - إيبيكو (PHAR)" },
        INFI: { name_en: "Ismailia National Food Industries - Foodico", name_ar: "الإسماعيلية الوطنية للصناعات الغذائية - فوديكو (INFI)" },
        BIOC: { name_en: "GlaxoSmithKline S.A.E.", name_ar: "جلاكسو سميث كلاين مصر (BIOC)" },
        LUTS: { name_en: "LUTS for Tourism", name_ar: "لوتس للسياحة (LUTS)" },
        GTWL: { name_en: "Golden Textiles & Clothes Wool", name_ar: "جولدن للمنسوجات والملابس الصوفية (GTWL)" },
        COPR: { name_en: "Cooper for Commercial Investment", name_ar: "كوبر للاستثمار التجاري والعقاري (COPR)" },
        MPCO: { name_en: "Mansourah Poultry Co.", name_ar: "المنصورة للدواجن (MPCO)" },
        ASPI: { name_en: "Aspire Capital Holding for Financial Investments", name_ar: "أسباير كابيتال القابضة" },
        NARE: { name_en: "Naeem Real Estate Holding Group", name_ar: "مجموعة النعيم العقارية القابضة" },
        NAHO: { name_en: "Naeem Holding Co.", name_ar: "النعيم القابضة للاستثمارات المالية" },
        IEEC: { name_en: "Industrial & Engineering Enterprises Co.", name_ar: "المشروعات الصناعية والهندسية" },
        IEOC: { name_en: "Industrial and Engineering Projects", name_ar: "المشروعات الصناعية والهندسية" },
        FCMD: { name_en: "Future Care Medical", name_ar: "فيوتشر كير للصناعات الطبية" },
        AALR: { name_en: "General Co. for Land Reclamation", name_ar: "الشركة العامة لاستصلاح الأراضي" },
        EFIC: { name_en: "Egyptian Financial & Industrial", name_ar: "المالية والصناعية المصرية" },
        KORA: { name_en: "Korra Energie", name_ar: "شركة قرة للطاقة" }
    };
    if (cachedStocks && cachedStocks.length > 0) {
        cachedStocks.forEach((s: any) => {
            if (s.symbol) {
                const sym = String(s.symbol).toUpperCase();
                map[sym] = {
                    name_en: s.name?.trim() || map[sym]?.name_en,
                    name_ar: s.name_ar?.trim() || map[sym]?.name_ar
                };
            }
        });
    }
    return map;
}

const STATIC_VALID_SYMBOLS = [
    'AALR', 'ABUK', 'ACAMD', 'ACAP', 'ACGC', 'ACRO', 'ACTF', 'ADCI', 'ADIB', 'ADPC', 'AFDI', 'AFMC', 'AGIG', 'AIDC', 'AIH',
    'AIND', 'AITG', 'AIVCB', 'AJWA', 'ALCN', 'ALEX', 'ALRA', 'ALUM', 'AMER', 'AMES', 'AMIA', 'AMOC', 'ANFI', 'APPC', 'APSW',
    'ARAB', 'ARCC', 'AREH', 'AREHA', 'ARVA', 'ASCM', 'ASPI', 'ATLC', 'ATQA', 'AUTO', 'AXPH', 'BINV', 'BIOC', 'BONY', 'BTFH',
    'CAED', 'CANA', 'CCAP', 'CCRS', 'CEFM', 'CERA', 'CFGH', 'CICH', 'CIEB', 'CIRA', 'CIRF', 'CLHO', 'CNFN', 'COMI', 'COPR',
    'COSG', 'CPCI', 'CPME', 'CRST', 'CSAG', 'DAPH', 'DCRC', 'DEIN', 'DGTZ', 'DOMT', 'DSCW', 'DTPP', 'EALR', 'EASB', 'EAST',
    'EBSC', 'ECAP', 'EDBM', 'EDFM', 'EEII', 'EFIC', 'EFID', 'EFIH', 'EFMP', 'EGAL', 'EGAS', 'EGBE', 'EGCH', 'EGREF', 'EGSA',
    'EGTS', 'EGX100', 'EGX30', 'EHDR', 'EITP', 'EIUD', 'ELEC', 'ELKA', 'ELNA', 'ELSH', 'EMFD', 'EMRI', 'ENGC', 'EOSB',
    'EPCO', 'EPPK', 'ESGI', 'ESRS', 'ETEL', 'ETRS', 'EXPA', 'FAIT', 'FAITA', 'FCMD', 'FERC', 'FWRY', 'GBCO', 'GDWA', 'GGCC',
    'GGRN', 'GIHD', 'GMCI', 'GOCO', 'GOUR', 'GPIM', 'GPPL', 'GRCA', 'GSPC', 'GSSC', 'GTEX', 'GTHE', 'GTWL', 'HDBK', 'HELI',
    'HRHO', 'ICAL', 'ICFC', 'ICID', 'ICLE', 'IDHC', 'IDRE', 'IEEC', 'IEOC', 'IFAP', 'INFI', 'IPPM', 'IRAX', 'IRON', 'ISMA',
    'ISMQ', 'ISPH', 'JUFO', 'KABO', 'KASABF', 'KORA', 'KRDI', 'KWIN', 'KZPC', 'LCSW', 'LUTS', 'MAAL', 'MASR', 'MATD', 'MBEG',
    'MBSC', 'MCQE', 'MCRO', 'MEDP', 'MEGM', 'MENA', 'MEPA', 'MFIN', 'MFPC', 'MFSC', 'MHOT', 'MICH', 'MILS', 'MIPH', 'MOED',
    'MOIL', 'MOIN', 'MOSC', 'MPCI', 'MPCO', 'MPRC', 'MRCO', 'MTIE', 'NAHO', 'NAPR', 'NARE', 'NASR', 'NBKE', 'NCCW', 'NCEM',
    'NCGC', 'NCIN', 'NCMP', 'NDRL', 'NEDA', 'NHPS', 'NINH', 'NIPH', 'NOAF', 'OBRI', 'OCDI', 'OCPH', 'ODHN', 'ODID', 'ODIN',
    'OFH', 'OIH', 'OLFI', 'ORAS', 'OREG', 'ORHD', 'ORMT', 'ORWE', 'PACH', 'PHAR', 'PHDC', 'PHGC', 'PHTV', 'PIOH', 'POUL',
    'PRCL', 'PRDC', 'PRMH', 'QNBA', 'QNBE', 'RACC',     'RAKT', 'RAYA', 'RKAZ', 'RMDA', 'RMTV', 'ROTO', 'RREI', 'RTVC', 'RUBX', 'SAIB',
    'SAUD', 'SBAG', 'SCEM', 'SCFM', 'SCTS', 'SDTI', 'SEIG', 'SEIGA', 'SIMO', 'SIPC', 'SKPC', 'SMCS', 'SMCSA', 'SMFR', 'SMPP',
    'SNFC', 'SPHT', 'SPIN', 'SPMD', 'SRWA', 'SUCE', 'SUGR', 'SVCE', 'SWDY', 'TALM', 'TANM', 'TAQA', 'TMGH', 'TORA', 'TOUR',
    'TRTO', 'TWSA', 'TYCN', 'UASG', 'UBEE', 'UEFM', 'UEGC', 'UNBE', 'UNIP', 'UNIT', 'USDEGP', 'UTOP', 'VALU', 'VLMRA', 'WACE',
    'WATP', 'WCDF', 'WKOL', 'ZEOT', 'ZMID'
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

export const LATIN_TICKER_ALIASES: Record<string, string> = {
    "CIB": "COMI",
    "IECC": "IEEC",
    "IICC": "IEEC",
    "IEOC": "IEEC",
    "IICE": "IEEC",
    // Users type the fund's short name or the TradingView display name; map
    // both to the DB tickers (day-14 live chat: "Kasab" and "KorRa").
    "KASAB": "KASABF",
    "KORRA": "KORA",
};

export function correctStockSymbol(symbol: string, validSymbols: string[]): string {
    const upperSym = symbol.trim().toUpperCase();
    if (LATIN_TICKER_ALIASES[upperSym]) {
        return LATIN_TICKER_ALIASES[upperSym];
    }
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
        if (["KING", "EGX", "RSI", "MACD", "SMA", "EMA", "ADX", "VWAP", "ML", "AI"].includes(token)) continue;
        if (LATIN_TICKER_ALIASES[token]) {
            found.push(LATIN_TICKER_ALIASES[token]);
        } else if (validSymbols.includes(token)) {
            found.push(token);
        } else if (token.length >= 3) {
            const corrected = correctStockSymbol(token, validSymbols);
            if (corrected && validSymbols.includes(corrected) && corrected !== token) {
                found.push(corrected);
            }
        }
    }

    let normalizedText = text
        .replace(/[\u064B-\u065F\u0670]/g, "")
        .replace(/\u0640/g, "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .toLowerCase();

    const mergedMappings = { ...ARABIC_STOCK_MAPPINGS, ...stockMappings };
    // Use regex with Arabic/Latin word boundaries to avoid substring false positives
    for (const [key, symbolOrArr] of Object.entries(mergedMappings).sort((a, b) => b[0].length - a[0].length)) {
        const normalizedKey = key
            .replace(/[\u064B-\u065F\u0670]/g, "")
            .replace(/\u0640/g, "")
            .replace(/[أإآ]/g, "ا")
            .replace(/ة/g, "ه")
            .replace(/ى/g, "ي")
            .toLowerCase();

        // Escape regex special characters in the key
        const escapedKey = normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(?:^|[^a-z0-9\u0621-\u064a\u0671-\u06d3])(?:و|ف|ب|ل|ك|ال)?${escapedKey}(?:$|[^a-z0-9\u0621-\u064a\u0671-\u06d3])`, "i");
        if (regex.test(normalizedText)) {
            if (Array.isArray(symbolOrArr)) {
                found.push(...symbolOrArr);
            } else {
                found.push(symbolOrArr);
            }
            normalizedText = normalizedText.replace(normalizedKey, " ".repeat(normalizedKey.length));
        }
    }

    return Array.from(new Set(found)).filter(s => validSymbols.includes(s));
}

// Arabic words that strongly indicate a listed-company name (e.g. "التعمير والاستشارات").
// Used to detect when the user asks about a company we could NOT map to a symbol,
// so we do NOT silently reuse the previous conversation symbol.
const COMPANY_NAME_HINT_PATTERN = /(?:تعمير|استشار|اسكان|إسكان|مقاولات|صناعات|قابضة|قابضه|مساهمات|منتجعات|فنادق|مطاحن|مخابز|دواجن|صوامع|بتروكيماويات|استصلاح|أدوية|ادويه|غذائية|غذائيه|طبية|طبيه|زراعية|زراعيه|هندسية|هندسيه|سياحية|سياحيه|عقاري|استثماري|للاستثمار|للاستشارات|للتعمير|للاسكان|للمقاولات|للصناعات|مطاحن ومخابز)/i;
const SECTOR_OR_MARKET_QUERY_PATTERN = /(قطاع|القطاعات|أسهم|اسهم|الشركات|السوق|البورصة|البورصه|أفضل|افضل|مين|توصيات|توصية|توصيه|سيولة|سيوله|تجميع|تصريف|مؤشر|المؤشرات|دولار|ذهب|صناديق|محفظة|محفظه|أخبار|اخبار|إيرادات|ايرادات|أرباح|ارباح|تعريف|ايه معنى|ما معنى)/i;

export function isUnresolvedCompanyNameMention(message: string, extractedSymbols: string[]): boolean {
    if (!message || extractedSymbols.length > 0) return false;
    if (SECTOR_OR_MARKET_QUERY_PATTERN.test(message)) return false;
    return COMPANY_NAME_HINT_PATTERN.test(message);
}

// In-Memory Image Cache - DISABLED for better accuracy
const imageCache = new Map<string, PlannerResult>();
const ENABLE_IMAGE_CACHE = false; // 🔧 Disabled to force fresh analysis
const PLANNER_TOOLS = new Set([
    "get_stock", "get_news", "get_corporate_actions", "get_recommendations", "get_sector", "get_sector_list",
    "get_market", "get_accumulation_stocks", "get_distribution_stocks", "get_technical_scan", "get_comparison", "search_web",
    "get_stock_levels", "get_price_history", "manage_portfolio", "get_sector_liquidity", "get_signals", "get_fair_value_scan",
]);
const REQUIRED_FACT_TOOLS: Record<string, string[]> = {
    stock_quote: ["get_stock"], technical_indicators: ["get_stock"], price_levels: ["get_stock", "get_stock_levels"],
    news: ["get_news"], corporate_actions: ["get_corporate_actions"], liquidity: [],
    accumulation: ["get_accumulation_stocks"], distribution: ["get_distribution_stocks"], market_summary: ["get_market"],
    recommendations: ["get_recommendations"], historical_prices: ["get_price_history"], portfolio_positions: ["manage_portfolio"],
};

export function buildPlannerDialogueContext(session: SessionState, history: any[]): string {
    const sessionSnapshot = {
        current_symbol: session.current_symbol,
        last_symbols: session.last_symbols,
        current_sector: (session as any).current_sector,
        summary: session.summary,
        last_topic: (session as any).last_topic,
    };
    const recentHistoryText = (history || []).slice(-8)
        .map((item: any) => `${String(item.role || "unknown").slice(0, 12)}: ${String(item.content || "").slice(0, 1400)}`)
        .join("\n");
    return `Current Session State:\n${JSON.stringify(sessionSnapshot)}\n\nRecent Dialogue (oldest to newest):\n${recentHistoryText || "(no prior turns)"}`;
}

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
    apiKeys: string[],
    vision?: VisionContext | null
): Promise<PlannerResult> {
    const validSymbols = await loadValidSymbols();
    const visionProvided = !!vision;
    const hasImages = imageList && imageList.length > 0 && !visionProvided;

    // Image Caching Check - DISABLED for fresh analysis
    const imageKey = hasImages ? createHash("sha256").update(imageList[0]).digest("hex") : "";
    if (hasImages && imageKey && ENABLE_IMAGE_CACHE && imageCache.has(imageKey)) {
        console.log("🔄 Using cached image analysis (Cache is DISABLED by default)");
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

${visionProvided ? `=== PRE-ANALYZED IMAGE CONTEXT ===
Image type: ${vision.image_type}
Symbols found: ${vision.symbols.map(s => s.symbol).join(", ") || "none"}
Summary: ${vision.user_relevant_summary || "none"}
=== END IMAGE CONTEXT ===
` : hasImages ? `**ANALYZE THE IMAGE CAREFULLY:**
CRITICAL INSTRUCTIONS:
1. Extract ALL stock symbols visible in the image - do NOT miss any symbols.
2. Look at EVERY row, cell, and section of the financial image.
3. For each stock symbol, extract the exact values, numbers, and percentages shown next to it (such as the portfolio position value, current price, change amount, and change percentage).
4. Include all of these details (symbols, prices, values, changes) in a clear table format or list inside the "image_summary" field so that the final text model can read them.
5. ⚠️ IMPORTANT: Ignore any stock symbols mentioned in 'Current Session' or 'Recent History' unless they are clearly visible in the new image itself.
6. Provide a detailed Arabic description of ALL financial content visible in the image in the "image_summary" field.

EXAMPLE: If you see 4 stocks in the image, you MUST extract all 4 symbols, and list the exact prices and values for each in the "image_summary" description.

` : ""}**AVAILABLE TOOLS:**
- "get_stock": Fetches live price, volume, change %, RSI, MACD, and SMA data for specific stock symbol(s). Use when the user asks for analysis, price, support, resistance, technical indicators, or general info about specific stock(s).
- "get_news": Fetches recent news headlines, articles, and sentiment scores. Use when the user asks for news (أخبار), announcements, or sentiment.
- "get_corporate_actions": Fetches corporate action events (حقوق اكتتاب، توزيعات أرباح/كوبون، تجزئة السهم، أسهم مجانية/منحة، زيادة أو تخفيض رأس المال، إعادة شراء، استحواذ). Use when the user asks about اكتتاب، توزيعات، كوبون، تجزئة، منحة، أو أي حدث مالي مؤثر على سهم معين. Combine with "get_stock" when the user wants the event's effect on the stock.
- "get_recommendations": Fetches algorithmic buy/sell recommendations. Use when the user explicitly asks for recommendations, buying advice, or signals (e.g. 'تنصحني', 'أشتري', 'توصيات').
- "get_sector": Fetches aggregated technical and fundamental data for a SPECIFIC market sector (e.g., 'البنوك', 'الأدوية', 'العقارات'). Do NOT use if the user asks for a list of sectors without specifying a sector name.
- "get_sector_list": Fetches the full list of available market sectors and stock counts. Use when the user asks for a list of sectors or all sectors (e.g., 'عندك كام قطاع', 'عدد القطاعات', 'إيه القطاعات المتاحة', 'قائمة القطاعات', 'قايمه بالقطاعات', 'هات قايمه بالقطاعات', 'القطاعات', 'كل القطاعات').
- "get_market": Fetches overall market summary, EGX30/EGX70 index data, and top gainers/losers. Use when the user asks about the overall market, index, or general liquidity (e.g. 'حالة السوق', 'ايه اللي طلع', 'السوق').
- "get_accumulation_stocks": Fetches a list of stocks currently in Wyckoff accumulation/distribution phases. Use when the user asks about 'تجميع', 'تصريف', 'سيولة مؤسسية', 'accumulation', 'Wyckoff', 'وايكوف', 'WYCOFF', 'إليوت', 'إليوت فيز', 'Elliot phase', 'Elliott Wave', 'موجات إليوت', 'المرحلة', 'phase'. When a user asks for Wyckoff or Elliott analysis on specific stocks, use BOTH "get_stock" AND "get_accumulation_stocks" together.
- "get_technical_scan": Fetches stocks matching market screener technical filters & templates. Presets:
  * "macd_cross": MACD golden cross above EMA 50 (التقاطع الذهبي لـ MACD).
  * "rsi_oversold": RSI below 35 oversold reversal zone (منطقة ذروة البيع RSI).
  * "volume_breakout": Volume breakout above 20-day average (اختراق حجم التداول).
  * "sma_200_breakout": Price breaking above 200-day moving average (اختراق الاتجاه طويل المدى).
  * "smart_money_flow": Institutional smart money flow accumulation (تدفق الأموال الذكية).
  * "rsi_bullish_divergence": Bullish RSI divergence reversal (صعودي RSI تباعد).
  * "bearish_divergence_alert": Bearish divergence warning (تنبيه تباعد هبوطي).
  * "bollinger_lower_touch" / "bollinger_upper_touch": Daily low-high range touches the lower/upper Bollinger band for the same session. Never replace an unsupported indicator criterion with MACD.
  Use when user asks about any of these screener templates or technical indicator filters across the market.

- "get_comparison": Fetches data to compare two or more stocks. Use when the user explicitly asks to compare stocks (e.g., 'مقارنة بين', 'أيهما أفضل').
- "manage_portfolio": Views or analyzes the user's investment portfolio positions, quantities, profits, or cash. Use when the user asks about their portfolio (محفظتي، أسهمي، مراكزي، أرباحي، رصيدي).
- "search_web": Searches the internet for information that is NOT available in the database (general knowledge, companies/events outside the market data, recent happenings, or when the user explicitly asks to search the internet e.g. 'ابحث في النت', 'دور على الإنترنت'). Use only when the requested information cannot come from stock/market/news database tools.

**YOUR TASK:**
Analyze the user request and return a JSON object. You MUST dynamically choose the correct "tools" array based on the AVAILABLE TOOLS above. Combine multiple tools if necessary (e.g., ["get_stock", "get_news"] if the user asks for analysis and news).

**JSON STRUCTURE TO RETURN:**
{
  "intent": "Brief string describing intent (e.g., stock_analysis, sector_analysis, market_summary, technical_scan, general_chat)",
  "confidence": 0.95,
  "guidance_intent": null,
  "entities": {
    "symbols": ["SYMBOL1", "SYMBOL2"], // EXACT stock tickers in uppercase (e.g. COMI). Empty array if none.
    "sector": "Arabic Sector Name", // e.g. "بنوك", "عقارات". Null if none.
    "wants_table": false, // Set to true if user wants a table
    "scan_direction": null, // Set to "accumulation" or "distribution" if requested, else null
    "min_acc_score": null, // Numeric STRICT lower bound for accumulation score, only if requested
    "min_vol_ratio": null, // Numeric STRICT lower bound for RELATIVE volume, never a cash amount
    "max_dist_score": null, // Numeric inclusive upper bound for distribution score; 0 means no distribution
    "min_consecutive_acc_days": null, // Numeric inclusive lower bound for consecutive accumulation days, not holding period
    "technical_preset": null, // Set to "macd_cross" | "rsi_oversold" | "volume_breakout" | "sma_200_breakout" | "smart_money_flow" | "rsi_bullish_divergence" | "bearish_divergence_alert" if asking for a technical scan, else null
    "timeframe": null
  },
  "tools": ["ToolName1", "ToolName2"], // EXACT tool names selected from AVAILABLE TOOLS. [] for general_chat.
  "request": {
    "answer_kind": "decision_comparison|comparison|explanation|fact", // decision_comparison for choosing the better candidate; comparison for a data table only
    "goal": "short description of what the user wants",
    "reference": "explicit|portfolio|previous_turn|market|none",
    "ranking_metric": "price_change|liquidity|accumulation|fundamentals|unspecified",
                            "required_facts": ["stock_quote|technical_indicators|price_levels|news|corporate_actions|liquidity|accumulation|distribution|market_summary|recommendations|historical_prices|portfolio_positions"],
    "clarification_reason": null
  },
  "clarification_needed": false,
  "clarification_options": [],
  "image_summary": null,
  "session_update": {
    "current_symbol": "SYMBOL1",
    "last_symbols": ["SYMBOL1", "SYMBOL2"],
    "summary": "Brief summary of request"
  }
}

**CRITICAL RULES:**
- If the user asks about a sector (e.g. 'قطاع الأدوية'), you MUST extract the Arabic sector name into entities.sector (e.g. 'أدوية').
- For historical recall queries ('الرقم اللي قولته قبل كده', 'التحليل اللي فات'): use intent "historical_recall" with tools [].
- For conversational/greeting queries: use intent "general_chat" with tools [].
- For beginners, savings, brokerage products, or portfolio allocation: set guidance_intent to onboarding, allocation, product_comparison, or product_explainer. Do not fetch recommendations until goals, horizon, liquidity, and risk tolerance are known.
- Thndr/ثندر is a brokerage platform in phrases like 'أستثمر في ثندر'; it is not a stock or a slang signal for explosive price movement.
- Do not select recommendation tools merely because the request says 'فرص' or 'النهارده'. Use them only for explicit recorded recommendations/signals.
- MULTI-TURN CONVERSATIONAL CONTINUITY: If the user request is a follow-up, choice, or contains a pronoun (e.g. 'ده', 'فيه', 'فيهم', 'الاتنين', 'وريني السيولة', 'أفضل واحد'): resolve the intended stock and context from Recent Dialogue and Current Session State. NEVER claim the request is vague or ask for clarification if the prior turn makes the context clear.
- ⚠️ CRITICAL IMAGE RULE: If an image is uploaded (hasImages is true), prioritize image analysis. Extract all visible tickers into entities.symbols, set intent to "portfolio" or "chart_analysis", and set tools to ["get_stock"].
- NEVER use double quotes (") inside string values like image_summary. Use single quotes (').
- Return ONLY valid JSON, starting with '{' and ending with '}'.`;

    // Every turn gets a bounded dialogue window. Pronoun regexes are not a
    // reliable gate for context: "أول ٥ أسهم" and "أفضل واحد فيهم" are
    // meaningful only in light of the preceding turn, even without a pronoun.
    const imageInstructions = visionProvided
        ? ""
        : (hasImages
        ? `\n\n⚠️ UNRESTRICTED EXPERT VISION EXTRACTION ⚠️\n- Thoroughly inspect the uploaded image(s) using full multimodal vision capabilities.\n- If the image contains portfolio holdings, OCR and extract ALL visible uppercase stock tickers.\n- If the image contains technical charts, diagrams, or financial documents: describe every detail, pattern, technical indicator, price target, support/resistance level, and trend visible in image_summary.\n` 
        : "");
    const sessionContext = !hasImages && !visionProvided
        ? `${buildPlannerDialogueContext(session, history)}\n\n`
        : "";
    const userPromptText = `${sessionContext}User Request:\n${message || "Analyze input"}${imageInstructions}\n\n⚠️ CRITICAL instruction: You MUST return ONLY a valid JSON object starting with '{' and ending with '}'. Do NOT write any conversational text, explanations, or steps (like 'To analyze the image...'). Respond only with the JSON data.`;

    const plannerModels = hasImages
        ? AI_CONFIG.models.planner.vision 
        : AI_CONFIG.models.planner.text;

    // 🚀 MULTI-IMAGE HANDLER: Execute parallel single-image vision calls to bypass NVIDIA 1-image-per-prompt API limit
    if (hasImages && imageList.length > 1) {
        console.log(`🖼️ Multi-image detected (${imageList.length} images). Executing parallel single-image vision extraction...`);
        const allExtractedSymbols: string[] = [];
        const validSymbols = await loadValidSymbols();
        
        await Promise.all(imageList.map(async (imgUrl) => {
            for (const key of apiKeys) {
                for (const modelName of plannerModels) {
                    let timeoutId: ReturnType<typeof setTimeout> | undefined;
                    try {
                        const controller = new AbortController();
                        timeoutId = setTimeout(() => controller.abort(), 25000);
                        const singleUserContent = [
                            { type: "text", text: userPromptText },
                            { type: "image_url", image_url: { url: imgUrl } }
                        ];
                        const res = await executionFetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${key}`
                            },
                            signal: controller.signal,
                            body: JSON.stringify({
                                model: modelName,
                                messages: [
                                    { role: "system", content: plannerSystemPrompt },
                                    { role: "user", content: singleUserContent }
                                ],
                                max_tokens: 1500,
                                temperature: 0.05
                            })
                        });
                        if (res.ok) {
                            const json = await res.json();
                            const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                            let parsed: any = null;
                            try { parsed = JSON.parse(rawContent); } catch {
                                const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                                if (jsonMatch) try { parsed = JSON.parse(jsonMatch[0]); } catch {}
                            }
                            if (parsed && parsed.entities && Array.isArray(parsed.entities.symbols)) {
                                parsed.entities.symbols.forEach((sym: string) => {
                                    const corr = correctStockSymbol(sym, validSymbols);
                                    if (corr && validSymbols.includes(corr)) allExtractedSymbols.push(corr);
                                });
                                return; // success for this image
                            }
                        }
                    } catch {} finally {
                        if (timeoutId) clearTimeout(timeoutId);
                    }
                }
            }
        }));

        const finalMultiSymbols = Array.from(new Set(allExtractedSymbols));
        console.log(`🖼️ Multi-image combined symbols (${finalMultiSymbols.length}):`, finalMultiSymbols);
        return {
            intent: "portfolio",
            confidence: 0.95,
            entities: { symbols: finalMultiSymbols, sector: null, wants_table: true, timeframe: "1d" },
            tools: ["get_stock"],
            session_update: { current_symbol: finalMultiSymbols[0] || null, last_symbols: finalMultiSymbols, summary: `Multi-image analysis of ${imageList.length} images` }
        };
    }

    let userContent: any;
    if (hasImages) {
        userContent = [
            { type: "text", text: userPromptText },
            { type: "image_url", image_url: { url: imageList[0] } }
        ];
    } else {
        userContent = userPromptText;
    }

    let keyIndex = 0;
    // Planner output is a tiny JSON object. Bound provider retries so an
    // outage cannot consume the whole chat request before we fail clearly.
    let plannerAttempts = 0;
    const maxPlannerAttempts = 2;
    const maxKeysPerModel = 1;
    for (const modelName of plannerModels) {
        const isDeepSeek = !hasImages;
        const maxKeys = isDeepSeek ? 1 : Math.min(apiKeys.length, maxKeysPerModel);
        while (keyIndex < maxKeys && plannerAttempts < maxPlannerAttempts) {
            const key = isDeepSeek ? "" : apiKeys[keyIndex];
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            try {
                plannerAttempts += 1;
                const controller = new AbortController();
                const timeoutMs = isDeepSeek ? 4000 : (hasImages ? 15000 : 2500);
                timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                const reqBody: any = {
                    model: modelName,
                    messages: [
                        { role: "system", content: plannerSystemPrompt },
                        { role: "user", content: userContent }
                    ],
                    max_tokens: AI_CONFIG.limits.plannerMaxTokens || 320,
                    temperature: 0.05
                };
                if (!hasImages) {
                    reqBody.response_format = { type: "json_object" };
                }

                const targetUrl = isDeepSeek
                    ? AI_CONFIG.api.deepseekBaseUrl
                    : AI_CONFIG.api.nvidiaBaseUrl;

                const deepseekKey = isDeepSeek ? getDeepSeekApiKey() : null;
                if (isDeepSeek && !deepseekKey) {
                    console.warn("[Planner] DeepSeek credentials are not configured");
                    throw new Error("DEEPSEEK_API_KEY not configured");
                }

                const authKey = isDeepSeek 
                    ? deepseekKey
                    : key;

                const res = await executionFetch(targetUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${authKey}`
                    },
                    signal: controller.signal,
                    body: JSON.stringify(reqBody)
                });

                if (res.ok) {
                    const json = await res.json();
                    const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                    
                    let parsed: any = null;
                    try {
                        parsed = JSON.parse(rawContent);
                    } catch {
                        const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            try {
                                parsed = JSON.parse(jsonMatch[0]);
                            } catch (parseError) {}
                        }
                    }

                    if (parsed) {
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
                        .filter((s: string) => validSymbols.includes(s) && /^[A-Z]{2,6}$/.test(s) && !/^\d+$/.test(s))
                        .filter((s: string) => s !== "EXTRACTED_SYMBOL" && s !== "SYMBOL1" && s !== "PRIMARY_SYMBOL" && s !== "NULL" && s !== "UNDEFINED" && s !== "NONE");

                        const isFollowupQuery = /الاتنين|الإثنين|الاطنين|كلاهما|مع بعض|السهمين|تحليلهم|هاتهم|قولي عنهم|حللهم|بياناتهم|سعرهم|أخبارهم/i.test(message);
                        const isAggregateTableRequest = /كل البيانات|جدول|كل الأسهم|جدول بالشات|ملخص المحادثة/i.test(message);
                        const isMarketScan = 
                            (parsed.intent === "market_summary" || 
                            parsed.intent === "accumulation" ||
                            parsed.intent === "technical_scan" ||
                            parsed.intent === "sector_analysis" ||
                            (Array.isArray(parsed.tools) && (
                                parsed.tools.includes("get_market") || 
                                parsed.tools.includes("get_indices") || 
                                parsed.tools.includes("get_technical_scan") || 
                                parsed.tools.includes("get_accumulation_stocks")
                            )) ||
                            /مين طلع ومين نزل|ايه اللي طلع وايه اللي نزل|ايه اللى طلع وايه اللى نزل|السوق عمل ايه|حالة السوق|صعود وهبوط|gainers and losers|what went up|whole market|where is liquidity|اسهم (الشهر|السهر)|(الشهر|السهر) (اللي|اللى) (فات|الماضي)|سيولة|تجميع/i.test(message))
                            && parsed.intent !== "comparison";

                        const isTermsQuestion = isTermsDefinitionRequest(message) && symbols.length === 0;
                        const isExplicitComparison = /قارن|مقارنة|مفاضلة|بين|الاتنين|السهمين/i.test(message) || symbolsTextExtracted.length >= 2;
                        // Guard: user mentioned a company-like name we could not map —
                        // drop symbols that merely echo the previous session context (no silent fallback).
                        const unresolvedCompanyName = isUnresolvedCompanyNameMention(message, symbolsTextExtracted);
                        if (unresolvedCompanyName && symbols.length > 0) {
                            const sessionContextSet = new Set([
                                ...(session.last_symbols || []),
                                ...(session.current_symbol ? [session.current_symbol] : [])
                            ].map(s => String(s).toUpperCase()));
                            if (symbols.every(s => sessionContextSet.has(s))) {
                                symbols.length = 0;
                            }
                        }
                        let resolvedSymbols: string[] = [];
                        if (symbolsTextExtracted.length > 0 && !isExplicitComparison) {
                            resolvedSymbols = [...symbolsTextExtracted];
                        } else if (symbols.length > 0) {
                            resolvedSymbols = symbols;
                        } else if (!isMarketScan && !hasImages && !isTermsQuestion && !unresolvedCompanyName) {
                            if ((isFollowupQuery || isAggregateTableRequest) && session.last_symbols?.length) {
                                resolvedSymbols = session.last_symbols;
                            }
                        }

                        let finalIntent = isTermsQuestion ? "general_chat" : (parsed.intent || (hasImages ? "portfolio" : "general_chat"));
                        const isHistoryQuery = /سيره كام سهم|ذكرنا كام سهم|سيرة كام سهم|سياق المحادثة|تاريخ الشات|الملخص|قلنا ايه/i.test(message);
                        const isHistoricalRecallQuery = /التحليل (اللي فات|السابق)|الرقم اللي (قولته|ذكرته) قبل كده|السعر اللي قولته|كان (RSI|macd|السعر) كام|من شوية|قبل كده/i.test(message);
                        
                        const hasRecommendationKw = /(?:في|فى|فيه|عندك|هل\s+يوجد|موجود)?\s*(?:توصيات|توصيه|توصية|إشارة|إشارات|اشارة|اشارات|اشارات\s+النظام|إشارات\s+النظام|سجل\s+التوصيات|اقدم\s+توصيه|أقدم\s+توصية)/i.test(message || "");
                        if (hasRecommendationKw) {
                            finalIntent = "recommendations";
                        } else if (isTermsQuestion) {
                            finalIntent = "general_chat";
                        } else if (isHistoryQuery) {
                            finalIntent = "general_chat";
                        } else if (isHistoricalRecallQuery) {
                            finalIntent = "historical_recall";
                        } else if (resolvedSymbols.length > 0 && finalIntent === "general_chat") {
                            // User typed only a stock name/symbol with no specific question.
                            // Route to stock_analysis (not portfolio which triggers image_analysis pipeline) 
                            // to get a full technical analysis response with get_stock tool.
                            if (!hasImages) {
                                finalIntent = "stock_analysis";
                                if (!Array.isArray(parsed.tools)) parsed.tools = [];
                                if (!parsed.tools.includes("get_stock")) parsed.tools.push("get_stock");
                            } else {
                                finalIntent = "portfolio";
                            }
                        }

                        const requiredFacts: string[] = Array.isArray(parsed.request?.required_facts)
                            ? parsed.request.required_facts.filter((fact: unknown) => Object.prototype.hasOwnProperty.call(REQUIRED_FACT_TOOLS, String(fact)))
                            : [];
                        const toolsList: string[] = (finalIntent === "general_chat" || isTermsQuestion)
                            ? []
                            : (Array.isArray(parsed.tools) ? parsed.tools.filter((tool: unknown) => typeof tool === "string" && PLANNER_TOOLS.has(tool)) : []);
                        requiredFacts.forEach(fact => REQUIRED_FACT_TOOLS[fact].forEach(tool => toolsList.push(tool)));
                        if (requiredFacts.includes("liquidity") && resolvedSymbols.length > 0) toolsList.push("get_stock");
                        const isBreakoutOrAccumulationScan = /اختراق|مقاوم|مقاومات|تجميع|وايكوف/i.test(message) && resolvedSymbols.length === 0;
                        if (isBreakoutOrAccumulationScan && !hasImages) {
                            if (!toolsList.includes("get_accumulation_stocks")) toolsList.push("get_accumulation_stocks");
                            if (!toolsList.includes("get_market")) toolsList.push("get_market");
                            if (finalIntent === "general_chat") finalIntent = "accumulation";
                        }

                        if (hasRecommendationKw && !hasImages) {
                            if (!toolsList.includes("get_recommendations")) toolsList.push("get_recommendations");
                            if (!toolsList.includes("get_signals")) toolsList.push("get_signals");
                        }

                        const imageSummary = hasImages ? (parsed.image_summary || "تحليل البيانات والصورة المرفقة من المحفظة.") : null;

                        const result: PlannerResult = {
                            intent: finalIntent,
                            confidence: parsed.confidence || 0.95,
                            request: parsed.request && typeof parsed.request === "object" ? {
                                answer_kind: ["decision_comparison", "comparison", "explanation", "fact"].includes(parsed.request.answer_kind) ? parsed.request.answer_kind : undefined,
                                goal: String(parsed.request.goal || finalIntent).slice(0, 180),
                                reference: ["explicit", "portfolio", "previous_turn", "market", "none"].includes(parsed.request.reference)
                                    ? parsed.request.reference : (resolvedSymbols.length ? "explicit" : "none"),
                                ranking_metric: ["price_change", "liquidity", "liquidity_unavailable", "accumulation", "fundamentals", "unspecified"].includes(parsed.request.ranking_metric)
                                    ? parsed.request.ranking_metric : "unspecified",
                                required_facts: Array.isArray(parsed.request.required_facts)
                                    ? parsed.request.required_facts.filter((fact: unknown) => ["stock_quote", "technical_indicators", "price_levels", "news", "corporate_actions", "liquidity", "accumulation", "distribution", "market_summary", "recommendations", "historical_prices", "portfolio_positions"].includes(String(fact))).slice(0, 12)
                                    : [],
                                clarification_reason: typeof parsed.request.clarification_reason === "string" ? parsed.request.clarification_reason.slice(0, 240) : null,
                            } : undefined,
                            clarification_needed: Boolean(parsed.clarification_needed)
                                || (Number(parsed.confidence) < 0.45 && finalIntent !== "general_chat")
                                || (requiredFacts.some((fact: string) => ["stock_quote", "technical_indicators", "price_levels", "news", "corporate_actions"].includes(fact))
                                    && resolvedSymbols.length === 0
                                    && !["get_market", "get_accumulation_stocks", "get_distribution_stocks", "get_sector", "get_sector_liquidity", "get_recommendations", "get_technical_scan"].some((tool: string) => Array.isArray(parsed.tools) && parsed.tools.includes(tool))),
                            clarification_options: Array.isArray(parsed.clarification_options)
                                ? parsed.clarification_options.filter((option: unknown) => typeof option === "string").slice(0, 5).map((option: string) => option.slice(0, 100))
                                : [],
                            guidance_intent: parsed.guidance_intent || null,
                            unresolved_stock: unresolvedCompanyName && resolvedSymbols.length === 0,
                            service_degraded_message: (unresolvedCompanyName && resolvedSymbols.length === 0)
                                ? "مقدرش ألاقي سهم بالاسم ده في قاعدة بيانات البورصة المصرية 🤔\nاكتب رمز السهم (مثال: DAPH) أو الاسم الكامل المسجل (مثال: التعمير والاستشارات الهندسية)، ولو بتقصد قطاع كامل اكتب اسم القطاع (مثال: قطاع العقارات)."
                                : (parsed.service_degraded_message || null),
                            entities: {
                                symbols: resolvedSymbols,
                                sector: parsed.entities?.sector || null,
                                wants_table: Boolean(parsed.entities?.wants_table || isAggregateTableRequest || hasImages) && finalIntent !== "general_chat",
                                scan_direction: parsed.entities?.scan_direction || null,
                                technical_preset: parsed.entities?.technical_preset || null,
                                min_acc_score: typeof parsed.entities?.min_acc_score === "number" && Number.isFinite(parsed.entities.min_acc_score) && parsed.entities.min_acc_score >= 0 && parsed.entities.min_acc_score <= 100 ? parsed.entities.min_acc_score : null,
                                min_vol_ratio: typeof parsed.entities?.min_vol_ratio === "number" && Number.isFinite(parsed.entities.min_vol_ratio) && parsed.entities.min_vol_ratio >= 0 ? parsed.entities.min_vol_ratio : null,
                                max_dist_score: typeof parsed.entities?.max_dist_score === "number" && Number.isFinite(parsed.entities.max_dist_score) && parsed.entities.max_dist_score >= 0 && parsed.entities.max_dist_score <= 100 ? parsed.entities.max_dist_score : null,
                                min_consecutive_acc_days: Number.isInteger(parsed.entities?.min_consecutive_acc_days) && parsed.entities.min_consecutive_acc_days >= 0 ? parsed.entities.min_consecutive_acc_days : null
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
                                    : (hasImages 
                                        ? resolvedSymbols
                                        : (Array.isArray(parsed.session_update?.last_symbols) && parsed.session_update.last_symbols.length > 0
                                            ? parsed.session_update.last_symbols.map((s: string) => correctStockSymbol(String(s).toUpperCase(), validSymbols))
                                            : Array.from(new Set([...resolvedSymbols, ...(session.last_symbols || [])])).slice(0, 15))),
                                summary: message || (hasImages ? "تحليل صورة" : null)
                            }
                        };

                        if (hasImages && imageSummary && imageKey) {
                            imageCache.set(imageKey, result);
                        }

                        return result;
                    }
                    break; // Model returned OK but invalid content format - try next model
                } else {
                    console.warn(`Planner model ${modelName} failed with status ${res.status}`);
                    keyIndex++;
                    continue;
                }
            } catch (e: any) {
                console.warn(`Planner model ${modelName} attempt warning:`, e);
                keyIndex++;
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }
        }
        keyIndex = 0;
    }

    const isBestBuy = isBestBuyStockQuestion(message);
    const isMarketSlang = /مين طلع ومين نزل|ايه اللي طلع وايه اللي نزل|ايه اللى طلع وايه اللى نزل|السوق عمل ايه|حالة السوق|صعود وهبوط|gainers and losers|what went up|whole market|where is liquidity|نجم\s+الاسبوع|نجم\s+الأسبوع|القطاع\s+اللي\s+هيطلع|القطاع\s+اللي\s+يرتفع|السهم\s+اللي\s+هيرتفع|السهم\s+اللي\s+يبقي\s+نجم|سيول|سيولة|السيولة|السيوله|قايمه|قائمة|اقوى الاسهم|أقوى الأسهم|افضل الاسهم|أفضل الأسهم|السوق كله|القطاعات|حركة السيولة|توزيع السيولة/i.test(message);
    
    // Check for analytics/performance queries
    const isAnalyticsQuery = /أداء|نجاح|فشل|إحصائيات|win rate|success rate|performance|stats|winrate/i.test(message);
    
    if (isAnalyticsQuery) {
        return {
            intent: "analytics",
            confidence: 0.9,
            entities: { symbols: [], sector: null, wants_table: true },
            tools: ["get_performance_analytics"],
            session_update: {
                current_symbol: session.current_symbol,
                last_symbols: session.last_symbols || [],
                summary: message
            }
        };
    }
    const sectorFollowUp = /^(?:اى|أي|ايه|ما هو|ما هي|مين)\s+(?:اكبر|أكبر)\s+(?:سهم|شركة)\s+(?:في|فى|بقطاع|من)\s+(.+)$/i.exec(message.trim())
        || /^(?:اكبر|أكبر)\s+(?:سهم|شركة)\s+(?:في|فى|بقطاع|من)\s+(.+)$/i.exec(message.trim());
    const explicitSymbols = extractSymbolsFromText(message, validSymbols, stockMappings);
    const unresolvedCompanyNameFallback = isUnresolvedCompanyNameMention(message, explicitSymbols);

    // Check if the user message contains any 3-6 letter English word that is NOT a common technical term and NOT in validSymbols.
    // This indicates they are asking about an unknown stock (like FCMD), so we should NOT fallback to session history.
    const COMMON_TECHNICAL_WORDS = new Set(["KING", "ML", "AI", "RSI", "MACD", "ADX", "SMA", "EMA", "BUY", "SELL", "HOLD", "PDF", "XLS", "CSV", "JSON", "API", "EGX", "OTC", "VOL", "INFO", "NEWS", "STOP", "LOSS", "RISK", "AND", "THE", "FOR", "BUT", "NOT", "YES", "OK"]);
    const englishWords = (message.match(/[a-zA-Z]{3,6}/g) || []).map(w => w.toUpperCase());
    const hasUnknownEnglishStock = englishWords.some(w => !COMMON_TECHNICAL_WORDS.has(w) && !validSymbols.includes(w) && !w.startsWith("EGX"));

    // Provider failure must never silently turn an unrelated question into an
    // analysis of the previous stock. Only symbols explicitly present in the
    // current message are safe in this fallback.
    const fallbackSymbols = (hasImages || isMarketSlang || hasUnknownEnglishStock || unresolvedCompanyNameFallback)
        ? []
        : explicitSymbols;

    if (isBestBuy) {
        // If asking for a general recommendation without explicitly naming a stock or group pronoun (فيهم/منهم),
        // do not inherit single context symbol (e.g. SVCE) so tool calls get general market recommendations.
        const hasGroupRef = /فيهم|منهم|بينهم|عنهم|معاهم|فيهم كلهم|منهم كلهم/i.test(message);
        const targetSymbols = explicitSymbols.length > 0 
            ? explicitSymbols 
            : (hasGroupRef ? (session.last_symbols || []) : []);
        return {
            intent: targetSymbols.length > 0 ? "stock_analysis" : "market_summary",
            confidence: 0.8,
            entities: { symbols: targetSymbols, sector: null, wants_table: true },
            tools: targetSymbols.length > 0 ? ["get_stock", "get_stock_levels"] : ["get_recommendations", "get_fair_value_scan"],
            session_update: {
                current_symbol: targetSymbols[0] || session.current_symbol,
                last_symbols: session.last_symbols ? session.last_symbols.map((s: string) => correctStockSymbol(s, validSymbols)) : [],
                summary: message
            }
        };
    }

    if (fallbackSymbols.length > 0) {
        console.log(`[Planner Fallback] Extracted symbols deterministically:`, fallbackSymbols);
        return {
            intent: "stock_analysis",
            confidence: 0.85,
            entities: { symbols: fallbackSymbols, sector: null, wants_table: true },
            tools: ["get_stock", "get_stock_levels"],
            session_update: {
                current_symbol: fallbackSymbols[0],
                last_symbols: fallbackSymbols.map((s: string) => correctStockSymbol(s, validSymbols)),
                summary: message
            }
        };
    }

    if (isMarketSlang) {
        return {
            intent: "market_summary",
            confidence: 0.85,
            entities: { symbols: [], sector: null, wants_table: true },
            tools: ["get_market"],
            request: { goal: message, reference: "market", ranking_metric: "price_change", required_facts: ["market_summary"] },
            session_update: {
                current_symbol: session.current_symbol,
                last_symbols: session.last_symbols || [],
                summary: message
            }
        };
    }

    if (unresolvedCompanyNameFallback) {
        console.log(`[Planner Fallback] Unresolved company name mention — asking for clarification instead of reusing session symbols.`);
        return {
            intent: "general_chat",
            confidence: 0.9,
            entities: { symbols: [], sector: null, wants_table: false },
            tools: [],
            unresolved_stock: true,
            service_degraded_message: "مقدرش ألاقي سهم بالاسم ده في قاعدة بيانات البورصة المصرية 🤔\nاكتب رمز السهم (مثال: DAPH) أو الاسم الكامل المسجل (مثال: التعمير والاستشارات الهندسية)، ولو بتقصد قطاع كامل اكتب اسم القطاع (مثال: قطاع العقارات).",
            session_update: {
                current_symbol: session.current_symbol,
                last_symbols: session.last_symbols ? session.last_symbols.map((s: string) => correctStockSymbol(s, validSymbols)) : [],
                summary: message
            }
        };
    }

    return {
        intent: "general_chat",
        confidence: 0,
        entities: { symbols: [], sector: null, wants_table: false },
        tools: [],
        service_degraded_message: "تعذر عليّ فهم الطلب حالياً بسبب ضغط مؤقت في خدمة التحليل. من فضلك أعد المحاولة بعد لحظات.",
        image_summary: hasImages ? "تحليل البيانات والصورة المرفقة من المحفظة." : undefined,
        session_update: { 
            current_symbol: session.current_symbol,
            last_symbols: session.last_symbols ? session.last_symbols.map((s: string) => correctStockSymbol(s, validSymbols)) : [], 
            summary: message 
        }
    };
}
