/** @jest-environment jsdom */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PortfolioPerformanceDashboard from "../../app/profile/components/PortfolioPerformanceDashboard";
import SignalExplanation from "../../components/SignalExplanation";
import { fetchPortfolioPerformance } from "../api";
import { buildPortfolioPerformance } from "../portfolio-performance";

jest.mock("../api", () => ({ fetchPortfolioPerformance: jest.fn() }));
jest.mock("next/dynamic", () => () => function ChartStub() { return <div>Daily comparison chart</div>; });
const fetchReport = fetchPortfolioPerformance as jest.Mock;
const report = buildPortfolioPerformance([], [], {}, []);
const snapshot: any = { positions: [], totals: {}, cash_balance: 0 };

beforeEach(() => { fetchReport.mockReset(); fetchReport.mockResolvedValue(report); });

it("fetches only after opening; periods and reopening reuse the report", async () => {
  render(<PortfolioPerformanceDashboard userId="A" snapshot={snapshot} isAr />);
  expect(fetchReport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "لوحة أداء المحفظة" }));
  await waitFor(() => expect(screen.getByText("ربح / خسارة البيع المسجل")).toBeTruthy());
  expect(fetchReport).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "سنة" }));
  fireEvent.click(screen.getByRole("button", { name: "لوحة أداء المحفظة" }));
  fireEvent.click(screen.getByRole("button", { name: "لوحة أداء المحفظة" }));
  expect(fetchReport).toHaveBeenCalledTimes(1);
});

it("does not show the previous user's private report after an account switch", async () => {
  fetchReport.mockResolvedValueOnce({ ...report, realized: 1234 });
  const { rerender } = render(<PortfolioPerformanceDashboard userId="A" snapshot={snapshot} isAr={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Portfolio performance" }));
  await waitFor(() => expect(screen.getByText("1,234.00")).toBeTruthy());
  fetchReport.mockImplementationOnce(() => new Promise(() => {}));
  rerender(<PortfolioPerformanceDashboard userId="B" snapshot={snapshot} isAr={false} />);
  expect(screen.queryByText("1,234.00")).toBeNull();
  rerender(<PortfolioPerformanceDashboard userId={null} snapshot={null} isAr={false} />);
  expect(screen.queryByRole("button", { name: "Portfolio performance" })).toBeNull();
});

it("does not refetch because snapshot prices changed", async () => {
  const { rerender } = render(<PortfolioPerformanceDashboard userId="A" snapshot={snapshot} isAr={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Portfolio performance" }));
  await waitFor(() => expect(screen.getByText("Recorded realized P/L")).toBeTruthy());
  rerender(<PortfolioPerformanceDashboard userId="A" snapshot={{ ...snapshot, totals: { market_value: 123 } }} isAr={false} />);
  expect(fetchReport).toHaveBeenCalledTimes(1);
});

it("offers explicit retry on failure, without an automatic request loop", async () => {
  fetchReport.mockRejectedValueOnce(new Error("unavailable"));
  render(<PortfolioPerformanceDashboard userId="A" snapshot={snapshot} isAr={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Portfolio performance" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(fetchReport).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.getByText("Recorded realized P/L")).toBeTruthy());
  expect(fetchReport).toHaveBeenCalledTimes(2);
});

it("aborts pending work when the dashboard closes", async () => {
  fetchReport.mockImplementationOnce(() => new Promise(() => {}));
  render(<PortfolioPerformanceDashboard userId="A" snapshot={snapshot} isAr={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Portfolio performance" }));
  const signal = fetchReport.mock.calls[0][0] as AbortSignal;
  fireEvent.click(screen.getByRole("button", { name: "Portfolio performance" }));
  expect(signal.aborted).toBe(true);
});

it("labels missing legacy costs and hypothetical comparisons honestly", async () => {
  fetchReport.mockResolvedValueOnce({ ...report, realized: null, unknownSales: 2 });
  render(<PortfolioPerformanceDashboard userId="A" snapshot={snapshot} isAr />);
  fireEvent.click(screen.getByRole("button", { name: "لوحة أداء المحفظة" }));
  await waitFor(() => expect(screen.getByText("ربح البيع المعروف فقط — سجل غير مكتمل")).toBeTruthy());
  expect(screen.getByText(/هذه ليست عوائد حسابك الفعلية/)).toBeTruthy();
});

it("explains signal risk bilingually without manufacturing saved reasons", () => {
  const { rerender } = render(<SignalExplanation isAr signal={{ entry_price: 100, stop_loss: 95, target_price: 110, top_reasons: ["RSI saved"] }} />);
  expect(screen.getByText("2.00 : 1")).toBeTruthy();
  expect(screen.getByText("RSI saved")).toBeTruthy();
  rerender(<SignalExplanation isAr={false} signal={{ entry_price: 100, stop_loss: 105, target_price: 110 }} />);
  expect(screen.getByText(/No reasons were saved/)).toBeTruthy();
  expect(screen.getByText(/not a guaranteed success probability/)).toBeTruthy();
});
