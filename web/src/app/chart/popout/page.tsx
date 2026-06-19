"use client";

import { useSearchParams } from "next/navigation";
import TradingViewChart from "@/components/TradingViewChartDynamic";
import { Loader2 } from "lucide-react";
import { Suspense } from "react";
import { useTheme } from "@/contexts/ThemeContext";

function PopoutChartContent() {
    const searchParams = useSearchParams();
    const symbol = searchParams.get("symbol");
    const exchange = searchParams.get("exchange") || "US";
    const { theme } = useTheme();

    if (!symbol) {
        return (
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-zinc-50 text-red-500 dark:bg-[#131722] dark:text-[#ef5350] p-6 text-center">
                <span className="text-sm font-bold uppercase tracking-wider">No symbol provided</span>
                <p className="text-xs text-zinc-500 dark:text-[#787b86] mt-2">Please close this window and try again.</p>
            </div>
        );
    }

    return (
        <div className="w-screen h-screen bg-zinc-50 dark:bg-[#131722] overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0 w-full relative">
                <TradingViewChart symbol={symbol} exchange={exchange} theme={theme} />
            </div>
        </div>
    );
}

export default function PopoutChartPage() {
    return (
        <Suspense fallback={
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-zinc-50 text-zinc-500 dark:bg-[#131722] dark:text-[#787b86]">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500 dark:text-[#2962ff] mb-2" />
                <span className="text-xs font-bold uppercase tracking-wider">Loading popout chart...</span>
            </div>
        }>
            <PopoutChartContent />
        </Suspense>
    );
}
