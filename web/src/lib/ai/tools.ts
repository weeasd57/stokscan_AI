import { PlannerResult } from "./types";

export async function executeTools(supabase: any, plannerResult: PlannerResult): Promise<string> {
    const { tools, entities } = plannerResult;
    if (!tools || tools.length === 0) return "";

    let outputText = "";
    const symbols = entities.symbols;

    // Tool 1 & 2: get_stock & get_indicators
    if (symbols.length > 0 && (tools.includes("get_stock") || tools.includes("load_stock_prices"))) {
        const [pricesRes, techsRes, stocksRes] = await Promise.all([
            supabase.from("stock_prices").select("symbol, close, volume, date").in("symbol", symbols).order("date", { ascending: false }).limit(symbols.length * 2),
            supabase.from("stock_technical_indicators").select("symbol, rsi_14, macd_signal, change_pct").in("symbol", symbols).order("date", { ascending: false }).limit(symbols.length),
            supabase.from("stocks").select("symbol, name").in("symbol", symbols)
        ]);

        const prices: any[] = pricesRes.data || [];
        const techs: any[] = techsRes.data || [];
        const stocks: any[] = stocksRes.data || [];

        if (prices.length > 0) {
            outputText += `\n📊 [بيانات الأسهم المطلوبة من قاعدة البيانات]:\n`;
            symbols.forEach(sym => {
                const price = prices.find((p: any) => p.symbol === sym);
                const tech = techs.find((t: any) => t.symbol === sym);
                const stock = stocks.find((s: any) => s.symbol === sym);
                if (price) {
                    const changeStr = tech && typeof tech.change_pct === "number" ? `${tech.change_pct >= 0 ? "+" : ""}${tech.change_pct.toFixed(2)}%` : "N/A";
                    outputText += `• سهم ${sym} (${stock?.name || sym}): السعر اللحظي = ${price.close} ج.م | التغير: ${changeStr} | RSI: ${tech?.rsi_14 ?? "N/A"} | إشارة MACD: ${tech?.macd_signal ?? "N/A"}\n`;
                }
            });
        }
    }

    // Tool 3: get_market & get_news
    if (tools.includes("get_market") || tools.includes("get_news") || plannerResult.intent === "market_summary" || plannerResult.intent === "stock_news") {
        const { data: marketCache } = await supabase
            .from("market_cache")
            .select("cache_value")
            .eq("cache_key", "market_status_Egypt")
            .single();

        if (marketCache?.cache_value) {
            outputText += `\n📰 [حالة البورصة والأخبار من قاعدة البيانات]:\n${JSON.stringify(marketCache.cache_value).substring(0, 800)}\n`;
        }
    }

    return outputText;
}
