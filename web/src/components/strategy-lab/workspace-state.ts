import { validateChartWorkspace } from "@/lib/chart-workspace";
export type PanelTimeframe = "1D";
export interface LabPanel {
  id: string;
  symbol: string;
  exchange: string;
  timeframe: PanelTimeframe;
  strategyIds: string[];
  period: number;
  drawings?: ChartDrawing[];
  toolOverlays?: import("@/lib/strategy-lab").Overlay[];
  toolbarHidden?: boolean;
  hiddenStrategyIds?: string[];
  hiddenOverlayIds?: string[];
  hiddenDrawingIds?: string[];
  comparisonSettings?: {
    strategyIds: import("@/lib/strategy-lab").StrategyId[];
    initialCapital: number;
    commissionBps: number;
    slippageBps: number;
    lookback: number;
    params?: import("@/lib/strategy-lab").StrategyParams;
    split: number;
    testWindow: "all" | "holdout";
  };
  tradeSettings?: {
    entry: number;
    stop: number;
    target: number;
    capital: number;
    riskPct: number;
  };
}
export interface LabWorkspace {
  version: 1;
  panels: LabPanel[];
  layout: 1 | 2 | 3 | 4 | 6 | 8;
  activePanelId: string;
  syncTime: boolean;
}
export function createWorkspace(
  symbol: string,
  exchange: string,
): LabWorkspace {
  return {
    version: 1,
    panels: Array.from({ length: 8 }, (_, i) => ({
      id: `panel-${i + 1}`,
      symbol,
      exchange,
      timeframe: "1D",
      strategyIds: [],
      period: 500,
    })),
    layout: 1,
    activePanelId: "panel-1",
    syncTime: false,
  };
}
export function parseWorkspace(value: unknown): LabWorkspace | null {
  if (!validateChartWorkspace(value)) return null;
  const input = value as LabWorkspace;
  if (
    ![4, 8].includes(input.panels.length) ||
    ![1, 2, 3, 4, 6, 8].includes(input.layout)
  )
    return null;
  if (input.panels.length === 4)
    return {
      ...input,
      panels: [
        ...input.panels,
        ...createWorkspace(
          input.panels[0].symbol,
          input.panels[0].exchange,
        ).panels.slice(4),
      ],
    };
  return input;
}
export function setWorkspaceLayout(
  workspace: LabWorkspace,
  layout: LabWorkspace["layout"],
): LabWorkspace {
  return {
    ...workspace,
    layout,
    activePanelId: workspace.panels
      .slice(0, layout)
      .some((panel) => panel.id === workspace.activePanelId)
      ? workspace.activePanelId
      : workspace.panels[0].id,
  };
}
import type { ChartDrawing } from "@/components/TradingViewChart";
