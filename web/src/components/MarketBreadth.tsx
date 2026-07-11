"use client";

import React from "react";
import { Activity, TrendingUp, TrendingDown, BarChart3, Gauge } from "lucide-react";

interface BreadthData {
    health_score: number;
    health_label: string;
    advancing: number;
    declining: number;
    unchanged: number;
    pct_above_ema50: number;
    pct_above_ema200: number;
    avg_rsi: number;
    volume_ratio: number;
    total_stocks: number;
    date: string;
}

/* ── Health Score Arc ─────────────────────────────────────── */
const HealthArc = ({ score }: { score: number }) => {
    const r = 54;
    const circ = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(100, score));
    const offset = circ - (pct / 100) * circ * 0.75; // 270° arc
    const color =
        pct >= 70 ? "#10b981" :
        pct >= 45 ? "#f59e0b" :
        "#ef4444";
    return (
        <svg viewBox="0 0 120 100" className="w-32 h-28 mx-auto">
            {/* background arc */}
            <circle
                cx={60} cy={60} r={r}
                fill="none" stroke="#27272a" strokeWidth={10}
                strokeDasharray={`${circ * 0.75} ${circ * 0.25}`}
                strokeDashoffset={0}
                strokeLinecap="round"
                transform="rotate(135 60 60)"
            />
            {/* progress arc */}
            <circle
                cx={60} cy={60} r={r}
                fill="none" stroke={color} strokeWidth={10}
                strokeDasharray={circ}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform="rotate(135 60 60)"
                className="transition-all duration-700 ease-out"
            />
            {/* score text */}
            <text x={60} y={55} textAnchor="middle" className="fill-white text-2xl font-black" style={{ fontSize: 28 }}>{Math.round(pct)}</text>
            <text x={60} y={72} textAnchor="middle" className="fill-zinc-400 text-xs font-bold" style={{ fontSize: 10 }}>/ 100</text>
        </svg>
    );
};

/* ── Market Health Score Card ─────────────────────────────── */
export function MarketHealthScore({ data, isAr }: { data: BreadthData | null; isAr: boolean }) {
    if (!data) return null;

    const verdictMap: Record<string, { ar: string; en: string; cls: string }> = {
        strong:   { ar: "السوق في حالة قوة — فرصة جيدة للشراء", en: "Market is strong — good buying opportunity", cls: "text-emerald-400" },
        moderate: { ar: "السوق متذبذب — كن حذراً واختر بعناية", en: "Market is mixed — be selective", cls: "text-amber-400" },
        weak:     { ar: "السوق ضعيف — تجنب الشراء وراقب فقط", en: "Market is weak — avoid buying, watch only", cls: "text-rose-400" },
    };
    const verdict = verdictMap[data.health_label] || verdictMap.moderate;

    return (
        <div className="border-2 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,0.15)] p-5">
            <div className={`flex items-center gap-4 ${isAr ? "flex-row-reverse text-right" : "flex-row text-left"}`}>
                <div className="shrink-0">
                    <HealthArc score={data.health_score} />
                </div>
                <div className="flex-1 space-y-2">
                    <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                        <Gauge className="w-4 h-4 text-[#FFDC58]" />
                        <h3 className="text-sm font-black uppercase tracking-wider text-zinc-950 dark:text-white">
                            {isAr ? "مؤشر صحة السوق" : "Market Health Score"}
                        </h3>
                    </div>
                    <p className={`text-sm font-bold leading-relaxed ${verdict.cls}`}>
                        {isAr ? verdict.ar : verdict.en}
                    </p>
                    <p className="text-[10px] font-mono text-zinc-500">
                        {isAr ? `بناءً على تحليل ${data.total_stocks} سهم — ${data.date}` : `Based on ${data.total_stocks} stocks — ${data.date}`}
                    </p>
                </div>
            </div>
        </div>
    );
}

/* ── Market Breadth Strip ─────────────────────────────────── */
export function MarketBreadthStrip({ data, isAr }: { data: BreadthData | null; isAr: boolean }) {
    if (!data) return null;

    const metrics = [
        {
            icon: <TrendingUp className="w-4 h-4 text-emerald-500" />,
            label: isAr ? "صاعدة" : "Advancing",
            value: `${data.advancing}`,
            sub: `/ ${data.declining} ${isAr ? "هابطة" : "declining"}`,
            cls: data.advancing > data.declining ? "text-emerald-400" : "text-rose-400",
        },
        {
            icon: <Activity className="w-4 h-4 text-indigo-400" />,
            label: isAr ? "فوق EMA200" : "Above EMA200",
            value: `${data.pct_above_ema200.toFixed(0)}%`,
            sub: isAr ? "اتجاه صاعد" : "long-term uptrend",
            cls: data.pct_above_ema200 > 50 ? "text-emerald-400" : "text-rose-400",
        },
        {
            icon: <BarChart3 className="w-4 h-4 text-amber-400" />,
            label: isAr ? "متوسط RSI" : "Avg RSI",
            value: `${data.avg_rsi.toFixed(0)}`,
            sub: data.avg_rsi > 60 ? (isAr ? "مشبع شراء" : "overbought zone") : data.avg_rsi < 40 ? (isAr ? "مشبع بيع" : "oversold zone") : (isAr ? "منطقة متوسطة" : "neutral zone"),
            cls: data.avg_rsi > 60 ? "text-rose-400" : data.avg_rsi < 40 ? "text-emerald-400" : "text-zinc-300",
        },
        {
            icon: <TrendingDown className="w-4 h-4 text-cyan-400" />,
            label: isAr ? "نشاط السيولة" : "Volume Activity",
            value: `${data.volume_ratio.toFixed(1)}x`,
            sub: data.volume_ratio > 1.5 ? (isAr ? "نشاط عالي" : "high activity") : data.volume_ratio < 0.7 ? (isAr ? "نشاط منخفض" : "low activity") : (isAr ? "نشاط عادي" : "normal"),
            cls: data.volume_ratio > 1.5 ? "text-emerald-400" : data.volume_ratio < 0.7 ? "text-rose-400" : "text-zinc-300",
        },
    ];

    return (
        <div className={`grid grid-cols-2 md:grid-cols-4 gap-2 ${isAr ? "direction-rtl" : ""}`}>
            {metrics.map((m, i) => (
                <div key={i} className="border-2 border-black dark:border-zinc-800 bg-white dark:bg-zinc-950/80 p-3 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,0.1)]">
                    <div className={`flex items-center gap-1.5 mb-1.5 ${isAr ? "flex-row-reverse" : ""}`}>
                        {m.icon}
                        <span className="text-[9px] font-black uppercase tracking-wider text-zinc-500">{m.label}</span>
                    </div>
                    <div className={`text-lg font-mono font-black ${m.cls}`}>{m.value}</div>
                    <div className="text-[9px] font-semibold text-zinc-500 mt-0.5">{m.sub}</div>
                </div>
            ))}
        </div>
    );
}

/* ── Top Movers ───────────────────────────────────────────── */
interface Mover {
    symbol: string;
    name: string;
    change_pct: number;
    close: number;
    volume: number;
    rsi_14: number;
}

export function TopMovers({ gainers, losers, isAr }: { gainers: Mover[]; losers: Mover[]; isAr: boolean }) {
    if (!gainers.length && !losers.length) return null;

    const renderTable = (items: Mover[], type: "gain" | "loss") => {
        const color = type === "gain" ? "text-emerald-400" : "text-rose-400";
        const headerBg = type === "gain" ? "bg-emerald-500/10" : "bg-rose-500/10";
        const icon = type === "gain"
            ? <TrendingUp className="w-4 h-4 text-emerald-500" />
            : <TrendingDown className="w-4 h-4 text-rose-500" />;
        const title = type === "gain"
            ? (isAr ? "أقوى 5 أسهم ↑" : "Top 5 Gainers ↑")
            : (isAr ? "أضعف 5 أسهم ↓" : "Top 5 Losers ↓");

        return (
            <div className="border-2 border-black dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,0.1)] overflow-hidden">
                <div className={`flex items-center gap-2 px-4 py-2.5 ${headerBg} ${isAr ? "flex-row-reverse" : ""}`}>
                    {icon}
                    <span className="text-[10px] font-black uppercase tracking-wider text-zinc-950 dark:text-white">{title}</span>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                    {items.map((m, i) => (
                        <a
                            key={m.symbol}
                            href={`/stocks/${m.symbol}`}
                            className={`flex items-center px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors ${isAr ? "flex-row-reverse text-right" : "text-left"}`}
                        >
                            <span className="text-[10px] font-mono font-black text-zinc-500 w-5">{i + 1}</span>
                            <div className={`flex-1 min-w-0 ${isAr ? "mr-2" : "ml-2"}`}>
                                <div className="text-xs font-black text-indigo-500 truncate">{m.symbol}</div>
                                <div className="text-[9px] text-zinc-500 font-semibold truncate">{m.name || m.symbol}</div>
                            </div>
                            <div className={`text-right ${isAr ? "ml-3" : "mr-3"}`}>
                                <div className="text-xs font-mono font-bold text-zinc-300">{m.close.toFixed(2)}</div>
                                <div className="text-[9px] font-mono text-zinc-500">RSI {m.rsi_14?.toFixed(0) || "—"}</div>
                            </div>
                            <div className={`font-mono font-black text-sm ${color} min-w-[60px] ${isAr ? "text-left" : "text-right"}`}>
                                {m.change_pct >= 0 ? "+" : ""}{m.change_pct.toFixed(2)}%
                            </div>
                        </a>
                    ))}
                    {items.length === 0 && (
                        <div className="px-4 py-6 text-center text-[10px] font-mono text-zinc-500">
                            {isAr ? "لا توجد بيانات" : "No data available"}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-3">
            <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                <Activity className="w-5 h-5 text-[#FFDC58]" />
                <h3 className="text-sm font-black uppercase tracking-wider text-zinc-950 dark:text-white">
                    {isAr ? "أقوى وأضعف الأسهم اليوم" : "Today's Top Movers"}
                </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {renderTable(gainers, "gain")}
                {renderTable(losers, "loss")}
            </div>
        </div>
    );
}
