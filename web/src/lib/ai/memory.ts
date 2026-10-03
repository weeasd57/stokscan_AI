import { SessionSummary, FactSnapshot, SessionState } from "./types";
import { extractSymbolsFromText, getSyncStockMappings, getSyncValidSymbols, isUnresolvedCompanyNameMention } from "./planner";

const MAX_HISTORY_MESSAGES = 30;
const MAX_FACT_SNAPSHOTS = 5;

export interface ResolvedMemoryReference {
    symbol: string | null;
    message_id: string | null;
    confidence: number;
    requires_clarification?: boolean;
    candidates?: string[];
}

export interface MemoryResult {
    recent_messages: Array<{ role: string; content: string }>;
    session_summary: SessionSummary | null;
    relevant_snapshots: FactSnapshot[];
    resolved_references: ResolvedMemoryReference;
}

function normalizeReferenceText(message: string): string {
    return message.replace(/[\u064B-\u065F\u0670]/g, "").replace(/\u0640/g, "")
        .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").toLowerCase().trim();
}

// These requests change the subject. Trading words inside a definition or a
// market question do not make it a reference to the last stock.
function isOutsideStockReference(message: string): boolean {
    const norm = normalizeReferenceText(message);
    return /(?:يعني\s+ايه|ايه\s+معني|ما\s+معني|ما\s+هو|ما\s+هي|تعريف|معني|اشرح|explain|what\s+is|define)/i.test(norm)
        || /(?:السوق|البورصه|القطاع|القطاعات|المؤشر|المؤشرات|محفظ|الذهب|الدولار|صندوق|صناديق|اسهم|الاسهم|market|index|portfolio)/i.test(norm);
}

function uniqueSymbols(symbols: string[] | undefined): string[] {
    return Array.from(new Set((symbols || []).filter(Boolean).map(symbol => symbol.toUpperCase())));
}

function hasUnresolvedStockName(message: string, symbols: string[]): boolean {
    return isUnresolvedCompanyNameMention(message, symbols)
        || (symbols.length === 0
            && /(?:سهم|شركه)\s+(?!(?:ده|دا|دي|هذا|فيه|ليه|عنه)(?:\s|$))\S+/i.test(normalizeReferenceText(message)));
}

const REFERENCE_PATTERN = /(?:^|[^\u0621-\u064A])(السهم\s+(?:ده|دا|دي)|ده\s+كده|ده|دا|دي|هذا)(?:$|[^\u0621-\u064A])/;
const FOLLOW_UP_PATTERN = /^(?:(?:طيب|طب|و|هو)\s+)*(?:(?:متي|امتي|فين|كام)\s+(?:اشتري|ادخل|ابيع|اخرج)|(?:اشتري|ادخل|ابيع|اخرج)\s+(?:امتي|متي|فين)|هل\s+(?:ادخل|اشتري|ابيع|اخرج|اعمل\s+متوسط)|(?:ادخل|اشتري|ابيع|اخرج)\s+(?:دلوقتي|الان|حاليا)|(?:وقف\s*(?:ال)?خسار(?:[هة]|ت[هة])?|ستوب\s*لوس|الستوب(?:\s*لوس)?|stop\s*loss)(?:\s+كام)?|(?:الهدف|مستهدف[هة]?|هدفه|هدفها|تارجت|target)(?:\s+(?:بتاعه|كام|ايه))?|(?:رايك|توقعاتك|نظرتك)(?:\s+ايه)?(?:\s+(?:فيه|ليه|له|عنه))?|(?:اشتريه?|ادخله?)\s+ولا\s+(?:ابيعه?|استني)|(?:ابيعه?|اخرج)\s+ولا\s+(?:استني|احتفظ|اكمل)|(?:اشتري|ادخل)\s+ولا\s+(?:استني|احتفظ)|(?:اعمل|اعدل)\s+متوسط|(?:دعمه|مقاومته|الدعم|المقاوم[هة])\s+كام)(?:\s+(?:دلوقتي|بكره|حاليا))?[؟?!.,\s]*$/i;

export function isStockFollowUpReference(message: string): boolean {
    if (isOutsideStockReference(message)) return false;
    const norm = normalizeReferenceText(message);
    return REFERENCE_PATTERN.test(norm) || FOLLOW_UP_PATTERN.test(norm);
}

function resolveReference(
    message: string,
    sessionSummary: SessionSummary | null,
    sessionState: SessionState,
    history: Array<{ role: string; content: string }>
): ResolvedMemoryReference {
    const unresolved = { symbol: null, message_id: null, confidence: 0 };
    const normMsg = normalizeReferenceText(message);

    if (isOutsideStockReference(message)) return unresolved;

    const hasReference = REFERENCE_PATTERN.test(normMsg);
    const hasFollowUpReference = FOLLOW_UP_PATTERN.test(normMsg);

    if (!hasReference && !hasFollowUpReference) {
        return unresolved;
    }

    const validSymbols = getSyncValidSymbols();
    const mappings = getSyncStockMappings();
    const explicitSymbols = extractSymbolsFromText(message, validSymbols, mappings);
    const comparesReference = hasReference && /(?:قارن|مقارن|compare)/i.test(normMsg);
    // The planner owns explicitly named stocks. Memory may contribute the other
    // side of a comparison, but must not add the previous stock to a new request.
    if ((explicitSymbols.length > 0 && !comparesReference)
        || hasUnresolvedStockName(message, explicitSymbols)) {
        return unresolved;
    }

    const resolve = (symbols: string[], confidence: number): ResolvedMemoryReference => symbols.length === 1
        ? { symbol: symbols[0], message_id: null, confidence }
        : symbols.length > 1
            ? { ...unresolved, requires_clarification: true, candidates: symbols }
            : unresolved;

    if (/(?:الصوره|الشارت|screenshot|chart)/i.test(normMsg)) {
        return resolve(uniqueSymbols(sessionSummary?.last_image_symbols), 0.8);
    }

    // User turns establish focus; assistant lists and incidental ticker mentions
    // cannot silently choose a stock on the user's behalf.
    for (const turn of history.slice(-MAX_HISTORY_MESSAGES).reverse()) {
        if (turn.role !== "user") continue;
        const symbols = extractSymbolsFromText(turn.content, validSymbols, mappings);
        if (isOutsideStockReference(turn.content)) {
            // A plural stock list can establish an ambiguous set; a later
            // market/definition turn clears the old single-stock reference.
            if (/(?:اسهم|الاسهم)/i.test(normalizeReferenceText(turn.content)) && symbols.length > 1) {
                return resolve(uniqueSymbols(symbols), 0);
            }
            const active = uniqueSymbols(sessionSummary?.current_symbols);
            return active.length > 1 ? resolve(active, 0) : unresolved;
        }
        if (symbols.length) return resolve(uniqueSymbols(symbols), 0.95);
        if (hasUnresolvedStockName(turn.content, symbols)) return unresolved;
    }

    const activeSymbols = uniqueSymbols(sessionSummary?.current_symbols);
    if (activeSymbols.length > 1) return resolve(activeSymbols, 0);
    if (activeSymbols.length === 0 && sessionSummary?.last_reference_source === "image"
        && uniqueSymbols(sessionSummary.last_image_symbols).length > 1) return resolve(uniqueSymbols(sessionSummary.last_image_symbols), 0);
    const recordedReference = sessionSummary?.last_reference_symbol;
    if (recordedReference && sessionSummary?.last_reference_source !== "image") {
        const candidates = uniqueSymbols([...activeSymbols, recordedReference]);
        if (candidates.length > 1) return resolve(candidates, 0);
        // An updated current stock is stronger than a legacy, undated summary.
        if (sessionState.current_symbol && sessionState.current_symbol !== recordedReference) {
            return resolve(uniqueSymbols([sessionState.current_symbol]), 0.85);
        }
        return resolve(candidates, 0.9);
    }
    if (activeSymbols.length === 1) return resolve(activeSymbols, 0.85);
    if (sessionState.current_symbol) return resolve(uniqueSymbols([sessionState.current_symbol]), 0.85);
    if (sessionState.last_symbols?.length) return resolve(uniqueSymbols(sessionState.last_symbols), 0.75);
    return resolve(uniqueSymbols(sessionSummary?.last_image_symbols), 0.8);
}

export async function retrieveRelevantMemory(
    message: string,
    sessionSummary: SessionSummary | null,
    sessionState: SessionState,
    history: Array<{ role: string; content: string }>,
    supabase: any,
    userId: string,
    sessionId: string,
    options: { symbols?: string[]; includeSnapshots?: boolean } = {}
): Promise<MemoryResult> {
    const resolved = resolveReference(message, sessionSummary, sessionState, history);

    const recentMessages = history.slice(-MAX_HISTORY_MESSAGES);

    let relevantSnapshots: FactSnapshot[] = [];

    const symbols = new Set<string>(options.symbols || []);
    if (resolved.symbol) symbols.add(resolved.symbol);

    if (options.includeSnapshots !== false && symbols.size > 0 && supabase) {
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
