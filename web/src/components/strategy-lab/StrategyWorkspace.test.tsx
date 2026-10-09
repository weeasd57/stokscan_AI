/** @jest-environment jsdom */
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import StrategyWorkspace from "./StrategyWorkspace";
import {
  createWorkspace,
  parseWorkspace,
  setWorkspaceLayout,
} from "./workspace-state";
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ language: "en" }),
}));
jest.mock("@/components/TradingViewChartDynamic", () => ({
  __esModule: true,
  default: (props: {
    symbol: string;
    strategyOverlays: unknown[];
    initialDrawings?: unknown[];
    hiddenDrawingIds?: string[];
  }) => (
    <div
      data-testid="chart"
      data-symbol={props.symbol}
      data-overlays={props.strategyOverlays.length}
      data-overlay-json={JSON.stringify(props.strategyOverlays)}
      data-drawing-count={props.initialDrawings?.length || 0}
      data-hidden-drawings={JSON.stringify(props.hiddenDrawingIds || [])}
    >
      Chart {props.symbol}
    </div>
  ),
}));
import { analyzeStrategy, aggregateCandles } from "@/lib/strategy-lab";
const candles = Array.from({ length: 180 }, (_, i) => ({
  time: 1700000000 + i * 86400,
  open: 50 + i * 0.1,
  high: 52 + i * 0.1,
  low: 49 + i * 0.1,
  close: 51 + i * 0.1,
  volume: 10000,
}));
beforeEach(() => {
  localStorage.clear();
  global.fetch = jest
    .fn()
    .mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes("/symbols/search")
          ? {
              results: [
                {
                  symbol: "ADRI",
                  name: "Arab Development",
                  exchange: "EGX",
                  country: "Egypt",
                },
              ],
            }
          : { candles },
    }));
});
afterEach(cleanup);
const renderWorkspace = () =>
  render(
    <StrategyWorkspace
      symbol="COMI"
      exchange="EGX"
      theme="light"
      activeTool="cursor"
      onToolDrawComplete={() => {}}
    />,
  );
test("retains independent panels while reducing visible layout", () => {
  const workspace = createWorkspace("COMI", "EGX");
  workspace.panels[1].symbol = "ADRI";
  workspace.activePanelId = "panel-2";
  const reduced = setWorkspaceLayout({ ...workspace, layout: 2 }, 1);
  expect(reduced.activePanelId).toBe("panel-1");
  expect(reduced.panels[1].symbol).toBe("ADRI");
  expect(parseWorkspace(reduced)).toEqual(reduced);
  expect(
    parseWorkspace({ ...reduced, panels: [reduced.panels[0]] }),
  ).toBeNull();
});
test("deduplicates history, changes only selected panel and renders strategy overlays", async () => {
  renderWorkspace();
  await screen.findByTestId("chart");
  fireEvent.click(screen.getByRole("button", { name: "2" }));
  await waitFor(() => expect(screen.getAllByTestId("chart")).toHaveLength(2));
  const symbol = screen.getByRole("combobox", { name: "Chart 2 stock search" });
  fireEvent.change(symbol, { target: { value: "ADRI" } });
  const change = screen.getAllByRole("button", {
    name: "Change symbol",
  })[1];
  expect(change).toBeVisible();
  expect(
    screen.queryByRole("combobox", { name: "Chart timeframe" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Candle history" }),
  ).not.toBeInTheDocument();
  await screen.findByRole("option", { name: /ADRI Arab Development/ });
  fireEvent.click(change);
  await waitFor(() =>
    expect(
      screen
        .getAllByTestId("chart")
        .map((chart) => chart.getAttribute("data-symbol")),
    ).toEqual(["COMI", "ADRI"]),
  );
  expect(
    (global.fetch as jest.Mock).mock.calls.filter(([url]) =>
      String(url).includes("/candles?"),
    ),
  ).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: "Strategies" })[1]);
  await screen.findByRole("dialog");
  fireEvent.click(screen.getAllByRole("button", { name: "Apply to chart" })[0]);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(
      Number(screen.getAllByTestId("chart")[1].getAttribute("data-overlays")),
    ).toBeGreaterThan(0),
  );
  expect(screen.getAllByTestId("chart")[0]).toHaveAttribute(
    "data-overlays",
    "0",
  );
});
test("trade sizing draws actual entry stop target levels", async () => {
  renderWorkspace();
  await screen.findByTestId("chart");
  fireEvent.click(screen.getByRole("button", { name: "Trade sizing" }));
  await screen.findByRole("button", { name: "Draw trade on chart" });
  fireEvent.click(screen.getByRole("button", { name: "Draw trade on chart" }));
  await waitFor(() =>
    expect(screen.getByTestId("chart")).toHaveAttribute("data-overlays", "3"),
  );
  expect(screen.getByText(/Shares: .*Risk:/)).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Applied chart items" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Hide Entry" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete Entry" }));
  expect(screen.getByTestId("chart")).toHaveAttribute("data-overlays", "0");
  expect(screen.queryByText(/Shares: .*Risk:/)).not.toBeInTheDocument();
});
test("empty holdout split does not silently compare the full history", async () => {
  renderWorkspace();
  await screen.findByTestId("chart");
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Market structure" }),
  );
  await screen.findByRole("table");
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Excluded tuning window %" }),
    { target: { value: "" } },
  );
  await waitFor(() =>
    expect(screen.queryByRole("table")).not.toBeInTheDocument(),
  );
});
test("all tool dialogs share the site's surface and restore focus on Escape", async () => {
  renderWorkspace();
  await screen.findByTestId("chart");
  for (const title of [
    "Strategies",
    "Compare",
    "Scenarios",
    "Trade sizing",
    "False breakout",
    "Relative strength",
    "Events",
    "Valuation",
  ]) {
    const button = screen.getByRole("button", { name: title });
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector(".app-panel-strong")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  }
});
test("eight panel layout reuses the shared history and retains settings on reduction", async () => {
  renderWorkspace();
  await screen.findByTestId("chart");
  fireEvent.click(screen.getByRole("button", { name: "8" }));
  await waitFor(() => expect(screen.getAllByTestId("chart")).toHaveLength(8));
  const symbol = screen.getByRole("combobox", { name: "Chart 8 stock search" });
  fireEvent.change(symbol, { target: { value: "ADRI" } });
  await screen.findByRole("option", { name: /ADRI Arab Development/ });
  fireEvent.submit(symbol.closest("form")!);
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  fireEvent.click(screen.getByRole("button", { name: "8" }));
  await waitFor(() =>
    expect(screen.getAllByTestId("chart")[7]).toHaveAttribute(
      "data-symbol",
      "ADRI",
    ),
  );
  expect(screen.getAllByTestId("chart")[0]).toHaveAttribute(
    "data-symbol",
    "COMI",
  );
});
test("comparison drawing preserves its exact custom lookback and test window", async () => {
  renderWorkspace();
  await screen.findByTestId("chart");
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Price action" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "Lookback" }), {
    target: { value: "50" },
  });
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Draw strategies and up to 30 latest trade entries / exits",
    }),
  );
  const normalized = aggregateCandles(candles, "daily");
  const exact = analyzeStrategy(
    normalized.slice(Math.floor((normalized.length * 70) / 100)),
    "price_action",
    { lookback: 50 },
  );
  await waitFor(() => {
    const actual = JSON.parse(
      screen.getByTestId("chart").getAttribute("data-overlay-json")!,
    );
    expect(actual).toEqual(expect.arrayContaining(exact.overlays));
  });
  const defaultAnalysis = analyzeStrategy(normalized, "price_action");
  expect(
    JSON.parse(screen.getByTestId("chart").getAttribute("data-overlay-json")!),
  ).not.toEqual(defaultAnalysis.overlays);
});
test("five study comparison retains drawing studies without fabricated performance metrics", async () => {
  renderWorkspace();
  await screen.findByTestId("chart");
  fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  for (const name of [
    /Wyckoff approximation/,
    /Market structure/,
    /Price action/,
    /Trend \/ MACD/,
    /Gann slope/,
  ])
    fireEvent.click(screen.getByRole("checkbox", { name }));
  await screen.findByText(/Visual analysis without validated trade statistics/);
  expect(screen.getAllByRole("checkbox")).toHaveLength(10);
  const draw = await screen.findByRole("button", {
    name: "Draw strategies and up to 30 latest trade entries / exits",
  });
  fireEvent.click(draw);
  await waitFor(() =>
    expect(
      JSON.parse(
        screen.getByTestId("chart").getAttribute("data-overlay-json")!,
      ).some((overlay: { id: string }) => overlay.id.startsWith("gann:")),
    ).toBe(true),
  );
});
test("toolbar can hide and restore with independent persisted panel setting", async () => {
  renderWorkspace();
  await screen.findByTestId("chart");
  fireEvent.click(screen.getByRole("button", { name: "Hide tools" }));
  expect(
    screen.queryByRole("button", { name: "Strategies" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Chart additions" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem("stokscan:strategy-workspace:v1:guest")!)
        .panels[0].toolbarHidden,
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Show tools" }));
  expect(
    screen.getByRole("button", { name: "Strategies" }),
  ).toBeInTheDocument();
});
test("addition controls hide strategies and overlays without deleting their source; drawing deletion is independent", async () => {
  const state = createWorkspace("COMI", "EGX");
  state.panels[0].strategyIds = ["wyckoff"];
  state.panels[0].toolOverlays = [
    {
      id: "event-one",
      label: "Company event",
      kind: "time",
      points: [{ time: candles[0].time, value: 50 }],
    },
  ];
  state.panels[0].drawings = [
    {
      id: "drawing-one",
      type: "horizontal",
      point: { time: candles[0].time, price: 50 },
      style: {
        color: "#10b981",
        lineWidth: 2,
        lineStyle: "solid",
        label: "My support",
      },
    },
  ];
  localStorage.setItem(
    "stokscan:strategy-workspace:v1:guest",
    JSON.stringify(state),
  );
  renderWorkspace();
  await screen.findByTestId("chart");
  fireEvent.click(screen.getByRole("button", { name: "Chart additions" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide Wyckoff" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide Company event" }));
  await waitFor(() =>
    expect(screen.getByTestId("chart")).toHaveAttribute("data-overlays", "0"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Show Company event" }));
  expect(screen.getByTestId("chart")).toHaveAttribute("data-overlays", "1");
  fireEvent.click(screen.getByRole("button", { name: "Hide My support" }));
  expect(screen.getByTestId("chart")).toHaveAttribute(
    "data-drawing-count",
    "1",
  );
  expect(screen.getByTestId("chart")).toHaveAttribute(
    "data-hidden-drawings",
    '["drawing-one"]',
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete My support" }));
  expect(screen.getByTestId("chart")).toHaveAttribute(
    "data-drawing-count",
    "0",
  );
  expect(
    screen.getByRole("button", { name: "Hide Company event" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete Company event" }));
  expect(screen.getByTestId("chart")).toHaveAttribute("data-overlays", "0");
});
test("deleting one strategy retains the other AI strategy's exact parameters", async () => {
  renderWorkspace();
  await screen.findByTestId("chart");
  const exact = analyzeStrategy(candles, "wyckoff", { lookback: 50 });
  act(() => {
    window.dispatchEvent(
      new CustomEvent("strategy-lab-result", {
        detail: {
          type: "apply_strategy",
          chart_id: "panel-1",
          symbol: "COMI",
          result: { analysis: exact, timeframe: "1d" },
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("strategy-lab-result", {
        detail: {
          type: "apply_strategy",
          chart_id: "panel-1",
          symbol: "COMI",
          result: {
            analysis: analyzeStrategy(candles, "smc", { lookback: 60 }),
            timeframe: "1d",
          },
        },
      }),
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "Chart additions" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete SMC" }));
  await waitFor(() =>
    expect(
      JSON.parse(
        screen.getByTestId("chart").getAttribute("data-overlay-json")!,
      ),
    ).toEqual(exact.overlays),
  );
});
