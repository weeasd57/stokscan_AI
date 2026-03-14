"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
    Activity,
    Calendar,
    Play,
    TrendingUp,
    Target,
    History as HistoryIcon,
    ChevronDown,
    LineChart,
    Database,
    Wallet,
    Search,
    RefreshCw,
    Download,
    Trash2,
    ArrowUpRight,
    ArrowDownRight,
    Loader2
} from "lucide-react";
import { getBacktests, deleteBacktest } from "@/lib/api";
import { toast } from "sonner";
import {
    LineChart as RLineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
    ReferenceLine
} from 'recharts';

interface PPOModel {
    name: string;
    exchange: string;
    size: string;
    modified: string;
}

// ---- Trade History Sub-Component ----
function TradeHistoryTable({ trades, initialBalance }: { trades: any[]; initialBalance: number }) {
    const [showAll, setShowAll] = React.useState(false);
    const visible = showAll ? trades : trades.slice(0, 30);
    let runningBalance = initialBalance;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                        <HistoryIcon className="w-4 h-4" />
                    </div>
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Trade History</h3>
                    <span className="px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 text-[9px] font-black border border-white/5">{trades.length} trades</span>
                </div>
                {trades.length > 30 && (
                    <button
                        onClick={() => setShowAll(s => !s)}
                        className="text-[10px] font-black text-indigo-400 hover:text-indigo-300 uppercase tracking-widest flex items-center gap-1 transition-colors"
                    >
                        {showAll ? "Show Less" : `Show All ${trades.length}`}
                        <ChevronDown className={`w-3 h-3 transition-transform ${showAll ? "rotate-180" : ""}`} />
                    </button>
                )}
            </div>

            <div className="rounded-2xl overflow-hidden border border-white/5">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-white/[0.03] border-b border-white/5">
                            <th className="px-4 py-3 text-left text-[9px] font-black text-zinc-500 uppercase tracking-widest">#</th>
                            <th className="px-4 py-3 text-left text-[9px] font-black text-zinc-500 uppercase tracking-widest">Action</th>
                            <th className="px-4 py-3 text-right text-[9px] font-black text-zinc-500 uppercase tracking-widest">Price</th>
                            <th className="px-4 py-3 text-right text-[9px] font-black text-zinc-500 uppercase tracking-widest">PnL %</th>
                            <th className="px-4 py-3 text-right text-[9px] font-black text-zinc-500 uppercase tracking-widest">Balance</th>
                            <th className="px-4 py-3 text-left text-[9px] font-black text-zinc-500 uppercase tracking-widest">Step</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                        {visible.map((t: any, idx: number) => {
                            const pnl = t.pnl ?? 0;
                            const isWin = pnl > 0;
                            const isSell = t.action === "SELL";
                            if (isSell && pnl !== 0) {
                                runningBalance = runningBalance * (1 + pnl - 0.001);
                            }
                            return (
                                <tr key={idx} className={`transition-colors hover:bg-white/[0.02] ${isSell && isWin ? "bg-emerald-500/[0.03]" : isSell && !isWin && pnl !== 0 ? "bg-rose-500/[0.03]" : ""}`}>
                                    <td className="px-4 py-2.5 text-zinc-600 font-mono">{idx + 1}</td>
                                    <td className="px-4 py-2.5">
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${t.action === "BUY" ? "bg-indigo-500/20 text-indigo-400" : isWin ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                                            {t.action === "BUY" ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                                            {t.action}
                                        </span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono text-zinc-300">${typeof t.price === "number" ? t.price.toFixed(3) : t.price}</td>
                                    <td className="px-4 py-2.5 text-right font-mono font-black">
                                        {isSell ? (
                                            <span className={pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                                {pnl >= 0 ? "+" : ""}{(pnl * 100).toFixed(3)}%
                                            </span>
                                        ) : <span className="text-zinc-600">—</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono text-zinc-400">
                                        {isSell ? `$${runningBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : <span className="text-zinc-600">—</span>}
                                    </td>
                                    <td className="px-4 py-2.5 text-zinc-600 font-mono text-[9px]">{t.step}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ---- Per-Symbol Breakdown Sub-Component ----
function SymbolBreakdownTable({ symbols }: { symbols: any[] }) {
    const sorted = [...symbols].sort((a, b) => (b.pnl_pct ?? 0) - (a.pnl_pct ?? 0));
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                    <Database className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Symbol Breakdown</h3>
                <span className="px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 text-[9px] font-black border border-white/5">{symbols.length} symbols</span>
            </div>
            <div className="rounded-2xl overflow-hidden border border-white/5">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="bg-white/[0.03] border-b border-white/5">
                            <th className="px-4 py-3 text-left text-[9px] font-black text-zinc-500 uppercase tracking-widest">Symbol</th>
                            <th className="px-4 py-3 text-right text-[9px] font-black text-zinc-500 uppercase tracking-widest">Trades</th>
                            <th className="px-4 py-3 text-right text-[9px] font-black text-zinc-500 uppercase tracking-widest">Win Rate</th>
                            <th className="px-4 py-3 text-right text-[9px] font-black text-zinc-500 uppercase tracking-widest">PnL %</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                        {sorted.map((s: any, idx: number) => {
                            const pnl = s.pnl_pct ?? s.total_pnl_pct ?? 0;
                            const wr = s.win_rate ?? 0;
                            return (
                                <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="px-4 py-2.5 font-black text-white uppercase">{s.symbol}</td>
                                    <td className="px-4 py-2.5 text-right font-mono text-zinc-400">{s.total_trades ?? s.trades ?? 0}</td>
                                    <td className="px-4 py-2.5 text-right font-mono">
                                        <span className={wr >= 50 ? "text-emerald-400" : "text-amber-400"}>{wr.toFixed(1)}%</span>
                                    </td>
                                    <td className="px-4 py-2.5 text-right font-mono font-black">
                                        <span className={pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                            {pnl >= 0 ? "+" : ""}{pnl.toFixed(3)}%
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

interface PPOBacktestTabProps {
    dbInventory?: any[];
}

export default function PPOBacktestTab({ dbInventory = [] }: PPOBacktestTabProps) {
    const [models, setModels] = useState<PPOModel[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>("");
    const [exchange, setExchange] = useState<string>("CRYPTO");
    const [isExchangeDropdownOpen, setIsExchangeDropdownOpen] = useState(false);
    const [startDate, setStartDate] = useState<string>("2024-01-01");
    const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [initialBalance, setInitialBalance] = useState<number>(10000);

    const [isBacktesting, setIsBacktesting] = useState(false);
    const [backtestStatus, setBacktestStatus] = useState<any>(null);
    const [backtestResults, setBacktestResults] = useState<any>(null);


    const exchangeOptions = useMemo(() => {
        // Show all known exchanges (not just those with priceCount > 0)
        const options = dbInventory.filter(i => (i.expectedCount || i.priceCount || 0) > 0);
        if (!options.find(o => o.exchange === "CRYPTO" || o.exchange === "BINANCE")) {
            options.push({ exchange: "CRYPTO", priceCount: 1, expectedCount: 1 });
        }
        return options;
    }, [dbInventory]);

    // Show the total expected symbols (local file count), not just synced DB ones
    const selectedExchangeCount = (() => {
        const inv = dbInventory.find(i => i.exchange === exchange);
        if (!inv) return 0;
        return inv.expectedCount || inv.priceCount || 0;
    })();

    useEffect(() => {
        fetchModels();
    }, []);

    const fetchModels = async () => {
        try {
            const res = await fetch("/api/admin/ppo/models");
            const data = await res.json();
            if (data.models) {
                setModels(data.models);
                if (data.models.length > 0 && !selectedModel) {
                    setSelectedModel(data.models[0].name);
                }
            }
        } catch (error) {
            console.error("Error fetching PPO models:", error);
        }
    };



    const runBacktest = async () => {
        if (!selectedModel) {
            toast.error("Please select a model first");
            return;
        }

        setIsBacktesting(true);
        setBacktestResults(null);
        setBacktestStatus({ running: true, progress: 0, total: 0, current_symbol: "Starting..." });

        try {
            const res = await fetch("http://localhost:8000/admin/ppo/backtest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model_name: selectedModel,
                    exchange: exchange,
                    initial_balance: initialBalance,
                    start_date: startDate,
                    end_date: endDate,
                    save_result: true
                })
            });

            const startData = await res.json();
            if (startData.status !== "started") {
                toast.error(startData.detail || "Failed to start backtest");
                setIsBacktesting(false);
                return;
            }

            // Start polling
            const pollInterval = setInterval(async () => {
                try {
                    const statusRes = await fetch("http://localhost:8000/admin/ppo/backtest/status");
                    const statusData = await statusRes.json();

                    setBacktestStatus(statusData);

                    if (!statusData.running) {
                        clearInterval(pollInterval);
                        setIsBacktesting(false);

                        if (statusData.results) {
                            setBacktestResults(statusData.results);
                            toast.success("Backtest completed successfully!");
                        } else if (statusData.error) {
                            toast.error(`Backtest failed: ${statusData.error}`);
                        }
                    }
                } catch (err) {
                    console.error("Polling error:", err);
                }
            }, 1000);

        } catch (error) {
            toast.error("Error connection to backend");
            setIsBacktesting(false);
            console.error(error);
        }
    };





    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* ... (Header remains same) ... */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-zinc-900/50 p-8 rounded-[2.5rem] border border-white/5 backdrop-blur-sm">
                <div className="flex items-center gap-6">
                    <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        <Target className="w-8 h-8" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-white tracking-tight">PPO Backtest</h1>
                        <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px] mt-1">Advanced Reinforcement Learning Evaluation</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">

                    <button
                        onClick={runBacktest}
                        disabled={isBacktesting}
                        className="flex items-center gap-3 px-8 py-4 bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-indigo-500/20 hover:scale-[1.02] active:scale-[0.98]"
                    >
                        {isBacktesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                        {isBacktesting ? "Simulating..." : "Run Backtest"}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Configuration Panel */}
                <div className="lg:col-span-1 space-y-8">
                    <div className="p-8 rounded-[2.5rem] bg-zinc-900 border border-white/5 space-y-8">
                        <div className="flex items-center gap-3">
                            <Activity className="w-5 h-5 text-indigo-400" />
                            <h3 className="text-sm font-black text-white uppercase tracking-widest">Configuration</h3>
                        </div>

                        <div className="space-y-6">
                            {/* Model Selector */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-2">Select PPO Model</label>
                                <div className="relative group">
                                    <select
                                        value={selectedModel}
                                        onChange={(e) => setSelectedModel(e.target.value)}
                                        className="w-full bg-black border border-zinc-800 rounded-2xl px-5 py-4 text-sm font-bold text-white outline-none focus:border-indigo-500/50 appearance-none transition-all group-hover:border-zinc-700"
                                    >
                                        <option value="" disabled>Choose a model...</option>
                                        {models.length > 0 ? models.map(m => (
                                            <option key={m.name} value={m.name}>{m.name.replace('.zip', '')}</option>
                                        )) : (
                                            <option disabled>No models found</option>
                                        )}
                                    </select>
                                    <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                                </div>
                            </div>

                            {/* Exchange Selector - PREMIUM CUSTOM DROPDOWN */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-2">Target Exchange</label>
                                <div className="relative">
                                    <button
                                        onClick={() => setIsExchangeDropdownOpen(!isExchangeDropdownOpen)}
                                        className={`w-full bg-black border ${isExchangeDropdownOpen ? 'border-indigo-500 ring-1 ring-indigo-500/50' : 'border-zinc-800'} rounded-2xl px-5 py-4 text-sm text-left transition-all flex items-center justify-between hover:border-zinc-700`}
                                    >
                                        <span className={exchange ? 'text-white font-bold' : 'text-zinc-500'}>
                                            {exchange ? (
                                                <span className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                                                    <span className="font-black uppercase tracking-widest">{exchange}</span>
                                                    {dbInventory.find(i => i.exchange === exchange)?.country && (
                                                        <span className="text-zinc-500 font-medium">— {dbInventory.find(i => i.exchange === exchange)?.country}</span>
                                                    )}
                                                    {selectedExchangeCount > 0 && (
                                                        <span className="text-zinc-600 text-[10px] ml-1">({selectedExchangeCount} symbols)</span>
                                                    )}
                                                </span>
                                            ) : "Select exchange..."}
                                        </span>
                                        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform duration-300 ${isExchangeDropdownOpen ? 'rotate-180' : ''}`} />
                                    </button>

                                    {isExchangeDropdownOpen && (
                                        <div className="absolute top-full mt-3 w-full bg-zinc-900 border border-white/10 rounded-[1.5rem] shadow-2xl z-50 overflow-hidden backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-200">
                                            <div className="max-h-64 overflow-y-auto custom-scrollbar p-2">
                                                {exchangeOptions.map((inv: { exchange: string; priceCount: number; country?: string }) => (
                                                    <button
                                                        key={inv.exchange}
                                                        onClick={() => { setExchange(inv.exchange); setIsExchangeDropdownOpen(false); }}
                                                        className={`w-full px-4 py-3 text-xs font-black text-left rounded-xl flex items-center justify-between transition-all ${exchange === inv.exchange ? 'bg-indigo-500/10 text-indigo-400' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="uppercase tracking-wider">{inv.exchange}</span>
                                                            {inv.country && <span className="text-[10px] font-medium text-zinc-500">{inv.country}</span>}
                                                        </div>
                                                        {/* Show total expected symbols (local list count), not just DB-synced */}
                                                        {((inv as any).expectedCount || inv.priceCount || 0) > 0 && (
                                                            <span className="text-[9px] text-zinc-600">
                                                                {(inv as any).expectedCount || inv.priceCount} assets
                                                            </span>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Dates */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-2">Start Date</label>
                                    <div className="relative">
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            className="w-full bg-black border border-zinc-800 rounded-2xl px-5 py-4 text-xs font-bold text-white outline-none focus:border-indigo-500/50 transition-all"
                                        />
                                        <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600 pointer-events-none" />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-2">End Date</label>
                                    <div className="relative">
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            className="w-full bg-black border border-zinc-800 rounded-2xl px-5 py-4 text-xs font-bold text-white outline-none focus:border-indigo-500/50 transition-all"
                                        />
                                        <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600 pointer-events-none" />
                                    </div>
                                </div>
                            </div>

                            {/* Initial Balance */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-2">Initial Balance</label>
                                <div className="relative">
                                    <input
                                        type="number"
                                        value={initialBalance}
                                        onChange={(e) => setInitialBalance(Number(e.target.value))}
                                        className="w-full bg-black border border-zinc-800 rounded-2xl px-5 py-4 text-sm font-bold text-white outline-none focus:border-indigo-500/50 transition-all pl-12"
                                    />
                                    <Wallet className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Quick Stats (if results available) */}
                    {backtestResults && (
                        <div className="p-8 rounded-[2.5rem] bg-indigo-500/5 border border-indigo-500/10 space-y-6">
                            <div className="flex items-center justify-between">
                                <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest">Performance</h3>
                                <div className="px-2 py-1 rounded bg-indigo-500/20 text-indigo-400 text-[8px] font-black uppercase">Live Result</div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-5 rounded-2xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Final Balance</p>
                                    <p className="text-xl font-black text-white font-mono">${backtestResults.final_net_worth.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
                                </div>
                                <div className="p-5 rounded-2xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Total PnL</p>
                                    <p className={`text-xl font-black font-mono ${backtestResults.total_pnl_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {backtestResults.total_pnl_pct > 0 ? '+' : ''}{backtestResults.total_pnl_pct.toFixed(2)}%
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Main Results / Chart Section */}
                <div className="lg:col-span-2 space-y-8">
                    {isBacktesting ? (
                        <div className="p-12 rounded-[2.5rem] bg-zinc-900 border border-white/5 flex flex-col items-center justify-center min-h-[500px] space-y-8 animate-in fade-in zoom-in-95 duration-500">
                            <div className="relative">
                                <div className="absolute inset-0 bg-indigo-500/20 blur-[60px] rounded-full animate-pulse" />
                                <div className="relative p-6 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                                    <Loader2 className="w-12 h-12 animate-spin-slow" />
                                </div>
                            </div>

                            <div className="text-center space-y-2">
                                <h3 className="text-xl font-black text-white uppercase tracking-tight">Simulation Radar</h3>
                                <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]">Processing Multi-Symbol Intelligence</p>
                            </div>

                            <div className="w-full max-w-md space-y-4">
                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                                    <span className="text-indigo-400">Progress</span>
                                    <span className="text-zinc-500">{backtestStatus?.progress ?? 0} / {backtestStatus?.total ?? 0} Symbols</span>
                                </div>

                                <div className="h-3 w-full bg-black/40 rounded-full border border-white/5 overflow-hidden p-0.5">
                                    <div
                                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500 ease-out shadow-[0_0_15px_rgba(99,102,241,0.5)]"
                                        style={{ width: `${(backtestStatus?.progress / (backtestStatus?.total || 1)) * 100}%` }}
                                    />
                                </div>

                                <div className="flex items-center justify-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                                        Analyzing: <span className="text-white">{backtestStatus?.current_symbol || 'Initializing'}</span>
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 w-full max-w-md">
                                <div className="p-4 rounded-2xl bg-black/40 border border-white/5 text-center">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Elapsed</p>
                                    <p className="text-sm font-black text-white font-mono">Running...</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-black/40 border border-white/5 text-center">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Threads</p>
                                    <p className="text-sm font-black text-white font-mono">10 Active</p>
                                </div>
                            </div>
                        </div>
                    ) : backtestResults ? (
                        <div className="p-8 rounded-[2.5rem] bg-zinc-900 border border-white/5 space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                        <TrendingUp className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-black text-white">Equity Curve</h3>
                                        <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mt-0.5">Model Performance Simulation</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black text-zinc-400 uppercase mr-2">Net Worth:</span>
                                    <span className="text-lg font-black text-emerald-400 font-mono">${backtestResults.final_net_worth.toFixed(2)}</span>
                                </div>
                            </div>

                            <div className="h-[400px] w-full bg-black/40 rounded-3xl p-6 border border-white/5">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={backtestResults.history}>
                                        <defs>
                                            <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
                                        <XAxis
                                            dataKey="step"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#52525b', fontSize: 10, fontWeight: 'bold' }}
                                            hide
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fill: '#52525b', fontSize: 10, fontWeight: 'bold' }}
                                            domain={['auto', 'auto']}
                                            tickFormatter={(val) => `$${val > 1000 ? (val / 1000).toFixed(1) + 'k' : val}`}
                                        />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                                            itemStyle={{ color: '#fff', fontSize: '12px', fontWeight: 'bold' }}
                                            labelStyle={{ color: '#52525b', fontSize: '10px', marginBottom: '4px' }}
                                            formatter={(value: any) => [`$${value.toLocaleString()}`, "Net Worth"]}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="net_worth"
                                            stroke="#10b981"
                                            strokeWidth={3}
                                            fillOpacity={1}
                                            fill="url(#equityGradient)"
                                            animationDuration={1500}
                                        />
                                        <ReferenceLine y={initialBalance} stroke="#52525b" strokeDasharray="5 5" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Trade Stats Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="p-5 rounded-3xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Max Drawdown</p>
                                    <p className="text-lg font-black text-rose-400 font-mono">-{backtestResults.max_drawdown_pct?.toFixed(1) ?? '0'}%</p>
                                </div>
                                <div className="p-5 rounded-3xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Sharpe Ratio</p>
                                    <p className={`text-lg font-black font-mono ${(backtestResults.sharpe_ratio ?? 0) >= 1 ? 'text-emerald-400' : (backtestResults.sharpe_ratio ?? 0) >= 0 ? 'text-indigo-400' : 'text-rose-400'}`}>{backtestResults.sharpe_ratio?.toFixed(2) ?? '-'}</p>
                                </div>
                                <div className="p-5 rounded-3xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Win Rate</p>
                                    <p className={`text-lg font-black font-mono ${(backtestResults.win_rate ?? 0) >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>{backtestResults.win_rate?.toFixed(1) ?? '0'}%</p>
                                </div>
                                <div className="p-5 rounded-3xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Total Trades</p>
                                    <p className="text-lg font-black text-white font-mono">{backtestResults.total_trades ?? 0}</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="p-5 rounded-3xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Buy & Hold</p>
                                    <p className={`text-lg font-black font-mono ${(backtestResults.buy_hold_pct ?? 0) >= 0 ? 'text-zinc-400' : 'text-rose-400'}`}>{(backtestResults.buy_hold_pct ?? 0) > 0 ? '+' : ''}{backtestResults.buy_hold_pct?.toFixed(1) ?? '0'}%</p>
                                </div>
                                <div className="p-5 rounded-3xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Alpha (vs B&H)</p>
                                    <p className={`text-lg font-black font-mono ${(backtestResults.alpha ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{(backtestResults.alpha ?? 0) > 0 ? '+' : ''}{backtestResults.alpha?.toFixed(1) ?? '0'}%</p>
                                </div>
                                <div className="p-5 rounded-3xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Sortino Ratio</p>
                                    <p className={`text-lg font-black font-mono ${(backtestResults.sortino_ratio ?? 0) >= 1 ? 'text-emerald-400' : 'text-indigo-400'}`}>{backtestResults.sortino_ratio?.toFixed(2) ?? '-'}</p>
                                </div>
                                <div className="p-5 rounded-3xl bg-black/40 border border-white/5">
                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Features Used</p>
                                    <p className="text-lg font-black text-indigo-400 font-mono">{backtestResults.n_features ?? 11}</p>
                                </div>
                            </div>

                            {/* ---- Trade History ---- */}
                            {backtestResults.trades_log && backtestResults.trades_log.length > 0 && (
                                <TradeHistoryTable trades={backtestResults.trades_log} initialBalance={initialBalance} />
                            )}

                            {/* ---- Per-Symbol Breakdown ---- */}
                            {backtestResults.per_symbol_results && backtestResults.per_symbol_results.length > 0 && (
                                <SymbolBreakdownTable symbols={backtestResults.per_symbol_results} />
                            )}
                        </div>
                    ) : (
                        <div className="h-[600px] flex flex-col items-center justify-center p-8 rounded-[2.5rem] bg-zinc-900 border border-white/5 border-dashed relative overflow-hidden group">
                            {/* Background Pattern */}
                            <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[radial-gradient(#6366f1_1px,transparent_1px)] [background-size:20px_20px]" />

                            <div className="relative flex flex-col items-center text-center max-w-sm">
                                <div className="w-24 h-24 rounded-full bg-zinc-800/50 flex items-center justify-center mb-8 border border-white/5 group-hover:scale-110 transition-transform duration-500">
                                    <LineChart className="w-10 h-10 text-zinc-700" />
                                </div>
                                <h3 className="text-xl font-black text-white mb-3">No Simulation Data</h3>
                                <p className="text-zinc-500 text-sm leading-relaxed mb-8">
                                    Run a backtest using the configuration panel or select a previous result from the history to view detailed analytics.
                                </p>

                            </div>
                        </div>
                    )}


                </div>
            </div>
        </div >
    );
}
