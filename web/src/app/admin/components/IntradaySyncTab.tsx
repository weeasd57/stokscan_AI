"use client";

import React, { useState, useEffect, useMemo } from "react";
import { 
    Loader2, Play, Pause, RotateCcw, AlertTriangle, CheckCircle, 
    Database, Clock, RefreshCw, Search, ChevronLeft, ChevronRight,
    ArrowUpDown, ShieldAlert, BadgeAlert, Sparkles, Download, Trash2, Zap, Info
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";

interface CompletedDetailsRow {
    symbol: string;
    bars_count: number;
    last_ts: string;
    first_ts: string;
}

interface SyncState {
    status: "syncing" | "idle" | "error";
    last_run: string | null;
    completed_symbols: string[];
    failed_symbols: string[];
    missing_symbols: string[];
    batch_size: number;
    timeframe: string;
    total_symbols: number;
    symbols_list: string[];
    completed_details?: CompletedDetailsRow[];
    failed_reasons?: Record<string, string>;
    last_batch_logs?: string[];
    message?: string;
}

export default function IntradaySyncTab() {
    const { t, language } = useLanguage();
    const [state, setState] = useState<SyncState | null>(null);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [batchSizeInput, setBatchSizeInput] = useState(5);
    const [timeframeInput, setTimeframeInput] = useState("15m");
    const [symbolNames, setSymbolNames] = useState<Record<string, string>>({});
    const [syncDays, setSyncDays] = useState<number>(180);
    const [bulkSyncProgress, setBulkSyncProgress] = useState<{ current: number; total: number; lastMsg: string } | null>(null);
    const [bulkSyncLogs, setBulkSyncLogs] = useState<string[]>([]);
    
    // UI Filters and Pagination
    const [tableSearch, setTableSearch] = useState("");
    const [missingSearch, setMissingSearch] = useState("");
    const [failedSearch, setFailedSearch] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sortKey, setSortKey] = useState<"symbol" | "bars_count" | "last_ts">("symbol");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
    
    // Sync status tracking
    const [syncingSymbols, setSyncingSymbols] = useState<Set<string>>(new Set());
    const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSyncingBatch, setIsSyncingBatch] = useState(false);

    const handleDeleteSelected = async () => {
        if (selectedSymbols.size === 0) return;
        if (!confirm(language === "ar" 
            ? `هل أنت متأكد من مسح بيانات الـ 15 دقيقة لـ ${selectedSymbols.size} سهم؟` 
            : `Delete intraday data for ${selectedSymbols.size} symbol(s)?\nThis cannot be undone.`)) return;
        setIsDeleting(true);
        try {
            const res = await fetch(`/api/admin/delete-prices`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    exchange: "EGX",
                    symbols: Array.from(selectedSymbols),
                    mode: "intraday"
                })
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            toast.success(language === "ar" 
                ? `تم حذف البيانات لـ ${selectedSymbols.size} سهم بنجاح` 
                : `Deleted ${selectedSymbols.size} symbol(s) — ${data.deleted_rows ?? 0} rows removed`);
            
            setSelectedSymbols(new Set());
            await fetchState();
        } catch (e: any) {
            toast.error("Delete failed: " + (e.message || "Unknown error"));
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSyncSelected = async () => {
        if (selectedSymbols.size === 0) return;
        setIsSyncingBatch(true);
        setBulkSyncLogs([]);
        
        const queue = Array.from(selectedSymbols);
        const total = queue.length;
        setBulkSyncProgress({ current: 0, total, lastMsg: language === "ar" ? "بدء المزامنة الفورية..." : "Starting bulk sync..." });

        toast.info(language === "ar" 
            ? `بدء مزامنة ${total} سهم بدفعة من 5 أسهم...` 
            : `Starting sync for ${total} symbol(s) in batches of 5...`);
        
        const BATCH_SIZE = 5;
        let processedCount = 0;
        let localLogs: string[] = [];

        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = queue.slice(i, i + BATCH_SIZE);
            const batchProgressMsg = language === "ar" 
                ? `جاري تحديث الدفعة ${Math.floor(i / BATCH_SIZE) + 1}...` 
                : `Syncing batch ${Math.floor(i / BATCH_SIZE) + 1}...`;
                
            setBulkSyncProgress(prev => prev ? { ...prev, lastMsg: batchProgressMsg } : null);

            try {
                const res = await fetch("/api/admin/intraday-sync/update-batch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        symbols: batch,
                        timeframe: timeframeInput,
                        max_days: syncDays
                    })
                });
                
                if (!res.ok) throw new Error("Batch update failed");
                const data = await res.json();
                
                if (data.results) {
                    data.results.forEach((r: any) => {
                        const timestamp = new Date().toLocaleTimeString(language === "ar" ? "ar-EG" : "en-US", { hour12: true });
                        const statusStr = r.success ? "Success" : "Failed";
                        const logMsg = `[${timestamp}] ${r.symbol}: ${statusStr} - ${r.message}`;
                        localLogs = [logMsg, ...localLogs];
                    });
                    setBulkSyncLogs([...localLogs]);
                }
            } catch (err: any) {
                const timestamp = new Date().toLocaleTimeString(language === "ar" ? "ar-EG" : "en-US", { hour12: true });
                batch.forEach(sym => {
                    const logMsg = `[${timestamp}] ${sym}: ERR - ${err.message || "Unknown batch error"}`;
                    localLogs = [logMsg, ...localLogs];
                });
                setBulkSyncLogs([...localLogs]);
                console.error("Intraday batch update error:", err);
            }
            
            processedCount += batch.length;
            setBulkSyncProgress(prev => prev ? { ...prev, current: processedCount, lastMsg: localLogs[0] || "" } : null);
        }

        toast.success(language === "ar" ? "اكتملت مزامنة الأسهم المحددة بنجاح" : "Sync complete for selected symbols");
        setSelectedSymbols(new Set());
        await fetchState();
        setIsSyncingBatch(false);
    };

    const fetchState = async () => {
        try {
            const res = await fetch("/api/admin/intraday-sync/state");
            if (!res.ok) throw new Error("Failed to fetch state");
            const data = await res.json();
            setState(data);
            if (data) {
                setBatchSizeInput(data.batch_size || 5);
                setTimeframeInput(data.timeframe || "15m");
            }
        } catch (err) {
            console.error("Failed to load intraday sync state:", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchNames = async () => {
        try {
            const res = await fetch("/api/symbols/synced?country=Egypt");
            if (res.ok) {
                const data = await res.json();
                const map: Record<string, string> = {};
                if (data && Array.isArray(data.results)) {
                    data.results.forEach((item: any) => {
                        map[item.symbol] = item.name;
                    });
                }
                setSymbolNames(map);
            }
        } catch (err) {
            console.error("Failed to fetch symbol names:", err);
        }
    };

    useEffect(() => {
        fetchState();
        fetchNames();
        const timer = setInterval(() => {
            fetchState();
        }, 8000);
        return () => clearInterval(timer);
    }, []);

    const handleToggle = async () => {
        if (!state) return;
        setToggling(true);
        const nextEnabled = state.status !== "syncing";
        try {
            const res = await fetch("/api/admin/intraday-sync/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    enabled: nextEnabled,
                    batch_size: batchSizeInput,
                    timeframe: timeframeInput,
                }),
            });
            if (!res.ok) throw new Error("Failed to toggle sync");
            await fetchState();
            toast.success(
                nextEnabled 
                    ? (language === "ar" ? "بدأت المزامنة اللحظية في الخلفية بنجاح" : "Intraday sync successfully started in background")
                    : (language === "ar" ? "تم إيقاف المزامنة اللحظية مؤقتاً" : "Intraday sync paused successfully")
            );
        } catch (err) {
            toast.error("Error: " + err);
        } finally {
            setToggling(false);
        }
    };

    const handleReset = async () => {
        if (!confirm(language === "ar" 
            ? "هل أنت متأكد من تصفير تقدم المزامنة والبدء من جديد؟" 
            : "Are you sure you want to reset sync progress and start over?")) return;
        setResetting(true);
        try {
            const res = await fetch("/api/admin/intraday-sync/reset", { method: "POST" });
            if (!res.ok) throw new Error("Failed to reset sync");
            await fetchState();
            toast.success(language === "ar" ? "تمت إعادة تعيين تقدم المزامنة" : "Sync progress reset successfully");
        } catch (err) {
            toast.error("Error: " + err);
        } finally {
            setResetting(false);
        }
    };

    const handleSingleSync = async (symbol: string) => {
        setSyncingSymbols(prev => {
            const next = new Set(prev);
            next.add(symbol);
            return next;
        });
        try {
            const res = await fetch("/api/admin/intraday-sync/single-sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ symbol, timeframe: timeframeInput })
            });
            if (!res.ok) throw new Error("Sync failed");
            toast.success(language === "ar" ? `بدأت مزامنة ${symbol}` : `Started sync for ${symbol}`);
            
            // Wait and fetch state again
            setTimeout(async () => {
                await fetchState();
                setSyncingSymbols(prev => {
                    const next = new Set(prev);
                    next.delete(symbol);
                    return next;
                });
            }, 3000);
        } catch (err) {
            toast.error(language === "ar" ? `فشلت مزامنة ${symbol}` : `Sync failed for ${symbol}`);
            setSyncingSymbols(prev => {
                const next = new Set(prev);
                next.delete(symbol);
                return next;
            });
        }
    };

    // Derived statistics
    const completedCount = state?.completed_symbols?.length || 0;
    const failedCount = state?.failed_symbols?.length || 0;
    const missingCount = state?.missing_symbols?.length || 0;
    const totalCount = state?.total_symbols || 0;
    const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const formatDate = (isoStr: string | null) => {
        if (!isoStr) return "—";
        try {
            return new Date(isoStr).toLocaleTimeString();
        } catch {
            return isoStr;
        }
    };

    const formatTs = (tsStr: string | null) => {
        if (!tsStr) return "—";
        try {
            const d = new Date(tsStr);
            return d.toLocaleString(language === "ar" ? "ar-EG" : "en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit"
            });
        } catch {
            return tsStr;
        }
    };

    // Filtered lists
    const filteredMissing = useMemo(() => {
        return (state?.missing_symbols || []).filter(sym => 
            sym.toLowerCase().includes(missingSearch.toLowerCase()) ||
            (symbolNames[sym] || "").toLowerCase().includes(missingSearch.toLowerCase())
        );
    }, [state?.missing_symbols, missingSearch, symbolNames]);

    const filteredFailed = useMemo(() => {
        return (state?.failed_symbols || []).filter(sym => 
            sym.toLowerCase().includes(failedSearch.toLowerCase()) ||
            (symbolNames[sym] || "").toLowerCase().includes(failedSearch.toLowerCase())
        );
    }, [state?.failed_symbols, failedSearch, symbolNames]);

    // Table Filter, Sort & Paginate
    const filteredDetails = useMemo(() => {
        return (state?.completed_details || []).filter(item => {
            const symbol = item.symbol.toLowerCase();
            const name = (symbolNames[item.symbol] || "").toLowerCase();
            const query = tableSearch.toLowerCase();
            return symbol.includes(query) || name.includes(query);
        });
    }, [state?.completed_details, tableSearch, symbolNames]);

    const sortedDetails = useMemo(() => {
        return [...filteredDetails].sort((a, b) => {
            const dir = sortDir === "asc" ? 1 : -1;
            if (sortKey === "symbol") {
                return a.symbol.localeCompare(b.symbol) * dir;
            }
            if (sortKey === "bars_count") {
                return (a.bars_count - b.bars_count) * dir;
            }
            if (sortKey === "last_ts") {
                const timeA = a.last_ts ? new Date(a.last_ts).getTime() : 0;
                const timeB = b.last_ts ? new Date(b.last_ts).getTime() : 0;
                return (timeA - timeB) * dir;
            }
            return 0;
        });
    }, [filteredDetails, sortKey, sortDir]);

    const paginatedDetails = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return sortedDetails.slice(start, start + pageSize);
    }, [sortedDetails, currentPage, pageSize]);

    const totalPages = Math.ceil(sortedDetails.length / pageSize) || 1;

    const toggleSort = (key: "symbol" | "bars_count" | "last_ts") => {
        if (sortKey === key) {
            setSortDir(prev => prev === "asc" ? "desc" : "asc");
        } else {
            setSortKey(key);
            setSortDir("desc"); // Default to desc for count/timestamps
        }
        setCurrentPage(1);
    };

    if (loading && !state) {
        return (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-500" />
                <p className="text-xs font-black text-zinc-500 uppercase tracking-widest">
                    {language === "ar" ? "تحميل حالة المزامنة اللحظية..." : "Loading Intraday Sync State..."}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6" dir={language === "ar" ? "rtl" : "ltr"}>
            {/* Header section */}
            <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl">
                        <Database className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-white flex items-center gap-2">
                            {language === "ar" ? "مزامنة البيانات اللحظية (15m)" : "Intraday 15m Candles Sync"}
                            <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/30 text-indigo-400">
                                TV-INTEGRATED
                            </span>
                        </h2>
                        <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-1">
                            {language === "ar" ? "تنزيل وتخزين شموع الـ 15 دقيقة من TradingView لجميع الأسهم المصرية" : "Download and store 15-minute candles from TradingView for all EGX symbols"}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={handleToggle}
                        disabled={toggling}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border text-xs font-black uppercase tracking-wider transition-all ${
                            state?.status === "syncing"
                                ? "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20"
                                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20"
                        }`}
                    >
                        {toggling ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : state?.status === "syncing" ? (
                            <>
                                <Pause className="w-4 h-4" />
                                {language === "ar" ? "إيقاف مؤقت للمزامنة" : "Pause Syncing"}
                            </>
                        ) : (
                            <>
                                <Play className="w-4 h-4" />
                                {language === "ar" ? "بدء / استئناف المزامنة" : "Start / Resume Syncing"}
                            </>
                        )}
                    </button>

                    <button
                        onClick={handleReset}
                        disabled={resetting}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors text-xs font-black uppercase tracking-wider"
                    >
                        {resetting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <>
                                <RotateCcw className="w-4 h-4" />
                                {language === "ar" ? "إعادة تعيين التقدم" : "Reset Progress"}
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Dashboard stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Status Card */}
                <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-900 flex flex-col justify-between h-[120px] relative overflow-hidden group">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                        {language === "ar" ? "حالة المهمة" : "Task Status"}
                    </span>
                    <div className="flex items-center gap-2 mt-2">
                        {state?.status === "syncing" ? (
                            <>
                                <span className="flex h-2.5 w-2.5 relative">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </span>
                                <span className="text-emerald-400 text-lg font-black tracking-widest uppercase">
                                    {language === "ar" ? "تعمل حالياً" : "RUNNING"}
                                </span>
                            </>
                        ) : (
                            <>
                                <span className="inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                                <span className="text-amber-400 text-lg font-black tracking-widest uppercase">
                                    {language === "ar" ? "متوقفة" : "IDLE"}
                                </span>
                            </>
                        )}
                    </div>
                    <span className="text-[9px] text-zinc-500 mt-1 font-mono">
                        {language === "ar" ? "آخر تشغيل: " : "Last run: "} {formatDate(state?.last_run ?? null)}
                    </span>
                </div>

                {/* Completed Card */}
                <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-900 flex flex-col justify-between h-[120px]">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                        {language === "ar" ? "الأسهم المكتملة في الداتابيز" : "Completed in Database"}
                    </span>
                    <div className="text-2xl font-mono font-black text-emerald-400 mt-1">
                        {completedCount} <span className="text-xs text-zinc-600 font-sans">/ {totalCount}</span>
                    </div>
                    <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden mt-1">
                        <div 
                            className="bg-emerald-400 h-full transition-all duration-500" 
                            style={{ width: `${progressPct}%` }}
                        />
                    </div>
                </div>

                {/* Missing Card */}
                <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-900 flex flex-col justify-between h-[120px]">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                        {language === "ar" ? "أسهم مفقودة (بدون داتا)" : "Missing Symbols (No Data)"}
                    </span>
                    <div className="text-2xl font-mono font-black text-amber-500 mt-1">
                        {missingCount}
                    </div>
                    <span className="text-[9px] text-zinc-500">
                        {language === "ar" ? "سيتم سحبهم أولاً عند تشغيل المزامنة" : "Prioritized first when starting sync"}
                    </span>
                </div>

                {/* Failed Card */}
                <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-900 flex flex-col justify-between h-[120px]">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                        {language === "ar" ? "فشلت / غير متوفرة على TV" : "Failed / Not on TV"}
                    </span>
                    <div className="text-2xl font-mono font-black text-rose-400 mt-1">
                        {failedCount}
                    </div>
                    <span className="text-[9px] text-zinc-500">
                        {language === "ar" ? "رموز خاطئة أو غير مدعومة باللحظي" : "Unsupported or incorrect tickers"}
                    </span>
                </div>
            </div>

            {/* Sync Settings & Logs Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Settings Card */}
                <div className="lg:col-span-1 p-6 rounded-3xl bg-zinc-900 border border-zinc-800 flex flex-col justify-between">
                    <div>
                        <h3 className="text-xs font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-indigo-400" />
                            {language === "ar" ? "إعدادات المزامنة والتردد" : "Sync Config & Timeframe"}
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                                    {language === "ar" ? "حجم الدفعة (عدد الأسهم في الدورة)" : "Batch Size (per 5-min cycle)"}
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    disabled={state?.status === "syncing"}
                                    value={batchSizeInput}
                                    onChange={(e) => setBatchSizeInput(Number(e.target.value))}
                                    className="w-full h-10 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                                />
                            </div>

                            <div>
                                <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">
                                    {language === "ar" ? "الإطار الزمني للشموع" : "Timeframe / Interval"}
                                </label>
                                <select
                                    disabled={state?.status === "syncing"}
                                    value={timeframeInput}
                                    onChange={(e) => setTimeframeInput(e.target.value)}
                                    className="w-full h-10 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                                >
                                    <option value="15m">{language === "ar" ? "15 دقيقة (الموصى بها)" : "15 Minutes (Recommended)"}</option>
                                    <option value="30m">{language === "ar" ? "30 دقيقة" : "30 Minutes"}</option>
                                    <option value="5m">{language === "ar" ? "5 دقائق" : "5 Minutes"}</option>
                                    <option value="1h">{language === "ar" ? "ساعة واحدة" : "1 Hour"}</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Live Download Feed Card */}
                <div className="lg:col-span-2 p-6 rounded-3xl bg-zinc-900 border border-zinc-800 flex flex-col h-full min-h-[200px]">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                            <Clock className="w-4 h-4 text-emerald-400 animate-pulse" />
                            {isSyncingBatch 
                                ? (language === "ar" ? "جاري تشغيل المزامنة المحددة..." : "Running Selected Sync Batch...")
                                : (language === "ar" ? "حالة وسجلات المزامنة الفورية" : "Live Download Status & Activity Feed")
                            }
                        </h3>
                        {(state?.status === "syncing" || isSyncingBatch) && (
                            <span className="flex items-center gap-1.5 text-[9px] font-black text-emerald-400 px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 uppercase tracking-widest">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                                {language === "ar" ? "نشط" : "Active"}
                            </span>
                        )}
                    </div>

                    {/* Progress Bar for frontend bulk sync */}
                    {isSyncingBatch && bulkSyncProgress && (
                        <div className="mb-4 space-y-1.5">
                            <div className="flex justify-between text-[10px] font-bold text-zinc-400">
                                <span>{language === "ar" ? "التقدم" : "Progress"}</span>
                                <span>{Math.round((bulkSyncProgress.current / bulkSyncProgress.total) * 100)}% ({bulkSyncProgress.current}/{bulkSyncProgress.total})</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-zinc-950 overflow-hidden border border-zinc-900">
                                <div
                                    className="h-full bg-indigo-500 transition-all duration-300"
                                    style={{ width: `${(bulkSyncProgress.current / bulkSyncProgress.total) * 100}%` }}
                                />
                            </div>
                            {bulkSyncProgress.lastMsg && (
                                <div className="text-[9px] text-zinc-500 font-mono truncate text-left" dir="ltr">
                                    {bulkSyncProgress.lastMsg}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex-1 bg-zinc-950 border border-zinc-850/50 rounded-2xl p-4 font-mono text-[10px] overflow-y-auto max-h-[140px] custom-scrollbar text-left flex flex-col justify-start gap-1.5" dir="ltr">
                        {isSyncingBatch ? (
                            bulkSyncLogs.length > 0 ? (
                                bulkSyncLogs.map((log, index) => {
                                    const isSuccess = log.includes("Success");
                                    const isFailed = log.includes("Failed") || log.includes("Exception") || log.includes("ERR");
                                    return (
                                        <div 
                                            key={index} 
                                            className={`${
                                                isSuccess ? "text-emerald-400" : isFailed ? "text-rose-400" : "text-zinc-400"
                                            } border-b border-zinc-900/40 pb-0.5`}
                                        >
                                            {log}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="text-zinc-650 h-full flex items-center justify-center font-sans text-xs">
                                    {language === "ar" ? "تهيئة المزامنة..." : "Initializing sync..."}
                                </div>
                            )
                        ) : (
                            state?.last_batch_logs && state.last_batch_logs.length > 0 ? (
                                state.last_batch_logs.map((log, index) => {
                                    const isSuccess = log.includes("Success");
                                    const isFailed = log.includes("Failed") || log.includes("Exception");
                                    return (
                                        <div 
                                            key={index} 
                                            className={`${
                                                isSuccess ? "text-emerald-400" : isFailed ? "text-rose-400" : "text-zinc-400"
                                            } border-b border-zinc-900/40 pb-0.5`}
                                        >
                                            {log}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="text-zinc-650 h-full flex items-center justify-center font-sans text-xs">
                                    {language === "ar" 
                                        ? "لا توجد سجلات تحميل حديثة. ابدأ المزامنة للتشغيل." 
                                        : "No recent download logs. Click Start / Resume to begin."
                                    }
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* Missing & Failed Columns section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Missing Symbols list */}
                <div className="p-6 rounded-3xl bg-zinc-950 border border-zinc-900 flex flex-col h-[400px]">
                    <div className="flex flex-col gap-3 pb-4 border-b border-zinc-900">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500" />
                                {language === "ar" ? "الأسهم المفقودة (بدون أي بيانات)" : "Missing Stocks (No Data)"}
                                <span className="text-[10px] font-bold bg-zinc-900 px-2 py-0.5 rounded text-zinc-400">
                                    {filteredMissing.length}
                                </span>
                            </h3>
                        </div>
                        <div className="relative">
                            <input
                                type="text"
                                value={missingSearch}
                                onChange={(e) => setMissingSearch(e.target.value)}
                                placeholder={language === "ar" ? "ابحث عن سهم مفقود..." : "Search missing stock..."}
                                className="w-full h-9 pl-8 pr-4 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-white outline-none focus:border-amber-500/50"
                            />
                            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-3" />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto pt-4 space-y-2 pr-1 custom-scrollbar">
                        {filteredMissing.length > 0 ? (
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                {filteredMissing.map((sym) => (
                                    <div 
                                        key={sym}
                                        onClick={() => !syncingSymbols.has(sym) && handleSingleSync(sym)}
                                        className={`p-2 rounded-xl border text-xs font-mono text-center font-bold cursor-pointer transition-all ${
                                            syncingSymbols.has(sym)
                                                ? "bg-amber-500/10 border-amber-500/20 text-amber-400 animate-pulse"
                                                : "bg-amber-500/5 border-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/30"
                                        }`}
                                        title={symbolNames[sym] || sym}
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            {syncingSymbols.has(sym) && <Loader2 className="w-3 h-3 animate-spin" />}
                                            <span>{sym}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-zinc-600 text-xs font-bold uppercase tracking-wider">
                                {language === "ar" ? "لا توجد أسهم مفقودة مطابقة" : "No matching missing stocks."}
                            </div>
                        )}
                    </div>
                </div>

                {/* Failed Symbols list */}
                <div className="p-6 rounded-3xl bg-zinc-950 border border-zinc-900 flex flex-col h-[400px]">
                    <div className="flex flex-col gap-3 pb-4 border-b border-zinc-900">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                                <BadgeAlert className="w-4 h-4 text-rose-500" />
                                {language === "ar" ? "الأسهم الفاشلة / أخطاء TradingView" : "Failed Symbols & TradingView Errors"}
                                <span className="text-[10px] font-bold bg-zinc-900 px-2 py-0.5 rounded text-zinc-400">
                                    {filteredFailed.length}
                                </span>
                            </h3>
                        </div>
                        <div className="relative">
                            <input
                                type="text"
                                value={failedSearch}
                                onChange={(e) => setFailedSearch(e.target.value)}
                                placeholder={language === "ar" ? "ابحث عن رمز أو خطأ..." : "Search failed stock or error..."}
                                className="w-full h-9 pl-8 pr-4 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-white outline-none focus:border-rose-500/50"
                            />
                            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-3" />
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto pt-4 space-y-2.5 pr-1 custom-scrollbar">
                        {filteredFailed.length > 0 ? (
                            <div className="space-y-2">
                                {filteredFailed.map((sym) => {
                                    const errorMsg = state?.failed_reasons?.[sym];
                                    return (
                                        <div 
                                            key={sym}
                                            className="p-3 rounded-xl border bg-zinc-900/10 border-zinc-900 flex items-center justify-between gap-3 text-xs hover:border-zinc-800 transition-all group"
                                        >
                                            <div className="flex flex-col min-w-0 flex-1 text-left">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono font-black text-rose-400 tracking-wider bg-rose-500/5 px-1.5 py-0.5 rounded border border-rose-500/10">{sym}</span>
                                                    <span className="text-[10px] text-zinc-500 font-bold truncate">
                                                        {symbolNames[sym] || "—"}
                                                    </span>
                                                </div>
                                                <span 
                                                    className="text-[10px] text-zinc-400 mt-1.5 font-mono break-words bg-zinc-950/40 p-2 rounded-lg border border-zinc-900/60 leading-relaxed font-bold" 
                                                    dir="ltr"
                                                >
                                                    {errorMsg || (language === "ar" ? "فشل الاتصال بـ TradingView أو رمز غير مدعوم" : "Failed to connect to TradingView or unsupported ticker")}
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => !syncingSymbols.has(sym) && handleSingleSync(sym)}
                                                disabled={syncingSymbols.has(sym)}
                                                className="px-2.5 py-2 rounded-lg border border-zinc-800 bg-zinc-950 text-[10px] font-bold text-zinc-400 hover:text-white hover:border-zinc-700 transition-all flex items-center gap-1.5 shrink-0 hover:bg-zinc-900 self-start"
                                                title={language === "ar" ? "إعادة محاولة المزامنة" : "Retry Sync"}
                                            >
                                                {syncingSymbols.has(sym) ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                                                ) : (
                                                    <RefreshCw className="w-3.5 h-3.5 text-rose-400" />
                                                )}
                                                <span>{language === "ar" ? "تحديث" : "Retry"}</span>
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-zinc-600 text-xs font-bold uppercase tracking-wider">
                                {language === "ar" ? "لا توجد أسهم فاشلة مطابقة" : "No matching failed stocks."}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Completed stocks table - Data Center style */}
            <div className="p-6 rounded-3xl bg-zinc-950 border border-zinc-900 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-zinc-900">
                    <div>
                        <h3 className="text-base font-black text-white flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-emerald-400" />
                            {language === "ar" ? "جدول الأسهم المتوفرة (قاعدة البيانات)" : "Completed Stocks in Database"}
                        </h3>
                        <p className="text-xs text-zinc-500 font-medium mt-1">
                            {language === "ar" ? "يعرض جميع الأسهم التي تمت مزامنتها بنجاح مع الإحصائيات وعمليات التحديث الفردي" : "Displays all successfully synced stocks with record counts, dates, and refresh options"}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 max-w-xs w-full">
                        <div className="relative w-full">
                            <input
                                type="text"
                                value={tableSearch}
                                onChange={(e) => {
                                    setTableSearch(e.target.value);
                                    setCurrentPage(1);
                                }}
                                placeholder={language === "ar" ? "ابحث بالرمز أو الاسم..." : "Search by symbol or name..."}
                                className="w-full h-10 pl-9 pr-4 text-xs bg-zinc-900 border border-zinc-800 rounded-xl text-white outline-none focus:border-indigo-500/50"
                            />
                            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-3.5" />
                        </div>
                    </div>
                </div>

                {/* Table wrapper */}
                <div className="overflow-x-auto w-full rounded-2xl border border-zinc-900 bg-zinc-900/10">
                    <table className="w-full text-left border-collapse" dir={language === "ar" ? "rtl" : "ltr"}>
                        <thead>
                            <tr className="border-b border-zinc-900 bg-zinc-900/40 text-[10px] font-black uppercase tracking-wider text-zinc-400">
                                <th className="px-6 py-4 w-12 text-center">
                                    <input
                                        type="checkbox"
                                        checked={paginatedDetails.length > 0 && paginatedDetails.every(row => selectedSymbols.has(row.symbol))}
                                        onChange={(e) => {
                                            const next = new Set(selectedSymbols);
                                            if (e.target.checked) {
                                                paginatedDetails.forEach(row => next.add(row.symbol));
                                            } else {
                                                paginatedDetails.forEach(row => next.delete(row.symbol));
                                            }
                                            setSelectedSymbols(next);
                                        }}
                                        className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500"
                                    />
                                </th>
                                <th className="px-6 py-4 text-center w-24">
                                    {language === "ar" ? "الحالة" : "Status"}
                                </th>
                                <th className="px-6 py-4 text-center w-28">
                                    <button onClick={() => toggleSort("symbol")} className="flex items-center gap-1 hover:text-white mx-auto">
                                        {language === "ar" ? "الرمز" : "Symbol"}
                                        <ArrowUpDown className="w-3 h-3" />
                                    </button>
                                </th>
                                <th className="px-6 py-4 text-right min-w-[200px]">
                                    {language === "ar" ? "اسم الشركة" : "Company Name"}
                                </th>
                                <th className="px-6 py-4 text-center w-24">
                                    {language === "ar" ? "البورصة" : "Exchange"}
                                </th>
                                <th className="px-6 py-4 text-center w-24">
                                    {language === "ar" ? "الإطار" : "Interval"}
                                </th>
                                <th className="px-6 py-4 text-center w-32">
                                    <button onClick={() => toggleSort("bars_count")} className="flex items-center gap-1 hover:text-white mx-auto">
                                        {language === "ar" ? "عدد الشموع" : "Bars Count"}
                                        <ArrowUpDown className="w-3 h-3" />
                                    </button>
                                </th>
                                <th className="px-6 py-4 text-center w-40">
                                    {language === "ar" ? "أول شمعة" : "Earliest Bar"}
                                </th>
                                <th className="px-6 py-4 text-center w-40">
                                    <button onClick={() => toggleSort("last_ts")} className="flex items-center gap-1 hover:text-white mx-auto">
                                        {language === "ar" ? "آخر تحديث" : "Latest Bar"}
                                        <ArrowUpDown className="w-3 h-3" />
                                    </button>
                                </th>
                                <th className="px-6 py-4 text-center w-32">
                                    {language === "ar" ? "العمليات" : "Actions"}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-900 text-xs font-semibold text-zinc-300">
                            {paginatedDetails.length > 0 ? (
                                paginatedDetails.map((row) => (
                                    <tr key={row.symbol} className={`hover:bg-white/5 transition-colors ${selectedSymbols.has(row.symbol) ? 'bg-indigo-600/5' : ''}`}>
                                        <td className="px-6 py-4 text-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedSymbols.has(row.symbol)}
                                                onChange={(e) => {
                                                    const next = new Set(selectedSymbols);
                                                    if (e.target.checked) next.add(row.symbol);
                                                    else next.delete(row.symbol);
                                                    setSelectedSymbols(next);
                                                }}
                                                className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-indigo-600 focus:ring-indigo-500"
                                            />
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="px-2 py-0.5 rounded-full font-bold uppercase tracking-tight text-[8px] whitespace-nowrap bg-green-500/10 border border-green-500/20 text-green-400">
                                                {language === "ar" ? "مكتمل" : "Synced"}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center font-mono font-black text-indigo-400 hover:text-indigo-300">
                                            {row.symbol}
                                        </td>
                                        <td className="px-6 py-4 text-right truncate max-w-[280px]" title={symbolNames[row.symbol] || "—"}>
                                            <span className="text-zinc-100 font-bold">
                                                {symbolNames[row.symbol] || <span className="text-zinc-600 font-normal">Loading...</span>}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-500 font-bold uppercase tracking-tighter text-[9px]">
                                                EGX
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center font-mono text-zinc-400">
                                            {state?.timeframe || "15m"}
                                        </td>
                                        <td className="px-6 py-4 text-center font-mono font-bold text-indigo-400">
                                            {row.bars_count.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 text-center text-zinc-400 font-mono">
                                            {formatTs(row.first_ts)}
                                        </td>
                                        <td className="px-6 py-4 text-center text-zinc-500 font-mono">
                                            {formatTs(row.last_ts)}
                                        </td>
                                        <td className="px-6 py-4 text-center flex items-center justify-center gap-1.5">
                                            <button
                                                onClick={() => !syncingSymbols.has(row.symbol) && handleSingleSync(row.symbol)}
                                                disabled={syncingSymbols.has(row.symbol)}
                                                className={`p-1.5 rounded-lg border transition-all ${
                                                    syncingSymbols.has(row.symbol)
                                                        ? "bg-zinc-800 border-zinc-700 text-zinc-500 cursor-not-allowed"
                                                        : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 hover:bg-zinc-800"
                                                }`}
                                                title={language === "ar" ? "تحديث البيانات الآن" : "Sync Now"}
                                            >
                                                {syncingSymbols.has(row.symbol) ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <RefreshCw className="w-3.5 h-3.5" />
                                                )}
                                            </button>
                                            <button
                                                onClick={() => {
                                                    window.open(`/api/admin/export-intraday/EGX?symbol=${row.symbol}`, "_blank");
                                                }}
                                                className="p-1.5 rounded-lg border bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/30 transition-all"
                                                title={language === "ar" ? "تحميل ملف CSV" : "Download CSV"}
                                            >
                                                <Download className="w-3.5 h-3.5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={10} className="px-6 py-12 text-center text-zinc-500 font-bold uppercase tracking-wider">
                                        {language === "ar" ? "لا توجد أسهم مطابقة للمواصفات" : "No matching completed stocks found."}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Bottom Actions and Pagination Controls */}
                <div className="space-y-4 pt-4 border-t border-zinc-900">
                    {/* Pagination Controls */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                            {language === "ar" 
                                ? `عرض ${(currentPage - 1) * pageSize + 1} - ${Math.min(currentPage * pageSize, sortedDetails.length)} من أصل ${sortedDetails.length} أسهم`
                                : `Showing ${(currentPage - 1) * pageSize + 1} to ${Math.min(currentPage * pageSize, sortedDetails.length)} of ${sortedDetails.length} stocks`
                            }
                        </div>

                        <div className="flex items-center gap-2">
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                                className="h-8 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 px-2 focus:outline-none focus:border-zinc-700"
                            >
                                <option value={10}>10 {language === "ar" ? "صفوف" : "rows"}</option>
                                <option value={25}>25 {language === "ar" ? "صفوف" : "rows"}</option>
                                <option value={50}>50 {language === "ar" ? "صفوف" : "rows"}</option>
                            </select>

                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="p-1.5 rounded-lg border border-zinc-850 bg-zinc-900 text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <span className="text-xs font-mono text-zinc-400 px-2">
                                    {currentPage} / {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className="p-1.5 rounded-lg border border-zinc-850 bg-zinc-900 text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Bottom actions panel like Data Manager */}
                    <div className="p-4 bg-zinc-900/30 border border-zinc-900/50 flex flex-col sm:flex-row items-center gap-4 backdrop-blur-sm rounded-2xl">
                        <div className="mr-auto flex items-center gap-4">
                            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest flex items-center gap-2">
                                <Info className="w-3.5 h-3.5 text-zinc-400" />
                                {selectedSymbols.size} {language === "ar" ? "محدد" : "Selected"}
                            </p>
                        </div>

                        {selectedSymbols.size > 0 && (
                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full sm:w-auto justify-end">
                                {/* Sync Days Input */}
                                <div className="flex items-center gap-2 bg-zinc-950 px-3 py-1.5 rounded-xl border border-zinc-800 shrink-0">
                                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                                        {language === "ar" ? "الأيام المطلوبة" : "History Days"}
                                    </span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={syncDays}
                                        onChange={(e) => setSyncDays(Number(e.target.value))}
                                        className="w-14 h-6 bg-transparent text-center font-mono font-bold text-xs text-indigo-400 focus:outline-none"
                                        disabled={isSyncingBatch}
                                    />
                                </div>

                                <button
                                    onClick={handleDeleteSelected}
                                    disabled={isDeleting}
                                    className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-[10px] font-bold text-red-400 hover:bg-red-600 hover:text-white transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                    {language === "ar" ? "حذف المحدد" : "DELETE SELECTED"}
                                </button>
                                <button
                                    onClick={handleSyncSelected}
                                    disabled={isSyncingBatch}
                                    className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-bold hover:bg-indigo-500 transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isSyncingBatch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                                    {language === "ar" ? "مزامنة المحدد" : "SYNC SELECTED"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
