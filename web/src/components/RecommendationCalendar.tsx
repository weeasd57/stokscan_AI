"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
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
    ,Lock
} from "lucide-react";
import StockLogo from "./StockLogo";
import { isShariaCompliant } from "@/lib/shariaStocks";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useRealtimeRefresh } from "@/hooks/useRealtimeRefresh";

interface RecommendationCalendarProps {
    recommendations: any[];
    loading?: boolean;
    refreshToken?: number;
    onSelectStock?: (stock: any) => void;
    isPro?: boolean;
}

interface RecommendationEvent {
    id: string;
    recommendation_id: string;
    event_type: "recommendation_closed" | "recommendation_stale" | "target_or_stop_adjusted";
    occurred_at: string;
    [key: string]: any;
}

export default function RecommendationCalendar({
    recommendations = [],
    loading = false,
    refreshToken = 0,
    onSelectStock,
    isPro = true,
}: RecommendationCalendarProps) {
    const { language } = useLanguage();
    const isAr = language === "ar";
    const { theme } = useTheme();
    const isDark = theme === "dark";
    const delayedCutoff = useMemo(() => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 15);
        return cutoff;
    }, []);

    const isDelayedForPlan = useCallback((value: unknown) => {
        if (isPro || !value) return false;
        const date = new Date(String(value));
        return !Number.isNaN(date.getTime()) && date > delayedCutoff;
    }, [delayedCutoff, isPro]);

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
    const [dayModalFilter, setDayModalFilter] = useState<"all" | "created" | "closed" | "adjusted">("all");
    const [sentEvents, setSentEvents] = useState<RecommendationEvent[]>([]);
    const [trackedRecommendationIds, setTrackedRecommendationIds] = useState<string[]>([]);
    const [eventsUnavailable, setEventsUnavailable] = useState(false);

    const loadSentEvents = useCallback(async (signal?: AbortSignal) => {
        try {
        const response = await fetch("/api/recommendations/events?limit=1000", {
                signal,
                cache: "no-store",
            });
            if (response.status === 401 || response.status === 403) {
                setEventsUnavailable(true);
                return;
            }
            if (!response.ok) throw new Error(`events endpoint returned ${response.status}`);
            const payload = await response.json();
            setSentEvents(Array.isArray(payload?.events) ? payload.events : []);
            setTrackedRecommendationIds(
                Array.isArray(payload?.tracked_recommendation_ids)
                    ? payload.tracked_recommendation_ids.map(String)
                    : [],
            );
            setEventsUnavailable(false);
        } catch (error: any) {
            if (error?.name !== "AbortError") setEventsUnavailable(true);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void loadSentEvents(controller.signal);
        return () => controller.abort();
    }, [loadSentEvents, refreshToken, isPro]);

    useRealtimeRefresh(
        [
            { table: "recommendation_events" },
            { table: "scan_results", filter: "is_public=eq.true" },
        ],
        () => loadSentEvents(),
        { enabled: true, debounceMs: 500 },
    );

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

    const selectCalendarMonth = (date: Date) => {
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        setCurrentDate(monthStart);
        // Calendar navigation must drive the same range used by the global
        // statistics, not only the visible grid.
        setFilterPreset("custom");
        setCustomFrom(formatYMD(monthStart));
        setCustomTo(formatYMD(monthEnd));
    };

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

    // Filter base recommendations by Sharia if toggled. Locked placeholders
    // (fresh signals hidden from Free users) must never enter the statistics.
    const filteredBaseRecs = useMemo(() => {
        const usable = recommendations.filter(r => r.locked !== true);
        if (shariaOnly) {
            return usable.filter(r => isShariaCompliant(r.symbol));
        }
        return usable;
    }, [recommendations, shariaOnly]);

    const filteredSentEvents = useMemo(
        () => {
            return shariaOnly ? sentEvents.filter(event => isShariaCompliant(event.symbol)) : sentEvents;
        },
        [sentEvents, shariaOnly],
    );

    const closureTimeline = useMemo(() => {
        const eventRecommendationIds = new Set(trackedRecommendationIds);
        const fromEvents = filteredSentEvents
            .filter(event => event.event_type === "recommendation_closed" || event.event_type === "recommendation_stale")
            .map(event => ({
                ...event,
                id: event.recommendation_id,
                _timelineKey: `event:${event.id}`,
                _calendarEventAt: event.occurred_at,
                _eventType: event.event_type,
            }));
        const legacy = filteredBaseRecs
            .filter(row => ["win", "loss"].includes(String(row.status || "").toLowerCase()))
            .filter(row => !eventRecommendationIds.has(String(row.id)))
            .map(row => ({
                ...row,
                _timelineKey: `legacy-close:${row.id}`,
                _calendarEventAt: row.updated_at || row.created_at,
                _eventType: "legacy_closed",
            }));
        return [...fromEvents, ...legacy];
    }, [filteredBaseRecs, filteredSentEvents, trackedRecommendationIds]);

    // Shared boundaries for the summary and trade-aligned benchmark comparison.
    const dateRangeBoundaries = useMemo(() => {
        const now = new Date();
        if (filterPreset === "this_month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59) };
        if (filterPreset === "last_month") return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59) };
        if (filterPreset === "30days") {
            const start = new Date(now);
            start.setDate(start.getDate() - 30);
            return { start, end: now };
        }
        if (filterPreset === "custom" && customFrom && customTo) {
            const end = new Date(customTo);
            end.setHours(23, 59, 59);
            return { start: new Date(customFrom), end };
        }
        return null;
    }, [filterPreset, customFrom, customTo]);

    const adjustmentTimeline = useMemo(
        () => filteredSentEvents
            .filter(event => event.event_type === "target_or_stop_adjusted")
            .map(event => ({
                ...event,
                id: event.recommendation_id,
                _timelineKey: `event:${event.id}`,
                _calendarEventAt: event.occurred_at,
                _eventType: event.event_type,
            })),
        [filteredSentEvents],
    );

    const viewedMonthCreatedCount = useMemo(() => {
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 1);
        return filteredBaseRecs.filter((recommendation) => {
            if (!recommendation.created_at) return false;
            const createdAt = new Date(recommendation.created_at);
            return !Number.isNaN(createdAt.getTime()) && createdAt >= start && createdAt < end;
        }).length;
    }, [filteredBaseRecs, year, month]);

    // General Dynamic Statistics matching selected date filter
    const globalStats = useMemo(() => {
        const isClosed = (r: any) => {
            const s = (r.status || "").toLowerCase();
            return s === "win" || s === "loss";
        };
        const inRange = (value: unknown) => {
            if (!dateRangeBoundaries) return true;
            if (!value) return false;
            const date = new Date(String(value));
            return !Number.isNaN(date.getTime()) && date >= dateRangeBoundaries.start && date <= dateRangeBoundaries.end;
        };

        // Creation and closure are separate events. A June-created signal
        // closed in July must not become a July-created signal or be counted
        // twice while navigating calendar months.
        const createdTrades = filteredBaseRecs.filter(r => inRange(r.created_at));
        const closedTrades = closureTimeline.filter(r => isClosed(r) && inRange(r._calendarEventAt));
        const openTrades = createdTrades.filter(r => !isClosed(r));

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
            createdCount: createdTrades.length,
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
    }, [filteredBaseRecs, closureTimeline, dateRangeBoundaries]);

    // Group recommendations by day string YYYY-MM-DD
    const dayMap = useMemo(() => {
        const map = new Map<string, {
            created: any[];
            closed: any[];
            adjusted: any[];
            wins: any[];
            losses: any[];
            netProfitPct: number;
        }>();

        filteredBaseRecs.forEach(r => {
            // Created on date
            const createdYmd = parseYMD(r.created_at);
            if (createdYmd) {
                if (!map.has(createdYmd)) {
                    map.set(createdYmd, { created: [], closed: [], adjusted: [], wins: [], losses: [], netProfitPct: 0 });
                }
                map.get(createdYmd)!.created.push(r);
            }

        });

        closureTimeline.forEach(r => {
            const statusLower = (r.status || "").toLowerCase();
            if (statusLower === "win" || statusLower === "loss") {
                const closedYmd = parseYMD(r._calendarEventAt);
                if (closedYmd) {
                    if (!map.has(closedYmd)) {
                        map.set(closedYmd, { created: [], closed: [], adjusted: [], wins: [], losses: [], netProfitPct: 0 });
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

        adjustmentTimeline.forEach(r => {
            const adjustedYmd = parseYMD(r._calendarEventAt);
            if (!adjustedYmd) return;
            if (!map.has(adjustedYmd)) {
                map.set(adjustedYmd, { created: [], closed: [], adjusted: [], wins: [], losses: [], netProfitPct: 0 });
            }
            map.get(adjustedYmd)!.adjusted.push(r);
        });

        return map;
    }, [filteredBaseRecs, closureTimeline, adjustmentTimeline]);

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
            const dayOfWeek = prevDate.getDay();
            days.push({
                date: prevDate,
                dateStr: formatYMD(prevDate),
                isCurrentMonth: false,
                isWeekend: dayOfWeek === 5 || dayOfWeek === 6,
                dayNum
            });
        }

        // Current month days
        for (let d = 1; d <= totalDays; d++) {
            const currDate = new Date(year, month, d);
            const dayOfWeek = currDate.getDay();
            days.push({
                date: currDate,
                dateStr: formatYMD(currDate),
                isCurrentMonth: true,
                isWeekend: dayOfWeek === 5 || dayOfWeek === 6,
                dayNum: d
            });
        }

        // Next month padding to fill grid (multiple of 7)
        const totalCells = Math.ceil(days.length / 7) * 7;
        const nextPadding = totalCells - days.length;
        for (let n = 1; n <= nextPadding; n++) {
            const nextDate = new Date(year, month + 1, n);
            const dayOfWeek = nextDate.getDay();
            days.push({
                date: nextDate,
                dateStr: formatYMD(nextDate),
                isCurrentMonth: false,
                isWeekend: dayOfWeek === 5 || dayOfWeek === 6,
                dayNum: n
            });
        }

        return days;
    }, [year, month]);

    // Selected Day Data for Modal
    const selectedDayData = useMemo(() => {
        if (!selectedDayDateStr) return null;
        const data = dayMap.get(selectedDayDateStr) || { created: [], closed: [], adjusted: [], wins: [], losses: [], netProfitPct: 0 };
        const delayed = isDelayedForPlan(selectedDayDateStr);
        
        // Merge created & closed for day view (deduplicated by id)
        const allMap = new Map<string, any>();
        data.created.forEach(item => allMap.set(`created:${item.id}`, { ...item, _isCreatedToday: true, _timelineKey: `created:${item.id}` }));
        data.closed.forEach(item => {
            allMap.set(item._timelineKey, { ...item, _isClosedToday: true });
        });
        data.adjusted.forEach(item => allMap.set(item._timelineKey, { ...item, _isAdjustedToday: true }));

        const allList = Array.from(allMap.values());

        // Filter list by tab
        let filteredList = allList;
        if (delayed) filteredList = [];
        if (dayModalFilter === "created") {
            filteredList = allList.filter(item => item._isCreatedToday);
        } else if (dayModalFilter === "closed") {
            filteredList = allList.filter(item => item._isClosedToday);
        } else if (dayModalFilter === "adjusted") {
            filteredList = allList.filter(item => item._isAdjustedToday);
        }
        if (delayed) filteredList = [];

        const closedCount = delayed ? 0 : data.closed.length;
        const winCount = delayed ? 0 : data.wins.length;
        const lossCount = delayed ? 0 : data.losses.length;
        const dayWinRate = closedCount > 0 ? (winCount / closedCount) * 100 : 0;

        return {
            dateStr: selectedDayDateStr,
            data: delayed ? { ...data, created: [], closed: [], adjusted: [], wins: [], losses: [], netProfitPct: 0 } : data,
            allList: delayed ? [] : allList,
            filteredList,
            closedCount,
            winCount,
            lossCount,
            dayWinRate
            ,delayed
        };
    }, [selectedDayDateStr, dayMap, dayModalFilter, isDelayedForPlan]);

    // Navigation Controls
    const prevMonth = () => {
        selectCalendarMonth(new Date(year, month - 1, 1));
    };

    const nextMonth = () => {
        selectCalendarMonth(new Date(year, month + 1, 1));
    };

    const goToToday = () => {
        const now = new Date();
        selectCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
        setFilterPreset("this_month");
        setCustomFrom("");
        setCustomTo("");
        setSelectedDayDateStr(formatYMD(now));
    };

    const todayDateStr = formatYMD(new Date());

    const monthStats = useMemo(() => {
        let total = 0;
        let wins = 0;
        let losses = 0;
        let netReturn = 0;
        let bestTrade: any = null;

        calendarDays.forEach((cell) => {
            if (!cell.isCurrentMonth) return;
            const info = dayMap.get(cell.dateStr);
            if (!info) return;
            total += info.closed.length;
            wins += info.wins.length;
            losses += info.losses.length;
            netReturn += info.netProfitPct;
            info.closed.forEach((t) => {
                if (t.profit_loss_pct != null) {
                    if (!bestTrade || t.profit_loss_pct > (bestTrade.profit_loss_pct ?? -Infinity)) {
                        bestTrade = t;
                    }
                }
            });
        });

        const winRate = total > 0 ? (wins / total) * 100 : 0;
        return { total, wins, losses, winRate, netReturn, bestTrade };
    }, [calendarDays, dayMap]);

    return (
        <div className="w-full space-y-4 sm:space-y-6 select-text text-zinc-900 dark:text-zinc-100" dir={isAr ? "rtl" : "ltr"}>
            {eventsUnavailable && (
                <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    {isAr
                        ? "تعذر تحميل سجل الإرسال الموثق؛ تُعرض الإغلاقات القديمة مؤقتاً من بيانات التوصيات."
                        : "Verified delivery history is unavailable; legacy recommendation data is shown temporarily."}
                </div>
            )}

            {/* ── CALENDAR VIEW (Neo-Brutalist Design matching Short Swings) ── */}
            {viewMode === "calendar" ? (
                <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-4 sm:p-6 shadow-[4px_4px_0px_#000] dark:shadow-[4px_4px_0px_#fff] space-y-6">
                    {/* ── 1. Top Control Bar: Title, Presets & View Switcher ── */}
                    <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 border-b-2 border-black dark:border-white pb-4">
                        <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 border-2 border-black bg-amber-400 flex items-center justify-center font-black shrink-0">
                                <CalendarIcon className="w-5 h-5 text-black" />
                            </div>
                            <div>
                                <h3 className="text-base sm:text-lg font-black text-black dark:text-white">
                                    {isAr ? "تقويم أرباح وإحصائيات الصفقات المتوسطة" : "Medium Swings Calendar & Performance"}
                                </h3>
                                <p className="text-[11px] font-bold text-zinc-500">
                                    {isAr
                                        ? "تتبع الأرباح اليومية، والصفقات الرابحة والخاسرة لشهري 8 و 9 وكامل عام 2026"
                                        : "Track daily returns, win/loss trades for Aug, Sep and full 2026"}
                                </p>
                            </div>
                        </div>

                        {/* Presets, Sharia Toggle, and View Switcher */}
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Presets buttons */}
                            <div className="flex items-center border-2 border-black bg-zinc-100 dark:bg-zinc-900 p-0.5 text-xs font-bold overflow-x-auto">
                                <button
                                    onClick={goToToday}
                                    className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                                        filterPreset === "this_month" && month === new Date().getMonth() && year === new Date().getFullYear()
                                            ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                                            : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "اليوم" : "Today"}
                                </button>
                                <button
                                    onClick={() => {
                                        selectCalendarMonth(new Date(2026, 8, 1));
                                        setSelectedDayDateStr(null);
                                    }}
                                    className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                                        year === 2026 && month === 8
                                            ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                                            : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "شهر 9 (سبتمبر 2026)" : "Sep 2026"}
                                </button>
                                <button
                                    onClick={() => {
                                        selectCalendarMonth(new Date(2026, 7, 1));
                                        setSelectedDayDateStr(null);
                                    }}
                                    className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                                        year === 2026 && month === 7
                                            ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                                            : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "شهر 8 (أغسطس 2026)" : "Aug 2026"}
                                </button>
                                <button
                                    onClick={() => {
                                        setFilterPreset("30days");
                                        setCurrentDate(new Date());
                                        setSelectedDayDateStr(null);
                                    }}
                                    className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                                        filterPreset === "30days"
                                            ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                                            : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "آخر 30 يوم" : "Last 30 Days"}
                                </button>
                                <button
                                    onClick={() => {
                                        setFilterPreset("all");
                                        setSelectedDayDateStr(null);
                                    }}
                                    className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                                        filterPreset === "all"
                                            ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                                            : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "كامل عام 2026" : "Full 2026"}
                                </button>
                            </div>

                            {/* Sharia Toggle Button */}
                            <button
                                onClick={() => setShariaOnly(!shariaOnly)}
                                className={`h-8 px-2.5 border-2 border-black text-xs font-black flex items-center gap-1.5 transition-all shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none ${
                                    shariaOnly ? "bg-emerald-400 text-black" : "bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                                }`}
                            >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>{isAr ? "حلال فقط" : "Halal Only"}</span>
                            </button>

                            {/* View Switcher: Grid vs List */}
                            <div className="flex items-center border-2 border-black bg-zinc-100 dark:bg-zinc-900 p-0.5 shrink-0">
                                <button
                                    onClick={() => setViewMode("calendar")}
                                    title={isAr ? "عرض التقويم" : "Calendar View"}
                                    className={`p-1.5 transition-all ${
                                        viewMode === "calendar"
                                            ? "bg-[#FFE600] text-black font-black border border-black"
                                            : "text-zinc-400 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    <Grid className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setViewMode("agenda")}
                                    title={isAr ? "عرض القائمة" : "List View"}
                                    className={`p-1.5 transition-all ${
                                        (viewMode as string) === "agenda"
                                            ? "bg-[#FFE600] text-black font-black border border-black"
                                            : "text-zinc-400 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    <List className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── 2. Month Navigation Bar ── */}
                    <div className="flex items-center justify-between border-b-2 border-black dark:border-white pb-3 sm:pb-4">
                        <div className="flex items-center gap-2 sm:gap-3">
                            <h3 className="text-base sm:text-lg md:text-xl font-black text-black dark:text-white">
                                {currentMonthName} {year}
                            </h3>
                            <span className="text-[10px] sm:text-xs font-bold text-black dark:text-white bg-zinc-100 dark:bg-zinc-800 px-2 sm:px-2.5 py-0.5 sm:py-1 border border-black dark:border-white">
                                {monthStats.total} {isAr ? "صفقة مغلقة في الشهر" : "monthly closed trades"}
                            </span>
                        </div>

                        <div className="flex items-center gap-1.5 sm:gap-2">
                            <button
                                onClick={prevMonth}
                                className="p-1.5 sm:p-2 border-2 border-black bg-white dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                                title={isAr ? "الشهر السابق" : "Previous Month"}
                            >
                                {isAr ? <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" /> : <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />}
                            </button>
                            <button
                                onClick={goToToday}
                                className="px-2.5 sm:px-3 py-1 sm:py-1.5 border-2 border-black bg-zinc-100 dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-200 text-xs font-black shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                            >
                                {isAr ? "اليوم" : "Today"}
                            </button>
                            <button
                                onClick={nextMonth}
                                className="p-1.5 sm:p-2 border-2 border-black bg-white dark:bg-zinc-900 text-black dark:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                                title={isAr ? "الشهر التالي" : "Next Month"}
                            >
                                {isAr ? <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" /> : <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                            </button>
                        </div>
                    </div>

                    {/* ── 3. Month Summary Bar (With LTR formatting) ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-zinc-100 dark:bg-zinc-900 border-2 border-black dark:border-zinc-700 p-3 sm:p-4">
                        <div>
                            <span className="text-[10px] font-bold text-zinc-500 uppercase block">{isAr ? "صفقات الشهر" : "Month Trades"}</span>
                            <span className="text-xl font-black font-mono text-black dark:text-white">{monthStats.total} {isAr ? "صفقة" : "trades"}</span>
                        </div>
                        <div>
                            <span className="text-[10px] font-bold text-zinc-500 uppercase block">{isAr ? "نسبة النجاح للشهر" : "Month Win Rate"}</span>
                            <div className="flex items-center gap-1.5" dir="ltr">
                                <span className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                                    {monthStats.winRate.toFixed(1)}%
                                </span>
                                <span className="text-xs font-bold text-zinc-500 font-sans">
                                    ({monthStats.wins} {isAr ? "رابحة" : "wins"})
                                </span>
                            </div>
                        </div>
                        <div>
                            <span className="text-[10px] font-bold text-zinc-500 uppercase block">{isAr ? "صافي العائد الإجمالي" : "Net Total Return"}</span>
                            <span
                                dir="ltr"
                                className={`text-xl font-black font-mono block ${
                                    monthStats.netReturn >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                }`}
                            >
                                {monthStats.netReturn >= 0 ? "+" : ""}{monthStats.netReturn.toFixed(1)}%
                            </span>
                        </div>
                        <div>
                            <span className="text-[10px] font-bold text-zinc-500 uppercase block">{isAr ? "أفضل صفقة في الشهر" : "Best Trade"}</span>
                            <span className="text-base sm:text-lg font-black font-mono text-indigo-600 dark:text-indigo-400 truncate block">
                                {monthStats.bestTrade ? (
                                    <span dir="ltr">
                                        {monthStats.bestTrade.symbol} ({monthStats.bestTrade.profit_loss_pct >= 0 ? "+" : ""}{Number(monthStats.bestTrade.profit_loss_pct).toFixed(1)}%)
                                    </span>
                                ) : (
                                    "—"
                                )}
                            </span>
                        </div>
                    </div>

                    {/* ── 4. Day Names Header ── */}
                    <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-center font-black text-xs text-zinc-600 dark:text-zinc-400">
                        <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black dark:border-white">الأحد</div>
                        <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black dark:border-white">الإثنين</div>
                        <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black dark:border-white">الثلاثاء</div>
                        <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black dark:border-white">الأربعاء</div>
                        <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black dark:border-white">الخميس</div>
                        <div className="p-1.5 bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-400 dark:border-zinc-700 text-zinc-400">الجمعة (عطلة)</div>
                        <div className="p-1.5 bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-400 dark:border-zinc-700 text-zinc-400">السبت (عطلة)</div>
                    </div>

                    {/* ── 5. Grid of Calendar Days ── */}
                    <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                        {calendarDays.map((cell, idx) => {
                            const dayInfo = dayMap.get(cell.dateStr);
                            const hasClosed = dayInfo && dayInfo.closed.length > 0;
                            const hasCreated = dayInfo && dayInfo.created.length > 0;
                            const hasAdjusted = dayInfo && dayInfo.adjusted.length > 0;
                            const wins = dayInfo ? dayInfo.wins.length : 0;
                            const losses = dayInfo ? dayInfo.losses.length : 0;
                            const netPl = dayInfo ? dayInfo.netProfitPct : 0;
                            const isToday = cell.dateStr === todayDateStr;
                            const isSelected = cell.dateStr === selectedDayDateStr;
                            const isDelayed = isDelayedForPlan(cell.dateStr);

                            let maxGainTrade: any = null;
                            if (dayInfo && dayInfo.closed.length > 0) {
                                maxGainTrade = [...dayInfo.closed].sort((a, b) => (Number(b.profit_loss_pct) || 0) - (Number(a.profit_loss_pct) || 0))[0];
                            }
                            const isBigRunnerDay = maxGainTrade && Number(maxGainTrade.profit_loss_pct) >= 15;

                            return (
                                <div
                                    key={`${cell.dateStr}-${idx}`}
                                    onClick={() => {
                                        setSelectedDayDateStr(cell.dateStr);
                                    }}
                                    className={`min-h-[75px] sm:min-h-[100px] p-2 border-2 flex flex-col justify-between transition-all select-none relative cursor-pointer ${
                                        isToday
                                            ? "ring-4 ring-amber-400 dark:ring-amber-300 shadow-md shadow-amber-400/20 z-10"
                                            : ""
                                    } ${
                                        isSelected && !isToday
                                            ? "ring-2 ring-indigo-500 shadow-sm"
                                            : ""
                                    } ${
                                        !cell.isCurrentMonth
                                            ? "border-zinc-200 dark:border-zinc-800/60 bg-zinc-100/30 dark:bg-zinc-900/20 text-zinc-400 dark:text-zinc-600 opacity-30"
                                            : cell.isWeekend
                                            ? "border-zinc-300 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/40 text-zinc-400"
                                            : hasClosed
                                            ? netPl >= 0
                                                ? "border-black dark:border-white bg-emerald-50/70 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 shadow-[2px_2px_0px_#000] dark:shadow-[2px_2px_0px_#fff] hover:-translate-x-0.5 hover:-translate-y-0.5"
                                                : "border-black dark:border-white bg-rose-50/70 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/30 shadow-[2px_2px_0px_#000] dark:shadow-[2px_2px_0px_#fff] hover:-translate-x-0.5 hover:-translate-y-0.5"
                                            : "border-zinc-200 dark:border-zinc-800 bg-white/40 dark:bg-zinc-950/40 text-zinc-400"
                                    }`}
                                >
                                    {/* Top: Day Number & Trades Badge */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1">
                                            <span
                                                className={`text-xs font-black font-mono px-1 py-0.5 ${
                                                    isToday
                                                        ? "bg-amber-400 text-black border border-black shadow-[1px_1px_0px_#000]"
                                                        : cell.isCurrentMonth
                                                        ? hasClosed
                                                            ? "text-black dark:text-white"
                                                            : "text-zinc-500"
                                                        : "text-zinc-400"
                                                }`}
                                            >
                                                {cell.dayNum}
                                            </span>
                                            {isToday && (
                                                <span className="px-1.5 py-0.5 border border-black bg-[#FFE600] text-black text-[9px] font-black uppercase shadow-[1px_1px_0px_#000]">
                                                    {isAr ? "اليوم" : "TODAY"}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1">
                                            {isDelayed && (hasClosed || hasCreated) && (
                                                <Lock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                            )}
                                            {hasClosed && (
                                                <span className="px-1.5 py-0.2 border border-black bg-black text-[#FFE600] text-[9px] font-black">
                                                    {dayInfo!.closed.length} صفقات
                                                </span>
                                            )}
                                            {hasCreated && !hasClosed && (
                                                <span className="px-1.5 py-0.2 border border-black bg-amber-400 text-black text-[9px] font-black">
                                                    +{dayInfo!.created.length}
                                                </span>
                                            )}
                                            {hasAdjusted && !hasClosed && !hasCreated && (
                                                <span className="px-1.5 py-0.2 border border-black bg-sky-400 text-black text-[9px] font-black">
                                                    {dayInfo!.adjusted.length}🔧
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Middle: Win/Loss & Return */}
                                    {hasClosed ? (
                                        <div className="space-y-1 my-1">
                                            <div className="flex items-center justify-between text-[10px] font-black">
                                                <span className="text-emerald-600 dark:text-emerald-400">{wins} رابحة</span>
                                                {losses > 0 && <span className="text-rose-500">{losses} خاسرة</span>}
                                            </div>

                                            <div
                                                dir="ltr"
                                                className={`text-xs font-black font-mono text-center px-1 py-0.5 border border-black ${
                                                    netPl >= 0
                                                        ? "bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100"
                                                        : "bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-100"
                                                }`}
                                            >
                                                {netPl >= 0 ? "+" : ""}{netPl.toFixed(1)}%
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-[10px] text-zinc-400 dark:text-zinc-600 font-bold text-center">
                                            {!cell.isCurrentMonth ? "" : cell.isWeekend ? "عطلة" : hasCreated ? `${dayInfo!.created.length} نشطة` : "لا إغلاقات"}
                                        </div>
                                    )}

                                    {/* Bottom: Big Runner highlight */}
                                    {isBigRunnerDay && (
                                        <div
                                            dir="ltr"
                                            className="text-[9px] font-black bg-amber-400 text-black px-1 py-0.5 border border-black text-center truncate"
                                        >
                                            🔥 {maxGainTrade.symbol} +{Number(maxGainTrade.profit_loss_pct).toFixed(0)}%
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                /* ── AGENDA / LIST VIEW (Neo-Brutalist) ── */
                <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-4 sm:p-6 shadow-[4px_4px_0px_#000] dark:shadow-[4px_4px_0px_#fff] space-y-4">
                    <div className="flex items-center justify-between border-b-2 border-black dark:border-white pb-3">
                        <div className="flex items-center gap-2">
                            <List className="w-5 h-5 text-amber-500 dark:text-amber-400" />
                            <h3 className="text-base sm:text-lg font-black text-black dark:text-white">
                                {isAr ? "جدول التوصيات اليومية الحية" : "Live Recommendations Table"}
                            </h3>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center border-2 border-black bg-zinc-100 dark:bg-zinc-900 p-0.5 shrink-0">
                                <button
                                    onClick={() => setViewMode("calendar")}
                                    title={isAr ? "عرض التقويم" : "Calendar View"}
                                    className="p-1.5 transition-all text-zinc-400 hover:text-black dark:hover:text-white"
                                >
                                    <Grid className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => setViewMode("agenda")}
                                    title={isAr ? "عرض القائمة" : "List View"}
                                    className="p-1.5 transition-all bg-[#FFE600] text-black font-black border border-black"
                                >
                                    <List className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="divide-y-2 divide-black dark:divide-white border-2 border-black dark:border-white">
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
                                        className="p-3 sm:p-4 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 border-2 border-black bg-amber-400 flex flex-col items-center justify-center font-mono shrink-0 shadow-[2px_2px_0px_#000]">
                                                <span className="text-[9px] text-black font-black uppercase">
                                                    {new Date(dateStr).toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short" })}
                                                </span>
                                                <span className="text-sm font-black text-black leading-none">
                                                    {new Date(dateStr).getDate()}
                                                </span>
                                            </div>
                                            <div>
                                                <div className="text-sm font-black text-black dark:text-white">
                                                    {new Date(dateStr).toLocaleDateString(isAr ? "ar-EG" : "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5">
                                                    <span>{isAr ? "أنشئت:" : "Created:"} <strong className="text-amber-600 font-mono font-black">{dayData.created.length}</strong></span>
                                                    <span>•</span>
                                                    <span>{isAr ? "أغلقت:" : "Closed:"} <strong className="text-indigo-600 font-mono font-black">{dayData.closed.length}</strong></span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4">
                                            <div className="flex gap-1.5 text-xs font-bold">
                                                <span className="px-2 py-0.5 border border-black bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-black">
                                                    {dayData.wins.length} {isAr ? "رابحة" : "Wins"}
                                                </span>
                                                <span className="px-2 py-0.5 border border-black bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-black">
                                                    {dayData.losses.length} {isAr ? "خاسرة" : "Losses"}
                                                </span>
                                            </div>

                                            <div className="text-left font-mono">
                                                <span
                                                    dir="ltr"
                                                    className={`text-base font-black px-2 py-0.5 border border-black block ${
                                                        isPos ? "bg-emerald-200 text-emerald-900" : isNeg ? "bg-rose-200 text-rose-900" : "bg-zinc-200 text-zinc-900"
                                                    }`}
                                                >
                                                    {isPos ? "+" : ""}{netPl.toFixed(1)}%
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}

            {/* ── SELECTED DAY DETAILS FULLSCREEN PORTAL MODAL (Neo-Brutalist) ── */}
            {mounted && selectedDayData && createPortal(
                <div 
                    onClick={() => setSelectedDayDateStr(null)}
                    className="fixed inset-0 z-[2147483647] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150"
                    dir={isAr ? "rtl" : "ltr"}
                >
                    <div 
                        onClick={(e) => e.stopPropagation()}
                        className="relative w-full max-w-3xl border-4 border-black dark:border-white bg-white dark:bg-zinc-950 shadow-[8px_8px_0px_#000] dark:shadow-[8px_8px_0px_#fff] overflow-hidden my-auto max-h-[92vh] flex flex-col text-black dark:text-white"
                    >
                        {/* Modal Header */}
                        <div className="p-4 sm:p-5 border-b-4 border-black dark:border-white bg-[#FFE600] text-black flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-10 h-10 border-2 border-black bg-black text-[#FFE600] flex items-center justify-center shrink-0 shadow-[2px_2px_0px_#000]">
                                    <CalendarIcon className="w-5 h-5" />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-base sm:text-lg font-black truncate">
                                        {isAr ? "إحصائيات وتوصيات يوم " : "Signals & Statistics for "}
                                        {new Date(selectedDayData.dateStr).toLocaleDateString(isAr ? "ar-EG" : "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                    </h3>
                                    <p className="text-xs text-zinc-800 font-bold truncate">
                                        {isAr ? "تفاصيل الأداء الفني والصفقات المسجلة لهذا اليوم" : "Technical performance details & logged trades"}
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setSelectedDayDateStr(null)}
                                className="w-9 h-9 border-2 border-black bg-white hover:bg-zinc-100 text-black flex items-center justify-center shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all font-black shrink-0"
                                aria-label={isAr ? "إغلاق" : "Close"}
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Modal Day Summary Bar */}
                        <div className="p-3 sm:p-4 bg-zinc-100 dark:bg-zinc-900 border-b-2 border-black dark:border-white grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-center">
                            {selectedDayData.delayed ? (
                                <div className="col-span-2 sm:col-span-4 p-4 border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 font-black text-xs sm:text-sm flex items-center justify-center gap-2">
                                    <Lock className="w-4 h-4 shrink-0" />
                                    {isAr ? "إحصائيات هذا اليوم مشفرة ومؤجلة 15 يوماً لمستخدمي الخطة المجانية." : "This day's statistics are locked and delayed by 15 days on the Free plan."}
                                </div>
                            ) : (
                                <>
                                    <div className="p-2.5 border-2 border-black bg-white dark:bg-zinc-950">
                                        <span className="text-[10px] text-zinc-500 font-black uppercase block">{isAr ? "المنشأة" : "Created"}</span>
                                        <span className="text-base font-black text-amber-600 font-mono mt-0.5 block">
                                            {selectedDayData.data.created.length} {isAr ? "صفقة" : "trades"}
                                        </span>
                                    </div>

                                    <div className="p-2.5 border-2 border-black bg-white dark:bg-zinc-950">
                                        <span className="text-[10px] text-zinc-500 font-black uppercase block">{isAr ? "المغلقة" : "Closed"}</span>
                                        <span className="text-base font-black text-black dark:text-white font-mono mt-0.5 block">
                                            {selectedDayData.closedCount} ({selectedDayData.winCount}W / {selectedDayData.lossCount}L)
                                        </span>
                                    </div>

                                    <div className="p-2.5 border-2 border-black bg-white dark:bg-zinc-950">
                                        <span className="text-[10px] text-zinc-500 font-black uppercase block">{isAr ? "نسبة النجاح" : "Win Rate"}</span>
                                        <span className="text-base font-black text-emerald-600 font-mono mt-0.5 block">
                                            {selectedDayData.dayWinRate.toFixed(1)}%
                                        </span>
                                    </div>

                                    <div className={`p-2.5 border-2 border-black ${
                                        selectedDayData.data.netProfitPct >= 0 ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-rose-100 dark:bg-rose-950/40"
                                    }`}>
                                        <span className="text-[10px] text-zinc-600 font-black uppercase block">{isAr ? "مجموع العوائد" : "Net Return"}</span>
                                        <span
                                            dir="ltr"
                                            className={`text-base font-black font-mono mt-0.5 block ${
                                                selectedDayData.data.netProfitPct >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"
                                            }`}
                                        >
                                            {selectedDayData.data.netProfitPct >= 0 ? "+" : ""}
                                            {selectedDayData.data.netProfitPct.toFixed(1)}%
                                        </span>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Modal Tabs Filter */}
                        <div className="px-4 py-3 flex items-center justify-between border-b-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900">
                            <div className="flex items-center gap-1.5 border-2 border-black bg-white dark:bg-zinc-950 p-0.5 text-xs font-bold overflow-x-auto">
                                <button
                                    onClick={() => setDayModalFilter("all")}
                                    className={`px-3 py-1 transition-all whitespace-nowrap ${
                                        dayModalFilter === "all"
                                            ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                                            : "text-zinc-500 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "الكل" : "All"} ({selectedDayData.allList.length})
                                </button>
                                <button
                                    onClick={() => setDayModalFilter("created")}
                                    className={`px-3 py-1 transition-all whitespace-nowrap ${
                                        dayModalFilter === "created"
                                            ? "bg-amber-400 text-black font-black border border-black shadow-sm"
                                            : "text-zinc-500 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "المنشأة" : "Created"} ({selectedDayData.data.created.length})
                                </button>
                                <button
                                    onClick={() => setDayModalFilter("closed")}
                                    className={`px-3 py-1 transition-all whitespace-nowrap ${
                                        dayModalFilter === "closed"
                                            ? "bg-black text-[#FFE600] font-black border border-black shadow-sm"
                                            : "text-zinc-500 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "المغلقة" : "Closed"} ({selectedDayData.data.closed.length})
                                </button>
                                <button
                                    onClick={() => setDayModalFilter("adjusted")}
                                    className={`px-3 py-1 transition-all whitespace-nowrap ${
                                        dayModalFilter === "adjusted"
                                            ? "bg-sky-400 text-black font-black border border-black shadow-sm"
                                            : "text-zinc-500 hover:text-black dark:hover:text-white"
                                    }`}
                                >
                                    {isAr ? "التحديثات" : "Updates"} ({selectedDayData.data.adjusted.length})
                                </button>
                            </div>
                        </div>

                        {/* Trades Table List in Modal */}
                        <div className="p-4 overflow-y-auto space-y-3 flex-1 bg-white dark:bg-zinc-950">
                            {selectedDayData.filteredList.length === 0 ? (
                                <div className="py-12 text-center text-zinc-400 text-xs sm:text-sm font-bold border-2 border-dashed border-zinc-300 dark:border-zinc-800">
                                    {isAr ? "لا توجد توصيات تطابق الاختيار لهذا اليوم" : "No recommendations match"}
                                </div>
                            ) : (
                                selectedDayData.filteredList.map(item => {
                                    const statusLower = (item.status || "").toLowerCase();
                                    const isWin = statusLower === "win";
                                    const isLoss = statusLower === "loss";
                                    const isClosed = isWin || isLoss;
                                    const isAdjustment = item._isAdjustedToday;

                                    if (item.identity_locked === true) {
                                        return (
                                            <div key={item._timelineKey || item.id} className="p-3 border-2 border-black bg-zinc-100 dark:bg-zinc-900 flex items-center justify-between gap-3">
                                                <span className="font-black text-black dark:text-white">{isAr ? "🔒 سهم مشفر" : "🔒 Hidden stock"} · {item.exchange || "EGX"}</span>
                                                <span className={isLoss ? "font-black text-rose-600" : "font-black text-emerald-600"}>{isLoss ? (isAr ? "خسارة" : "Loss") : (isAr ? "ربح" : "Win")}</span>
                                                <span className="font-mono font-black">{Number(item.precision || 0) > 0 ? `${(Number(item.precision) * 100).toFixed(0)}% AI` : "—"}</span>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div
                                            key={item._timelineKey || item.id}
                                            onClick={() => {
                                                if (onSelectStock) onSelectStock(item);
                                            }}
                                            className="p-3 sm:p-4 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer shadow-[2px_2px_0px_#000] dark:shadow-[2px_2px_0px_#fff]"
                                        >
                                            <div className="flex items-center gap-3">
                                                <StockLogo symbol={item.symbol} logoUrl={item.logo_url} size="md" />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-base font-black text-indigo-600 dark:text-indigo-400">
                                                            {item.symbol}
                                                        </span>
                                                        {isShariaCompliant(item.symbol) && (
                                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 border border-black bg-emerald-400 text-black text-[9px] font-black uppercase">
                                                                <ShieldCheck className="w-2.5 h-2.5" />
                                                                {isAr ? "حلال" : "Halal"}
                                                            </span>
                                                        )}
                                                        <span className={`px-2 py-0.5 border border-black text-[10px] font-black ${
                                                            item.signal === "BUY"
                                                                ? "bg-emerald-300 text-black"
                                                                : "bg-rose-300 text-black"
                                                        }`}>
                                                            {item.signal === "BUY" ? (isAr ? "شراء" : "BUY") : (isAr ? "بيع" : "SELL")}
                                                        </span>
                                                        {isAdjustment && (
                                                            <span className="px-2 py-0.5 border border-black bg-sky-300 text-black text-[10px] font-black">
                                                                {isAr ? "تحديث مُرسل 🔧" : "Sent update 🔧"}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-zinc-500 font-bold truncate max-w-[200px]" title={item.name}>
                                                        {item.name}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Trade Numbers */}
                                            <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 text-xs font-mono border-t sm:border-t-0 border-zinc-300 dark:border-zinc-700 pt-2 sm:pt-0">
                                                <div>
                                                    <span className="text-[10px] text-zinc-500 font-bold block">{isAr ? "دخول" : "Entry"}</span>
                                                    <span className="font-black text-black dark:text-white">{item.entry_price ? Number(item.entry_price).toFixed(2) : "-"}</span>
                                                </div>

                                                <div>
                                                    <span className="text-[10px] text-zinc-500 font-bold block">{isAr ? "الهدف" : "Target"}</span>
                                                    <span className="font-black text-emerald-600 dark:text-emerald-400">{item.target_price ? Number(item.target_price).toFixed(2) : "-"}</span>
                                                </div>

                                                <div>
                                                    <span className="text-[10px] text-zinc-500 font-bold block">{isAr ? "الوقف" : "Stop"}</span>
                                                    <span className="font-black text-rose-600 dark:text-rose-400">{item.stop_loss ? Number(item.stop_loss).toFixed(2) : "-"}</span>
                                                </div>

                                                {/* P/L badge */}
                                                <div className="text-left min-w-[65px]">
                                                    <span className="text-[10px] text-zinc-500 font-bold block">{isAr ? "الحالة" : "P/L"}</span>
                                                    {isClosed ? (
                                                        <span
                                                            dir="ltr"
                                                            className={`inline-flex items-center gap-0.5 font-black px-1.5 py-0.5 border border-black ${
                                                                isWin ? "bg-emerald-300 text-black" : "bg-rose-300 text-black"
                                                            }`}
                                                        >
                                                            {isWin ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                                            {item.profit_loss_pct != null ? `${item.profit_loss_pct > 0 ? "+" : ""}${Number(item.profit_loss_pct).toFixed(1)}%` : (isWin ? (isAr ? "ربح" : "Win") : (isAr ? "خسارة" : "Loss"))}
                                                        </span>
                                                    ) : isAdjustment ? (
                                                        <span className="text-sky-600 dark:text-sky-400 font-black text-xs">
                                                            {item.old_target != null && item.new_target != null
                                                                ? `${Number(item.old_target).toFixed(2)} → ${Number(item.new_target).toFixed(2)}`
                                                                : item.old_stop != null && item.new_stop != null
                                                                    ? `${Number(item.old_stop).toFixed(2)} → ${Number(item.new_stop).toFixed(2)}`
                                                                    : (isAr ? "تم التحديث" : "Updated")}
                                                        </span>
                                                    ) : (
                                                        <span className="text-amber-600 dark:text-amber-400 font-black text-xs">{isAr ? "نشطة 🎯" : "Active 🎯"}</span>
                                                    )}
                                                    {isClosed && item.exit_reason_ar && (
                                                        <span className="mt-1 block max-w-[260px] text-[9px] font-bold text-amber-700 dark:text-amber-300">
                                                            {isAr ? `سبب الإغلاق: ${item.exit_reason_ar}` : `Exit reason: ${item.exit_reason_en || item.exit_reason}`}
                                                        </span>
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
