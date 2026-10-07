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

import { fireEvent, within } from "@testing-library/react";
import ActiveTradeCard from "../../components/short-swings/ActiveTradeCard";

test("old conflicting quote is unavailable in the card and detail dialog", async () => {
  global.fetch = jest.fn(async () => ({ok: true, json: async () => ({is_pro: true,
    as_of: "2026-09-24", active_trades: [{symbol:"MFPC",entry_date:"2026-08-31",entry_price:40.921,
    current_price:40.921,return_pct:0,trailing_stop:41.044,is_breakeven_protected:true,ema10_trend:null}], closed_trades: []})} as Response));
  const view = render(<ShortSwingsTab isPro />);
  await view.findAllByText('MFPC');
  // The historical KPI fallback can be zero; the unverified trade cannot.
  expect(view.queryAllByText("+0.0%").length).toBeLessThanOrEqual(1);
  expect(view.getAllByText(/—/).length).toBeGreaterThan(0);
  fireEvent.click(view.getByRole("button",{name:"عرض التفاصيل"}));
  expect(view.getAllByText(/—/).length).toBeGreaterThan(0);
  expect(view.queryByText("+0.00%")).toBeNull();
  fireEvent.click(view.getByRole("button",{name:"تحديث الإشارات"}));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect((global.fetch as jest.Mock).mock.calls.every(call => call[0] === "/api/short-swings")).toBe(true);
});

test("locked cards never reveal supplied prices or ticker", () => {
  const view = render(<ActiveTradeCard trade={{symbol:"SECRET",entry_date:"2026-10-07",entry_price:125,
    current_price:150,return_pct:20,trailing_stop:135,is_locked:true}} session="2026-10-07" previousSession={false} isAr onDetails={jest.fn()} />);
  expect(view.queryByText("SECRET")).toBeNull();
  expect(view.queryByText(/150.00/)).toBeNull();
  expect(view.getByRole("article",{name:"صفقة مشفرة"})).toBeTruthy();
});

test("pending entries have no claimed performance before opening", () => {
  const view = render(<ActiveTradeCard trade={{symbol:"TEST",entry_date:"2026-10-08",reference_close:100,
    return_pct:0,is_pending_entry:true}} session="2026-10-07" previousSession={false} isAr onDetails={jest.fn()} />);
  expect(view.getByText("لم يبدأ العائد")).toBeTruthy();
  expect(view.queryByText("+0.0%")).toBeNull();
  expect(view.getByText("2026-10-08")).toBeTruthy();
});

test("a failed request shows an error instead of an empty portfolio", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = jest.fn(async () => ({ok:false} as Response));
  const view = render(<ShortSwingsTab />);
  expect(await view.findByRole("alert")).toBeTruthy();
  expect(view.queryByText("لا توجد صفقات تطابق البحث في الجلسة المعروضة.")).toBeNull();
  log.mockRestore();
});
