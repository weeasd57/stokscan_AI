import { AI_CONFIG } from "./config";

export function selectOptimalModel(intent: string, symbolCount: number, requestedModel?: string): string {
    const allowed = new Set([
        AI_CONFIG.models.response.default,
        ...AI_CONFIG.models.response.fallbacks,
        ...AI_CONFIG.models.response.allowedUserModels
    ]);
    if (requestedModel && allowed.has(requestedModel)) {
        return requestedModel;
    }
    return AI_CONFIG.models.response.default; // DeepSeek Flash is the default responder
}
