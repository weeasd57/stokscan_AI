import { VisionContext } from "./types";

const VISION_SYSTEM_PROMPT = `Inspect the attached financial image and return compact JSON only: {"image_type":"table","visible_stock_symbols":[],"summary":""}. Put only clearly visible stock ticker codes in visible_stock_symbols. Do not infer, recommend, or copy example tickers.`;

function extractJsonFromResponse(raw: string): any {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch {}
    }
    const symbolCandidates = Array.from(new Set(
        (raw.match(/\b[A-Z]{3,5}\b/g) || [])
            .filter(symbol => !["JSON", "NULL", "TABLE", "CHART", "PRICE", "SUMMARY", "STOCK"].includes(symbol))
    ));
    if (symbolCandidates.length) {
        return { image_type: "table", visible_stock_symbols: symbolCandidates, summary: "Visible stock symbols extracted from the image." };
    }
    return null;
}

export function validateVisionOutput(data: any): VisionContext | null {
    if (!data || typeof data !== "object") return null;
    const uncertainties = Array.isArray(data.uncertainties) ? data.uncertainties.map(String) : [];
    const numericOrNull = (value: unknown): number | null => {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    const technical_observations = Array.isArray(data.technical_observations) ? data.technical_observations.map((t: any) => {
        const val = (t.value !== null && t.value !== undefined && t.value !== "") ? Number(t.value) : null;
        if (val === null || isNaN(val)) {
            uncertainties.push(`Unreadable value for ${t.indicator || "indicator"} of symbol ${t.symbol || "unknown"}`);
        }
        return {
            symbol: String(t.symbol || "").toUpperCase(),
            indicator: String(t.indicator || ""),
            value: (val === null || isNaN(val)) ? null : val,
            meaning: String(t.meaning || "")
        };
    }) : [];

    const rawSymbols = Array.isArray(data.symbols)
        ? data.symbols
        : Array.isArray(data.visible_stock_symbols)
            ? data.visible_stock_symbols.map((symbol: unknown) => ({ symbol }))
            : [];

    return {
        image_type: ["portfolio", "chart", "market_depth", "table", "unknown"].includes(data.image_type) ? data.image_type : "unknown",
        symbols: rawSymbols.map((s: any) => {
            const sym = String(s.symbol || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
            return {
                symbol: sym,
                name: String(s.name || ""),
                visible_values: {
                    price: numericOrNull(s.visible_values?.price ?? s.price),
                    change_pct: numericOrNull(s.visible_values?.change_pct ?? s.change_pct),
                    quantity: numericOrNull(s.visible_values?.quantity ?? s.quantity)
                }
            };
        }).filter(s => s.symbol.length >= 2),
        technical_observations,
        market_depth: {
            total_bid: data.market_depth?.total_bid ?? null,
            total_ask: data.market_depth?.total_ask ?? null,
            spread: data.market_depth?.spread ?? null
        },
        user_relevant_summary: String(data.user_relevant_summary || data.summary || ""),
        uncertainties: Array.from(new Set(uncertainties)),
        confidence: Number(data.confidence) || (rawSymbols.length ? 0.8 : 0.5),
        analyzed_at: new Date().toISOString(),
        message_id: ""
    };
}

const VISION_TIMEOUT_MS = 12000;
const MAX_VISION_TOTAL_TIME_MS = 25000;

export async function analyzeImage(
    imageUrl: string,
    userMessage: string,
    apiKeys: string[],
    messageId: string
): Promise<{ vision: VisionContext | null; error: string | null }> {
    const visionModels = [
        "nvidia/nemotron-nano-12b-v2-vl",
        "nvidia/llama-3.1-nemotron-nano-vl-8b-v1"
    ];

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    userContent.push({ type: "text", text: `${VISION_SYSTEM_PROMPT}\nUser request: ${userMessage.slice(0, 250) || "Analyze the attached image"}.` });
    userContent.push({ type: "image_url", image_url: { url: imageUrl } });

    const visionStartTime = Date.now();
    const analyzeModel = async (model: string): Promise<VisionContext | null> => {
        const key = apiKeys.length > 1 ? apiKeys[1] : apiKeys[0];
        const remaining = MAX_VISION_TOTAL_TIME_MS - (Date.now() - visionStartTime);
        if (!key || remaining <= 0) return null;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), Math.min(VISION_TIMEOUT_MS, remaining));
        try {
                const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${key}`
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "user", content: userContent }
                    ],
                    max_tokens: 600,
                    temperature: 0.05
                })
            });
                if (!res.ok) {
                    console.warn(`Vision model ${model} failed with status ${res.status}`);
                    return null;
                }
                const json = await res.json();
                const parsed = extractJsonFromResponse(json.choices?.[0]?.message?.content?.trim() || "");
                const validated = parsed ? validateVisionOutput(parsed) : null;
                if (validated) {
                    validated.message_id = messageId;
                    return validated;
                }
        } catch (err: any) {
            console.warn(`Vision model ${model} error:`, err.message);
        } finally {
            clearTimeout(timeoutId);
        }
        return null;
    };

    const candidates: VisionContext[] = [];
    for (const model of visionModels) {
        const candidate = await analyzeModel(model);
        if (candidate) candidates.push(candidate);
    }

    if (candidates.length > 0) {
        if (candidates.length === 1) {
            const single = candidates[0];
            return { vision: single, error: null };
        }

        const symbolCounts = new Map<string, number>();
        candidates.forEach(candidate => {
            new Set(candidate.symbols.map(symbol => symbol.symbol).filter(Boolean)).forEach(symbol => {
                symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
            });
        });
        const agreedSymbols = new Set(Array.from(symbolCounts.keys()));
        const primary = candidates[0];
        const valuesAgree = (left: number | null, right: number | null, relativeTolerance = 0.02, absoluteTolerance = 0.01): boolean => {
            if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) return false;
            return Math.abs(left - right) <= Math.max(absoluteTolerance, Math.max(Math.abs(left), Math.abs(right)) * relativeTolerance);
        };
        const agreedObservations: VisionContext["technical_observations"] = [];
        const evidenceSymbols = new Set(primary.symbols.filter(symbol => {
            if (!agreedSymbols.has(symbol.symbol)) return false;
            const matchingSymbols = candidates.slice(1)
                .map(candidate => candidate.symbols.find(item => item.symbol === symbol.symbol))
                .filter(Boolean) as VisionContext["symbols"];
            const visible = symbol.visible_values;
            visible.price = matchingSymbols.some(match => valuesAgree(visible.price, match.visible_values.price)) ? visible.price : null;
            visible.change_pct = matchingSymbols.some(match => valuesAgree(visible.change_pct, match.visible_values.change_pct, 0.02, 0.1)) ? visible.change_pct : null;
            visible.quantity = matchingSymbols.some(match => valuesAgree(visible.quantity, match.visible_values.quantity, 0.05, 1)) ? visible.quantity : null;

            const primaryObservations = primary.technical_observations.filter(observation => observation.symbol === symbol.symbol && observation.value != null);
            for (const observation of primaryObservations) {
                const corroborated = candidates.slice(1).some(candidate => candidate.technical_observations.some(other =>
                    other.symbol === observation.symbol
                    && other.indicator.toUpperCase() === observation.indicator.toUpperCase()
                    && valuesAgree(observation.value, other.value, 0.03, 0.1)
                ));
                if (corroborated) agreedObservations.push(observation);
            }
            return true;
        }).map(symbol => symbol.symbol));
        primary.symbols = primary.symbols.filter(symbol => evidenceSymbols.has(symbol.symbol));
        primary.technical_observations = agreedObservations.filter(observation => evidenceSymbols.has(observation.symbol));
        primary.confidence = candidates.reduce((sum, candidate) => sum + candidate.confidence, 0) / candidates.length;
        if (evidenceSymbols.size === 0) {
            primary.user_relevant_summary = "لم تتفق قراءتا الصورة على أرقام مالية أو مؤشرات يمكن عرضها بثقة.";
            primary.uncertainties.push("تم حجب الرموز والقيم التي لم تتطابق بين نموذجي الرؤية ضمن هامش التحقق.");
            primary.confidence = Math.min(primary.confidence, 0.49);
        }
        return { vision: primary, error: null };
    }

    return { vision: null, error: "فشل تحليل الصورة - جميع موديلات الرؤية لم تنجح" };
}
