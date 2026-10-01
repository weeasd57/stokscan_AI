/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import HistoricalSimilarity from "../../components/HistoricalSimilarity";
import { prepareSimilarityReport } from "../historical-similarity";
import { fetchHistoricalSimilarity } from "@/lib/api";

let mockLanguage = "ar";
jest.mock("../../contexts/LanguageContext", () => ({ useLanguage: () => ({ language: mockLanguage }) }));
jest.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("../api", () => ({ fetchHistoricalSimilarity: jest.fn(), recordFeatureUse: jest.fn() }));
jest.mock("@vercel/analytics", () => ({ track: jest.fn() }));
jest.mock("recharts", () => ({
  ResponsiveContainer: () => null, Area: () => null, CartesianGrid: () => null,
  Line: () => null, ComposedChart: () => null, ReferenceLine: () => null,
  Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));

test.each(["ar", "en"])("historical cases remain accessible and selectable in %s", async language => {
  mockLanguage = language;
  const report = prepareSimilarityReport({ id: "mobile-fixture", forward_days: 20, scans: [{
    symbol: "TEST.EGX", name: "Test company", target_date: "2026-09-30", matches: [{
      symbol: "TEST.EGX", date: "2026-01-01", similarity: .95, final_return: .05,
      outcome: "win", mfe: .1, mae: -.02, before_path: [], forward_path: [],
    }],
  }] });
  jest.mocked(fetchHistoricalSimilarity).mockResolvedValue(report);
  render(<HistoricalSimilarity />);
  fireEvent.click(await screen.findByRole("tab", { name: language === "ar" ? "الحالات التاريخية" : "Historical cases" }));
  const region = screen.getByRole("region", { name: /scroll horizontally|اسحب أفقيًا/ });
  expect(region.tabIndex).toBe(0);
  expect(region.contains(screen.getByRole("table"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "2026-01-01" }));
  fireEvent.click(screen.getByRole("button", { name: language === "ar" ? "شاهد المسار التالي لهذه الحالة" : "View this case's subsequent path" }));
  expect(screen.getByRole("tab", { name: language === "ar" ? "السيناريوهات والمخاطر" : "Scenarios & risks" }).getAttribute("aria-selected")).toBe("true");
});
