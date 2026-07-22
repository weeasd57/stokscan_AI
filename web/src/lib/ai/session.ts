import { SessionState } from "./types";

const memoryStore = new Map<string, SessionState>();

export async function loadSessionState(supabase: any, sessionId: string, userId: string): Promise<SessionState> {
    if (!sessionId) {
        return { current_symbol: null, last_symbols: [], summary: null };
    }

    if (memoryStore.has(sessionId)) {
        return memoryStore.get(sessionId)!;
    }

    try {
        const { data: sessionData } = await supabase
            .from("ai_chat_sessions")
            .select("title, updated_at")
            .eq("id", sessionId)
            .maybeSingle();

        const state: SessionState = {
            current_symbol: null,
            last_symbols: [],
            summary: sessionData?.title || null
        };

        memoryStore.set(sessionId, state);
        return state;
    } catch (e) {
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
            ? Array.from(new Set([...update.last_symbols, ...(current.last_symbols || [])])).slice(0, 5) 
            : current.last_symbols,
        summary: update.summary !== undefined ? update.summary : current.summary
    };

    memoryStore.set(sessionId, updated);
    return updated;
}
