/**
 * portfolio-flow.ts
 *
 * Per-stock state machine for conversational portfolio entry. The bot asks for
 * one field at a time and never moves to the next stock before the current one
 * is complete. A short reply is bound to the field the machine is waiting on,
 * so a quantity the user types is never reinterpreted as another stock's
 * average price.
 */

export type PortfolioField = "symbol" | "quantity" | "entry_price" | "confirm";

export type PortfolioFlowState =
    | "idle"
    | "awaiting_symbol"
    | "awaiting_quantity"
    | "awaiting_entry_price"
    | "awaiting_confirm"
    | "completed";

export const FLOW_STATE_AR: Record<Exclude<PortfolioFlowState, "idle">, string> = {
    awaiting_symbol: "بانتظار رمز السهم",
    awaiting_quantity: "بانتظار الكمية",
    awaiting_entry_price: "بانتظار متوسط الشراء",
    awaiting_confirm: "جاهز للتأكيد",
    completed: "تمت الإضافة",
};

export interface FlowEntry {
    symbol: string | null;
    quantity: number | null;
    entry_price: number | null;
    state: PortfolioFlowState;
}

export interface PortfolioFlow {
    operation: "add" | "update" | "remove" | "sell";
    queue: FlowEntry[];
    current_index: number;
    updated_at: string;
}

const nextFieldState: Record<Exclude<PortfolioFlowState, "idle" | "completed">, PortfolioFlowState> = {
    awaiting_symbol: "awaiting_quantity",
    awaiting_quantity: "awaiting_entry_price",
    awaiting_entry_price: "awaiting_confirm",
    awaiting_confirm: "completed",
};

export function emptyFlow(operation: PortfolioFlow["operation"] = "add"): PortfolioFlow {
    return { operation, queue: [], current_index: 0, updated_at: new Date().toISOString() };
}

export function beginFlow(operation: PortfolioFlow["operation"], symbols: string[]): PortfolioFlow {
    const queue: FlowEntry[] = (symbols || []).filter(Boolean).map(symbol => ({
        symbol: String(symbol).toUpperCase(),
        quantity: null,
        entry_price: null,
        state: "awaiting_quantity" as PortfolioFlowState,
    }));
    return {
        operation,
        queue,
        current_index: 0,
        updated_at: new Date().toISOString(),
    };
}

export function currentEntry(flow: PortfolioFlow): FlowEntry | null {
    if (!flow || !Array.isArray(flow.queue)) return null;
    return flow.queue[flow.current_index] || null;
}

export function isFlowOpen(flow: PortfolioFlow | null | undefined): boolean {
    if (!flow || !Array.isArray(flow.queue) || flow.queue.length === 0) return false;
    return flow.queue.some(entry => entry.state !== "completed");
}

export function pendingField(entry: FlowEntry | null): PortfolioField | null {
    if (!entry) return null;
    switch (entry.state) {
        case "awaiting_symbol":
            return "symbol";
        case "awaiting_quantity":
            return "quantity";
        case "awaiting_entry_price":
            return "entry_price";
        case "awaiting_confirm":
            return "confirm";
        default:
            return null;
    }
}

/**
 * The question the bot should be on right now. Used to bind a bare number from
 * the user to the correct stock and field, never to a sibling entry.
 */
export function describePending(entry: FlowEntry | null): string | null {
    const field = pendingField(entry);
    if (!entry || !field) return null;
    const symbol = entry.symbol || "السهم";
    switch (field) {
        case "symbol":
            return "اكتب رمز السهم المطلوب إضافته.";
        case "quantity":
            return `كم عدد أسهم ${symbol}؟`;
        case "entry_price":
            return `ما متوسط سعر شراء ${symbol}؟`;
        case "confirm":
            return `${symbol}: الكمية ${entry.quantity} بمتوسط شراء ${entry.entry_price}. أرسل "تم" للتأكيد أو عدّل الرقم المطلوب.`;
        default:
            return null;
    }
}

export interface ApplyResult {
    flow: PortfolioFlow;
    applied: "quantity" | "entry_price" | "confirm" | "symbol" | "none";
    message: string | null;
    /** True when this entry is complete and may be persisted. */
    entry_ready: boolean;
}

function firstNumber(message: string): number | null {
    const normalized = String(message || "")
        .replace(/,/g, "")
        .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
        .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
        .replace(/[٫،]/g, ".");
    const match = normalized.match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
}

function looksLikeConfirmation(message: string): boolean {
    return /^(?:تم|تمام|اوك|أوك|أوكي|اوكى|ok|okay|تمام كده|اتأكد|تأكيد|سجّل|سجل)[!؟?.\s]*$/i.test(String(message || "").trim());
}

/**
 * Applies a user reply to the open flow. The reply is interpreted ONLY against
 * the field the current entry is waiting for, then the machine advances one
 * step. It never jumps to another stock while the current one is incomplete.
 */
export function applyFlowReply(flow: PortfolioFlow, message: string): ApplyResult {
    const working: PortfolioFlow = {
        operation: flow?.operation || "add",
        queue: Array.isArray(flow?.queue) ? flow.queue.map(entry => ({ ...entry })) : [],
        current_index: Number.isInteger(flow?.current_index) ? flow.current_index : 0,
        updated_at: new Date().toISOString(),
    };
    const entry = currentEntry(working);
    if (!entry) {
        return { flow: working, applied: "none", message: "لا توجد عملية محفظة مفتوحة.", entry_ready: false };
    }

    const field = pendingField(entry);
    const value = firstNumber(message);

    if (field === "quantity") {
        if (value == null || value <= 0) {
            return {
                flow: working,
                applied: "none",
                message: `${FLOW_STATE_AR.awaiting_quantity} لسهم ${entry.symbol}: أرسل عدد الأسهم برقم صحيح أكبر من صفر.`,
                entry_ready: false,
            };
        }
        entry.quantity = value;
        entry.state = nextFieldState.awaiting_quantity;
        return {
            flow: working,
            applied: "quantity",
            message: describePending(currentEntry(working)),
            entry_ready: false,
        };
    }

    if (field === "entry_price") {
        if (value == null || value <= 0) {
            return {
                flow: working,
                applied: "none",
                message: `${FLOW_STATE_AR.awaiting_entry_price} لسهم ${entry.symbol}: أرسل متوسط الشراء برقم أكبر من صفر.`,
                entry_ready: false,
            };
        }
        entry.entry_price = value;
        entry.state = nextFieldState.awaiting_entry_price;
        return {
            flow: working,
            applied: "entry_price",
            message: describePending(currentEntry(working)),
            entry_ready: false,
        };
    }

    if (field === "confirm") {
        if (!looksLikeConfirmation(message) && value == null) {
            return {
                flow: working,
                applied: "none",
                message: describePending(entry),
                entry_ready: false,
            };
        }
        entry.state = "completed";
        const nextIndex = working.queue.findIndex(candidate => candidate.state !== "completed");
        working.current_index = nextIndex;
        const next = currentEntry(working);
        return {
            flow: working,
            applied: "confirm",
            message: next ? describePending(next) : "تم تسجيل كل الأسهم المطلوبة.",
            entry_ready: true,
        };
    }

    return { flow: working, applied: "none", message: describePending(entry), entry_ready: false };
}
