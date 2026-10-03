/**
 * Facet-based tool completion.
 *
 * The planner and the rule-based intent enforcement each pick ONE dominant
 * intent, and several rules REPLACE the tool list (e.g. "حالة السوق" -> only
 * get_market). A compound request ("analyse A, B and C, show news and market
 * state") then silently loses the data for everything but the dominant facet.
 *
 * This step is purely additive: for every facet the message explicitly asks
 * for, the tool that supplies that facet's evidence must be in the plan.
 * It never removes a tool and never invents a facet that was not requested.
 */

const MARKET_SCOPED = new Set([
    "get_market", "get_sector_liquidity", "get_sector_list", "get_fair_value_scan",
    "get_technical_scan", "get_accumulation_stocks", "get_distribution_stocks",
]);

function normalize(message: string): string {
    return message
        .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
        .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
        .toLowerCase();
}

export interface FacetCompletionInput {
    message: string;
    /** Symbols the user named explicitly in this message. */
    symbols: string[];
    tools: string[];
    sector?: string | null;
}

export interface FacetCompletionResult {
    tools: string[];
    added: string[];
    /** True when stock-level evidence was added to a market-dominant plan. */
    stockFacetAdded: boolean;
}

export function completeToolsByFacets(input: FacetCompletionInput): FacetCompletionResult {
    const tools = [...input.tools];
    const added: string[] = [];
    const norm = normalize(input.message);
    const add = (tool: string) => { if (!tools.includes(tool)) { tools.push(tool); added.push(tool); } };

    // Plans that own the whole answer: never widen them.
    if (tools.includes("manage_portfolio") || tools.includes("get_comparison") || tools.includes("search_web") && tools.length === 1) {
        return { tools, added, stockFacetAdded: false };
    }

    const hasSymbols = input.symbols.length > 0;
    const wantsAnalysis = /(تحليل|حلل|فني|مؤشر|rsi|macd|bollinger|بولنجر|بولينجر|بولينغر|سعر|دعم|مقاومه|هدف|وقف|وضع|رايك|توقع|متكامل|اشتري|ابيع)/.test(norm);
    const wantsLevels = /(تحليل|حلل|فني|دعم|مقاومه|هدف|وقف|متكامل)/.test(norm);
    const wantsNews = /(اخبار|خبر|news)/.test(norm);
    const wantsMarket = /((حاله|حالة|وضع|اتجاه)\s*(ال)?(سوق|بورصه|اسواق)|السوق\s*(النهارده|اليوم|عامل)|(اداء|رايك)\s*(ال)?(مؤشر|egx30))/.test(norm);

    let stockFacetAdded = false;
    if (hasSymbols && !tools.includes("get_stock") && (wantsAnalysis || tools.some(tool => MARKET_SCOPED.has(tool)))) {
        add("get_stock");
        stockFacetAdded = true;
    }
    if (hasSymbols && wantsLevels && tools.includes("get_stock")) add("get_stock_levels");
    if (wantsNews) add("get_news");
    if (wantsMarket) add("get_market");
    if (input.sector && !tools.includes("get_sector") && !tools.includes("get_sector_liquidity")) add("get_sector");

    return { tools, added, stockFacetAdded };
}
