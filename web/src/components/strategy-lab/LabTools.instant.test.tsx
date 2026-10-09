/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import LabTools from "./LabTools";
import { compareStrategies } from "@/lib/strategy-lab";
import type { LabPanel } from "./workspace-state";
jest.mock("./StrategyWorkspace", () => ({
  useLabCandles: () => ({
    candles: Array.from({ length: 100 }, (_, i) => ({
      time: 1700000000 + i * 86400,
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 1000,
    })),
    loading: false,
    error: "",
  }),
}));
jest.mock("./LabDialogShell", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock("@/lib/strategy-lab", () => {
  const actual = jest.requireActual("@/lib/strategy-lab");
  return { ...actual, compareStrategies: jest.fn(actual.compareStrategies) };
});
const panel: LabPanel = {
  id: "panel-1",
  symbol: "COMI",
  exchange: "EGX",
  timeframe: "1D",
  period: 500,
  strategyIds: ["smc", "price_action"],
};
const candles = Array.from({ length: 100 }, (_, i) => ({
  time: 1700000000 + i * 86400,
  open: 100 + i,
  high: 102 + i,
  low: 99 + i,
  close: 101 + i,
  volume: 1000,
}));
const calculate = jest.requireActual("@/lib/strategy-lab").compareStrategies;
function props(extra: Record<string, unknown> = {}) {
  return {
    panel,
    tool: "compare",
    ar: false,
    onClose: jest.fn(),
    onUpdate: jest.fn(),
    onApplyComparison: jest.fn(),
    ...extra,
  };
}
afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});
test("changing strategy selections updates comparison immediately without Draw", () => {
  render(<LabTools {...props()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Trend / MACD" }));
  expect(compareStrategies).toHaveBeenLastCalledWith(
    expect.any(Array),
    ["smc", "price_action", "trend_macd"],
    expect.any(Object),
  );
  expect(screen.getAllByRole("row")).toHaveLength(4);
  fireEvent.click(screen.getByRole("checkbox", { name: "Market structure" }));
  expect(screen.getAllByRole("row")).toHaveLength(3);
});
test.each([
  ["Capital (EGP)", "50000", "initialCapital", 50000],
  ["Commission (bps)", "40", "commissionBps", 40],
  ["Slippage (bps)", "30", "slippageBps", 30],
  ["Lookback", "5", "lookback", 5],
])(
  "editing %s invalidates AI view and recalculates immediately",
  (label, value, key, expected) => {
    const server = calculate(candles, ["smc", "price_action"], {
      initialCapital: 25000,
    });
    server.results[0].metrics.totalReturnPct = 987.65;
    const p = props({
      serverComparison: server,
      serverAssumptions: {
        initialCapital: 25000,
        commissionBps: 20,
        slippageBps: 15,
        params: { lookback: 10 },
      },
    });
    render(<LabTools {...p} />);
    expect(screen.getByText("987.65")).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "Capital (EGP)" }),
    ).toHaveValue(25000);
    fireEvent.change(screen.getByRole("spinbutton", { name: label }), {
      target: { value },
    });
    expect(screen.queryByText("987.65")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Results update immediately",
    );
    const opts = (compareStrategies as jest.Mock).mock.calls.at(-1)![2];
    expect(key === "lookback" ? opts.params.lookback : opts[key]).toBe(
      expected,
    );
    expect(p.onUpdate).toHaveBeenCalledWith({
      comparisonSettings: expect.objectContaining({ [key]: expected }),
    });
  },
);
test("window changes take effect and empty invalid numeric input hides results", () => {
  render(<LabTools {...props()} />);
  fireEvent.change(
    screen.getByRole("combobox", { name: "Comparison window" }),
    { target: { value: "all" } },
  );
  expect((compareStrategies as jest.Mock).mock.calls.at(-1)![0]).toHaveLength(
    100,
  );
  fireEvent.change(
    screen.getByRole("combobox", { name: "Comparison window" }),
    { target: { value: "holdout" } },
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Excluded tuning window %" }),
    { target: { value: "50" } },
  );
  expect((compareStrategies as jest.Mock).mock.calls.at(-1)![0]).toHaveLength(
    50,
  );
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Excluded tuning window %" }),
    { target: { value: "" } },
  );
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
test("saved valid comparison draft restores on reopening; prop echoes do not reset edits", () => {
  const saved = {
    strategyIds: ["trend_macd"] as const,
    initialCapital: 45000,
    commissionBps: 25,
    slippageBps: 5,
    lookback: 8,
    split: 50,
    testWindow: "all" as const,
  };
  const p = props({
    panel: {
      ...panel,
      strategyIds: [...saved.strategyIds],
      comparisonSettings: { ...saved, strategyIds: [...saved.strategyIds] },
    },
  });
  const { rerender } = render(<LabTools {...p} />);
  expect(screen.getByRole("spinbutton", { name: "Lookback" })).toHaveValue(8);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Lookback" }), {
    target: { value: "6" },
  });
  const updated = [...(p.onUpdate as jest.Mock).mock.calls]
    .reverse()
    .find((call) => call[0].comparisonSettings)![0].comparisonSettings;
  rerender(
    <LabTools
      {...p}
      panel={{
        ...panel,
        strategyIds: updated.strategyIds,
        comparisonSettings: updated,
      }}
    />,
  );
  expect(screen.getByRole("spinbutton", { name: "Lookback" })).toHaveValue(6);
  cleanup();
  render(
    <LabTools
      {...p}
      panel={{
        ...panel,
        strategyIds: updated.strategyIds,
        comparisonSettings: updated,
      }}
    />,
  );
  expect(screen.getByRole("spinbutton", { name: "Lookback" })).toHaveValue(6);
  expect(screen.getByRole("checkbox", { name: "Trend / MACD" })).toBeChecked();
});
test("new external selected strategies synchronize without resetting numeric settings", () => {
  const p = props(),
    { rerender } = render(<LabTools {...p} />);
  rerender(
    <LabTools {...p} panel={{ ...panel, strategyIds: ["trend_macd"] }} />,
  );
  expect(screen.getByRole("checkbox", { name: "Trend / MACD" })).toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "Market structure" }));
  rerender(
    <LabTools {...p} panel={{ ...panel, strategyIds: ["price_action"] }} />,
  );
  expect(
    screen.getByRole("checkbox", { name: "Market structure" }),
  ).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Price action" })).toBeChecked();
});
test("closing and reopening compares newly added chart strategies even with an older saved draft", () => {
  render(
    <LabTools
      {...props({
        panel: {
          ...panel,
          strategyIds: ["smc", "trend_macd"],
          comparisonSettings: {
            strategyIds: ["smc"],
            initialCapital: 35000,
            commissionBps: 10,
            slippageBps: 10,
            lookback: 5,
            split: 50,
            testWindow: "all",
          },
        },
      })}
    />,
  );
  expect(screen.getByRole("checkbox", { name: "Trend / MACD" })).toBeChecked();
  expect(screen.getByRole("spinbutton", { name: "Capital (EGP)" })).toHaveValue(
    35000,
  );
});
test("invalid inputs clear old comparison executions and invalidate summary without removing other groups", () => {
  const onInvalidateComparison = jest.fn(),
    p = props({
      onInvalidateComparison,
      panel: {
        ...panel,
        toolOverlays: [
          {
            id: "old-trade",
            label: "Old",
            group: "compare",
            kind: "time",
            points: [{ time: 1700000000, value: 100 }],
          },
          {
            id: "trade-entry",
            label: "Entry",
            group: "trade",
            kind: "line",
            points: [{ time: 1700000000, value: 100 }],
          },
        ],
      },
    });
  render(<LabTools {...p} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Capital (EGP)" }), {
    target: { value: "" },
  });
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(onInvalidateComparison).toHaveBeenCalledTimes(1);
  expect((p.onUpdate as jest.Mock).mock.calls.at(-1)![0].toolOverlays).toEqual([
    expect.objectContaining({ id: "trade-entry" }),
  ]);
});
test("parent live comparison echoes never restore original AI view or reset a subsequent edit", () => {
  function Harness() {
    const [state, setState] = React.useState(panel),
      [server, setServer] = React.useState(() =>
        calculate(candles, ["smc", "price_action"], {}),
      );
    return (
      <LabTools
        {...props()}
        panel={state}
        serverComparison={server}
        onUpdate={(patch) => setState((current) => ({ ...current, ...patch }))}
        onApplyComparison={setServer}
      />
    );
  }
  render(<Harness />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Lookback" }), {
    target: { value: "5" },
  });
  expect(screen.getByRole("spinbutton", { name: "Lookback" })).toHaveValue(5);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Lookback" }), {
    target: { value: "7" },
  });
  expect(screen.getByRole("spinbutton", { name: "Lookback" })).toHaveValue(7);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Results update immediately",
  );
});
test("drawing a tool preserves other groups and upserts its own group", () => {
  const existing = [
    {
      id: "trade-entry",
      label: "Entry",
      kind: "line" as const,
      group: "trade",
      points: [{ time: 1700000000, value: 100 }],
    },
    {
      id: "scenario-old",
      label: "Old",
      kind: "line" as const,
      group: "scenarios",
      points: [{ time: 1700000000, value: 90 }],
    },
  ];
  const p = props({
    tool: "scenarios",
    panel: { ...panel, toolOverlays: existing },
  });
  render(<LabTools {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Draw scenario levels" }));
  const overlays = (p.onUpdate as jest.Mock).mock.calls.at(-1)![0].toolOverlays;
  expect(overlays.find((o: { id: string }) => o.id === "trade-entry")).toEqual(
    existing[0],
  );
  expect(overlays.some((o: { id: string }) => o.id === "scenario-old")).toBe(
    false,
  );
  expect(
    overlays.filter((o: { group: string }) => o.group === "scenarios").length,
  ).toBeGreaterThanOrEqual(2);
});
test("overlay capacity truncates incoming drawings and preserves unrelated groups", () => {
  const existing = Array.from({ length: 99 }, (_, i) => ({
    id: `manual-${i}`,
    label: `Manual ${i}`,
    group: "events",
    kind: "time" as const,
    points: [{ time: 1700000000 + i * 86400, value: 100 }],
  }));
  const p = props({
    tool: "scenarios",
    panel: { ...panel, toolOverlays: existing },
  });
  render(<LabTools {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Draw scenario levels" }));
  const overlays = (p.onUpdate as jest.Mock).mock.calls.at(-1)![0].toolOverlays;
  expect(overlays).toHaveLength(100);
  expect(overlays.slice(0, 99)).toEqual(existing);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "4 new drawings were omitted",
  );
  expect(p.onClose).not.toHaveBeenCalled();
});
test("90 unrelated additions retain every source with only 10 comparison executions and a warning", () => {
  const existing = Array.from({ length: 90 }, (_, i) => ({
    id: `manual-${i}`,
    label: `Manual ${i}`,
    group: "events",
    kind: "time" as const,
    points: [{ time: 1700000000 + i * 86400, value: 100 }],
  }));
  const server = calculate(candles, ["smc"], {});
  server.results[0].trades = Array.from({ length: 15 }, (_, i) => ({
    entryTime: 1700000000 + i * 172800,
    exitTime: 1700000000 + i * 172800 + 86400,
    entryPrice: 100,
    exitPrice: 101,
    quantity: 1,
    pnl: 1,
    returnPct: 1,
    reason: "Fixture",
  }));
  const p = props({
    serverComparison: server,
    panel: { ...panel, toolOverlays: existing },
  });
  render(<LabTools {...p} />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Draw strategies and up to 30 latest trade entries / exits",
    }),
  );
  const overlays = (p.onUpdate as jest.Mock).mock.calls.at(-1)![0].toolOverlays;
  expect(overlays.slice(0, 90)).toEqual(existing);
  expect(
    overlays.filter((o: { group: string }) => o.group === "compare"),
  ).toHaveLength(10);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "20 new drawings were omitted",
  );
  expect(p.onClose).not.toHaveBeenCalled();
});
test("editing capital retains custom MACD periods from the AI tool", () => {
  const p = props({
    serverComparison: calculate(candles, ["trend_macd"], {
      params: { fastPeriod: 18, slowPeriod: 35 },
    }),
    serverAssumptions: {
      initialCapital: 25000,
      params: { fastPeriod: 18, slowPeriod: 35, lookback: 10 },
    },
  });
  render(<LabTools {...p} />);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Capital (EGP)" }), {
    target: { value: "50000" },
  });
  expect((compareStrategies as jest.Mock).mock.calls.at(-1)![2].params).toEqual(
    { fastPeriod: 18, slowPeriod: 35, lookback: 10 },
  );
  expect(p.onUpdate).toHaveBeenCalledWith({
    comparisonSettings: expect.objectContaining({
      params: { fastPeriod: 18, slowPeriod: 35, lookback: 10 },
    }),
  });
});
test("reopening an edited local comparison uses saved draft without original AI provenance", () => {
  const p = props({
    serverOrigin: "local",
    serverComparison: calculate(candles, ["smc"], {}),
    serverAssumptions: { initialCapital: 99999 },
    panel: {
      ...panel,
      strategyIds: ["smc"],
      comparisonSettings: {
        strategyIds: ["smc"],
        initialCapital: 45000,
        commissionBps: 10,
        slippageBps: 10,
        lookback: 5,
        split: 50,
        testWindow: "all",
      },
    },
  });
  render(<LabTools {...p} />);
  expect(
    screen.queryByText(
      "Showing the AI tool result with its original settings and window.",
    ),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("spinbutton", { name: "Capital (EGP)" })).toHaveValue(
    45000,
  );
});
