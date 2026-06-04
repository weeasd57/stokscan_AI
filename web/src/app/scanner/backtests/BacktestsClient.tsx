"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Loader2, Brain, Activity, UserPlus, Zap, Settings2, BarChart2, Calendar, Target, Clock, AlertTriangle, ChevronDown, Check, X, ShieldAlert, LineChart, FileText, Download, TrendingUp, Layers, Database, Play, EyeOff, UserMinus, Search, RefreshCw, ShieldCheck, HelpCircle, ArrowRightLeft, Lock, Volume2, VolumeX, Edit, Eye, Cpu, History, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getBacktests, getBacktestTrades } from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import StockLogo from "@/components/StockLogo";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { TradeTimeline } from "@/app/admin/components/TradeTimeline";
import TradingViewChart from "@/components/TradingViewChart";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";



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

export default function AIScannerPage() {
    const { user } = useAuth();
    const { t, language } = useLanguage();
    const searchParams = useSearchParams();
    const activeTab = searchParams.get("tab") === "backtests" ? "backtests" : "bots";

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
            const filtered = (data || []).filter((m: any) => {
                const name = (m.name || m.model_name || "").toUpperCase();
                const ex = (m.exchange || "").toUpperCase();
                if (name.includes("CRYPTO") || ex === "CRYPTO") return false;
                if (name.includes("COUNCIL") || name.includes("VALIDATOR") || name.includes("ADVISOR")) return false;
                if (m.model_type === "council_validator") return false;
                return true;
            });
            setModelCards(filtered);
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
                valA = a.profit_pct ?? a.post_council_profit_pct ?? a.net_profit ?? 0;
                valB = b.profit_pct ?? b.post_council_profit_pct ?? b.net_profit ?? 0;
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

            const nameUpper = (b.model_name || "").toUpperCase();
            let groupKey = "";
            if (nameUpper.includes("KING")) {
                groupKey = "KING";
            } else if (nameUpper.includes("NANO") || nameUpper.includes("NEW_MODEL")) {
                groupKey = "NANO";
            } else if (nameUpper.includes("THE BOT") || nameUpper.includes("BOT")) {
                groupKey = "THE BOT";
            } else {
                groupKey = b.model_name.replace(".pkl", "").toUpperCase();
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

            const profitPctValue = b.profit_pct ?? b.post_council_profit_pct ?? b.net_profit ?? 0;
            const winRate = b.win_rate ?? 0;
            const trades = b.total_trades ?? 0;
            const avgReturn = b.avg_return_per_trade ?? 0;

            const entry = stats[groupKey];
            entry.totalRuns += 1;
            entry.totalTrades += trades;
            entry.totalWinRate += winRate;
            entry.totalProfitPct += profitPctValue;
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
        <div className="mx-auto max-w-[1400px] w-full px-4 py-8 md:px-6 md:py-12 mt-2 min-h-[calc(100vh-200px)]">
            {/* Header Banner */}
            <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-tr from-zinc-950 via-zinc-900 to-zinc-950 p-8 md:p-12 mb-10 shadow-2xl shadow-indigo-500/5">
                <div className="absolute top-1/2 -translate-y-1/2 right-12 opacity-10 pointer-events-none hidden md:block">
                    <Image
                        src="/favicon_io/apple-touch-icon.png?v=2"
                        alt="EGX Bots logo"
                        width={200}
                        height={200}
                        className="object-contain"
                    />
                </div>
                <div className="relative z-10 max-w-2xl space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 text-xs font-black uppercase tracking-wider">
                        <Sparkles className="w-3.5 h-3.5" /> {activeTab === "backtests" ? t("backtest.model_evaluation") : t("backtest.artificial_intelligence")}
                    </div>
                    <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight leading-none uppercase">
                        {activeTab === "backtests" ? (
                            language === "ar" ? (
                                <>
                                    نتائج <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">الاختبار العكسي</span>
                                </>
                            ) : (
                                <>
                                    Backtest <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">Results</span>
                                </>
                            )
                        ) : (
                            language === "ar" ? (
                                <>
                                    الماسح الذكي <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">للتداول</span>
                                </>
                            ) : (
                                <>
                                    AI Trading <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">Scanner</span>
                                </>
                            )
                        )}
                    </h1>
                    <p className="text-zinc-400 font-medium text-sm md:text-base leading-relaxed">
                        {activeTab === "backtests"
                            ? t("backtest.subtitle")
                            : t("bots.banner_desc")}
                    </p>
                </div>
            </div>

            {/* TAB CONTENT: BOTS */}
            {activeTab === "bots" && (
                <div className="space-y-6">
                    {botsLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Loading AI Bots...</p>
                        </div>
                    ) : botsError ? (
                        <div className="p-6 rounded-3xl border border-red-500/10 bg-red-500/5 text-red-400 text-sm text-center">
                            {botsError}
                        </div>
                    ) : bots.length === 0 ? (
                        <div className="p-12 text-center rounded-[2.5rem] border border-white/5 bg-zinc-950/20 text-zinc-600 font-bold uppercase tracking-wider">
                            No active AI bots created by Admin yet.
                        </div>
                    ) : (
                        <>
                            {/* Model Artifacts Section */}
                            <div className="p-8 rounded-3xl bg-zinc-900 border border-zinc-800 flex flex-col h-full space-y-6">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                                            <Database className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h2 className="text-xl font-black text-white">{t("model.artifacts")}</h2>
                                            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-1">{t("model.available")}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 min-h-[300px]">
                                    {modelsLoading && modelCards.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-10 gap-4 text-zinc-600 grayscale">
                                            <Loader2 className="w-8 h-8 animate-spin" />
                                            <p className="text-xs font-bold uppercase tracking-widest">{t("backtest.loading_models")}</p>
                                        </div>
                                    ) : modelCards.length === 0 ? (
                                        <div className="text-center py-10 text-zinc-500 text-xs font-bold uppercase tracking-wider">
                                            {t("backtest.no_models_found")}
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pr-2 custom-scrollbar">
                                            {modelCards.map((model) => (
                                                <div
                                                    key={model.name}
                                                    className="p-6 rounded-3xl bg-zinc-950 border border-zinc-800/50 hover:border-zinc-700/80 transition-all flex flex-col justify-between group h-full space-y-6 relative overflow-hidden"
                                                >
                                                    {/* Background Image Layer */}
                                                    {model.name.toUpperCase().includes("KING") ? (
                                                        <div 
                                                            className="absolute inset-0 bg-cover bg-center opacity-[0.08] pointer-events-none transition-transform duration-700 group-hover:scale-105" 
                                                            style={{ backgroundImage: "url('/king_logo.jpg')" }} 
                                                        />
                                                    ) : model.name.toUpperCase().includes("NEW_MODEL") ? (
                                                        <div 
                                                            className="absolute inset-0 bg-cover bg-center opacity-[0.08] pointer-events-none transition-transform duration-700 group-hover:scale-105" 
                                                            style={{ backgroundImage: "url('/new_model_logo.jpg')" }} 
                                                        />
                                                    ) : null}

                                                    {/* Gradient overlay for readability */}
                                                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-transparent pointer-events-none" />

                                                    <div className="flex flex-col justify-between h-full space-y-6 relative z-10">
                                                        <div className="space-y-4">
                                                            <div className="flex items-center justify-between">
                                                                 <div className="p-2.5 rounded-xl bg-zinc-900/80 text-zinc-500 border border-white/5 transition-all group-hover:bg-indigo-500/10 group-hover:text-indigo-400 group-hover:border-indigo-500/20">
                                                                    <Brain className="w-5 h-5" />
                                                                </div>
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="text-base font-black text-zinc-100 truncate">{model.name}</div>
                                                                {model.exchange && (
                                                                    <div className="text-[10px] text-indigo-400 uppercase font-black tracking-widest mt-1">{model.exchange}</div>
                                                                )}
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <div className="p-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                                                                    <div className="text-[10px] text-zinc-600 uppercase font-bold">{t("model.size")}</div>
                                                                    <div className="text-xs font-mono text-zinc-400">{model.size_mb} MB</div>
                                                                </div>
                                                                <div className="p-2.5 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
                                                                    <div className="text-[10px] text-zinc-600 uppercase font-bold">{t("model.modified")}</div>
                                                                    <div className="text-xs text-zinc-400">{new Date(model.modified_at).toLocaleDateString()}</div>
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {model.num_features !== undefined && (
                                                                    <span className="text-[10px] bg-indigo-600/20 text-indigo-300 px-2 py-1 rounded-lg font-bold">
                                                                        {model.num_features} {t("model.features")}
                                                                    </span>
                                                                )}
                                                                {model.num_parameters !== undefined && model.num_parameters > 0 && (
                                                                    <span className="text-[10px] bg-amber-600/20 text-amber-300 px-2 py-1 rounded-lg font-bold">
                                                                        {model.bestIteration ? `${model.bestIteration} ${t("model.trees")}` : `${model.num_parameters} ${t("model.trees")}`}
                                                                    </span>
                                                                )}
                                                                {typeof model.trainingSamples === "number" && model.trainingSamples > 0 && (
                                                                    <span className="text-[10px] bg-emerald-600/20 text-emerald-300 px-2 py-1 rounded-lg font-bold">
                                                                        {model.trainingSamples} {t("model.samples")}
                                                                    </span>
                                                                )}
                                                                {model.learning_rate !== undefined && (
                                                                    <span className="text-[10px] bg-sky-600/20 text-sky-300 px-2 py-1 rounded-lg font-bold">
                                                                        {t("model.lr")}: {model.learning_rate}
                                                                    </span>
                                                                )}
                                                                {model.uses_exchange_index_json && (
                                                                    <span className="text-[10px] bg-purple-600/20 text-purple-300 px-2 py-1 rounded-lg font-bold">
                                                                        {t("model.index_json")}
                                                                    </span>
                                                                )}
                                                                {model.uses_fundamentals && (
                                                                    <span className="text-[10px] bg-emerald-600/20 text-emerald-300 px-2 py-1 rounded-lg font-bold">
                                                                        {t("model.fundamentals")}
                                                                    </span>
                                                                )}
                                                                {model.has_meta_labeling && (
                                                                    <span className="text-[10px] bg-amber-600/20 text-amber-300 px-2 py-1 rounded-lg font-bold">
                                                                        {t("model.meta_labeling")}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {(model.precision !== undefined || model.recall !== undefined || model.auc !== undefined) && (
                                                            <div className="px-4 py-2.5 rounded-2xl bg-zinc-900/10 border border-zinc-800/30 grid grid-cols-4 gap-1">
                                                                <div className="flex flex-col items-center justify-center">
                                                                    <span className="text-[8px] text-zinc-600 uppercase font-black">P</span>
                                                                    <span className={`text-[10px] font-black ${model.precision && model.precision > 0.6 ? 'text-emerald-400' : 'text-zinc-400'}`}>
                                                                        {model.precision ? (model.precision * 100).toFixed(1) : "0"}%
                                                                    </span>
                                                                </div>
                                                                <div className="flex flex-col items-center justify-center border-l border-zinc-800/50">
                                                                    <span className="text-[8px] text-zinc-600 uppercase font-black">R</span>
                                                                    <span className={`text-[10px] font-black ${model.recall && model.recall > 0.6 ? 'text-emerald-400' : 'text-zinc-400'}`}>
                                                                        {model.recall ? (model.recall * 100).toFixed(1) : "0"}%
                                                                    </span>
                                                                </div>
                                                                <div className="flex flex-col items-center justify-center border-l border-zinc-800/50">
                                                                    <span className="text-[8px] text-zinc-600 uppercase font-black">F1</span>
                                                                    <span className="text-[10px] text-zinc-400 font-black">
                                                                        {model.f1 ? (model.f1 * 100).toFixed(1) : "0"}%
                                                                    </span>
                                                                </div>
                                                                <div className="flex flex-col items-center justify-center border-l border-zinc-800/50">
                                                                    <span className="text-[8px] text-zinc-600 uppercase font-black">AUC</span>
                                                                    <span className={`text-[10px] font-black ${model.auc && model.auc > 0.65 ? 'text-indigo-400' : 'text-zinc-400'}`}>
                                                                        {model.auc ? model.auc.toFixed(2) : "0.5"}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        )}

                                                        <div className="pt-4 border-t border-zinc-800/50 grid grid-cols-3 gap-2">
                                                            {model.target_pct !== undefined && (
                                                                <div className="text-center">
                                                                    <div className="text-[9px] text-zinc-600 uppercase font-bold">{t("model.target")}</div>
                                                                    <div className="text-[11px] text-emerald-400 font-black">{(model.target_pct * 100).toFixed(0)}%</div>
                                                                </div>
                                                            )}
                                                            {model.stop_loss_pct !== undefined && (
                                                                <div className="text-center">
                                                                    <div className="text-[9px] text-zinc-600 uppercase font-bold">{t("model.stop")}</div>
                                                                    <div className="text-[11px] text-rose-400 font-black">{(model.stop_loss_pct * 100).toFixed(0)}%</div>
                                                                </div>
                                                            )}
                                                            {model.look_forward_days !== undefined && (
                                                                <div className="text-center">
                                                                    <div className="text-[9px] text-zinc-600 uppercase font-bold">{t("model.days")}</div>
                                                                    <div className="text-[11px] text-sky-400 font-black">{model.look_forward_days}d</div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Free limit info alert */}
                            {user && (
                                <div className={`flex items-center justify-between p-4 rounded-2xl border text-[11px] font-bold uppercase tracking-wider mt-8 ${
                                    isPro 
                                        ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-400"
                                        : "bg-indigo-500/5 border-indigo-500/10 text-indigo-400"
                                }`}>
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="w-4.5 h-4.5" />
                                        <span>
                                            {isPro 
                                                ? (language === "ar" ? `اشتراكات البوت النشطة: ${activeSubCount} (خطة برو - اشتراك غير محدود)` : `Active Bot Subscriptions: ${activeSubCount} (Pro Plan - Unlimited)`)
                                                : t("bots.free_limit").replace("{count}", activeSubCount.toString())
                                            }
                                        </span>
                                    </div>
                                    {!isPro && activeSubCount >= 2 && (
                                        <span className="text-amber-400 text-[10px]">{t("bots.limit_reached")}</span>
                                    )}
                                </div>
                            )}

                            {filteredBots.length === 0 ? (
                                <div className="p-12 text-center rounded-[2.5rem] border border-white/5 bg-zinc-950/20 text-zinc-500 font-bold uppercase tracking-wider text-[11px] min-h-[150px] flex items-center justify-center">
                                    {t("bots.no_active")}
                                </div>
                            ) : (
                                /* Admin-style Bot Overview Table */
                                <div className="bg-zinc-900/40 border border-white/5 rounded-3xl backdrop-blur-xl overflow-hidden shadow-2xl relative">
                                    {/* Table Header Bar */}
                                    <div className="p-6 border-b border-white/5 flex items-center justify-between bg-zinc-950/50 relative z-10">
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                                                <Layers className="w-5 h-5 text-indigo-400" />
                                            </div>
                                            <div>
                                                <h2 className="text-lg font-black text-white uppercase tracking-wider">{t("bots.title")}</h2>
                                                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">{t("bots.subtitle")}</p>
                                            </div>
                                        </div>
                                        <div className="hidden sm:flex items-center gap-2">
                                            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{filteredBots.length} {language === "ar" ? "بوت" : (filteredBots.length !== 1 ? "Bots" : "Bot")}</span>
                                        </div>
                                    </div>

                                    {/* Desktop Table View */}
                                    <div className="hidden lg:block overflow-x-auto w-full relative z-10 custom-scrollbar">
                                        <table className="w-full text-left whitespace-nowrap">
                                            <thead className="bg-zinc-950/80 border-b border-white/5 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                                                <tr>
                                                    <th className="px-6 py-5">{t("bots.table.identity")}</th>
                                                    <th className="px-6 py-5 text-center">{t("bots.table.status")}</th>
                                                    <th className="px-6 py-5 text-center">{t("bots.table.mode")}</th>
                                                    <th className="px-6 py-5 text-center">{t("bots.table.config")}</th>
                                                    <th className="px-6 py-5 text-center">{t("bots.table.model")}</th>
                                                    <th className="px-6 py-5 text-center">{t("bots.table.trades")}</th>
                                                    <th className="px-6 py-5 text-center">{t("bots.table.winrate")}</th>
                                                    <th className="px-6 py-5 text-right">{t("bots.table.net_pl")}</th>
                                                    <th className="px-6 py-5 text-right">{t("bots.table.action")}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {filteredBots.map((bot) => {
                                                    const isSubbed = !!bot.is_subscribed;
                                                    const isLimitReached = !isPro && activeSubCount >= 2;
                                                    const isLoading = submittingBotId === bot.bot_id;
                                                    const pnl = bot.total_pnl || 0;
                                                    const isProfitable = pnl >= 0;
                                                    const tradingMode = bot.trading_mode || "aggressive";
                                                    const modeConfig = tradingMode === "defensive"
                                                        ? { emoji: "🛡️", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" }
                                                        : tradingMode === "hybrid"
                                                        ? { emoji: "🔄", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" }
                                                        : { emoji: "⚔️", color: "bg-red-500/10 text-red-400 border-red-500/20" };

                                                    // Determine model name from bot properties
                                                    const kingModelName = bot.king_model_path
                                                        ? bot.king_model_path.split("/").pop()?.replace(".pkl", "") ?? "—"
                                                        : "—";

                                                    return (
                                                        <tr
                                                            key={bot.bot_id}
                                                            className={`transition-colors group ${isSubbed ? "bg-indigo-500/[0.04] hover:bg-indigo-500/[0.08]" : "hover:bg-white/[0.02]"}`}
                                                        >
                                                            {/* Bot Identity */}
                                                            <td className="px-6 py-5">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center border border-white/10 shadow-lg shadow-blue-500/20 flex-shrink-0">
                                                                        <Brain className="w-5 h-5 text-white" />
                                                                    </div>
                                                                    <div className="flex flex-col gap-0.5">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-sm font-black text-zinc-200 tracking-tight uppercase">{bot.name}</span>
                                                                            {isSubbed && (
                                                                                <span className="text-[8px] px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400 font-bold uppercase tracking-widest border border-indigo-500/20">
                                                                                    {t("bots.subscribed")}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <span className="text-[10px] font-mono text-zinc-600 truncate max-w-[150px]">{bot.bot_id}</span>
                                                                    </div>
                                                                </div>
                                                            </td>

                                                            {/* Status */}
                                                            <td className="px-6 py-5 text-center">
                                                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${bot.status === "running" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-800 text-zinc-400 border-white/5"}`}>
                                                                    {bot.status === "running" ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />}
                                                                    {bot.status === "running" ? t("bots.status.running") : t("bots.status.stopped")}
                                                                </span>
                                                            </td>

                                                            {/* Trading Mode */}
                                                            <td className="px-6 py-5 text-center">
                                                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${modeConfig.color}`}>
                                                                    <span>{modeConfig.emoji}</span>
                                                                    {t("bots.mode." + tradingMode)}
                                                                </span>
                                                            </td>

                                                            {/* Config */}
                                                            <td className="px-6 py-5 text-center">
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <span className="font-mono text-indigo-400 font-black text-[10px] uppercase bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">{bot.timeframe || "1Hour"}</span>
                                                                    <div className="flex items-center gap-1 font-mono text-[9px]">
                                                                        <span className="text-emerald-400 font-bold">{language === "ar" ? "الهدف" : "T"}:{Math.round((bot.target_pct || 0.10) * 100)}%</span>
                                                                        <span className="text-zinc-700">|</span>
                                                                        <span className="text-red-400 font-bold">{language === "ar" ? "الوقف" : "SL"}:{Math.round((bot.stop_loss_pct || 0.035) * 100)}%</span>
                                                                    </div>
                                                                    {bot.use_council && (
                                                                        <span className="text-[8px] text-zinc-500 font-bold">{t("backtest.council")} {bot.council_threshold ?? 0.25}</span>
                                                                    )}
                                                                </div>
                                                            </td>

                                                            {/* Model */}
                                                            <td className="px-6 py-5 text-center">
                                                                <div className="flex items-center justify-center gap-2">
                                                                    {kingModelName.toUpperCase().includes("KING") ? (
                                                                        <div className="w-5 h-5 rounded-md overflow-hidden border border-white/10 shrink-0">
                                                                            <img src="/king_logo.jpg" alt="KING" className="w-full h-full object-cover" />
                                                                        </div>
                                                                    ) : kingModelName.toUpperCase().includes("NEW_MODEL") ? (
                                                                        <div className="w-5 h-5 rounded-md overflow-hidden border border-white/10 shrink-0">
                                                                            <img src="/new_model_logo.jpg" alt="NEW_MODEL" className="w-full h-full object-cover" />
                                                                        </div>
                                                                    ) : null}
                                                                    <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900 px-2 py-1 rounded border border-white/5 truncate max-w-[120px] inline-block">{kingModelName}</span>
                                                                </div>
                                                            </td>

                                                            {/* Trades */}
                                                            <td className="px-6 py-5 text-center">
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-sm font-black text-white font-mono">{bot.trades_count}</span>
                                                                    {bot.status === "running" && bot.started_at ? (
                                                                        <span className="text-[9px] font-black text-indigo-400/80 uppercase tracking-widest mt-0.5">
                                                                            {(() => {
                                                                                const start = new Date(bot.started_at).getTime();
                                                                                const diff = new Date().getTime() - start;
                                                                                const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
                                                                                return t("bots.active_days").replace("{days}", days.toString());
                                                                            })()}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mt-0.5">
                                                                            {t("bots.inactive")}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>

                                                            {/* Win Rate */}
                                                            <td className="px-6 py-5 text-center">
                                                                <span className="text-sm font-black font-mono text-emerald-400">
                                                                    {formatNum(bot.win_rate, 1)}%
                                                                </span>
                                                            </td>

                                                            {/* Net P/L */}
                                                            <td className="px-6 py-5 text-right">
                                                                <span className={`text-sm font-black font-mono ${pnl === 0 ? "text-zinc-500" : isProfitable ? "text-emerald-400" : "text-red-400"}`}>
                                                                    {isProfitable ? "+" : ""}{formatNum(pnl, 2)}%
                                                                </span>
                                                            </td>

                                                            {/* Action */}
                                                            <td className="px-6 py-5 text-right">
                                                                {!user ? (
                                                                    <Link
                                                                        href="/login"
                                                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-black text-[9px] uppercase tracking-widest hover:bg-white/10 transition-all duration-300"
                                                                    >
                                                                        <Lock className="w-3 h-3 text-zinc-500" />
                                                                        {t("bots.btn.login")}
                                                                    </Link>
                                                                ) : isSubbed ? (
                                                                    <button
                                                                        onClick={() => handleUnsubscribe(bot.bot_id)}
                                                                        disabled={isLoading}
                                                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-black text-[9px] uppercase tracking-widest hover:bg-red-500/20 transition-all duration-300 disabled:opacity-50"
                                                                    >
                                                                        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserMinus className="w-3 h-3" />}
                                                                        {t("bots.btn.unsub")}
                                                                    </button>
                                                                ) : (
                                                                    <button
                                                                        onClick={() => handleSubscribe(bot.bot_id)}
                                                                        disabled={isLoading || (isLimitReached && !isSubbed)}
                                                                        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all duration-300 ${
                                                                            isLimitReached && !isSubbed
                                                                                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/5"
                                                                                : "bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-lg hover:shadow-indigo-500/15 border border-transparent"
                                                                        }`}
                                                                    >
                                                                        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                                                                        {t("bots.btn.subscribe")}
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Mobile Card View (< lg) */}
                                    <div className="lg:hidden divide-y divide-white/5">
                                        {filteredBots.map((bot) => {
                                            const isSubbed = !!bot.is_subscribed;
                                            const isLimitReached = !isPro && activeSubCount >= 2;
                                            const isLoading = submittingBotId === bot.bot_id;
                                            const pnl = bot.total_pnl || 0;
                                            const isProfitable = pnl >= 0;
                                            const tradingMode = bot.trading_mode || "aggressive";
                                            const modeConfig = tradingMode === "defensive"
                                                ? { emoji: "🛡️", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" }
                                                : tradingMode === "hybrid"
                                                ? { emoji: "🔄", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" }
                                                : { emoji: "⚔️", color: "bg-red-500/10 text-red-400 border-red-500/20" };
                                            const kingModelName = bot.king_model_path
                                                ? bot.king_model_path.split("/").pop()?.replace(".pkl", "") ?? "—"
                                                : "—";

                                            return (
                                                <div key={bot.bot_id} className={`p-6 space-y-5 ${isSubbed ? "bg-indigo-500/[0.04]" : ""}`}>
                                                    {/* Top: Identity + Status */}
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center border border-white/10 shadow-lg shadow-blue-500/20 flex-shrink-0">
                                                                <Brain className="w-5 h-5 text-white" />
                                                            </div>
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <h3 className="text-sm font-black text-white uppercase tracking-tight">{bot.name}</h3>
                                                                    {isSubbed && (
                                                                        <span className="text-[8px] px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400 font-bold uppercase border border-indigo-500/20">
                                                                            {t("bots.subscribed")}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className="text-[10px] font-mono text-zinc-600">{bot.bot_id}</span>
                                                            </div>
                                                        </div>
                                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${bot.status === "running" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-800 text-zinc-400 border-white/5"}`}>
                                                            {bot.status === "running" ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />}
                                                            {bot.status === "running" ? t("bots.status.running") : t("bots.status.stopped")}
                                                        </span>
                                                    </div>

                                                    {/* Badges Row: Mode + TF + Target/SL */}
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${modeConfig.color}`}>
                                                            <span>{modeConfig.emoji}</span>{t("bots.mode." + tradingMode)}
                                                        </span>
                                                        <span className="font-mono text-indigo-400 font-black text-[10px] uppercase bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">{bot.timeframe || "1Hour"}</span>
                                                        <div className="flex items-center gap-1 font-mono text-[9px] bg-zinc-950/50 px-2.5 py-1 rounded-full border border-white/5">
                                                            <span className="text-emerald-400 font-bold">{language === "ar" ? "الهدف" : "T"}:{Math.round((bot.target_pct || 0.10) * 100)}%</span>
                                                            <span className="text-zinc-700">|</span>
                                                            <span className="text-red-400 font-bold">{language === "ar" ? "الوقف" : "SL"}:{Math.round((bot.stop_loss_pct || 0.035) * 100)}%</span>
                                                        </div>
                                                        {bot.use_council && (
                                                            <span className="text-[9px] text-zinc-500 font-bold bg-zinc-900 px-2.5 py-1 rounded-full border border-white/5">{t("backtest.council")} {bot.council_threshold ?? 0.25}</span>
                                                        )}
                                                         <div className="flex items-center gap-1.5 bg-zinc-900 px-2 py-1 rounded border border-white/5 w-fit">
                                                             {kingModelName.toUpperCase().includes("KING") ? (
                                                                 <div className="w-4 h-4 rounded overflow-hidden border border-white/10 shrink-0">
                                                                     <img src="/king_logo.jpg" alt="KING" className="w-full h-full object-cover" />
                                                                 </div>
                                                             ) : kingModelName.toUpperCase().includes("NEW_MODEL") ? (
                                                                 <div className="w-4 h-4 rounded overflow-hidden border border-white/10 shrink-0">
                                                                     <img src="/new_model_logo.jpg" alt="NEW_MODEL" className="w-full h-full object-cover" />
                                                                 </div>
                                                             ) : null}
                                                             <span className="text-[10px] font-mono text-zinc-400 truncate max-w-[110px]">{kingModelName}</span>
                                                         </div>
                                                    </div>

                                                    {/* Stats Grid */}
                                                    <div className="grid grid-cols-3 gap-2 bg-black/20 rounded-2xl p-4 border border-white/5">
                                                        <div className="text-center">
                                                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{t("bots.table.winrate")}</p>
                                                            <p className="font-mono text-sm font-black text-emerald-400">{formatNum(bot.win_rate, 1)}%</p>
                                                        </div>
                                                        <div className="text-center border-x border-white/5">
                                                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{t("bots.table.net_pl")}</p>
                                                            <p className={`font-mono text-sm font-black ${isProfitable ? "text-emerald-400" : "text-red-400"}`}>
                                                                {isProfitable ? "+" : ""}{formatNum(pnl, 2)}%
                                                            </p>
                                                        </div>
                                                        <div className="text-center">
                                                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{t("bots.table.trades")}</p>
                                                            <p className="font-mono text-sm font-black text-zinc-100">{bot.trades_count}</p>
                                                            {bot.status === "running" && bot.started_at ? (
                                                                <p className="text-[8px] font-black text-indigo-400/80 uppercase tracking-widest mt-0.5">
                                                                    {(() => {
                                                                        const start = new Date(bot.started_at).getTime();
                                                                        const diff = new Date().getTime() - start;
                                                                        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
                                                                        return t("bots.active_days").replace("{days}", days.toString());
                                                                    })()}
                                                                </p>
                                                            ) : (
                                                                <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mt-0.5">
                                                                    {t("bots.inactive")}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Action */}
                                                    <div>
                                                        {!user ? (
                                                            <Link
                                                                href="/login"
                                                                className="w-full h-11 flex items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white font-black text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all duration-300"
                                                            >
                                                                <Lock className="w-3.5 h-3.5 mr-2 text-zinc-500" />
                                                                {t("bots.btn.login_to_sub")}
                                                            </Link>
                                                        ) : isSubbed ? (
                                                            <button
                                                                onClick={() => handleUnsubscribe(bot.bot_id)}
                                                                disabled={isLoading}
                                                                className="w-full h-11 flex items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-black text-[10px] uppercase tracking-widest hover:bg-red-500/25 transition-all duration-300 disabled:opacity-50"
                                                            >
                                                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserMinus className="w-4 h-4 mr-2" />}
                                                                {t("bots.btn.unsubscribe")}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleSubscribe(bot.bot_id)}
                                                                disabled={isLoading || (isLimitReached && !isSubbed)}
                                                                className={`w-full h-11 flex items-center justify-center rounded-xl font-black text-[10px] uppercase tracking-widest transition-all duration-300 ${
                                                                    isLimitReached && !isSubbed
                                                                        ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-white/5"
                                                                        : "bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-lg hover:shadow-indigo-500/15 border border-transparent"
                                                                }`}
                                                            >
                                                                {isLoading ? (
                                                                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                                                ) : (
                                                                    <UserPlus className="w-4 h-4 mr-2" />
                                                                )}
                                                                {t("bots.btn.subscribe")}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
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
                                    
                                const themes = [
                                    { bg: "bg-purple-500/10 border-purple-500/25 text-purple-400", badge: "bg-purple-500/20 text-purple-400 border border-purple-500/20", icon: Sparkles },
                                    { bg: "bg-pink-500/10 border-pink-500/25 text-pink-400", badge: "bg-pink-500/20 text-pink-400 border border-pink-500/20", icon: Activity },
                                    { bg: "bg-blue-500/10 border-blue-500/25 text-blue-400", badge: "bg-blue-500/20 text-blue-400 border border-blue-500/20", icon: LineChart },
                                ];
                                const fallbackTheme = themes[idx % themes.length];
                                    
                                const themeClass = isKing 
                                    ? "bg-amber-500/10 border-amber-500/25 text-amber-400" 
                                    : isNano 
                                    ? "bg-indigo-500/10 border-indigo-500/25 text-indigo-400" 
                                    : isTheBot
                                    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400"
                                    : fallbackTheme.bg;
                                    
                                const badgeClass = isKing 
                                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/20" 
                                    : isNano 
                                    ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/20" 
                                    : isTheBot
                                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                                    : fallbackTheme.badge;
                                    
                                const IconComp = isKing ? Brain : isNano ? Cpu : isTheBot ? Zap : fallbackTheme.icon;
                                
                                const displayName = stat.modelName === "KING"
                                    ? (language === "ar" ? "موديل KING الملكي" : "KING Model")
                                    : stat.modelName === "NANO"
                                    ? (language === "ar" ? "موديل NANO الذكي" : "NANO Model")
                                    : stat.modelName === "THE BOT"
                                    ? (language === "ar" ? "موديل THE BOT" : "THE BOT Model")
                                    : stat.modelName;

                                const badgeName = isKing 
                                    ? (language === "ar" ? "مميز" : "Premium") 
                                    : isNano 
                                    ? (language === "ar" ? "لايت" : "Lite") 
                                    : (language === "ar" ? "أساسي" : "Standard");
                                
                                return (
                                    <div 
                                        key={stat.modelName}
                                        className="relative overflow-hidden rounded-[2rem] border border-white/5 bg-gradient-to-br from-zinc-950 to-zinc-900/40 p-6 shadow-2xl flex flex-col justify-between group"
                                    >
                                        {/* Background Logo Layer */}
                                        <div 
                                            className="absolute inset-0 bg-cover bg-center opacity-[0.05] pointer-events-none transition-transform duration-700 group-hover:scale-105" 
                                            style={{ backgroundImage: `url('${logoUrl}')` }} 
                                        />
                                        
                                        {/* Header */}
                                        <div className="relative z-10 flex items-center justify-between mb-6">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2.5 rounded-xl border flex items-center justify-center shrink-0 ${themeClass}`}>
                                                    <IconComp className="w-5 h-5" />
                                                </div>
                                                <div>
                                                    <h3 className="text-sm md:text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                                                        {displayName}
                                                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${badgeClass}`}>
                                                            {badgeName}
                                                        </span>
                                                    </h3>
                                                    <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">
                                                        {language === "ar" ? "إحصائيات الأداء التاريخي التراكمي" : "Cumulative Historical Performance Overview"}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Stats Grid */}
                                        <div className="relative z-10 grid grid-cols-2 sm:grid-cols-5 gap-3 mt-auto">
                                            {/* Runs */}
                                            <div className="p-3 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col justify-between shadow-inner">
                                                <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                                                    {t("backtest.stats.total_runs")}
                                                </span>
                                                <span className="font-mono text-sm font-black text-zinc-200">
                                                    {stat.totalRuns}
                                                </span>
                                            </div>

                                            {/* Trades */}
                                            <div className="p-3 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col justify-between shadow-inner">
                                                <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                                                    {t("backtest.stats.total_trades")}
                                                </span>
                                                <span className="font-mono text-sm font-black text-zinc-200">
                                                    {stat.totalTrades}
                                                </span>
                                            </div>

                                            {/* Win Rate */}
                                            <div className="p-3 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col justify-between shadow-inner">
                                                <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                                                    {t("backtest.stats.win_rate")}
                                                </span>
                                                <span className="font-mono text-sm font-black text-emerald-400">
                                                    {stat.winRate.toFixed(1)}%
                                                </span>
                                            </div>

                                            {/* Net Profit */}
                                            <div className="p-3 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col justify-between shadow-inner col-span-1 sm:col-span-1">
                                                <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                                                    {t("backtest.stats.avg_profit")}
                                                </span>
                                                <span className={`font-mono text-sm font-black ${stat.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                    {stat.netProfit >= 0 ? "+" : ""}{stat.netProfit.toFixed(2)}%
                                                </span>
                                            </div>

                                            {/* Avg Return */}
                                            <div className="p-3 rounded-2xl bg-zinc-900/40 border border-white/5 flex flex-col justify-between shadow-inner col-span-2 sm:col-span-1">
                                                <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                                                    {t("backtest.stats.avg_return")}
                                                </span>
                                                <span className={`font-mono text-sm font-black ${stat.avgReturnPerTrade >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                    {stat.avgReturnPerTrade >= 0 ? "+" : ""}{stat.avgReturnPerTrade.toFixed(2)}%
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Comparative Performance Chart */}
                    {modelStats.length > 0 && (
                        <div className="relative overflow-hidden rounded-[2rem] border border-white/5 bg-gradient-to-br from-zinc-950 via-zinc-900/40 to-zinc-950 p-6 shadow-2xl mb-8">
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
                                        {language === "ar" ? "متوسط الأرباح" : "Avg Net Profit"}
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
                                            <Tooltip 
                                                cursor={{ fill: 'rgba(255, 255, 255, 0.02)' }}
                                                content={({ active, payload }) => {
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
                                                                            ? (language === "ar" ? "متوسط الأرباح" : "Avg Net Profit") 
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
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-[2rem] bg-zinc-900/30 border border-white/5 backdrop-blur-xl mb-6">
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
                                <option value="net_profit">{language === "ar" ? "ترتيب بصافي الأرباح" : "Sort by Net Profit"}</option>
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
                                // Calculate profit metrics based on where the backtest comes from
                                const profitPctValue = bt.profit_pct ?? bt.post_council_profit_pct ?? bt.net_profit;
                                const cashProfitValue = bt.profit_pct !== undefined || bt.post_council_profit_pct !== undefined ? bt.net_profit : null;
                                
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
                                                                            <div className={`text-lg font-mono font-black ${(Number(bt.pre_council_profit_pct) || Number(bt.profit_pct) || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                                {formatPct(bt.pre_council_profit_pct || bt.profit_pct)}
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
                                                                            <div className={`text-lg font-mono font-black ${(Number(bt.post_council_profit_pct) || Number(bt.profit_pct) || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                                {formatPct(bt.post_council_profit_pct || bt.profit_pct)}
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
                                                                        let radarScore = trade?.Radar_Score ?? trade?.radar_score ?? trade.features?.radar_score ?? trade.features?.ai_score ?? trade.features?.score ?? trade?.score ?? trade?.Score;
                                                                        let radarStr = "—";
                                                                        if (radarScore !== null && radarScore !== undefined && !Number.isNaN(Number(radarScore))) {
                                                                            const n = Number(radarScore);
                                                                            radarStr = n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
                                                                        }

                                                                        // Fund Score calculation
                                                                        let fundScore = trade?.Fund_Score ?? trade?.fund_score ?? trade.features?.fund_score ?? trade.features?.fundamental_score ?? trade?.Validator_Score;
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
                </div>
            )}
            {selectedTrade && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" dir="rtl" style={{ direction: 'rtl' }}>
                    <div className="absolute inset-0" onClick={() => setSelectedTrade(null)} />
                    <div className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden bg-zinc-950 border border-white/10 rounded-[2rem] shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
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
                            >
                                <ChevronDown className="h-4 w-4 rotate-180" />
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
                                <div className="h-[300px] w-full rounded-2xl border border-white/5 overflow-hidden bg-[#131722]" dir="ltr">
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
                                        const tradesToMark = symbolTrades.length > 0 ? symbolTrades : [selectedTrade];

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
                                                let score = selectedTrade.features?.radar_score ?? selectedTrade.features?.ai_score ?? selectedTrade.features?.score ?? selectedTrade.Radar_Score ?? selectedTrade.Score ?? selectedTrade.score;
                                                if (score === null || score === undefined) return '—';
                                                return score <= 1 ? `${(score * 100).toFixed(1)}%` : `${score.toFixed(1)}%`;
                                            })()}
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[9px] text-zinc-500 font-bold uppercase block">تقييم الأساسيات (Fund Score)</span>
                                        <div className="text-sm font-mono font-black text-white">
                                            {(() => {
                                                let score = selectedTrade.features?.fund_score ?? selectedTrade.Fund_Score ?? selectedTrade.fund_score;
                                                if (score === null || score === undefined) return '—';
                                                return score <= 1 ? `${(score * 100).toFixed(1)}%` : `${score.toFixed(1)}%`;
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            </div>

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
                </div>
            )}
        </div>
    );
}
