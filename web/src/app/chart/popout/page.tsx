"use client";

import { useSearchParams } from "next/navigation";
import TradingViewChart from "@/components/TradingViewChart";
import { Loader2 } from "lucide-react";
import { Suspense } from "react";

function PopoutChartContent() {
    const searchParams = useSearchParams();
    const symbol = searchParams.get("symbol");
    const exchange = searchParams.get("exchange") || "US";

    if (!symbol) {
        return (
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#131722] text-[#ef5350] p-6 text-center">
                <span className="text-sm font-bold uppercase tracking-wider">No symbol provided</span>
                <p className="text-xs text-[#787b86] mt-2">Please close this window and try again.</p>
            </div>
        );
    }

    return (
        <div className="w-screen h-screen bg-[#131722] overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0 w-full relative">
                <TradingViewChart symbol={symbol} exchange={exchange} theme="dark" />
            </div>
        </div>
    );
}

export default function PopoutChartPage() {
    return (
        <Suspense fallback={
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#131722] text-[#787b86]">
                <Loader2 className="w-8 h-8 animate-spin text-[#2962ff] mb-2" />
                <span className="text-xs font-bold uppercase tracking-wider">Loading popout chart...</span>
            </div>
        }>
            <PopoutChartContent />
        </Suspense>
    );
}
