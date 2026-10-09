import { STRATEGIES } from "@/lib/strategy-lab";

export function validateChartDrawings(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 100) return false;
  const point = (raw: any) =>
    raw &&
    Number.isFinite(raw.time) &&
    raw.time > 0 &&
    Number.isFinite(raw.price) &&
    raw.price > 0;
  return value.every((drawing) => {
    if (
      !drawing ||
      typeof drawing !== "object" ||
      typeof drawing.id !== "string" ||
      drawing.id.length > 100
    )
      return false;
    const style = drawing.style;
    if (
      !style ||
      typeof style.color !== "string" ||
      style.color.length > 64 ||
      !Number.isFinite(style.lineWidth) ||
      style.lineWidth < 0.5 ||
      style.lineWidth > 20 ||
      !["solid", "dashed", "dotted"].includes(style.lineStyle)
    )
      return false;
    if (
      [style.fillColor, style.textColor, style.label].some(
        (item) =>
          item !== undefined && (typeof item !== "string" || item.length > 200),
      )
    )
      return false;
    if (drawing.type === "horizontal") return point(drawing.point);
    if (drawing.type === "text")
      return (
        point(drawing.point) &&
        typeof drawing.text === "string" &&
        drawing.text.length <= 500
      );
    return (
      ["trend", "rectangle", "fib", "ray", "extendedLine"].includes(
        drawing.type,
      ) &&
      point(drawing.start) &&
      point(drawing.end)
    );
  });
}

export function validateToolOverlays(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (overlay) =>
        overlay &&
        typeof overlay.id === "string" &&
        overlay.id.length <= 100 &&
        (overlay.group === undefined ||
          (typeof overlay.group === "string" && overlay.group.length <= 40)) &&
        typeof overlay.label === "string" &&
        overlay.label.length <= 200 &&
        ["line", "zone", "time"].includes(overlay.kind) &&
        (overlay.color === undefined ||
          (typeof overlay.color === "string" && overlay.color.length <= 64)) &&
        Array.isArray(overlay.points) &&
        overlay.points.length > 0 &&
        overlay.points.length <= 10 &&
        overlay.points.every(
          (point: any) =>
            Number.isFinite(point.time) &&
            point.time > 0 &&
            Number.isFinite(point.value) &&
            point.value > 0,
        ),
    )
  );
}

export function validateChartWorkspace(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (
    state.version !== 1 ||
    typeof state.layout !== "number" ||
    ![1, 2, 3, 4, 6, 8].includes(state.layout) ||
    typeof state.syncTime !== "boolean"
  )
    return false;
  if (
    !Array.isArray(state.panels) ||
    state.panels.length < Number(state.layout) ||
    state.panels.length > 8
  )
    return false;
  const ids = new Set<string>();
  for (const raw of state.panels) {
    if (!raw || typeof raw !== "object") return false;
    const panel = raw as Record<string, unknown>;
    if (
      typeof panel.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(panel.id) ||
      ids.has(panel.id)
    )
      return false;
    ids.add(panel.id);
    if (
      typeof panel.symbol !== "string" ||
      !/^[a-zA-Z0-9._-]{1,24}$/.test(panel.symbol) ||
      panel.exchange !== "EGX"
    )
      return false;
    if (
      !["1D", "1W", "1M"].includes(String(panel.timeframe)) ||
      !Number.isInteger(panel.period) ||
      Number(panel.period) < 30 ||
      Number(panel.period) > 1000
    )
      return false;
    if (
      !Array.isArray(panel.strategyIds) ||
      panel.strategyIds.length > 10 ||
      new Set(panel.strategyIds).size !== panel.strategyIds.length ||
      panel.strategyIds.some(
        (id) => !STRATEGIES.some((strategy) => strategy.id === id),
      )
    )
      return false;
    if (panel.drawings !== undefined && !validateChartDrawings(panel.drawings))
      return false;
    if (
      panel.toolbarHidden !== undefined &&
      typeof panel.toolbarHidden !== "boolean"
    )
      return false;
    for (const key of [
      "hiddenStrategyIds",
      "hiddenOverlayIds",
      "hiddenDrawingIds",
    ] as const) {
      const values = panel[key];
      if (
        values !== undefined &&
        (!Array.isArray(values) ||
          values.length > (key === "hiddenStrategyIds" ? 10 : 100) ||
          new Set(values).size !== values.length ||
          values.some(
            (id) =>
              typeof id !== "string" ||
              id.length > 100 ||
              (key === "hiddenStrategyIds" &&
                !STRATEGIES.some((strategy) => strategy.id === id)),
          ))
      )
        return false;
    }
    if (panel.comparisonSettings !== undefined) {
      const settings = panel.comparisonSettings as Record<string, unknown>;
      if (settings?.params !== undefined) {
        const params = settings.params as Record<string, unknown>;
        if (
          !params ||
          typeof params !== "object" ||
          Array.isArray(params) ||
          ["lookback", "fastPeriod", "slowPeriod"].some(
            (key) =>
              params[key] !== undefined &&
              (!Number.isInteger(params[key]) ||
                Number(params[key]) < 2 ||
                Number(params[key]) > 200),
          ) ||
          (params.fastPeriod !== undefined &&
            params.slowPeriod !== undefined &&
            Number(params.fastPeriod) >= Number(params.slowPeriod))
        )
          return false;
      }
      if (
        !settings ||
        typeof settings !== "object" ||
        Array.isArray(settings) ||
        !Array.isArray(settings.strategyIds) ||
        settings.strategyIds.length > 10 ||
        new Set(settings.strategyIds).size !== settings.strategyIds.length ||
        settings.strategyIds.some(
          (id) => !STRATEGIES.some((strategy) => strategy.id === id),
        ) ||
        ![
          settings.initialCapital,
          settings.commissionBps,
          settings.slippageBps,
          settings.lookback,
          settings.split,
        ].every((item) => typeof item === "number" && Number.isFinite(item)) ||
        Number(settings.initialCapital) <= 0 ||
        Number(settings.commissionBps) < 0 ||
        Number(settings.commissionBps) > 1000 ||
        Number(settings.slippageBps) < 0 ||
        Number(settings.slippageBps) > 1000 ||
        !Number.isInteger(settings.lookback) ||
        Number(settings.lookback) < 2 ||
        Number(settings.lookback) > 200 ||
        !Number.isInteger(settings.split) ||
        Number(settings.split) < 10 ||
        Number(settings.split) > 90 ||
        !["all", "holdout"].includes(String(settings.testWindow))
      )
        return false;
    }
    if (
      panel.toolOverlays !== undefined &&
      !validateToolOverlays(panel.toolOverlays)
    )
      return false;
    if (panel.tradeSettings !== undefined) {
      const trade = panel.tradeSettings as Record<string, unknown>;
      if (
        !trade ||
        typeof trade !== "object" ||
        ![
          trade.entry,
          trade.stop,
          trade.target,
          trade.capital,
          trade.riskPct,
        ].every(
          (item) =>
            typeof item === "number" && Number.isFinite(item) && item > 0,
        ) ||
        Number(trade.stop) >= Number(trade.entry) ||
        Number(trade.target) <= Number(trade.entry) ||
        Number(trade.riskPct) > 100
      )
        return false;
    }
  }
  return (
    typeof state.activePanelId === "string" &&
    state.panels
      .slice(0, Number(state.layout))
      .some((panel) => panel.id === state.activePanelId)
  );
}
