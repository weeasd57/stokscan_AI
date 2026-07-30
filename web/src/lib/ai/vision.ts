import { VisionContext } from "./types";

const VISION_SYSTEM_PROMPT = `أنت محلل صور مالي متخصص. مهمتك فقط استخراج البيانات المرئية من الصورة المرفقة.

**قواعد صارمة:**
1. استخرج فقط ما هو مرئي في الصورة - لا تستنتج أو تخترع بيانات
2. لا تستخدم أي قاعدة بيانات أو معلومات خارجية
3. لا تعطِ توصيات شراء أو بيع
4. أي شيء غير مقروء أو غير واضح ضعه في uncertainties
5. فرّق بين visible_values (أسعار، كميات ظاهرة) و technical_observations (مؤشرات فنية)

أعد JSON فقط بهذا الهيكل الدقيق:
{
  "image_type": "portfolio|chart|market_depth|table|unknown",
  "symbols": [{"symbol": "COMI", "name": "", "visible_values": {"price": null, "change_pct": null, "quantity": null}}],
  "technical_observations": [{"symbol": "COMI", "indicator": "RSI", "value": 67.3, "meaning": "near_overbought"}],
  "market_depth": {"total_bid": null, "total_ask": null, "spread": null},
  "user_relevant_summary": "تحليل مختصر لما ظهر في الصورة",
  "uncertainties": [],
  "confidence": 0.92
}`;

function extractJsonFromResponse(raw: string): any {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch {}
    }
    return null;
}

export function validateVisionOutput(data: any): VisionContext | null {
    if (!data || typeof data !== "object") return null;
    const uncertainties = Array.isArray(data.uncertainties) ? data.uncertainties.map(String) : [];

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

    return {
        image_type: ["portfolio", "chart", "market_depth", "table", "unknown"].includes(data.image_type) ? data.image_type : "unknown",
        symbols: Array.isArray(data.symbols) ? data.symbols.map((s: any) => ({
            symbol: String(s.symbol || "").toUpperCase(),
            name: String(s.name || ""),
            visible_values: {
                price: s.visible_values?.price ?? null,
                change_pct: s.visible_values?.change_pct ?? null,
                quantity: s.visible_values?.quantity ?? null
            }
        })) : [],
        technical_observations,
        market_depth: {
            total_bid: data.market_depth?.total_bid ?? null,
            total_ask: data.market_depth?.total_ask ?? null,
            spread: data.market_depth?.spread ?? null
        },
        user_relevant_summary: String(data.user_relevant_summary || ""),
        uncertainties: Array.from(new Set(uncertainties)),
        confidence: Number(data.confidence) || 0,
        analyzed_at: new Date().toISOString(),
        message_id: ""
    };
}

const VISION_TIMEOUT_MS = 25000;

export async function analyzeImage(
    imageUrl: string,
    userMessage: string,
    apiKeys: string[],
    messageId: string
): Promise<{ vision: VisionContext | null; error: string | null }> {
    const visionModels = [
        "nvidia/nemotron-nano-12b-v2-vl",
        "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
        "meta/llama-3.2-11b-vision-instruct"
    ];

    const userContent = [];
    if (userMessage) {
        userContent.push({ type: "text", text: `طلب المستخدم: ${userMessage}\n\nحلل البيانات المرئية فقط في الصورة المرفقة.` });
    }
    userContent.push({ type: "image_url", image_url: { url: imageUrl } });

    for (const model of visionModels) {
        for (const key of apiKeys) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

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
                            { role: "system", content: VISION_SYSTEM_PROMPT },
                            { role: "user", content: userContent }
                        ],
                        max_tokens: 1500,
                        temperature: 0.05
                    })
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const json = await res.json();
                    const rawContent = json.choices?.[0]?.message?.content?.trim() || "";
                    const parsed = extractJsonFromResponse(rawContent);
                    if (parsed) {
                        const validated = validateVisionOutput(parsed);
                        if (validated) {
                            validated.message_id = messageId;
                            return { vision: validated, error: null };
                        }
                    }
                } else {
                    console.warn(`Vision model ${model} failed with status ${res.status}`);
                    if (res.status === 401 || res.status === 403 || res.status === 429) continue;
                }
            } catch (err: any) {
                console.warn(`Vision model ${model} error:`, err.message);
                if (err.name === "AbortError") continue;
            }
        }
    }

    return { vision: null, error: "فشل تحليل الصورة - جميع موديلات الرؤية لم تنجح" };
}
