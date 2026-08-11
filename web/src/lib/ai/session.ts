import { SessionState, SessionSummary, VisionContext } from "./types";

export async function loadSessionState(supabase: any, sessionId: string, userId: string): Promise<SessionState> {
    if (!sessionId) {
        return { current_symbol: null, last_symbols: [], summary: null };
    }

    try {
        const { data: sessionData } = await supabase
            .from("ai_chat_sessions")
            .select("title, state")
            .eq("id", sessionId)
            .eq("user_id", userId)
            .maybeSingle();

        if (sessionData?.state) {
            const state = sessionData.state as any;
            return {
                current_symbol: state.current_symbol || null,
                last_symbols: Array.isArray(state.last_symbols) ? state.last_symbols : [],
                summary: state.summary || sessionData.title || null,
                current_sector: state.current_sector || null,
                language: state.language || "ar",
                investment_budget: state.investment_budget ?? null,
                investment_horizon: state.investment_horizon ?? null,
                risk_tolerance: state.risk_tolerance ?? null,
                preferred_sectors: Array.isArray(state.preferred_sectors) ? state.preferred_sectors : []
            };
        }

        return {
            current_symbol: null,
            last_symbols: [],
            summary: sessionData?.title || null
        };
    } catch (e) {
        console.warn("Failed to load session state from Supabase:", e);
        return { current_symbol: null, last_symbols: [], summary: null };
    }
}

export async function loadSessionSummary(supabase: any, sessionId: string, userId: string): Promise<SessionSummary | null> {
    if (!sessionId) return null;
    try {
        const { data } = await supabase
            .from("ai_chat_sessions")
            .select("summary_state")
            .eq("id", sessionId)
            .eq("user_id", userId)
            .maybeSingle();
        if (data?.summary_state) {
            return data.summary_state as SessionSummary;
        }
    } catch (e) {
        console.warn("Failed to load session summary:", e);
    }
    return null;
}

export async function updateSessionSummary(
    supabase: any,
    sessionId: string,
    userId: string,
    update: Partial<SessionSummary>
): Promise<void> {
    if (!sessionId) return;
    const current = await loadSessionSummary(supabase, sessionId, userId);
    const merged: SessionSummary = {
        current_symbols: update.current_symbols || current?.current_symbols || [],
        last_image_symbols: update.last_image_symbols || current?.last_image_symbols || [],
        last_topic: update.last_topic !== undefined ? update.last_topic : (current?.last_topic || null),
        open_references: update.open_references || current?.open_references || [],
        last_data_date: update.last_data_date !== undefined ? update.last_data_date : (current?.last_data_date || null),
        last_vision_context: update.last_vision_context !== undefined ? update.last_vision_context : (current?.last_vision_context || null),
        updated_at: new Date().toISOString()
    };
    try {
        await supabase
            .from("ai_chat_sessions")
            .update({ summary_state: merged })
            .eq("id", sessionId)
            .eq("user_id", userId);
    } catch (e) {
        console.warn("Failed to update session summary:", e);
    }
}

export async function updateSessionState(
    supabase: any,
    sessionId: string,
    userId: string,
    update: Partial<SessionState>
): Promise<SessionState> {
    if (!sessionId) return { current_symbol: null, last_symbols: [], summary: null };

    const current = await loadSessionState(supabase, sessionId, userId);
    const updated: SessionState = {
        current_symbol: update.current_symbol !== undefined ? update.current_symbol : current.current_symbol,
        last_symbols: update.last_symbols 
            ? Array.from(new Set([...update.last_symbols, ...(current.last_symbols || [])])).slice(0, 15) 
            : current.last_symbols,
        summary: update.summary !== undefined ? update.summary : current.summary,
        current_sector: update.current_sector !== undefined ? update.current_sector : current.current_sector,
        investment_budget: update.investment_budget !== undefined ? update.investment_budget : current.investment_budget,
        investment_horizon: update.investment_horizon !== undefined ? update.investment_horizon : current.investment_horizon,
        risk_tolerance: update.risk_tolerance !== undefined ? update.risk_tolerance : current.risk_tolerance,
        preferred_sectors: update.preferred_sectors
            ? Array.from(new Set([...(current.preferred_sectors || []), ...update.preferred_sectors]))
            : current.preferred_sectors
    };

    try {
        await supabase
            .from("ai_chat_sessions")
            .update({
                state: updated,
                updated_at: new Date().toISOString()
            })
            .eq("id", sessionId)
            .eq("user_id", userId);
    } catch (e) {
        console.warn("Failed to update session state in Supabase:", e);
    }

    return updated;
}
