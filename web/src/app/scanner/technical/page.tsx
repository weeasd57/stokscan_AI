import TechnicalScannerLoader from "./TechnicalScannerLoader";

export const metadata = {
  title: "Technical Stock Screener | EGX Bots",
  description: "Technical stock screener for the Egyptian Stock Exchange (EGX) using RSI, MACD, EMA crossover, VWAP, and volume filters.",
};

export default function TechnicalScannerPage() {
  return <TechnicalScannerLoader />;
}
