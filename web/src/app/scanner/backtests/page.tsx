import BacktestsClient from "./BacktestsClient";

export const metadata = {
  title: "AI Trading Bots & Backtests | EGX Bots",
  description: "Explore performance and simulation statistics of our quantitative AI trading models. Review historical backtests, win rates, and subscribe to live Telegram trading signals.",
};

export default function BacktestsPage() {
  return <BacktestsClient />;
}
