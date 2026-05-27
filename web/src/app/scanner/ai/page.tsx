"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Brain, TrendingUp, AlertTriangle, Check, Loader2, Sparkles, RefreshCw, BarChart2, Calendar, Percent, ShieldCheck, HelpCircle, ArrowRightLeft, Lock, Volume2, VolumeX, Edit, Layers, Clipboard, ExternalLink, UserPlus, UserMinus, LineChart, Eye, EyeOff, Activity, Cpu } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getBacktests } from "@/lib/api";
import StockLogo from "@/components/StockLogo";
import Link from "next/link";
import { TradeTimeline } from "@/app/admin/components/TradeTimeline";

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
    const start = dates[0];
    const end = dates[dates.length - 1];
    const days = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      days,
    };
};

const CouncilAuditPanel = ({ bt }: { bt: any }) => {
  const rejectedProfitable = bt.rejected_profitable_trades || 0;
  const postWinRate = bt.post_council_win_rate || bt.win_rate || 0;
  const preWinRate = bt.pre_council_win_rate || bt.win_rate || 0;
  const winRateImprovement = postWinRate - preWinRate;

  return (
    <div className="mt-6 p-6 rounded-2xl bg-red-500/5 border border-red-500/20 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <h4 className="text-sm font-black text-white uppercase tracking-wider">Council Audit: Member Efficiency</h4>
        </div>
        <div className="px-3 py-1 rounded-full bg-red-500/20 text-red-400 text-[10px] font-black uppercase tracking-tighter">
          {rejectedProfitable} Profitable Trades Killed
        </div>
      </div>

      <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl">
        The council filtered out <span className="text-red-400 font-bold">{rejectedProfitable}</span> opportunities that would have resulted in a profit.
        Review the voting logs below to identify which member is being too conservative.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
        <div className="p-4 rounded-xl bg-zinc-900/40 border border-white/5 space-y-2">
          <span className="text-[10px] font-bold text-zinc-500 uppercase">Suspicious Member</span>
          <div className="text-sm font-black text-white">RSI / Fundamental?</div>
          <div className="text-[9px] text-zinc-500">Check "NO" votes on filtered wins.</div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900/40 border border-white/5 space-y-2">
          <span className="text-[10px] font-bold text-zinc-500 uppercase">Council Impact</span>
          <div className="text-sm font-black text-emerald-400">+{winRateImprovement.toFixed(1)}% Win Rate</div>
          <div className="text-[9px] text-zinc-500">Net win rate improvement.</div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900/40 border border-white/5 space-y-2">
          <span className="text-[10px] font-bold text-zinc-500 uppercase">Action Required</span>
          <div className="text-sm font-black text-indigo-400">Refine Weights</div>
          <div className="text-[9px] text-zinc-500">Consider lowering the "King" weight.</div>
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
    const [activeTab, setActiveTab] = useState<"bots" | "backtests">("bots");
    
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

    const [selectedModelFilter, setSelectedModelFilter] = useState<string>("all");

    // Subscriptions count helper
    const activeSubCount = useMemo(() => {
        return bots.filter(b => b.is_subscribed).length;
    }, [bots]);

    // Filtered bots list based on model filter
    const filteredBots = useMemo(() => {
        if (selectedModelFilter === "all") return bots;
        return bots.filter(bot => {
            const path = (bot.king_model_path || "").toUpperCase();
            return path.includes(selectedModelFilter.toUpperCase());
        });
    }, [bots, selectedModelFilter]);

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
        fetchBacktestsList();
    }, [user?.id]);

    // Handle Subscribe
    const handleSubscribe = async (botId: string) => {
        if (!user) return;
        if (activeSubCount >= 2) {
            alert("You have reached the maximum subscription limit (Max 2 bots in the free plan).");
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

    // Filtered Backtests - ONLY Egypt (EGX) and Public
    const egxBacktests = useMemo(() => {
        return backtests.filter(b => {
            const ex = b.exchange?.toUpperCase();
            const matchesExchange = ex === "EGX" || ex === "EG" || ex === "CA";
            return matchesExchange && b.is_public === true;
        });
    }, [backtests]);

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
        <div className="mx-auto max-w-[1400px] w-full px-4 py-8 md:px-6 md:py-12 mt-20 min-h-[calc(100vh-200px)]">
            {/* Header Banner */}
            <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-gradient-to-tr from-zinc-950 via-zinc-900 to-zinc-950 p-8 md:p-12 mb-10 shadow-2xl shadow-indigo-500/5">
                <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                    <Brain className="w-48 h-48 text-indigo-500" />
                </div>
                <div className="relative z-10 max-w-2xl space-y-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 text-xs font-black uppercase tracking-wider">
                        <Sparkles className="w-3.5 h-3.5" /> Artificial Intelligence
                    </div>
                    <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight leading-none uppercase">
                        AI Trading <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500">Scanner</span>
                    </h1>
                    <p className="text-zinc-400 font-medium text-sm md:text-base leading-relaxed">
                        Centralized automated AI bots running under quantitative models. Get instant, high-probability buy signals delivered directly to your Telegram. Compare public backtest statistics below.
                    </p>
                </div>
            </div>

            {/* Tab Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-8 pb-4 border-b border-white/5">
                <div className="flex p-1 rounded-2xl bg-zinc-900/50 border border-white/5 w-full sm:w-auto">
                    <button
                        onClick={() => setActiveTab("bots")}
                        className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${
                            activeTab === "bots"
                                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25"
                                : "text-zinc-500 hover:text-white hover:bg-white/5"
                        }`}
                    >
                        <Brain className="w-4.5 h-4.5" />
                        AI Trading Bots
                    </button>
                    <button
                        onClick={() => setActiveTab("backtests")}
                        className={`flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${
                            activeTab === "backtests"
                                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25"
                                : "text-zinc-500 hover:text-white hover:bg-white/5"
                        }`}
                    >
                        <BarChart2 className="w-4.5 h-4.5" />
                        Backtest Results
                    </button>
                </div>

                {/* Exchange context filter - Displayed for both tabs */}
                <div className="flex items-center gap-3 self-end sm:self-center">
                    <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Market Filter:</span>
                    <select
                        disabled
                        className="bg-zinc-900 border border-white/5 rounded-xl px-4 py-2.5 text-xs text-white font-bold focus:outline-none cursor-not-allowed opacity-90"
                    >
                        <option value="EGX">🇪🇬 Egypt (EGX)</option>
                    </select>
                    <span className="text-[10px] font-medium text-zinc-600 italic">(Only Egypt CA available now)</span>
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
                            {/* Egyptian Models Filter */}
                            <div className="p-6 rounded-3xl border border-white/5 bg-zinc-900/10 backdrop-blur-3xl space-y-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <Cpu className="w-5 h-5 text-indigo-400" />
                                        <h4 className="text-xs font-black text-white uppercase tracking-[0.2em]">
                                            Egyptian AI Models
                                        </h4>
                                    </div>
                                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                                        Click a model to filter active bots
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-3">
                                    <button
                                        onClick={() => setSelectedModelFilter("all")}
                                        className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 border ${
                                            selectedModelFilter === "all"
                                                ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20"
                                                : "bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:bg-white/10"
                                        }`}
                                    >
                                        All Models
                                    </button>
                                    <button
                                        onClick={() => setSelectedModelFilter("KING")}
                                        className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 border flex items-center gap-2 ${
                                            selectedModelFilter === "KING"
                                                ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20"
                                                : "bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:bg-white/10"
                                        }`}
                                    >
                                        👑 KING Model
                                    </button>
                                    <button
                                        onClick={() => setSelectedModelFilter("NEW_MODEL")}
                                        className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 border flex items-center gap-2 ${
                                            selectedModelFilter === "NEW_MODEL"
                                                ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20"
                                                : "bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:bg-white/10"
                                        }`}
                                    >
                                        🌋 NEW_MODEL
                                    </button>
                                </div>
                            </div>

                            {/* Free limit info alert */}
                            {user && (
                                <div className="flex items-center justify-between p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 text-indigo-400 text-[11px] font-bold uppercase tracking-wider">
                                    <div className="flex items-center gap-2">
                                        <ShieldCheck className="w-4.5 h-4.5" />
                                        <span>Your Bot Subscriptions: {activeSubCount} / 2 (Free Plan Limit)</span>
                                    </div>
                                    {activeSubCount >= 2 && (
                                        <span className="text-amber-400 text-[10px]">Subscription Limit Reached</span>
                                    )}
                                </div>
                            )}

                            {filteredBots.length === 0 ? (
                                <div className="p-12 text-center rounded-[2.5rem] border border-white/5 bg-zinc-950/20 text-zinc-500 font-bold uppercase tracking-wider text-[11px] min-h-[150px] flex items-center justify-center">
                                    No active trading bots are currently running with the {selectedModelFilter} model.
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
                                                <h2 className="text-lg font-black text-white uppercase tracking-wider">Active Trading Bots</h2>
                                                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">Subscribe to receive real-time signals on Telegram</p>
                                            </div>
                                        </div>
                                        <div className="hidden sm:flex items-center gap-2">
                                            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{filteredBots.length} Bot{filteredBots.length !== 1 ? "s" : ""}</span>
                                        </div>
                                    </div>

                                    {/* Desktop Table View */}
                                    <div className="hidden lg:block overflow-x-auto w-full relative z-10 custom-scrollbar">
                                        <table className="w-full text-left whitespace-nowrap">
                                            <thead className="bg-zinc-950/80 border-b border-white/5 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                                                <tr>
                                                    <th className="px-6 py-5">Bot Identity</th>
                                                    <th className="px-6 py-5 text-center">Status</th>
                                                    <th className="px-6 py-5 text-center">Mode</th>
                                                    <th className="px-6 py-5 text-center">Config</th>
                                                    <th className="px-6 py-5 text-center">Trades</th>
                                                    <th className="px-6 py-5 text-center">Win Rate</th>
                                                    <th className="px-6 py-5 text-right">Net P/L</th>
                                                    <th className="px-6 py-5 text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-white/5">
                                                {filteredBots.map((bot) => {
                                                    const isSubbed = !!bot.is_subscribed;
                                                    const isLimitReached = activeSubCount >= 2;
                                                    const isLoading = submittingBotId === bot.bot_id;
                                                    const pnl = bot.total_pnl || 0;
                                                    const isProfitable = pnl >= 0;
                                                    const tradingMode = bot.trading_mode || "aggressive";
                                                    const modeConfig = tradingMode === "defensive"
                                                        ? { emoji: "🛡️", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" }
                                                        : tradingMode === "hybrid"
                                                        ? { emoji: "🔄", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" }
                                                        : { emoji: "⚔️", color: "bg-red-500/10 text-red-400 border-red-500/20" };

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
                                                                                    Subscribed
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
                                                                    {bot.status === "running" ? "Running" : "Stopped"}
                                                                </span>
                                                            </td>

                                                            {/* Trading Mode */}
                                                            <td className="px-6 py-5 text-center">
                                                                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${modeConfig.color}`}>
                                                                    <span>{modeConfig.emoji}</span>
                                                                    {tradingMode}
                                                                </span>
                                                            </td>

                                                            {/* Config */}
                                                            <td className="px-6 py-5 text-center">
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <span className="font-mono text-indigo-400 font-black text-[10px] uppercase bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">{bot.timeframe || "1Hour"}</span>
                                                                    <div className="flex items-center gap-1 font-mono text-[9px]">
                                                                        <span className="text-emerald-400 font-bold">T:{Math.round((bot.target_pct || 0.06) * 100)}%</span>
                                                                        <span className="text-zinc-700">|</span>
                                                                        <span className="text-red-400 font-bold">SL:{Math.round((bot.stop_loss_pct || 0.02) * 100)}%</span>
                                                                    </div>
                                                                    {bot.use_council && (
                                                                        <span className="text-[8px] text-zinc-500 font-bold">Council @ {bot.council_threshold ?? 0.25}</span>
                                                                    )}
                                                                </div>
                                                            </td>

                                                            {/* Trades */}
                                                            <td className="px-6 py-5 text-center">
                                                                <span className="text-sm font-black text-white font-mono">{bot.trades_count}</span>
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
                                                                        Login
                                                                    </Link>
                                                                ) : isSubbed ? (
                                                                    <button
                                                                        onClick={() => handleUnsubscribe(bot.bot_id)}
                                                                        disabled={isLoading}
                                                                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-black text-[9px] uppercase tracking-widest hover:bg-red-500/20 transition-all duration-300 disabled:opacity-50"
                                                                    >
                                                                        {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserMinus className="w-3 h-3" />}
                                                                        Unsub
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
                                                                        Subscribe
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
                                            const isLimitReached = activeSubCount >= 2;
                                            const isLoading = submittingBotId === bot.bot_id;
                                            const pnl = bot.total_pnl || 0;
                                            const isProfitable = pnl >= 0;
                                            const tradingMode = bot.trading_mode || "aggressive";
                                            const modeConfig = tradingMode === "defensive"
                                                ? { emoji: "🛡️", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" }
                                                : tradingMode === "hybrid"
                                                ? { emoji: "🔄", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" }
                                                : { emoji: "⚔️", color: "bg-red-500/10 text-red-400 border-red-500/20" };

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
                                                                            Subscribed
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <span className="text-[10px] font-mono text-zinc-600">{bot.bot_id}</span>
                                                            </div>
                                                        </div>
                                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${bot.status === "running" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-800 text-zinc-400 border-white/5"}`}>
                                                            {bot.status === "running" ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> : <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />}
                                                            {bot.status === "running" ? "Running" : "Stopped"}
                                                        </span>
                                                    </div>

                                                    {/* Badges Row: Mode + TF + Target/SL */}
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${modeConfig.color}`}>
                                                            <span>{modeConfig.emoji}</span>{tradingMode}
                                                        </span>
                                                        <span className="font-mono text-indigo-400 font-black text-[10px] uppercase bg-indigo-500/10 px-2.5 py-1 rounded-full border border-indigo-500/20">{bot.timeframe || "1Hour"}</span>
                                                        <div className="flex items-center gap-1 font-mono text-[9px] bg-zinc-950/50 px-2.5 py-1 rounded-full border border-white/5">
                                                            <span className="text-emerald-400 font-bold">T:{Math.round((bot.target_pct || 0.06) * 100)}%</span>
                                                            <span className="text-zinc-700">|</span>
                                                            <span className="text-red-400 font-bold">SL:{Math.round((bot.stop_loss_pct || 0.02) * 100)}%</span>
                                                        </div>
                                                        {bot.use_council && (
                                                            <span className="text-[9px] text-zinc-500 font-bold bg-zinc-900 px-2.5 py-1 rounded-full border border-white/5">Council @ {bot.council_threshold ?? 0.25}</span>
                                                        )}
                                                    </div>

                                                    {/* Stats Grid */}
                                                    <div className="grid grid-cols-3 gap-2 bg-black/20 rounded-2xl p-4 border border-white/5">
                                                        <div className="text-center">
                                                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Win Rate</p>
                                                            <p className="font-mono text-sm font-black text-emerald-400">{formatNum(bot.win_rate, 1)}%</p>
                                                        </div>
                                                        <div className="text-center border-x border-white/5">
                                                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Net P/L</p>
                                                            <p className={`font-mono text-sm font-black ${isProfitable ? "text-emerald-400" : "text-red-400"}`}>
                                                                {isProfitable ? "+" : ""}{formatNum(pnl, 2)}%
                                                            </p>
                                                        </div>
                                                        <div className="text-center">
                                                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Trades</p>
                                                            <p className="font-mono text-sm font-black text-zinc-100">{bot.trades_count}</p>
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
                                                                Login to Subscribe
                                                            </Link>
                                                        ) : isSubbed ? (
                                                            <button
                                                                onClick={() => handleUnsubscribe(bot.bot_id)}
                                                                disabled={isLoading}
                                                                className="w-full h-11 flex items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-black text-[10px] uppercase tracking-widest hover:bg-red-500/25 transition-all duration-300 disabled:opacity-50"
                                                            >
                                                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserMinus className="w-4 h-4 mr-2" />}
                                                                Unsubscribe
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
                                                                Subscribe
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
                <div className="space-y-6">
                    {backtestsLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                            <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">Loading backtests...</p>
                        </div>
                    ) : backtestsError ? (
                        <div className="p-6 rounded-3xl border border-red-500/10 bg-red-500/5 text-red-400 text-sm text-center">
                            {backtestsError}
                        </div>
                    ) : egxBacktests.length === 0 ? (
                        <div className="p-12 text-center rounded-[2.5rem] border border-white/5 bg-zinc-950/20 text-zinc-600 font-bold uppercase tracking-wider">
                            No backtest results found for the Egyptian market.
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {egxBacktests.map((bt) => {
                                const isExpanded = expandedBacktestId === bt.id;
                                const trades = parseTradesLog(bt.trades_log);
                                const isOpt = bt.model_name?.toUpperCase().startsWith("OPT:") || bt.model_name?.toUpperCase().startsWith("OPTIMIZER:");

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
                                                    {isOpt ? (
                                                        <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-400 text-[8px] font-black uppercase">
                                                            Optimizer Run
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[8px] font-black uppercase">
                                                            Standard Run
                                                        </span>
                                                    )}

                                                    {/* Target and Risk (Stop Loss) settings */}
                                                    {(() => {
                                                        const { target, stopLoss } = getBacktestSettings(bt);
                                                        if (target === null && stopLoss === null) return null;
                                                        return (
                                                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-950/60 border border-white/5 text-[9px] font-mono font-bold shadow-inner">
                                                                <span className="text-zinc-500 font-bold uppercase">Target:</span>
                                                                <span className="text-emerald-400 font-black">{target !== null ? `${target}%` : "—"}</span>
                                                                <span className="text-zinc-700">|</span>
                                                                <span className="text-zinc-500 font-bold uppercase">Risk (SL):</span>
                                                                <span className="text-red-400 font-black">{stopLoss !== null ? `${stopLoss}%` : "—"}</span>
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* Council model and meta settings */}
                                                    {bt.council_model && (
                                                        <div className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-zinc-950/60 border border-white/5 text-[9px] font-mono font-bold shadow-inner">
                                                            <span className="text-zinc-500 font-bold uppercase">Council:</span>
                                                            <span className="text-indigo-400 font-black">{bt.council_model.replace(".pkl", "")}</span>
                                                            <span className="text-zinc-700">@</span>
                                                            <span className="text-indigo-400 font-black">{bt.council_threshold ?? 0.1}</span>
                                                            <span className="text-zinc-700">|</span>
                                                            <span className="text-zinc-500 font-bold uppercase">Meta:</span>
                                                            <span className="text-zinc-300 font-black">{bt.meta_threshold ?? 0.4}</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                                                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-zinc-600" /> {new Date(bt.start_date).toLocaleDateString()} - {new Date(bt.end_date).toLocaleDateString()}</span>
                                                    <span className="text-zinc-700">•</span>
                                                    <span className="font-bold text-zinc-400">Exchange: {bt.exchange?.toUpperCase()}</span>
                                                    <span className="text-zinc-700">•</span>
                                                    <span className="text-[10px] font-mono opacity-50">Run ID: {bt.id.slice(0, 8)}</span>
                                                </div>
                                            </div>

                                            {/* Metrics Row */}
                                            <div className="flex flex-wrap items-center gap-4 md:gap-8 bg-black/20 p-4 rounded-2xl border border-white/5">
                                                <div className="text-center min-w-[70px]">
                                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Win Rate</p>
                                                    <p className="font-mono text-base font-black text-emerald-400">{formatNum(bt.win_rate, 1)}%</p>
                                                </div>
                                                <div className="w-px h-8 bg-white/5 hidden sm:block" />
                                                <div className="text-center min-w-[80px]">
                                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Net Profit</p>
                                                    <p className={`font-mono text-base font-black ${bt.net_profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                        {bt.net_profit >= 0 ? "+" : ""}{formatNum(bt.net_profit, 2)}%
                                                    </p>
                                                </div>
                                                <div className="w-px h-8 bg-white/5 hidden sm:block" />
                                                <div className="text-center min-w-[70px]">
                                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Total Trades</p>
                                                    <p className="font-mono text-base font-black text-zinc-100">{bt.total_trades}</p>
                                                </div>
                                                <div className="w-px h-8 bg-white/5 hidden sm:block" />
                                                <div className="text-center min-w-[90px]">
                                                    <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Avg Return</p>
                                                    <p className={`font-mono text-base font-black ${bt.avg_return_per_trade >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                        {bt.avg_return_per_trade >= 0 ? "+" : ""}{formatNum(bt.avg_return_per_trade, 2)}%
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Expand/Collapse Trades CTA */}
                                            <div className="self-end md:self-center">
                                                <button
                                                    onClick={() => setExpandedBacktestId(isExpanded ? null : bt.id)}
                                                    className="h-11 px-5 flex items-center justify-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 text-white font-black text-[10px] uppercase tracking-widest border border-white/5 hover:border-white/10 transition-all duration-300 whitespace-nowrap"
                                                >
                                                    {isExpanded ? "Hide Trades" : "View Trade Logs"}
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
                                                                    Backtest Details ({filteredTrades.length} entries)
                                                                </h4>
                                                                <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-black opacity-60">
                                                                    Simulation Radar Analysis
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
                                                                    Filtered
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
                                                                    Raw Data
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
                                                                    Summary
                                                                </button>
                                                                <button
                                                                    onClick={() => setExpandedTabMap(prev => ({ ...prev, [bt.id]: 'trades' }))}
                                                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                                                                        activeSubTab === 'trades' 
                                                                            ? 'bg-white/10 text-white shadow' 
                                                                            : 'text-zinc-500 hover:text-zinc-300'
                                                                    }`}
                                                                >
                                                                    Trades
                                                                </button>
                                                                <button
                                                                    onClick={() => setExpandedTabMap(prev => ({ ...prev, [bt.id]: 'chart' }))}
                                                                    className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                                                                        activeSubTab === 'chart' 
                                                                            ? 'bg-white/10 text-white shadow' 
                                                                            : 'text-zinc-500 hover:text-zinc-300'
                                                                    }`}
                                                                >
                                                                    Chart
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {trades.length === 0 ? (
                                                        <div className="text-center py-8 text-zinc-600 font-bold uppercase tracking-wider text-[11px]">
                                                            No detailed trade entries available for this run.
                                                        </div>
                                                    ) : activeSubTab === 'summary' ? (
                                                        <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                                {/* Strategy Only Analysis */}
                                                                <div className="rounded-2xl border border-white/5 bg-zinc-900/40 p-6 space-y-4 shadow-inner">
                                                                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                                                        <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Strategy Only</h4>
                                                                        <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 text-[8px] font-bold uppercase">Pre-Council</span>
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-4">
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-zinc-500 font-bold uppercase">Trades</span>
                                                                            <div className="text-lg font-mono font-black text-white">{bt.pre_council_trades || bt.total_trades}</div>
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-zinc-500 font-bold uppercase">Win Rate</span>
                                                                            <div className="text-lg font-mono font-black text-white">{formatPct(bt.pre_council_win_rate)}</div>
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-zinc-500 font-bold uppercase">Profit</span>
                                                                            <div className={`text-lg font-mono font-black ${(Number(bt.pre_council_profit_pct) || Number(bt.profit_pct) || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                                {formatPct(bt.pre_council_profit_pct || bt.profit_pct)}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* With Filter Analysis */}
                                                                <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-6 space-y-4 shadow-inner backdrop-blur-sm">
                                                                    <div className="flex items-center justify-between border-b border-indigo-500/10 pb-2">
                                                                        <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">With Filter</h4>
                                                                        <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-400 text-[8px] font-bold uppercase">Post-Council</span>
                                                                    </div>
                                                                    <div className="grid grid-cols-3 gap-4">
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-indigo-400/60 font-bold uppercase">Trades</span>
                                                                            <div className="text-lg font-mono font-black text-white">{bt.post_council_trades || bt.total_trades}</div>
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-indigo-400/60 font-bold uppercase">Win Rate</span>
                                                                            <div className="text-lg font-mono font-black text-emerald-400">{formatPct(bt.post_council_win_rate || bt.win_rate)}</div>
                                                                        </div>
                                                                        <div className="space-y-1">
                                                                            <span className="text-[9px] text-indigo-400/60 font-bold uppercase">Profit</span>
                                                                            <div className={`text-lg font-mono font-black ${(Number(bt.post_council_profit_pct) || Number(bt.profit_pct) || 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                                {formatPct(bt.post_council_profit_pct || bt.profit_pct)}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <CouncilAuditPanel bt={bt} />

                                                            <div className="flex items-center justify-center gap-16 p-8 rounded-2xl bg-white/[0.02] border border-white/5">
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">Trade Reduction</span>
                                                                    <div className="text-3xl font-black text-white">
                                                                        {bt.pre_council_trades && bt.post_council_trades ?
                                                                            `-${Math.round(((bt.pre_council_trades - bt.post_council_trades) / bt.pre_council_trades) * 100)}%` :
                                                                            '—'}
                                                                    </div>
                                                                </div>
                                                                <div className="w-px h-12 bg-white/5" />
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">Win Rate Boost</span>
                                                                    <div className={`text-3xl font-black ${Number(bt.post_council_win_rate) - Number(bt.pre_council_win_rate) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                                                        {bt.pre_council_win_rate && bt.post_council_win_rate ?
                                                                            `+${(bt.post_council_win_rate - bt.pre_council_win_rate).toFixed(1)}pp` :
                                                                            '—'}
                                                                    </div>
                                                                </div>
                                                                <div className="w-px h-12 bg-white/5" />
                                                                <div className="flex flex-col items-center">
                                                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2">Actual Range</span>
                                                                    <div className="text-sm font-black text-white">
                                                                        {actualRange ? `${actualRange.start} → ${actualRange.end}` : "—"}
                                                                    </div>
                                                                    <div className="text-[10px] font-bold text-zinc-500">
                                                                        {actualRange ? `${actualRange.days} days` : ""}
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
                                                                        <th className="px-6 py-4">Symbol</th>
                                                                        <th className="px-6 py-4 text-center">Dates (In / Out)</th>
                                                                        <th className="px-6 py-4 text-center">Timing</th>
                                                                        <th className="px-6 py-4 text-right">Pricing (In / Out)</th>
                                                                        <th className="px-6 py-4 text-center">Radar Score</th>
                                                                        <th className="px-6 py-4 text-center">Fund Score</th>
                                                                        <th className="px-6 py-4 text-right">P/L %</th>
                                                                        <th className="px-6 py-4 text-center">Status</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-white/5 font-mono text-zinc-400">
                                                                    {filteredTrades.map((t: any, index: number) => {
                                                                        const sym = t.Symbol || t.symbol || t.features?.symbol || "-";
                                                                        const entryD = t.Entry_Date || t.entry_date || t.Entry_Time || t.entry_time || t.features?.entry_date || "-";
                                                                        const exitD = t.Exit_Date || t.exit_date || t.Exit_Time || t.exit_time || t.features?.exit_date || "-";
                                                                        const entryP = Number(t.Entry_Price || t.entry_price || t.entry || 0);
                                                                        const exitP = Number(t.Exit_Price || t.exit_price || t.exit || 0);
                                                                        const profitPct = Number(t.Profit_Loss_Pct ?? t.profit_loss_pct ?? t.pnl ?? t.profit_percent ?? t.profit ?? 0);
                                                                        const st = t.features?.backtest_status || t.features?.Status || t.Status || t.status || "-";
                                                                        const isRejected = st === "Rejected";

                                                                        // Timing calculation
                                                                        let durationStr = "—";
                                                                        if (entryD && exitD && entryD !== "-" && exitD !== "-") {
                                                                            try {
                                                                                const entry = new Date(entryD).getTime();
                                                                                const exit = new Date(exitD).getTime();
                                                                                if (Number.isFinite(entry) && Number.isFinite(exit)) {
                                                                                    const days = Math.ceil((exit - entry) / (1000 * 60 * 60 * 24));
                                                                                    durationStr = days >= 0 ? `${days}d` : "—";
                                                                                }
                                                                            } catch {}
                                                                        }

                                                                        // Radar Score calculation
                                                                        let radarScore = (t.features as any)?.radar_score ?? (t.features as any)?.ai_score ?? (t.features as any)?.score ?? (t as any)?.score ?? (t as any)?.Score;
                                                                        let radarStr = "—";
                                                                        if (radarScore !== null && radarScore !== undefined && !Number.isNaN(Number(radarScore))) {
                                                                            const n = Number(radarScore);
                                                                            radarStr = n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
                                                                        }

                                                                        // Fund Score calculation
                                                                        let fundScore = (t.features as any)?.fund_score ?? (t.features as any)?.fundamental_score ?? (t as any)?.Fund_Score ?? (t as any)?.fund_score ?? (t as any)?.Validator_Score;
                                                                        let fundStr = "—";
                                                                        if (fundScore !== null && fundScore !== undefined && !Number.isNaN(Number(fundScore))) {
                                                                            const n = Number(fundScore);
                                                                            fundStr = n <= 1 ? `${(n * 100).toFixed(1)}%` : `${n.toFixed(1)}%`;
                                                                        }

                                                                        return (
                                                                            <tr key={index} className={`hover:bg-white/[0.02] transition-colors ${isRejected ? 'opacity-40 grayscale-[0.8]' : ''}`}>
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
                                                                                        <span className="text-zinc-500">In: {entryP < 0.1 ? entryP.toFixed(8) : entryP.toFixed(2)}</span>
                                                                                        <span className="text-zinc-300 font-bold">Out: {exitP < 0.1 ? exitP.toFixed(8) : exitP.toFixed(2)}</span>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-6 py-3.5 text-center font-bold text-zinc-200">{radarStr}</td>
                                                                                <td className="px-6 py-3.5 text-center font-bold text-zinc-200">{fundStr}</td>
                                                                                <td className={`px-6 py-3.5 text-right font-black ${profitPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                                                    {profitPct >= 0 ? "+" : ""}{formatNum(profitPct, 2)}%
                                                                                </td>
                                                                                <td className="px-6 py-3.5 text-center">
                                                                                    <span className={`inline-block px-2.5 py-0.5 rounded text-[9px] font-black uppercase ${
                                                                                        st === "Accepted"
                                                                                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                                                                            : st === "Rejected"
                                                                                            ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                                                                            : "bg-zinc-800 text-zinc-500"
                                                                                    }`}>
                                                                                        {st}
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
        </div>
    );
}
