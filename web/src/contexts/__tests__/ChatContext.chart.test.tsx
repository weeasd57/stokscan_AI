/** @jest-environment jsdom */
import React from "react";
import { act, render, cleanup } from "@testing-library/react";
import { TextDecoder, TextEncoder } from "util";
import { ChatProvider, useChat } from "../ChatContext";
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));
let chat: ReturnType<typeof useChat>;
function Probe() {
  chat = useChat();
  return null;
}
const context = (symbol = "COMI") => ({
  active_chart_id: "panel-1",
  charts: [{ id: "panel-1", symbol, timeframe: "1d" }],
});
const signal = (value: unknown) =>
  window.dispatchEvent(
    new CustomEvent("strategy-lab-context", { detail: value }),
  );
const action = {
  type: "apply_strategy",
  chart_id: "panel-1",
  symbol: "COMI",
  result: { analysis: { strategyId: "smc" } },
};
beforeEach(() => {
  localStorage.clear();
  Object.assign(global, { TextDecoder, TextEncoder });
});
afterEach(cleanup);
test.each([false, true])(
  "publishes canonical chart actions for an unchanged workspace (SSE=%s)",
  async (sse) => {
    const receive = jest.fn();
    window.addEventListener("strategy-lab-result", receive);
    const payload = {
      type: "done",
      reply: "تم التحليل",
      chart_actions: [action],
    };
    const encoded = new TextEncoder().encode(
      `event: done\ndata: ${JSON.stringify(payload)}\n\n`,
    );
    const read = jest
      .fn()
      .mockResolvedValueOnce({ done: false, value: encoded })
      .mockResolvedValue({ done: true });
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => (sse ? "text/event-stream" : "application/json"),
        },
        body: sse ? { getReader: () => ({ read }) } : null,
        json: async () => payload,
      });
    render(
      <ChatProvider>
        <Probe />
      </ChatProvider>,
    );
    act(() => signal(context()));
    await act(async () => {
      await chat.sendMessage("طبق SMC");
    });
    expect(
      JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
        .chart_context,
    ).toEqual(context());
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive.mock.calls[0][0].detail).toEqual(action);
    window.removeEventListener("strategy-lab-result", receive);
  },
);
test.each(["roundtrip", "remount"])(
  "rejects a stale result when context changes and returns (%s)",
  async (mode) => {
    let resolve!: (value: unknown) => void;
    global.fetch = jest.fn(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    ) as jest.Mock;
    const receive = jest.fn();
    window.addEventListener("strategy-lab-result", receive);
    render(
      <ChatProvider>
        <Probe />
      </ChatProvider>,
    );
    act(() => signal(context()));
    let pending!: Promise<void>;
    act(() => {
      pending = chat.sendMessage("طبق SMC");
    });
    act(() => {
      signal(mode === "roundtrip" ? context("EAST") : null);
      signal(context());
    });
    await act(async () => {
      resolve({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        body: null,
        json: async () => ({ reply: "تم", chart_actions: [action] }),
      });
      await pending;
    });
    expect(receive).not.toHaveBeenCalled();
    window.removeEventListener("strategy-lab-result", receive);
  },
);
