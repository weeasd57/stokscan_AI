"use client";

import { useState, useEffect } from "react";
import { 
    ResponsiveContainer, 
    LineChart, 
    Line, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip as ChartTooltip, 
    ReferenceLine
} from "recharts";
import { 
    Sparkles, 
    Play, 
    Save, 
    Trash2, 
    FolderOpen, 
    Search, 
    TrendingUp, 
    AlertTriangle, 
    Layers, 
    Calendar, 
    Clock, 
    Activity, 
    Loader2,
    BarChart3,
    Database,
    RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { searchSymbols, type SymbolResult } from "@/lib/api";

interface HistoricalSimilarityTabProps {
    dbInventory: any[];
}

interface SavedCase {
    id: string;
    name: string;
    symbol: string;
    k: number;
    forward_days: number;
    target_return: number;
    stop_loss: number;
    features: string[];
    search_scope: string;
    created_at?: string;
}

interface ScanResult {
    rank?: number;
    symbol: string;
    target_date: string;
    win_rate: number;
    average_return: number;
    total_matches: number;
    wins: number;
    losses: number;
    profit_factor: number;
    best_match?: {
        similarity: number;
        return: number;
    };
}

export default function HistoricalSimilarityTab({ dbInventory }: HistoricalSimilarityTabProps) {
    // ─── Tab Selection ───────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<"live" | "historical">("live");

    // ─── LIVE SCAN Configuration ─────────────────────────────────────────────
    const [kMatches, setKMatches] = useState(10);
    const [forwardDays, setForwardDays] = useState(10);
    const [targetReturn, setTargetReturn] = useState(5.0);
    const [stopLoss, setStopLoss] = useState(-3.0);
    
    const [selectedFeatures, setSelectedFeatures] = useState<string[]>([
        "RSI", "BB_pB", "Close_to_SMA50", "Close_to_SMA200", "MACD_Norm", "R_VOL", "Return_5d", "ChartShape"
    ]);

    const featureOptions = [
        { id: "RSI", label: "RSI Indicator", desc: "Compares relative momentum strength" },
        { id: "BB_pB", label: "Bollinger %B", desc: "Position within volatility bands" },
        { id: "Close_to_SMA50", label: "SMA 50 Distance", desc: "Distance from medium trend line" },
        { id: "Close_to_SMA200", label: "SMA 200 Distance", desc: "Distance from long trend line" },
        { id: "MACD_Norm", label: "Normalized MACD", desc: "MACD strength relative to price" },
        { id: "R_VOL", label: "Relative Volume", desc: "Volume relative to 20-day average" },
        { id: "Return_3d", label: "3-Day Return", desc: "Short-term momentum return" },
        { id: "Return_5d", label: "5-Day Return", desc: "Medium-term momentum return" },
        { id: "Return_10d", label: "10-Day Return", desc: "10-day price trend momentum" },
        { id: "Return_20d", label: "20-Day Return", desc: "Monthly momentum return" },
        { id: "ChartShape", label: "Chart Shape (5d)", desc: "5-day candle close returns layout" },
    ];

    // ─── LIVE SCAN State ─────────────────────────────────────────────────────
    const [scanLoading, setScanLoading] = useState(false);
    const [scanProgress, setScanProgress] = useState<any>(null);
    
    // ─── HISTORICAL SCANS State ──────────────────────────────────────────────
    const [historicalScans, setHistoricalScans] = useState<ScanResult[]>([]);
    const [historicalLoading, setHistoricalLoading] = useState(false);
    const [sortBy, setSortBy] = useState<"win_rate" | "returns" | "matches">("win_rate");
    const [minWinRate, setMinWinRate] = useState<number | undefined>();
    const [selectedForComparison, setSelectedForComparison] = useState<string | null>(null);
    const [comparisonData, setComparisonData] = useState<any>(null);

    // ─── Load historical scans on mount or when tab changes ──────────────────
    useEffect(() => {
        if (activeTab === "historical") {
            fetchHistoricalScans();
        }
    }, [activeTab]);

    const fetchHistoricalScans = async () => {
        setHistoricalLoading(true);
        try {
            const params = new URLSearchParams({
                sort_by: sortBy,
                ...(minWinRate !== undefined && { min_win_rate: String(minWinRate / 100) })
            });
            
            const res = await fetch(`/api/admin/similarity/historical-results?${params}`, {
                headers: { "X-Admin-Key": process.env.NEXT_PUBLIC_ADMIN_KEY || "" }
            });
            
            if (res.ok) {
                const data = await res.json();
                setHistoricalScans(data.results || []);
            } else {
                toast.error("Failed to load historical scans");
            }
        } catch (err) {
            console.error("Error fetching historical scans:", err);
            toast.error("خطأ في تحميل البيانات التاريخية");
        } finally {
            setHistoricalLoading(false);
        }
    };

    const handleRunFullMarketScan = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (selectedFeatures.length === 0) {
            toast.error("Please select at least one feature");
            return;
        }

        setScanLoading(true);
        setScanProgress({ status: "جاري بدء المسح...", percentage: 0 });

        try {
            const params = new URLSearchParams({
                k: String(kMatches),
                forward_days: String(forwardDays),
                target_return: String(targetReturn / 100.0),
                stop_loss: String(stopLoss / 100.0)
            });

            const res = await fetch(`/api/admin/similarity/run-full-market-scan?${params}`, {
                method: "POST",
                headers: { 
                    "X-Admin-Key": process.env.NEXT_PUBLIC_ADMIN_KEY || ""
                }
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Scan failed");
            }

            const data = await res.json();
            setScanProgress({ status: "تم بنجاح", percentage: 100 });
            toast.success(`✅ تم مسح السوق بنجاح - وجدنا ${data.results_count} نتيجة`);
            
            // Refresh historical scans after successful scan
            setTimeout(() => {
                fetchHistoricalScans();
                setActiveTab("historical");
            }, 2000);

        } catch (err: any) {
            setScanProgress({ status: "خطأ", error: err.message });
            toast.error(err.message || "خطأ في المسح");
        } finally {
            setScanLoading(false);
        }
    };

    const handleCompareScans = async (symbol1: string, symbol2: string) => {
        try {
            const res = await fetch(
                `/api/admin/similarity/compare-scans?symbol1=${symbol1}&symbol2=${symbol2}`,
                { headers: { "X-Admin-Key": process.env.NEXT_PUBLIC_ADMIN_KEY || "" } }
            );
            
            if (res.ok) {
                const data = await res.json();
                setComparisonData(data.comparison);
                setSelectedForComparison(`${symbol1}-vs-${symbol2}`);
            }
        } catch (err) {
            toast.error("Failed to load comparison");
        }
    };

    const handleFeatureToggle = (fid: string) => {
        setSelectedFeatures(prev => 
            prev.includes(fid) ? prev.filter(f => f !== fid) : [...prev, fid]
        );
    };

    return (
        <div className="p-4 md:p-8 max-w-[1920px] mx-auto space-y-8 text-zinc-100 font-sans">
            
            {/* ─── TAB NAVIGATION ──────────────────────────────────────────────── */}
            <div className="flex gap-2 border-b-4 border-black dark:border-white bg-white dark:bg-black p-1">
                <button
                    onClick={() => setActiveTab("live")}
                    className={`
                        px-6 py-3 text-xs font-black uppercase tracking-widest border-4 border-black dark:border-white transition-all duration-100
                        ${activeTab === "live"
                            ? "neobrutal-bg-yellow text-black shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] translate-x-0 translate-y-0"
                            : "bg-white dark:bg-zinc-900 text-black dark:text-zinc-400 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:hover:shadow-[3px_3px_0px_rgba(255,255,255,1)]"
                        }
                    `}
                >
                    <Play className="inline w-4 h-4 mr-2" />
                    Live Market Scan
                </button>
                <button
                    onClick={() => setActiveTab("historical")}
                    className={`
                        px-6 py-3 text-xs font-black uppercase tracking-widest border-4 border-black dark:border-white transition-all duration-100
                        ${activeTab === "historical"
                            ? "neobrutal-bg-cyan text-black shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] translate-x-0 translate-y-0"
                            : "bg-white dark:bg-zinc-900 text-black dark:text-zinc-400 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:hover:shadow-[3px_3px_0px_rgba(255,255,255,1)]"
                        }
                    `}
                >
                    <Database className="inline w-4 h-4 mr-2" />
                    Historical Scans
                </button>
            </div>

            {/* ─── TAB 1: LIVE MARKET SCAN ────────────────────────────────────── */}
            {activeTab === "live" && (
                <div className="space-y-8">
                    <form onSubmit={handleRunFullMarketScan} className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] space-y-6">
                        <div className="flex items-center justify-between border-b-4 border-black dark:border-white pb-4">
                            <h2 className="text-sm font-black tracking-widest text-black dark:text-zinc-200 uppercase flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-amber-500" />
                                Full Market Scan Configuration
                            </h2>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] border-2 border-black dark:border-white bg-indigo-400 text-black px-2 py-1 font-black uppercase font-mono shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]">
                                    All EGX Symbols
                                </span>
                                <span className="text-[10px] border-2 border-black dark:border-white bg-amber-400 text-black px-2 py-1 font-black uppercase font-mono shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]">
                                    ~84 Stocks
                                </span>
                            </div>
                        </div>
                        
                        <div className="bg-amber-200 dark:bg-amber-900/20 border-l-8 border-amber-500 p-4 shadow-[3px_3px_0px_rgba(0,0,0,0.3)]">
                            <p className="text-xs text-black dark:text-zinc-300 leading-relaxed font-bold">
                                <strong className="text-amber-700 dark:text-amber-400">📊 Full Market Scan:</strong> This will automatically scan all EGX symbols using algorithmic pattern matching. 
                                No need to specify a target symbol - the system will analyze the entire market and return ranked results.
                            </p>
                        </div>

                        {/* Numeric Ranges */}
                        <div className="space-y-4">
                            {/* K Matches & Forward evaluation */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                                        <span>K Matches</span>
                                        <span className="font-mono text-amber-400">{kMatches}</span>
                                    </div>
                                    <input 
                                        type="range" min="3" max="25"
                                        value={kMatches}
                                        onChange={(e) => setKMatches(Number(e.target.value))}
                                        className="w-full accent-amber-400"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                                        <span>Evaluation Days</span>
                                        <span className="font-mono text-amber-400">{forwardDays}d</span>
                                    </div>
                                    <input 
                                        type="range" min="5" max="30"
                                        value={forwardDays}
                                        onChange={(e) => setForwardDays(Number(e.target.value))}
                                        className="w-full accent-amber-400"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                                        <span>Target Profit</span>
                                        <span className="font-mono text-emerald-500">+{targetReturn}%</span>
                                    </div>
                                    <input 
                                        type="range" min="1" max="20" step="0.5"
                                        value={targetReturn}
                                        onChange={(e) => setTargetReturn(Number(e.target.value))}
                                        className="w-full accent-emerald-500"
                                    />
                                </div>

                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                                        <span>Stop Loss</span>
                                        <span className="font-mono text-red-500">{stopLoss}%</span>
                                    </div>
                                    <input 
                                        type="range" min="-15" max="-1" step="0.5"
                                        value={stopLoss}
                                        onChange={(e) => setStopLoss(Number(e.target.value))}
                                        className="w-full accent-red-500"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Features checklist */}
                        <div className="space-y-3 border-t-4 border-black dark:border-white pt-6">
                            <label className="text-xs font-black uppercase tracking-widest text-black dark:text-zinc-400">
                                📊 Included Pattern Features
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                {featureOptions.map((opt) => {
                                    const checked = selectedFeatures.includes(opt.id);
                                    return (
                                        <div 
                                            key={opt.id}
                                            onClick={() => handleFeatureToggle(opt.id)}
                                            className={`p-3 border-3 border-black dark:border-white text-xs transition-all cursor-pointer flex items-start gap-2 font-bold shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:hover:shadow-[4px_4px_0px_rgba(255,255,255,1)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${checked ? "neobrutal-bg-green text-black" : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"}`}
                                        >
                                            <div className={`w-5 h-5 border-2 border-black dark:border-white flex items-center justify-center flex-shrink-0 ${checked ? "bg-black" : "bg-white dark:bg-zinc-800"}`}>
                                                {checked && <div className="w-2.5 h-2.5 bg-green-400" />}
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-black leading-tight uppercase text-[10px]">{opt.label}</p>
                                                <p className="text-[9px] text-current opacity-70 font-mono mt-0.5 leading-none">{opt.desc}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Progress display during scan */}
                        {scanLoading && scanProgress && (
                            <div className="border-4 border-black dark:border-white neobrutal-bg-yellow p-6 space-y-3 animate-pulse shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-black text-black uppercase tracking-wider">🔍 Scanning All Symbols...</p>
                                    <span className="text-sm text-black font-mono font-black bg-black text-yellow-400 px-3 py-1 border-2 border-black">{scanProgress.percentage}%</span>
                                </div>
                                <div className="w-full h-4 bg-black border-2 border-black overflow-hidden">
                                    <div 
                                        className="h-full bg-green-400 transition-all duration-300 border-r-2 border-black"
                                        style={{ width: `${scanProgress.percentage}%` }}
                                    />
                                </div>
                                <p className="text-[11px] text-black font-mono font-bold">{scanProgress.message || scanProgress.status}</p>
                            </div>
                        )}

                        {/* Action button */}
                        <div className="border-t-4 border-black dark:border-white pt-6">
                            <button
                                type="submit"
                                disabled={scanLoading}
                                className="h-16 w-full border-4 border-black dark:border-white neobrutal-bg-yellow hover:neobrutal-bg-green text-black font-black uppercase tracking-wider shadow-[5px_5px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_rgba(255,255,255,1)] hover:translate-x-[-2px] hover:translate-y-[-2px] hover:shadow-[7px_7px_0px_rgba(0,0,0,1)] dark:hover:shadow-[7px_7px_0px_rgba(255,255,255,1)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:active:shadow-[2px_2px_0px_rgba(255,255,255,1)] transition-all duration-100 cursor-pointer flex items-center justify-center gap-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {scanLoading ? (
                                    <>
                                        <Loader2 className="w-6 h-6 animate-spin" />
                                        Scanning Market (2-5 minutes)...
                                    </>
                                ) : (
                                    <>
                                        <Play className="w-6 h-6 fill-current" />
                                        Run Full Market Scan
                                    </>
                                )}
                            </button>
                            <p className="text-[10px] text-zinc-600 dark:text-zinc-500 mt-3 text-center font-mono font-bold">
                                Scans all EGX symbols with algorithmic pattern matching. Takes 2-5 minutes.
                            </p>
                        </div>
                    </form>
                </div>
            )}

            {/* ─── TAB 2: HISTORICAL SCANS ────────────────────────────────────── */}
            {activeTab === "historical" && (
                <div className="space-y-8">
                    {/* Controls */}
                    <div className="border-4 border-black dark:border-white bg-white dark:bg-zinc-950 p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)]">
                        <div className="flex items-center justify-between border-b-4 border-black dark:border-white pb-4 mb-6">
                            <h2 className="text-sm font-black tracking-widest text-black dark:text-zinc-200 uppercase flex items-center gap-2">
                                <Database className="w-5 h-5 text-cyan-500" />
                                Filter & Sort Results
                            </h2>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Sort By</label>
                                <select 
                                    value={sortBy}
                                    onChange={(e) => {
                                        setSortBy(e.target.value as any);
                                        setHistoricalScans([]);
                                    }}
                                    className="w-full h-10 border-2 border-zinc-800 bg-zinc-900/60 px-3 text-xs font-bold text-white outline-none focus:border-amber-400 transition-all"
                                >
                                    <option value="win_rate">Win Rate (Highest)</option>
                                    <option value="returns">Average Return (Highest)</option>
                                    <option value="matches">Match Count (Most)</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Min Win Rate (%)</label>
                                <input 
                                    type="number"
                                    value={minWinRate ?? ""}
                                    onChange={(e) => setMinWinRate(e.target.value ? Number(e.target.value) : undefined)}
                                    placeholder="Leave empty for all"
                                    className="w-full h-10 border-2 border-zinc-800 bg-zinc-900/60 px-3 text-xs font-bold text-white outline-none focus:border-amber-400 transition-all"
                                />
                            </div>
                        </div>

                        <button
                            onClick={fetchHistoricalScans}
                            disabled={historicalLoading}
                            className="w-full h-12 border-4 border-black dark:border-white neobrutal-bg-cyan text-black font-black uppercase text-xs tracking-wider transition-all duration-100 flex items-center justify-center gap-2 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0px_rgba(0,0,0,1)] dark:hover:shadow-[5px_5px_0px_rgba(255,255,255,1)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {historicalLoading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Loading...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="w-4 h-4" />
                                    Apply Filters
                                </>
                            )}
                        </button>
                    </div>

                    {/* Results Table */}
                    {historicalLoading ? (
                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-16 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] flex flex-col items-center justify-center gap-4">
                            <Loader2 className="w-12 h-12 animate-spin text-amber-400" />
                            <p className="text-sm font-bold text-zinc-400">Loading scan results...</p>
                        </div>
                    ) : historicalScans.length === 0 ? (
                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-16 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] text-center">
                            <p className="text-sm text-zinc-500 font-semibold">No scan results found. Run a full market scan first.</p>
                        </div>
                    ) : (
                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] overflow-x-auto">
                            <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-4">
                                <BarChart3 className="w-4 h-4 text-amber-400" />
                                Scan Results ({historicalScans.length})
                            </h3>

                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="border-b border-zinc-800 text-[10px] font-black uppercase text-zinc-500 tracking-wider">
                                        <th className="py-3 px-2">Rank</th>
                                        <th className="py-3 px-2">Symbol</th>
                                        <th className="py-3 px-2">Win Rate</th>
                                        <th className="py-3 px-2">Avg Return</th>
                                        <th className="py-3 px-2">Matches</th>
                                        <th className="py-3 px-2">Profit Factor</th>
                                        <th className="py-3 px-2">Best Match</th>
                                        <th className="py-3 px-2 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-900 font-mono text-[10px]">
                                    {historicalScans.map((scan, idx) => {
                                        const bestMatchReturn = scan.best_match?.return ?? 0;
                                        const bestMatchSim = scan.best_match?.similarity ?? 0;
                                        
                                        return (
                                            <tr key={`${scan.symbol}-${idx}`} className="hover:bg-zinc-900/40 transition-colors">
                                                <td className="py-3 px-2 font-bold text-amber-400"># {scan.rank}</td>
                                                <td className="py-3 px-2 font-bold text-white">{scan.symbol}</td>
                                                <td className={`py-3 px-2 font-black ${scan.win_rate >= 60 ? "text-emerald-500" : scan.win_rate >= 45 ? "text-amber-400" : "text-red-500"}`}>
                                                    {scan.win_rate.toFixed(1)}%
                                                </td>
                                                <td className={`py-3 px-2 font-black ${scan.average_return >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                                    {(scan.average_return * 100).toFixed(2)}%
                                                </td>
                                                <td className="py-3 px-2 text-zinc-300">
                                                    {scan.wins}W / {scan.losses}L
                                                </td>
                                                <td className={`py-3 px-2 font-bold ${scan.profit_factor >= 1.5 ? "text-emerald-500" : "text-amber-400"}`}>
                                                    {scan.profit_factor.toFixed(2)}
                                                </td>
                                                <td className="py-3 px-2">
                                                    <span className="text-[9px] bg-zinc-800 px-1.5 py-0.5 rounded">{(bestMatchSim * 100).toFixed(1)}% / {(bestMatchReturn * 100).toFixed(1)}%</span>
                                                </td>
                                                <td className="py-3 px-2 text-center">
                                                    <button
                                                        onClick={() => handleCompareScans(scan.symbol, historicalScans[idx === 0 ? 1 : 0]?.symbol || "")}
                                                        disabled={!historicalScans[idx === 0 ? 1 : 0]}
                                                        className="px-2 py-1 border border-zinc-700 hover:border-amber-400 text-zinc-400 hover:text-amber-400 text-[9px] font-bold disabled:opacity-50"
                                                    >
                                                        Compare
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Comparison Panel */}
                    {comparisonData && (
                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)]">
                            <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-4">
                                <TrendingUp className="w-4 h-4 text-amber-400" />
                                Side-by-Side Comparison
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {comparisonData.symbol1 && (
                                    <div className="border-2 border-amber-400/30 p-4 space-y-3">
                                        <h4 className="text-sm font-bold text-amber-400">{comparisonData.symbol1.symbol}</h4>
                                        <div className="space-y-1 text-xs">
                                            <p><span className="text-zinc-500">Win Rate:</span> <span className="font-mono font-bold text-white">{(comparisonData.symbol1.stats?.win_rate * 100).toFixed(1)}%</span></p>
                                            <p><span className="text-zinc-500">Avg Return:</span> <span className="font-mono font-bold text-emerald-500">{(comparisonData.symbol1.stats?.average_return * 100).toFixed(2)}%</span></p>
                                            <p><span className="text-zinc-500">Matches:</span> <span className="font-mono font-bold">{comparisonData.symbol1.matches_count}</span></p>
                                            <p><span className="text-zinc-500">Profit Factor:</span> <span className="font-mono font-bold">{comparisonData.symbol1.stats?.profit_factor.toFixed(2)}</span></p>
                                        </div>
                                    </div>
                                )}

                                {comparisonData.symbol2 && (
                                    <div className="border-2 border-blue-400/30 p-4 space-y-3">
                                        <h4 className="text-sm font-bold text-blue-400">{comparisonData.symbol2.symbol}</h4>
                                        <div className="space-y-1 text-xs">
                                            <p><span className="text-zinc-500">Win Rate:</span> <span className="font-mono font-bold text-white">{(comparisonData.symbol2.stats?.win_rate * 100).toFixed(1)}%</span></p>
                                            <p><span className="text-zinc-500">Avg Return:</span> <span className="font-mono font-bold text-emerald-500">{(comparisonData.symbol2.stats?.average_return * 100).toFixed(2)}%</span></p>
                                            <p><span className="text-zinc-500">Matches:</span> <span className="font-mono font-bold">{comparisonData.symbol2.matches_count}</span></p>
                                            <p><span className="text-zinc-500">Profit Factor:</span> <span className="font-mono font-bold">{comparisonData.symbol2.stats?.profit_factor.toFixed(2)}</span></p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {comparisonData.difference && (
                                <div className="mt-4 p-3 bg-zinc-900/50 border-l-4 border-amber-400">
                                    <p className="text-xs text-zinc-300"><span className="font-bold">Better Performer:</span> <span className="font-mono text-amber-400">{comparisonData.difference.better_symbol}</span></p>
                                    <p className="text-xs text-zinc-300 mt-1"><span className="font-bold">Win Rate Edge:</span> <span className={`font-mono ${comparisonData.difference.win_rate_diff >= 0 ? "text-emerald-500" : "text-red-500"}`}>{comparisonData.difference.win_rate_diff.toFixed(1)}%</span></p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
