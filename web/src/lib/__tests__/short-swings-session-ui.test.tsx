/** @jest-environment jsdom */
import React from "react";
import { render, waitFor } from "@testing-library/react";
import ShortSwingsTab from "../../components/ShortSwingsTab";

jest.mock("@/contexts/LanguageContext", () => ({ useLanguage: () => ({ language: "ar" }) }));
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light" }) }));
jest.mock("../../components/StockLogo", () => ({ __esModule: true, default: () => null }));
jest.mock("@/lib/shariaStocks", () => ({ isShariaCompliant: () => false }));

test("saved session and real KPI sample are visible, and a missing return stays unavailable", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({
    is_pro: true, as_of: "2026-09-24", phase: "midday", total_active: 1, total_closed: 0,
    kpis: { total_trades: 1080, profit_factor: 1.93, win_rate_pct: 50.2 }, closed_trades: [],
    active_trades: [{ symbol: "TEST", entry_date: "2026-09-01", entry_price: 100, current_price: null, return_pct: null }]
  }) } as Response));
  const view = render(<ShortSwingsTab isPro />);
  await waitFor(() => expect(view.getByRole("status").textContent).toContain("2026-09-24"));
  expect(view.getByRole("status").textContent).toContain("مؤقتة حتى الإغلاق");
  expect(view.getByText("مبني على 1,080 صفقة تاريخية")).toBeTruthy();
  expect(view.queryByText("1,796")).toBeNull();
  expect(view.getAllByText("—").length).toBeGreaterThan(0);
});
