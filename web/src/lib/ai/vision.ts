import { VisionContext } from "./types";
import { getSyncStockMappings } from "./planner";
import { AI_CONFIG } from "./config";
import { getDeepSeekApiKey, getNvidiaApiKeys } from "./server-secrets";

const VISION_SYSTEM_PROMPT = `You are a financial image analyzer. Examine the attached image and return ONLY a valid JSON object with no markdown fences, no comments, and no extra text.

Return one JSON object with these keys: image_type, symbols, technical_observations, market_depth, user_relevant_summary, uncertainties, confidence.
Do not copy this instruction, do not return a schema, and do not use placeholder values.

Rules:
- image_type: write exactly one word — portfolio (if it shows broker holdings/positions), chart (candlestick/line), table (price table), market_depth (bid/ask ladder), or unknown.
- symbols: for each visible stock ticker (2-6 uppercase English letters such as COMI, ADIB, INEG, MCRO), add an entry: {"symbol":"TICKER","name":"Company name or empty","visible_values":{"price":null,"change_pct":null,"quantity":null}}. Fill in numbers you can read; use null for values you cannot read. Write numbers without commas (50000 not 50,000). Preserve decimal points exactly (181.50 must be 181.5, never 18150).
- Arabic column mapping (very important):
  * "الوحدات" or "الكمية" = number of shares → quantity.
  * "متوسط سعر الوحدات" or "متوسط الشراء" = average purchase price → price.
  * "القيمة السوقية" (market value) and "القيمة الشرائية" (purchase value) and "المكسب/الخسارة" (profit/loss in money) are NOT price and NOT quantity — ignore them.
  * "العائد %" (return %) is NOT quantity — put it in change_pct only if it is a small percentage, never in quantity.
- If the screen lists holdings with only market value and return % (no share count and no average price), return the symbols with price and quantity set to null. Never fill quantity from a percentage.
- If the screen is a single-stock position detail, use the units as quantity and the average unit price as price.
- Return each ticker at most once.
- Never invent a ticker, price, or quantity. If the image text is unreadable, return unknown image_type and empty symbols array.
- confidence: a number from 0 to 1 reflecting how clearly you could read the image.
`;

export function extractJsonFromResponse(raw: string): any {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const normalizedRaw = trimmed.replace(/("symbols"\s*:\s*\[[\s\S]*?)(\}\s*,\s*)("technical_observations"\s*:)/, "$1$2] , $3");
    const candidates: string[] = [];
    // Accept a JSON object wrapped in prose or markdown, but only when the
    // braces are balanced. This handles models that prepend "Here is JSON:".
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < normalizedRaw.length; i += 1) {
        const ch = normalizedRaw[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === "{" && depth === 0) start = i;
        if (ch === "{" && start >= 0) depth += 1;
        if (ch === "}" && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                candidates.push(normalizedRaw.slice(start, i + 1));
                start = -1;
            }
        }
    }
    for (const jsonText of candidates.sort((a, b) => b.length - a.length)) {
        try {
            return JSON.parse(jsonText);
        } catch {}
        // Some vision responses use commas inside numeric values (50,000),
        // producing invalid JSON. Repair only comma-thousands patterns.
        try {
            const repaired = jsonText.replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");
            return JSON.parse(repaired);
        } catch {}
        try {
            const repaired = jsonText
                .replace(/[“”]/g, '"')
                .replace(/[‘’]/g, "'")
                .replace(/,\s*([}\]])/g, "$1")
                .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
                .replace(/'([^']*)'/g, '"$1"');
            return JSON.parse(repaired);
        } catch {}
        try {
            // Llama occasionally omits the closing `]` before the next top-level
            // key: `{"symbols":[...},"technical_observations":...}`.
            const repairedArray = jsonText.replace(/(\}\s*,\s*)("technical_observations"\s*:)/, "$1] , $2");
            return JSON.parse(repairedArray);
        } catch {}
    }
    // Last safe fallback: preserve only clearly printed ticker codes. Values
    // remain null because prose/OCR is not reliable enough to invent prices
    // or quantities. This still lets the portfolio confirmation flow ask the
    // user for missing fields instead of discarding the image entirely.
    const symbols = Array.from(new Set(
        (trimmed.match(/\b[A-Z]{2,6}\b/g) || [])
            .filter(symbol => !["JSON", "NULL", "TABLE", "CHART", "PRICE", "SUMMARY", "STOCK", "IMAGE", "UNKNOWN"].includes(symbol))
    ));
    if (symbols.length > 0) {
        const portfolio = /portfolio|holding|position|محفظ|سهم|shares/i.test(trimmed);
        return {
            image_type: portfolio ? "portfolio" : "table",
            symbols: symbols.map(symbol => ({
                symbol,
                name: "",
                visible_values: { price: null, change_pct: null, quantity: null },
            })),
            technical_observations: [],
            market_depth: { total_bid: null, total_ask: null, spread: null },
            user_relevant_summary: "تم استخراج الرموز الواضحة فقط؛ القيم الرقمية تحتاج تأكيد المستخدم.",
            uncertainties: ["استُخدم استخراج آمن للرموز من رد Vision غير المنظم؛ لم يتم اعتماد أي سعر أو كمية."],
            confidence: 0.35,
        };
    }
    // Last structured salvage: a malformed JSON response may still contain
    // explicit `symbol` fields. Preserve only those tickers and discard all
    // numeric values, so the confirmation flow can ask the user for prices or
    // quantities instead of losing the entire image.
    const keyedSymbols = Array.from(new Set(
        Array.from(trimmed.matchAll(/["']symbol["']\s*:\s*["']([A-Z]{2,6})["']/g), match => match[1].toUpperCase())
            .filter(symbol => !["TICKER", "SYMBOL", "UNKNOWN"].includes(symbol))
    ));
    if (keyedSymbols.length > 0) {
        return {
            image_type: /portfolio|holding|position|محفظ|سهم|shares/i.test(trimmed) ? "portfolio" : "table",
            symbols: keyedSymbols.map(symbol => ({ symbol, name: "", visible_values: { price: null, change_pct: null, quantity: null } })),
            technical_observations: [],
            market_depth: { total_bid: null, total_ask: null, spread: null },
            user_relevant_summary: "تم استخراج رموز الأسهم فقط من رد Vision غير المكتمل؛ القيم الرقمية تحتاج تأكيداً.",
            uncertainties: ["تم تجاهل الأسعار والكميات لأن رد Vision لم يكن JSON صالحاً بالكامل."],
            confidence: 0.25,
        };
    }
    // Do not infer tickers from provider prose. A model response is accepted
    // only when it contains the contracted JSON shape; otherwise the caller
    // must report a vision failure instead of turning arbitrary prose into
    // financial data.
    return null;
}

function coerceNumberOrNull(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
        const lowered = value.trim().toLowerCase();
        if (!lowered || ["null", "undefined", "n/a", "na", "-", "—"].includes(lowered)) return null;
        const cleaned = lowered.replace(/[,%]|\s|جنيه|ج\.م|egp|ريال|درهم|دولار|\$/g, "");
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeVisiblePrice(raw: unknown, imageType: string): number | null {
    const value = coerceNumberOrNull(raw);
    if (value === null) return null;
    // OCR occasionally drops the decimal point in Egyptian quote tables
    // (181.50 -> 18150). Apply the correction only to ungrouped numbers; a
    // value written with thousands separators ("22,700") is a quantity/count,
    // not a decimal-split price, so it must not be divided.
    const grouped = typeof raw === "string" && raw.includes(",");
    if (!grouped && (imageType === "portfolio" || imageType === "table") && value >= 1000 && value < 100000) {
        return Number((value / 100).toFixed(2));
    }
    return value;
}

function isNumberOrNull(value: unknown): boolean {
    return value === null || value === undefined || coerceNumberOrNull(value) !== null;
}

function hasValidVisionContract(data: any): boolean {
    if (!data || typeof data !== "object") return false;
    // Llama sometimes emits null for optional empty collections. Normalize
    // those values so an unreadable image becomes a safe `unknown` result
    // instead of a misleading invalid-JSON provider failure.
    if (data.symbols == null) data.symbols = [];
    if (data.technical_observations == null) data.technical_observations = [];
    if (data.uncertainties == null) data.uncertainties = [];
    if (data.user_relevant_summary == null) data.user_relevant_summary = "";
    if (data.market_depth == null) data.market_depth = { total_bid: null, total_ask: null, spread: null };
    if (data.confidence == null) data.confidence = 0;
    if (!["portfolio", "chart", "market_depth", "table", "unknown"].includes(data.image_type)) return false;
    if (!Array.isArray(data.symbols) || !Array.isArray(data.technical_observations)) return false;
    if (typeof data.user_relevant_summary !== "string" || !Array.isArray(data.uncertainties)) return false;
    if (typeof data.confidence !== "number" || !Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) return false;
    if (!data.market_depth || typeof data.market_depth !== "object") return false;
    if (!isNumberOrNull(data.market_depth.total_bid) || !isNumberOrNull(data.market_depth.total_ask) || !isNumberOrNull(data.market_depth.spread)) return false;

    if (data.symbols.some((symbol: any) => symbol?.symbol === "TICKER" || symbol?.symbol === "SYMBOL")) return false;
    if (data.user_relevant_summary.includes("image_type") || data.user_relevant_summary.includes("visible_values")) return false;

    return data.symbols.every((symbol: any) => symbol && typeof symbol.symbol === "string"
        && /^[A-Z]{2,6}$/.test(symbol.symbol)
        && typeof symbol.name === "string"
        && symbol.visible_values && typeof symbol.visible_values === "object"
        && isNumberOrNull(symbol.visible_values.price)
        && isNumberOrNull(symbol.visible_values.change_pct)
        && isNumberOrNull(symbol.visible_values.quantity))
        && data.technical_observations.every((observation: any) => observation
            && typeof observation.symbol === "string"
            && /^[A-Z]{2,6}$/.test(observation.symbol)
            && typeof observation.indicator === "string"
            && isNumberOrNull(observation.value)
            && typeof observation.meaning === "string");
}

export function validateVisionOutput(data: any): VisionContext | null {
    if (!data || typeof data !== "object") return null;
    const uncertainties = Array.isArray(data.uncertainties) ? data.uncertainties.map(String) : [];
    const numericOrNull = coerceNumberOrNull;

    const technical_observations = Array.isArray(data.technical_observations) ? data.technical_observations.map((t: any) => {
        const val = coerceNumberOrNull(t.value);
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
        ? data.symbols.map((entry: any) => (typeof entry === "string" ? { symbol: entry } : entry))
        : Array.isArray(data.visible_stock_symbols)
            ? data.visible_stock_symbols.map((symbol: unknown) => ({ symbol }))
            : [];

    const seenSymbols = new Set<string>();
    const uniqueSymbols: Array<{
        symbol: string;
        name: string;
        visible_values: { price: number | null; change_pct: number | null; quantity: number | null };
    }> = [];

    const stockMappings = getSyncStockMappings();

    for (const s of rawSymbols) {
        let sym = String(s.symbol || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        const lowerSym = sym.toLowerCase();
        if (stockMappings[lowerSym]) {
            const mapped = stockMappings[lowerSym];
            sym = (Array.isArray(mapped) ? mapped[0] : mapped).toUpperCase();
        }
        if (sym.length < 2) continue;
        const rawChangePct = numericOrNull(s.visible_values?.change_pct ?? s.change_pct);
        // EGX circuit breakers make a daily move beyond ±20% impossible; any
        // larger value is an OCR/column mix-up and must not be presented.
        const changePct = rawChangePct !== null && Math.abs(rawChangePct) <= 100 ? rawChangePct : null;
        const columnsUntrustworthy = rawChangePct !== null && changePct === null;
        if (columnsUntrustworthy && !seenSymbols.has(sym)) {
            uncertainties.push(`تم تجاهل القيم المقروءة لـ ${sym} (${rawChangePct}%) لأن ترتيب الأعمدة غير منطقي.`);
        }
        const rawQuantity = numericOrNull(s.visible_values?.quantity ?? s.quantity);
        const quantity = !columnsUntrustworthy && rawQuantity !== null && rawQuantity > 0 ? rawQuantity : null;
        const price = normalizeVisiblePrice(s.visible_values?.price ?? s.price, String(data.image_type || "unknown"));

        const existing = uniqueSymbols.find((entry) => entry.symbol === sym);
        if (existing) {
            // The model sometimes returns the same ticker several times (e.g. once
            // per column) — merge so a later entry can supply the units or average
            // price the first one was missing, instead of discarding it.
            if (existing.visible_values.quantity === null && quantity !== null) existing.visible_values.quantity = quantity;
            if (existing.visible_values.price === null && price !== null) existing.visible_values.price = price;
            if (existing.visible_values.change_pct === null && changePct !== null) existing.visible_values.change_pct = changePct;
            continue;
        }
        seenSymbols.add(sym);
        uniqueSymbols.push({
            symbol: sym,
            name: String(s.name || ""),
            visible_values: { price, change_pct: changePct, quantity }
        });
    }

    return {
        image_type: ["portfolio", "chart", "market_depth", "table", "unknown"].includes(data.image_type) ? data.image_type : "unknown",
        symbols: uniqueSymbols,
        technical_observations,
        market_depth: {
            total_bid: numericOrNull(data.market_depth?.total_bid),
            total_ask: numericOrNull(data.market_depth?.total_ask),
            spread: numericOrNull(data.market_depth?.spread)
        },
        user_relevant_summary: String(data.user_relevant_summary || data.summary || ""),
        uncertainties: Array.from(new Set(uncertainties)),
        confidence: Number(data.confidence) || (rawSymbols.length ? 0.8 : 0.5),
        analyzed_at: new Date().toISOString(),
        message_id: ""
    };
}

// The NVIDIA vision model regularly takes 8-25s per image and the shared
// endpoint intermittently hangs past the timeout. Keep one 30s attempt, then
// retry with the remaining configured key for up to 20s more before reporting
// failure. The total budget stays under the 52s request deadline.
const VISION_TIMEOUT_MS = 30000;
const MAX_VISION_TOTAL_TIME_MS = 50000;

/**
 * The vision model frequently reads a broker screenshot's quantity/total column
 * as if it were the share price (e.g. 124569 for EDFM whose market price is
 * ~417). Drop any extracted price that is implausible against the latest stored
 * close so the reply never presents a wrong price as fact.
 */
export async function reconcileVisionWithMarket(vision: VisionContext, supabase: any): Promise<VisionContext> {
    if (!vision || !Array.isArray(vision.symbols) || vision.symbols.length === 0 || !supabase) return vision;
    const symbols = Array.from(new Set(vision.symbols.map(entry => entry.symbol).filter(Boolean)));
    if (symbols.length === 0) return vision;
    try {
        const { data } = await supabase
            .from("stock_technical_indicators")
            .select("symbol, close, date")
            .in("symbol", symbols)
            .order("date", { ascending: false });
        const closeBySymbol = new Map<string, number>();
        for (const row of data || []) {
            const sym = String(row.symbol || "").toUpperCase();
            const close = Number(row.close);
            if (sym && Number.isFinite(close) && close > 0 && !closeBySymbol.has(sym)) {
                closeBySymbol.set(sym, close);
            }
        }
        for (const entry of vision.symbols) {
            const close = closeBySymbol.get(entry.symbol);
            const price = entry.visible_values?.price;
            if (close && price != null && Number.isFinite(price)) {
                const ratio = price / close;
                if (ratio > 3 || ratio < 0.33) {
                    entry.visible_values.price = null;
                    vision.uncertainties.push(`تم تجاهل السعر المقروء لـ ${entry.symbol} (${price}) لعدم تناسقه مع سعر السوق المسجل (${close}).`);
                }
            }
        }
    } catch {
        // Best-effort validation only; never block the image flow.
    }
    return vision;
}

export async function analyzeImage(
    imageUrl: string,
    userMessage: string,
    apiKeys: string[],
    messageId: string
): Promise<{ vision: VisionContext | null; error: string | null }> {
    const deepSeekKey = getDeepSeekApiKey();
    const nvidiaKeys = getNvidiaApiKeys();
    const deepSeekVisionModels = AI_CONFIG.models.planner.vision.filter(model => model === "deepseek-flash");
    const nvidiaVisionModels = ["meta/llama-3.2-11b-vision-instruct"];
    const visionModels = [...deepSeekVisionModels, ...nvidiaVisionModels];

    // System prompt goes in `system` role — putting it in the user message causes prose output.
    const userContent: Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = [];
    // Send a short, neutral user message so the model focuses on the system prompt instructions.
    userContent.push({ type: "text", text: "Analyze the attached image and return JSON only." });
    userContent.push({ type: "image_url", image_url: { url: imageUrl, detail: "low" } });

    const visionStartTime = Date.now();
    let lastFailure = "vision_unavailable";
    const failurePriority: Record<string, number> = {
        vision_unavailable: 0,
        vision_request_failed: 1,
        vision_timeout: 2,
        vision_invalid_json: 3,
    };
    const recordFailure = (failure: string) => {
        const priority = (value: string) => {
            if (value.startsWith("vision_http_")) return 4;
            return failurePriority[value] ?? 0;
        };
        const current = priority(lastFailure);
        const next = priority(failure);
        if (next >= current) lastFailure = failure;
    };
    const analyzeModel = async (provider: "deepseek" | "nvidia", model: string, key: string): Promise<VisionContext | null> => {
        const remaining = MAX_VISION_TOTAL_TIME_MS - (Date.now() - visionStartTime);
        if (!key || remaining <= 0) return null;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), Math.min(VISION_TIMEOUT_MS, remaining));
        try {
            const endpoint = provider === "deepseek" ? AI_CONFIG.api.deepseekBaseUrl : AI_CONFIG.api.nvidiaBaseUrl;
            const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${key}`
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "system", content: VISION_SYSTEM_PROMPT },
                        { role: "user", content: userContent }
                    ],
                    // Tables with many holdings need room for every symbol entry;
                    // 320 tokens truncated the JSON mid-array and made every
                    // parsable response fail validation.
                    max_tokens: 900,
                    temperature: 0.05,
                    // NVIDIA's OpenAI-compatible endpoint supports JSON mode
                    // for this model. Without it the model sometimes returns
                    // a 700-character prose answer that cannot be validated.
                    response_format: { type: "json_object" },
                    // Vision extraction is a constrained JSON task. DeepSeek
                    // Flash may spend the whole output budget on reasoning,
                    // returning finish_reason=length with empty content unless
                    // thinking is explicitly disabled.
                    ...(provider === "deepseek" ? { thinking: { type: "disabled" } } : {})
                })
            });
            if (!res.ok) {
                recordFailure(`vision_http_${res.status}`);
                console.warn(`[VISION] model=${model} status=${res.status}`);
                return null;
            }
            const json = await res.json();
            const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
            const parsed = extractJsonFromResponse(rawContent);
            const hasVisionShape = hasValidVisionContract(parsed);
            // The strict contract rejects near-miss responses (wrong image_type
            // spelling, lowercase tickers, missing confidence) even though the
            // payload still contains real tickers. Fall back to the lenient
            // normalizer, but only accept it when it recovered actual symbols so
            // a garbage response still ends in the safe failure path.
            let validated = hasVisionShape ? validateVisionOutput(parsed) : null;
            if (!validated && parsed && typeof parsed === "object") {
                const lenient = validateVisionOutput(parsed);
                if (lenient && lenient.symbols.length > 0) validated = lenient;
            }
            if (!validated) {
                recordFailure("vision_invalid_json");
                const preview = rawContent.replace(/\s+/g, " ").slice(0, 160);
                console.warn(`[VISION] model=${model} returned no usable JSON (chars=${rawContent.length}) preview=${preview}`);
            } else {
                validated.message_id = messageId;
                return validated;
            }
        } catch (err: any) {
            recordFailure(err?.name === "AbortError" ? "vision_timeout" : "vision_request_failed");
            console.warn(`[VISION] model=${model} error=${lastFailure}`);
        } finally {
            clearTimeout(timeoutId);
        }
        return null;
    };

    const candidates: VisionContext[] = [];
    // Retry the same model with the other configured key after a provider
    // timeout or HTTP failure. Both keys can hit a congested backend, so the
    // second attempt is bounded by whatever time remains in the total budget.
    const usableKeys = apiKeys.filter(Boolean).slice(0, 2);
    const attempts: Array<{ provider: "deepseek" | "nvidia"; model: string; key: string }> = [];
    for (const model of visionModels) {
        const keys = model === "deepseek-flash" ? (deepSeekKey ? [deepSeekKey] : []) : nvidiaKeys.slice(0, 2);
        const provider = model === "deepseek-flash" ? "deepseek" : "nvidia";
        for (const key of keys) attempts.push({ provider, model, key });
    }
    // Preserve caller-supplied fallback keys (normally NVIDIA keys supplied by
    // the route) after the provider-specific keys. This also keeps retry order
    // explicit rather than silently dropping a route-level credential.
    // Legacy fallback shape retained for route-level NVIDIA keys: for (const key of usableKeys)
    for (const key of usableKeys) {
        if (!attempts.some(attempt => attempt.key === key)) {
            attempts.push({ provider: "nvidia", model: nvidiaVisionModels[0], key });
        }
    }
    // `visionModels` documents the complete configured model set; attempts are
    // ordered separately so DeepSeek is tried before the NVIDIA fallback.
    for (const attempt of attempts) {
        if (Date.now() - visionStartTime >= MAX_VISION_TOTAL_TIME_MS) break;
        const candidate = await analyzeModel(attempt.provider, attempt.model, attempt.key);
        if (candidate) {
            candidates.push(candidate);
            break;
        }
        if (candidates.length > 0) break;
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

    // Keep provider-specific diagnostics in server logs only. The caller gets
    // a stable public error category and cannot see model/status internals.
    console.warn(`[VISION] final_failure=${lastFailure}`);
    return { vision: null, error: lastFailure };
}
