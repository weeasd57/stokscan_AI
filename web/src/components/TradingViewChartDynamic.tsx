"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const TradingViewChart = dynamic(() => import("@/components/TradingViewChart"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full w-full bg-[#131722] min-h-[400px]">
      <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
    </div>
  ),
});

export default TradingViewChart;
