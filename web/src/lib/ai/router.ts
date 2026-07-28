import { AI_CONFIG } from "./config";

export function selectOptimalModel(intent: string, symbolCount: number, requestedModel?: string): string {
    if (requestedModel && requestedModel.includes("/")) {
        return requestedModel;
    }
    return AI_CONFIG.models.response.default; // Flash model (meta/llama-3.1-8b-instruct) is default
}
