import { AI_CONFIG } from "./config";

export function selectOptimalModel(intent: string, symbolCount: number, requestedModel?: string): string {
    if (requestedModel && requestedModel.includes("/")) {
        return requestedModel;
    }
    if (intent === "general_chat") {
        return AI_CONFIG.models.response.default; // Llama 8b for fast chat
    }
    if (symbolCount > 2) {
        return "meta/llama-3.1-70b-instruct"; // 70b for complex multi-stock comparison
    }
    return AI_CONFIG.models.response.default;
}
