import { SessionState, PlannerResult } from "./types";

export async function runPlanner(
    message: string,
    imageList: string[],
    session: SessionState,
    history: any[],
    apiKeys: string[]
): Promise<PlannerResult> {
    const hasImages = imageList && imageList.length > 0;

    if (hasImages) {
        return {
            intent: "image_analysis",
            confidence: 1.0,
            entities: { symbols: [], sector: null, wants_table: false },
            tools: [],
            session_update: { 
                current_symbol: session.current_symbol, 
                last_symbols: session.last_symbols, 
                summary: "تحليل صورة مرفقة" 
            }
        };
    }

    const isAggregateTableRequest = /كل البيانات|جدول|كل الأسهم|جدول بالشات|ملخص المحادثة/i.test(message);
    const defaultModel = "meta/llama-3.1-8b-instruct";

    const plannerSystemPrompt = `You are EGX Bots Master Planner & Router.
Analyze the user input, resolve pronouns using session state, and output raw JSON matching:
{
  "intent": "stock_analysis" | "compare_stocks" | "stock_news" | "market_summary" | "portfolio" | "general_chat",
  "confidence": 0.95,
  "entities": {
    "symbols": [],
    "sector": null,
    "wants_table": false
  },
  "tools": ["get_stock", "get_news", "get_market", "compare_stocks"],
  "session_update": {
    "current_symbol": null,
    "last_symbols": [],
    "summary": null
  }
}
Rules:
- Resolve ambiguous pronouns (e.g. "الأولاني", "السهم ده") to current_symbol ("${session.current_symbol || ''}").
- Output raw valid JSON ONLY. No text around JSON.`;

    const recentHistoryText = (history || []).slice(-6).map((h: any) => `${h.role}: ${h.content}`).join("\n");
    const userPromptContent = `Current Session:\n${JSON.stringify(session)}\n\nRecent History:\n${recentHistoryText}\n\nUser Request:\n${message || "Analyze request"}`;

    for (const key of apiKeys) {
        try {
            const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: defaultModel,
                    messages: [
                        { role: "system", content: plannerSystemPrompt },
                        { role: "user", content: userPromptContent }
                    ],
                    max_tokens: 300,
                    temperature: 0.1
                })
            });

            if (res.ok) {
                const json = await res.json();
                const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    const rawSymbols = Array.isArray(parsed.entities?.symbols) 
                        ? parsed.entities.symbols 
                        : (parsed.session_update?.current_symbol ? [parsed.session_update.current_symbol] : []);

                    const symbols = rawSymbols
                        .map((s: string) => String(s).toUpperCase())
                        .filter((s: string) => s !== "EXTRACTED_SYMBOL" && s !== "SYMBOL1");

                    const resolvedSymbols = isAggregateTableRequest && session.last_symbols?.length 
                        ? Array.from(new Set([...symbols, ...session.last_symbols])) 
                        : symbols;

                    return {
                        intent: isAggregateTableRequest ? "stock_analysis" : (parsed.intent || "general_chat"),
                        confidence: parsed.confidence || 0.95,
                        entities: {
                            symbols: resolvedSymbols,
                            sector: parsed.entities?.sector || null,
                            wants_table: Boolean(parsed.entities?.wants_table || isAggregateTableRequest)
                        },
                        tools: resolvedSymbols.length > 0 ? Array.from(new Set([...(parsed.tools || []), "get_stock"])) : (parsed.tools || []),
                        session_update: {
                            current_symbol: resolvedSymbols[0] || session.current_symbol,
                            last_symbols: Array.from(new Set([...resolvedSymbols, ...(session.last_symbols || [])])).slice(0, 15),
                            summary: parsed.session_update?.summary || null
                        }
                    };
                }
            }
        } catch (e) {
            console.warn("Planner API key attempt warning:", e);
        }
    }

    const fallbackSymbols = isAggregateTableRequest && session.last_symbols?.length 
        ? session.last_symbols 
        : (session.current_symbol ? [session.current_symbol] : []);

    return {
        intent: isAggregateTableRequest ? "stock_analysis" : "general_chat",
        confidence: 0.8,
        entities: { symbols: fallbackSymbols, sector: null, wants_table: isAggregateTableRequest },
        tools: fallbackSymbols.length > 0 ? ["get_stock"] : [],
        session_update: { current_symbol: fallbackSymbols[0] || session.current_symbol, last_symbols: session.last_symbols, summary: null }
    };
}
