"use client";

import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import {
    Calendar as CalendarIcon,
    ChevronLeft,
    ChevronRight,
    TrendingUp,
    TrendingDown,
    Target,
    CheckCircle2,
    XCircle,
    Info,
    ShieldCheck,
    Filter,
    ArrowUpRight,
    ArrowDownRight,
    Sparkles,
    Clock,
    PieChart,
    BarChart2,
    X,
    Grid,
    List,
    Award,
    Activity
} from "lucide-react";
import StockLogo from "./StockLogo";
import { isShariaCompliant } from "@/lib/shariaStocks";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";

interface RecommendationCalendarProps {
    recommendations: any[];
    loading?: boolean;
    onSelectStock?: (stock: any) => void;
}

export default function RecommendationCalendar({
    recommendations = [],
    loading = false,
    onSelectStock
}: RecommendationCalendarProps) {
    const { language } = useLanguage();
    const isAr = language === "ar";
    const { theme } = useTheme();
    const isDark = theme === "dark";

    // Mounted state for createPortal
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    // Current viewed date for the calendar
    const [currentDate, setCurrentDate] = useState(() => new Date());
    
    // Quick Filter Presets: 'all' | 'this_month' | 'last_month' | '30days' | 'custom'
    const [filterPreset, setFilterPreset] = useState<"all" | "this_month" | "last_month" | "30days" | "custom">("this_month");
    const [customFrom, setCustomFrom] = useState<string>("");
    const [customTo, setCustomTo] = useState<string>("");

    // Selected Day Modal State
    const [selectedDayDateStr, setSelectedDayDateStr] = useState<string | null>(null);
    const [dayModalFilter, setDayModalFilter] = useState<"all" | "created" | "closed">("all");

    // View Mode: Calendar vs Agenda List
    const [viewMode, setViewMode] = useState<"calendar" | "agenda">("calendar");

    // Sharia Filter
    const [shariaOnly, setShariaOnly] = useState(false);

    // ESC key listener to close modal
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSelectedDayDateStr(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    // Sync currentDate when preset changes
    useEffect(() => {
        const now = new Date();
        if (filterPreset === "this_month") {
            setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
        } else if (filterPreset === "last_month") {
            setCurrentDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        }
    }, [filterPreset]);

    // Helpers for Date Formatting
    const formatYMD = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    };

    const parseYMD = (dateStr: string | null | undefined): string | null => {
        if (!dateStr) return null;
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return null;
            return formatYMD(d);
        } catch {
            return null;
        }
    };

    // Extract month and year details
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthNamesAr = [
        "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
        "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
    ];
    const monthNamesEn = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const daysOfWeekAr = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    const daysOfWeekEn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const currentMonthName = isAr ? monthNamesAr[month] : monthNamesEn[month];
    const currentDaysOfWeek = isAr ? daysOfWeekAr : daysOfWeekEn;

    // Filter base recommendations by Sharia if toggled
    const filteredBaseRecs = useMemo(() => {
        if (shariaOnly) {
            return recommendations.filter(r => isShariaCompliant(r.symbol));
        }
        return recommendations;
    }, [recommendations, shariaOnly]);

    // Compute Date Range Boundaries for Global Statistics Filter
    const dateRangeBoundaries = useMemo(() => {
        const now = new Date();
        if (filterPreset === "this_month") {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
            return { start, end };
        }
        if (filterPreset === "last_month") {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
            return { start, end };
        }
        if (filterPreset === "30days") {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 30);
            return { start, end };
        }
        if (filterPreset === "custom" && customFrom && customTo) {
            const start = new Date(customFrom);
            const end = new Date(customTo);
            end.setHours(23, 59, 59);
            return { start, end };
        }
        // Preset 'all' or fallback
        return null;
    }, [filterPreset, customFrom, customTo]);

    // General Dynamic Statistics matching selected date filter
    const globalStats = useMemo(() => {
        let recs = filteredBaseRecs;

        if (dateRangeBoundaries) {
            const { start, end } = dateRangeBoundaries;
            recs = recs.filter(r => {
                const cDate = r.created_at ? new Date(r.created_at) : null;
                const uDate = r.updated_at ? new Date(r.updated_at) : null;
                const inCreated = cDate && cDate >= start && cDate <= end;
                const inClosed = uDate && uDate >= start && uDate <= end && (r.status?.toLowerCase() === "win" || r.status?.toLowerCase() === "loss");
                return inCreated || inClosed;
            });
        }

        const createdCount = recs.length;
        const closedTrades = recs.filter(r => {
            const s = (r.status || "").toLowerCase();
            return s === "win" || s === "loss";
        });
        const openTrades = recs.filter(r => {
            const s = (r.status || "").toLowerCase();
            return s !== "win" && s !== "loss";
        });

        const wins = closedTrades.filter(r => (r.status || "").toLowerCase() === "win");
        const losses = closedTrades.filter(r => (r.status || "").toLowerCase() === "loss");

        const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

        // Calculate net cumulative profit percentage
        const netProfitPct = closedTrades.reduce((acc, r) => acc + (r.profit_loss_pct || 0), 0);
        const avgReturnPct = closedTrades.length > 0 ? netProfitPct / closedTrades.length : 0;

        // Best and Worst Trades
        let bestTrade: any = null;
        let worstTrade: any = null;
        closedTrades.forEach(r => {
            if (r.profit_loss_pct != null) {
                if (!bestTrade || r.profit_loss_pct > bestTrade.profit_loss_pct) bestTrade = r;
                if (!worstTrade || r.profit_loss_pct < worstTrade.profit_loss_pct) worstTrade = r;
            }
        });

        return {
            createdCount,
            openCount: openTrades.length,
            closedCount: closedTrades.length,
            winCount: wins.length,
            lossCount: losses.length,
            winRate,
            netProfitPct,
            avgReturnPct,
            bestTrade,
            worstTrade
        };
    }, [filteredBaseRecs, dateRangeBoundaries]);

    // Group recommendations by day string YYYY-MM-DD
    const dayMap = useMemo(() => {
        const map = new Map<string, {
            created: any[];
            closed: any[];
            wins: any[];
            losses: any[];
            netProfitPct: number;
        }>();

        filteredBaseRecs.forEach(r => {
            // Created on date
            const createdYmd = parseYMD(r.created_at);
            if (createdYmd) {
                if (!map.has(createdYmd)) {
                    map.set(createdYmd, { created: [], closed: [], wins: [], losses: [], netProfitPct: 0 });
                }
                map.get(createdYmd)!.created.push(r);
            }

            // Closed on date
            const statusLower = (r.status || "").toLowerCase();
            if (statusLower === "win" || statusLower === "loss") {
                const closedYmd = parseYMD(r.updated_at || r.created_at);
                if (closedYmd) {
                    if (!map.has(closedYmd)) {
                        map.set(closedYmd, { created: [], closed: [], wins: [], losses: [], netProfitPct: 0 });
                    }
                    const entry = map.get(closedYmd)!;
                    entry.closed.push(r);
                    if (statusLower === "win") entry.wins.push(r);
                    if (statusLower === "loss") entry.losses.push(r);
                    if (r.profit_loss_pct != null) {
                        entry.netProfitPct += Number(r.profit_loss_pct);
                    }
                }
            }
        });

        return map;
    }, [filteredBaseRecs]);

    // Generate Calendar Grid Days for current month
    const calendarDays = useMemo(() => {
        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday
        const totalDays = lastDayOfMonth.getDate();

        const days = [];

        // Previous month padding
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = startingDayOfWeek - 1; i >= 0; i--) {
            const dayNum = prevMonthLastDay - i;
            const prevDate = new Date(year, month - 1, dayNum);
            days.push({
                date: prevDate,
                dateStr: formatYMD(prevDate),
                isCurrentMonth: false,
                dayNum
            });
        }

        // Current month days
        for (let d = 1; d <= totalDays; d++) {
            const currDate = new Date(year, month, d);
            days.push({
                date: currDate,
                dateStr: formatYMD(currDate),
                isCurrentMonth: true,
                dayNum: d
            });
        }

        // Next month padding to fill grid (multiple of 7)
        const totalCells = Math.ceil(days.length / 7) * 7;
        const nextPadding = totalCells - days.length;
        for (let n = 1; n <= nextPadding; n++) {
            const nextDate = new Date(year, month + 1, n);
            days.push({
                date: nextDate,
                dateStr: formatYMD(nextDate),
                isCurrentMonth: false,
                dayNum: n
            });
        }

        return days;
    }, [year, month]);

    // Selected Day Data for Modal
    const selectedDayData = useMemo(() => {
        if (!selectedDayDateStr) return null;
        const data = dayMap.get(selectedDayDateStr) || { created: [], closed: [], wins: [], losses: [], netProfitPct: 0 };
        
        // Merge created & closed for day view (deduplicated by id)
        const allMap = new Map<string, any>();
        data.created.forEach(item => allMap.set(item.id, { ...item, _isCreatedToday: true }));
        data.closed.forEach(item => {
            const existing = allMap.get(item.id);
            allMap.set(item.id, { ...(existing || item), _isClosedToday: true });
        });

        const allList = Array.from(allMap.values());

        // Filter list by tab
        let filteredList = allList;
        if (dayModalFilter === "created") {
            filteredList = allList.filter(item => item._isCreatedToday);
        } else if (dayModalFilter === "closed") {
            filteredList = allList.filter(item => item._isClosedToday);
        }

        const closedCount = data.closed.length;
        const winCount = data.wins.length;
        const lossCount = data.losses.length;
        const dayWinRate = closedCount > 0 ? (winCount / closedCount) * 100 : 0;

        return {
            dateStr: selectedDayDateStr,
            data,
            allList,
            filteredList,
            closedCount,
            winCount,
            lossCount,
            dayWinRate
        };
    }, [selectedDayDateStr, dayMap, dayModalFilter]);

    // Navigation Controls
    const prevMonth = () => {
        setCurrentDate(new Date(year, month - 1, 1));
    };

    const nextMonth = () => {
        setCurrentDate(new Date(year, month + 1, 1));
    };

    const todayDateStr = formatYMD(new Date());

    return (
        <div className="w-full space-y-4 sm:space-y-6 select-none text-zinc-900 dark:text-zinc-100" dir={isAr ? "rtl" : "ltr"}>
            {/* ── HEADER & DASHBOARD STATS BAR ── */}
            <div className="p-3.5 sm:p-5 md:p-6 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl dark:shadow-2xl relative overflow-hidden space-y-4 sm:space-y-6">
                {/* Background ambient glow */}
                <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 blur-3xl pointer-events-none rounded-full" />
                <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-500/5 blur-3xl pointer-events-none rounded-full" />

                {/* Top Control Bar */}
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4 border-b border-zinc-200 dark:border-zinc-800/80 pb-4 sm:pb-5">
                    <div>
                        <div className="flex items-center gap-2 sm:gap-2.5">
                            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                                <CalendarIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                            </div>
                            <h2 className="text-lg sm:text-xl md:text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
                                {isAr ? "تقويم أرباح وإحصائيات التوصيات" : "Recommendations Profit Calendar"}
                            </h2>
                        </div>
                        <p className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 mt-1 font-medium">
                            {isAr 
                                ? "تتبع الأرباح اليومية، والتوصيات المنشأة والمغلقة بدقة عالية"
                                : "Track daily profits, created and closed recommendations accurately"}
                        </p>
                    </div>

                    {/* Presets & View Controls */}
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                        {/* Sharia Toggle */}
                        <button
                            onClick={() => setShariaOnly(!shariaOnly)}
                            className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-[11px] sm:text-xs font-black transition-all border shrink-0 ${
                                shariaOnly
                                    ? "bg-emerald-500/10 dark:bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shadow-md shadow-emerald-500/10"
                                    : "bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
                            }`}
                        >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>{isAr ? "شرعي فقط" : "Sharia"}</span>
                        </button>

                        {/* Presets buttons */}
                        <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 p-0.5 sm:p-1 rounded-xl border border-zinc-200 dark:border-zinc-800 text-[10px] sm:text-xs font-bold overflow-x-auto max-w-full">
                            <button
                                onClick={() => setFilterPreset("this_month")}
                                className={`px-2 sm:px-2.5 py-1 rounded-lg transition-all whitespace-nowrap ${
                                    filterPreset === "this_month"
                                        ? "bg-amber-500 text-black font-black shadow-md"
                                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                                }`}
                            >
                                {isAr ? "هذا الشهر" : "This Month"}
                            </button>
                            <button
                                onClick={() => setFilterPreset("last_month")}
                                className={`px-2 sm:px-2.5 py-1 rounded-lg transition-all whitespace-nowrap ${
                                    filterPreset === "last_month"
                                        ? "bg-amber-500 text-black font-black shadow-md"
                                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                                }`}
                            >
                                {isAr ? "الشهر الماضي" : "Last Month"}
                            </button>
                            <button
                                onClick={() => setFilterPreset("30days")}
                                className={`px-2 sm:px-2.5 py-1 rounded-lg transition-all whitespace-nowrap ${
                                    filterPreset === "30days"
                                        ? "bg-amber-500 text-black font-black shadow-md"
                                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                                }`}
                            >
                                {isAr ? "آخر 30 يوم" : "Last 30D"}
                            </button>
                            <button
                                onClick={() => setFilterPreset("all")}
                                className={`px-2 sm:px-2.5 py-1 rounded-lg transition-all whitespace-nowrap ${
                                    filterPreset === "all"
                                        ? "bg-amber-500 text-black font-black shadow-md"
                                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                                }`}
                            >
                                {isAr ? "الكل" : "All"}
                            </button>
                        </div>

                        {/* View Switcher: Calendar vs Agenda */}
                        <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 p-0.5 sm:p-1 rounded-xl border border-zinc-200 dark:border-zinc-800 shrink-0">
                            <button
                                onClick={() => setViewMode("calendar")}
                                title={isAr ? "عرض التقويم" : "Calendar View"}
                                className={`p-1.5 rounded-lg transition-all ${
                                    viewMode === "calendar"
                                        ? "bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 shadow-sm font-bold"
                                        : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                            >
                                <Grid className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            </button>
                            <button
                                onClick={() => setViewMode("agenda")}
                                title={isAr ? "عرض القائمة" : "Agenda View"}
                                className={`p-1.5 rounded-lg transition-all ${
                                    viewMode === "agenda"
                                        ? "bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 shadow-sm font-bold"
                                        : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                            >
                                <List className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* DYNAMIC GENERAL STATS CARDS */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                    {/* Card 1: Created */}
                    <div className="p-2.5 sm:p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800/80 flex flex-col justify-between shadow-sm dark:shadow-none">
                        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-[11px] sm:text-xs font-bold">
                            <span>{isAr ? "المنشأة" : "Created"}</span>
                            <Target className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                        </div>
                        <div className="mt-1.5 flex items-baseline justify-between">
                            <span className="text-lg sm:text-xl font-black text-zinc-900 dark:text-white font-mono">{globalStats.createdCount}</span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">{isAr ? "صفقة" : "trades"}</span>
                        </div>
                    </div>

                    {/* Card 2: Closed */}
                    <div className="p-2.5 sm:p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800/80 flex flex-col justify-between shadow-sm dark:shadow-none">
                        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-[11px] sm:text-xs font-bold">
                            <span>{isAr ? "المغلقة" : "Closed"}</span>
                            <Clock className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                        </div>
                        <div className="mt-1.5 flex items-baseline justify-between">
                            <span className="text-lg sm:text-xl font-black text-zinc-900 dark:text-white font-mono">{globalStats.closedCount}</span>
                            <div className="flex gap-1 text-[9px] sm:text-[10px] font-bold">
                                <span className="text-emerald-600 dark:text-emerald-400">{globalStats.winCount}W</span>
                                <span className="text-zinc-400 dark:text-zinc-600">/</span>
                                <span className="text-rose-600 dark:text-rose-400">{globalStats.lossCount}L</span>
                            </div>
                        </div>
                    </div>

                    {/* Card 3: Win Rate */}
                    <div className="p-2.5 sm:p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800/80 flex flex-col justify-between shadow-sm dark:shadow-none">
                        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-[11px] sm:text-xs font-bold">
                            <span>{isAr ? "نسبة النجاح" : "Win Rate"}</span>
                            <Award className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                        </div>
                        <div className="mt-1.5 flex items-baseline justify-between">
                            <span className="text-lg sm:text-xl font-black text-amber-600 dark:text-amber-400 font-mono">
                                {globalStats.winRate.toFixed(1)}%
                            </span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">{isAr ? "دقة" : "acc"}</span>
                        </div>
                    </div>

                    {/* Card 4: Cumulative Net Return */}
                    <div className={`p-2.5 sm:p-3.5 rounded-xl border flex flex-col justify-between transition-all shadow-sm dark:shadow-none ${
                        globalStats.netProfitPct >= 0
                            ? "bg-emerald-50 dark:bg-emerald-500/5 border-emerald-300 dark:border-emerald-500/30"
                            : "bg-rose-50 dark:bg-rose-500/5 border-rose-300 dark:border-rose-500/30"
                    }`}>
                        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-[11px] sm:text-xs font-bold">
                            <span>{isAr ? "صافي الربح" : "Net Profit"}</span>
                            {globalStats.netProfitPct >= 0 ? (
                                <TrendingUp className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                            ) : (
                                <TrendingDown className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
                            )}
                        </div>
                        <div className="mt-1.5 flex items-baseline justify-between">
                            <span className={`text-lg sm:text-xl font-black font-mono ${
                                globalStats.netProfitPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                            }`}>
                                {globalStats.netProfitPct >= 0 ? "+" : ""}{globalStats.netProfitPct.toFixed(1)}%
                            </span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">{isAr ? "تراكمي" : "net"}</span>
                        </div>
                    </div>

                    {/* Card 5: Avg Return per Trade */}
                    <div className="p-2.5 sm:p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800/80 flex flex-col justify-between shadow-sm dark:shadow-none">
                        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-[11px] sm:text-xs font-bold">
                            <span>{isAr ? "متوسط الصفقة" : "Avg Return"}</span>
                            <BarChart2 className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                        </div>
                        <div className="mt-1.5 flex items-baseline justify-between">
                            <span className={`text-lg sm:text-xl font-black font-mono ${
                                globalStats.avgReturnPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                            }`}>
                                {globalStats.avgReturnPct >= 0 ? "+" : ""}{globalStats.avgReturnPct.toFixed(1)}%
                            </span>
                            <span className="text-[9px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 font-medium">{isAr ? "صفقة" : "trade"}</span>
                        </div>
                    </div>

                    {/* Card 6: Best Trade */}
                    <div className="p-2.5 sm:p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800/80 flex flex-col justify-between shadow-sm dark:shadow-none">
                        <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-[11px] sm:text-xs font-bold">
                            <span>{isAr ? "أفضل صفقة" : "Best Trade"}</span>
                            <Sparkles className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                        </div>
                        <div className="mt-1.5 flex items-baseline justify-between">
                            {globalStats.bestTrade ? (
                                <>
                                    <span className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono truncate max-w-[65px] sm:max-w-[80px]">
                                        {globalStats.bestTrade.symbol}
                                    </span>
                                    <span className="text-xs sm:text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono">
                                        +{globalStats.bestTrade.profit_loss_pct?.toFixed(1)}%
                                    </span>
                                </>
                            ) : (
                                <span className="text-xs text-zinc-400 dark:text-zinc-600 font-bold">-</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── CALENDAR VIEW ── */}
            {viewMode === "calendar" ? (
                <div className="p-2.5 sm:p-4 md:p-6 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl dark:shadow-2xl space-y-3 sm:space-y-4">
                    {/* Month Navigation */}
                    <div className="flex items-center justify-between px-1 sm:px-2">
                        <div className="flex items-center gap-2 sm:gap-3">
                            <h3 className="text-base sm:text-lg md:text-xl font-black text-zinc-900 dark:text-white">
                                {currentMonthName} {year}
                            </h3>
                            <span className="text-[10px] sm:text-xs font-bold text-zinc-600 dark:text-zinc-500 bg-zinc-100 dark:bg-zinc-900 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg border border-zinc-200 dark:border-zinc-800">
                                {filteredBaseRecs.length} {isAr ? "توصية" : "signals"}
                            </span>
                        </div>

                        <div className="flex items-center gap-1 sm:gap-2">
                            <button
                                onClick={prevMonth}
                                className="p-1.5 sm:p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all"
                                title={isAr ? "الشهر السابق" : "Previous Month"}
                            >
                                {isAr ? <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" /> : <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />}
                            </button>
                            <button
                                onClick={() => setCurrentDate(new Date())}
                                className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[10px] sm:text-xs font-black text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all"
                            >
                                {isAr ? "اليوم" : "Today"}
                            </button>
                            <button
                                onClick={nextMonth}
                                className="p-1.5 sm:p-2 rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all"
                                title={isAr ? "الشهر التالي" : "Next Month"}
                            >
                                {isAr ? <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" /> : <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                            </button>
                        </div>
                    </div>

                    {/* Days of Week Header */}
                    <div className="grid grid-cols-7 gap-0.5 sm:gap-1 md:gap-2 text-center text-[10px] sm:text-xs font-black text-zinc-500 dark:text-zinc-400 py-1.5 sm:py-2 border-b border-zinc-200 dark:border-zinc-800/60">
                        {currentDaysOfWeek.map((day, idx) => (
                            <div key={idx} className="py-0.5 sm:py-1">
                                <span className="hidden md:inline">{day}</span>
                                <span className="md:hidden">{day.slice(0, 3)}</span>
                            </div>
                        ))}
                    </div>

                    {/* Grid of Calendar Days */}
                    <div className="grid grid-cols-7 gap-0.5 sm:gap-1 md:gap-2">
                        {calendarDays.map((cell, idx) => {
                            const dayInfo = dayMap.get(cell.dateStr);
                            const hasCreated = dayInfo && dayInfo.created.length > 0;
                            const hasClosed = dayInfo && dayInfo.closed.length > 0;
                            const isToday = cell.dateStr === todayDateStr;
                            const isSelected = cell.dateStr === selectedDayDateStr;

                            // Net return formatting for day cell
                            const netPl = dayInfo ? dayInfo.netProfitPct : 0;
                            const isPositive = netPl > 0;
                            const isNegative = netPl < 0;

                            // Cell background styling based on profit/loss
                            let cellBg = cell.isCurrentMonth
                                ? "bg-zinc-50/80 dark:bg-zinc-900/60 border-zinc-200 dark:border-zinc-800/80 hover:bg-zinc-100/90 dark:hover:bg-zinc-800/80"
                                : "bg-zinc-100/40 dark:bg-zinc-950/40 border-zinc-200/50 dark:border-zinc-900/50 text-zinc-400 dark:text-zinc-600 opacity-40";

                            if (cell.isCurrentMonth && hasClosed) {
                                if (isPositive) {
                                    cellBg = "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 hover:bg-emerald-100/80 dark:hover:bg-emerald-500/20";
                                } else if (isNegative) {
                                    cellBg = "bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30 hover:bg-rose-100/80 dark:hover:bg-rose-500/20";
                                }
                            }

                            return (
                                <div
                                    key={idx}
                                    onClick={() => cell.isCurrentMonth && setSelectedDayDateStr(cell.dateStr)}
                                    className={`relative min-h-[58px] sm:min-h-[72px] md:min-h-[92px] p-1 sm:p-1.5 md:p-2 rounded-lg sm:rounded-xl border transition-all duration-150 cursor-pointer flex flex-col justify-between overflow-hidden ${cellBg} ${
                                        isToday ? "ring-2 ring-amber-400 shadow-md shadow-amber-400/10" : ""
                                    } ${isSelected ? "ring-2 ring-indigo-500" : ""}`}
                                >
                                    {/* Top Row: Day Number & Indicators */}
                                    <div className="flex items-center justify-between gap-0.5 leading-none">
                                        <span className={`text-[10px] sm:text-xs md:text-sm font-black font-mono ${
                                            isToday
                                                ? "text-amber-600 dark:text-amber-400 bg-amber-400/10 px-1 py-0.5 rounded"
                                                : cell.isCurrentMonth ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-400 dark:text-zinc-600"
                                        }`}>
                                            {cell.dayNum}
                                        </span>

                                        {/* Created / Closed count badges */}
                                        <div className="flex items-center gap-0.5 shrink-0">
                                            {hasCreated && (
                                                <span className="text-[8px] sm:text-[9px] md:text-[10px] font-black text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-0.5 sm:px-1 rounded" title={`${dayInfo.created.length} ${isAr ? "توصية منشأة" : "created"}`}>
                                                    +{dayInfo.created.length}
                                                </span>
                                            )}
                                            {hasClosed && (
                                                <span className="text-[8px] sm:text-[9px] md:text-[10px] font-black text-indigo-700 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-0.5 sm:px-1 rounded" title={`${dayInfo.closed.length} ${isAr ? "صفقة مغلقة" : "closed"}`}>
                                                    {dayInfo.closed.length}🏁
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Middle/Bottom: Net Daily Return */}
                                    {cell.isCurrentMonth && hasClosed && (
                                        <div className="my-auto flex flex-col items-center justify-center leading-tight">
                                            <span className={`text-[10px] sm:text-xs md:text-sm font-black font-mono tracking-tight ${
                                                isPositive ? "text-emerald-600 dark:text-emerald-400" : isNegative ? "text-rose-600 dark:text-rose-400" : "text-zinc-600 dark:text-zinc-400"
                                            }`}>
                                                {isPositive ? "+" : ""}{netPl.toFixed(1)}%
                                            </span>
                                            <span className="text-[7px] sm:text-[8px] text-zinc-500 dark:text-zinc-400 font-bold hidden sm:inline">
                                                {dayInfo.wins.length}W / {dayInfo.losses.length}L
                                            </span>
                                        </div>
                                    )}

                                    {/* Empty indicator for days without closed trades but with created trades */}
                                    {cell.isCurrentMonth && hasCreated && !hasClosed && (
                                        <div className="my-auto text-center">
                                            <span className="text-[8px] sm:text-[9px] font-bold text-amber-600/90 dark:text-amber-400/80 block truncate">
                                                {dayInfo.created.length} {isAr ? "نشطة" : "Active"}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                /* ── AGENDA / LIST VIEW (FOR MOBILE OR EASY SCROLLING) ── */
                <div className="p-3.5 sm:p-4 md:p-6 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-xl dark:shadow-2xl space-y-3 sm:space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-base sm:text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                            <List className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 dark:text-amber-400" />
                            {isAr ? "جدول التوصيات اليومية الحية" : "Live Recommendations Table"}
                        </h3>
                        <span className="text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400 font-bold">
                            {isAr ? "اضغط لعرض التفاصيل" : "Click to view"}
                        </span>
                    </div>

                    <div className="divide-y divide-zinc-200 dark:divide-zinc-800/80 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-zinc-50/50 dark:bg-zinc-900/40">
                        {Array.from(dayMap.entries())
                            .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
                            .slice(0, 30)
                            .map(([dateStr, dayData]) => {
                                const netPl = dayData.netProfitPct;
                                const isPos = netPl > 0;
                                const isNeg = netPl < 0;

                                return (
                                    <div
                                        key={dateStr}
                                        onClick={() => setSelectedDayDateStr(dateStr)}
                                        className="p-3 sm:p-4 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/50 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3"
                                    >
                                        <div className="flex items-center gap-2.5 sm:gap-3">
                                            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 flex flex-col items-center justify-center font-mono shrink-0">
                                                <span className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-400 uppercase">
                                                    {new Date(dateStr).toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short" })}
                                                </span>
                                                <span className="text-xs sm:text-sm font-black text-zinc-900 dark:text-white leading-none">
                                                    {new Date(dateStr).getDate()}
                                                </span>
                                            </div>
                                            <div>
                                                <div className="text-xs sm:text-sm font-black text-zinc-900 dark:text-white">
                                                    {new Date(dateStr).toLocaleDateString(isAr ? "ar-EG" : "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                                </div>
                                                <div className="flex items-center gap-2 text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                    <span>{isAr ? "أنشئت:" : "Created:"} <strong className="text-amber-600 dark:text-amber-400 font-mono">{dayData.created.length}</strong></span>
                                                    <span>•</span>
                                                    <span>{isAr ? "أغلقت:" : "Closed:"} <strong className="text-indigo-600 dark:text-indigo-400 font-mono">{dayData.closed.length}</strong></span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4">
                                            <div className="flex gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-bold">
                                                <span className="px-1.5 sm:px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20">
                                                    {dayData.wins.length} {isAr ? "رابحة" : "Wins"}
                                                </span>
                                                <span className="px-1.5 sm:px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-500/20">
                                                    {dayData.losses.length} {isAr ? "خاسرة" : "Losses"}
                                                </span>
                                            </div>

                                            <div className="text-left font-mono">
                                                <span className={`text-sm sm:text-base font-black ${
                                                    isPos ? "text-emerald-600 dark:text-emerald-400" : isNeg ? "text-rose-600 dark:text-rose-400" : "text-zinc-600 dark:text-zinc-400"
                                                }`}>
                                                    {isPos ? "+" : ""}{netPl.toFixed(1)}%
                                                </span>
                                                <span className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-500 block">{isAr ? "صافي اليوم" : "Day Net"}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}

            {/* ── SELECTED DAY DETAILS FULLSCREEN PORTAL MODAL ── */}
            {mounted && selectedDayData && createPortal(
                <div 
                    onClick={() => setSelectedDayDateStr(null)}
                    className="fixed inset-0 z-[2147483647] bg-black/60 dark:bg-black/85 backdrop-blur-md flex items-center justify-center p-2.5 sm:p-4 md:p-6 overflow-y-auto animate-in fade-in duration-200"
                    dir={isAr ? "rtl" : "ltr"}
                >
                    <div 
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full max-w-3xl rounded-2xl bg-white dark:bg-zinc-950 border-2 border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col text-zinc-900 dark:text-white"
                    >
                        {/* Modal Header */}
                        <div className="p-3.5 sm:p-5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/70 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 dark:text-amber-400 shrink-0">
                                    <CalendarIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-sm sm:text-lg font-black text-zinc-900 dark:text-white truncate">
                                        {isAr ? "إحصائيات وتوصيات يوم " : "Signals & Statistics for "}
                                        {new Date(selectedDayData.dateStr).toLocaleDateString(isAr ? "ar-EG" : "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                    </h3>
                                    <p className="text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 font-medium truncate">
                                        {isAr ? "تفاصيل الأداء الفني والصفقات المسجلة لهذا اليوم" : "Technical performance details & logged trades"}
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setSelectedDayDateStr(null)}
                                className="p-1.5 sm:p-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all shrink-0"
                                aria-label={isAr ? "إغلاق" : "Close"}
                            >
                                <X className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                        </div>

                        {/* Modal Day Summary Bar */}
                        <div className="p-2.5 sm:p-4 bg-zinc-100/50 dark:bg-zinc-900/40 border-b border-zinc-200 dark:border-zinc-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-center">
                            <div className="p-2 sm:p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 shadow-sm dark:shadow-none">
                                <span className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-400 font-bold block">{isAr ? "المنشأة" : "Created"}</span>
                                <span className="text-sm sm:text-base font-black text-amber-600 dark:text-amber-400 font-mono mt-0.5 block">
                                    {selectedDayData.data.created.length} {isAr ? "صفقة" : "trades"}
                                </span>
                            </div>

                            <div className="p-2 sm:p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 shadow-sm dark:shadow-none">
                                <span className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-400 font-bold block">{isAr ? "المغلقة" : "Closed"}</span>
                                <span className="text-sm sm:text-base font-black text-zinc-900 dark:text-white font-mono mt-0.5 block">
                                    {selectedDayData.closedCount} ({selectedDayData.winCount}W / {selectedDayData.lossCount}L)
                                </span>
                            </div>

                            <div className="p-2 sm:p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 shadow-sm dark:shadow-none">
                                <span className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-400 font-bold block">{isAr ? "نسبة النجاح" : "Win Rate"}</span>
                                <span className="text-sm sm:text-base font-black text-amber-600 dark:text-amber-400 font-mono mt-0.5 block">
                                    {selectedDayData.dayWinRate.toFixed(1)}%
                                </span>
                            </div>

                            <div className={`p-2 sm:p-2.5 rounded-xl border shadow-sm dark:shadow-none ${
                                selectedDayData.data.netProfitPct >= 0
                                    ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
                                    : "bg-rose-50 dark:bg-rose-500/10 border-rose-300 dark:border-rose-500/30 text-rose-600 dark:text-rose-400"
                            }`}>
                                <span className="text-[9px] sm:text-[10px] text-zinc-500 dark:text-zinc-400 font-bold block">{isAr ? "صافي اليوم" : "Day Net"}</span>
                                <span className="text-sm sm:text-base font-black font-mono mt-0.5 block">
                                    {selectedDayData.data.netProfitPct >= 0 ? "+" : ""}
                                    {selectedDayData.data.netProfitPct.toFixed(1)}%
                                </span>
                            </div>
                        </div>

                        {/* Modal Tabs Filter */}
                        <div className="px-3.5 sm:px-5 pt-2.5 sm:pt-3 flex items-center justify-between bg-white dark:bg-zinc-950">
                            <div className="flex items-center gap-1 sm:gap-1.5 bg-zinc-100 dark:bg-zinc-900 p-0.5 sm:p-1 rounded-xl border border-zinc-200 dark:border-zinc-800 text-[10px] sm:text-xs font-bold overflow-x-auto max-w-full">
                                <button
                                    onClick={() => setDayModalFilter("all")}
                                    className={`px-2.5 sm:px-3 py-1 rounded-lg transition-all whitespace-nowrap ${
                                        dayModalFilter === "all"
                                            ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white font-black shadow-sm"
                                            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "الكل" : "All"} ({selectedDayData.allList.length})
                                </button>
                                <button
                                    onClick={() => setDayModalFilter("created")}
                                    className={`px-2.5 sm:px-3 py-1 rounded-lg transition-all whitespace-nowrap ${
                                        dayModalFilter === "created"
                                            ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-500/30 font-black"
                                            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "المنشأة" : "Created"} ({selectedDayData.data.created.length})
                                </button>
                                <button
                                    onClick={() => setDayModalFilter("closed")}
                                    className={`px-2.5 sm:px-3 py-1 rounded-lg transition-all whitespace-nowrap ${
                                        dayModalFilter === "closed"
                                            ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-500/30 font-black"
                                            : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "المغلقة" : "Closed"} ({selectedDayData.data.closed.length})
                                </button>
                            </div>
                        </div>

                        {/* Trades Table List */}
                        <div className="p-3.5 sm:p-5 overflow-y-auto space-y-2.5 sm:space-y-3 flex-1 bg-white dark:bg-zinc-950">
                            {selectedDayData.filteredList.length === 0 ? (
                                <div className="py-8 sm:py-12 text-center text-zinc-400 dark:text-zinc-500 text-xs sm:text-sm font-bold">
                                    {isAr ? "لا توجد توصيات تطابق الاختيار لهذا اليوم" : "No recommendations match"}
                                </div>
                            ) : (
                                selectedDayData.filteredList.map(item => {
                                    const statusLower = (item.status || "").toLowerCase();
                                    const isWin = statusLower === "win";
                                    const isLoss = statusLower === "loss";
                                    const isClosed = isWin || isLoss;

                                    return (
                                        <div
                                            key={item.id}
                                            onClick={() => {
                                                if (onSelectStock) onSelectStock(item);
                                            }}
                                            className="p-2.5 sm:p-3.5 rounded-xl bg-zinc-50 hover:bg-zinc-100/90 dark:bg-zinc-900/70 dark:hover:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-800/80 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 cursor-pointer shadow-sm dark:shadow-none"
                                        >
                                            <div className="flex items-center gap-2.5 sm:gap-3">
                                                <StockLogo symbol={item.symbol} logoUrl={item.logo_url} size="md" />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                                                        <span className="text-sm sm:text-base font-black text-indigo-600 dark:text-indigo-400">
                                                            {item.symbol}
                                                        </span>
                                                        {isShariaCompliant(item.symbol) && (
                                                            <span className="inline-flex items-center gap-0.5 px-1 sm:px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[8px] sm:text-[9px] font-bold">
                                                                <ShieldCheck className="w-2.5 h-2.5" />
                                                                {isAr ? "حلال" : "Halal"}
                                                            </span>
                                                        )}
                                                        <span className={`px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[10px] font-black ${
                                                            item.signal === "BUY"
                                                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                                                : "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20"
                                                        }`}>
                                                            {item.signal === "BUY" ? (isAr ? "شراء" : "BUY") : (isAr ? "بيع" : "SELL")}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 font-medium truncate max-w-[170px] sm:max-w-[200px]" title={item.name}>
                                                        {item.name}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Trade Numbers */}
                                            <div className="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-4 text-xs font-mono border-t sm:border-t-0 border-zinc-200 dark:border-zinc-800 pt-2 sm:pt-0">
                                                <div>
                                                    <span className="text-[9px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 block">{isAr ? "دخول" : "Entry"}</span>
                                                    <span className="font-bold text-zinc-900 dark:text-white text-[11px] sm:text-xs">{item.entry_price ? Number(item.entry_price).toFixed(2) : "-"}</span>
                                                </div>

                                                <div>
                                                    <span className="text-[9px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 block">{isAr ? "الهدف" : "Target"}</span>
                                                    <span className="font-bold text-emerald-600 dark:text-emerald-400 text-[11px] sm:text-xs">{item.target_price ? Number(item.target_price).toFixed(2) : "-"}</span>
                                                </div>

                                                <div>
                                                    <span className="text-[9px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 block">{isAr ? "الوقف" : "Stop"}</span>
                                                    <span className="font-bold text-rose-600 dark:text-rose-400 text-[11px] sm:text-xs">{item.stop_loss ? Number(item.stop_loss).toFixed(2) : "-"}</span>
                                                </div>

                                                {/* P/L badge */}
                                                <div className="text-left min-w-[55px] sm:min-w-[70px]">
                                                    <span className="text-[9px] sm:text-[10px] text-zinc-400 dark:text-zinc-500 block">{isAr ? "الحالة" : "P/L"}</span>
                                                    {isClosed ? (
                                                        <span className={`inline-flex items-center gap-0.5 font-black text-[11px] sm:text-xs ${
                                                            isWin ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                        }`}>
                                                            {isWin ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                                            {item.profit_loss_pct != null ? `${item.profit_loss_pct > 0 ? "+" : ""}${Number(item.profit_loss_pct).toFixed(1)}%` : (isWin ? (isAr ? "ربح" : "Win") : (isAr ? "خسارة" : "Loss"))}
                                                        </span>
                                                    ) : (
                                                        <span className="text-amber-600 dark:text-amber-400 font-bold text-[11px] sm:text-xs">{isAr ? "نشطة 🎯" : "Active 🎯"}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
