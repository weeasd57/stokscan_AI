"use client";

import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Loader2, Brain, Activity, UserPlus, Zap, Settings2, BarChart2, Calendar, Target, Clock, AlertTriangle, ChevronDown, Check, X, ShieldAlert, LineChart, FileText, Download, TrendingUp, Layers, Database, Play, EyeOff, UserMinus, Search, RefreshCw, ShieldCheck, HelpCircle, ArrowRightLeft, Lock, Volume2, VolumeX, Edit, Eye, Cpu, History, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getBacktests, getBacktestTrades } from "@/lib/api";
import { selectCanonicalModelCards } from "@/lib/models";
import { useLanguage } from "@/contexts/LanguageContext";
import StockLogo from "@/components/StockLogo";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { TradeTimeline } from "@/app/admin/components/TradeTimeline";
import TradingViewChart from "@/components/TradingViewChartDynamic";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import RecommendationsTable from "@/components/RecommendationsTable";
import TelegramServiceToggle from "@/components/TelegramServiceToggle";
import { 
    ResponsiveContainer, 
    LineChart as RechartsLineChart, 
    Line, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip as ChartTooltip, 
    ReferenceLine,
    BarChart,
    Bar,
    AreaChart,
    Area,
    Cell
} from "recharts";

// Helper component to fetch and display EGX30 comparison
const Egx30Comparison = ({ start, end, botReturn }: { start: string, end: string, botReturn: number }) => {
    const [egxReturn, setEgxReturn] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        setLoading(true);
        fetch(`/api/egx30/range?start=${start}&end=${end}`)
            .then(res => res.json())
            .then(data => {
                if (isMounted && data.return_pct !== undefined && data.return_pct !== null) {
                    setEgxReturn(data.return_pct);
                }
            })
            .catch(() => {})
            .finally(() => { if (isMounted) setLoading(false); });
        
        return () => { isMounted = false; };
    }, [start, end]);

    if (loading) return <span className="text-zinc-600 animate-pulse">vs EGX30: ...</span>;
    if (egxReturn === null) return null;

    const diff = botReturn - egxReturn;
    const isOutperforming = diff >= 0;

    return (
        <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border ${isOutperforming ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
            <span className="text-[8px] font-bold uppercase text-zinc-500">vs EGX30</span>
            <span className="font-black text-[9px]">{isOutperforming ? '+' : ''}{diff.toFixed(1)}%</span>
        </span>
    );
};

const getBacktestProfitPct = (
    backtest: {
        profit_pct?: number | null;
        pre_council_profit_pct?: number | null;
        post_council_profit_pct?: number | null;
        net_profit?: number | null;
    },
    stage: "pre" | "post" = "post"
) => {
    const directPct =
        stage === "pre"
            ? backtest.pre_council_profit_pct
            : backtest.post_council_profit_pct;

    if (directPct !== undefined && directPct !== null) {
        return Number(directPct);
    }

    if (backtest.profit_pct !== undefined && backtest.profit_pct !== null) {
        return Number(backtest.profit_pct) * 100;
    }

    if (backtest.net_profit !== undefined && backtest.net_profit !== null) {
        return (Number(backtest.net_profit) / 100000) * 100;
    }

    return null;
};

interface LocalModel {
    name: string;
    size_bytes: number;
    size_mb: number;
    created_at: string;
    modified_at: string;
    type: string;
    num_features?: number;
    num_parameters?: number;
    trainingSamples?: number;
    n_estimators?: number;
    num_trees?: number;
    exchange?: string;
    featurePreset?: string;
    bestIteration?: number;
    target_pct?: number;
    stop_loss_pct?: number;
    look_forward_days?: number;
    learning_rate?: number;
    uses_exchange_index_json?: boolean;
    exchange_index_json_path?: string;
    uses_fundamentals?: boolean;
    fundamentals_loaded?: boolean;
    has_meta_labeling?: boolean;
    precision?: number;
    recall?: number;
    f1?: number;
    auc?: number;
}


interface Bot {
    bot_id: string;
    name: string;
    status: "running" | "stopped";
    user_id: string;
    poll_seconds: number;
    max_open_positions: number;
    active_positions_count: number;
    total_pnl: number;
    win_rate: number;
    trades_count: number;
    is_subscribed?: boolean;
    subscription_telegram_chat_id?: string | null;
    subscription_notifications_enabled?: boolean;
    timeframe?: string;
    target_pct?: number;
    stop_loss_pct?: number;
    use_council?: boolean;
    council_threshold?: number;
    king_threshold?: number;
    king_model_path?: string;
    council_model_path?: string;
    trading_mode?: string;
    started_at?: string;
}

interface Backtest {
    id: string;
    model_name: string;
    exchange: string;
    start_date: string;
    end_date: string;
    total_trades: number;
    win_rate: number;
    net_profit: number;
    avg_return_per_trade: number;
    trades_log: any;
    status: string;
    status_msg: string;
    meta_threshold?: number;
    created_at: string;
    is_public?: boolean;
    pre_council_trades?: number;
    pre_council_win_rate?: number;
    pre_council_profit_pct?: number;
    post_council_trades?: number;
    post_council_win_rate?: number;
    post_council_profit_pct?: number;
    profit_pct?: number;
    rejected_profitable_trades?: number;
    target_pct?: number;
    stop_loss_pct?: number;
    council_model?: string;
    council_threshold?: number;
}

const getActualRange = (trades: any[]) => {
    if (!trades || trades.length === 0) return null;
    const dates = trades
      .map((t: any) => t.features?.entry_date || t.features?.trade_date || t.Entry_Date || t.created_at)
      .filter(Boolean)
      .map((d: any) => new Date(d))
      .filter((d: Date) => Number.isFinite(d.getTime()));
    if (dates.length === 0) return null;
    dates.sort((a, b) => a.getTime() - b.getTime());
    
    return {
        start: dates[0].toISOString().split('T')[0],
        end: dates[dates.length - 1].toISOString().split('T')[0],
        days: Math.max(1, Math.ceil((dates[dates.length - 1].getTime() - dates[0].getTime()) / (1000 * 60 * 60 * 24)))
    };
};

/** Match admin BacktestTab: profit_loss_pct from API is already in percent (e.g. 5 = 5%). */
const getTradeProfitPct = (trade: any): number => {
    if (trade.profit_loss_pct !== undefined && trade.profit_loss_pct !== null && !Number.isNaN(Number(trade.profit_loss_pct))) {
        return Number(trade.profit_loss_pct);
    }
    if (trade.profit_percent !== undefined && trade.profit_percent !== null && !Number.isNaN(Number(trade.profit_percent))) {
        return Number(trade.profit_percent);
    }
    if (trade.Profit_Loss_Pct !== undefined && trade.Profit_Loss_Pct !== null && !Number.isNaN(Number(trade.Profit_Loss_Pct))) {
        return Number(trade.Profit_Loss_Pct);
    }
    if (trade.pnl_pct !== undefined && trade.pnl_pct !== null && !Number.isNaN(Number(trade.pnl_pct))) {
        const n = Number(trade.pnl_pct);
        return Math.abs(n) <= 1 ? n * 100 : n;
    }
    const entryP = Number(trade.Entry_Price || trade.entry_price || trade.entry || 0);
    const exitP = Number(trade.Exit_Price || trade.exit_price || trade.exit || 0);
    if (entryP > 0 && exitP > 0) {
        return ((exitP - entryP) / entryP) * 100;
    }
    const raw = Number(trade.pnl ?? trade.profit ?? 0);
    return Math.abs(raw) <= 1 ? raw * 100 : raw;
};

const CouncilAuditPanel = ({ bt }: { bt: any }) => {
  const { t } = useLanguage();
  const rejectedProfitable = bt.rejected_profitable_trades || 0;
  const postWinRate = bt.post_council_win_rate || bt.win_rate || 0;
  const preWinRate = bt.pre_council_win_rate || bt.win_rate || 0;
  const winRateImprovement = postWinRate - preWinRate;

  return (
    <div className="mt-6 p-6 rounded-2xl bg-red-500/5 border border-red-500/20 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <h4 className="text-sm font-black text-white uppercase tracking-wider">{t("backtest.audit.title")}</h4>
        </div>
        <div className="px-3 py-1 rounded-full bg-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-tighter">
          {t("backtest.audit.killed").replace("{count}", rejectedProfitable.toString())}
        </div>
      </div>

      <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl">
        {t("backtest.audit.desc").replace("{count}", rejectedProfitable.toString())}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
        <div className="p-4 rounded-xl bg-zinc-900/40 border border-white/5 space-y-2">
          <span className="text-[10px] font-bold text-zinc-500 uppercase">{t("backtest.audit.suspicious")}</span>
          <div className="text-sm font-black text-white">{t("backtest.audit.suspicious_val")}</div>
          <div className="text-[9px] text-zinc-500">{t("backtest.audit.suspicious_desc")}</div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900/40 border border-white/5 space-y-2">
          <span className="text-[10px] font-bold text-zinc-500 uppercase">{t("backtest.audit.impact")}</span>
          <div className="text-sm font-black text-emerald-400">+{winRateImprovement.toFixed(1)}% {t("bots.table.winrate")}</div>
          <div className="text-[9px] text-zinc-500">{t("backtest.audit.impact_desc")}</div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900/40 border border-white/5 space-y-2">
          <span className="text-[10px] font-bold text-zinc-500 uppercase">{t("backtest.audit.action")}</span>
          <div className="text-sm font-black text-indigo-400">{t("backtest.audit.action_refine")}</div>
          <div className="text-[9px] text-zinc-500">{t("backtest.audit.action_desc")}</div>
        </div>
      </div>
    </div>
  );
};

const getBacktestSettings = (bt: Backtest) => {
    let target = bt.target_pct;
    let sl = bt.stop_loss_pct;

    // If not defined at top level, try to parse from trades_log (trials)
    if (target === undefined || sl === undefined) {
        try {
            const logs = typeof bt.trades_log === "string" ? JSON.parse(bt.trades_log) : bt.trades_log;
            if (Array.isArray(logs) && logs.length > 0) {
                const first = logs[0];
                const rawT = first.target_percent ?? first.target_pct ?? first.target;
                const rawS = first.stop_loss_percent ?? first.stop_loss_pct ?? first.stop_loss;
                
                if (rawT !== undefined && rawT !== null && !isNaN(Number(rawT))) {
                    const tVal = Number(rawT);
                    target = tVal > 1 ? tVal / 100 : tVal;
                }
                if (rawS !== undefined && rawS !== null && !isNaN(Number(rawS))) {
                    const sVal = Number(rawS);
                    sl = sVal > 1 ? sVal / 100 : sVal;
                }
            }
        } catch {}
    }

    return {
        target: target !== undefined && target !== null ? Math.round(target * 100) : null,
        stopLoss: sl !== undefined && sl !== null ? Math.round(sl * 100) : null,
    };
};

// ── Telegram Notification Card ──────────────────────────────────────────
function TelegramNotificationCard() {
    const { user } = useAuth();
    const { language } = useLanguage();
    const isAr = language === "ar";
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    const [telegramLinked, setTelegramLinked] = useState(false);
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(false);
    const [chatId, setChatId] = useState<string | null>(null);

    useEffect(() => {
        if (!user) { setLoading(false); return; }
        let active = true;
        async function load() {
            try {
                const { data: profile } = await supabase
                    .from("profiles")
                    .select("telegram_chat_id")
                    .eq("id", user!.id)
                    .maybeSingle();

                if (active && profile?.telegram_chat_id) {
                    setTelegramLinked(true);
                    setChatId(profile.telegram_chat_id);
                }

                // Check if user has any active bot subscriptions with notifications
                const { data: subs } = await supabase
                    .from("bot_subscriptions")
                    .select("notifications_enabled")
                    .eq("user_id", user!.id)
                    .limit(1);

                if (active && subs && subs.length > 0) {
                    setNotificationsEnabled(subs[0].notifications_enabled ?? true);
                }
            } catch (e) {
                console.error("TelegramCard load error:", e);
            } finally {
                if (active) setLoading(false);
            }
        }
        load();
        return () => { active = false; };
    }, [user, supabase]);

    const toggleNotifications = async () => {
        if (!user || toggling) return;
        setToggling(true);
        const newState = !notificationsEnabled;
        try {
            // Upsert into bot_subscriptions
            const { data: existing } = await supabase
                .from("bot_subscriptions")
                .select("id")
                .eq("user_id", user.id)
                .limit(1);

            if (existing && existing.length > 0) {
                await supabase
                    .from("bot_subscriptions")
                    .update({ notifications_enabled: newState })
                    .eq("user_id", user.id);
            } else {
                // Create a default subscription entry
                await supabase
                    .from("bot_subscriptions")
                    .insert({
                        user_id: user.id,
                        bot_id: "stock_score",
                        notifications_enabled: newState,
                        created_at: new Date().toISOString(),
                    });
            }
            setNotificationsEnabled(newState);
        } catch (e) {
            console.error("Toggle notifications error:", e);
        } finally {
            setToggling(false);
        }
    };

    const connectTelegram = () => {
        const botUsername = "EGXBotsBot"; // Your bot username
        const userId = user?.id || "";
        const deepLink = `https://t.me/${botUsername}?start=${userId}`;
        window.open(deepLink, "_blank");
    };

    if (loading) {
        return (
            <div className="border-4 border-black dark:border-white bg-zinc-950 p-4 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] animate-pulse">
                <div className="h-6 w-48 bg-zinc-800 rounded" />
            </div>
        );
    }

    return (
        <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)]">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${telegramLinked ? 'bg-sky-500/20 border-sky-500/30' : 'bg-zinc-800 border-zinc-700'}`}>
                        {telegramLinked ? (
                            <svg className="w-5 h-5 text-sky-400" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.46-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.441-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.119.098.152.228.168.32.016.092.036.301.02.466z"/>
                            </svg>
                        ) : (
                            <svg className="w-5 h-5 text-zinc-500" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.46-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.441-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.119.098.152.228.168.32.016.092.036.301.02.466z"/>
                            </svg>
                        )}
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-tight">
                            {isAr ? "إشعارات تليجرام" : "Telegram Alerts"}
                        </h3>
                        <p className="text-[10px] text-zinc-400 font-medium">
                            {telegramLinked
                                ? (isAr ? "✅ الحساب مربوط - استلم إشعارات فورية" : "✅ Account linked — receive instant alerts")
                                : (isAr ? "اربط تليجرام لاستلام إشعارات فورية" : "Connect Telegram for instant alerts")
                            }
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {!telegramLinked ? (
                        <button
                            onClick={connectTelegram}
                            className="h-9 px-4 border-2 border-sky-500 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 font-bold uppercase text-xs flex items-center gap-2 shadow-[2px_2px_0px_rgba(14,165,233,0.3)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all duration-100"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.46-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.441-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.141.119.098.152.228.168.32.016.092.036.301.02.466z"/>
                            </svg>
                            {isAr ? "ربط تليجرام" : "Connect Telegram"}
                        </button>
                    ) : (
                        <>
                            {/* Notification Toggle */}
                            <button
                                onClick={toggleNotifications}
                                disabled={toggling}
                                className={`relative h-9 w-16 rounded-full border-2 transition-all duration-200 ${
                                    notificationsEnabled
                                        ? 'bg-emerald-500/20 border-emerald-500'
                                        : 'bg-zinc-800 border-zinc-600'
                                }`}
                            >
                                <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                                    notificationsEnabled ? 'right-1' : 'left-1'
                                }`} />
                            </button>
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                                {notificationsEnabled
                                    ? (isAr ? "مفعل" : "ON")
                                    : (isAr ? "معطل" : "OFF")
                                }
                            </span>
                        </>
                    )}
                </div>
            </div>

            {/* Info about what notifications include */}
            {telegramLinked && notificationsEnabled && (
                <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                        { icon: "🟢", textAr: "إشارات شراء جديدة", textEn: "New Buy Signals" },
                        { icon: "🎯", textAr: "تعديل الأهداف السعرية", textEn: "Target Adjustments" },
                        { icon: "🛡️", textAr: "تنبيهات وقف الخسارة", textEn: "Stop Loss Alerts" },
                    ].map((item, i) => (
                        <div key={i} className="flex items-center gap-2 text-[10px] font-bold text-zinc-400">
                            <span className="text-sm">{item.icon}</span>
                            <span>{isAr ? item.textAr : item.textEn}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function AIScannerPage() {
    const { user } = useAuth();
    const { t, language } = useLanguage();
    const searchParams = useSearchParams();
    const tabParam = searchParams.get("tab");
    const activeTab = tabParam === "backtests" ? "backtests" : tabParam === "similarity" ? "similarity" : "bots";

    // States for Similarity tab
    const [publishedReport, setPublishedReport] = useState<any | null>(null);
    const [similarityLoading, setSimilarityLoading] = useState(false);
    const [selectedSimilarityScan, setSelectedSimilarityScan] = useState<any | null>(null);

    // SaaS Subscription State
    const [isPro, setIsPro] = useState(false);
    const supabase = useMemo(() => createSupabaseBrowserClient(), []);

    useEffect(() => {
        let active = true;
        async function checkSubscription() {
            if (!user) {
                setIsPro(false);
                return;
            }
            try {
                const { data: sub } = await supabase
                    .from("subscriptions")
                    .select("plan_id, status")
                    .eq("user_id", user.id)
                    .maybeSingle();
                
                if (active && sub) {
                    const planId = (sub.plan_id || "").toLowerCase();
                    const status = (sub.status || "").toLowerCase();
                    if (planId === "pro" && (status === "active" || status === "trialing")) {
                        setIsPro(true);
                        return;
                    }
                }
                if (active) setIsPro(false);
            } catch (err) {
                console.error("Failed to check user SaaS subscription:", err);
            }
        }
        void checkSubscription();
        return () => { active = false; };
    }, [user, supabase]);
    
    // States for Bots tab
    const [bots, setBots] = useState<Bot[]>([]);
    const [botsLoading, setBotsLoading] = useState(true);
    const [botsError, setBotsError] = useState<string | null>(null);
    const [submittingBotId, setSubmittingBotId] = useState<string | null>(null);

    // States for Backtests tab
    const [backtests, setBacktests] = useState<Backtest[]>([]);
    const [backtestsLoading, setBacktestsLoading] = useState(true);
    const [backtestsError, setBacktestsError] = useState<string | null>(null);
    const [expandedBacktestId, setExpandedBacktestId] = useState<string | null>(null);
    const [expandedTabMap, setExpandedTabMap] = useState<Record<string, "summary" | "trades" | "chart">>({}); 
    const [expandedFilteredMap, setExpandedFilteredMap] = useState<Record<string, boolean>>({});
    const [loadedTrades, setLoadedTrades] = useState<Record<string, any[]>>({});
    const [tradesLoadingMap, setTradesLoadingMap] = useState<Record<string, boolean>>({});

    const [selectedTrade, setSelectedTrade] = useState<any | null>(null);

    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        if (!selectedTrade) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prev;
        };
    }, [selectedTrade]);

    const [selectedMetric, setSelectedMetric] = useState<"netProfit" | "winRate" | "avgReturn">("netProfit");

    const symbolTrades = useMemo(() => {
        if (!selectedTrade || !expandedBacktestId) return [];
        const trades = loadedTrades[expandedBacktestId] ?? [];
        return trades.filter((x: any) => (x.symbol || x.Symbol || x.features?.symbol)?.toUpperCase() === selectedTrade.symbol?.toUpperCase() || (x.symbol || x.Symbol || x.features?.symbol)?.toUpperCase() === (selectedTrade.Symbol || selectedTrade.features?.symbol)?.toUpperCase());
    }, [loadedTrades, selectedTrade, expandedBacktestId]);

    const currentSymbolTradeIndex = useMemo(() => {
        if (!selectedTrade || symbolTrades.length === 0) return -1;
        const currentEntryDate = selectedTrade.features?.entry_date || selectedTrade.Entry_Date || selectedTrade.entry_date || selectedTrade.features?.trade_date || selectedTrade.date;
        const currentEntryPrice = selectedTrade.entry_price ?? selectedTrade.entry;
        return symbolTrades.findIndex((t: any) => {
            const entryDate = t.features?.entry_date || t.Entry_Date || t.entry_date || t.features?.trade_date || t.date;
            const entryPrice = t.entry_price ?? t.entry;
            return entryDate === currentEntryDate && entryPrice === currentEntryPrice;
        });
    }, [symbolTrades, selectedTrade]);

    const formatDate = (raw: string | undefined): string => {
        if (!raw) return '—';
        try {
            return new Date(raw).toLocaleDateString(language === "ar" ? "ar-EG" : "en-US", {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch { return '—'; }
    };

    // Filters and Sorting states for Backtests tab
    const [backtestSearchQuery, setBacktestSearchQuery] = useState("");
    const [backtestModelFilter, setBacktestModelFilter] = useState("All");
    const [backtestSortBy, setBacktestSortBy] = useState("date"); // "date" | "net_profit" | "win_rate" | "total_trades"
    const [backtestSortOrder, setBacktestSortOrder] = useState<"asc" | "desc">("desc");

    const handleToggleExpand = async (btId: string) => {
        if (expandedBacktestId === btId) {
            setExpandedBacktestId(null);
        } else {
            setExpandedBacktestId(btId);
            if (!loadedTrades[btId]) {
                setTradesLoadingMap(prev => ({ ...prev, [btId]: true }));
                try {
                    const tradesData = await getBacktestTrades(btId);
                    setLoadedTrades(prev => ({ ...prev, [btId]: tradesData }));
                } catch (err) {
                    console.error("Failed to load backtest trades:", err);
                } finally {
                    setTradesLoadingMap(prev => ({ ...prev, [btId]: false }));
                }
            }
        }
    };

    // States for Model Cards
    const [modelCards, setModelCards] = useState<LocalModel[]>([]);
    const [modelsLoading, setModelsLoading] = useState(true);
    const [modelsError, setModelsError] = useState<string | null>(null);

    // Subscriptions count helper
    const activeSubCount = useMemo(() => {
        return bots.filter(b => b.is_subscribed).length;
    }, [bots]);

    // Filtered bots (just all bots for now)
    const filteredBots = useMemo(() => bots, [bots]);

    // Fetch Bots
    const fetchBotsList = async () => {
        setBotsLoading(true);
        setBotsError(null);
        try {
            const url = user?.id ? `/api/ai_bot/list?user_id=${user.id}` : "/api/ai_bot/list";
            const res = await fetch(url);
            if (!res.ok) throw new Error("Failed to fetch AI bots");
            const data = await res.json();
            setBots(data.bots || []);
        } catch (err: any) {
            setBotsError(err.message || "An error occurred while loading bots.");
        } finally {
            setBotsLoading(false);
        }
    };

    // Fetch Model Cards
    const fetchModelCards = async () => {
        setModelsLoading(true);
        setModelsError(null);
        try {
            const res = await fetch("/api/ai_bot/model_cards");
            if (!res.ok) throw new Error("Failed to fetch model cards");
            const data = await res.json();
            // Filter out crypto & validator models
            const filtered = selectCanonicalModelCards(
                (data || []).filter((m: any) => {
                    const name = (m.name || m.model_name || "").toUpperCase();
                    const ex = (m.exchange || "").toUpperCase();
                    if (name.includes("CRYPTO") || ex === "CRYPTO") return false;
                    if (name.includes("COUNCIL") || name.includes("VALIDATOR") || name.includes("ADVISOR")) return false;
                    if (m.model_type === "council_validator") return false;
                    return true;
                })
            );
            setModelCards(filtered as unknown as LocalModel[]);
        } catch (err: any) {
            setModelsError(err.message || "An error occurred while loading model cards.");
        } finally {
            setModelsLoading(false);
        }
    };

    // Fetch Backtests
    const fetchBacktestsList = async () => {
        setBacktestsLoading(true);
        setBacktestsError(null);
        try {
            const data = await getBacktests();
            setBacktests(data || []);
        } catch (err: any) {
            setBacktestsError(err.message || "An error occurred while loading backtests.");
        } finally {
            setBacktestsLoading(false);
        }
    };

    useEffect(() => {
        fetchBotsList();
        fetchModelCards();
        fetchBacktestsList();
    }, [user?.id]);

    useEffect(() => {
        if (activeTab === "similarity") {
            setSimilarityLoading(true);
            fetch("/api/scan/similarity/published")
                .then(res => res.json())
                .then(data => {
                    setPublishedReport(data);
                    if (data?.scans && data.scans.length > 0) {
                        setSelectedSimilarityScan(data.scans[0]);
                    }
                })
                .catch(err => console.error("Error loading published report:", err))
                .finally(() => setSimilarityLoading(false));
        }
    }, [activeTab]);

    const transformSimilarityChartData = (scan: any) => {
        if (!scan || !scan.matches) return [];

        const forwardDays = publishedReport?.forward_days || 10;
        const daysMap: { [key: number]: any } = {};
        for (let d = -9; d <= forwardDays; d++) {
            daysMap[d] = { day: d, dayLabel: d <= 0 ? `T${d}` : `T+${d}` };
        }

        if (scan.target_path) {
            scan.target_path.forEach((p: any, idx: number) => {
                const day = idx - 9;
                if (daysMap[day]) {
                    daysMap[day]["Target"] = p.rel_change * 100.0;
                }
            });
        }

        const activeMatches = scan.matches.slice(0, 5);
        activeMatches.forEach((m: any, matchIdx: number) => {
            const label = `Match_${matchIdx + 1}_${m.date}`;
            if (m.before_path) {
                m.before_path.forEach((p: any, idx: number) => {
                    const day = idx - 9;
                    if (daysMap[day]) {
                        daysMap[day][label] = p.rel_change * 100.0;
                    }
                });
            }
            if (m.forward_path) {
                m.forward_path.forEach((p: any) => {
                    const day = p.day;
                    if (daysMap[day]) {
                        daysMap[day][label] = p.return * 100.0;
                    }
                });
            }
        });

        for (let d = -9; d <= forwardDays; d++) {
            let sum = 0.0;
            let count = 0;
            activeMatches.forEach((m: any, matchIdx: number) => {
                const label = `Match_${matchIdx + 1}_${m.date}`;
                if (daysMap[d][label] !== undefined) {
                    sum += daysMap[d][label];
                    count++;
                }
            });
            if (count > 0) {
                daysMap[d]["Average"] = sum / count;
            }
        }

        return Object.values(daysMap).sort((a: any, b: any) => a.day - b.day);
    };

    const similarityDashboard = useMemo(() => {
        const scans = publishedReport?.scans || [];
        const selectedMatches = selectedSimilarityScan?.matches || [];
        const rankedSetups = scans
            .map((scan: any) => ({
                symbol: scan.symbol,
                winRate: (scan.stats?.win_rate || 0) * 100,
                avgReturn: (scan.stats?.average_return || 0) * 100,
                expectedEdge: (scan.stats?.expected_value || 0) * 100,
                profitFactor: scan.stats?.profit_factor || 0,
                matches: scan.stats?.total_matches || scan.matches?.length || 0,
            }))
            .sort((a: any, b: any) => b.expectedEdge - a.expectedEdge)
            .slice(0, 8);

        const outcomeData = [
            { name: language === "ar" ? "رابحة" : "Wins", value: selectedSimilarityScan?.stats?.wins || 0, fill: "#10b981" },
            { name: language === "ar" ? "خاسرة" : "Losses", value: selectedSimilarityScan?.stats?.losses || 0, fill: "#ef4444" },
        ];

        const matchQuality = selectedMatches.slice(0, 10).map((match: any, idx: number) => ({
            name: `${idx + 1}`,
            date: match.date,
            similarity: (match.similarity || 0) * 100,
            finalReturn: (match.final_return || 0) * 100,
            mfe: (match.mfe || 0) * 100,
            mae: (match.mae || 0) * 100,
        }));

        const strongestSetup = rankedSetups[0];
        const avgWinRate = scans.length
            ? scans.reduce((sum: number, scan: any) => sum + ((scan.stats?.win_rate || 0) * 100), 0) / scans.length
            : 0;
        const avgExpectedEdge = scans.length
            ? scans.reduce((sum: number, scan: any) => sum + ((scan.stats?.expected_value || 0) * 100), 0) / scans.length
            : 0;

        return { rankedSetups, outcomeData, matchQuality, strongestSetup, avgWinRate, avgExpectedEdge };
    }, [publishedReport, selectedSimilarityScan, language]);


    // Handle Subscribe
    const handleSubscribe = async (botId: string) => {
        if (!user) return;
        if (!isPro && activeSubCount >= 2) {
            alert(language === "ar"
                ? "لقد وصلت للحد الأقصى للاشتراك في البوتات (2 بوت بحد أقصى في الخطة المجانية). يرجى الترقية إلى الخطة الاحترافية (Pro) للحصول على بوتات غير محدودة."
                : "You have reached the maximum subscription limit (Max 2 bots in the free plan). Please upgrade to Pro for unlimited bots.");
            return;
        }
        setSubmittingBotId(botId);
        try {
            const res = await fetch("/api/ai_bot/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bot_id: botId, user_id: user.id }),
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || "Failed to subscribe");
            }
            // Refresh list
            await fetchBotsList();
        } catch (err: any) {
            alert(err.message || "Subscription failed.");
        } finally {
            setSubmittingBotId(null);
        }
    };

    // Handle Unsubscribe
    const handleUnsubscribe = async (botId: string) => {
        if (!user) return;
        if (!confirm("Are you sure you want to unsubscribe from this bot?")) return;
        setSubmittingBotId(botId);
        try {
            const res = await fetch("/api/ai_bot/unsubscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ bot_id: botId, user_id: user.id }),
            });
            if (!res.ok) throw new Error("Failed to unsubscribe");
            // Refresh list
            await fetchBotsList();
        } catch (err: any) {
            alert(err.message || "Unsubscription failed.");
        } finally {
            setSubmittingBotId(null);
        }
    };

    // Unique model names in Egypt backtests for the filter dropdown
    const uniqueBacktestModels = useMemo(() => {
        const models = new Set<string>();
        backtests.forEach(b => {
            const ex = b.exchange?.toUpperCase();
            const isEgypt = (b.is_public === true) && (ex === "EGX" || ex === "EG" || ex === "CA");
            if (isEgypt && b.model_name) {
                models.add(b.model_name.replace(".pkl", ""));
            }
        });
        return Array.from(models).sort();
    }, [backtests]);

    // Filtered and Sorted Backtests - ONLY Egypt (EGX)
    const egxBacktests = useMemo(() => {
        let list = backtests.filter(b => {
            const ex = b.exchange?.toUpperCase();
            const isEgypt = (b.is_public === true) && (ex === "EGX" || ex === "EG" || ex === "CA");
            if (!isEgypt) return false;

            // Model Filter
            if (backtestModelFilter !== "All") {
                const name = b.model_name?.replace(".pkl", "") || "";
                if (name !== backtestModelFilter) return false;
            }

            // Search Query
            if (backtestSearchQuery) {
                const q = backtestSearchQuery.toLowerCase();
                const name = (b.model_name || "").toLowerCase();
                const id = (b.id || "").toLowerCase();
                if (!name.includes(q) && !id.includes(q)) return false;
            }

            return true;
        });

        // Sorting
        list.sort((a, b) => {
            let valA: any = 0;
            let valB: any = 0;

            if (backtestSortBy === "net_profit") {
                valA = getBacktestProfitPct(a, "post") ?? 0;
                valB = getBacktestProfitPct(b, "post") ?? 0;
            } else if (backtestSortBy === "win_rate") {
                valA = a.win_rate ?? 0;
                valB = b.win_rate ?? 0;
            } else if (backtestSortBy === "total_trades") {
                valA = a.total_trades ?? 0;
                valB = b.total_trades ?? 0;
            } else if (backtestSortBy === "date") {
                valA = new Date(a.created_at || 0).getTime();
                valB = new Date(b.created_at || 0).getTime();
            }

            if (valA < valB) return backtestSortOrder === "desc" ? 1 : -1;
            if (valA > valB) return backtestSortOrder === "desc" ? -1 : 1;
            return 0;
        });

        return list;
    }, [backtests, backtestModelFilter, backtestSearchQuery, backtestSortBy, backtestSortOrder]);

    const modelStats = useMemo(() => {
        const stats: Record<string, {
            modelName: string;
            totalRuns: number;
            totalTrades: number;
            totalWinRate: number;
            totalProfitPct: number;
            totalWeightedReturn: number;
        }> = {};

        backtests.forEach(b => {
            const ex = b.exchange?.toUpperCase();
            const isEgypt = (b.is_public === true) && (ex === "EGX" || ex === "EG" || ex === "CA");
            if (!isEgypt) return;

            // Normalize model name: strip file extension and any parenthetical suffixes like "(2022-Stress)", "(Adaptive)"
            const rawName = (b.model_name || "")
                .replace(/\.pkl$/i, "")
                .replace(/\s*\(.*?\)\s*/g, "")  // remove (anything) suffixes
                .trim();

            const nameUpper = rawName.toUpperCase();
            let groupKey = "";
            if (nameUpper.includes("KING")) {
                groupKey = "KING";
            } else if (nameUpper.includes("NANO") || nameUpper.includes("NEW_MODEL")) {
                groupKey = "NANO";
            } else if (nameUpper.includes("THE BOT") || nameUpper === "BOT") {
                groupKey = "THE BOT";
            } else if (nameUpper.includes("MODEL_EGX") || nameUpper.includes("MODEL EGX")) {
                groupKey = "MODEL_EGX";
            } else {
                groupKey = nameUpper;
            }

            if (!stats[groupKey]) {
                stats[groupKey] = {
                    modelName: groupKey,
                    totalRuns: 0,
                    totalTrades: 0,
                    totalWinRate: 0,
                    totalProfitPct: 0,
                    totalWeightedReturn: 0
                };
            }

            const profitPctValue = getBacktestProfitPct(b, "post");
            const winRate = b.win_rate ?? 0;
            const trades = b.total_trades ?? 0;
            const avgReturn = b.avg_return_per_trade ?? 0;

            const entry = stats[groupKey];
            entry.totalRuns += 1;
            entry.totalTrades += trades;
            entry.totalWinRate += winRate;
            if (profitPctValue !== null) entry.totalProfitPct += profitPctValue;
            entry.totalWeightedReturn += avgReturn * trades;
        });

        return Object.values(stats).map(s => {
            const avgWinRate = s.totalRuns > 0 ? s.totalWinRate / s.totalRuns : 0;
            const avgProfitPct = s.totalRuns > 0 ? s.totalProfitPct / s.totalRuns : 0;
            const avgReturnPerTrade = s.totalTrades > 0 ? s.totalWeightedReturn / s.totalTrades : 0;

            return {
                modelName: s.modelName,
                totalRuns: s.totalRuns,
                totalTrades: s.totalTrades,
                winRate: avgWinRate,
                netProfit: avgProfitPct,
                avgReturnPerTrade: avgReturnPerTrade,
            };
        }).sort((a, b) => {
            const order: Record<string, number> = { "KING": 1, "NANO": 2, "THE BOT": 3 };
            const orderA = order[a.modelName] ?? 99;
            const orderB = order[b.modelName] ?? 99;
            return orderA - orderB;
        });
    }, [backtests]);

    const chartData = useMemo(() => {
        const fallbacks = ["#a855f7", "#ec4899", "#3b82f6", "#f43f5e", "#06b6d4"];
        return modelStats.map((s, idx) => {
            let fill = "#6366f1"; // Default Indigo
            if (s.modelName === "KING") fill = "#f59e0b"; // Amber
            else if (s.modelName === "THE BOT") fill = "#10b981"; // Emerald
            else if (s.modelName !== "NANO") {
                fill = fallbacks[idx % fallbacks.length];
            }

            let name = s.modelName;
            if (s.modelName === "KING") {
                name = language === "ar" ? "موديل KING الملكي" : "KING Model";
            } else if (s.modelName === "NANO") {
                name = language === "ar" ? "موديل NANO الذكي" : "NANO Model";
            } else if (s.modelName === "THE BOT") {
                name = language === "ar" ? "موديل THE BOT" : "THE BOT Model";
            }

            return {
                name,
                value: selectedMetric === "netProfit" ? s.netProfit : selectedMetric === "winRate" ? s.winRate : s.avgReturnPerTrade,
                fill,
            };
        });
    }, [modelStats, selectedMetric, language]);

    const formatNum = (val: number | undefined | null, decimals = 2) => {
        if (val === undefined || val === null || isNaN(val)) return "0.00";
        return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };

    const formatPct = (val: number | undefined | null, precision = 1) => {
        if (val === undefined || val === null || isNaN(val)) return "—";
        const n = Number(val);
        if (n === 0) return "0.0%";
        if (Math.abs(n) < 0.05) return `${n.toFixed(4)}%`;
        return `${n.toFixed(precision)}%`;
    };

    const parseTradesLog = (tradesLog: any) => {
        let list: any[] = [];
        try {
            list = typeof tradesLog === "string" ? JSON.parse(tradesLog) : (tradesLog || []);
        } catch (e) {
            list = [];
        }
        return Array.isArray(list) ? list : [];
    };

    return (
        <div className="backtests-shell app-page-shell mx-auto max-w-[1400px] w-full px-4 py-8 md:px-6 md:py-12 mt-2 min-h-[calc(100vh-200px)]">
            {/* Header Banner */}
            <div className="backtests-hero relative overflow-hidden rounded-none border-4 border-black dark:border-white bg-[#FFE600] dark:bg-[#FFE600] text-black dark:text-white p-8 md:p-12 mb-10 shadow-[6px_6px_0px_0px_#000000] dark:shadow-[6px_6px_0px_0px_#ffffff]">
                <div className="absolute top-1/2 -translate-y-1/2 right-12 opacity-15 pointer-events-none hidden md:block">
                    <Image
                        src="/favicon_io/apple-touch-icon.png?v=2"
                        alt="EGX Bots logo"
                        width={200}
                        height={200}
                        className="object-contain filter grayscale brightness-0"
                    />
                </div>
                <div className="relative z-10 max-w-2xl space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-none bg-black dark:bg-black border-2 border-black dark:border-black text-[#FFE600] dark:text-[#FFE600] text-xs font-black uppercase tracking-wider">
                        <Sparkles className="w-3.5 h-3.5" /> {activeTab === "backtests" ? t("backtest.model_evaluation") : activeTab === "similarity" ? (language === "ar" ? "تحليل الأنماط التاريخية" : "HISTORICAL PATTERN MATCHING") : (language === "ar" ? "ترتيب السوق اليوم" : "TODAY'S MARKET RANKING")}
                    </div>
                    <h1 className="text-3xl md:text-5xl font-black text-black dark:text-white tracking-tight leading-none uppercase">
                        {activeTab === "backtests" ? (
                            language === "ar" ? (
                                <>نتائج الاختبار العكسي</>
                            ) : (
                                <>Backtest Results</>
                            )
                        ) : activeTab === "similarity" ? (
                            language === "ar" ? (
                                <>النماذج المتكررة (شبه ده)</>
                            ) : (
                                <>Historical Similarity</>
                            )
                        ) : (
                            language === "ar" ? (
                                <>أفضل الأسهم الشعبية تصنيفاً</>
                            ) : (
                                <>Top Ranked Popular Stocks</>
                            )
                        )}
                    </h1>
                    <p className="text-black/80 dark:text-white/80 font-mono text-xs md:text-sm leading-relaxed">
                        {activeTab === "backtests"
                            ? t("backtest.subtitle")
                            : activeTab === "similarity"
                            ? (language === "ar" ? "حالات تاريخية متكررة في البورصة تتطابق مع التكوين الحالي للأسهم بنسب نجاح مرتفعة." : "Historical patterns that closely match the current setups of stocks with high win rates.")
                            : t("bots.banner_desc")}
                    </p>
                </div>
            </div>

            {/* TAB CONTENT: BOTS */}
            {activeTab === "bots" && (
                <div className="space-y-6">
                    {/* ── Telegram Notification Card ── */}
                    {user && <TelegramNotificationCard />}
                    <RecommendationsTable />
                </div>
            )}

            {/* TAB CONTENT: HISTORICAL SIMILARITY */}
            {activeTab === "similarity" && (
                <div className="space-y-8 animate-in fade-in duration-300" dir="ltr" style={{ direction: 'ltr' }}>
                    <TelegramServiceToggle
                        serviceType="historical_similarity"
                        botId="historical_similarity"
                    />
                    {similarityLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                            <p className="text-xs font-mono text-zinc-500">Loading similarity report...</p>
                        </div>
                    ) : !publishedReport || !publishedReport.scans || publishedReport.scans.length === 0 ? (
                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-16 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] flex flex-col items-center justify-center gap-6 text-center">
                            <Activity className="w-12 h-12 text-zinc-600" />
                            <div className="space-y-2">
                                <h3 className="text-base font-black text-zinc-300 uppercase tracking-widest">No Active Similarity Signals</h3>
                                <p className="text-xs text-zinc-500 font-semibold max-w-md">
                                    There are no active published similarity setups at this time. Check back later for update reports.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                            {/* Left Column: Tickers List (4 cols) */}
                            <div className="lg:col-span-4 space-y-4">
                                <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                                    <h3 className="text-xs font-black tracking-widest text-zinc-400 uppercase mb-4 flex justify-between items-center font-mono">
                                        <span>Published Setups</span>
                                        <span className="text-[9px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 font-bold uppercase">
                                            {publishedReport.scans.length} Stocks
                                        </span>
                                    </h3>

                                    <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                                        {publishedReport.scans.map((scan: any) => {
                                            const isSelected = selectedSimilarityScan?.symbol === scan.symbol;
                                            return (
                                                <div
                                                    key={scan.symbol}
                                                    onClick={() => setSelectedSimilarityScan(scan)}
                                                    className={`p-3.5 border-2 transition-all cursor-pointer flex items-center justify-between ${
                                                        isSelected ? "border-amber-400 bg-zinc-900" : "border-zinc-800 bg-zinc-950 hover:bg-zinc-900/40"
                                                    }`}
                                                >
                                                    <div className="space-y-1">
                                                        <span className="text-xs font-black text-white font-mono">{scan.symbol}</span>
                                                        <div className="text-[10px] text-zinc-500 font-mono">
                                                            Avg Return: <span className={scan.stats.average_return >= 0 ? "text-emerald-500" : "text-red-500"}>
                                                                {(scan.stats.average_return * 100).toFixed(1)}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="text-right font-mono">
                                                        <div className="text-xs font-black text-emerald-400">
                                                            {(scan.stats.win_rate * 100).toFixed(0)}% Win
                                                        </div>
                                                        <span className="text-[9px] text-zinc-600">
                                                            {scan.stats.wins}W / {scan.stats.losses}L
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="border-t border-zinc-900 mt-4 pt-3 flex justify-between items-center text-[9px] font-mono text-zinc-500">
                                        <span>Published: {formatDate(publishedReport.updated_at)}</span>
                                        <span>K: {publishedReport.k || 10}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Setup details (8 cols) */}
                            <div className="lg:col-span-8 space-y-8">
                                {selectedSimilarityScan && (
                                    <>
                                        {/* Stats Cards */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                            <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
                                                <p className="text-[9px] font-black tracking-widest text-zinc-500 uppercase">Win Rate</p>
                                                <p className="text-3xl font-black font-mono mt-2 text-emerald-500">
                                                    {(selectedSimilarityScan.stats.win_rate * 100).toFixed(1)}%
                                                </p>
                                                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                                    {selectedSimilarityScan.stats.wins} Wins / {selectedSimilarityScan.stats.losses} Losses
                                                </p>
                                            </div>

                                            <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
                                                <p className="text-[9px] font-black tracking-widest text-zinc-500 uppercase">Avg Return</p>
                                                <p className={`text-3xl font-black font-mono mt-2 ${selectedSimilarityScan.stats.average_return >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                                    {(selectedSimilarityScan.stats.average_return * 100).toFixed(2)}%
                                                </p>
                                                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                                    Across {selectedSimilarityScan.stats.total_matches} matches
                                                </p>
                                            </div>

                                            <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
                                                <p className="text-[9px] font-black tracking-widest text-zinc-500 uppercase">Profit Factor</p>
                                                <p className="text-3xl font-black font-mono mt-2 text-indigo-400">
                                                    {selectedSimilarityScan.stats.profit_factor.toFixed(2)}
                                                </p>
                                                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                                    Gross gain/loss ratio
                                                </p>
                                            </div>

                                            <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
                                                <p className="text-[9px] font-black tracking-widest text-zinc-500 uppercase">Expected Edge</p>
                                                <p className={`text-3xl font-black font-mono mt-2 ${selectedSimilarityScan.stats.expected_value >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                                    {(selectedSimilarityScan.stats.expected_value * 100).toFixed(2)}%
                                                </p>
                                                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                                    Expected yield per trade
                                                </p>
                                            </div>
                                        </div>

                                        {/* Similarity Intelligence Dashboard */}
                                        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                                            <div className="xl:col-span-7 border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                                                <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                                                    <div>
                                                        <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 font-mono">
                                                            <BarChart2 className="w-4 h-4 text-emerald-400" />
                                                            {language === "ar" ? "ترتيب أفضل الإشارات" : "Best Setups Ranking"}
                                                        </h3>
                                                        <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                                            {language === "ar" ? "مرتبة حسب القيمة المتوقعة لكل سهم منشور." : "Ranked by expected edge across published similarity signals."}
                                                        </p>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2 text-right font-mono">
                                                        <div className="border border-zinc-800 bg-zinc-900 px-3 py-2">
                                                            <p className="text-[8px] text-zinc-500 uppercase">Avg Win</p>
                                                            <p className="text-sm font-black text-emerald-400">{similarityDashboard.avgWinRate.toFixed(1)}%</p>
                                                        </div>
                                                        <div className="border border-zinc-800 bg-zinc-900 px-3 py-2">
                                                            <p className="text-[8px] text-zinc-500 uppercase">Avg Edge</p>
                                                            <p className={`text-sm font-black ${similarityDashboard.avgExpectedEdge >= 0 ? "text-emerald-400" : "text-red-400"}`}>{similarityDashboard.avgExpectedEdge.toFixed(2)}%</p>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="h-[260px] w-full">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <BarChart data={similarityDashboard.rankedSetups} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                                                            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                                                            <XAxis type="number" stroke="#9ca3af" style={{ fontSize: 10, fontFamily: "monospace" }} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
                                                            <YAxis type="category" dataKey="symbol" stroke="#9ca3af" width={64} style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 800 }} />
                                                            <ChartTooltip
                                                                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                                                                contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                                                                labelStyle={{ color: "#fff", fontWeight: "bold", fontFamily: "monospace", fontSize: 11 }}
                                                                itemStyle={{ fontSize: 10, fontFamily: "monospace" }}
                                                                formatter={(value: any, name: any) => [`${parseFloat(value).toFixed(2)}%`, name === "expectedEdge" ? "Expected Edge" : name]}
                                                            />
                                                            <ReferenceLine x={0} stroke="#71717a" strokeDasharray="3 3" />
                                                            <Bar dataKey="expectedEdge" name="Expected Edge" radius={[0, 4, 4, 0]}>
                                                                {similarityDashboard.rankedSetups.map((entry: any) => (
                                                                    <Cell key={entry.symbol} fill={entry.expectedEdge >= 0 ? "#10b981" : "#ef4444"} />
                                                                ))}
                                                            </Bar>
                                                        </BarChart>
                                                    </ResponsiveContainer>
                                                </div>
                                            </div>

                                            <div className="xl:col-span-5 grid grid-cols-1 gap-5">
                                                <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                                                    <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-4 font-mono">
                                                        <Target className="w-4 h-4 text-amber-400" />
                                                        {language === "ar" ? "توزيع النتائج" : "Outcome Split"}
                                                    </h3>
                                                    <div className="h-[160px] w-full">
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <BarChart data={similarityDashboard.outcomeData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                                                                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                                                                <XAxis dataKey="name" stroke="#9ca3af" style={{ fontSize: 10, fontFamily: "monospace" }} />
                                                                <YAxis allowDecimals={false} stroke="#9ca3af" style={{ fontSize: 10, fontFamily: "monospace" }} />
                                                                <ChartTooltip contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }} itemStyle={{ fontSize: 10, fontFamily: "monospace" }} />
                                                                <Bar dataKey="value" name="Matches" radius={[4, 4, 0, 0]}>
                                                                    {similarityDashboard.outcomeData.map((entry: any) => (
                                                                        <Cell key={entry.name} fill={entry.fill} />
                                                                    ))}
                                                                </Bar>
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                </div>

                                                <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                                                    <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-3 font-mono">
                                                        <Sparkles className="w-4 h-4 text-indigo-400" />
                                                        {language === "ar" ? "أقوى فرصة الآن" : "Strongest Setup Now"}
                                                    </h3>
                                                    <div className="grid grid-cols-2 gap-3 font-mono">
                                                        <div className="col-span-2 border border-emerald-500/20 bg-emerald-500/5 p-3">
                                                            <p className="text-[9px] text-zinc-500 uppercase">{language === "ar" ? "السهم الأعلى ترتيبا" : "Top Ranked Symbol"}</p>
                                                            <p className="text-2xl font-black text-white mt-1">{similarityDashboard.strongestSetup?.symbol || "—"}</p>
                                                        </div>
                                                        <div className="border border-zinc-800 bg-zinc-900 p-3">
                                                            <p className="text-[8px] text-zinc-500 uppercase">Win Rate</p>
                                                            <p className="text-lg font-black text-emerald-400">{(similarityDashboard.strongestSetup?.winRate || 0).toFixed(1)}%</p>
                                                        </div>
                                                        <div className="border border-zinc-800 bg-zinc-900 p-3">
                                                            <p className="text-[8px] text-zinc-500 uppercase">Profit Factor</p>
                                                            <p className="text-lg font-black text-indigo-400">{(similarityDashboard.strongestSetup?.profitFactor || 0).toFixed(2)}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Spaghetti Chart */}
                                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                                            <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-6 font-mono">
                                                <TrendingUp className="w-4 h-4 text-amber-400" />
                                                {selectedSimilarityScan.symbol} Trajectory spaghetti plot
                                            </h3>

                                            <div className="h-[350px] w-full">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <RechartsLineChart data={transformSimilarityChartData(selectedSimilarityScan)} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                                        <XAxis dataKey="dayLabel" stroke="#9ca3af" style={{ fontSize: 10, fontFamily: "monospace" }} />
                                                        <YAxis stroke="#9ca3af" style={{ fontSize: 10, fontFamily: "monospace" }} tickFormatter={(v) => `${v.toFixed(1)}%`} />
                                                        <ChartTooltip
                                                            contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                                                            labelStyle={{ color: "#fff", fontWeight: "bold", fontFamily: "monospace", fontSize: 11 }}
                                                            itemStyle={{ fontSize: 10, fontFamily: "monospace" }}
                                                            formatter={(value: any) => [`${parseFloat(value).toFixed(2)}%`]}
                                                        />
                                                        <ReferenceLine x="T0" stroke="#ffdc58" strokeWidth={2} strokeDasharray="4 4" />
                                                        <ReferenceLine y={(publishedReport.target_return || 0.05) * 100} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" />
                                                        <ReferenceLine y={(publishedReport.stop_loss || -0.03) * 100} stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" />

                                                        {selectedSimilarityScan.matches.slice(0, 5).map((m: any, idx: number) => {
                                                            const key = `Match_${idx + 1}_${m.date}`;
                                                            return (
                                                                <Line key={key} type="monotone" dataKey={key} stroke="#6366f1" strokeWidth={1} dot={false} opacity={0.3} name={`Match ${idx + 1} (${m.date})`} />
                                                            );
                                                        })}
                                                        <Line type="monotone" dataKey="Target" stroke="#ffffff" strokeWidth={3} dot={false} name="Target Stock" />
                                                        <Line type="monotone" dataKey="Average" stroke="#ffdc58" strokeWidth={3} dot={false} name="Average Path" />
                                                    </RechartsLineChart>
                                                </ResponsiveContainer>
                                            </div>
                                            <div className="flex flex-wrap items-center justify-center gap-6 mt-4 text-[10px] font-mono text-zinc-500">
                                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-white" /> Target Stock Path (Before T0)</span>
                                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400" /> Avg Matches Path</span>
                                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-indigo-500 opacity-60" /> Individual Historical Occurrences</span>
                                            </div>
                                        </div>

                                        {/* Match Quality Chart */}
                                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                                            <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
                                                <div>
                                                    <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 font-mono">
                                                        <Activity className="w-4 h-4 text-cyan-400" />
                                                        {language === "ar" ? "جودة المطابقات التاريخية" : "Historical Match Quality"}
                                                    </h3>
                                                    <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                                        {language === "ar" ? "يقارن درجة التشابه مع العائد النهائي وأقصى صعود/هبوط." : "Compares similarity score with final return, max favorable move, and drawdown."}
                                                    </p>
                                                </div>
                                                <div className="text-[10px] text-zinc-500 font-mono uppercase">
                                                    {language === "ar" ? "أول 10 حالات" : "Top 10 matches"}
                                                </div>
                                            </div>

                                            <div className="h-[280px] w-full">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <AreaChart data={similarityDashboard.matchQuality} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                                        <XAxis dataKey="name" stroke="#9ca3af" style={{ fontSize: 10, fontFamily: "monospace" }} />
                                                        <YAxis yAxisId="left" stroke="#9ca3af" style={{ fontSize: 10, fontFamily: "monospace" }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                                                        <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" style={{ fontSize: 10, fontFamily: "monospace" }} domain={[0, 100]} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                                                        <ChartTooltip
                                                            contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                                                            labelStyle={{ color: "#fff", fontWeight: "bold", fontFamily: "monospace", fontSize: 11 }}
                                                            itemStyle={{ fontSize: 10, fontFamily: "monospace" }}
                                                            formatter={(value: any, name: any) => [`${parseFloat(value).toFixed(2)}%`, name]}
                                                            labelFormatter={(label: any) => {
                                                                const row = similarityDashboard.matchQuality.find((item: any) => item.name === label);
                                                                return row?.date ? `Match ${label} - ${row.date}` : `Match ${label}`;
                                                            }}
                                                        />
                                                        <ReferenceLine yAxisId="left" y={0} stroke="#71717a" strokeDasharray="3 3" />
                                                        <Area yAxisId="left" type="monotone" dataKey="mfe" name="Peak Gain" stroke="#10b981" fill="#10b981" fillOpacity={0.08} strokeWidth={2} />
                                                        <Area yAxisId="left" type="monotone" dataKey="mae" name="Max Draw" stroke="#ef4444" fill="#ef4444" fillOpacity={0.08} strokeWidth={2} />
                                                        <Line yAxisId="left" type="monotone" dataKey="finalReturn" name="End Return" stroke="#ffdc58" strokeWidth={3} dot={{ r: 3 }} />
                                                        <Line yAxisId="right" type="monotone" dataKey="similarity" name="Similarity" stroke="#38bdf8" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </div>
                                            <div className="flex flex-wrap items-center justify-center gap-5 mt-4 text-[10px] font-mono text-zinc-500">
                                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-500" /> Peak Gain</span>
                                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-500" /> Drawdown</span>
                                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#ffdc58]" /> End Return</span>
                                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-sky-400 border-t border-dashed border-sky-400" /> Similarity</span>
                                            </div>
                                        </div>

                                        {/* Table of Matches */}
                                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                                            <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-4 font-mono">
                                                <Clock className="w-4 h-4 text-amber-400" />
                                                Historical Matching Cases
                                            </h3>

                                            <div className="overflow-x-auto">
                                                <table className="w-full text-left text-xs border-collapse font-mono">
                                                    <thead>
                                                        <tr className="border-b border-zinc-800 text-[10px] font-black uppercase text-zinc-500 tracking-wider">
                                                            <th className="py-3 px-2">Date</th>
                                                            <th className="py-3 px-2">Symbol</th>
                                                            <th className="py-3 px-2">Similarity</th>
                                                            <th className="py-3 px-2">Peak Gain (MFE)</th>
                                                            <th className="py-3 px-2">Max Draw (MAE)</th>
                                                            <th className="py-3 px-2">End Return</th>
                                                            <th className="py-3 px-2 text-right">Outcome</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-zinc-900">
                                                        {selectedSimilarityScan.matches.map((m: any, idx: number) => (
                                                            <tr key={idx} className="hover:bg-zinc-900/40 transition-colors">
                                                                <td className="py-3.5 px-2 font-bold text-zinc-200">{m.date}</td>
                                                                <td className="py-3.5 px-2 font-bold text-amber-400">{m.symbol}</td>
                                                                <td className="py-3.5 px-2 text-white">{(m.similarity * 100).toFixed(1)}%</td>
                                                                <td className="py-3.5 px-2 text-emerald-500 font-bold">+{(m.mfe * 100).toFixed(1)}%</td>
                                                                <td className="py-3.5 px-2 text-red-500 font-bold">{(m.mae * 100).toFixed(1)}%</td>
                                                                <td className={`py-3.5 px-2 font-black ${m.final_return >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                                                    {(m.final_return * 100).toFixed(1)}%
                                                                </td>
                                                                <td className="py-3.5 px-2 text-right">
                                                                    <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${m.outcome === "win" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                                                                        {m.outcome}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ── Feature Explanation Section ── */}
                    <div className="border-4 border-black dark:border-white bg-zinc-950 p-8 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                        <div className="max-w-4xl mx-auto space-y-8">

                            {/* Header */}
                            <div className="text-center">
                                <div className="inline-block border-2 border-black dark:border-white bg-indigo-500/20 text-indigo-400 px-3 py-1 text-[10px] font-black uppercase tracking-widest mb-3">
                                    {language === "ar" ? "كيف يعمل" : "HOW IT WORKS"}
                                </div>
                                <h3 className="text-xl font-black text-white uppercase tracking-tight">
                                    {language === "ar" ? "محرك الأنماط التاريخية" : "Historical Pattern Matching Engine"}
                                </h3>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {[
                                    {
                                        step: "01",
                                        enTitle: "Pattern Recognition",
                                        arTitle: "التعرف على الأنماط",
                                        enDesc: "The engine scans each stock's complete price history and extracts 13 key features: RSI, Bollinger %B, SMA distances, MACD, relative volume, rolling returns, and chart shape vectors.",
                                        arDesc: "يمسح المحرك التاريخ الكامل لكل سهم ويستخرج 13 ميزة رئيسية: RSI، Bollinger %B، مسافات SMA، MACD، الحجم النسبي، العوائد المتحركة، وشكل الشارت.",
                                        color: "border-indigo-500/30 bg-indigo-500/5"
                                    },
                                    {
                                        step: "02",
                                        enTitle: "Cosine Similarity Matching",
                                        arTitle: "مطابقة تشابه جيب التمام",
                                        enDesc: "Each day's feature vector is compared against every other day using cosine similarity. The top K most similar historical patterns are selected, spaced at least 20 days apart to prevent clustering.",
                                        arDesc: "تتم مقارنة متجه الميزات لكل يوم مع كل الأيام الأخرى باستخدام تشابه جيب التمام. يتم اختيار أكثر K نمط تاريخي تشابهاً، مع تباعد 20 يوم على الأقل لمنع التجميع.",
                                        color: "border-emerald-500/30 bg-emerald-500/5"
                                    },
                                    {
                                        step: "03",
                                        enTitle: "Forward Path Simulation",
                                        arTitle: "محاكاة المسار المستقبلي",
                                        enDesc: "For each matching pattern, the engine simulates holding for N days, tracking the return path. It computes win rate, average return, profit factor, and expected edge against target and stop-loss levels.",
                                        arDesc: "لكل نمط مطابق، يحاكي المحرك الاحتفاظ بالسهم لمدة N يوم ويتتبع مسار العائد. يحسب نسبة النجاح، متوسط العائد، عامل الربح، والقيمة المتوقعة مقابل الهدف ووقف الخسارة.",
                                        color: "border-amber-500/30 bg-amber-500/5"
                                    }
                                ].map((item, idx) => (
                                    <div key={idx} className={`${item.color} border rounded p-5 space-y-3`}>
                                        <div className="text-3xl font-black text-white font-mono opacity-20">{item.step}</div>
                                        <h4 className="text-sm font-black text-white uppercase tracking-wider">
                                            {language === "ar" ? item.arTitle : item.enTitle}
                                        </h4>
                                        <p className="text-xs text-zinc-400 leading-relaxed font-medium">
                                            {language === "ar" ? item.arDesc : item.enDesc}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            <div className="border-t border-white/5 pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-zinc-900 border border-white/5 rounded p-4">
                                    <h4 className="text-xs font-black text-zinc-200 uppercase tracking-wider mb-2">
                                        {language === "ar" ? "الميزات الـ 13 المستخدمة" : "13 Features Analyzed"}
                                    </h4>
                                    <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                                        {["RSI", "BB %B", "Close/SMA50", "Close/SMA200", "MACD Norm", "R_VOL", "Return 3d", "Return 5d", "Return 10d", "Return 20d", "ChartShape x5", "Z-Score Norm", "Cosine Sim"].map((f, i) => (
                                            <span key={i} className="text-zinc-400 bg-zinc-800/50 px-2 py-1 rounded flex items-center gap-1.5">
                                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                                                {f}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="bg-zinc-900 border border-white/5 rounded p-4">
                                    <h4 className="text-xs font-black text-zinc-200 uppercase tracking-wider mb-2">
                                        {language === "ar" ? "كيف تقرأ النتائج" : "How to Read Results"}
                                    </h4>
                                    <ul className="space-y-2 text-[10px] font-mono text-zinc-400">
                                        {[
                                            { en: "Win Rate = % of historical matches that hit target", ar: "نسبة النجاح = % من المطابقات التاريخية التي حققت الهدف" },
                                            { en: "Avg Return = average forward return across all matches", ar: "متوسط العائد = متوسط العائد المستقبلي عبر كل المطابقات" },
                                            { en: "Profit Factor = gross gains / gross losses ratio", ar: "عامل الربح = إجمالي المكاسب / إجمالي الخسائر" },
                                            { en: "Expected Edge = probability-weighted expected yield per trade", ar: "القيمة المتوقعة = العائد المتوقع لكل صفقة مرجح بالاحتمالات" },
                                        ].map((item, i) => (
                                            <li key={i} className="flex items-start gap-2">
                                                <span className="text-amber-400 mt-0.5">▸</span>
                                                <span>{language === "ar" ? item.ar : item.en}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            <div className="text-center">
                                <p className="text-[10px] text-zinc-600 font-mono">
                                    {language === "ar"
                                        ? "يتم تحديث البيانات تلقائياً يومياً بعد إغلاق السوق. قد تختلف النتائج السابقة عن الأداء المستقبلي."
                                        : "Data updates automatically after market close each day. Past results do not guarantee future performance."
                                    }
                                </p>
                            </div>

                        </div>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: BACKTESTS */}
            {activeTab === "backtests" && (
                <div className="space-y-6" dir="ltr" style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>
                    {/* Model Global History Statistics */}
                    {modelStats.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                            {modelStats.map((stat, idx) => {
                                const isKing = stat.modelName === "KING";
                                const isNano = stat.modelName === "NANO";
                                const isTheBot = stat.modelName === "THE BOT";
                                
                                const logoUrl = isKing 
                                    ? "/king_logo.jpg" 
                                    : isNano 
                                    ? "/new_model_logo.jpg" 
                                    : "/bot_logo.jpg";
                                    
                                const isModelEgx = stat.modelName === "MODEL_EGX";

                                const fallbackColors = ["#a855f7", "#ec4899", "#3b82f6", "#f43f5e", "#06b6d4"];
                                const fallbackIcons = [Sparkles, Activity, LineChart, BarChart2, TrendingUp];
                                    
                                const modelColor = isKing 
                                    ? "#f59e0b" 
                                    : isNano 
                                    ? "#6366f1" 
                                    : isTheBot
                                    ? "#10b981"
                                    : isModelEgx
                                    ? "#0ea5e9"
                                    : fallbackColors[idx % fallbackColors.length];

                                const IconComp = isKing ? Brain : isNano ? Cpu : isTheBot ? Zap : isModelEgx ? LineChart : fallbackIcons[idx % fallbackIcons.length];
                                
                                const displayName = stat.modelName === "KING"
                                    ? (language === "ar" ? "موديل KING الملكي" : "KING Model")
                                    : stat.modelName === "NANO"
                                    ? (language === "ar" ? "موديل NANO الذكي" : "NANO Model")
                                    : stat.modelName === "THE BOT"
                                    ? (language === "ar" ? "موديل THE BOT" : "THE BOT Model")
                                    : stat.modelName === "MODEL_EGX"
                                    ? (language === "ar" ? "موديل EGX الذكي" : "Model EGX")
                                    : stat.modelName;

                                const badgeName = isKing 
                                    ? (language === "ar" ? "مميز" : "Premium") 
                                    : isNano 
                                    ? (language === "ar" ? "لايت" : "Lite")
                                    : isModelEgx
                                    ? (language === "ar" ? "أساسي" : "Standard")
                                    : (language === "ar" ? "أساسي" : "Standard");
                                
                                return (
                                    <div 
                                        key={stat.modelName}
                                        className="app-panel-strong relative overflow-hidden flex flex-col justify-between group"
                                    >
                                        {/* Background Logo Layer */}
                                        <div 
                                            className="absolute inset-0 bg-cover bg-center opacity-[0.03] group-hover:opacity-[0.05] pointer-events-none transition-opacity duration-500" 
                                            style={{ backgroundImage: `url('${logoUrl}')` }} 
                                        />
                                        
                                        {/* Header */}
                                        <div className="relative z-10 flex items-start justify-between mb-4 p-6 pb-0">
                                            <div className="flex items-center gap-3">
                                                <div 
                                                    className="p-3 border-2 flex items-center justify-center shrink-0"
                                                    style={{ 
                                                        color: modelColor, 
                                                        borderColor: modelColor, 
                                                        backgroundColor: `${modelColor}15`,
                                                        boxShadow: `2px 2px 0px 0px ${modelColor}`
                                                    }}
                                                >
                                                    <IconComp className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <h3 className="text-base font-black text-[var(--app-text)] uppercase tracking-tight flex items-center gap-2 flex-wrap">
                                                        {displayName}
                                                        <span 
                                                            className="text-[8px] font-black px-2 py-0.5 rounded-none uppercase tracking-wider border-2"
                                                            style={{ color: modelColor, borderColor: modelColor, backgroundColor: `${modelColor}15` }}
                                                        >
                                                            {badgeName}
                                                        </span>
                                                    </h3>
                                                    <p className="text-[9px] text-[var(--app-text-faint)] font-bold uppercase tracking-widest mt-1">
                                                        {language === "ar" ? "إحصائيات تراكمية" : "Cumulative Historical Overview"}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Divider */}
                                        <div className="relative z-10 h-px bg-[var(--app-border)] mx-6" />

                                        {/* Stats Grid — 2+3 layout */}
                                        <div className="relative z-10 space-y-3 p-6 pt-4">
                                            {/* Row 1: Runs + Trades */}
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="p-3 border-2 border-black dark:border-white bg-[var(--app-surface)] flex flex-col gap-1 shadow-[2px_2px_0px_0px_var(--brutal-shadow)]">
                                                    <div className="flex items-center justify-between gap-1 w-full">
                                                        <span className="text-[9px] font-bold text-[var(--app-text-faint)] uppercase tracking-wider truncate">
                                                            {t("backtest.stats.total_runs")}
                                                        </span>
                                                        <div className="group/tooltip relative shrink-0">
                                                            <HelpCircle className="w-3 h-3 text-[var(--app-text-faint)] hover:text-[var(--app-text)] transition-colors" />
                                                            <span className="absolute bottom-full left-0 mb-2 w-48 p-2 text-[10px] bg-[var(--app-surface-strong)] text-[var(--app-text)] border-2 border-black dark:border-white shadow-[3px_3px_0px_0px_var(--brutal-shadow)] opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50 text-center font-sans font-medium normal-case leading-relaxed">
                                                                {language === "ar" ? "عدد دورات المحاكاة الكاملة التي تم تشغيلها لتقييم الموديل." : "Total number of simulation runs executed to evaluate this model."}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="font-mono text-2xl font-black text-[var(--app-text)] leading-none">
                                                        {stat.totalRuns}
                                                    </span>
                                                    <span className="text-[8px] text-[var(--app-text-faint)] font-bold uppercase">{language === "ar" ? "اختبارات" : "backtests"}</span>
                                                </div>
                                                <div className="p-3 border-2 border-black dark:border-white bg-[var(--app-surface)] flex flex-col gap-1 shadow-[2px_2px_0px_0px_var(--brutal-shadow)]">
                                                    <div className="flex items-center justify-between gap-1 w-full">
                                                        <span className="text-[9px] font-bold text-[var(--app-text-faint)] uppercase tracking-wider truncate">
                                                            {t("backtest.stats.total_trades")}
                                                        </span>
                                                        <div className="group/tooltip relative shrink-0">
                                                            <HelpCircle className="w-3 h-3 text-[var(--app-text-faint)] hover:text-[var(--app-text)] transition-colors" />
                                                            <span className="absolute bottom-full right-0 mb-2 w-48 p-2 text-[10px] bg-[var(--app-surface-strong)] text-[var(--app-text)] border-2 border-black dark:border-white shadow-[3px_3px_0px_0px_var(--brutal-shadow)] opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50 text-center font-sans font-medium normal-case leading-relaxed">
                                                                {language === "ar" ? "إجمالي الصفقات (البيع والشراء) التي قام الموديل بتنفيذها." : "Total number of trades (buy and sell) executed by the model."}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="font-mono text-2xl font-black text-[var(--app-text)] leading-none">
                                                        {stat.totalTrades}
                                                    </span>
                                                    <span className="text-[8px] text-[var(--app-text-faint)] font-bold uppercase">{language === "ar" ? "إشارات" : "signals"}</span>
                                                </div>
                                            </div>

                                            {/* Row 2: Win Rate + Net Profit + Avg Return */}
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="p-3 border-2 border-black dark:border-white bg-[var(--app-surface)] flex flex-col gap-1 shadow-[2px_2px_0px_0px_var(--brutal-shadow)]">
                                                    <div className="flex items-center justify-between gap-1 w-full">
                                                        <span className="text-[9px] font-bold text-[var(--app-text-faint)] uppercase tracking-wider truncate">
                                                            {t("backtest.stats.win_rate")}
                                                        </span>
                                                        <div className="group/tooltip relative shrink-0">
                                                            <HelpCircle className="w-3 h-3 text-[var(--app-text-faint)] hover:text-[var(--app-text)] transition-colors" />
                                                            <span className="absolute bottom-full left-0 mb-2 w-48 p-2 text-[10px] bg-[var(--app-surface-strong)] text-[var(--app-text)] border-2 border-black dark:border-white shadow-[3px_3px_0px_0px_var(--brutal-shadow)] opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50 text-center font-sans font-medium normal-case leading-relaxed">
                                                                {language === "ar" ? "نسبة الصفقات الرابحة من إجمالي الصفقات التي دخلها الموديل." : "Percentage of winning trades out of total executed trades."}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="font-mono text-xl font-black text-[#10b981] leading-none">
                                                        {stat.winRate.toFixed(1)}%
                                                    </span>
                                                    <span className="text-[8px] text-[var(--app-text-faint)] font-bold uppercase">{language === "ar" ? "نسبة النجاح" : "win rate"}</span>
                                                </div>
                                                <div className="p-3 border-2 border-black dark:border-white bg-[var(--app-surface)] flex flex-col gap-1 shadow-[2px_2px_0px_0px_var(--brutal-shadow)]">
                                                    <div className="flex items-center justify-between gap-1 w-full">
                                                        <span className="text-[9px] font-bold text-[var(--app-text-faint)] uppercase tracking-wider truncate">
                                                            {t("backtest.stats.avg_profit")}
                                                        </span>
                                                        <div className="group/tooltip relative shrink-0">
                                                            <HelpCircle className="w-3 h-3 text-[var(--app-text-faint)] hover:text-[var(--app-text)] transition-colors" />
                                                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 text-[10px] bg-[var(--app-surface-strong)] text-[var(--app-text)] border-2 border-black dark:border-white shadow-[3px_3px_0px_0px_var(--brutal-shadow)] opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50 text-center font-sans font-medium normal-case leading-relaxed">
                                                                {language === "ar" ? "متوسط النسبة المئوية للربح المحقق في كل اختبار كامل." : "Average percentage return achieved per complete simulation run."}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="font-mono text-xl font-black leading-none" style={{ color: stat.netProfit >= 0 ? "#10b981" : "#ef4444" }}>
                                                        {stat.netProfit >= 0 ? '+' : ''}{stat.netProfit.toFixed(1)}%
                                                    </span>
                                                    <span className="text-[8px] text-[var(--app-text-faint)] font-bold uppercase">{language === "ar" ? "متوسط العائد" : "avg profit"}</span>
                                                </div>
                                                <div className="p-3 border-2 border-black dark:border-white bg-[var(--app-surface)] flex flex-col gap-1 shadow-[2px_2px_0px_0px_var(--brutal-shadow)]">
                                                    <div className="flex items-center justify-between gap-1 w-full">
                                                        <span className="text-[9px] font-bold text-[var(--app-text-faint)] uppercase tracking-wider truncate">
                                                            {t("backtest.stats.avg_return")}
                                                        </span>
                                                        <div className="group/tooltip relative shrink-0">
                                                            <HelpCircle className="w-3 h-3 text-[var(--app-text-faint)] hover:text-[var(--app-text)] transition-colors" />
                                                            <span className="absolute bottom-full right-0 mb-2 w-48 p-2 text-[10px] bg-[var(--app-surface-strong)] text-[var(--app-text)] border-2 border-black dark:border-white shadow-[3px_3px_0px_0px_var(--brutal-shadow)] opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity z-50 text-center font-sans font-medium normal-case leading-relaxed">
                                                                {language === "ar" ? "متوسط نسبة الربح أو الخسارة المحققة في الصفقة الفردية." : "Average percentage return generated per individual trade."}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="font-mono text-xl font-black leading-none" style={{ color: stat.avgReturnPerTrade >= 0 ? "#10b981" : "#ef4444" }}>
                                                        {stat.avgReturnPerTrade >= 0 ? '+' : ''}{stat.avgReturnPerTrade.toFixed(2)}%
                                                    </span>
                                                    <span className="text-[8px] text-[var(--app-text-faint)] font-bold uppercase">{language === "ar" ? "للصفقة" : "per trade"}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Comparative Performance Chart */}
                    {modelStats.length > 0 && (
                        <div className="app-panel relative overflow-hidden rounded-[2rem] p-6 mb-8">
                            {/* Decorative background gradients */}
                            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />
                            <div className="absolute bottom-0 left-0 w-64 h-64 bg-amber-500/5 rounded-full blur-[100px] pointer-events-none" />
                            
                            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-6">
                                <div className="space-y-1.5">
                                    <h3 className="text-sm md:text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                                        <BarChart2 className="w-5 h-5 text-indigo-400" />
                                        {language === "ar" ? "مقارنة الأداء العام بين البوتات" : "Global Bot Performance Comparison"}
                                    </h3>
                                    <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">
                                        {language === "ar" ? "مقارنة بيانية للمقاييس الرئيسية بين طرازات الذكاء الاصطناعي" : "Graphical Comparison of Key Metrics Across AI Models"}
                                    </p>
                                </div>
                                
                                {/* Metric Selectors */}
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        onClick={() => setSelectedMetric("netProfit")}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-black transition-all ${
                                            selectedMetric === "netProfit"
                                                ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-lg shadow-indigo-500/5"
                                                : "bg-zinc-900/40 border-white/5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60"
                                        }`}
                                    >
                                        <TrendingUp className="w-3.5 h-3.5" />
                                        {language === "ar" ? "متوسط العائد الكلي" : "Avg Total Return"}
                                    </button>
                                    <button
                                        onClick={() => setSelectedMetric("winRate")}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-black transition-all ${
                                            selectedMetric === "winRate"
                                                ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-lg shadow-indigo-500/5"
                                                : "bg-zinc-900/40 border-white/5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60"
                                        }`}
                                    >
                                        <Target className="w-3.5 h-3.5" />
                                        {language === "ar" ? "نسبة النجاح" : "Avg Win Rate"}
                                    </button>
                                    <button
                                        onClick={() => setSelectedMetric("avgReturn")}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-black transition-all ${
                                            selectedMetric === "avgReturn"
                                                ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400 shadow-lg shadow-indigo-500/5"
                                                : "bg-zinc-900/40 border-white/5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/60"
                                        }`}
                                    >
                                        <Activity className="w-3.5 h-3.5" />
                                        {language === "ar" ? "العائد/الصفقة" : "Avg Return/Trade"}
                                    </button>
                                </div>
                            </div>

                            {/* Chart Container */}
                            {!mounted ? (
                                <div className="h-[280px] w-full flex flex-col items-center justify-center bg-zinc-950/20 rounded-2xl border border-white/5 animate-pulse gap-3">
                                    <Loader2 className="w-6 h-6 animate-spin text-zinc-700" />
                                    <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Loading Comparison...</span>
                                </div>
                            ) : (
                                <div className="h-[280px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart 
                                            data={chartData} 
                                            margin={{ top: 10, right: 10, left: -20, bottom: 5 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                                            <XAxis 
                                                dataKey="name" 
                                                stroke="rgba(255, 255, 255, 0.4)" 
                                                tick={{ fontSize: 11, fontWeight: 'bold' }} 
                                            />
                                            <YAxis 
                                                stroke="rgba(255, 255, 255, 0.4)" 
                                                tick={{ fontSize: 11, fontWeight: 'bold' }}
                                                tickFormatter={(val) => `${val.toFixed(1)}%`}
                                            />
                                            <ChartTooltip 
                                                cursor={{ fill: 'rgba(255, 255, 255, 0.02)' }}
                                                content={({ active, payload }: any) => {
                                                    if (active && payload && payload.length) {
                                                        const data = payload[0];
                                                        const color = data.payload.fill;
                                                        return (
                                                            <div className="bg-zinc-950/95 border border-white/10 backdrop-blur-md p-4 rounded-2xl shadow-2xl text-left space-y-1">
                                                                <div className="text-xs font-black text-white">{data.payload.name}</div>
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                                                                    <span className="text-[10px] text-zinc-400 font-bold uppercase">
                                                                        {selectedMetric === "netProfit" 
                                                                            ? (language === "ar" ? "متوسط العائد الكلي" : "Avg Total Return") 
                                                                            : selectedMetric === "winRate"
                                                                            ? (language === "ar" ? "نسبة النجاح" : "Avg Win Rate")
                                                                            : (language === "ar" ? "العائد/الصفقة" : "Avg Return/Trade")
                                                                        }:
                                                                    </span>
                                                                    <span className="text-xs font-mono font-black text-white" style={{ color: color }}>
                                                                        {Number(data.value).toFixed(2)}%
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                }}
                                            />
                                            <Bar 
                                                dataKey="value" 
                                                radius={[10, 10, 0, 0]} 
                                                maxBarSize={60}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Filters and Sorting Bar */}
                    <div className="app-panel flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-[2rem] mb-6">
                        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                            {/* Search Query */}
                            <div className="relative flex-1 sm:flex-initial min-w-[220px]">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    type="text"
                                    placeholder={language === "ar" ? "ابحث باسم الموديل أو المعرّف..." : "Search by model name or run ID..."}
                                    value={backtestSearchQuery}
                                    onChange={(e) => setBacktestSearchQuery(e.target.value)}
                                    className="w-full h-10 pl-10 pr-4 rounded-xl bg-zinc-950/60 border border-white/5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 transition-colors"
                                />
                            </div>

                            {/* Model Name Selector */}
                            <select
                                value={backtestModelFilter}
                                onChange={(e) => setBacktestModelFilter(e.target.value)}
                                className="h-10 px-3 rounded-xl bg-zinc-950/60 border border-white/5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                            >
                                <option value="All">{language === "ar" ? "كل الموديلات" : "All Models"}</option>
                                {uniqueBacktestModels.map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end">
                            {/* Sort Param */}
                            <select
                                value={backtestSortBy}
                                onChange={(e) => setBacktestSortBy(e.target.value)}
                                className="h-10 px-3 rounded-xl bg-zinc-950/60 border border-white/5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                            >
                                <option value="date">{language === "ar" ? "ترتيب بالتاريخ" : "Sort by Date"}</option>
                                <option value="net_profit">{language === "ar" ? "ترتيب بالعائد الكلي" : "Sort by Total Return"}</option>
                                <option value="win_rate">{language === "ar" ? "ترتيب بنسبة النجاح" : "Sort by Win Rate"}</option>
                                <option value="total_trades">{language === "ar" ? "ترتيب بعدد الصفقات" : "Sort by Total Trades"}</option>
                            </select>

                            {/* Sort Order Toggle */}
                            <button
                                onClick={() => setBacktestSortOrder(backtestSortOrder === "desc" ? "asc" : "desc")}
                                className="h-10 w-10 flex items-center justify-center rounded-xl bg-zinc-950/60 border border-white/5 text-zinc-400 hover:text-white hover:border-white/20 transition-all active:scale-95 shrink-0"
                                title={backtestSortOrder === "desc" ? (language === "ar" ? "تنازلي" : "Descending") : (language === "ar" ? "تصاعدي" : "Ascending")}
                            >
                                <ArrowRightLeft className={`w-4 h-4 transition-transform duration-300 ${backtestSortOrder === "desc" ? "rotate-90" : "-rotate-90"}`} />
                            </button>
                        </div>
                    </div>

                    {backtestsLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">{language === "ar" ? "جاري تحميل الاختبارات العكسية..." : "Loading backtests..."}</p>
                        </div>
                    ) : backtestsError ? (
                        <div className="p-6 rounded-3xl border border-red-500/10 bg-red-500/5 text-red-400 text-sm text-center">
                            {backtestsError}
                        </div>
                    ) : egxBacktests.length === 0 ? (
                        backtestSearchQuery || backtestModelFilter !== "All" ? (
                            <div className="p-12 text-center rounded-[2.5rem] border border-white/5 bg-zinc-950/20 text-zinc-500">
                                <Database className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                                <p className="font-bold uppercase tracking-wider text-xs mb-2">
                                    {language === "ar" ? "لا توجد نتائج تطابق فلاتر البحث" : "No backtest results match filters"}
                                </p>
                                <button
                                    onClick={() => {
                                        setBacktestSearchQuery("");
                                        setBacktestModelFilter("All");
                                        setBacktestSortBy("date");
                                        setBacktestSortOrder("desc");
                                    }}
                                    className="px-4 py-2 mt-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all active:scale-95"
                                >
                                    {language === "ar" ? "إعادة تعيين الفلاتر" : "Reset Filters"}
                                </button>
                            </div>
                        ) : (
                            <div className="p-12 text-center rounded-[2.5rem] border border-white/5 bg-zinc-950/20 text-zinc-600 font-bold uppercase tracking-wider">
                                {t("backtest.no_results")}
                            </div>
                        )
                    ) : (
                        <div className="space-y-6">
                            {egxBacktests.map((bt) => {
                                const profitPctValue = getBacktestProfitPct(bt, "post") ?? 0;
                                const cashProfitValue = bt.net_profit;
                                
                                const trades = loadedTrades[bt.id] ?? parseTradesLog(bt.trades_log);
                                const isLoadingTrades = !!tradesLoadingMap[bt.id];
                                const isOpt = bt.model_name?.toUpperCase().startsWith("OPT:") || bt.model_name?.toUpperCase().startsWith("OPTIMIZER:");
                                const actualRange = getActualRange(trades);
                                const isExpanded = expandedBacktestId === bt.id;

                                return (
                                    <div
                                        key={bt.id}
                                        className="overflow-hidden rounded-[2rem] border border-white/5 bg-zinc-900/10 transition-all duration-300"
                                    >
                                        {/* Backtest Header details card */}
                                        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-zinc-900/30">
                                            <div className="space-y-3">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <span className="text-lg font-black text-white uppercase tracking-tight">
                                                        {bt.model_name?.replace(".pkl", "")}
                                                    </span>
                                                    {bt.status_msg === "Live Bot Run" ? (
                                                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[8px] font-black uppercase">
                                                            {t("backtest.live_bot_run")}
                                                        </span>
                                                    ) : isOpt ? (
                                                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 text-[8px] font-black uppercase">
                                                            {t("backtest.optimizer_run")}
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[8px] font-black uppercase">
                                                            {t("backtest.standard_run")}
                                                        </span>
                                                    )}

                                                    {/* Target and Risk (Stop Loss) settings */}
                                                    {(() => {
                                                        const { target, stopLoss } = getBacktestSettings(bt);
                                                        if (target === null && stopLoss === null) return null;
                                                        return (
                                                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-950/60 border border-white/5 text-[9px] font-mono font-bold shadow-inner">
                                                                <span className="text-zinc-500 font-bold uppercase">{language === "ar" ? "الهدف:" : "Target:"}</span>
                                                                <span className="text-emerald-400 font-black">{target !== null ? `${target}%` : "—"}</span>
                                                                <span className="text-zinc-700">|</span>
                                                                <span className="text-zinc-500 font-bold uppercase">{language === "ar" ? "المخاطرة (وقف الخسارة):" : "Risk (SL):"}</span>
                                                                <span className="text-red-400 font-black">{stopLoss !== null ? `${stopLoss}%` : "—"}</span>
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Council model and meta settings */}
                                                    {bt.council_model && (
                                                        <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-zinc-950/60 border border-white/5 text-[9px] font-mono font-bold shadow-inner">
                                                            <span className="text-zinc-500 font-bold uppercase">{t("backtest.council")}</span>
                                                            <span className="text-indigo-400 font-black">{bt.council_model.replace(".pkl", "")}</span>
                                                            <span className="text-zinc-700">@</span>
                                                            <span className="text-indigo-400 font-black">{bt.council_threshold ?? 0.1}</span>
                                                            <span className="text-zinc-700">|</span>
                                                            <span className="text-zinc-500 font-bold uppercase">{t("backtest.meta")}</span>
                                                            <span className="text-zinc-300 font-black">{bt.meta_threshold ?? 0.4}</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                                                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-zinc-600" /> {new Date(bt.start_date).toLocaleDateString()} - {new Date(bt.end_date).toLocaleDateString()}</span>
                                                    <span className="text-zinc-700">•</span>
                                                    <span className="font-bold text-zinc-400">{t("backtest.exchange_label")} {bt.exchange?.toUpperCase()}</span>
                                                    <span className="text-zinc-700">•</span>
                                                    <span className="text-[10px] font-mono opacity-50">{t("backtest.run_id_label")} {bt.id.slice(0, 8)}</span>
                                                </div>
                                            </div>

                                            {/* Metrics Row */}
                                            <div className="flex flex-wrap items-center gap-4 md:gap-8 bg-black/20 p-4 rounded-2xl border border-white/5">
                                                <div className="text-center min-w-[70px]">
                                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{t("bots.table.winrate")}</p>
                                                    <p className="font-mono text-base font-black text-emerald-400">{formatNum(bt.win_rate, 1)}%</p>
                                                </div>
                                                <div className="w-px h-8 bg-white/5 hidden sm:block" />
                                                <div className="text-center min-w-[80px]">
                                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{t("backtest.net_profit")}</p>
                                                    <p className={`font-mono text-base font-black ${profitPctValue >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                        {profitPctValue >= 0 ? "+" : ""}{formatNum(profitPctValue, 2)}%
                                                    </p>
                                                    {cashProfitValue !== null && (
                                                        <p className={`text-[9px] font-mono font-bold mt-0.5 ${cashProfitValue >= 0 ? "text-emerald-500/70" : "text-red-500/70"}`}>
                                                            {cashProfitValue >= 0 ? "+" : ""}{formatNum(cashProfitValue, 0)} {language === "ar" ? "ج.م." : "EGP"}
                                                        </p>
                                                    )}
                                                    {actualRange && (
                                                        <div className="mt-1 flex justify-center">
                                                            <Egx30Comparison start={actualRange.start} end={actualRange.end} botReturn={profitPctValue} />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="w-px h-8 bg-white/5 hidden sm:block" />
                                                <div className="text-center min-w-[70px]">
                                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{t("backtest.total_trades")}</p>
                                                    <p className="font-mono text-base font-black text-zinc-100">{bt.total_trades}</p>
                                                    {actualRange && (
                                                        <p className="text-[9px] font-black text-indigo-400/80 uppercase tracking-widest mt-0.5">
                                                            {t("bots.active_days").replace("{days}", actualRange.days.toString())}
                                                        </p>
                                                    )}
                                                </div>
                                                <div className="w-px h-8 bg-white/5 hidden sm:block" />
                                                <div className="text-center min-w-[90px]">
                                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{t("backtest.avg_return")}</p>
                                                    <p className={`font-mono text-base font-black ${bt.avg_return_per_trade >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                        {bt.avg_return_per_trade >= 0 ? "+" : ""}{formatNum(bt.avg_return_per_trade, 2)}%
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Expand/Collapse Trades CTA */}
                                            <div className="self-end md:self-center">
                                                <button
                                                    onClick={() => handleToggleExpand(bt.id)}
                                                    className="h-11 px-5 flex items-center justify-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 text-white font-black text-[10px] uppercase tracking-widest border border-white/5 hover:border-white/10 transition-all duration-300 whitespace-nowrap"
                                                >
                                                    {isExpanded ? t("backtest.hide_trades") : t("backtest.view_trades")}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Expandable trades section */}
                                        {isExpanded && (() => {
                                            const isFiltered = expandedFilteredMap[bt.id] ?? true;
                                            const filteredTrades = trades.filter((t: any) => {
                                                if (!isFiltered) return true;
                                                const st = t.features?.backtest_status || t.features?.Status || t.Status || t.status;
                                                if (!st) return true;
                                                return String(st).toLowerCase() === 'accepted';
                                            });
                                            const actualRange = getActualRange(filteredTrades);
                                            const activeSubTab = expandedTabMap[bt.id] || 'chart';

                                            return (
                                                <div className="border-t border-white/5 bg-black/20 p-6 md:p-8 animate-in fade-in slide-in-from-top-4 duration-300 space-y-6">
                                                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/5">
                                                        <div className="flex items-center gap-3">
                                                            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-lg flex-shrink-0">
                                                                <LineChart className="h-4 w-4" />
                                                            </div>
                                                            <div>
                                                                <h4 className="text-xs font-black text-white uppercase tracking-[0.2em] flex items-center gap-2">
                                                                    {t("backtest.details")} ({t("backtest.trades_count").replace("{count}", filteredTrades.length.toString())})
                                                                </h4>
                                                                <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-black opacity-60">
                                                                    {t("backtest.simulation_radar")}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="flex flex-wrap items-center gap-4 self-end lg:self-auto">
                                                            {/* Intelligent Toggle Group */}
                                                            <div className="flex items-center bg-zinc-950/60 p-1 rounded-xl border border-white/5 shadow-inner">
                                                                <button
                                                                    onClick={() => setExpandedFilteredMap(prev => ({ ...prev, [bt.id]: true }))}
                                                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                                                                        (expandedFilteredMap[bt.id] ?? true) 
                                                                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 shadow' 
                                                                            : 'text-zinc-600 hover:text-zinc-400'
                                                                    }`}
                                                                >
                                                                    <Eye className="h-3 w-3" />
                                                                    {t("backtest.filtered")}
                                                                </button>
                                                                <button
                                                                    onClick={() => setExpandedFilteredMap(prev => ({ ...prev, [bt.id]: false }))}
                                                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${
                                                                        !(expandedFilteredMap[bt.id] ?? true) 
                                                                            ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 shadow' 
                                                                            : 'text-zinc-600 hover:text-zinc-400'
                                                                    }`}
                                                                >
                                                                    <EyeOff className="h-3 w-3" />
                                                                    {t("backtest.raw_data")}
                                                                </button>
                                                            </div>

                                                            <div className="h-6 w-px bg-white/5 hidden sm:block" />

                                                            {/* Navigation Tabs */}
                                                            <div className="flex bg-zinc-950/60 p-1 rounded-xl border border-white/5 shadow-inner">
                                                                <button
                                                                    onClick={() => setExpandedTabMap(prev => ({ ...prev, [bt.id]: 'summary' }))}
                                                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                                                                        activeSubTab === 'summary' 
                                                                            ? 'bg-white/10 text-white shadow' 
                                                                            : 'text-zinc-500 hover:text-zinc-300'
                                                                    }`}
                                                                >
                                                                    {t("backtest.summary")}
                                                                </button>
                                                                <button
                                                                    onClick={() => setExpandedTabMap(prev => ({ ...prev, [bt.id]: 'trades' }))}
                                                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                                                                        activeSubTab === 'trades' 
                                                                            ? 'bg-white/10 text-white shadow' 
                                                                            : 'text-zinc-500 hover:text-zinc-300'
                                                                    }`}
                                                                >
                                                                    {t("backtest.trades")}
                                                                </button>
                                                                <button
                                                                    onClick={() => setExpandedTabMap(prev => ({ ...prev, [bt.id]: 'chart' }))}
                                                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                                                                        activeSubTab === 'chart' 
                                                                            ? 'bg-white/10 text-white shadow' 
                                                                            : 'text-zinc-500 hover:text-zinc-300'
                                                                    }`}
                                                                >
                                                                    {t("backtest.chart")}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {isLoadingTrades ? (
                                                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                                                            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                                                            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                                                                {language === "ar" ? "جاري تحميل الصفقات..." : "Loading trade entries..."}
                                                            </p>
                                                        </div>
                                                    ) : trades.length === 0 ? (
                                                        <div className="text-center py-8 text-zinc-600 font-bold uppercase tracking-wider text-[11px]">
                                                            {t("backtest.detailed_logs")}
                                                        </div>
                                                    ) : activeSubTab === 'summary' ? (
                                                        <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                                {/* Strategy Only Analysis */}
                                                                <div className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 space-y-4 shadow-inner">
                                                                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                                                        <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">{t("backtest.strategy_only")}</h4>
                                                                        <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 text-[8px] font-bold uppercase">{t("backtest.pre_council")}</span>
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-4">
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-zinc-500 font-bold uppercase">{t("backtest.trades")}</span>
                                                                            <div className="text-lg font-mono font-black text-white">{bt.pre_council_trades || bt.total_trades}</div>
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-zinc-500 font-bold uppercase">{t("bots.table.winrate")}</span>
                                                                            <div className="text-lg font-mono font-black text-white">{formatPct(bt.pre_council_win_rate)}</div>
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-zinc-500 font-bold uppercase">{t("backtest.net_profit")}</span>
                                                                            <div className={`text-lg font-mono font-black ${((getBacktestProfitPct(bt, "pre") ?? 0) >= 0) ? "text-emerald-400" : "text-red-400"}`}>
                                                                                {formatPct(getBacktestProfitPct(bt, "pre") ?? 0)}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* With Filter Analysis */}
                                                                <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-6 space-y-4 shadow-inner backdrop-blur-sm">
                                                                    <div className="flex items-center justify-between border-b border-indigo-500/10 pb-2">
                                                                        <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">{t("backtest.with_filter")}</h4>
                                                                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 text-[8px] font-bold uppercase">{t("backtest.post_council")}</span>
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-4">
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-indigo-400/60 font-bold uppercase">{t("backtest.trades")}</span>
                                                                            <div className="text-lg font-mono font-black text-white">{bt.post_council_trades || bt.total_trades}</div>
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-indigo-400/60 font-bold uppercase">{t("bots.table.winrate")}</span>
                                                                            <div className="text-lg font-mono font-black text-emerald-400">{formatPct(bt.post_council_win_rate || bt.win_rate)}</div>
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-indigo-400/60 font-bold uppercase">{t("backtest.net_profit")}</span>
                                                                            <div className={`text-lg font-mono font-black ${((getBacktestProfitPct(bt, "post") ?? 0) >= 0) ? "text-emerald-400" : "text-red-400"}`}>
                                                                                {formatPct(getBacktestProfitPct(bt, "post") ?? 0)}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <CouncilAuditPanel bt={bt} />

                                                            <div className="flex items-center justify-center gap-16 p-8 rounded-2xl bg-white/[0.02] border border-white/5">
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    <span className="text-[10px] font-mono text-zinc-600">{bt.id.slice(0, 8)}</span>
                                                                    {bt.status_msg === "Live Bot Run" ? (
                                                                        <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full uppercase tracking-widest">{language === "ar" ? "تشغيل مباشر" : "Live Run"}</span>
                                                                    ) : (
                                                                        <span className="text-[9px] font-black text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full uppercase tracking-widest">{language === "ar" ? "اختبار عكسي" : "Backtest"}</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">{t("backtest.trade_reduction")}</span>
                                                                    <div className="text-3xl font-black text-white">
                                                                        {bt.pre_council_trades && bt.post_council_trades ?
                                                                            `-${Math.round(((bt.pre_council_trades - bt.post_council_trades) / bt.pre_council_trades) * 100)}%` :
                                                                            '—'}
                                                                    </div>
                                                                </div>
                                                                <div className="w-px h-12 bg-white/5" />
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">{t("backtest.winrate_boost")}</span>
                                                                    <div className={`text-3xl font-black ${Number(bt.post_council_win_rate) - Number(bt.pre_council_win_rate) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                                                        {bt.pre_council_win_rate && bt.post_council_win_rate ?
                                                                            `+${(bt.post_council_win_rate - bt.pre_council_win_rate).toFixed(1)}pp` :
                                                                            '—'}
                                                                    </div>
                                                                </div>
                                                                <div className="w-px h-12 bg-white/5" />
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">{t("backtest.actual_range")}</span>
                                                                    <div className="text-sm font-black text-white">
                                                                        {actualRange ? `${actualRange.start} → ${actualRange.end}` : "—"}
                                                                    </div>
                                                                    <div className="text-[10px] font-bold text-zinc-500">
                                                                        {actualRange ? (language === "ar" ? `${actualRange.days} يوم` : `${actualRange.days} days`) : ""}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : activeSubTab === 'chart' ? (
                                                        <div className="animate-in fade-in duration-300">
                                                            <TradeTimeline trades={filteredTrades} />
                                                        </div>
                                                    ) : (
                                                        <div className="rounded-2xl border border-white/5 bg-zinc-950/60 overflow-hidden shadow-inner max-h-[400px] overflow-y-auto custom-scrollbar animate-in fade-in duration-300">
                                                            <table className="w-full text-[11px] text-left border-collapse whitespace-nowrap">
                                                                <thead className="bg-zinc-950 text-zinc-500 font-black uppercase tracking-widest sticky top-0 z-10 border-b border-white/10">
                                                                    <tr>
                                                                        <th className="px-6 py-4">{t("backtest.table.symbol")}</th>
                                                                        <th className="px-6 py-4 text-center">{t("backtest.table.dates")}</th>
                                                                        <th className="px-6 py-4 text-center">{t("backtest.table.timing")}</th>
                                                                        <th className="px-6 py-4 text-right">{t("backtest.table.pricing")}</th>
                                                                        <th className="px-6 py-4 text-center">{t("backtest.table.radar_score")}</th>
                                                                        <th className="px-6 py-4 text-center">{t("backtest.table.fund_score")}</th>
                                                                        <th className="px-6 py-4 text-right">{t("backtest.table.pl_pct")}</th>
                                                                        <th className="px-6 py-4 text-center">{t("backtest.table.status")}</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-white/5 font-mono text-zinc-400">
                                                                    {filteredTrades.map((trade: any, index: number) => {
                                                                        const sym = trade.Symbol || trade.symbol || trade.features?.symbol || "-";
                                                                        const entryD = trade.Entry_Date || trade.entry_date || trade.Entry_Time || trade.entry_time || trade.features?.entry_date || "-";
                                                                        const exitD = trade.Exit_Date || trade.exit_date || trade.Exit_Time || trade.exit_time || trade.features?.exit_date || "-";
                                                                        const entryP = Number(trade.Entry_Price || trade.entry_price || trade.entry || 0);
                                                                        const exitP = Number(trade.Exit_Price || trade.exit_price || trade.exit || 0);
                                                                        
                                                                        const profitPct = getTradeProfitPct(trade);
                                                                        
                                                                        const st = trade.features?.backtest_status || trade.features?.Status || trade.Status || trade.status || "-";
                                                                        const isRejected = st === "Rejected";

                                                                        // Timing calculation
                                                                        let durationStr = "—";
                                                                        if (entryD && exitD && entryD !== "-" && exitD !== "-") {
                                                                            try {
                                                                                const entry = new Date(entryD).getTime();
                                                                                const exit = new Date(exitD).getTime();
                                                                                if (Number.isFinite(entry) && Number.isFinite(exit)) {
                                                                                    const days = Math.ceil((exit - entry) / (1000 * 60 * 60 * 24));
                                                                                    durationStr = days >= 0 ? (language === "ar" ? `${days} يوم` : `${days}d`) : "—";
                                                                                }
                                                                            } catch {}
                                                                        }

                                                                        // Radar Score calculation
                                                                        let radarScore = trade?.precision ?? trade?.Radar_Score ?? trade?.radar_score ?? trade.features?.radar_score ?? trade.features?.precision ?? trade.features?.ai_score ?? trade.features?.score ?? trade?.score ?? trade?.Score;
                                                                        let radarStr = "—";
                                                                        if (radarScore !== null && radarScore !== undefined && !Number.isNaN(Number(radarScore))) {
                                                                            const n = Number(radarScore);
                                                                            radarStr = n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
                                                                        }

                                                                        // Fund Score calculation
                                                                        let fundScore = trade?.Fund_Score ?? trade?.fund_score ?? trade.features?.fund_score ?? trade.features?.fundamental_score ?? trade?.Validator_Score ?? trade?.validator_score ?? trade.features?.validator_score;
                                                                        let fundStr = "—";
                                                                        if (fundScore !== null && fundScore !== undefined && !Number.isNaN(Number(fundScore))) {
                                                                            const n = Number(fundScore);
                                                                            fundStr = n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
                                                                        }

                                                                        return (
                                                                            <tr 
                                                                                key={index} 
                                                                                onClick={() => setSelectedTrade(trade)}
                                                                                className={`group cursor-pointer hover:bg-white/[0.04] transition-colors ${isRejected ? 'opacity-40 grayscale-[0.8]' : ''}`}
                                                                            >
                                                                                <td className="px-6 py-3.5 font-bold text-white uppercase tracking-tight">{sym}</td>
                                                                                <td className="px-6 py-3.5 text-center">
                                                                                    <div className="flex items-center justify-center gap-2 text-[10px]">
                                                                                        <span>{entryD !== "-" ? new Date(entryD).toLocaleDateString() : "-"}</span>
                                                                                        <span className="text-zinc-600">➜</span>
                                                                                        <span>{exitD !== "-" ? new Date(exitD).toLocaleDateString() : "-"}</span>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-6 py-3.5 text-center">{durationStr}</td>
                                                                                <td className="px-6 py-3.5 text-right font-semibold">
                                                                                    <div className="flex flex-col font-mono text-[10px]">
                                                                                        <span className="text-zinc-500">{t("backtest.table.in")}{entryP < 0.1 ? entryP.toFixed(8) : entryP.toFixed(2)}</span>
                                                                                        <span className="text-zinc-300 font-bold">{t("backtest.table.out")}{exitP < 0.1 ? exitP.toFixed(8) : exitP.toFixed(2)}</span>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-6 py-3.5 text-center font-bold text-zinc-200">{radarStr}</td>
                                                                                <td className="px-6 py-3.5 text-center font-bold text-zinc-200">{fundStr}</td>
                                                                                <td className={`px-6 py-3.5 text-right font-black ${profitPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                                    {profitPct > 0 ? "+" : ""}{profitPct.toFixed(1)}%
                                                                                </td>
                                                                                <td className="px-6 py-3.5 text-center">
                                                                                    <span className={`inline-block px-2.5 py-0.5 rounded text-[9px] font-black uppercase ${
                                                                                        st === "Accepted"
                                                                                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                                                                            : st === "Rejected"
                                                                                            ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                                                                            : "bg-zinc-800 text-zinc-500"
                                                                                    }`}>
                                                                                        {st === "Accepted" ? t("backtest.status.accepted") : st === "Rejected" ? t("backtest.status.rejected") : st}
                                                                                    </span>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Disclaimer Card */}
                    <div 
                        className="p-6 rounded-[2rem] bg-indigo-500/5 border border-indigo-500/10 text-center space-y-2 mt-10"
                        style={{
                            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)"
                        }}
                    >
                        <h4 className="text-xs font-black text-indigo-400 uppercase tracking-widest flex items-center justify-center gap-2">
                            <ShieldAlert className="w-4 h-4 text-indigo-400" />
                            {language === "ar" ? "تنبيه وإخلاء مسؤولية قانوني" : "Disclaimer & Risk Warning"}
                        </h4>
                        <p className="text-[10px] text-zinc-500 leading-relaxed max-w-3xl mx-auto font-sans font-medium">
                            {language === "ar" 
                                ? "جميع نتائج الاختبارات العكسية والمحاكاة التاريخية المعروضة هي نتائج افتراضية تم حسابها بناءً على البيانات التاريخية للأسعار. الأداء السابق لنماذج الذكاء الاصطناعي لا يضمن ولا يعتبر مؤشراً موثوقاً للنتائج المستقبلية. التداول والاستثمار في أسواق المال ينطوي على مخاطر عالية لخسارة رأس المال، ويجب ألا تعتمد على هذه الإشارات كنصيحة مالية أو استثمارية مباشرة." 
                                : "All backtest results and historical simulations shown are hypothetical and calculated based on past market data. Past performance of AI models does not guarantee or indicate future results. Trading and investing in financial markets carry high risks of capital loss, and these signals should not be considered direct financial or investment advice."}
                        </p>
                    </div>
                </div>
            )}
            {mounted && selectedTrade && createPortal(
                <div
                    className="fixed inset-0 z-[500] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
                    dir="rtl"
                    style={{ direction: "rtl" }}
                    role="dialog"
                    aria-modal="true"
                    aria-label={language === "ar" ? "تفاصيل الصفقة" : "Trade details"}
                >
                    <div className="absolute inset-0" onClick={() => setSelectedTrade(null)} aria-hidden="true" />
                    <div
                        className="relative z-[501] w-full max-w-4xl max-h-[calc(100vh-1.5rem)] overflow-hidden bg-zinc-950 border border-white/10 rounded-[2rem] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="p-5 border-b border-white/5 flex items-center justify-between bg-zinc-900/40">
                            <div className="flex items-center gap-3">
                                <div className="px-3 py-1.5 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs font-black">
                                    {selectedTrade.Symbol || selectedTrade.symbol || selectedTrade.features?.symbol}
                                </div>
                                <div className="text-right">
                                    <h4 className="text-sm font-black text-white uppercase tracking-tight">تفاصيل الصفقة</h4>
                                    <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">
                                        العملية {currentSymbolTradeIndex + 1} من {symbolTrades.length} في هذا السهم
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={() => setSelectedTrade(null)} 
                                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-500 hover:text-white transition-all border border-white/5"
                                aria-label={language === "ar" ? "إغلاق" : "Close"}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Smart Navigation Buttons */}
                        <div className="px-5 py-3 bg-zinc-900/20 border-b border-white/5 flex items-center justify-between" dir="ltr">
                            <button
                                disabled={currentSymbolTradeIndex <= 0}
                                onClick={() => setSelectedTrade(symbolTrades[currentSymbolTradeIndex - 1])}
                                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 disabled:opacity-30 disabled:pointer-events-none text-[10px] font-black text-white transition-all flex items-center gap-1.5"
                            >
                                {language === "ar" ? "الصفقة السابقة" : "Prev Trade"}
                            </button>
                            <span className="text-[10px] text-zinc-400 font-mono font-bold">
                                {selectedTrade.Symbol || selectedTrade.symbol || selectedTrade.features?.symbol} · {currentSymbolTradeIndex + 1} / {symbolTrades.length}
                            </span>
                            <button
                                disabled={currentSymbolTradeIndex === -1 || currentSymbolTradeIndex >= symbolTrades.length - 1}
                                onClick={() => setSelectedTrade(symbolTrades[currentSymbolTradeIndex + 1])}
                                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 disabled:opacity-30 disabled:pointer-events-none text-[10px] font-black text-white transition-all flex items-center gap-1.5"
                            >
                                {language === "ar" ? "الصفقة التالية" : "Next Trade"}
                            </button>
                        </div>

                        {/* Content / Scrollable area */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar text-right">
                            {/* Stock Chart */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between flex-row-reverse">
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                                        شارت حركة السعر — كل تحركات {selectedTrade.Symbol || selectedTrade.symbol || selectedTrade.features?.symbol} ({symbolTrades.length} صفقة)
                                    </span>
                                    <div className="flex items-center gap-3 text-[9px] font-bold text-zinc-400 flex-row-reverse">
                                        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500" />شراء</span>
                                        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-500" />بيع خسارة</span>
                                        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-emerald-300" />بيع ربح</span>
                                    </div>
                                </div>
                                <div className="h-[min(52vh,420px)] w-full rounded-2xl border border-white/5 overflow-hidden bg-[#131722]" dir="ltr">
                                    {(() => {
                                        const toUnix = (raw: string | undefined): number | null => {
                                            if (!raw) return null;
                                            if (typeof raw === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
                                                const [d, m, y] = raw.split('/');
                                                return Math.floor(new Date(`${y}-${m}-${d}`).getTime() / 1000);
                                            }
                                            const ts = new Date(raw).getTime();
                                            return Number.isNaN(ts) ? null : Math.floor(ts / 1000);
                                        };

                                        const selEntryDateRaw = selectedTrade.features?.entry_date || selectedTrade.Entry_Date || selectedTrade.entry_date || selectedTrade.features?.trade_date || selectedTrade.date;
                                        const selEntryPrice   = selectedTrade.entry_price ?? selectedTrade.entry;
                                        const focusTs         = toUnix(selEntryDateRaw) ?? undefined;

                                        const markers: any[] = [];
                                        const tradesToMark = [selectedTrade];

                                        for (const t of tradesToMark) {
                                            const entryDateRaw = t.features?.entry_date || t.Entry_Date || t.entry_date || t.features?.trade_date || t.date;
                                            const exitDateRaw  = t.features?.exit_date  || t.Exit_Date  || t.exit_date  || t.features?.trade_date || t.date;

                                            const entryTs    = toUnix(entryDateRaw);
                                            const exitTs     = toUnix(exitDateRaw);
                                            const entryPrice = t.entry_price ?? t.entry;
                                            const exitPrice  = t.exit_price  ?? t.exit;
                                            const pnl        = getTradeProfitPct(t);
                                            const isWin      = pnl > 0;

                                            const tEntryDate  = t.features?.entry_date || t.Entry_Date || t.entry_date || t.features?.trade_date || t.date;
                                            const tEntryPrice = t.entry_price ?? t.entry;
                                            const isActive    = tEntryDate === selEntryDateRaw && tEntryPrice === selEntryPrice;
                                            const size        = isActive ? 2.5 : 1.2;

                                            if (entryTs) {
                                                markers.push({
                                                    time: entryTs,
                                                    position: 'belowBar',
                                                    color: isActive ? '#10b981' : '#6ee7b7',
                                                    shape: 'arrowUp',
                                                    text: isActive ? `BUY ${entryPrice != null ? Number(entryPrice).toFixed(2) : ''}` : '',
                                                    size,
                                                });
                                            }
                                            if (exitTs) {
                                                markers.push({
                                                    time: exitTs,
                                                    position: 'aboveBar',
                                                    color: isWin ? (isActive ? '#10b981' : '#6ee7b7') : (isActive ? '#ef4444' : '#fca5a5'),
                                                    shape: 'arrowDown',
                                                    text: isActive ? `SELL ${exitPrice != null ? Number(exitPrice).toFixed(2) : ''}` : '',
                                                    size,
                                                });
                                            }
                                        }

                                        return (
                                            <TradingViewChart
                                                symbol={selectedTrade.Symbol || selectedTrade.symbol || selectedTrade.features?.symbol}
                                                exchange={selectedTrade.exchange || selectedTrade.Exchange || "EGX"}
                                                customMarkers={markers}
                                                focusTimestamp={focusTs}
                                                hideIndicators={true}
                                                showApiMarkers={false}
                                            />
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* Main Stats Grid */}
                            <div className="grid grid-cols-2 gap-4 font-sans">
                                <div className="p-3.5 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">سعر الدخول</span>
                                    <div className="text-sm font-mono font-black text-white">
                                        {(selectedTrade.entry_price !== undefined ? selectedTrade.entry_price : selectedTrade.entry)?.toFixed(2) || '—'}
                                    </div>
                                    <span className="text-[8px] text-zinc-600 block">
                                        التاريخ: {formatDate(selectedTrade.features?.entry_date || selectedTrade.features?.trade_date || selectedTrade.created_at || selectedTrade.date)}
                                    </span>
                                </div>

                                <div className="p-3.5 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">سعر الخروج</span>
                                    <div className="text-sm font-mono font-black text-white">
                                        {(selectedTrade.exit_price !== undefined ? selectedTrade.exit_price : selectedTrade.exit)?.toFixed(2) || '—'}
                                    </div>
                                    <span className="text-[8px] text-zinc-600 block">
                                        التاريخ: {formatDate(selectedTrade.features?.exit_date || selectedTrade.features?.trade_date || selectedTrade.created_at || selectedTrade.Exit_Date || selectedTrade.exit_date)}
                                    </span>
                                </div>

                                <div className="p-3.5 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">نسبة الربح/الخسارة</span>
                                    <div className={`text-base font-mono font-black ${getTradeProfitPct(selectedTrade) > 0 ? 'text-emerald-400' : (getTradeProfitPct(selectedTrade) === 0 ? 'text-zinc-500' : 'text-red-400')}`}>
                                        {getTradeProfitPct(selectedTrade) > 0 ? '+' : ''}
                                        {getTradeProfitPct(selectedTrade)?.toFixed(1)}%
                                    </div>
                                    <span className="text-[8px] text-zinc-600 block">
                                        الحالة: {selectedTrade.status || selectedTrade.Status || 'Closed'}
                                    </span>
                                </div>

                                <div className="p-3.5 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">الربح المالي</span>
                                    <div className={`text-sm font-mono font-black ${selectedTrade.features?.profit_cash >= 0 || selectedTrade.Profit_Cash >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {selectedTrade.features?.profit_cash !== undefined ? `${Math.round(selectedTrade.features.profit_cash).toLocaleString()} وحدة` : (selectedTrade.Profit_Cash !== undefined ? `${Math.round(selectedTrade.Profit_Cash).toLocaleString()} وحدة` : '—')}
                                    </div>
                                    <span className="text-[8px] text-zinc-600 block">
                                        الربح التراكمي: {selectedTrade.features?.cumulative_profit !== undefined ? Math.round(selectedTrade.features.cumulative_profit).toLocaleString() : (selectedTrade.Cumulative_Profit !== undefined ? Math.round(selectedTrade.Cumulative_Profit).toLocaleString() : '—')}
                                    </span>
                                </div>
                            </div>

                            {/* Bot Decisions / Radar & Fundamental */}
                            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3">
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider block">تقييمات البوت</span>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-[9px] text-zinc-500 font-bold uppercase block">تقييم الرادار (Radar Score)</span>
                                        <div className="text-sm font-mono font-black text-white">
                                            {(() => {
                                                let score = selectedTrade.precision ?? selectedTrade.features?.precision ?? selectedTrade.features?.radar_score ?? selectedTrade.features?.ai_score ?? selectedTrade.features?.score ?? selectedTrade.Radar_Score ?? selectedTrade.Score ?? selectedTrade.score;
                                                if (score === null || score === undefined || Number.isNaN(Number(score))) return '—';
                                                const n = Number(score);
                                                return n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
                                            })()}
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[9px] text-zinc-500 font-bold uppercase block">تقييم الأساسيات (Fund Score)</span>
                                        <div className="text-sm font-mono font-black text-white">
                                            {(() => {
                                                let score = selectedTrade.features?.fund_score ?? selectedTrade.Fund_Score ?? selectedTrade.fund_score ?? selectedTrade.features?.fundamental_score ?? selectedTrade.Validator_Score ?? selectedTrade.validator_score ?? selectedTrade.features?.validator_score;
                                                if (score === null || score === undefined || Number.isNaN(Number(score))) return '—';
                                                const n = Number(score);
                                                return n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Process Decisions Rationale */}
                            {(selectedTrade.Buy_Reason || selectedTrade.buy_reason || selectedTrade.features?.buy_reason ||
                              selectedTrade.Exit_Reason || selectedTrade.exit_reason || selectedTrade.features?.exit_reason ||
                              selectedTrade.Result || selectedTrade.result) && (
                                <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 space-y-3">
                                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-wider block">
                                        {language === "ar" ? "مبررات العملية (Rationale)" : "Trade Rationale"}
                                    </span>
                                    <div className="space-y-2 text-right">
                                        {(selectedTrade.Buy_Reason || selectedTrade.buy_reason || selectedTrade.features?.buy_reason) && (
                                            <div className="space-y-1">
                                                <span className="text-[9px] text-zinc-500 font-bold block">
                                                    {language === "ar" ? "سبب الشراء (الذكاء الاصطناعي والمؤشرات)" : "Buy Reason (AI & Indicators)"}
                                                </span>
                                                <p className="text-xs text-zinc-200 font-medium leading-relaxed font-sans">
                                                    {selectedTrade.Buy_Reason || selectedTrade.buy_reason || selectedTrade.features?.buy_reason}
                                                </p>
                                            </div>
                                        )}
                                        {(selectedTrade.Exit_Reason || selectedTrade.exit_reason || selectedTrade.features?.exit_reason || selectedTrade.Result || selectedTrade.result) && (
                                            <div className="space-y-1">
                                                <span className="text-[9px] text-zinc-500 font-bold block">
                                                    {language === "ar" ? "سبب البيع (الخروج)" : "Sell Reason (Exit)"}
                                                </span>
                                                <p className="text-xs text-zinc-200 font-medium leading-relaxed font-sans">
                                                    {selectedTrade.Exit_Reason || selectedTrade.exit_reason || selectedTrade.features?.exit_reason || selectedTrade.Result || selectedTrade.result}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Symbol Movements Timeline */}
                            <div className="space-y-3 text-right">
                                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider block">
                                    كل تحركات البوت في سهم {selectedTrade.Symbol || selectedTrade.symbol || selectedTrade.features?.symbol} ({symbolTrades.length} صفقات)
                                </span>
                                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                                    {symbolTrades.map((t: any, idx: number) => {
                                        const isActive = idx === currentSymbolTradeIndex;
                                        const isWin = getTradeProfitPct(t) > 0;
                                        const dateStr = formatDate(t.features?.entry_date || t.features?.trade_date || t.created_at || t.date);
                                        
                                        return (
                                            <div
                                                key={idx}
                                                onClick={() => setSelectedTrade(t)}
                                                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between flex-row-reverse ${
                                                    isActive 
                                                        ? 'bg-indigo-500/10 border-indigo-500/30 text-white shadow-lg' 
                                                        : 'bg-zinc-900/30 border-white/5 text-zinc-400 hover:border-white/10 hover:bg-zinc-900/50'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3 flex-row-reverse">
                                                    <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-indigo-500 animate-pulse' : 'bg-zinc-700'}`} />
                                                    <div className="flex flex-col text-right">
                                                        <span className="text-xs font-mono font-bold">{dateStr}</span>
                                                        <span className="text-[9px] text-zinc-500">
                                                            دخول: {t.entry_price?.toFixed(2) || t.entry?.toFixed(2)} | خروج: {t.exit_price?.toFixed(2) || t.exit?.toFixed(2)}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3 flex-row-reverse">
                                                    <span className={`text-xs font-mono font-black ${isWin ? 'text-emerald-400' : (getTradeProfitPct(t) === 0 ? 'text-zinc-500' : 'text-red-400')}`}>
                                                        {getTradeProfitPct(t) > 0 ? '+' : ''}
                                                        {getTradeProfitPct(t)?.toFixed(1)}%
                                                    </span>
                                                    <span className="text-[9px] uppercase font-bold text-zinc-600 bg-white/5 px-1.5 py-0.5 rounded">
                                                        صفقة #{idx + 1}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
