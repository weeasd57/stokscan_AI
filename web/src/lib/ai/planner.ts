import { SessionState, PlannerResult } from "./types";

export async function runPlanner(
    message: string,
    imageList: string[],
    session: SessionState,
    history: any[],
    apiKeys: string[]
): Promise<PlannerResult> {
    const hasImages = imageList && imageList.length > 0;

    // For Image Requests: Direct pass to Vision LLM without forcing hardcoded JSON prompts or DB overrides
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

    const defaultModel = "meta/llama-3.1-8b-instruct";

    const plannerSystemPrompt = `You are the EGX Bots Master Planner & Intent Router for the Egyptian Stock Exchange (EGX).
Your job is to analyze the user request, resolve stock references/pronouns (e.g. "الأولاني", "السهم ده", "ده") using Current Session & History, and return ONLY a valid JSON matching this EXACT SCHEMA:

{
  "intent": "stock_analysis" | "compare_stocks" | "stock_news" | "market_summary" | "portfolio" | "general_chat",
  "confidence": 0.95,
  "entities": {
    "symbols": ["EXTRACTED_SYMBOL"],
    "sector": null,
    "wants_table": false
  },
  "tools": ["get_stock", "get_news", "get_market", "compare_stocks"],
  "session_update": {
    "current_symbol": "EXTRACTED_SYMBOL",
    "last_symbols": ["EXTRACTED_SYMBOL"],
    "summary": "Brief summary of query"
  }
}

Rules:
- Resolve ambiguous pronouns like "الأولاني" or "السهم ده" to current_symbol ("${session.current_symbol || ''}") or last_symbols (${JSON.stringify(session.last_symbols)}).
- Available tools: ["get_stock", "get_news", "get_market", "get_sector", "compare_stocks"].
- Output raw valid JSON ONLY. No text around JSON.`;

    const recentHistoryText = (history || []).slice(-4).map((h: any) => `${h.role}: ${h.content}`).join("\n");
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

                    return {
                        intent: parsed.intent || "general_chat",
                        confidence: parsed.confidence || 0.95,
                        entities: {
                            symbols: Array.from(new Set(symbols)),
                            sector: parsed.entities?.sector || null,
                            wants_table: Boolean(parsed.entities?.wants_table)
                        },
                        tools: Array.isArray(parsed.tools) ? parsed.tools : [],
                        session_update: {
                            current_symbol: symbols[0] || session.current_symbol,
                            last_symbols: Array.from(new Set([...symbols, ...(session.last_symbols || [])])).slice(0, 5),
                            summary: parsed.session_update?.summary || null
                        }
                    };
                }
            }
        } catch (e) {
            console.warn("Planner API key attempt warning:", e);
        }
    }

    return {
        intent: "general_chat",
        confidence: 0.8,
        entities: { symbols: session.current_symbol ? [session.current_symbol] : [], sector: null, wants_table: false },
        tools: session.current_symbol ? ["get_stock"] : [],
        session_update: { current_symbol: session.current_symbol, last_symbols: session.last_symbols, summary: null }
    };
}
