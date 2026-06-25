import MarketClient from "./MarketClient";

export const metadata = {
  title: "EGX Market Analysis & Economic Outlook | EGX Bots",
  description: "Detailed analysis of EGX 30, EGX 100, and USD/EGP exchange rate history to track macroeconomic cycles and market regime updates.",
};

export default function MarketPage() {
  return <MarketClient />;
}
