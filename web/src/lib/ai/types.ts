export interface SessionState {
    current_symbol: string | null;
    last_symbols: string[];
    summary: string | null;
    current_sector?: string | null;
    language?: string;
}

export interface PlannerResult {
    intent: string;
    confidence: number;
    entities: {
        symbols: string[];
        sector: string | null;
        wants_table: boolean;
    };
    tools: string[];
    session_update: {
        current_symbol: string | null;
        last_symbols: string[];
        summary: string | null;
    };
}

export interface ToolExecutionResult {
    toolName: string;
    data: any;
    formattedText: string;
}
