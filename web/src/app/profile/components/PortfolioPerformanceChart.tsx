"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PerformancePoint } from "@/lib/portfolio-performance";

export default function PortfolioPerformanceChart({ points, isAr }: { points: PerformancePoint[]; isAr: boolean }) {
  return <div className="h-64 w-full min-w-0 sm:h-80" dir="ltr" role="img" aria-label={isAr ? "مقارنة الحيازات الحالية ومؤشر EGX30، تبدأ من 100" : "Current holdings and EGX30 comparison, rebased to 100"}>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 12, right: 15, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#71717a" opacity={0.2} />
        <XAxis dataKey="date" tickFormatter={date => date.slice(5)} minTickGap={35} tick={{ fill: "#71717a", fontSize: 11 }} />
        <YAxis domain={["auto", "auto"]} tick={{ fill: "#71717a", fontSize: 11 }} tickFormatter={value => Number(value).toFixed(0)} width={42} />
        <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="border-2 border-black bg-white p-3 text-xs font-bold text-black shadow-[3px_3px_0px_#000]">
          <p className="mb-2">{label}</p>
          {payload.map(item => <p key={String(item.dataKey)} style={{ color: item.color }}>{item.name}: {Number(item.value).toFixed(2)}</p>)}
        </div> : null} />
        <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
        <Line type="linear" dataKey="basket" name={isAr ? "محاكاة الحيازات الحالية" : "Current holdings simulation"} stroke="#059669" strokeWidth={3} dot={false} isAnimationActive={false} />
        <Line type="linear" dataKey="benchmark" name="EGX30" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
