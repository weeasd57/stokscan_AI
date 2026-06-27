"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAIScanner } from "@/contexts/AIScannerContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import {
    ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, ReferenceLine
} from "recharts";
import {
    Wallet,
    TrendingUp,
    TrendingDown,
    RefreshCw,
    Target,
    ShieldAlert,
    ArrowUpRight,
    ArrowDownRight,
    Minus,
    Activity,
    Layers,
    Loader2,
    BarChart2,
    Award,
} from "lucide-react";

type TradeTab = "active" | "closed" | "all";

const isStatusOpen = (status?: string | null) => {
    const s = (status || "open").toLowerCase();
    return s !== "win" && s !== "loss" && s !== "hit_stop" && s !== "hit_target";
};
const isStatusClosed = (status?: string | null) => {
    const s = (status || "").toLowerCase();
    return s === "win" || s === "loss" || s === "hit_stop" || s === "hit_target";
};

const fmtPct = (v: number | null | undefined, withSign = true) => {
    if (v == null || isNaN(v)) return "—";
    const sign = withSign && v > 0 ? "+" : "";
    return `${sign}${v.toFixed(2)}%`;
};
const fmtPrice = (v: number | null | undefined) => {
    if (v == null || isNaN(v)) return "—";
    return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function OpenTradesDashboard({ isLandingPage = false }: { isLandingPage?: boolean }) {
    const { language } = useLanguage();
    const { theme } = useTheme();
    const isAr = language === "ar";
    const { recommendations, recsLoading, recsError, loadRecommendations } = useAIScanner();

    const [activeTab, setActiveTab] = useState<TradeTab>("active");
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        loadRecommendations(isLandingPage);
    }, [loadRecommendations, isLandingPage]);

    // Count per status group
    const counts = useMemo(() => {
        let active = 0, closed = 0;
        recommendations.forEach((r: any) => {
            if (isStatusOpen(r.status)) active++;
            else if (isStatusClosed(r.status)) closed++;
        });
        return { active, closed, total: recommendations.length };
    }, [recommendations]);

    // Filter by active tab
    const tabTrades = useMemo(() => {
        let items = [...recommendations];
        if (activeTab === "active") {
            items = items.filter((r: any) => isStatusOpen(r.status));
            const seen = new Set<string>();
            items = items.filter((r: any) => {
                const sym = (r.symbol || "").toUpperCase();
                if (seen.has(sym)) return false;
                seen.add(sym);
                return true;
            });
        } else if (activeTab === "closed") {
            items = items.filter((r: any) => isStatusClosed(r.status));
        }
        return items.sort(
            (a: any, b: any) => (Number(b.profit_loss_pct) || 0) - (Number(a.profit_loss_pct) || 0)
        );
    }, [recommendations, activeTab]);

    // Stats computed from the CURRENT tab's trades
    const isStatusClosedGroup = (tab: TradeTab) => tab === "closed";
    const stats = useMemo(() => {
        const withPl = tabTrades.filter((r: any) => r.profit_loss_pct != null && !isNaN(Number(r.profit_loss_pct)));
        const plValues = withPl.map((r: any) => Number(r.profit_loss_pct));
        const gainers = plValues.filter((v) => v > 0);
        const losers = plValues.filter((v) => v < 0);
        const flat = plValues.filter((v) => v === 0);
        const sumPl = plValues.reduce((a, b) => a + b, 0);
        const avgPl = plValues.length ? sumPl / plValues.length : null;
        const best = plValues.length ? Math.max(...plValues) : null;
        const worst = plValues.length ? Math.min(...plValues) : null;
        const wins = tabTrades.filter((r: any) => (r.status || "").toLowerCase() === "win").length;
        const winRate = isStatusClosedGroup(activeTab) && tabTrades.length > 0
            ? (wins / tabTrades.length) * 100
            : (gainers.length / (plValues.length || 1)) * 100;

        const byExchange: Record<string, number> = {};
        tabTrades.forEach((r: any) => {
            const ex = (r.exchange || "EGX").toUpperCase();
            byExchange[ex] = (byExchange[ex] || 0) + 1;
        });

        return {
            total: tabTrades.length,
            gainers: gainers.length,
            losers: losers.length,
            flat: flat.length,
            sumPl,
            avgPl,
            best,
            worst,
            winRate,
            byExchange,
        };
    }, [tabTrades, activeTab]);

    // Chart data: P/L per trade (top 15)
    const chartData = useMemo(
        () =>
            tabTrades
                .slice(0, 15)
                .map((r: any) => ({
                    symbol: r.symbol,
                    pl: Number(r.profit_loss_pct) || 0,
                })),
        [tabTrades]
    );

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await loadRecommendations(isLandingPage, true);
        } finally {
            setRefreshing(false);
        }
    };

    const tabs: { id: TradeTab; label: string; count: number }[] = [
        { id: "active", label: isAr ? "الصفقات المفتوحة" : "Open Trades", count: counts.active },
        { id: "closed", label: isAr ? "الصفقات المغلقة" : "Closed Trades", count: counts.closed },
        { id: "all", label: isAr ? "الكل" : "All Trades", count: counts.total },
    ];

    const statCards = [
        {
            labelEn: activeTab === "closed" ? "Closed Trades" : activeTab === "all" ? "Total Trades" : "Open Trades",
            labelAr: activeTab === "closed" ? "صفقات مغلقة" : activeTab === "all" ? "إجمالي الصفقات" : "صفقات مفتوحة",
            value: String(stats.total),
            icon: <Wallet className="w-5 h-5" />,
            bg: "neobrutal-bg-blue",
        },
        {
            labelEn: "In Profit",
            labelAr: "رابحة",
            value: String(stats.gainers),
            icon: <TrendingUp className="w-5 h-5" />,
            bg: "neobrutal-bg-green",
            sub: `${(stats.winRate || 0).toFixed(0)}% ${isAr ? "نسبة" : "rate"}`,
        },
        {
            labelEn: "In Loss",
            labelAr: "خاسرة",
            value: String(stats.losers),
            icon: <TrendingDown className="w-5 h-5" />,
            bg: "neobrutal-bg-pink",
        },
        {
            labelEn: "Avg P/L",
            labelAr: "متوسط العائد",
            value: fmtPct(stats.avgPl),
            icon: <Award className="w-5 h-5" />,
            bg: stats.avgPl != null && stats.avgPl >= 0 ? "neobrutal-bg-green" : "neobrutal-bg-orange",
        },
        {
            labelEn: "Best Trade",
            labelAr: "أفضل صفقة",
            value: fmtPct(stats.best),
            icon: <ArrowUpRight className="w-5 h-5" />,
            bg: "neobrutal-bg-teal",
        },
        {
            labelEn: "Worst Trade",
            labelAr: "أسوأ صفقة",
            value: fmtPct(stats.worst),
            icon: <ArrowDownRight className="w-5 h-5" />,
            bg: "neobrutal-bg-amber",
        },
    ];

    const ChartTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const v = payload[0].value as number;
            return (
                <div className="bg-white dark:bg-zinc-950 border-2 border-black dark:border-white p-2.5 shadow-xl font-mono text-xs">
                    <p className="font-black text-black dark:text-white uppercase mb-1">{label}</p>
                    <p className={v >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                        {fmtPct(v)}
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div
            className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]"
            dir={isAr ? "rtl" : "ltr"}
        >
            {/* Header */}
            <div className="border-b-4 border-black dark:border-white px-5 py-3.5 flex items-center justify-between bg-black dark:bg-zinc-900">
                <div className="flex items-center gap-2.5">
                    <Layers className="w-5 h-5 text-[#FFE600]" />
                    <span className="font-black text-sm uppercase tracking-widest text-white">
                        {isAr ? "لوحة إحصائيات الصفقات" : "TRADES STATISTICS DASHBOARD"}
                    </span>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing || recsLoading}
                    className="w-8 h-8 border-2 border-[#FFE600] text-[#FFE600] flex items-center justify-center cursor-pointer hover:bg-[#FFE600] hover:text-black transition-all disabled:opacity-50"
                    title={isAr ? "تحديث" : "Refresh"}
                >
                    {refreshing || recsLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <RefreshCw className="w-4 h-4" />
                    )}
                </button>
            </div>

            <div className="p-5 space-y-5">
                {/* Tabs Navigation */}
                <div className="flex flex-col sm:flex-row border-4 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] p-1.5 gap-2 select-none">
                    {tabs.map((tab) => {
                        const isSelected = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 py-3 px-4 font-black text-sm flex items-center justify-center gap-2.5 transition-all duration-100 border-2 ${
                                    isSelected
                                        ? "bg-black dark:bg-white border-black dark:border-white shadow-[2px_2px_0px_rgba(0,0,0,0.2)]"
                                        : "bg-white dark:bg-zinc-950 text-black dark:text-white border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                }`}
                                style={{ color: isSelected ? (theme === "dark" ? "#000000" : "#ffffff") : undefined }}
                            >
                                <span style={{ color: isSelected ? (theme === "dark" ? "#000000" : "#ffffff") : undefined }}>
                                    {tab.label}
                                </span>
                                <span
                                    className={`px-2 py-0.5 text-xs font-bold font-mono ${
                                        isSelected
                                            ? "bg-zinc-800 dark:bg-zinc-200 text-zinc-100 dark:text-zinc-900"
                                            : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800"
                                    }`}
                                >
                                    {tab.count}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Stat cards grid (changes per tab) */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {statCards.map((c, idx) => (
                        <div
                            key={idx}
                            className={`border-4 border-black dark:border-white ${c.bg} p-3.5 text-center flex flex-col items-center justify-center gap-1.5 shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)]`}
                        >
                            <div className="text-black">{c.icon}</div>
                            <div className="text-xl sm:text-2xl font-black font-mono tracking-tight leading-none text-black">
                                {c.value}
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-wider text-black/80">
                                {isAr ? c.labelAr : c.labelEn}
                            </div>
                            {c.sub && <div className="text-[9px] font-mono font-bold text-black/70">{c.sub}</div>}
                        </div>
                    ))}
                </div>

                {/* Exchange breakdown */}
                {stats.total > 0 && Object.keys(stats.byExchange).length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono font-bold">
                        <span className="text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
                            {isAr ? "حسب البورصة:" : "By Exchange:"}
                        </span>
                        {Object.entries(stats.byExchange).map(([ex, count]) => (
                            <span
                                key={ex}
                                className="border-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white px-2 py-0.5 font-black uppercase"
                            >
                                {ex}: {count}
                            </span>
                        ))}
                    </div>
                )}

                {/* ===== CHART TOOL (under the active tab) ===== */}
                {recsLoading && tabTrades.length === 0 ? null : stats.total > 0 ? (
                    <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
                        <div className="border-b-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 px-4 py-2.5 flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-widest text-black dark:text-white flex items-center gap-2">
                                <BarChart2 className="w-4 h-4" />
                                {isAr ? "شارت العائدات حسب التاب النشط" : "P/L Chart (Active Tab)"}
                            </span>
                            <span className="text-[10px] font-mono font-bold text-zinc-500">
                                {isAr ? `أعلى ${chartData.length} صفقة` : `Top ${chartData.length} trades`}
                            </span>
                        </div>
                        <div className="h-[280px] w-full p-2" dir="ltr">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-black/[0.08] dark:text-white/[0.05]" />
                                    <XAxis
                                        dataKey="symbol"
                                        stroke="currentColor"
                                        className="text-zinc-500/70 dark:text-white/15"
                                        tick={{ fontSize: 9, fontFamily: "monospace" }}
                                        interval={0}
                                        angle={-35}
                                        textAnchor="end"
                                        height={50}
                                    />
                                    <YAxis
                                        stroke="currentColor"
                                        className="text-zinc-500/70 dark:text-white/15"
                                        tick={{ fontSize: 9, fontFamily: "monospace" }}
                                        tickFormatter={(v) => `${v}%`}
                                    />
                                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "currentColor", fillOpacity: 0.05 }} />
                                    <ReferenceLine y={0} stroke="currentColor" className="text-black dark:text-white" strokeWidth={1.5} />
                                    <Bar dataKey="pl" radius={[3, 3, 0, 0]} maxBarSize={48}>
                                        {chartData.map((entry, i) => (
                                            <Cell key={i} fill={entry.pl >= 0 ? "#16a34a" : "#dc2626"} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                ) : null}

                {/* Trades Table */}
                {recsError ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                        <span className="text-xs font-mono text-rose-500">{recsError}</span>
                        <button
                            onClick={handleRefresh}
                            className="px-4 py-2 border-2 border-black dark:border-white bg-amber-300 dark:bg-amber-400 text-black font-black text-[10px] uppercase tracking-widest cursor-pointer"
                        >
                            {isAr ? "إعادة المحاولة" : "Retry"}
                        </button>
                    </div>
                ) : recsLoading && tabTrades.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-3">
                        <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
                        <span className="text-xs font-mono text-zinc-500">
                            {isAr ? "جاري تحميل الصفقات..." : "Loading trades..."}
                        </span>
                    </div>
                ) : stats.total === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                        <Minus className="w-7 h-7 text-zinc-400" />
                        <span className="text-xs font-mono text-zinc-500">
                            {activeTab === "closed"
                                ? isAr ? "لا توجد صفقات مغلقة حالياً" : "No closed trades at the moment"
                                : activeTab === "active"
                                ? isAr ? "لا توجد صفقات مفتوحة حالياً" : "No open trades at the moment"
                                : isAr ? "لا توجد صفقات" : "No trades"}
                        </span>
                    </div>
                ) : (
                    <div className="border-2 border-black dark:border-white overflow-x-auto">
                        <table className="w-full text-xs font-mono">
                            <thead>
                                <tr className="border-b-2 border-black dark:border-white bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white">
                                    <th className="px-3 py-2 text-left font-black uppercase text-[10px]">
                                        {isAr ? "السهم" : "Symbol"}
                                    </th>
                                    <th className="px-3 py-2 text-right font-black uppercase text-[10px]">
                                        {isAr ? "الدخول" : "Entry"}
                                    </th>
                                    <th className="px-3 py-2 text-right font-black uppercase text-[10px]">
                                        {isAr ? "الحالي" : "Current"}
                                    </th>
                                    <th className="px-3 py-2 text-right font-black uppercase text-[10px]">
                                        <Target className="w-3 h-3 inline" /> {isAr ? "الهدف" : "TP"}
                                    </th>
                                    <th className="px-3 py-2 text-right font-black uppercase text-[10px]">
                                        <ShieldAlert className="w-3 h-3 inline" /> {isAr ? "الوقف" : "SL"}
                                    </th>
                                    <th className="px-3 py-2 text-left font-black uppercase text-[10px]">
                                        {isAr ? "الحالة" : "Status"}
                                    </th>
                                    <th className="px-3 py-2 text-right font-black uppercase text-[10px]">
                                        {isAr ? "العائد" : "P/L"}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {tabTrades.slice(0, 12).map((r: any) => {
                                    const pl = r.profit_loss_pct != null ? Number(r.profit_loss_pct) : null;
                                    const up = pl != null && pl >= 0;
                                    const s = (r.status || "open").toLowerCase();
                                    const statusLabel = isStatusClosed(s)
                                        ? s === "win" ? (isAr ? "ربح" : "WIN") : (isAr ? "خسارة" : "LOSS")
                                        : (isAr ? "مفتوح" : "OPEN");
                                    const statusColor = isStatusClosed(s)
                                        ? s === "win" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                        : "text-sky-600 dark:text-sky-400";
                                    return (
                                        <tr
                                            key={r.id || r.symbol}
                                            className="border-b border-zinc-200 dark:border-zinc-800 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                                        >
                                            <td className="px-3 py-2 font-black text-black dark:text-white uppercase">
                                                {r.symbol}
                                                <span className="block text-[9px] font-bold text-zinc-500">
                                                    {r.exchange || "EGX"}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">
                                                {fmtPrice(r.entry_price)}
                                            </td>
                                            <td className="px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">
                                                {fmtPrice(r.last_close)}
                                            </td>
                                            <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">
                                                {fmtPrice(r.target_price)}
                                            </td>
                                            <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-400">
                                                {fmtPrice(r.stop_loss)}
                                            </td>
                                            <td className={`px-3 py-2 font-black ${statusColor}`}>
                                                {statusLabel}
                                            </td>
                                            <td className={`px-3 py-2 text-right font-black ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                {up ? <ArrowUpRight className="w-3 h-3 inline" /> : <ArrowDownRight className="w-3 h-3 inline" />}
                                                {fmtPct(pl)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500 text-center">
                    {isAr
                        ? "الإحصائيات والشارت تتحدث حسب التاب المختار (مفتوحة / مغلقة / الكل)."
                        : "Statistics and chart update based on the selected tab (Open / Closed / All)."}
                </p>
            </div>
        </div>
    );
}
