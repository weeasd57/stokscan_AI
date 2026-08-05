export interface SessionState {
    current_symbol: string | null;
    last_symbols: string[];
    summary: string | null;
    current_sector?: string | null;
    language?: string;
}

export interface VisionContext {
    image_type: "portfolio" | "chart" | "market_depth" | "table" | "unknown";
    symbols: Array<{
        symbol: string;
        name: string;
        visible_values: {
            price: number | null;
            change_pct: number | null;
            quantity: number | null;
        };
    }>;
    technical_observations: Array<{
        symbol: string;
        indicator: string;
        value: number | null;
        meaning: string;
    }>;
    market_depth: {
        total_bid: number | null;
        total_ask: number | null;
        spread: number | null;
    };
    user_relevant_summary: string;
    uncertainties: string[];
    confidence: number;
    analyzed_at: string;
    message_id: string;
}

export interface SessionSummary {
    current_symbols: string[];
    last_image_symbols: string[];
    last_topic: string | null;
    open_references: string[];
    last_data_date: string | null;
    last_vision_context: VisionContext | null;
    updated_at: string;
}

export interface FactSnapshot {
    context_id: string;
    source: string;
    symbols: string[];
    as_of: string;
    facts: Record<string, any>;
    data_type: "live" | "historical" | "image-derived";
}

export interface IntentPlan {
    intent: "image_analysis" | "stock_analysis" | "stock_news" | "levels_analysis" | "risk_analysis" | "sector_analysis" | "comparison" | "historical_recall" | "market_summary" | "accumulation_distribution" | "current_data" | "previous_analysis_comparison" | "follow_up" | "clarification" | "general_chat";
    confidence: number;
    guidance_intent?: "onboarding" | "allocation" | "product_comparison" | "product_explainer" | null;
    entities: {
        symbols: string[];
        sector: string | null;
        timeframe: "current" | "historical" | "unspecified";
        reference: "last_image" | "last_stock" | "previous_analysis" | null;
        scan_direction?: "accumulation" | "distribution" | null;
        fair_value_direction?: "above" | "below" | null;
        require_distribution?: boolean;
        require_accumulation?: boolean;
        recommendation_order?: "oldest" | "newest" | null;
        requested_date?: string | null;
        requested_start_date?: string | null;
        requested_end_date?: string | null;
    };
    needs_vision_context: boolean;
    needs_history: boolean;
    needs_live_data: boolean;
    needs_historical_data: boolean;
    tools: string[];
    clarification_needed: boolean;
    service_degraded_message?: string | null;
    resolved_from: {
        symbol: string | null;
        message_id: string | null;
    };
}

export interface ToolResult {
    tool: string;
    source: string;
    data_time: string;
    symbols: string[];
    data_type: "live" | "historical" | "image-derived";
    data: any;
    error?: string;
}

export interface PipelineContext {
    user_message: string;
    images: string[];
    session_id: string;
    user_id: string;
    history: Array<{ role: string; content: string }>;
    session_state: SessionState;
    session_summary: SessionSummary | null;
    vision_context: VisionContext | null;
    relevant_facts: FactSnapshot[];
    intent_plan: IntentPlan | null;
    tool_results: ToolResult[];
}

export interface PlannerResult {
    intent: string;
    confidence: number;
    guidance_intent?: "onboarding" | "allocation" | "product_comparison" | "product_explainer" | null;
    entities: {
        symbols: string[];
        sector: string | null;
        wants_table: boolean;
        timeframe?: string | null;
        requested_date?: string | null;
        scan_direction?: "accumulation" | "distribution" | null;
        fair_value_direction?: "above" | "below" | null;
        require_distribution?: boolean;
        require_accumulation?: boolean;
        recommendation_order?: "oldest" | "newest" | null;
    };
    tools: string[];
    image_summary?: string | null;
    service_degraded_message?: string | null;
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
