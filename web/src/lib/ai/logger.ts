export interface AiTelemetryEvent {
    sessionId: string | null;
    userId?: string | null;
    intent: string;
    symbols: string[];
    plannerModel: string;
    responseModel: string;
    plannerLatencyMs: number;
    toolsLatencyMs: number;
    responseLatencyMs: number;
    totalLatencyMs: number;
    dataSizeChars: number;
    error?: string | null;
}

export async function logAiInteraction(supabase: any, event: AiTelemetryEvent): Promise<void> {
    console.log(`[AI TELEMETRY] Intent=${event.intent} Symbols=${event.symbols.join(",")} Latency=${event.totalLatencyMs}ms Model=${event.responseModel}`);
    try {
        await supabase.from("ai_analytics").insert([{
            session_id: event.sessionId,
            user_id: event.userId || null,
            intent: event.intent,
            symbols: event.symbols,
            planner_model: event.plannerModel,
            response_model: event.responseModel,
            planner_latency_ms: event.plannerLatencyMs,
            tools_latency_ms: event.toolsLatencyMs,
            response_latency_ms: event.responseLatencyMs,
            total_latency_ms: event.totalLatencyMs,
            data_size_chars: event.dataSizeChars,
            error: event.error || null
        }]);
    } catch (e) {
        // Silently log warning so DB table missing never breaks chat response
        console.warn("[AI TELEMETRY] Note: ai_analytics logging skipped or table missing.");
    }
}
