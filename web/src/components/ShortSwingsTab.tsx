"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Zap,
  Lock,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Clock,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  BarChart2,
  CheckCircle2,
  XCircle,
  Info,
  ChevronRight,
  ChevronLeft,
  Flame,
  Calendar as CalendarIcon,
  Layers,
  Award,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  X,
  Target,
  ExternalLink,
  Crown,
  Check,
  Percent,
  Grid,
  List,
  History,
  Activity
} from "lucide-react";
import StockLogo from "./StockLogo";
import { formatShortSwingReturn, shortSwingSessionState, shortSwingQuote } from "@/lib/short-swings-view";
import ActiveTradeCard from "./short-swings/ActiveTradeCard";
import { isShariaCompliant } from "@/lib/shariaStocks";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";

export interface ShortSwingTrade {
  symbol: string;
  name_ar?: string;
  name_en?: string;
  sector?: string;
  entry_date: string;
  exit_date?: string;
  entry_price?: number | null;
  current_price?: number | null;
  price_date?: string | null;
  ema10_trend?: number | null;
  exit_price?: number | null;
  return_pct: number;
  trailing_stop?: number | null;
  is_breakeven_protected?: boolean;
  max_gain_pct?: number;
  trigger_type?: string;
  status?: string;
  sessions?: number;
  reason?: string;
  is_locked?: boolean;
  is_pending_entry?: boolean;
  reference_close?: number | null;
  notes?: string;
}

export interface ShortSwingsData {
  is_pro: boolean;
  kpis?: {
    profit_factor: number;
    win_rate_pct: number;
    total_return_pct: number;
    max_drawdown_pct: number;
    avg_holding_days: number;
    avg_win_pct: number;
    avg_loss_pct: number;
    top_win_pct: number;
    monthly_trades_avg: number;
    total_trades?: number;
  };
  active_trades: ShortSwingTrade[];
  closed_trades: ShortSwingTrade[];
  total_active: number;
  total_closed: number;
  as_of?: string;
  phase?: "midday" | "close";
  computed_at?: string;
  cutoff_date_15d?: string;
  upgrade_cta?: string;
}

const safeNum = (val: unknown, fallback: number = 0): number => {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

const DEFAULT_SHORT_SWING_KPIS: NonNullable<ShortSwingsData["kpis"]> = {
  profit_factor: 0,
  win_rate_pct: 0,
  total_return_pct: 0,
  max_drawdown_pct: 0,
  avg_holding_days: 0,
  avg_win_pct: 0,
  avg_loss_pct: 0,
  top_win_pct: 0,
  monthly_trades_avg: 0,
};

interface ShortSwingsTabProps {
  isPro?: boolean;
  onSelectStock?: (stock: any) => void;
}

export default function ShortSwingsTab({ isPro = false, onSelectStock }: ShortSwingsTabProps) {
  const { language } = useLanguage();
  const isAr = language === "ar";
  const { theme } = useTheme();

  const [data, setData] = useState<ShortSwingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [viewMode, setViewMode] = useState<"active" | "closed" | "all" | "calendar">("active");

  // Helper for YYYY-MM-DD formatting
  const formatYMD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const todayDateStr = useMemo(() => formatYMD(new Date()), []);

  // Calendar Navigation State (Matching RecommendationCalendar)
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [filterPreset, setFilterPreset] = useState<"this_month" | "last_month" | "30days" | "all">("this_month");
  const [calendarViewType, setCalendarViewType] = useState<"grid" | "list">("grid");
  const [selectedDayTrades, setSelectedDayTrades] = useState<{ date: string; trades: ShortSwingTrade[] } | null>(null);

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

  const currentMonthName = isAr ? monthNamesAr[month] : monthNamesEn[month];
  const currentMonthStr = `${year}-${String(month + 1).padStart(2, "0")}`;

  const prevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    setFilterPreset("this_month");
  };

  const nextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setFilterPreset("this_month");
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setFilterPreset("this_month");
    const todayStr = formatYMD(today);
    const dayTrades = tradesByDate.get(todayStr) || [];
    setSelectedDayTrades({ date: todayStr, trades: dayTrades });
  };

  // Active trades state
  const [selectedActiveTrade, setSelectedActiveTrade] = useState<ShortSwingTrade | null>(null);
  const [activeSearchTerm, setActiveSearchTerm] = useState("");
  const [activeSector, setActiveSector] = useState("");
  const [activeShariaOnly, setActiveShariaOnly] = useState(false);

  // Search & filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSector, setSelectedSector] = useState("");
  const [filterResult, setFilterResult] = useState<"all" | "win" | "loss">("all");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const [allFilterResult, setAllFilterResult] = useState<"all" | "active" | "win" | "loss">("all");
  const [allPage, setAllPage] = useState(1);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const res = await fetch("/api/short-swings", {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        }
      });
      if (!res.ok) throw new Error("Short-swing snapshot unavailable");
      const json = await res.json();
      if (!Array.isArray(json.active_trades) || !Array.isArray(json.closed_trades)) throw new Error("Invalid short-swing snapshot");
      setData(json);
      setLoadError(false);
    } catch (err) {
      setLoadError(true);
      console.error("Failed to load short swings data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isPro]);

  useEffect(() => {
    loadData();

    // Listen to entitlement changes to unmask immediately on subscription
    const handleEntitlements = () => {
      loadData();
    };
    window.addEventListener("egx:entitlements-updated", handleEntitlements);
    window.addEventListener("storage", handleEntitlements);

    return () => {
      window.removeEventListener("egx:entitlements-updated", handleEntitlements);
      window.removeEventListener("storage", handleEntitlements);
    };
  }, [loadData]);

  const kpis = useMemo(() => {
    const raw = data?.kpis;
    return {
      profit_factor: safeNum(raw?.profit_factor, DEFAULT_SHORT_SWING_KPIS.profit_factor),
      win_rate_pct: safeNum(raw?.win_rate_pct, DEFAULT_SHORT_SWING_KPIS.win_rate_pct),
      total_return_pct: safeNum(raw?.total_return_pct, DEFAULT_SHORT_SWING_KPIS.total_return_pct),
      max_drawdown_pct: safeNum(raw?.max_drawdown_pct, DEFAULT_SHORT_SWING_KPIS.max_drawdown_pct),
      avg_holding_days: safeNum(raw?.avg_holding_days, DEFAULT_SHORT_SWING_KPIS.avg_holding_days),
      avg_win_pct: safeNum(raw?.avg_win_pct, DEFAULT_SHORT_SWING_KPIS.avg_win_pct),
      avg_loss_pct: safeNum(raw?.avg_loss_pct, DEFAULT_SHORT_SWING_KPIS.avg_loss_pct),
      top_win_pct: safeNum(raw?.top_win_pct, DEFAULT_SHORT_SWING_KPIS.top_win_pct),
      monthly_trades_avg: safeNum(raw?.monthly_trades_avg, DEFAULT_SHORT_SWING_KPIS.monthly_trades_avg),
      total_trades: raw?.total_trades,
    };
  }, [data?.kpis]);

  const activeTrades = data?.active_trades || [];
  const closedTrades = data?.closed_trades || [];
  const userHasPro = data?.is_pro ?? isPro;

  // Group closed trades by month & date
  const tradesByDate = useMemo(() => {
    const map = new Map<string, ShortSwingTrade[]>();
    closedTrades.forEach((t) => {
      if (!t.exit_date) return;
      const arr = map.get(t.exit_date) || [];
      arr.push(t);
      map.set(t.exit_date, arr);
    });
    return map;
  }, [closedTrades]);

  // Current viewed month / preset trades
  const viewedTrades = useMemo(() => {
    if (filterPreset === "all") {
      return closedTrades;
    }
    if (filterPreset === "30days") {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const cutoffStr = formatYMD(thirtyDaysAgo);
      return closedTrades.filter((t) => t.exit_date && t.exit_date >= cutoffStr);
    }
    return closedTrades.filter((t) => t.exit_date?.startsWith(currentMonthStr));
  }, [closedTrades, currentMonthStr, filterPreset]);

  // Month KPI stats
  const monthStats = useMemo(() => {
    const total = viewedTrades.length;
    if (total === 0) return { total: 0, wins: 0, losses: 0, winRate: 0, netReturn: 0, bestTrade: null };

    const wins = viewedTrades.filter((t) => safeNum(t.return_pct) > 0).length;
    const losses = viewedTrades.filter((t) => safeNum(t.return_pct) <= 0).length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const netReturn = viewedTrades.reduce((acc, t) => acc + safeNum(t.return_pct), 0);
    const bestTrade = [...viewedTrades].sort((a, b) => safeNum(b.return_pct) - safeNum(a.return_pct))[0] || null;

    return { total, wins, losses, winRate, netReturn, bestTrade };
  }, [viewedTrades]);

  // Generate calendar days for current viewed month with standard padding
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();

    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday

    const days = [];

    // Previous month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 1, dayNum);
      const mStr = String(prevDate.getMonth() + 1).padStart(2, "0");
      const dStr = String(dayNum).padStart(2, "0");
      const dateStr = `${prevDate.getFullYear()}-${mStr}-${dStr}`;
      const dayOfWeek = prevDate.getDay();
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
      days.push({
        dayNum,
        dateStr,
        isCurrentMonth: false,
        isWeekend
      });
    }

    // Days of current month
    for (let d = 1; d <= totalDays; d++) {
      const currDate = new Date(year, month, d);
      const dayOfWeek = currDate.getDay();
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Friday (5) or Saturday (6)
      const dateStr = `${currentMonthStr}-${String(d).padStart(2, "0")}`;
      days.push({
        dayNum: d,
        dateStr,
        isCurrentMonth: true,
        isWeekend
      });
    }

    // Next month padding to complete rows of 7
    const totalCells = Math.ceil(days.length / 7) * 7;
    const nextPadding = totalCells - days.length;
    for (let n = 1; n <= nextPadding; n++) {
      const nextDate = new Date(year, month + 1, n);
      const mStr = String(nextDate.getMonth() + 1).padStart(2, "0");
      const dStr = String(n).padStart(2, "0");
      const dateStr = `${nextDate.getFullYear()}-${mStr}-${dStr}`;
      const dayOfWeek = nextDate.getDay();
      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
      days.push({
        dayNum: n,
        dateStr,
        isCurrentMonth: false,
        isWeekend
      });
    }

    return days;
  }, [year, month, currentMonthStr]);

  // Unique sectors
  const sectors = useMemo(() => {
    const set = new Set<string>();
    closedTrades.forEach((t) => {
      if (t.sector) set.add(t.sector);
    });
    activeTrades.forEach((t) => {
      if (t.sector) set.add(t.sector);
    });
    return Array.from(set).sort();
  }, [closedTrades, activeTrades]);

  // Filtered active trades
  const filteredActiveTrades = useMemo(() => {
    return activeTrades.filter((t) => {
      if (activeSector && t.sector !== activeSector) return false;
      if (activeShariaOnly && !isShariaCompliant(t.symbol)) return false;
      if (activeSearchTerm.trim()) {
        const q = activeSearchTerm.toLowerCase();
        const sym = (t.symbol || "").toLowerCase();
        const name = (t.name_ar || "").toLowerCase();
        const sector = (t.sector || "").toLowerCase();
        return sym.includes(q) || name.includes(q) || sector.includes(q);
      }
      return true;
    });
  }, [activeTrades, activeSector, activeShariaOnly, activeSearchTerm]);

  // Combined all trades
  const allTrades = useMemo(() => {
    return [
      ...activeTrades.map((t) => ({ ...t, is_active: true })),
      ...closedTrades.map((t) => ({ ...t, is_active: false })),
    ];
  }, [activeTrades, closedTrades]);

  // Filtered closed trades for table view
  const filteredClosedTrades = useMemo(() => {
    return closedTrades.filter((t) => {
      if (selectedSector && t.sector !== selectedSector) return false;
      if (filterResult === "win" && t.return_pct <= 0) return false;
      if (filterResult === "loss" && t.return_pct > 0) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const sym = (t.symbol || "").toLowerCase();
        const name = (t.name_ar || "").toLowerCase();
        const sector = (t.sector || "").toLowerCase();
        return sym.includes(q) || name.includes(q) || sector.includes(q);
      }
      return true;
    });
  }, [closedTrades, filterResult, searchTerm, selectedSector]);

  const totalPages = Math.ceil(filteredClosedTrades.length / pageSize) || 1;
  const paginatedTrades = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredClosedTrades.slice(start, start + pageSize);
  }, [filteredClosedTrades, page, pageSize]);

  // Filtered all trades for table view
  const filteredAllTrades = useMemo(() => {
    return allTrades.filter((t) => {
      if (selectedSector && t.sector !== selectedSector) return false;
      if (allFilterResult === "active" && !t.is_active) return false;
      if (allFilterResult === "win" && (t.is_active || t.return_pct <= 0)) return false;
      if (allFilterResult === "loss" && (t.is_active || t.return_pct > 0)) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const sym = (t.symbol || "").toLowerCase();
        const name = (t.name_ar || "").toLowerCase();
        const sector = (t.sector || "").toLowerCase();
        return sym.includes(q) || name.includes(q) || sector.includes(q);
      }
      return true;
    });
  }, [allTrades, allFilterResult, searchTerm, selectedSector]);

  const allTotalPages = Math.ceil(filteredAllTrades.length / pageSize) || 1;
  const paginatedAllTrades = useMemo(() => {
    const start = (allPage - 1) * pageSize;
    return filteredAllTrades.slice(start, start + pageSize);
  }, [filteredAllTrades, allPage, pageSize]);

  const sessionState = shortSwingSessionState(data?.as_of);
  const selectedQuote = selectedActiveTrade ? shortSwingQuote(selectedActiveTrade, data?.as_of) : null;

  return (
    <div className="space-y-4 w-full min-w-0" dir={isAr ? "rtl" : "ltr"}>
      <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
        <div className="h-1 bg-amber-400" />
        <div className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-amber-700 dark:text-amber-300"><Zap className="w-4 h-4" />EGX BOTS · {isAr ? "متابعة الزخم" : "Momentum monitoring"}</span>
            <h1 className="text-2xl sm:text-3xl font-black text-zinc-950 dark:text-white">{isAr ? "التوصيات القصيرة" : "Short swing signals"}</h1>
            <p className="text-sm text-zinc-500 leading-relaxed">{isAr ? "تابع إشارات الدخول والوقف ونتائج الصفقات حسب آخر جلسة محفوظة." : "Entry signals, stops and trade outcomes from the latest saved session."}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => loadData(true)} disabled={refreshing || loading} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-xs font-bold text-zinc-800 dark:text-zinc-200 disabled:opacity-50 hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />{refreshing ? (isAr ? "جار التحميل…" : "Loading…") : (isAr ? "تحديث العرض" : "Reload view")}
            </button>
            {!userHasPro && <Link href="/pricing" className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-xs font-bold text-zinc-950 hover:bg-amber-200"><Crown className="w-4 h-4" />PRO</Link>}
          </div>
        </div>
      </section>

      <div role="status" className={`rounded-xl border px-4 py-3 ${sessionState === "today" ? "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50" : "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30"}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          <span>{isAr ? "آخر جلسة بيانات:" : "Latest data session:"} <bdi className="font-mono">{data?.as_of || "—"}</bdi></span>
          {data && <span className="text-xs text-amber-700 dark:text-amber-300">{sessionState === "previous" ? (isAr ? "بيانات جلسة سابقة" : "Previous session data") : sessionState === "unknown" ? (isAr ? "تاريخ البيانات غير مؤكد" : "Session date unverified") : (isAr ? "بيانات جلسة اليوم" : "Today's session data")}</span>}
          {data?.phase === "midday" && <span className="text-xs text-zinc-500">{isAr ? "تحديث أثناء الجلسة؛ النتائج مؤقتة حتى الإغلاق" : "Intraday update; provisional until close"}</span>}
        </div>
        <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">{sessionState === "previous" ? (isAr ? "الصفقات والأسعار أدناه تخص الجلسة المكتوبة، ولا تؤكد استمرار الصفقة أو سعرها اليوم." : "Trades and quotes belong to the displayed session, not a confirmed current position or today's price.") : (isAr ? "الأسعار حسب البيانات المحفوظة. النتائج محاكاة تاريخية وليست تنفيذ صفقات أو ضمان ربح." : "Saved quotes. Results are historical simulation, not executed trades or a profit guarantee.")}</p>
      </div>
      {loadError && <div role="alert" className="rounded-xl border border-rose-200 dark:border-rose-900 p-4 text-sm text-rose-700 dark:text-rose-300">{data ? (isAr ? "تعذّر تحديث العرض؛ ما زالت آخر بيانات محملة ظاهرة." : "Reload failed; the last loaded snapshot is still displayed.") : (isAr ? "تعذّر تحميل التوصيات. حاول تحديث العرض مرة أخرى." : "Could not load signals. Try reloading the view.")}</div>}

      {/* ── 3. COMPARISON SECTION: المتوسطة vs القصيرة (User's Core Requirement) ── */}
      <details className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
        <summary className="cursor-pointer text-sm font-bold text-zinc-700 dark:text-zinc-200">{isAr ? "كيف تعمل الاستراتيجية؟ ومتى تختار القصيرة؟" : "How does the strategy work?"}</summary>
        <div className="space-y-4 mt-4">
        <div className="flex items-center gap-2.5 border-b-2 border-black dark:border-white pb-3">
          <div className="w-8 h-8 border-2 border-black bg-[#FFE600] flex items-center justify-center font-black">
            <Info className="w-4 h-4 text-black" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-black text-black dark:text-white">
              مقارنة وتوضيح: ما الفرق بين التوصيات المتوسطة والصفقات القصيرة؟
            </h2>
            <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
              دليل لاختيار النظام الأنسب لأسلوب تداولك ومحفظتك
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card 1: التوصيات المتوسطة */}
          <div className="border-2 border-black dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/70 p-4 space-y-3 relative">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 border-2 border-black bg-blue-400 text-black text-xs font-black shadow-[2px_2px_0px_#000]">
                <Layers className="w-3.5 h-3.5" />
                <span>التوصيات المتوسطة (النظام الأساسي)</span>
              </span>
              <span className="text-[11px] font-black text-zinc-500">أفق هادئ</span>
            </div>

            <ul className="text-xs font-bold text-zinc-700 dark:text-zinc-300 space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 font-black">•</span>
                <span><strong>المدى الزمني:</strong> أسبوعان إلى شهرين (متوسط 25 - 45 يوماً).</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 font-black">•</span>
                <span><strong>الاستراتيجية:</strong> موجات صعود ونماذج كلاسيكية (قيعان مزدوجة، اختراق قنوات) مع فحص مالي وأساسي.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 font-black">•</span>
                <span><strong>إدارة الوقف:</strong> وقف خسارة واسع نسبياً (-7% إلى -12%) لتحمل تذبذبات السوق العادية.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 font-black">•</span>
                <span><strong>جني الأرباح:</strong> أهداف سعرية رقمية ثابتة (هدف أول وهدف ثانٍ).</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 font-black">•</span>
                <span><strong>الأنسب لـ:</strong> المستثمر والمضارب الهادئ الذي يفضل متابعة أسبوعية وعدد صفقات أقل.</span>
              </li>
            </ul>
          </div>

          {/* Card 2: الصفقات القصيرة */}
          <div className="border-2 border-black bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3 relative shadow-[2px_2px_0px_#000]">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 border-2 border-black bg-[#FFE600] text-black text-xs font-black shadow-[2px_2px_0px_#000]">
                <Zap className="w-3.5 h-3.5" />
                <span>الصفقات القصيرة ⚡ PRO (نظام الزخم)</span>
              </span>
              <span className="text-[11px] font-black text-amber-600 dark:text-amber-400">حركة سريعة</span>
            </div>

            <ul className="text-xs font-bold text-zinc-700 dark:text-zinc-300 space-y-2">
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-black">•</span>
                <span><strong>المدى الزمني:</strong> سريع ومكثف (متوسط 2 إلى 6 جلسات، وحتى 20 جلسة كحد أقصى مع استمرار الاتجاه).</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-black">•</span>
                <span><strong>الاستراتيجية:</strong> اختراق قمم تماسك 20 جلسة مع انفجار في السيولة المؤسسية (&gt;140% من المتوسط).</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-black">•</span>
                <span><strong>إدارة الوقف:</strong> وقف خسارة صارم جداً (-4.0% كحد أقصى)، مع تأمين الدخول آلياً عند +4.5%.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-black">•</span>
                <span><strong>ركوب الاتجاه:</strong> لا يوجد سقف للأرباح؛ الوقف يتبع متوسط 10 أيام (EMA10) ما دامت موجة الصعود مستمرة.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 font-black">•</span>
                <span><strong>الأنسب لـ:</strong> المضارب اليومي والنشط الباحث عن تدوير السيولة واقتناص الطفرات السريعة.</span>
              </li>
            </ul>
          </div>
        </div>
        </div>
      </details>

      {/* ── 4. SUB-TABS NAVIGATION BAR (Identical to Medium Swings) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900  p-1.5 gap-2 select-none">
        {[
          { id: "active", label: isAr ? "الصفقات النشطة (المفتوحة)" : "Active Swings", count: activeTrades.length, icon: Zap },
          { id: "closed", label: isAr ? "أرشيف الصفقات (المغلقة)" : "Closed Trades", count: closedTrades.length, icon: History },
          { id: "all", label: isAr ? "جميع الصفقات" : "All Trades", count: activeTrades.length + closedTrades.length, icon: Layers },
          { id: "calendar", label: isAr ? "تقويم وإحصائيات الصفقات" : "Trade Analytics & Calendar", count: null, icon: CalendarIcon, isSpecial: true },
        ].map(tab => {
          const isSelected = viewMode === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setViewMode(tab.id as any);
              }}
              className={`rounded-lg py-2.5 sm:py-3 px-3 sm:px-4 font-black text-xs sm:text-sm flex items-center justify-between gap-2 transition-all duration-100 active:scale-98 border-2 ${
                isSelected
                  ? tab.isSpecial
                    ? "bg-[#FFE600] text-black border-black shadow-[2px_2px_0px_#000]"
                    : "bg-black dark:bg-white border-black dark:border-white text-white dark:text-black shadow-[2px_2px_0px_rgba(0,0,0,0.2)]"
                  : "bg-white dark:bg-zinc-950 text-black dark:text-white border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <Icon className={`w-4 h-4 shrink-0 ${isSelected ? (tab.isSpecial ? "text-black" : "text-amber-400 dark:text-zinc-900") : "text-zinc-500"}`} />
                <span className="font-black truncate">{tab.label}</span>
              </div>
              {tab.count != null && (
                <span className={`px-2 py-0.5 text-xs font-bold font-mono shrink-0 ${
                  isSelected
                    ? "bg-zinc-800 dark:bg-zinc-200 text-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800"
                }`}>
                  {tab.count}
                </span>
              )}
              {tab.isSpecial && (
                <span className={`px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider shrink-0 ${
                  isSelected
                    ? "bg-black text-[#FFE600] border border-black"
                    : "bg-amber-400 text-black border border-black"
                }`}>
                  PRO
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── 5. KEY SYSTEM KPIs (Neo-Brutalist Grid - Hidden on Calendar to avoid duplicate stats) ── */}
      {!loading && data && viewMode !== "calendar" && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* KPI 1 */}
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black uppercase text-zinc-500">عامل الربح (Profit Factor)</span>
              <div className="w-7 h-7 border-2 border-black bg-amber-400 flex items-center justify-center font-black text-black">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black font-mono text-black dark:text-white">
              {safeNum(kpis.profit_factor, 1.51).toFixed(2)}
            </div>
            <p className="text-[10px] font-bold text-zinc-500 mt-1">
              إجمالي أرباح الصفقات ÷ إجمالي الخسائر
            </p>
          </div>

          {/* KPI 2 */}
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black uppercase text-zinc-500">نسبة النجاح (Win Rate)</span>
              <div className="w-7 h-7 border-2 border-black bg-emerald-400 flex items-center justify-center font-black text-black">
                <Target className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              {safeNum(kpis.win_rate_pct, 54.8).toFixed(1)}%
            </div>
            <p className="text-[10px] font-bold text-zinc-500 mt-1">
              {kpis.total_trades != null ? `مبني على ${kpis.total_trades.toLocaleString("en-US")} صفقة تاريخية` : "نتائج محاكاة تاريخية؛ حجم العينة غير متاح"}
            </p>
          </div>

          {/* KPI 3 */}
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black uppercase text-zinc-500">متوسط مدة الصفقة</span>
              <div className="w-7 h-7 border-2 border-black bg-sky-400 flex items-center justify-center font-black text-black">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black font-mono text-black dark:text-white">
              {safeNum(kpis.avg_holding_days, 2.9).toFixed(1)} <span className="text-sm">جلسات</span>
            </div>
            <p className="text-[10px] font-bold text-zinc-500 mt-1">
              سرعة خروج عالية دون تجميد للسيولة
            </p>
          </div>

          {/* KPI 4 */}
          <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-black uppercase text-zinc-500">أعلى صفقة رابحة</span>
              <div className="w-7 h-7 border-2 border-black bg-rose-400 flex items-center justify-center font-black text-black">
                <Award className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl sm:text-3xl font-black font-mono text-emerald-600 dark:text-emerald-400">
              +{safeNum(kpis.top_win_pct, 86.1).toFixed(1)}%
            </div>
            <p className="text-[10px] font-bold text-zinc-500 mt-1">
              ركوب كامل لموجة الصعود عبر EMA10
            </p>
          </div>
        </div>
      )}

      {/* ── 6. VIEW 1: TRADING CALENDAR (تقويم الصفقات) ── */}
      {viewMode === "calendar" && (
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-4 sm:p-6 shadow-[4px_4px_0px_#000] dark:shadow-[4px_4px_0px_#fff] space-y-6">
          {/* ── 1. Top Control Bar: Title, Presets & View Switcher ── */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 border-b-2 border-black dark:border-white pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 border-2 border-black bg-amber-400 flex items-center justify-center font-black shrink-0">
                <CalendarIcon className="w-5 h-5 text-black" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-black text-black dark:text-white">
                  تقويم أرباح وإحصائيات الصفقات القصيرة
                </h3>
                <p className="text-[11px] font-bold text-zinc-500">
                  تتبع الأرباح اليومية، والصفقات الرابحة والخاسرة لشهري 8 و 9 وكامل عام 2026
                </p>
              </div>
            </div>

            {/* Presets and View Switcher */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Presets buttons */}
              <div className="flex items-center border-2 border-black bg-zinc-100 dark:bg-zinc-900 p-0.5 text-xs font-bold overflow-x-auto">
                <button
                  onClick={goToToday}
                  className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                    filterPreset === "this_month" && currentMonthStr === todayDateStr.slice(0, 7)
                      ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                  }`}
                >
                  اليوم (أكتوبر 2026)
                </button>
                <button
                  onClick={() => {
                    setFilterPreset("this_month");
                    setCurrentDate(new Date(2026, 8, 1));
                  }}
                  className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                    currentMonthStr === "2026-09" && filterPreset !== "30days" && filterPreset !== "all"
                      ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                  }`}
                >
                  شهر 9 (سبتمبر 2026)
                </button>
                <button
                  onClick={() => {
                    setFilterPreset("this_month");
                    setCurrentDate(new Date(2026, 7, 1));
                  }}
                  className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                    currentMonthStr === "2026-08" && filterPreset !== "30days" && filterPreset !== "all"
                      ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                  }`}
                >
                  شهر 8 (أغسطس 2026)
                </button>
                <button
                  onClick={() => {
                    setFilterPreset("30days");
                    setCurrentDate(new Date());
                  }}
                  className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                    filterPreset === "30days"
                      ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                  }`}
                >
                  آخر 30 يوم
                </button>
                <button
                  onClick={() => {
                    setFilterPreset("all");
                  }}
                  className={`px-2.5 sm:px-3 py-1 transition-all whitespace-nowrap ${
                    filterPreset === "all"
                      ? "bg-[#FFE600] text-black font-black border border-black shadow-sm"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-black dark:hover:text-white"
                  }`}
                >
                  كامل عام 2026 (511 صفقة)
                </button>
              </div>

              {/* View Switcher: Grid vs List */}
              <div className="flex items-center border-2 border-black bg-zinc-100 dark:bg-zinc-900 p-0.5 shrink-0">
                <button
                  onClick={() => setCalendarViewType("grid")}
                  title={isAr ? "عرض التقويم" : "Calendar View"}
                  className={`p-1.5 transition-all ${
                    calendarViewType === "grid"
                      ? "bg-[#FFE600] text-black font-black border border-black"
                      : "text-zinc-400 hover:text-black dark:hover:text-white"
                  }`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCalendarViewType("list")}
                  title={isAr ? "عرض القائمة" : "List View"}
                  className={`p-1.5 transition-all ${
                    calendarViewType === "list"
                      ? "bg-[#FFE600] text-black font-black border border-black"
                      : "text-zinc-400 hover:text-black dark:hover:text-white"
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* ── 2. Month Navigation Bar (Identical to RecommendationCalendar) ── */}
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
              <span className="text-[10px] font-bold text-zinc-500 uppercase block">صفقات الشهر</span>
              <span className="text-xl font-black font-mono text-black dark:text-white">{monthStats.total} صفقة</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase block">نسبة النجاح للشهر</span>
              <div className="flex items-center gap-1.5" dir="ltr">
                <span className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                  {safeNum(monthStats.winRate).toFixed(1)}%
                </span>
                <span className="text-xs font-bold text-zinc-500 font-sans">
                  ({monthStats.wins} رابحة)
                </span>
              </div>
            </div>
            <div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase block">صافي العائد الإجمالي</span>
              <span
                dir="ltr"
                className={`text-xl font-black font-mono block ${
                  safeNum(monthStats.netReturn) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                }`}
              >
                {safeNum(monthStats.netReturn) >= 0 ? "+" : ""}{safeNum(monthStats.netReturn).toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase block">أفضل صفقة في الشهر</span>
              <span className="text-base sm:text-lg font-black font-mono text-indigo-600 dark:text-indigo-400 truncate block">
                {monthStats.bestTrade ? (
                  <span dir="ltr">
                    {monthStats.bestTrade.symbol} (+{safeNum(monthStats.bestTrade.return_pct).toFixed(1)}%)
                  </span>
                ) : (
                  "—"
                )}
              </span>
            </div>
          </div>

          {/* ── 4. CALENDAR GRID VIEW ── */}
          {calendarViewType === "grid" ? (
            <div className="space-y-2">
              {/* Day Names Header */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2 text-center font-black text-xs text-zinc-600 dark:text-zinc-400">
                <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black">الأحد</div>
                <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black">الإثنين</div>
                <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black">الثلاثاء</div>
                <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black">الأربعاء</div>
                <div className="p-1.5 bg-zinc-200 dark:bg-zinc-800 border-2 border-black">الخميس</div>
                <div className="p-1.5 bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-400 text-zinc-400">الجمعة (عطلة)</div>
                <div className="p-1.5 bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-400 text-zinc-400">السبت (عطلة)</div>
              </div>

              {/* Calendar Cells */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {calendarDays.map((cell, idx) => {
                  const dayTrades = tradesByDate.get(cell.dateStr) || [];
                  const hasTrades = cell.isCurrentMonth && dayTrades.length > 0;
                  const wins = dayTrades.filter((t) => t.return_pct > 0).length;
                  const losses = dayTrades.filter((t) => t.return_pct <= 0).length;
                  const netDailyPct = dayTrades.reduce((acc, t) => acc + (t.return_pct || 0), 0);
                  const maxGainTrade = dayTrades.length > 0 ? [...dayTrades].sort((a, b) => b.return_pct - a.return_pct)[0] : null;
                  const isBigRunnerDay = maxGainTrade && maxGainTrade.return_pct >= 15;
                  const isToday = cell.dateStr === todayDateStr;
                  const isSelected = selectedDayTrades?.date === cell.dateStr;

                  return (
                    <div
                      key={`${cell.dateStr}-${idx}`}
                      onClick={() => {
                        setSelectedDayTrades({ date: cell.dateStr, trades: dayTrades });
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
                          : hasTrades
                          ? netDailyPct >= 0
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
                                ? hasTrades
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

                        {hasTrades && (
                          <span className="px-1.5 py-0.2 border border-black bg-black text-[#FFE600] text-[9px] font-black">
                            {dayTrades.length} صفقات
                          </span>
                        )}
                      </div>

                      {/* Middle: Win/Loss & Return */}
                      {hasTrades ? (
                        <div className="space-y-1 my-1">
                          <div className="flex items-center justify-between text-[10px] font-black">
                            <span className="text-emerald-600 dark:text-emerald-400">{wins} رابحة</span>
                            {losses > 0 && <span className="text-rose-500">{losses} خاسرة</span>}
                          </div>

                          <div
                            dir="ltr"
                            className={`text-xs font-black font-mono text-center px-1 py-0.5 border border-black ${
                              safeNum(netDailyPct) >= 0
                                ? "bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-100"
                                : "bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-100"
                            }`}
                          >
                            {safeNum(netDailyPct) >= 0 ? "+" : ""}{safeNum(netDailyPct).toFixed(1)}%
                          </div>
                        </div>
                      ) : (
                        <div className="text-[10px] text-zinc-300 dark:text-zinc-700 font-bold text-center">
                          {!cell.isCurrentMonth ? "" : cell.isWeekend ? "عطلة" : "لا إغلاقات"}
                        </div>
                      )}

                      {/* Bottom: Big Runner highlight */}
                      {isBigRunnerDay && (
                        <div
                          dir="ltr"
                          className="text-[9px] font-black bg-amber-400 text-black px-1 py-0.5 border border-black text-center truncate"
                        >
                          🔥 {maxGainTrade.symbol} +{safeNum(maxGainTrade?.return_pct).toFixed(0)}%
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ── 5. AGENDA / LIST VIEW (When List icon is clicked) ── */
            <div className="space-y-3">
              {viewedTrades.length === 0 ? (
                <div className="p-6 text-center text-xs font-bold text-zinc-500 border-2 border-black">
                  لا توجد صفقات مغلقة في هذه الفترة المحددة.
                </div>
              ) : (
                <div className="divide-y-2 divide-black border-2 border-black">
                  {viewedTrades.map((t, idx) => {
                    const isWin = safeNum(t.return_pct) > 0;
                    return (
                      <div
                        key={`${t.symbol}-${idx}`}
                        className="p-3 sm:p-4 bg-white dark:bg-zinc-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        <div className="flex items-center gap-3">
                          {t.is_locked ? (
                            <div className="w-8 h-8 border-2 border-black bg-amber-400 flex items-center justify-center font-black">
                              <Lock className="w-4 h-4 text-black" />
                            </div>
                          ) : (
                            <StockLogo symbol={t.symbol} size="sm" />
                          )}
                          <div>
                            <span className="font-black text-sm text-black dark:text-white font-mono">
                              {t.symbol}
                            </span>
                            <span className="text-[11px] font-bold text-zinc-500 block">
                              {t.name_ar || t.sector} • خرجت في {t.exit_date}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right text-xs font-mono">
                            <span className="text-zinc-500 block text-[10px]">الدخول / الخروج</span>
                            <span>{t.is_locked ? "🔒" : `${t.entry_price != null ? safeNum(t.entry_price).toFixed(2) : "—"} → ${t.exit_price != null ? safeNum(t.exit_price).toFixed(2) : "—"} ج.م`}</span>
                          </div>

                          <div dir="ltr">
                            <span
                              className={`inline-block px-2.5 py-1 border-2 border-black font-mono font-black text-xs ${
                                isWin ? "bg-emerald-400 text-black" : "bg-rose-400 text-black"
                              }`}
                            >
                              {formatShortSwingReturn(t.return_pct)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {viewMode === "active" && <section aria-label={isAr ? "متابعة الصفقات القصيرة" : "Short trade monitoring"} className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-bold text-zinc-950 dark:text-white">{isAr ? "الصفقات في آخر جلسة محفوظة" : "Trades in the saved session"} <span className="text-sm text-zinc-500">({activeTrades.length})</span></h3>
          <span className="text-xs text-zinc-500">{isAr ? "سعر الدخول · آخر سعر · الوقف" : "Entry · Saved price · Stop"}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-3">
          <label className="relative"><span className="sr-only">{isAr ? "بحث في الصفقات" : "Search trades"}</span><Search className="absolute right-3 top-3 w-4 h-4 text-zinc-400" /><input type="search" placeholder={isAr ? "رمز السهم أو الشركة" : "Ticker or company"} value={activeSearchTerm} onChange={e => setActiveSearchTerm(e.target.value)} className="w-full min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent h-10 pr-9 pl-3 text-sm text-zinc-900 dark:text-white focus-visible:outline-amber-500" /></label>
          <select aria-label={isAr ? "القطاع" : "Sector"} value={activeSector} onChange={e => setActiveSector(e.target.value)} className="w-full min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 h-10 text-sm text-zinc-900 dark:text-white"><option value="">{isAr ? "كل القطاعات" : "All sectors"}</option>{sectors.map(sec => <option key={sec} value={sec}>{sec}</option>)}</select>
          <button aria-pressed={activeShariaOnly} onClick={() => setActiveShariaOnly(!activeShariaOnly)} className={`rounded-lg border h-10 flex justify-center items-center gap-2 text-xs font-bold ${activeShariaOnly ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300" : "border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300"}`}><ShieldCheck className="w-4 h-4" />{isAr ? "المتوافقة شرعياً فقط" : "Sharia compliant only"}</button>
        </div>
        {loading ? <div aria-label={isAr ? "جار تحميل الصفقات" : "Loading trades"} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{[0,1,2].map(n => <div key={n} className="h-64 rounded-2xl bg-zinc-100 dark:bg-zinc-900 animate-pulse" />)}</div>
          : !data ? null : filteredActiveTrades.length === 0 ? <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-8 text-center text-sm text-zinc-500">{isAr ? "لا توجد صفقات تطابق البحث في الجلسة المعروضة." : "No matching trades in the saved session."}</div>
          : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">{filteredActiveTrades.map((trade, idx) => <ActiveTradeCard key={`${trade.symbol}-${idx}`} trade={trade} session={data.as_of} previousSession={sessionState !== "today"} isAr={isAr} onDetails={setSelectedActiveTrade} />)}</div>}
      </section>}

      {/* ── 8. VIEW 3: CLOSED TRADES LIST & TABLE (قائمة الصفقات المغلقة) ── */}
      {viewMode === "closed" && (
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-4 sm:p-6 shadow-[4px_4px_0px_#000] dark:shadow-[4px_4px_0px_#fff] space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b-2 border-black dark:border-white pb-4">
            <h3 className="text-lg font-black text-black dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-amber-500" />
              <span>أرشيف صفقات 2026 المغلقة ({closedTrades.length} صفقة)</span>
            </h3>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute right-2.5 top-2.5 text-zinc-400" />
                <input
                  type="text"
                  placeholder="بحث برمز السهم أو القطاع..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  className="h-9 pr-8 pl-3 border-2 border-black bg-zinc-100 dark:bg-zinc-900 text-xs font-bold text-black dark:text-white focus:outline-none"
                />
              </div>

              {sectors.length > 0 && (
                <div className="relative">
                  <select
                    value={selectedSector}
                    onChange={(e) => {
                      setSelectedSector(e.target.value);
                      setPage(1);
                    }}
                    className="h-9 px-3 border-2 border-black bg-zinc-100 dark:bg-zinc-900 text-xs font-bold text-black dark:text-white focus:outline-none"
                  >
                    <option value="">{isAr ? "جميع القطاعات" : "All Sectors"} ({sectors.length})</option>
                    {sectors.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex border-2 border-black">
                <button
                  onClick={() => { setFilterResult("all"); setPage(1); }}
                  className={`px-3 py-1.5 text-xs font-black ${filterResult === "all" ? "bg-black text-white" : "bg-white text-black"}`}
                >
                  الكل
                </button>
                <button
                  onClick={() => { setFilterResult("win"); setPage(1); }}
                  className={`px-3 py-1.5 text-xs font-black ${filterResult === "win" ? "bg-emerald-400 text-black" : "bg-white text-black"}`}
                >
                  رابحة
                </button>
                <button
                  onClick={() => { setFilterResult("loss"); setPage(1); }}
                  className={`px-3 py-1.5 text-xs font-black ${filterResult === "loss" ? "bg-rose-400 text-black" : "bg-white text-black"}`}
                >
                  خاسرة
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border-2 border-black">
            <table className="w-full text-right text-xs">
              <thead className="bg-zinc-200 dark:bg-zinc-900 border-b-2 border-black text-zinc-900 dark:text-zinc-100 font-black">
                <tr>
                  <th className="p-3">السهم</th>
                  <th className="p-3">القطاع</th>
                  <th className="p-3">تاريخ الدخول</th>
                  <th className="p-3">تاريخ الخروج</th>
                  <th className="p-3">سعر الدخول</th>
                  <th className="p-3">سعر الخروج</th>
                  <th className="p-3">المدة</th>
                  <th className="p-3">العائد</th>
                  <th className="p-3">سبب الخروج</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black font-bold">
                {paginatedTrades.map((t, idx) => {
                  const isWin = t.return_pct > 0;
                  return (
                    <tr
                      key={`${t.symbol}-${idx}`}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {t.is_locked ? (
                            <Lock className="w-4 h-4 text-amber-500" />
                          ) : (
                            <StockLogo symbol={t.symbol} size="sm" />
                          )}
                          <span className="font-black text-black dark:text-white font-mono">
                            {t.symbol}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-zinc-500">{t.sector || "عام"}</td>
                      <td className="p-3 font-mono text-zinc-600 dark:text-zinc-400">{t.entry_date}</td>
                      <td className="p-3 font-mono text-zinc-600 dark:text-zinc-400">{t.exit_date}</td>
                      <td className="p-3 font-mono">
                        {t.is_locked ? "—" : `${t.entry_price != null ? safeNum(t.entry_price).toFixed(2) : "—"} ج.م`}
                      </td>
                      <td className="p-3 font-mono">
                        {t.is_locked ? "—" : `${t.exit_price != null ? safeNum(t.exit_price).toFixed(2) : "—"} ج.م`}
                      </td>
                      <td className="p-3 font-mono">{t.sessions ? `${t.sessions} جلسات` : "—"}</td>
                      <td className="p-3 font-mono font-black">
                        <span
                          className={`inline-block px-2 py-0.5 border border-black ${
                            isWin
                              ? "bg-emerald-400 text-black"
                              : "bg-rose-400 text-black"
                          }`}
                        >
                          {formatShortSwingReturn(t.return_pct)}
                        </span>
                      </td>
                      <td className="p-3 text-zinc-500 text-[11px]">
                        {t.reason === "ema10_break"
                          ? "إغلاق تحت EMA10 (ركوب اتجاه)"
                          : t.reason === "stop_be"
                          ? "تأمين نقطة الدخول"
                          : t.reason === "stop_loss"
                          ? "وقف خسارة -4%"
                          : t.reason || "انتهاء المدة"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-3">
            <span className="text-xs font-bold text-zinc-500">
              صفحة {page} من {totalPages} ({filteredClosedTrades.length} صفقة)
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 border-2 border-black text-xs font-black disabled:opacity-40"
              >
                السابق
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 border-2 border-black text-xs font-black disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 9. VIEW 4: ALL TRADES (جميع الصفقات) ── */}
      {viewMode === "all" && (
        <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-4 sm:p-6 shadow-[4px_4px_0px_#000] dark:shadow-[4px_4px_0px_#fff] space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b-2 border-black dark:border-white pb-4">
            <h3 className="text-lg font-black text-black dark:text-white flex items-center gap-2">
              <Layers className="w-5 h-5 text-amber-500" />
              <span>سجل جميع الصفقات ({allTrades.length} صفقة)</span>
            </h3>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-4 h-4 absolute right-2.5 top-2.5 text-zinc-400" />
                <input
                  type="text"
                  placeholder="بحث برمز السهم أو القطاع..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setAllPage(1);
                  }}
                  className="h-9 pr-8 pl-3 border-2 border-black bg-zinc-100 dark:bg-zinc-900 text-xs font-bold text-black dark:text-white focus:outline-none"
                />
              </div>

              {sectors.length > 0 && (
                <div className="relative">
                  <select
                    value={selectedSector}
                    onChange={(e) => {
                      setSelectedSector(e.target.value);
                      setAllPage(1);
                    }}
                    className="h-9 px-3 border-2 border-black bg-zinc-100 dark:bg-zinc-900 text-xs font-bold text-black dark:text-white focus:outline-none"
                  >
                    <option value="">{isAr ? "جميع القطاعات" : "All Sectors"} ({sectors.length})</option>
                    {sectors.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex border-2 border-black">
                <button
                  onClick={() => { setAllFilterResult("all"); setAllPage(1); }}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs font-black ${allFilterResult === "all" ? "bg-black text-white" : "bg-white text-black"}`}
                >
                  الكل
                </button>
                <button
                  onClick={() => { setAllFilterResult("active"); setAllPage(1); }}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs font-black ${allFilterResult === "active" ? "bg-amber-400 text-black" : "bg-white text-black"}`}
                >
                  النشطة ({activeTrades.length})
                </button>
                <button
                  onClick={() => { setAllFilterResult("win"); setAllPage(1); }}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs font-black ${allFilterResult === "win" ? "bg-emerald-400 text-black" : "bg-white text-black"}`}
                >
                  رابحة
                </button>
                <button
                  onClick={() => { setAllFilterResult("loss"); setAllPage(1); }}
                  className={`px-2.5 sm:px-3 py-1.5 text-xs font-black ${allFilterResult === "loss" ? "bg-rose-400 text-black" : "bg-white text-black"}`}
                >
                  خاسرة
                </button>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto border-2 border-black">
            <table className="w-full text-right text-xs">
              <thead className="bg-zinc-200 dark:bg-zinc-900 border-b-2 border-black text-zinc-900 dark:text-zinc-100 font-black">
                <tr>
                  <th className="p-3">السهم</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">القطاع</th>
                  <th className="p-3">تاريخ الدخول</th>
                  <th className="p-3">تاريخ الخروج</th>
                  <th className="p-3">سعر الدخول</th>
                  <th className="p-3">سعر الخروج / الحالي</th>
                  <th className="p-3">المدة</th>
                  <th className="p-3">العائد</th>
                  <th className="p-3">الاستراتيجية / السبب</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-black font-bold">
                {paginatedAllTrades.map((t, idx) => {
                  const isWin = t.return_pct > 0;
                  return (
                    <tr
                      key={`${t.symbol}-${idx}-${t.is_active ? "active" : "closed"}`}
                      className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {t.is_locked ? (
                            <Lock className="w-4 h-4 text-amber-500" />
                          ) : (
                            <StockLogo symbol={t.symbol} size="sm" />
                          )}
                          <span className="font-black text-black dark:text-white font-mono">
                            {t.symbol}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        {t.is_active ? (
                          <span className="px-2 py-0.5 border border-black bg-amber-400 text-black font-black text-[10px]">
                            نشطة ⚡
                          </span>
                        ) : isWin ? (
                          <span className="px-2 py-0.5 border border-black bg-emerald-300 text-emerald-950 font-black text-[10px]">
                            مغلقة (ربح)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 border border-black bg-rose-300 text-rose-950 font-black text-[10px]">
                            مغلقة (وقف)
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-zinc-500">{t.sector || "عام"}</td>
                      <td className="p-3 font-mono text-zinc-600 dark:text-zinc-400">{t.entry_date}</td>
                      <td className="p-3 font-mono text-zinc-600 dark:text-zinc-400">
                        {t.is_active ? "مستمرة ⚡" : t.exit_date}
                      </td>
                      <td className="p-3 font-mono">
                        {t.is_locked ? "—" : `${t.entry_price != null ? safeNum(t.entry_price).toFixed(2) : "—"} ج.م`}
                      </td>
                      <td className="p-3 font-mono">
                        {t.is_locked ? "—" : `${(t.is_active ? shortSwingQuote(t, data?.as_of).price : t.exit_price) != null ? safeNum(t.is_active ? shortSwingQuote(t, data?.as_of).price : t.exit_price).toFixed(2) : "—"} ج.م`}
                      </td>
                      <td className="p-3 font-mono">{t.sessions ? `${t.sessions} جلسات` : "—"}</td>
                      <td className="p-3 font-mono font-black">
                        <span
                          className={`inline-block px-2 py-0.5 border border-black ${
                            isWin
                              ? "bg-emerald-400 text-black"
                              : "bg-rose-400 text-black"
                          }`}
                        >
                          {formatShortSwingReturn(t.is_active ? shortSwingQuote(t, data?.as_of).returnPct : t.return_pct)}
                        </span>
                      </td>
                      <td className="p-3 text-zinc-500 text-[11px]">
                        {t.is_active
                          ? (t.trigger_type || "اختراق قمة 20 جلسة")
                          : t.reason === "ema10_break"
                          ? "إغلاق تحت EMA10 (ركوب اتجاه)"
                          : t.reason === "stop_be"
                          ? "تأمين نقطة الدخول"
                          : t.reason === "stop_loss"
                          ? "وقف خسارة -4%"
                          : t.reason || "انتهاء المدة"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-3">
            <span className="text-xs font-bold text-zinc-500">
              صفحة {allPage} من {allTotalPages} ({filteredAllTrades.length} صفقة)
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setAllPage((p) => Math.max(1, p - 1))}
                disabled={allPage === 1}
                className="px-3 py-1 border-2 border-black text-xs font-black disabled:opacity-40"
              >
                السابق
              </button>
              <button
                onClick={() => setAllPage((p) => Math.min(allTotalPages, p + 1))}
                disabled={allPage === allTotalPages}
                className="px-3 py-1 border-2 border-black text-xs font-black disabled:opacity-40"
              >
                التالي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 9. DAY DETAILS MODAL (CreatePortal) ── */}
      {selectedDayTrades && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[2147483647] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedDayTrades(null)}
          dir="rtl"
        >
          <div
            className="w-full max-w-2xl border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-xl space-y-5 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b-2 border-black dark:border-white pb-3">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5 text-amber-500" />
                <h3 className="text-lg font-black text-black dark:text-white">
                  صفقات يوم {selectedDayTrades.date} ({selectedDayTrades.trades.length} صفقات مغلقة)
                </h3>
              </div>

              <button
                onClick={() => setSelectedDayTrades(null)}
                className="w-8 h-8 border-2 border-black bg-white hover:bg-rose-500 hover:text-white flex items-center justify-center font-black transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List of trades for this day */}
            <div className="space-y-3">
              {selectedDayTrades.trades.length === 0 ? (
                <div className="p-8 text-center border-2 border-dashed border-black dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 space-y-2">
                  <Clock className="w-8 h-8 mx-auto text-zinc-400" />
                  <p className="font-black text-sm text-black dark:text-white">
                    لا توجد صفقات قصيرة مغلقة في هذا اليوم ({selectedDayTrades.date})
                  </p>
                  <p className="text-xs text-zinc-500 font-bold">
                    الصفقات المفتوحة التي لم تُغلق بعد يمكن متابعتها في تبويب "الصفقات النشطة ⚡".
                  </p>
                </div>
              ) : (
                selectedDayTrades.trades.map((t, i) => {
                const isWin = t.return_pct > 0;
                return (
                  <div
                    key={`${t.symbol}-${i}`}
                    className="border-2 border-black dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-2 shadow-[2px_2px_0px_#000]"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        {t.is_locked ? (
                          <div className="w-8 h-8 border-2 border-black bg-amber-400 flex items-center justify-center font-black">
                            <Lock className="w-4 h-4 text-black" />
                          </div>
                        ) : (
                          <StockLogo symbol={t.symbol} size="sm" />
                        )}

                        <div>
                          <span className="font-black text-sm text-black dark:text-white font-mono">
                            {t.symbol}
                          </span>
                          <span className="text-[11px] font-bold text-zinc-500 block">
                            {t.name_ar || t.sector}
                          </span>
                        </div>
                      </div>

                      <div className="text-left">
                        <span
                          className={`inline-block px-2.5 py-1 border-2 border-black font-mono font-black text-sm ${
                            isWin ? "bg-emerald-400 text-black" : "bg-rose-400 text-black"
                          }`}
                        >
                          {formatShortSwingReturn(t.return_pct)}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-bold pt-2 border-t border-zinc-200 dark:border-zinc-800">
                      <div>
                        <span className="text-zinc-500 text-[10px] block">سعر الدخول</span>
                        <span className="font-mono text-black dark:text-white">
                          {t.is_locked ? "🔒 مشفر" : `${t.entry_price != null ? safeNum(t.entry_price).toFixed(2) : "—"} ج.م`}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-[10px] block">سعر الخروج</span>
                        <span className="font-mono text-black dark:text-white">
                          {t.is_locked ? "🔒 مشفر" : `${t.exit_price != null ? safeNum(t.exit_price).toFixed(2) : "—"} ج.م`}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-[10px] block">مدة الصفقة</span>
                        <span className="font-mono text-black dark:text-white">{t.sessions} جلسات</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-[10px] block">سبب الخروج</span>
                        <span className="text-black dark:text-white text-[11px]">
                          {t.reason === "ema10_break"
                            ? "كسر EMA10"
                            : t.reason === "stop_be"
                            ? "تأمين أرباح"
                            : "وقف خسارة"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedDayTrades(null)}
                className="px-5 py-2 border-2 border-black bg-black text-white font-black text-xs uppercase"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── 9. ACTIVE TRADE DETAILS MODAL (Neo-Brutalist Portal) ── */}
      {selectedActiveTrade && createPortal(
        <div
          onClick={() => setSelectedActiveTrade(null)}
          className="fixed inset-0 z-[2147483647] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-150"
          dir="rtl"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label="تفاصيل الصفقة القصيرة"
            className="relative w-full max-w-2xl rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xl overflow-hidden my-auto max-h-[92vh] flex flex-col text-black dark:text-white"
          >
            <div className="px-4 py-2 text-xs text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900">جلسة البيانات: <bdi>{data?.as_of || "—"}</bdi>{selectedQuote?.issue && !selectedActiveTrade.is_locked ? " · السعر والعائد غير مؤكدين" : ""}</div>
            {/* Header */}
            <div className="p-4 sm:p-5 border-b-4 border-black dark:border-white bg-[#FFE600] text-black flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {selectedActiveTrade.is_locked ? (
                  <div className="w-10 h-10 border-2 border-black bg-black text-[#FFE600] flex items-center justify-center shrink-0">
                    <Lock className="w-5 h-5" />
                  </div>
                ) : (
                  <StockLogo symbol={selectedActiveTrade.symbol} size="md" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-black font-mono">
                      {selectedActiveTrade.is_locked ? "••••••" : selectedActiveTrade.symbol}
                    </h3>
                    {!selectedActiveTrade.is_locked && isShariaCompliant(selectedActiveTrade.symbol) && (
                      <span className="px-1.5 py-0.5 border border-black bg-emerald-400 text-black text-[9px] font-black uppercase">
                        حلال
                      </span>
                    )}
                    {selectedActiveTrade.is_breakeven_protected && (
                      <span className="px-1.5 py-0.5 border border-black bg-emerald-300 text-black text-[9px] font-black">
                        وقف مرفوع حسب السجل
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-800 font-bold truncate">
                    {selectedActiveTrade.is_locked ? "صفقة مشفرة للمشتركين" : (selectedActiveTrade.name_ar || selectedActiveTrade.sector)} • خطف الزخم والوقف المتحرك
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedActiveTrade(null)}
                className="w-9 h-9 border-2 border-black bg-white hover:bg-zinc-100 text-black flex items-center justify-center shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all font-black shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            {selectedActiveTrade.is_locked ? (
              <div className="p-8 text-center space-y-4">
                <div className="w-16 h-16 border-4 border-black bg-amber-400 mx-auto flex items-center justify-center shadow-[4px_4px_0px_#000]">
                  <Lock className="w-8 h-8 text-black" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xl font-black">هذه الصفقة متاحة حصرياً لمشتركي PRO</h4>
                  <p className="text-xs font-bold text-zinc-600 dark:text-zinc-400 max-w-md mx-auto">
                    الصفقات القصيرة المفتوحة والصفقات الأحدث من 15 يوماً تتطلب اشتراكاً نشطاً للحصول على إشارات الدخول والوقف المتحرك المحدث فور صدورها.
                  </p>
                </div>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-2 px-6 py-3 border-2 border-black bg-black text-[#FFE600] font-black text-sm uppercase shadow-[3px_3px_0px_#000]"
                >
                  <Crown className="w-4 h-4 text-[#FFE600]" />
                  <span>ترقية الحساب إلى PRO الآن</span>
                </Link>
              </div>
            ) : (
              <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
                {/* 4 KPI Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                  <div className="p-3 border-2 border-black bg-zinc-50 dark:bg-zinc-900">
                    <span className="text-[10px] text-zinc-500 font-black uppercase block">
                      {selectedActiveTrade.is_pending_entry ? "التنفيذ المقترح" : "سعر الدخول"}
                    </span>
                    <span className="text-base font-black font-mono mt-0.5 block">
                      {selectedActiveTrade.is_pending_entry
                        ? selectedActiveTrade.entry_date || "جلسة الدخول المقترحة"
                        : `${selectedActiveTrade.entry_price != null ? safeNum(selectedActiveTrade.entry_price).toFixed(2) : "—"} ج.م`}
                    </span>
                  </div>

                  <div className="p-3 border-2 border-black bg-zinc-50 dark:bg-zinc-900">
                    <span className="text-[10px] text-zinc-500 font-black uppercase block">
                      {selectedActiveTrade.is_pending_entry ? "إغلاق جلسة الإشارة (مرجعي)" : "آخر سعر محفوظ"}
                    </span>
                    <span className="text-base font-black font-mono mt-0.5 block">
                      {selectedActiveTrade.is_pending_entry
                        ? `${selectedActiveTrade.reference_close != null ? safeNum(selectedActiveTrade.reference_close).toFixed(2) : (selectedQuote?.price != null ? selectedQuote.price.toFixed(2) : "—")} ج.م`
                        : `${selectedQuote?.price != null ? selectedQuote.price.toFixed(2) : "—"} ج.م`}
                    </span>
                  </div>

                  <div className="p-3 border-2 border-black bg-amber-50 dark:bg-amber-950/30">
                    <span className="text-[10px] text-amber-700 dark:text-amber-400 font-black uppercase block">
                      {selectedActiveTrade.is_pending_entry ? "الوقف المبدئي (-4%)" : "الوقف المتحرك (EMA10)"}
                    </span>
                    <span className="text-base font-black font-mono text-amber-600 dark:text-amber-400 mt-0.5 block">
                      {selectedActiveTrade.trailing_stop != null ? safeNum(selectedActiveTrade.trailing_stop).toFixed(2) : "—"} ج.م
                    </span>
                  </div>

                  <div className={`p-3 border-2 border-black ${selectedQuote?.returnPct == null && !selectedActiveTrade.is_pending_entry ? "bg-zinc-100 dark:bg-zinc-900" : selectedActiveTrade.is_pending_entry ? "bg-amber-100 dark:bg-amber-950/40" : (safeNum(selectedActiveTrade.return_pct) >= 0 ? "bg-emerald-100 dark:bg-emerald-950/40" : "bg-rose-100 dark:bg-rose-950/40")}`}>
                    <span className="text-[10px] text-zinc-600 font-black uppercase block">
                      {selectedActiveTrade.is_pending_entry ? "حالة الإشارة" : "العائد حسب السعر المحفوظ"}
                    </span>
                    <span
                      dir="ltr"
                      className={`text-base font-black font-mono mt-0.5 block ${selectedQuote?.returnPct == null && !selectedActiveTrade.is_pending_entry ? "text-zinc-600 dark:text-zinc-400" : selectedActiveTrade.is_pending_entry ? "text-amber-900 dark:text-amber-200" : (safeNum(selectedActiveTrade.return_pct) >= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}`}
                    >
                      {selectedActiveTrade.is_pending_entry
                        ? "لم يبدأ العائد (انتظار الافتتاح)"
                        : formatShortSwingReturn(selectedQuote?.returnPct, 2)}
                    </span>
                  </div>
                </div>

                {/* Signal Breakdown Section */}
                <div className="space-y-3">
                  {/* Card 1: Entry Signal Rationale */}
                  <div className="border-2 border-black bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <h4 className="text-xs font-black uppercase text-emerald-900 dark:text-emerald-200">
                        {selectedActiveTrade.is_pending_entry ? "إشارة الدخول للجلسة التالية للإشارة" : "إشارة وتوقيت الدخول (Momentum Entry Setup)"}
                      </h4>
                    </div>
                    <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 leading-relaxed">
                      {selectedActiveTrade.is_pending_entry ? (
                        <span>
                          تحققت إشارة الشراء الفنية مع إغلاق جلسة الإشارة بناءً على اختراق قمة تماسك 20 جلسة تداول مع تدفق سيولة مؤسسية تجاوزت <strong>140%</strong>. التنفيذ المقترح مع <strong>افتتاح الجلسة التالية للإشارة</strong> (سعر الإغلاق المرجعي: <strong>{((selectedActiveTrade.reference_close ?? selectedQuote?.price)?.toFixed(2) || "—")} ج.م</strong>) بشرط ألا يتجاوز الافتتاح فجوة سعرية صاعدة أعلى من <strong>+2.0%</strong>.
                        </span>
                      ) : (
                        <span>
                          سجلت المحاكاة دخول السهم بتاريخ <strong>{selectedActiveTrade.entry_date}</strong> بسعر <strong>{selectedActiveTrade.entry_price != null ? safeNum(selectedActiveTrade.entry_price).toFixed(2) : "—"} ج.م</strong> بناءً على إشارة فنية رقمية صارمة: اختراق قمة تماسك 20 جلسة تداول مع تدفق سيولة مؤسسية تجاوزت <strong>140%</strong> من متوسط التداول اليومي.
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Card 2: Trailing Stop & Exit Rule */}
                  <div className="border-2 border-black bg-amber-50 dark:bg-amber-950/20 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <h4 className="text-xs font-black uppercase text-amber-900 dark:text-amber-200">
                        قاعدة الخروج والوقف المتحرك (Trailing Stop EMA10)
                      </h4>
                    </div>
                    <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 leading-relaxed">
                      {selectedActiveTrade.is_pending_entry ? (
                        <span>
                          مستوى الوقف المبدئي محدد عند <strong>{selectedActiveTrade.trailing_stop != null ? safeNum(selectedActiveTrade.trailing_stop).toFixed(2) : "—"} ج.م</strong> (-4% من السعر المرجعي). بعد التنفيذ وتأمين الصفقة عند +4.5%، يبدأ رفع الوقف آلياً مع متوسط EMA10 لحجز الأرباح.
                        </span>
                      ) : (
                        <span>
                          الاستراتيجية تتبع قاعدة <strong>ركوب الاتجاه دون سقف للأرباح (Run Winners)</strong>. مستوى الوقف المتحرك الحالي محدد عند <strong>{selectedActiveTrade.trailing_stop != null ? safeNum(selectedActiveTrade.trailing_stop).toFixed(2) : "—"} ج.م</strong> ويتبع يومياً المتوسط المتحرك الأسي 10 أيام (EMA10). تعتمد المحاكاة على الوقف المحفوظ وقواعد الخروج؛ السعر المعروض لا يؤكد تنفيذ أمر فعلي.
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Card 3: Breakeven Protection */}
                  <div className="border-2 border-black bg-sky-50 dark:bg-sky-950/20 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                      <h4 className="text-xs font-black uppercase text-sky-900 dark:text-sky-200">
                        بروتوكول حماية رأس المال (Breakeven Lock)
                      </h4>
                    </div>
                    <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 leading-relaxed">
                      {selectedActiveTrade.is_pending_entry ? (
                        <span>
                          ⏳ سيتم تفعيل تأمين رأس المال تلقائياً ورفع الوقف إلى سعر الشراء بمجرد تحقيق ربح +4.5% من سعر تنفيذ الافتتاح لتقليل المخاطر؛ فجوات السعر والانزلاق قد تؤدي إلى خسارة.
                        </span>
                      ) : selectedActiveTrade.is_breakeven_protected ? (
                        <span className="text-emerald-700 dark:text-emerald-300">
                          🛡️ <strong>تم تأمين الصفقة بنجاح:</strong> تجاوزت الصفقة ربح +4.5%، مما أدى آلياً لرفع الوقف إلى نقطة التعادل، مع استمرار مخاطر فجوات السعر والانزلاق عند التنفيذ.
                        </span>
                      ) : (
                        <span>
                          ⏳ الصفقة في مرحلة الصعود الأولى. سيتم رفع الوقف آلياً إلى سعر الدخول فور ملامسة ربح +4.5% لمنع تحول الأرباح إلى خسائر.
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t-2 border-black dark:border-white">
                  <Link
                    href={`/chart?symbol=${encodeURIComponent(selectedActiveTrade.symbol)}`}
                    className="h-10 px-5 border-2 border-black bg-black text-[#FFE600] font-black text-xs uppercase flex items-center justify-center gap-2 shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                  >
                    <BarChart2 className="w-4 h-4" />
                    <span>عرض الرسم البياني الحي للسهم (Chart)</span>
                  </Link>

                  <button
                    onClick={() => setSelectedActiveTrade(null)}
                    className="h-10 px-5 border-2 border-black bg-white hover:bg-zinc-100 text-black font-black text-xs uppercase shadow-[2px_2px_0px_#000] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                  >
                    إغلاق النافذة
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
