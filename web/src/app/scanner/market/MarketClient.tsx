"use client";

import React, { useState, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
    Loader2, RefreshCw, Landmark,
    ArrowUpRight, ArrowDownRight, Globe, AlertTriangle, AlertCircle,
    DollarSign, Activity, BookOpen, Layers
} from "lucide-react";
import {
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid
} from "recharts";

interface MarketDataPoint {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

interface MarketStatusResponse {
    egx30: MarketDataPoint[];
    egx100: MarketDataPoint[];
    usdegp: MarketDataPoint[];
    regime: string;
    egx30_return: number;
    reject_buys: boolean;
    updated_at: string;
}

export default function MarketClient() {
    const { t, language } = useLanguage();
    const isAr = language === "ar";

    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<MarketStatusResponse | null>(null);
    const [activeTab, setActiveTab] = useState<"egx30" | "egx100" | "usdegp">("egx30");

    const fetchMarketStatus = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/market/status");
            if (!res.ok) {
                throw new Error(`Failed to load market data (Status ${res.status})`);
            }
            const payload: MarketStatusResponse = await res.json();
            setData(payload);
        } catch (err: any) {
            console.error("Error fetching market status:", err);
            setError(err.message || "Failed to load market data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void fetchMarketStatus();
    }, []);

    const formatDate = (dateStr: string) => {
        if (!dateStr) return "";
        try {
            const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
            return new Date(dateStr).toLocaleDateString(isAr ? "ar-EG" : "en-US", options);
        } catch {
            return dateStr;
        }
    };

    const getStats = (points: MarketDataPoint[]) => {
        if (!points || points.length < 2) return { last: 0, change: 0, changePct: 0 };
        const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
        const last = sorted[sorted.length - 1].close;
        const prev = sorted[sorted.length - 2].close;
        const change = last - prev;
        const changePct = (change / prev) * 100;
        return { last, change, changePct };
    };

    const egx30Stats = data?.egx30 ? getStats(data.egx30) : { last: 0, change: 0, changePct: 0 };
    const egx100Stats = data?.egx100 ? getStats(data.egx100) : { last: 0, change: 0, changePct: 0 };
    const usdegpStats = data?.usdegp ? getStats(data.usdegp) : { last: 0, change: 0, changePct: 0 };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white dark:bg-zinc-950 border border-black/10 dark:border-white/10 p-3.5 shadow-2xl font-sans text-xs text-right space-y-1">
                    <p className="text-zinc-500 dark:text-zinc-500 font-bold">{label}</p>
                    <p className="text-zinc-950 dark:text-white font-mono font-black text-sm">
                        {payload[0].value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        <span className="text-[10px] text-zinc-500 dark:text-zinc-400 mr-1">EGP</span>
                    </p>
                </div>
            );
        }
        return null;
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                <p className="text-sm font-mono text-zinc-600 dark:text-zinc-500">
                    {isAr ? "جاري تحميل بيانات وتحليلات السوق البورصة المصرية..." : "Loading EGX market data and analysis..."}
                </p>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="market-error mx-auto max-w-[1600px] w-full px-4 py-8 md:px-6 mt-2">
                <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-16 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] flex flex-col items-center justify-center gap-6 text-center">
                    <AlertTriangle className="w-12 h-12 text-red-500" />
                    <div className="space-y-2">
                        <h3 className="text-base font-black text-zinc-950 dark:text-zinc-300 uppercase tracking-widest">
                            {isAr ? "فشل تحميل البيانات" : "Data Load Failed"}
                        </h3>
                        <p className="text-xs text-zinc-600 dark:text-zinc-500 font-semibold max-w-md">{error}</p>
                    </div>
                    <button
                        onClick={() => void fetchMarketStatus()}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2 border-2 border-indigo-500 shadow-[3px_3px_0px_rgba(99,102,241,0.3)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                        {isAr ? "إعادة المحاولة" : "Retry"}
                    </button>
                </div>
            </div>
        );
    }

    const activeChartData =
        activeTab === "egx30" ? data.egx30 :
        activeTab === "egx100" ? data.egx100 :
        data.usdegp;

    const chartColor =
        activeTab === "usdegp" ? "#a855f7" :
        activeTab === "egx30" ? "#6366f1" :
        "#3b82f6";

    const regime = data.regime || "sideways";

    const getRegimeDetails = (reg: string) => {
        switch (reg) {
            case "panic":
                return {
                    title: t("market.regime.panic.title"),
                    desc: t("market.regime.panic.desc"),
                    border: "border-red-500/30",
                    bg: "bg-red-500/5",
                    text: "text-red-400",
                    icon: "text-red-400"
                };
            case "trending_up":
                return {
                    title: t("market.regime.trending_up.title"),
                    desc: t("market.regime.trending_up.desc"),
                    border: "border-emerald-500/30",
                    bg: "bg-emerald-500/5",
                    text: "text-emerald-400",
                    icon: "text-emerald-400"
                };
            case "trending_down":
                return {
                    title: t("market.regime.trending_down.title"),
                    desc: t("market.regime.trending_down.desc"),
                    border: "border-amber-500/30",
                    bg: "bg-amber-500/5",
                    text: "text-amber-400",
                    icon: "text-amber-400"
                };
            case "sideways":
            default:
                return {
                    title: t("market.regime.sideways.title"),
                    desc: t("market.regime.sideways.desc"),
                    border: "border-blue-500/30",
                    bg: "bg-blue-500/5",
                    text: "text-blue-400",
                    icon: "text-blue-400"
                };
        }
    };

    const activeRegime = getRegimeDetails(regime);

    return (
        <div
            className="market-shell app-page-shell mx-auto max-w-[1600px] w-full px-4 py-8 md:px-6 md:py-12 mt-2 min-h-[calc(100vh-200px)]"
            dir={isAr ? "rtl" : "ltr"}
        >
            {/* Hero Banner */}
            <div className="relative overflow-hidden rounded-none border-4 border-black dark:border-white bg-[#FFE600] dark:bg-[#FFE600] text-black dark:text-white p-6 sm:p-8 md:p-12 mb-8 shadow-[6px_6px_0px_0px_#000000] dark:shadow-[6px_6px_0px_0px_#ffffff]">
                <div className="relative z-10 max-w-2xl space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 border-2 border-black dark:border-black bg-black dark:bg-black text-[#FFE600] dark:text-[#FFE600] text-xs font-black uppercase tracking-wider">
                        <Activity className="w-3.5 h-3.5" />
                        {isAr ? "تحليل السوق" : "MARKET ANALYSIS"}
                    </div>
                    <h1 className="text-2xl sm:text-3xl md:text-5xl font-black text-black dark:text-white tracking-tight leading-tight uppercase">
                        {t("market.title")}
                    </h1>
                    <p className="text-black/80 dark:text-white/80 font-mono text-xs md:text-sm leading-relaxed font-semibold">
                        {t("market.subtitle")}
                    </p>
                    <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-black/60 dark:text-white/60 font-bold">
                            {t("market.last_updated")} {new Date(data.updated_at).toLocaleTimeString(isAr ? "ar-EG" : "en-US")}
                        </span>
                        <button
                            onClick={() => void fetchMarketStatus()}
                            className="w-9 h-9 border-2 border-black dark:border-black bg-black dark:bg-black hover:bg-zinc-800 text-[#FFE600] flex items-center justify-center cursor-pointer active:translate-x-[1px] active:translate-y-[1px] transition-all shadow-[2px_2px_0px_rgba(0,0,0,0.3)]"
                            title={isAr ? "تحديث" : "Refresh"}
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Metrics Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 font-sans font-medium">
                {/* EGX 30 Card */}
                <div
                    onClick={() => setActiveTab("egx30")}
                    className={`border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] cursor-pointer transition-all relative overflow-hidden flex flex-col justify-between ${
                        activeTab === "egx30" ? "!border-indigo-500 !shadow-[6px_6px_0px_0px_rgba(99,102,241,0.4)]" : "hover:border-zinc-400 dark:hover:border-zinc-500"
                    }`}
                >
                    <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : "flex-row"} mb-3`}>
                        <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{t("market.egx30_card")}</span>
                        <Landmark className={`w-5 h-5 ${activeTab === "egx30" ? "text-indigo-400" : "text-zinc-500"}`} />
                    </div>
                    <div className={`flex items-baseline gap-2 ${isAr ? "justify-start flex-row-reverse" : "justify-start"}`}>
                        <span className="text-3xl font-black text-zinc-950 dark:text-white font-mono leading-none">
                            {egx30Stats.last.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-500 font-bold">{t("market.points")}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 mt-4 font-mono ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className={`text-sm font-black flex items-center ${egx30Stats.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {egx30Stats.changePct >= 0 ? "+" : ""}{egx30Stats.changePct.toFixed(2)}%
                        </span>
                        {egx30Stats.changePct >= 0
                            ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                            : <ArrowDownRight className="w-4 h-4 text-rose-400" />
                        }
                    </div>
                </div>

                {/* EGX 100 Card */}
                <div
                    onClick={() => setActiveTab("egx100")}
                    className={`border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] cursor-pointer transition-all relative overflow-hidden flex flex-col justify-between ${
                        activeTab === "egx100" ? "!border-blue-500 !shadow-[6px_6px_0px_0px_rgba(59,130,246,0.4)]" : "hover:border-zinc-400 dark:hover:border-zinc-500"
                    }`}
                >
                    <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : "flex-row"} mb-3`}>
                        <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{t("market.egx100_card")}</span>
                        <Layers className={`w-5 h-5 ${activeTab === "egx100" ? "text-blue-400" : "text-zinc-500"}`} />
                    </div>
                    <div className={`flex items-baseline gap-2 ${isAr ? "justify-start flex-row-reverse" : "justify-start"}`}>
                        <span className="text-3xl font-black text-zinc-950 dark:text-white font-mono leading-none">
                            {egx100Stats.last.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-500 font-bold">{t("market.points")}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 mt-4 font-mono ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className={`text-sm font-black flex items-center ${egx100Stats.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {egx100Stats.changePct >= 0 ? "+" : ""}{egx100Stats.changePct.toFixed(2)}%
                        </span>
                        {egx100Stats.changePct >= 0
                            ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                            : <ArrowDownRight className="w-4 h-4 text-rose-400" />
                        }
                    </div>
                </div>

                {/* USD/EGP Forex Card */}
                <div
                    onClick={() => void setActiveTab("usdegp")}
                    className={`border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] cursor-pointer transition-all relative overflow-hidden flex flex-col justify-between ${
                        activeTab === "usdegp" ? "!border-purple-500 !shadow-[6px_6px_0px_0px_rgba(168,85,247,0.4)]" : "hover:border-zinc-400 dark:hover:border-zinc-500"
                    }`}
                >
                    <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : "flex-row"} mb-3`}>
                        <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">{t("market.usdegp_card")}</span>
                        <DollarSign className={`w-5 h-5 ${activeTab === "usdegp" ? "text-purple-400" : "text-zinc-500"}`} />
                    </div>
                    <div className={`flex items-baseline gap-2 ${isAr ? "justify-start flex-row-reverse" : "justify-start"}`}>
                        <span className="text-3xl font-black text-zinc-950 dark:text-white font-mono leading-none">
                            {usdegpStats.last.toFixed(2)}
                        </span>
                        <span className="text-xs text-zinc-600 dark:text-zinc-500 font-bold">{t("market.egp")}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 mt-4 font-mono ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className={`text-sm font-black flex items-center ${usdegpStats.changePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {usdegpStats.changePct >= 0 ? "+" : ""}{usdegpStats.changePct.toFixed(2)}%
                        </span>
                        {usdegpStats.changePct >= 0
                            ? <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                            : <ArrowDownRight className="w-4 h-4 text-rose-400" />
                        }
                    </div>
                </div>
            </div>

            {/* Current Market Regime Status */}
            <div className={`border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] mb-10 font-sans ${activeRegime.border}`}>
                <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4`}>
                    <div className={`flex items-start gap-3.5 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <AlertCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${activeRegime.icon}`} />
                        <div className={isAr ? "text-right" : "text-left"}>
                            <h4 className={`text-sm font-black uppercase tracking-wider ${activeRegime.text}`}>
                                {t("market.regime_label")} {activeRegime.title}
                            </h4>
                            <p className="text-xs font-semibold text-zinc-700 dark:text-white/70 mt-1 max-w-2xl leading-relaxed">
                                {activeRegime.desc}
                            </p>
                        </div>
                    </div>
                    {data.reject_buys && (
                        <span className={`border-2 ${activeRegime.border} ${activeRegime.bg} ${activeRegime.text} px-3 py-1.5 text-[10px] font-black uppercase tracking-wider self-start md:self-auto shrink-0`}>
                            {t("market.buy_paused")}
                        </span>
                    )}
                </div>
            </div>

            {/* Main Chart Card */}
            <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] mb-10 rounded-none">
                <div className={`flex items-center justify-between mb-6 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                    <div className="space-y-1">
                        <span className="text-xs font-black text-zinc-700 dark:text-zinc-400 uppercase tracking-wider">
                            {activeTab === "egx30" ? t("market.tab_egx30_desc") :
                             activeTab === "egx100" ? t("market.tab_egx100_desc") :
                             t("market.tab_usdegp_desc")}
                        </span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: chartColor }} />
                        <span className="text-xs text-zinc-600 dark:text-zinc-400 font-mono uppercase font-bold">{activeTab}</span>
                    </div>
                </div>

                <div className="h-[380px] w-full" dir="ltr">
                    {activeChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={activeChartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                                <defs>
                                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={chartColor} stopOpacity={0.25}/>
                                        <stop offset="95%" stopColor={chartColor} stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-black/[0.06] dark:text-white/[0.03]" />
                                <XAxis
                                    dataKey="date"
                                    tickFormatter={formatDate}
                                    stroke="currentColor"
                                    className="text-zinc-500/70 dark:text-white/15"
                                    tick={{ fontSize: 9, fontFamily: 'monospace' }}
                                />
                                <YAxis
                                    domain={['auto', 'auto']}
                                    stroke="currentColor"
                                    className="text-zinc-500/70 dark:text-white/15"
                                    tick={{ fontSize: 9, fontFamily: 'monospace' }}
                                    orientation={isAr ? "left" : "right"}
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <Area
                                    type="monotone"
                                    dataKey="close"
                                    stroke={chartColor}
                                    strokeWidth={2.5}
                                    fillOpacity={1}
                                    fill="url(#chartGradient)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full w-full gap-3">
                            <AlertTriangle className="w-8 h-8 text-zinc-600" />
                            <p className="text-xs font-mono text-zinc-600 dark:text-zinc-500">{t("market.no_data")}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Smart Market Outlook / Educational and Depth Insights */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-sans">
                {/* Market Maker Insights */}
                <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] space-y-4 rounded-none">
                    <h3 className={`text-sm font-black text-zinc-950 dark:text-white uppercase tracking-widest flex items-center gap-2 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <BookOpen className="w-4 h-4 text-amber-400" />
                        {t("market.maker_title")}
                    </h3>
                    <div className={`space-y-4 text-xs leading-relaxed text-zinc-700 dark:text-zinc-400 ${isAr ? "text-right" : "text-left"}`}>
                        <p>{t("market.maker_intro")}</p>
                        <ul className="space-y-3">
                            <li className="flex flex-col gap-1">
                                <strong className="text-zinc-950 dark:text-zinc-200">{t("market.maker_accum_title")}</strong>
                                <span className="text-zinc-700 dark:text-zinc-400">{t("market.maker_accum_desc")}</span>
                            </li>
                            <li className="flex flex-col gap-1">
                                <strong className="text-zinc-950 dark:text-zinc-200">{t("market.maker_dist_title")}</strong>
                                <span className="text-zinc-700 dark:text-zinc-400">{t("market.maker_dist_desc")}</span>
                            </li>
                        </ul>
                        <p className="text-[11px] text-zinc-600 dark:text-zinc-500 border-t border-zinc-200 dark:border-zinc-800 pt-3">
                            💡 {t("market.maker_tip")}
                        </p>
                    </div>
                </div>

                {/* Macro Economic Analysis */}
                <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] space-y-4 rounded-none">
                    <h3 className={`text-sm font-black text-zinc-950 dark:text-white uppercase tracking-widest flex items-center gap-2 ${isAr ? "flex-row-reverse" : "flex-row"}`}>
                        <Globe className="w-4 h-4 text-purple-400" />
                        {t("market.macro_title")}
                    </h3>
                    <div className={`space-y-4 text-xs leading-relaxed text-zinc-700 dark:text-zinc-400 ${isAr ? "text-right" : "text-left"}`}>
                        <p>{t("market.macro_intro")}</p>
                        <ul className="space-y-3">
                            <li className="flex flex-col gap-1">
                                <strong className="text-zinc-950 dark:text-zinc-200">{t("market.macro_hedge_title")}</strong>
                                <span className="text-zinc-700 dark:text-zinc-400">{t("market.macro_hedge_desc")}</span>
                            </li>
                            <li className="flex flex-col gap-1">
                                <strong className="text-zinc-950 dark:text-zinc-200">{t("market.macro_reval_title")}</strong>
                                <span className="text-zinc-700 dark:text-zinc-400">{t("market.macro_reval_desc")}</span>
                            </li>
                        </ul>
                        <p className="text-[11px] text-zinc-600 dark:text-zinc-500 border-t border-zinc-200 dark:border-zinc-800 pt-3">
                            💡 {t("market.macro_tip")}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
