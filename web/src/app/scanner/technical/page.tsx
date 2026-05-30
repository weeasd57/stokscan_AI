import TechnicalScannerClient from "./TechnicalScannerClient";

export const metadata = {
  title: "Technical Stock Screener | EGX Bots",
  description: "Advanced technical stock screener for the Egyptian Stock Exchange (EGX). Filter and scan stocks in real-time using RSI, MACD, EMA crossover, and AI predictions.",
};

export default function TechnicalScannerPage() {
  return <TechnicalScannerClient />;
}
