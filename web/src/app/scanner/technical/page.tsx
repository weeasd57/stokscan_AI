import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const TechnicalScannerClient = dynamic(
  () => import("./TechnicalScannerClient"),
  { 
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-100px)] bg-[#0c0d12] text-[#d1d4dc] border border-[#2a2e39]">
        <Loader2 className="w-8 h-8 animate-spin text-[#2962ff] mb-4" />
        <p className="text-sm font-bold uppercase tracking-wider text-[#787b86]">Loading Technical Scanner...</p>
      </div>
    )
  }
);

export const metadata = {
  title: "Technical Stock Screener | EGX Bots",
  description: "Advanced technical stock screener for the Egyptian Stock Exchange (EGX). Filter and scan stocks in real-time using RSI, MACD, EMA crossover, and AI predictions.",
};

export default function TechnicalScannerPage() {
  return <TechnicalScannerClient />;
}
