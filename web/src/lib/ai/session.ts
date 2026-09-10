import { SessionState, SessionSummary, VisionContext } from "./types";

export async function loadSessionState(supabase: any, sessionId: string, userId: string): Promise<SessionState> {
    if (!sessionId) {
        return { current_symbol: null, last_symbols: [], summary: null, current_sector: null, persisted: false };
    }

    try {
        const { data: sessionData, error } = await supabase
            .from("ai_chat_sessions")
            .select("title, state")
            .eq("id", sessionId)
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            console.warn("Failed to load session state from Supabase:", error);
            return { current_symbol: null, last_symbols: [], summary: null, current_sector: null, persisted: false };
        }
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
                preferred_sectors: Array.isArray(state.preferred_sectors) ? state.preferred_sectors : [],
                experience_level: state.experience_level || null,
                persisted: true
            };
        }

        return {
            current_symbol: null,
            last_symbols: [],
            summary: sessionData?.title || null,
            current_sector: null,
            persisted: true
        };
    } catch (e) {
        console.warn("Failed to load session state from Supabase:", e);
        return { current_symbol: null, last_symbols: [], summary: null, current_sector: null, persisted: false };
    }
}

export async function loadPersistentInvestorProfile(supabase: any, userId: string): Promise<Partial<SessionState>> {
    if (!supabase || !userId) return {};
    try {
        const { data, error } = await supabase
            .from("ai_chat_facts")
            .select("facts,created_at")
            .eq("user_id", userId)
            .eq("source", "investor_profile")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
        return data?.facts && typeof data.facts === "object" ? data.facts : {};
    } catch (error) {
        console.warn("Failed to load persistent investor profile:", error);
        return {};
    }
}

export async function loadSessionSummary(supabase: any, sessionId: string, userId: string): Promise<SessionSummary | null> {
    if (!sessionId) return null;
    try {
        const { data, error } = await supabase
            .from("ai_chat_sessions")
            .select("summary_state")
            .eq("id", sessionId)
            .eq("user_id", userId)
            .maybeSingle();
        if (error) {
            console.warn("Failed to load session summary:", error);
            return null;
        }
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
): Promise<boolean> {
    if (!sessionId) return false;
    let current: SessionSummary | null = null;
    try {
        const { data, error } = await supabase
            .from("ai_chat_sessions")
            .select("summary_state")
            .eq("id", sessionId)
            .eq("user_id", userId)
            .maybeSingle();
        if (error) return false;
        current = data?.summary_state || null;
    } catch (e) {
        console.warn("Failed to read session summary before update:", e);
        return false;
    }
    const merged: SessionSummary = {
        current_symbols: update.current_symbols || current?.current_symbols || [],
        last_image_symbols: update.last_image_symbols || current?.last_image_symbols || [],
        last_topic: update.last_topic !== undefined ? update.last_topic : (current?.last_topic || null),
        open_references: update.open_references || current?.open_references || [],
        last_data_date: update.last_data_date !== undefined ? update.last_data_date : (current?.last_data_date || null),
        last_vision_context: update.last_vision_context !== undefined ? update.last_vision_context : (current?.last_vision_context || null),
        pending_portfolio_import: update.pending_portfolio_import !== undefined
            ? update.pending_portfolio_import
            : (current?.pending_portfolio_import || null),
        updated_at: new Date().toISOString()
    };
    try {
        const { data, error } = await supabase
            .from("ai_chat_sessions")
            .update({ summary_state: merged })
            .eq("id", sessionId)
            .eq("user_id", userId)
            .select("id")
            .maybeSingle();
        if (error || !data?.id) {
            console.warn("Failed to update session summary:", error);
            return false;
        }
        return true;
    } catch (e) {
        console.warn("Failed to update session summary:", e);
        return false;
    }
}

export async function updateSessionState(
    supabase: any,
    sessionId: string,
    userId: string,
    update: Partial<SessionState>
): Promise<SessionState> {
    if (!sessionId) return { current_symbol: null, last_symbols: [], summary: null, persisted: false };

    const current = await loadSessionState(supabase, sessionId, userId);
    if (current.persisted === false) return current;
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
            : current.preferred_sectors,
        experience_level: update.experience_level !== undefined ? update.experience_level : current.experience_level
    };

    try {
        const { data, error } = await supabase
            .from("ai_chat_sessions")
            .update({
                state: updated,
                updated_at: new Date().toISOString()
            })
            .eq("id", sessionId)
            .eq("user_id", userId)
            .select("id")
            .maybeSingle();
        if (error || !data?.id) {
            console.warn("Failed to verify session state update:", error || "no matching session");
            return { ...updated, persisted: false };
        }
        return { ...updated, persisted: true };
    } catch (e) {
        console.warn("Failed to update session state in Supabase:", e);
        return { ...updated, persisted: false };
    }
}
