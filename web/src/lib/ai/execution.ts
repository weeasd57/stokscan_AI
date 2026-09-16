import { AsyncLocalStorage } from "node:async_hooks";

interface ExecutionScope { signal: AbortSignal; deadlineAt: number }
const execution = new AsyncLocalStorage<ExecutionScope>();

export function getExecutionSignal(): AbortSignal | undefined {
    return execution.getStore()?.signal;
}

export function remainingExecutionMs(): number {
    return Math.max(0, (execution.getStore()?.deadlineAt ?? Infinity) - Date.now());
}

export function throwIfExecutionAborted(): void {
    getExecutionSignal()?.throwIfAborted();
}

export function createExecutionScope(timeoutMs: number, parent = getExecutionSignal()) {
    const controller = new AbortController();
    const duration = Math.max(1, Math.min(timeoutMs, remainingExecutionMs()));
    const deadlineAt = Date.now() + duration;
    const forwardAbort = () => controller.abort(parent?.reason);
    if (parent?.aborted) forwardAbort();
    else parent?.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("PIPELINE_DEADLINE_EXCEEDED")), duration);
    return {
        signal: controller.signal,
        run<T>(fn: () => T): T { return execution.run({ signal: controller.signal, deadlineAt }, fn); },
        dispose() {
            clearTimeout(timer);
            parent?.removeEventListener("abort", forwardAbort);
            controller.abort(new Error("EXECUTION_COMPLETE"));
        },
    };
}

// Reject promptly even when a third-party promise ignores cancellation. Attach
// both handlers so a late rejection cannot become an unhandled rejection.
export function awaitExecution<T>(promise: PromiseLike<T>, signal = getExecutionSignal()): Promise<T> {
    if (!signal) return Promise.resolve(promise);
    return new Promise<T>((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new Error("EXECUTION_ABORTED"));
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
        if (signal.aborted) { signal.removeEventListener("abort", abort); abort(); }
    });
}

export async function withExecutionTimeout<T>(timeoutMs: number, fn: () => Promise<T>): Promise<T> {
    const scope = createExecutionScope(timeoutMs);
    try { return await scope.run(() => awaitExecution(fn(), scope.signal)); }
    finally { scope.dispose(); }
}

export function executionFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    throwIfExecutionAborted();
    const parent = getExecutionSignal();
    const signals = [parent, init?.signal, input instanceof Request ? input.signal : undefined]
        .filter((signal): signal is AbortSignal => Boolean(signal));
    return fetch(input, { ...init, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) });
}

/** Apply cancellation at query execution, including queries started in a child
 * tool budget. Never mutate the shared Supabase client or its global fetch. */
export function executionSupabase<T>(client: T): T {
    if (!client || typeof client !== "object") return client;
    const wrapQuery = (query: any): any => {
        if (!query || typeof query !== "object") return query;
        return new Proxy(query, {
            get(target, key) {
                const value = Reflect.get(target, key, target);
                if (typeof value !== "function") return value;
                if (key === "then") return (resolve: any, reject: any) => {
                    const signal = getExecutionSignal();
                    const pending = Promise.resolve().then(() => {
                        signal?.throwIfAborted();
                        if (signal && typeof target.abortSignal === "function") target.abortSignal(signal);
                        return target;
                    });
                    return awaitExecution(pending, signal).then(resolve, reject);
                };
                return (...args: any[]) => {
                    throwIfExecutionAborted();
                    const result = value.apply(target, args);
                    return result && typeof result === "object" && (typeof result.then === "function" || typeof result.select === "function")
                        ? wrapQuery(result) : result;
                };
            },
        });
    };
    return new Proxy(client as object, {
        get(target, key) {
            const value = Reflect.get(target, key, target);
            if (typeof value !== "function") return value;
            return (...args: any[]) => {
                throwIfExecutionAborted();
                const result = value.apply(target, args);
                return key === "from" || key === "rpc" ? wrapQuery(result) : result;
            };
        },
    }) as T;
}
