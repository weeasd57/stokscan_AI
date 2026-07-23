import { SessionState } from "./types";

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
                summary: state.summary || sessionData.title || null
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
        summary: update.summary !== undefined ? update.summary : current.summary
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
