import { SessionSummary, FactSnapshot, SessionState } from "./types";

const MAX_HISTORY_MESSAGES = 4;
const MAX_FACT_SNAPSHOTS = 5;

export interface MemoryResult {
    recent_messages: Array<{ role: string; content: string }>;
    session_summary: SessionSummary | null;
    relevant_snapshots: FactSnapshot[];
    resolved_references: {
        symbol: string | null;
        message_id: string | null;
        confidence: number;
    };
}

function resolveReference(
    message: string,
    sessionSummary: SessionSummary | null,
    sessionState: SessionState
): { symbol: string | null; message_id: string | null; confidence: number } {
    const normMsg = message.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").toLowerCase();

    const referenceWords = ["ده", "دا", "دي", "هذا", "السهم ده", "السهم دا", "السهم دي", "ده كده"];
    const hasReference = referenceWords.some(w => normMsg.includes(w));

    if (!hasReference) {
        return { symbol: null, message_id: null, confidence: 0 };
    }

    if (sessionSummary?.last_image_symbols && sessionSummary.last_image_symbols.length > 0) {
        return {
            symbol: sessionSummary.last_image_symbols[0],
            message_id: null,
            confidence: 0.9
        };
    }

    if (sessionState.current_symbol) {
        return {
            symbol: sessionState.current_symbol,
            message_id: null,
            confidence: 0.8
        };
    }

    if (sessionState.last_symbols && sessionState.last_symbols.length > 0) {
        return {
            symbol: sessionState.last_symbols[0],
            message_id: null,
            confidence: 0.7
        };
    }

    return { symbol: null, message_id: null, confidence: 0 };
}

export async function retrieveRelevantMemory(
    message: string,
    sessionSummary: SessionSummary | null,
    sessionState: SessionState,
    history: Array<{ role: string; content: string }>,
    supabase: any,
    userId: string,
    sessionId: string
): Promise<MemoryResult> {
    const resolved = resolveReference(message, sessionSummary, sessionState);

    const recentMessages = history.slice(-MAX_HISTORY_MESSAGES);

    let relevantSnapshots: FactSnapshot[] = [];

    const symbols = new Set<string>();
    if (sessionState.last_symbols) sessionState.last_symbols.forEach(s => symbols.add(s));
    if (sessionSummary?.current_symbols) sessionSummary.current_symbols.forEach(s => symbols.add(s));
    if (resolved.symbol) symbols.add(resolved.symbol);

    if (symbols.size > 0 && supabase) {
        try {
            const symbolArray = Array.from(symbols);
            const { data: snapshots } = await supabase
                .from("ai_chat_facts")
                .select("*")
                .eq("user_id", userId)
                .eq("session_id", sessionId)
                .overlaps("symbols", symbolArray)
                .order("created_at", { ascending: false })
                .limit(MAX_FACT_SNAPSHOTS);

            if (snapshots && snapshots.length > 0) {
                relevantSnapshots = snapshots.map((s: any) => ({
                    context_id: s.context_id,
                    source: s.source || "",
                    symbols: s.symbols || [],
                    as_of: s.as_of || "",
                    facts: s.facts || {},
                    data_type: s.data_type || "live"
                }));
            }
        } catch (e) {
            console.warn("Failed to fetch fact snapshots:", e);
        }
    }

    return {
        recent_messages: recentMessages,
        session_summary: sessionSummary,
        relevant_snapshots: relevantSnapshots,
        resolved_references: resolved
    };
}