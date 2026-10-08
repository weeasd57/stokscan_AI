import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import MarketClient from "@/app/scanner/market/MarketClient";
import BacktestsPage from "@/app/scanner/backtests/page";

jest.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ language: "ar", t: (key: string) => ({
    "market.title": "تحليل اتجاه السوق والوضع الاقتصادي",
    "market.subtitle": "تحليل EGX30 وEGX100 والسيولة",
  }[key] || key) }),
}));

jest.mock("@/app/scanner/backtests/BacktestsClient", () => ({
  __esModule: true,
  default: () => { throw new Promise(() => {}); },
}));

describe("scanner content before browser data loads", () => {
  it("renders the market heading and description in initial HTML", () => {
    const html = renderToStaticMarkup(<MarketClient />);
    expect(html).toMatch(/<h1[^>]*>تحليل اتجاه السوق والوضع الاقتصادي<\/h1>/);
    expect(html).toContain("تحليل EGX30 وEGX100 والسيولة");
    expect(html).toContain('role="status"');
  });

  it("renders research content and crawlable links while the interactive scanner suspends", () => {
    const html = renderToStaticMarkup(<BacktestsPage />);
    expect(html).toMatch(/<h1[^>]*>تقييم الأسهم المصرية والتشابه التاريخي<\/h1>/);
    expect(html).toContain('href="/stocks"');
    expect(html).toContain("5 و10 و20 جلسة");
  });
});
