"use client";

import { Zap, ChevronDown, Loader2, Database, History, TrendingUp, TrendingDown, Clock, Play, StopCircle, Brain, Layers, Cpu, Activity, Trash2, Download, Globe, Terminal } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { useState, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

interface PPOTrainingTabProps {
    dbInventory: any[];
    trainingExchange: string;
    setTrainingExchange: (ex: string) => void;
    isExchangeDropdownOpen: boolean;
    setIsExchangeDropdownOpen: (open: boolean) => void;
    isTraining: boolean;
    setIsTraining: (training: boolean) => void;
}

interface PPOModel {
    name: string;
    size_mb: number;
    created_at: string;
    exchange?: string;
    n_features?: number;
    reward_mode?: string;
    net_arch?: number[];
    total_timesteps?: number;
    learning_rate?: number;
    commission?: number;
    initial_balance?: number;
    training_rows?: number;
    trained_at?: string;
}

function PPOModelCard({ model, onDelete, onBacktest, isBacktesting }: {
    model: PPOModel,
    onDelete: (name: string) => void,
    onBacktest: (name: string) => void,
    isBacktesting: boolean
}) {
    const isCrypto = model.name.toLowerCase().includes('btc') || model.name.toLowerCase().includes('usd') || (model.exchange || '').toUpperCase() === 'CRYPTO';
    const exchange = model.exchange || (isCrypto ? 'CRYPTO' : 'STOCK');
    const archLabel = model.net_arch ? model.net_arch.join(' × ') : '64 × 64';
    const featCount = model.n_features || '?';
    const stepsLabel = model.total_timesteps ? `${(model.total_timesteps / 1000).toFixed(0)}K` : '?';
    const lrLabel = model.learning_rate ? model.learning_rate.toFixed(4) : '?';
    const rewardLabel = model.reward_mode || 'differential';
    const trainDate = model.trained_at ? new Date(model.trained_at).toLocaleDateString() : new Date(model.created_at).toLocaleDateString();

    return (
        <div className="relative group overflow-hidden">
            <div className={`absolute -inset-0.5 bg-gradient-to-r ${isCrypto ? 'from-amber-500/20 to-orange-500/20' : 'from-purple-500/20 to-indigo-500/20'} rounded-3xl blur opacity-0 group-hover:opacity-100 transition duration-1000`}></div>

            <div className="relative p-5 sm:p-6 rounded-2xl sm:rounded-3xl bg-[#09090b]/80 border border-white/5 hover:border-white/10 transition-all space-y-4 backdrop-blur-3xl shadow-2xl">
                {/* Header: Icon + Name + Delete */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-3 rounded-2xl ${isCrypto ? 'bg-amber-500/10 text-amber-400' : 'bg-purple-500/10 text-purple-400'} shadow-inner border border-white/5 shrink-0`}>
                            <Brain className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                            <div className="text-sm font-black text-white truncate">{model.name}</div>
                            <div className={`text-[10px] ${isCrypto ? 'text-amber-500' : 'text-indigo-400'} uppercase font-black tracking-[0.2em] mt-0.5`}>
                                {exchange}
                            </div>
                        </div>
                    </div>
                    <button onClick={() => onDelete(model.name)} className="p-2 rounded-xl bg-white/5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all active:scale-95 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Size & Date Row */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                        <div className="text-[8px] text-zinc-600 uppercase font-black tracking-widest">Size</div>
                        <div className="text-xs font-black text-zinc-300">{model.size_mb} MB</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-center">
                        <div className="text-[8px] text-zinc-600 uppercase font-black tracking-widest">Modified</div>
                        <div className="text-xs font-black text-zinc-300">{trainDate}</div>
                    </div>
                </div>

                {/* Feature Tags */}
                <div className="flex flex-wrap gap-1.5">
                    <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-2.5 py-1 rounded-full font-black border border-emerald-500/20">
                        {featCount} Features
                    </span>
                    <span className="text-[8px] bg-purple-500/10 text-purple-400 px-2.5 py-1 rounded-full font-black border border-purple-500/20">
                        {archLabel} Arch
                    </span>
                    <span className="text-[8px] bg-blue-500/10 text-blue-400 px-2.5 py-1 rounded-full font-black border border-blue-500/20">
                        {stepsLabel} Steps
                    </span>
                    <span className="text-[8px] bg-indigo-500/10 text-indigo-400 px-2.5 py-1 rounded-full font-black border border-indigo-500/20">
                        LR: {lrLabel}
                    </span>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-4 gap-1.5">
                    <div className="text-center p-1.5 rounded-lg bg-white/[0.02]">
                        <div className="text-[7px] text-zinc-600 uppercase font-black">Reward</div>
                        <div className="text-[10px] font-black text-amber-400 capitalize">{rewardLabel}</div>
                    </div>
                    <div className="text-center p-1.5 rounded-lg bg-white/[0.02]">
                        <div className="text-[7px] text-zinc-600 uppercase font-black">Comm</div>
                        <div className="text-[10px] font-black text-zinc-300">{model.commission ? `${(model.commission * 100).toFixed(1)}%` : '0.1%'}</div>
                    </div>
                    <div className="text-center p-1.5 rounded-lg bg-white/[0.02]">
                        <div className="text-[7px] text-zinc-600 uppercase font-black">Balance</div>
                        <div className="text-[10px] font-black text-zinc-300">${model.initial_balance ? (model.initial_balance / 1000).toFixed(0) + 'K' : '10K'}</div>
                    </div>
                    <div className="text-center p-1.5 rounded-lg bg-white/[0.02]">
                        <div className="text-[7px] text-zinc-600 uppercase font-black">Rows</div>
                        <div className="text-[10px] font-black text-zinc-300">{model.training_rows ? model.training_rows.toLocaleString() : '?'}</div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-3 border-t border-white/5 grid grid-cols-2 gap-2">
                    <button
                        onClick={() => onBacktest(model.name)}
                        disabled={isBacktesting}
                        className={`py-2.5 rounded-xl ${isCrypto ? 'bg-amber-600/10 text-amber-500 border-amber-600/10' : 'bg-indigo-600/10 text-indigo-400 border-indigo-600/10'} text-[10px] font-black uppercase tracking-[0.15em] hover:brightness-125 transition-all flex items-center justify-center gap-2 border disabled:opacity-50 active:scale-95`}
                    >
                        {isBacktesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                        Backtest
                    </button>
                    <a
                        href={`/api/admin/ppo/download/${model.name}`}
                        download
                        className="py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-[10px] font-black uppercase tracking-[0.15em] hover:bg-white/10 transition-all flex items-center justify-center gap-2 active:scale-95"
                    >
                        <Download className="w-3 h-3" />
                        Weights
                    </a>
                </div>
            </div>
        </div>
    );
}

export default function PPOTrainingTab({
    dbInventory,
    trainingExchange,
    setTrainingExchange,
    isExchangeDropdownOpen,
    setIsExchangeDropdownOpen,
    isTraining,
    setIsTraining
}: PPOTrainingTabProps) {
    // PPO Hyperparameters
    const [modelName, setModelName] = useState<string>("");
    const [totalTimesteps, setTotalTimesteps] = useState<number>(200000);
    const [learningRate, setLearningRate] = useState<number>(0.0003);
    const [nSteps, setNSteps] = useState<number>(2048);
    const [batchSize, setBatchSize] = useState<number>(64);
    const [nEpochs, setNEpochs] = useState<number>(10);
    const [gamma, setGamma] = useState<number>(0.99);
    const [clipRange, setClipRange] = useState<number>(0.2);
    const [entCoef, setEntCoef] = useState<number>(0.01);
    const [vfCoef, setVfCoef] = useState<number>(0.5);
    const [netArch, setNetArch] = useState<"small" | "medium" | "large">("medium");

    // Helpers for dynamic NN visualization
    const nodesPerLayer = netArch === "small" ? 5 : netArch === "medium" ? 8 : 12;
    const inputY = (i: number) => 65 + i * 32;
    const hiddenY = (i: number) => {
        const totalH = (nodesPerLayer - 1) * (400 / nodesPerLayer);
        const startY = (450 - totalH) / 2;
        return startY + i * (400 / nodesPerLayer);
    };
    const outputY = (i: number) => 110 + i * 55;

    // Environment parameters  
    const [initialBalance, setInitialBalance] = useState<number>(10000);
    const [maxSteps, setMaxSteps] = useState<number>(1000);
    const [rewardMode, setRewardMode] = useState<"differential" | "sharpe" | "trade_pnl" | "pnl">("differential");

    // Training status
    const [trainingStatus, setTrainingStatus] = useState<{
        running: boolean;
        phase?: string | null;
        last_message?: string | null;
        started_at?: string | null;
        completed_at?: string | null;
        error?: string | null;
        stats?: Record<string, any> | null;
    } | null>(null);

    // Training logs & metrics
    const [trainingHistory, setTrainingHistory] = useState<string[]>([]);
    const [lastLoggedMessage, setLastLoggedMessage] = useState<string | null>(null);
    const [policyLossCurve, setPolicyLossCurve] = useState<Array<{ step: number; loss: number }>>([]);
    const [rewardCurve, setRewardCurve] = useState<Array<{ step: number; reward: number }>>([]);
    const [valueLossCurve, setValueLossCurve] = useState<Array<{ step: number; loss: number }>>([]);
    const [triggeringTraining, setTriggeringTraining] = useState(false);
    const consoleEndRef = useRef<HTMLDivElement>(null);

    // PPO Model Management State
    const [savedModels, setSavedModels] = useState<PPOModel[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);

    // Backtest State
    const [backtestResults, setBacktestResults] = useState<any>(null);
    const [isBacktesting, setIsBacktesting] = useState(false);
    const [backtestStartDate, setBacktestStartDate] = useState<string>("2024-01-01");
    const [backtestEndDate, setBacktestEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [backtestExchange, setBacktestExchange] = useState<string>("");
    const [backtestSymbol, setBacktestSymbol] = useState<string>("");

    const exchangeOptions = useMemo(() => {
        const options = dbInventory.filter(i => i.priceCount > 0);
        if (!options.find(o => o.exchange === "CRYPTO" || o.exchange === "BINANCE")) {
            // Add a virtual Crypto entry if not found, to allow users to select it
            options.push({ exchange: "CRYPTO", priceCount: 1, symbols: ["BTC-USD"] });
        }
        return options;
    }, [dbInventory]);

    const selectedExchangeCount = dbInventory.find(i => i.exchange === trainingExchange)?.priceCount || 0;

    const netArchConfig = {
        small: { layers: [32, 32], params: "~2,200", label: "32 × 32" },
        medium: { layers: [64, 64], params: "~8,500", label: "64 × 64" },
        large: { layers: [128, 128], params: "~33,000", label: "128 × 128" },
    };

    // Estimated training time
    const estimatedTime = useMemo(() => {
        const base = totalTimesteps / 1000; // rough seconds per 1k steps
        const archMultiplier = netArch === "small" ? 0.5 : netArch === "large" ? 2 : 1;
        const secs = base * archMultiplier;
        return {
            minutes: Math.ceil(secs / 60),
            descriptor: secs < 300 ? "Quick Run" : secs < 1800 ? "Standard Run" : "Deep Training",
            color: secs < 300 ? "text-emerald-400" : secs < 1800 ? "text-indigo-400" : "text-purple-400"
        };
    }, [totalTimesteps, netArch]);

    // Log accumulation
    useEffect(() => {
        if (!trainingStatus?.last_message) return;
        const msg = String(trainingStatus.last_message);
        if (!msg.trim() || msg === lastLoggedMessage) return;
        setLastLoggedMessage(msg);
        setTrainingHistory(prev => {
            const next = [...prev, msg];
            return next.length > 300 ? next.slice(next.length - 300) : next;
        });
    }, [trainingStatus?.last_message, lastLoggedMessage]);

    // Auto-scroll logs - Removed per user request
    // useEffect(() => {
    //     logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    // }, [trainingLogs]);

    // Metric curve updates from live stats
    useEffect(() => {
        if (!trainingStatus?.running || !trainingStatus.stats) return;
        const stats = trainingStatus.stats;
        const now = Date.now();

        // SB3 specific keys or our manual keys
        const pLoss = typeof stats['train/policy_gradient_loss'] === "number" ? stats['train/policy_gradient_loss'] : stats.policy_loss;
        const vLoss = typeof stats['train/value_loss'] === "number" ? stats['train/value_loss'] : stats.value_loss;
        const rMean = typeof stats['rollout/ep_rew_mean'] === "number" ? stats['rollout/ep_rew_mean'] : stats.ep_rew_mean;

        if (typeof pLoss === "number") {
            setPolicyLossCurve(prev => {
                const last = prev[prev.length - 1];
                if (last && Math.abs(last.loss - pLoss) < 0.0001) return prev;
                const next = [...prev, { step: now, loss: pLoss }];
                return next.length > 200 ? next.slice(-200) : next;
            });
        }
        if (typeof vLoss === "number") {
            setValueLossCurve(prev => {
                const last = prev[prev.length - 1];
                if (last && Math.abs(last.loss - vLoss) < 0.0001) return prev;
                const next = [...prev, { step: now, loss: vLoss }];
                return next.length > 200 ? next.slice(-200) : next;
            });
        }
        if (typeof rMean === "number") {
            setRewardCurve(prev => {
                const last = prev[prev.length - 1];
                if (last && Math.abs(last.reward - rMean) < 0.01) return prev;
                const next = [...prev, { step: now, reward: rMean }];
                return next.length > 200 ? next.slice(-200) : next;
            });
        }
    }, [trainingStatus?.running, trainingStatus?.stats]);

    // Polling for training status - Optimized to poll only when visible and less frequently when idle
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch("/api/admin/ppo/status");
                if (!res.ok) return;
                const data = await res.json();

                // If it was running and now it's not, refresh models
                if (trainingStatus?.running === true && data.running === false) {
                    fetchSavedModels();
                }

                setTrainingStatus(data);
                if (typeof data.running === "boolean") {
                    setIsTraining(data.running);
                }
            } catch { /* ignore */ }
        };

        // Initial fetch
        fetchStatus();

        const pollInterval = isTraining ? 2000 : 30000; // 2s active, 30s idle
        const poll = setInterval(() => {
            if (document.visibilityState === 'visible') {
                fetchStatus();
            }
        }, pollInterval);

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchStatus();
            }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);

        return () => {
            clearInterval(poll);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [isTraining, trainingStatus?.running]);

    // Model management logic
    const fetchSavedModels = async () => {
        setIsLoadingModels(true);
        try {
            const res = await fetch("/api/admin/ppo/models");
            if (res.ok) {
                const data = await res.json();
                setSavedModels(data.models || []);
            }
        } catch (error) {
            console.error("Failed to fetch PPO models:", error);
        } finally {
            setIsLoadingModels(false);
        }
    };

    const deleteModel = async (filename: string) => {
        if (!confirm(`Are you sure you want to delete ${filename}?`)) return;
        try {
            const res = await fetch(`/api/admin/ppo/delete/${filename}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success("Model deleted");
                fetchSavedModels();
            } else {
                toast.error("Failed to delete model");
            }
        } catch (error) {
            toast.error("Error deleting model");
        }
    };

    // Initial models fetch
    useEffect(() => {
        fetchSavedModels();
    }, []);

    const runBacktest = async (modelName: string) => {
        setIsBacktesting(true);
        setBacktestResults(null);
        try {
            const res = await fetch("http://localhost:8000/admin/ppo/backtest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model_name: modelName,
                    exchange: backtestExchange || trainingExchange,
                    symbol: backtestSymbol || undefined,
                    initial_balance: 10000,
                    start_date: backtestStartDate,
                    end_date: backtestEndDate
                })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.status === "success") {
                    setBacktestResults(data);
                    toast.success("Backtest completed successfully");
                } else {
                    toast.error(data.message || "Backtest failed");
                }
            } else {
                toast.error("Server error during backtest");
            }
        } catch (error) {
            toast.error("Network error during backtest");
        } finally {
            setIsBacktesting(false);
        }
    };

    const startPPOTraining = async () => {
        if (!trainingExchange) {
            toast.error("Select an exchange first");
            return;
        }
        setTriggeringTraining(true);
        try {
            const res = await fetch("/api/admin/ppo/train", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    exchange: trainingExchange,
                    model_name: modelName || undefined,
                    total_timesteps: totalTimesteps,
                    learning_rate: learningRate,
                    n_steps: nSteps,
                    batch_size: batchSize,
                    n_epochs: nEpochs,
                    gamma,
                    clip_range: clipRange,
                    ent_coef: entCoef,
                    vf_coef: vfCoef,
                    net_arch: netArchConfig[netArch].layers,
                    initial_balance: initialBalance,
                    max_steps: maxSteps,
                    reward_mode: rewardMode
                })
            });

            if (res.ok) {
                toast.success("PPO training started");
                setIsTraining(true);
                // Clear old curves
                setPolicyLossCurve([]);
                setRewardCurve([]);
                setValueLossCurve([]);
                setTrainingHistory([]);
            } else {
                const err = await res.json().catch(() => null);
                let errorMsg = "Failed to start";
                if (err?.detail) {
                    if (Array.isArray(err.detail)) {
                        errorMsg = err.detail.map((e: any) => `${e.msg} (${e.loc?.join('.')})`).join(", ");
                    } else if (typeof err.detail === "object") {
                        errorMsg = JSON.stringify(err.detail);
                    } else {
                        errorMsg = String(err.detail);
                    }
                }
                toast.error(errorMsg);
            }
        } catch {
            toast.error("Connection error");
        } finally {
            setTriggeringTraining(false);
        }
    };

    const stopTraining = async () => {
        try {
            await fetch("/api/admin/ppo/stop", { method: "POST" });
            toast.success("Stopping...");
        } catch {
            toast.error("Failed to stop");
        }
    };

    return (
        <div className="p-4 sm:p-6 lg:p-10 max-w-[1800px] mx-auto w-full space-y-8 sm:space-y-10 lg:space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            <header className="relative py-4 sm:py-6">
                <div className="absolute -left-12 top-1/2 -translate-y-1/2 w-32 h-32 bg-purple-600/20 blur-[80px] rounded-full pointer-events-none" />
                <div className="flex flex-col gap-2 relative z-10">
                    <div className="flex items-center gap-3 sm:gap-4">
                        <div className="p-3 sm:p-4 rounded-[2rem] bg-gradient-to-br from-purple-600 to-indigo-600 shadow-[0_0_40px_rgba(139,92,246,0.3)] border border-white/20 relative group overflow-hidden">
                            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                            <Brain className="h-6 w-6 sm:h-8 sm:w-8 text-white relative z-10" />
                        </div>
                        <div>
                            <h1 className="text-2xl sm:text-3xl lg:text-5xl font-black tracking-[-0.05em] text-white flex items-center gap-2">
                                PPO Agent <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-400">Hub</span>
                            </h1>
                            <div className="flex items-center gap-2 mt-1">
                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <p className="text-[10px] sm:text-xs text-zinc-500 font-bold uppercase tracking-[0.3em]">Proximal Policy Optimization</p>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Detailed Training Metrics Grid - Surfaced from SB3 Logger */}
            {isTraining && trainingStatus?.stats && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 animate-in zoom-in-95 duration-700">
                    {[
                        { label: 'FPS', value: (trainingStatus.stats['time/fps'] || 0).toFixed(0), icon: <Zap className="w-4 h-4" />, color: 'text-amber-400', from: 'from-amber-500/20' },
                        { label: 'KL Div', value: (trainingStatus.stats['train/approx_kl'] || 0).toFixed(6), icon: <Activity className="w-4 h-4" />, color: 'text-purple-400', from: 'from-purple-500/20' },
                        { label: 'Entropy', value: (trainingStatus.stats['train/entropy_loss'] || 0).toFixed(4), icon: <Brain className="w-4 h-4" />, color: 'text-rose-400', from: 'from-rose-500/20' },
                        { label: 'Expl. Var', value: (trainingStatus.stats['train/explained_variance'] || 0).toFixed(4), icon: <TrendingUp className="w-4 h-4" />, color: 'text-emerald-400', from: 'from-emerald-500/20' },
                        { label: 'Updates', value: (trainingStatus.stats['train/n_updates'] || 0).toFixed(0), icon: <Layers className="w-4 h-4" />, color: 'text-blue-400', from: 'from-blue-500/20' },
                        { label: 'Timesteps', value: (trainingStatus.stats['time/total_timesteps'] || 0).toLocaleString(), icon: <Clock className="w-4 h-4" />, color: 'text-indigo-400', from: 'from-indigo-500/20' },
                    ].map((stat, i) => (
                        <div key={i} className={`relative group p-4 sm:p-6 rounded-3xl bg-zinc-900 border border-white/5 flex flex-col items-center justify-center text-center transition-all duration-300 hover:border-white/10 hover:shadow-[0_0_30px_rgba(255,255,255,0.02)] overflow-hidden`}>
                            <div className={`absolute inset-0 bg-gradient-to-br ${stat.from} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                            <div className={`${stat.color} mb-3 relative z-10 p-2 rounded-xl bg-white/[0.03] border border-white/5`}>{stat.icon}</div>
                            <p className={`text-xl sm:text-2xl font-black tracking-tighter ${stat.color} relative z-10`}>{stat.value}</p>
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mt-2 relative z-10 opacity-60 group-hover:opacity-100 transition-opacity">{stat.label}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* Main Content Grid: Config (Left) + Charts (Right) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 sm:gap-10">

                {/* Left Column: Configuration */}
                <div className="space-y-10">

                    {/* Primary Training Config Panel */}
                    <div className="p-6 sm:p-8 rounded-[2.5rem] bg-[#09090b]/40 border border-white/5 backdrop-blur-3xl space-y-8 relative overflow-hidden group shadow-2xl">
                        <div className="absolute top-0 right-0 p-12 bg-indigo-500/10 blur-[80px] rounded-full -mr-16 -mt-16 transition-all group-hover:bg-indigo-500/15" />

                        <div className="flex items-center gap-4 relative z-10">
                            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 text-indigo-400 shadow-inner">
                                <Cpu className="w-6 h-6 sm:w-7 sm:h-7" />
                            </div>
                            <div>
                                <h2 className="text-xl font-black text-white tracking-[-0.02em]">Training Hub</h2>
                                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em] mt-1 opacity-60">PPO Architecture</p>
                            </div>
                        </div>

                        <div className="space-y-6 relative z-10">
                            {/* Input: Agent ID */}
                            <div className="space-y-2.5">
                                <label className="text-[10px] text-zinc-500 uppercase font-black px-1 tracking-[0.2em] flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500/50" />
                                    Agent identifier
                                </label>
                                <input type="text" value={modelName} onChange={(e) => setModelName(e.target.value)}
                                    placeholder="e.g. ALPHA_V1"
                                    className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-5 py-4 text-zinc-100 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500/30 transition-all placeholder:text-zinc-800"
                                />
                            </div>

                            {/* Select: Network Arch */}
                            <div className="space-y-2.5">
                                <label className="text-[10px] text-zinc-500 uppercase font-black px-1 tracking-[0.2em] flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500/50" />
                                    Layer complexity
                                </label>
                                <div className="p-1.5 bg-white/[0.03] border border-white/5 rounded-2xl flex gap-1">
                                    {(["small", "medium", "large"] as const).map(arch => (
                                        <button key={arch} onClick={() => setNetArch(arch)}
                                            className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${netArch === arch
                                                ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg"
                                                : "text-zinc-500 hover:text-white hover:bg-white/5"}`}>
                                            {arch}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Exchange Selector Dropdown */}
                            <div className="space-y-2.5">
                                <label className="text-[10px] text-zinc-500 uppercase font-black px-1 tracking-[0.2em] flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" />
                                    Intelligence domain
                                </label>
                                <div className="relative">
                                    <button onClick={() => setIsExchangeDropdownOpen(!isExchangeDropdownOpen)}
                                        className={`w-full bg-white/[0.03] border ${isExchangeDropdownOpen ? 'border-indigo-500/50 ring-2 ring-indigo-500/10' : 'border-white/10'} rounded-2xl p-4 text-sm text-left transition-all flex items-center justify-between group/btn`}>
                                        <span className={trainingExchange ? 'text-white font-black' : 'text-zinc-600 font-bold'}>
                                            {trainingExchange ? (
                                                <span className="flex items-center gap-3">
                                                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)] animate-pulse" />
                                                    {trainingExchange}
                                                    <span className="text-zinc-600 text-xs ml-auto font-mono">[{selectedExchangeCount}]</span>
                                                </span>
                                            ) : "Deploy target..."}
                                        </span>
                                        <ChevronDown className={`w-5 h-5 text-zinc-600 transition-transform duration-500 ${isExchangeDropdownOpen ? 'rotate-180 text-white' : ''}`} />
                                    </button>
                                    {isExchangeDropdownOpen && (
                                        <div className="absolute top-full mt-3 w-full bg-[#0d0d0f] border border-white/10 rounded-2xl shadow-2xl z-50 p-2 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300 backdrop-blur-3xl">
                                            <div className="max-h-60 overflow-y-auto custom-scrollbar pr-1">
                                                {exchangeOptions.map(inv => (
                                                    <button key={inv.exchange}
                                                        onClick={() => { setTrainingExchange(inv.exchange); setIsExchangeDropdownOpen(false); }}
                                                        className={`w-full px-4 py-3.5 rounded-xl text-sm text-left transition-all flex items-center justify-between group/item ${trainingExchange === inv.exchange ? 'bg-indigo-500/10 text-indigo-400 font-black' : 'text-zinc-500 hover:bg-white/5 hover:text-white'}`}>
                                                        <span>{inv.exchange}</span>
                                                        <span className="text-[10px] font-bold opacity-40 group-hover/item:opacity-100">{inv.priceCount} Tickers</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* PPO Sub-parameters Group */}
                            <div className="pt-4 border-t border-white/5 grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-[9px] text-zinc-600 uppercase font-black px-1 tracking-widest">Total steps</label>
                                    <select value={totalTimesteps} onChange={(e) => setTotalTimesteps(Number(e.target.value))}
                                        className="w-full bg-zinc-950 border border-white/5 rounded-xl px-4 py-3 text-zinc-300 text-xs font-bold focus:outline-none focus:border-indigo-500/30 transition-all appearance-none cursor-pointer [&>option]:bg-zinc-950 [&>option]:text-zinc-300">
                                        <option value={20000}>20K Quick</option>
                                        <option value={50000}>50K Fast</option>
                                        <option value={100000}>100K Steps</option>
                                        <option value={200000}>200K Optimal</option>
                                        <option value={500000}>500K Deep</option>
                                        <option value={1000000}>1M Ultra</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[9px] text-zinc-600 uppercase font-black px-1 tracking-widest">Learning rate</label>
                                    <input type="number" step={0.0001} value={learningRate} onChange={(e) => setLearningRate(Number(e.target.value))}
                                        className="w-full bg-white/[0.02] border border-white/5 rounded-xl px-4 py-3 text-zinc-300 text-xs font-bold focus:outline-none focus:border-indigo-500/30 transition-all" />
                                </div>
                            </div>

                            {/* Advanced PPO settings nested in accordion-like feel if needed, but here listed flat for speed */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-2 text-center">
                                    <label className="text-[8px] text-zinc-600 uppercase font-black tracking-tighter">Gamma</label>
                                    <input type="number" step={0.01} value={gamma} onChange={(e) => setGamma(Number(e.target.value))}
                                        className="w-full bg-white/[0.01] border border-white/5 rounded-lg py-2 text-center text-[10px] font-mono text-indigo-400" />
                                </div>
                                <div className="space-y-2 text-center">
                                    <label className="text-[8px] text-zinc-600 uppercase font-black tracking-tighter">Clip</label>
                                    <input type="number" step={0.05} value={clipRange} onChange={(e) => setClipRange(Number(e.target.value))}
                                        className="w-full bg-white/[0.01] border border-white/5 rounded-lg py-2 text-center text-[10px] font-mono text-purple-400" />
                                </div>
                                <div className="space-y-2 text-center">
                                    <label className="text-[8px] text-zinc-600 uppercase font-black tracking-tighter">Entropy</label>
                                    <input type="number" step={0.001} value={entCoef} onChange={(e) => setEntCoef(Number(e.target.value))}
                                        className="w-full bg-white/[0.01] border border-white/5 rounded-lg py-2 text-center text-[10px] font-mono text-amber-400" />
                                </div>
                            </div>

                            {/* Environmental & Reward */}
                            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Env Config</span>
                                    <span className="text-[10px] text-emerald-500 font-mono tracking-tighter flex items-center gap-1">
                                        <Database className="w-3 h-3" />
                                        v2.4
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <p className="text-[8px] text-zinc-600 uppercase font-black mb-1">Balance</p>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-[10px]">$</span>
                                            <input type="number" value={initialBalance} onChange={(e) => setInitialBalance(Number(e.target.value))}
                                                className="w-full bg-black/40 border border-white/5 rounded-xl pl-6 pr-3 py-2.5 text-xs font-black text-white" />
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[8px] text-zinc-600 uppercase font-black mb-1">Reward</p>
                                        <select value={rewardMode} onChange={(e) => setRewardMode(e.target.value as any)}
                                            className="w-full bg-zinc-950 border border-white/5 rounded-xl px-3 py-2.5 text-xs font-black text-white appearance-none [&>option]:bg-zinc-950 [&>option]:text-zinc-300">
                                            <option value="pnl">PnL Focus</option>
                                            <option value="sharpe">Sharpe Ratio</option>
                                            <option value="sortino">Sortino Edge</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Estimated Impact */}
                            <div className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                                        <Clock className="w-4 h-4" />
                                    </div>
                                    <div className="leading-tight">
                                        <p className="text-[10px] text-zinc-400 font-black uppercase tracking-widest">Duration</p>
                                        <p className="text-sm font-black text-white">~{estimatedTime.minutes}m <span className="text-[10px] text-zinc-500 font-bold ml-1">Est.</span></p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className={`text-[9px] font-black uppercase ${estimatedTime.color} bg-white/5 px-2 py-1 rounded-md border border-white/5`}>
                                        {estimatedTime.descriptor}
                                    </p>
                                </div>
                            </div>

                            {/* Master Controls */}
                            <div className="flex gap-3 pt-2">
                                <button onClick={startPPOTraining}
                                    disabled={isTraining || triggeringTraining || !trainingExchange}
                                    className="flex-1 py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-black uppercase tracking-[0.2em] hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-3 shadow-[0_10px_30px_rgba(99,102,241,0.2)] disabled:opacity-40 disabled:grayscale">
                                    {triggeringTraining ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                                    Initiate Training
                                </button>
                                <button onClick={stopTraining} disabled={!isTraining}
                                    className="w-16 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-red-400 hover:bg-red-500/10 hover:border-red-500/20 active:scale-90 transition-all disabled:opacity-30">
                                    <StopCircle className="w-6 h-6" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Charts & Execution */}
                <div className="flex flex-col gap-8">

                    {/* Backtest Results Overlay/Section */}
                    {backtestResults && (
                        <div className="p-6 sm:p-10 rounded-[2.5rem] bg-indigo-500/5 border border-indigo-500/30 backdrop-blur-3xl space-y-8 animate-in zoom-in-95 duration-500 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-24 bg-indigo-500/10 blur-[100px] rounded-full -mr-20 -mt-20" />

                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative z-10">
                                <div className="flex items-center gap-5">
                                    <div className="p-4 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.2)]">
                                        <TrendingUp className="w-8 h-8" />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-black text-white tracking-tight">Strategy Validation</h2>
                                        <div className="flex items-center gap-2 mt-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em]">OOS Performance Data</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 sm:gap-12 flex-wrap bg-white/[0.02] border border-white/5 p-4 rounded-2xl">
                                    <div className="text-left">
                                        <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Total Return</p>
                                        <p className={`text-2xl font-black ${backtestResults.total_pnl_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'} tracking-tighter`}>
                                            {backtestResults.total_pnl_pct > 0 ? '+' : ''}{backtestResults.total_pnl_pct.toFixed(2)}%
                                        </p>
                                    </div>
                                    <div className="w-px h-8 bg-white/5" />
                                    <div className="text-left">
                                        <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Final Equity</p>
                                        <p className="text-2xl font-black text-white tracking-tighter">
                                            ${backtestResults.final_net_worth.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                                        </p>
                                    </div>
                                    <button onClick={() => setBacktestResults(null)}
                                        className="ml-2 p-3 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-500 hover:text-white transition-all">
                                        <ChevronDown className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            <div className="h-[300px] sm:h-[400px] w-full rounded-3xl bg-black/20 border border-white/5 p-6 relative z-10">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={backtestResults.history}>
                                        <defs>
                                            <linearGradient id="colorWorth" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="8 8" stroke="rgba(255,255,255,0.03)" vertical={false} />
                                        <XAxis dataKey="step" hide />
                                        <YAxis hide domain={['auto', 'auto']} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#09090b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', backdropFilter: 'blur(12px)' }}
                                            itemStyle={{ color: '#818cf8', fontWeight: '900' }}
                                            formatter={(value: any) => [`$${value.toLocaleString()}`, 'Portfolio']}
                                        />
                                        <Area type="monotone" dataKey="net_worth" stroke="#818cf8" strokeWidth={4} fill="url(#colorWorth)" strokeLinecap="round" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {(policyLossCurve.length > 0 || rewardCurve.length > 0) && <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-10">
                        {/* Policy Loss Chart */}
                        <div className="p-6 sm:p-8 rounded-[2.5rem] bg-zinc-900/40 border border-white/5 backdrop-blur-3xl space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
                                        Policy gradient
                                    </h4>
                                    <p className="text-[10px] font-bold text-zinc-600 mt-1">Convergence entropy</p>
                                </div>
                                <TrendingDown className="w-4 h-4 text-rose-500/50" />
                            </div>
                            <div className="h-[180px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={policyLossCurve}>
                                        <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="rgba(255,255,255,0.02)" />
                                        <XAxis dataKey="step" hide />
                                        <YAxis hide domain={['auto', 'auto']} />
                                        <Tooltip contentStyle={{ backgroundColor: '#000', border: 'none', borderRadius: '12px' }} itemStyle={{ color: '#f43f5e', fontSize: '10px', fontWeight: '900' }} />
                                        <Line type="monotone" dataKey="loss" stroke="#f43f5e" strokeWidth={3} dot={false} isAnimationActive={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Reward Curve */}
                        <div className="p-6 sm:p-8 rounded-[2.5rem] bg-zinc-900/40 border border-white/5 backdrop-blur-3xl space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h4 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                                        Mean Reward
                                    </h4>
                                    <p className="text-[10px] font-bold text-zinc-600 mt-1">Episode efficiency</p>
                                </div>
                                <TrendingUp className="w-4 h-4 text-emerald-500/50" />
                            </div>
                            <div className="h-[180px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={rewardCurve}>
                                        <defs>
                                            <linearGradient id="rewardFillPremium" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                                                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="rgba(255,255,255,0.02)" />
                                        <XAxis dataKey="step" hide />
                                        <YAxis hide domain={['auto', 'auto']} />
                                        <Area type="monotone" dataKey="reward" stroke="#10b981" strokeWidth={3} fill="url(#rewardFillPremium)" isAnimationActive={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>}

                    {/* Live Training Console - In Right Column */}
                    <div className="flex-1 p-6 sm:p-8 rounded-[2.5rem] bg-[#09090b]/60 border border-white/5 backdrop-blur-3xl flex flex-col gap-6 relative overflow-hidden group">
                        <div className="flex items-center justify-between relative z-10">
                            <div className="flex items-center gap-4">
                                <div className="p-3 rounded-xl bg-zinc-950 border border-white/5 text-indigo-400">
                                    <Terminal className="w-5 h-5" />
                                </div>
                                <div>
                                    <h4 className="text-base font-black text-white tracking-tight">System Matrix</h4>
                                    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mt-0.5">Live execution telemetry</p>
                                </div>
                            </div>
                            {isTraining && (
                                <div className="flex items-center gap-2 px-3 py-1 bg-indigo-500/10 rounded-full border border-indigo-500/20">
                                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
                                    <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">Training Active</span>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 min-h-[200px] w-full bg-black/40 rounded-2xl border border-white/5 p-4 font-mono text-[10px] overflow-hidden relative group/console">
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none z-10" />
                            <div className="space-y-2 overflow-y-auto h-full custom-scrollbar pr-2 scroll-smooth">
                                {trainingHistory.map((log: string, i: number) => (
                                    <div key={i} className="flex gap-4 group/line animate-in slide-in-from-left-2 duration-300">
                                        <span className="text-zinc-800 font-black shrink-0">[{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                                        <span className={`${log.includes('ERROR') ? 'text-rose-500' : log.includes('Success') ? 'text-emerald-500' : 'text-zinc-500'} font-bold break-all`}>
                                            {log}
                                        </span>
                                    </div>
                                ))}
                                {trainingHistory.length === 0 && (
                                    <div className="h-full flex flex-col items-center justify-center opacity-20">
                                        <Activity className="w-8 h-8 mb-4 animate-pulse" />
                                        <p className="font-black">AWAITING SYSTEM INITIALIZATION...</p>
                                    </div>
                                )}
                                <div ref={consoleEndRef} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Saved PPO Models Artifacts - Full Width Section */}
            <div className="space-y-6">
                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 shadow-inner">
                            <History className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-white tracking-tight">Model Artifacts</h3>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Neural Snapshots &amp; Trained Weights</p>
                        </div>
                    </div>
                    <button onClick={fetchSavedModels} className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all active:rotate-180 duration-500">
                        <Loader2 className={`w-4 h-4 text-zinc-400 ${isLoadingModels ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {savedModels.length > 0 ? (
                        savedModels.map((model: PPOModel, idx: number) => (
                            <PPOModelCard
                                key={idx}
                                model={model}
                                onDelete={deleteModel}
                                onBacktest={runBacktest}
                                isBacktesting={isBacktesting}
                            />
                        ))
                    ) : (
                        <div className="col-span-full py-16 text-center border-2 border-dashed border-white/5 rounded-3xl bg-indigo-500/[0.02]">
                            <Brain className="w-12 h-12 text-zinc-800 mx-auto mb-4 opacity-10" />
                            <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-700">Awaiting intelligence...</p>
                            <p className="text-[10px] font-bold text-zinc-800 mt-2">Generate artifacts through training</p>
                        </div>
                    )}
                </div>
            </div>


            <div className="p-4 sm:p-6 lg:p-8 rounded-2xl sm:rounded-3xl bg-zinc-900 border border-zinc-800 space-y-4 sm:space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
                    <div className="flex items-center gap-4">
                        <div className="p-3 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                            <Layers className="w-6 h-6" />
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg lg:text-xl font-black text-white">MLP Policy Network Architecture</h2>
                            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-1">
                                Input(11) → Dense({netArchConfig[netArch].layers[0]}) → Dense({netArchConfig[netArch].layers[1]}) → Actions
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:gap-3">
                        <span className="px-4 py-2 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-black border border-purple-500/20 flex items-center gap-2">
                            <Cpu className="w-3 h-3" /> {netArchConfig[netArch].params} Params
                        </span>
                        <span className="px-4 py-2 rounded-full bg-indigo-500/10 text-indigo-400 text-[10px] font-black border border-indigo-500/20 flex items-center gap-2">
                            <Activity className="w-3 h-3" /> Actor-Critic
                        </span>
                    </div>
                </div>

                {/* SVG Network Diagram */}
                <div className="w-full overflow-x-auto">
                    <svg viewBox="0 0 900 420" className="w-full min-w-[600px]" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <linearGradient id="ppo-conn-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
                                <stop offset="50%" stopColor="#6366f1" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.3" />
                            </linearGradient>
                            <linearGradient id="ppo-conn-grad2" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.4" />
                            </linearGradient>
                            <filter id="ppo-glow-p">
                                <feGaussianBlur stdDeviation="3" result="g" />
                                <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                            <filter id="ppo-glow-i">
                                <feGaussianBlur stdDeviation="3" result="g" />
                                <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                            <filter id="ppo-glow-b">
                                <feGaussianBlur stdDeviation="3" result="g" />
                                <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                            <filter id="ppo-glow-o">
                                <feGaussianBlur stdDeviation="3" result="g" />
                                <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                        </defs>

                        {/* Layer labels */}
                        <text x="100" y="22" textAnchor="middle" fill="#8b5cf6" fontSize="10" fontWeight="900" letterSpacing="0.1em">INPUT LAYER</text>
                        <text x="100" y="38" textAnchor="middle" fill="#52525b" fontSize="8" fontWeight="bold">11 Features</text>
                        <text x="350" y="22" textAnchor="middle" fill="#6366f1" fontSize="10" fontWeight="900" letterSpacing="0.1em">HIDDEN 1</text>
                        <text x="350" y="38" textAnchor="middle" fill="#52525b" fontSize="8" fontWeight="bold">{netArchConfig[netArch].layers[0]} Neurons (ReLU)</text>
                        <text x="570" y="22" textAnchor="middle" fill="#3b82f6" fontSize="10" fontWeight="900" letterSpacing="0.1em">HIDDEN 2</text>
                        <text x="570" y="38" textAnchor="middle" fill="#52525b" fontSize="8" fontWeight="bold">{netArchConfig[netArch].layers[1]} Neurons (ReLU)</text>
                        <text x="790" y="22" textAnchor="middle" fill="#f59e0b" fontSize="10" fontWeight="900" letterSpacing="0.1em">OUTPUT</text>
                        <text x="790" y="38" textAnchor="middle" fill="#52525b" fontSize="8" fontWeight="bold">Actions</text>

                        {/* Connections: Input → H1 */}
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i =>
                            [...Array(nodesPerLayer)].map((_, j) => (
                                <line key={`ih-${i}-${j}`} x1="118" y1={inputY(i)} x2="332" y2={hiddenY(j)}
                                    stroke="url(#ppo-conn-grad)"
                                    strokeWidth={netArch === 'large' ? 0.6 : 0.4}
                                    opacity={isTraining ? 0.35 : 0.15}
                                    className={isTraining ? "ppo-animate-flow" : ""}
                                    strokeDasharray="4 4" />
                            ))
                        )}

                        {/* Connections: H1 → H2 */}
                        {[...Array(nodesPerLayer)].map((_, i) =>
                            [...Array(nodesPerLayer)].map((_, j) => (
                                <line key={`hh-${i}-${j}`} x1="368" y1={hiddenY(i)} x2="552" y2={hiddenY(j)}
                                    stroke="url(#ppo-conn-grad)"
                                    strokeWidth={netArch === 'large' ? 0.6 : 0.4}
                                    opacity={isTraining ? 0.4 : 0.2}
                                    className={isTraining ? "ppo-animate-flow" : ""}
                                    strokeDasharray="4 4" />
                            ))
                        )}

                        {/* Connections: H2 → Output */}
                        {[...Array(nodesPerLayer)].map((_, i) =>
                            [0, 1, 2, 3, 4].map(j => (
                                <line key={`ho-${i}-${j}`} x1="588" y1={hiddenY(i)} x2="772" y2={outputY(j)}
                                    stroke="url(#ppo-conn-grad2)"
                                    strokeWidth={netArch === 'large' ? 0.8 : 0.5}
                                    opacity={isTraining ? 0.4 : 0.2}
                                    className={isTraining ? "ppo-animate-flow" : ""}
                                    strokeDasharray="4 4" />
                            ))
                        )}

                        {/* Input nodes */}
                        {['RSI', 'ATR', 'MACD', 'SIGN', 'SMA50', 'SMA200', 'HiDst', 'LoDst', 'RSIdf', 'V20', 'Day'].map((label, i) => (
                            <g key={`in-${i}`}>
                                <circle cx="100" cy={inputY(i)} r="13" fill="#8b5cf6" fillOpacity="0.12" stroke="#8b5cf6" strokeWidth="1.5" filter="url(#ppo-glow-p)" />
                                <circle cx="100" cy={inputY(i)} r="5" fill="#8b5cf6" fillOpacity={isTraining ? 1 : 0.8}>
                                    {isTraining && <animate attributeName="opacity" values="0.6;1;0.6" dur={`${1.5 + i * 0.1}s`} repeatCount="indefinite" />}
                                </circle>
                                <text x="68" y={inputY(i) + 4} fill="#8b5cf6" fontSize="7" fontWeight="bold" textAnchor="end" fontFamily="monospace">{label}</text>
                            </g>
                        ))}

                        {/* Hidden 1 nodes */}
                        {[...Array(nodesPerLayer)].map((_, i) => (
                            <g key={`h1-${i}`}>
                                <circle cx="350" cy={hiddenY(i)} r="13" fill="#6366f1" fillOpacity="0.12" stroke="#6366f1" strokeWidth="1.5" filter="url(#ppo-glow-i)" />
                                <circle cx="350" cy={hiddenY(i)} r="5" fill="#6366f1" fillOpacity={isTraining ? 1 : 0.8}>
                                    {isTraining && <animate attributeName="opacity" values="0.5;1;0.5" dur={`${2 + i * 0.2}s`} repeatCount="indefinite" />}
                                </circle>
                            </g>
                        ))}
                        <text x="350" y="385" fill="#52525b" fontSize="8" textAnchor="middle" fontWeight="bold" fontStyle="italic">... {netArchConfig[netArch].layers[0]} neurons total</text>

                        {/* Hidden 2 nodes */}
                        {[...Array(nodesPerLayer)].map((_, i) => (
                            <g key={`h2-${i}`}>
                                <circle cx="570" cy={hiddenY(i)} r="13" fill="#3b82f6" fillOpacity="0.12" stroke="#3b82f6" strokeWidth="1.5" filter="url(#ppo-glow-b)" />
                                <circle cx="570" cy={hiddenY(i)} r="5" fill="#3b82f6" fillOpacity={isTraining ? 1 : 0.8}>
                                    {isTraining && <animate attributeName="opacity" values="0.5;1;0.5" dur={`${2.5 + i * 0.2}s`} repeatCount="indefinite" />}
                                </circle>
                            </g>
                        ))}
                        <text x="570" y="385" fill="#52525b" fontSize="8" textAnchor="middle" fontWeight="bold" fontStyle="italic">... {netArchConfig[netArch].layers[1]} neurons total</text>

                        {/* Output nodes */}
                        {['HOLD', 'CLOSE', 'BUY', 'SELL', '...'].map((label, i) => (
                            <g key={`out-${i}`}>
                                <circle cx="790" cy={outputY(i)} r="14" fill="#f59e0b" fillOpacity="0.12" stroke="#f59e0b" strokeWidth="1.5" filter="url(#ppo-glow-o)" />
                                <circle cx="790" cy={outputY(i)} r="5" fill="#f59e0b" fillOpacity={isTraining ? 1 : 0.8}>
                                    {isTraining && <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />}
                                </circle>
                                <text x="822" y={outputY(i) + 4} fill="#f59e0b" fontSize="7" fontWeight="bold" fontFamily="monospace">{label}</text>
                            </g>
                        ))}
                    </svg>
                </div>

                {/* Architecture Info Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                        { label: 'Input Features', value: '11', sub: '8 indicators + 3 state', color: 'text-purple-400', bg: 'bg-purple-500/10' },
                        { label: 'Hidden Neurons', value: String(netArchConfig[netArch].layers[0] * 2), sub: `2 × ${netArchConfig[netArch].layers[0]} Dense`, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
                        { label: 'Action Space', value: '130+', sub: 'HOLD + CLOSE + OPENs', color: 'text-blue-400', bg: 'bg-blue-500/10' },
                        { label: 'Activation', value: 'ReLU', sub: 'Non-linear Transform', color: 'text-amber-400', bg: 'bg-amber-500/10' }
                    ].map((card, i) => (
                        <div key={i} className={`${card.bg} p-5 rounded-2xl border border-white/5 text-center`}>
                            <p className={`text-3xl font-black tracking-tighter ${card.color}`}>{card.value}</p>
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mt-1">{card.label}</p>
                            <p className="text-[8px] font-bold text-zinc-600 mt-1">{card.sub}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
