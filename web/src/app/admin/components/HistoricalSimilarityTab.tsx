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
    Loader2 
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

export default function HistoricalSimilarityTab({ dbInventory }: HistoricalSimilarityTabProps) {
    // ─── Form & Config State ──────────────────────────────────────────────────
    const [symbolQuery, setSymbolQuery] = useState("COMI.EGX");
    const [searchResults, setSearchResults] = useState<SymbolResult[]>([]);
    const [showResults, setShowResults] = useState(false);
    
    const [targetDate, setTargetDate] = useState("");
    const [kMatches, setKMatches] = useState(10);
    const [forwardDays, setForwardDays] = useState(10);
    const [targetReturn, setTargetReturn] = useState(5.0); // stored as %, e.g., 5.0%
    const [stopLoss, setStopLoss] = useState(-3.0); // stored as %, e.g., -3.0%
    const [searchScope, setSearchScope] = useState<"same_symbol" | "all_symbols">("same_symbol");
    const [profileName, setProfileName] = useState("");
    
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

    // ─── Data & Loading States ────────────────────────────────────────────────
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedCases, setSavedCases] = useState<SavedCase[]>([]);
    const [results, setResults] = useState<any | null>(null);

    // Load saved cases on mount
    useEffect(() => {
        fetchSavedCases();
    }, []);

    // Autocomplete symbol search
    useEffect(() => {
        if (!symbolQuery.trim()) {
            setSearchResults([]);
            return;
        }
        const delay = setTimeout(() => {
            searchSymbols(symbolQuery, undefined, 5, undefined, "local")
                .then(setSearchResults)
                .catch(console.error);
        }, 300);
        return () => clearTimeout(delay);
    }, [symbolQuery]);

    const fetchSavedCases = async () => {
        try {
            const res = await fetch("/api/admin/historical-similarity/cases");
            if (res.ok) {
                const data = await res.json();
                setSavedCases(Array.isArray(data) ? data : data.cases || []);
            }
        } catch (err) {
            console.error("Failed to load saved cases:", err);
        }
    };

    const handleFeatureToggle = (fid: string) => {
        setSelectedFeatures(prev => 
            prev.includes(fid) ? prev.filter(f => f !== fid) : [...prev, fid]
        );
    };

    const handleRunScan = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!symbolQuery) {
            toast.error("Please enter a target symbol");
            return;
        }
        if (selectedFeatures.length === 0) {
            toast.error("Please select at least one feature for similarity matching");
            return;
        }

        setLoading(true);
        setResults(null);

        try {
            const res = await fetch("/api/admin/historical-similarity/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    symbol: symbolQuery,
                    target_date: targetDate || null,
                    k: kMatches,
                    forward_days: forwardDays,
                    target_return: targetReturn / 100.0, // convert back to decimal
                    stop_loss: stopLoss / 100.0, // convert back to decimal
                    features: selectedFeatures,
                    exclusion_window: 20,
                    search_scope: searchScope
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => null);
                throw new Error(err?.detail || "Calculation error");
            }

            const data = await res.json();
            setResults(data);
            toast.success("Similarity scan completed successfully!");
        } catch (err: any) {
            toast.error(err.message || "Failed to run scan");
        } finally {
            setLoading(false);
        }
    };

    const handleSaveCase = async () => {
        if (!profileName.trim()) {
            toast.error("Please specify a profile name to save");
            return;
        }

        setSaving(true);
        try {
            const res = await fetch("/api/admin/historical-similarity/cases", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: profileName,
                    symbol: symbolQuery,
                    k: kMatches,
                    forward_days: forwardDays,
                    target_return: targetReturn / 100.0,
                    stop_loss: stopLoss / 100.0,
                    features: selectedFeatures,
                    search_scope: searchScope
                })
            });

            if (res.ok) {
                toast.success(`Profile "${profileName}" saved!`);
                setProfileName("");
                fetchSavedCases();
            } else {
                throw new Error("Failed to save profile");
            }
        } catch (err: any) {
            toast.error(err.message || "Failed to save profile");
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteCase = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to delete this scan profile?")) return;

        try {
            const res = await fetch(`/api/admin/historical-similarity/cases/${id}`, {
                method: "DELETE"
            });
            if (res.ok) {
                toast.success("Profile deleted");
                fetchSavedCases();
            }
        } catch (err) {
            toast.error("Failed to delete profile");
        }
    };

    const loadSavedProfile = (profile: SavedCase) => {
        setSymbolQuery(profile.symbol);
        setKMatches(profile.k);
        setForwardDays(profile.forward_days);
        setTargetReturn(profile.target_return * 100.0);
        setStopLoss(profile.stop_loss * 100.0);
        setSelectedFeatures(profile.features);
        setSearchScope(profile.search_scope as any);
        toast.info(`Loaded profile: ${profile.name}`);
    };

    // ─── Chart Data Transformer ──────────────────────────────────────────────
    const transformChartData = () => {
        if (!results || !results.matches) return [];

        // We want data from Day -9 to Day +N
        // Initialize days
        const daysMap: { [key: number]: any } = {};
        for (let d = -9; d <= forwardDays; d++) {
            daysMap[d] = { day: d, dayLabel: d <= 0 ? `T${d}` : `T+${d}` };
        }

        // 1. Add Target Path (only goes up to Day 0)
        if (results.target_path) {
            results.target_path.forEach((p: any, idx: number) => {
                const day = idx - 9; // 10 elements -> index 0 is Day -9, index 9 is Day 0
                if (daysMap[day]) {
                    daysMap[day]["Target"] = p.rel_change * 100.0; // convert to %
                }
            });
        }

        // 2. Add Match Paths
        const activeMatches = results.matches.slice(0, 5); // Plot top 5 matches
        activeMatches.forEach((m: any, matchIdx: number) => {
            const label = `Match_${matchIdx + 1}_${m.date}`;
            
            // Before match (Day -9 to 0)
            if (m.before_path) {
                m.before_path.forEach((p: any, idx: number) => {
                    const day = idx - 9;
                    if (daysMap[day]) {
                        daysMap[day][label] = p.rel_change * 100.0;
                    }
                });
            }
            
            // After match (Day 1 to N)
            if (m.forward_path) {
                m.forward_path.forEach((p: any) => {
                    const day = p.day;
                    if (daysMap[day]) {
                        daysMap[day][label] = p.return * 100.0;
                    }
                });
            }
        });

        // 3. Compute Average Match Path
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

        return Object.values(daysMap).sort((a, b) => a.day - b.day);
    };

    const chartData = transformChartData();

    return (
        <div className="p-4 md:p-8 max-w-[1920px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 text-zinc-100 font-sans">
            
            {/* ─── LEFT COLUMN: CONFIG & SAVED CASES (5 cols) ────────────────────── */}
            <div className="lg:col-span-5 space-y-8">
                
                {/* SAVED PROFILES PANEL */}
                <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                    <h2 className="text-sm font-black tracking-widest text-zinc-400 uppercase flex items-center gap-2 mb-4">
                        <FolderOpen className="w-4 h-4 text-amber-400" />
                        Saved Similarity Profiles
                    </h2>

                    {savedCases.length === 0 ? (
                        <p className="text-xs text-zinc-500 font-semibold italic">
                            No profiles saved yet. Build a scan below and save it as a profile.
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                            {savedCases.map((c) => (
                                <div 
                                    key={c.id} 
                                    onClick={() => loadSavedProfile(c)}
                                    className="flex items-center justify-between p-3 border-2 border-zinc-800 hover:border-amber-400 bg-zinc-900/60 hover:bg-zinc-900 transition-all cursor-pointer group"
                                >
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold text-zinc-200 group-hover:text-white transition-colors">{c.name}</p>
                                        <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                                            <span className="font-bold text-amber-400">{c.symbol}</span>
                                            <span>• K:{c.k}</span>
                                            <span>• Days:{c.forward_days}</span>
                                            <span>• Target:+{c.target_return * 100}%</span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={(e) => handleDeleteCase(c.id, e)}
                                        className="p-1 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 rounded transition-all"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* SCAN CONFIGURATION FORM */}
                <form onSubmit={handleRunScan} className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none space-y-6">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                        <h2 className="text-sm font-black tracking-widest text-zinc-200 uppercase flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-amber-400" />
                            Pattern Scan Config
                        </h2>
                        <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 font-bold uppercase font-mono">
                            Pure Algorithmic
                        </span>
                    </div>

                    {/* Target Symbol Search */}
                    <div className="space-y-2 relative">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                            Target Symbol
                        </label>
                        <div className="relative">
                            <input 
                                type="text"
                                value={symbolQuery}
                                onChange={(e) => { setSymbolQuery(e.target.value); setShowResults(true); }}
                                onFocus={() => setShowResults(true)}
                                placeholder="e.g. COMI.EGX"
                                className="h-12 w-full border-2 border-zinc-800 bg-zinc-900/60 px-4 pl-10 text-xs font-black text-white outline-none focus:border-amber-400 transition-all font-mono"
                            />
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-zinc-500" />
                        </div>

                        {showResults && searchResults.length > 0 && (
                            <div className="absolute z-20 left-0 right-0 top-full mt-1 border-2 border-zinc-800 bg-zinc-950 shadow-2xl">
                                {searchResults.map((s) => (
                                    <div 
                                        key={s.symbol}
                                        onClick={() => {
                                            setSymbolQuery(s.exchange ? `${s.symbol}.${s.exchange}` : s.symbol);
                                            setShowResults(false);
                                        }}
                                        className="p-3 text-xs border-b border-zinc-900 hover:bg-zinc-900 cursor-pointer flex justify-between items-center"
                                    >
                                        <span className="font-bold text-white font-mono">{s.symbol}</span>
                                        <span className="text-[10px] text-zinc-400 truncate max-w-[200px]">{s.name}</span>
                                        <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 text-zinc-400 font-bold uppercase">{s.exchange}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Params Row */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5" /> Target Date
                            </label>
                            <input 
                                type="date"
                                value={targetDate}
                                onChange={(e) => setTargetDate(e.target.value)}
                                className="h-12 w-full border-2 border-zinc-800 bg-zinc-900/60 px-4 text-xs font-bold text-white outline-none focus:border-amber-400 transition-all font-mono"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" /> Exclusion Window
                            </label>
                            <div className="h-12 border-2 border-zinc-800 bg-zinc-900/30 flex items-center px-4 text-xs font-bold text-zinc-500 font-mono">
                                ± 20 Days Gap
                            </div>
                        </div>
                    </div>

                    {/* Numeric Ranges */}
                    <div className="space-y-4 border-t border-zinc-900 pt-4">
                        {/* K Matches & Forward evaluation */}
                        <div className="grid grid-cols-2 gap-4">
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
                        </div>

                        {/* Target Return & Stop Loss */}
                        <div className="grid grid-cols-2 gap-4">
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

                    {/* Search Scope */}
                    <div className="space-y-2 border-t border-zinc-900 pt-4">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-1.5 mb-2">
                            <Layers className="w-3.5 h-3.5" /> Search Scope
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setSearchScope("same_symbol")}
                                className={`h-10 text-[10px] font-black tracking-wider uppercase border-2 transition-all ${searchScope === "same_symbol" ? "border-amber-400 bg-amber-400/10 text-amber-400" : "border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:text-zinc-300"}`}
                            >
                                Single Stock History
                            </button>
                            <button
                                type="button"
                                onClick={() => setSearchScope("all_symbols")}
                                className={`h-10 text-[10px] font-black tracking-wider uppercase border-2 transition-all ${searchScope === "all_symbols" ? "border-amber-400 bg-amber-400/10 text-amber-400" : "border-zinc-800 bg-zinc-900/40 text-zinc-500 hover:text-zinc-300"}`}
                            >
                                Exchange Wide (EGX)
                            </button>
                        </div>
                    </div>

                    {/* Features checklist */}
                    <div className="space-y-3 border-t border-zinc-900 pt-4">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                            Included Pattern Features
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1">
                            {featureOptions.map((opt) => {
                                const checked = selectedFeatures.includes(opt.id);
                                return (
                                    <div 
                                        key={opt.id}
                                        onClick={() => handleFeatureToggle(opt.id)}
                                        className={`p-2 border-2 text-[10px] transition-all cursor-pointer flex items-center gap-2 ${checked ? "border-amber-400/80 bg-zinc-900/80 text-white" : "border-zinc-900 bg-zinc-950 text-zinc-500 hover:text-zinc-400"}`}
                                    >
                                        <div className={`w-3 h-3 border border-current flex items-center justify-center ${checked ? "bg-amber-400 border-amber-400 text-black" : ""}`}>
                                            {checked && <div className="w-1.5 h-1.5 bg-black" />}
                                        </div>
                                        <div>
                                            <p className="font-bold leading-tight">{opt.label}</p>
                                            <p className="text-[8px] text-zinc-500 font-mono mt-0.5 leading-none">{opt.desc}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Action buttons */}
                    <div className="border-t border-zinc-900 pt-6 space-y-4">
                        <button
                            type="submit"
                            disabled={loading}
                            className="h-12 w-full border-4 border-black dark:border-white bg-amber-300 dark:bg-amber-400 hover:bg-amber-300 hover:translate-y-[-1px] active:translate-y-[2px] text-black font-black uppercase tracking-wider shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:shadow-none transition-all duration-100 cursor-pointer flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Calculating Similarity...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4 fill-current" />
                                    Run Historical Scan
                                </>
                            )}
                        </button>

                        <div className="grid grid-cols-12 gap-2">
                            <input 
                                type="text"
                                value={profileName}
                                onChange={(e) => setProfileName(e.target.value)}
                                placeholder="Scan Profile Name..."
                                className="h-10 col-span-8 border-2 border-zinc-800 bg-zinc-900/40 px-3 text-xs font-bold text-white outline-none focus:border-amber-400 transition-all"
                            />
                            <button
                                type="button"
                                onClick={handleSaveCase}
                                disabled={saving || !profileName.trim()}
                                className="h-10 col-span-4 border-2 border-black dark:border-white bg-zinc-900 hover:bg-zinc-800 text-white font-black uppercase text-[10px] tracking-wider transition-all flex items-center justify-center gap-1 shadow-[2px_2px_0px_0px_rgba(255,255,255,0.1)] active:shadow-none disabled:opacity-50"
                            >
                                <Save className="w-3.5 h-3.5" /> Save
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            {/* ─── RIGHT COLUMN: RESULTS & CHARTS (7 cols) ───────────────────────── */}
            <div className="lg:col-span-7 space-y-8">
                {loading && (
                    <div className="border-4 border-black dark:border-white bg-zinc-950 p-16 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] flex flex-col items-center justify-center gap-6 min-h-[500px]">
                        <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        <div className="text-center space-y-2">
                            <h3 className="text-lg font-black text-white">Similarity Engine Processing</h3>
                            <p className="text-xs text-zinc-500 font-semibold max-w-sm">
                                Standardizing vectors, running Cosine Similarity calculations across stock history database, and analyzing exit results.
                            </p>
                        </div>
                    </div>
                )}

                {!loading && !results && (
                    <div className="border-4 border-black dark:border-white bg-zinc-950 p-16 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] flex flex-col items-center justify-center gap-6 text-center min-h-[500px] relative overflow-hidden">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-indigo-500/5 rounded-full blur-[100px]" />
                        <Activity className="w-12 h-12 text-zinc-600" />
                        <div className="space-y-2 relative">
                            <h3 className="text-base font-black text-zinc-300 uppercase tracking-widest">No Scan Executed Yet</h3>
                            <p className="text-xs text-zinc-500 font-semibold max-w-md">
                                Enter a symbol (e.g. <span className="font-mono text-amber-400">COMI.EGX</span>), configure your parameters, and press the run button to perform a similarity search and calculate statistical outcomes.
                            </p>
                        </div>
                    </div>
                )}

                {results && (
                    <div className="space-y-8 animate-in fade-in duration-300">
                        {/* STATS OVERVIEW CARDS */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            
                            {/* Win Rate Card */}
                            <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
                                <p className="text-[9px] font-black tracking-widest text-zinc-500 uppercase">Win Rate</p>
                                <p className={`text-3xl font-black font-mono mt-2 ${results.stats.win_rate >= 0.6 ? "text-emerald-500" : results.stats.win_rate >= 0.45 ? "text-amber-400" : "text-red-500"}`}>
                                    {(results.stats.win_rate * 100).toFixed(1)}%
                                </p>
                                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                    {results.stats.wins} Wins / {results.stats.losses} Losses
                                </p>
                            </div>

                            {/* Average Return Card */}
                            <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
                                <p className="text-[9px] font-black tracking-widest text-zinc-500 uppercase">Avg Return</p>
                                <p className={`text-3xl font-black font-mono mt-2 ${results.stats.average_return >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                    {(results.stats.average_return * 100).toFixed(2)}%
                                </p>
                                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                    Across all {results.stats.total_matches} matches
                                </p>
                            </div>

                            {/* Profit Factor Card */}
                            <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
                                <p className="text-[9px] font-black tracking-widest text-zinc-500 uppercase">Profit Factor</p>
                                <p className={`text-3xl font-black font-mono mt-2 ${results.stats.profit_factor >= 1.5 ? "text-emerald-500" : results.stats.profit_factor >= 1.0 ? "text-amber-400" : "text-red-500"}`}>
                                    {results.stats.profit_factor.toFixed(2)}
                                </p>
                                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                    Gross gains / Gross losses
                                </p>
                            </div>

                            {/* Expected Value Card */}
                            <div className="border-4 border-black dark:border-white bg-zinc-950 p-5 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)]">
                                <p className="text-[9px] font-black tracking-widest text-zinc-500 uppercase">Expected Edge</p>
                                <p className={`text-3xl font-black font-mono mt-2 ${results.stats.expected_value >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                    {(results.stats.expected_value * 100).toFixed(2)}%
                                </p>
                                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                    Expected yield per trade
                                </p>
                            </div>
                        </div>

                        {/* RECHARTS CHART: TRAJECTORIES COMPARISON */}
                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                            <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-6">
                                <TrendingUp className="w-4 h-4 text-amber-400" />
                                Trajectory Spaghetti Plot (Relative Returns %)
                            </h3>

                            <div className="h-[380px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                        <XAxis 
                                            dataKey="dayLabel" 
                                            stroke="#9ca3af" 
                                            style={{ fontSize: 10, fontFamily: "monospace" }} 
                                        />
                                        <YAxis 
                                            stroke="#9ca3af" 
                                            style={{ fontSize: 10, fontFamily: "monospace" }}
                                            tickFormatter={(v) => `${v.toFixed(1)}%`}
                                        />
                                        <ChartTooltip
                                            contentStyle={{ backgroundColor: "#09090b", borderColor: "#27272a" }}
                                            labelStyle={{ color: "#fff", fontWeight: "bold", fontFamily: "monospace", fontSize: 11 }}
                                            itemStyle={{ fontSize: 10, fontFamily: "monospace" }}
                                            formatter={(value: any) => [`${parseFloat(value).toFixed(2)}%`]}
                                        />
                                        
                                        {/* Target Date Reference Line at Day 0 */}
                                        <ReferenceLine x="T0" stroke="#ffdc58" strokeWidth={2} strokeDasharray="4 4" />
                                        
                                        {/* Target Return Reference Line */}
                                        <ReferenceLine y={targetReturn} stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" />
                                        
                                        {/* Stop Loss Reference Line */}
                                        <ReferenceLine y={stopLoss} stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" />

                                        {/* Plots for matches */}
                                        {results.matches.slice(0, 5).map((m: any, idx: number) => {
                                            const key = `Match_${idx + 1}_${m.date}`;
                                            return (
                                                <Line 
                                                    key={key}
                                                    type="monotone" 
                                                    dataKey={key} 
                                                    stroke="#6366f1" 
                                                    strokeWidth={1}
                                                    dot={false}
                                                    opacity={0.3}
                                                    name={`Match ${idx + 1} (${m.date})`}
                                                />
                                            );
                                        })}

                                        {/* Target Price trajectory */}
                                        <Line 
                                            type="monotone" 
                                            dataKey="Target" 
                                            stroke="#ffffff" 
                                            strokeWidth={3}
                                            dot={false}
                                            name="Target Stock"
                                        />

                                        {/* Average trajectory */}
                                        <Line 
                                            type="monotone" 
                                            dataKey="Average" 
                                            stroke="#ffdc58" 
                                            strokeWidth={3}
                                            dot={false}
                                            name="Average Path"
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            
                            <div className="flex flex-wrap items-center justify-center gap-6 mt-4 text-[10px] font-mono text-zinc-500">
                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-white" /> Target Stock Path (Before T0)</span>
                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-400" /> Avg Matches Path</span>
                                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-indigo-500 opacity-60" /> Individual Historical Occurrences</span>
                            </div>
                        </div>

                        {/* MATCHES DETAIL TABLE */}
                        <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.15)] rounded-none">
                            <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-4">
                                <Clock className="w-4 h-4 text-amber-400" />
                                Top Matching Historical Cases
                            </h3>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
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
                                    <tbody className="divide-y divide-zinc-900 font-mono">
                                        {results.matches.map((m: any, idx: number) => (
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

                    </div>
                )}
            </div>

        </div>
    );
}
