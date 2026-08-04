import { AI_CONFIG } from "./config";

export function selectOptimalModel(intent: string, symbolCount: number, requestedModel?: string): string {
    const allowed = new Set([AI_CONFIG.models.response.default, ...AI_CONFIG.models.response.fallbacks, ...AI_CONFIG.models.response.agentRouter]);
    if (requestedModel && allowed.has(requestedModel)) {
        return requestedModel;
    }
    return AI_CONFIG.models.response.default; // Flash model (meta/llama-3.1-8b-instruct) is default
}
