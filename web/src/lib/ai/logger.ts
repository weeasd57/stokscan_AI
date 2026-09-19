export interface AiTelemetryEvent {
    sessionId: string | null;
    userId?: string | null;
    intent: string;
    symbols: string[];
    plannerModel: string;
    responseModel: string;
    plannerLatencyMs: number | null;
    toolsLatencyMs: number | null;
    responseLatencyMs: number | null;
    totalLatencyMs: number;
    dataSizeChars: number;
    correlationId?: string;
    error?: string | null;
}

export async function logAiInteraction(supabase: any, event: AiTelemetryEvent): Promise<void> {
    console.log(`[AI TELEMETRY] Correlation=${event.correlationId || "n/a"} Intent=${event.intent} Symbols=${event.symbols.join(",")} Latency=${event.totalLatencyMs}ms Model=${event.responseModel}`);
    try {
        const { error } = await supabase.from("ai_analytics").insert([{
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
            correlation_id: event.correlationId || null,
            error: event.error || null
        }]);
        if (error) {
            console.warn(`[AI TELEMETRY] Persistence failed (${error.code || "unknown"}): ${error.message || "unknown database error"}`);
        }
    } catch (error: any) {
        // Telemetry must never break the chat response, but the server log must
        // preserve enough detail to distinguish a missing table from an outage.
        console.warn(`[AI TELEMETRY] Persistence threw: ${error?.message || String(error)}`);
    }
}
