import { describe, expect, it, jest } from "@jest/globals";
import { createExecutionScope, awaitExecution, withExecutionTimeout, remainingExecutionMs } from "../execution";

describe("execution scope", () => {
  it("rejects a pending operation when the scope deadline expires", async () => {
    await expect(withExecutionTimeout(10, () => new Promise((resolve) => setTimeout(resolve, 100)))).rejects.toBeDefined();
  });

  it("cleans its timer after an operation finishes", async () => {
    jest.useFakeTimers();
    const scope = createExecutionScope(1000);
    await scope.run(() => Promise.resolve("done"));
    expect(remainingExecutionMs()).toBe(Infinity);
    scope.dispose();
    jest.useRealTimers();
  });

  it("forwards parent cancellation", async () => {
    const parent = new AbortController();
    const scope = createExecutionScope(1000, parent.signal);
    const pending = scope.run(() => awaitExecution(new Promise(() => undefined), scope.signal));
    parent.abort(new Error("cancelled"));
    await expect(pending).rejects.toBeDefined();
    scope.dispose();
  });
});
