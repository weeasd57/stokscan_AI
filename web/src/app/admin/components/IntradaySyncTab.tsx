"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Play, Pause, RotateCcw, AlertTriangle, CheckCircle, Database, HelpCircle, Layers, Clock } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

interface SyncState {
    status: "syncing" | "idle" | "error";
    last_run: string | null;
    completed_symbols: string[];
    failed_symbols: string[];
    batch_size: number;
    timeframe: string;
    total_symbols: number;
    symbols_list: string[];
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

    useEffect(() => {
        fetchState();
        const timer = setInterval(() => {
            fetchState();
        }, 5000);
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
        } catch (err) {
            alert("Error: " + err);
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
        } catch (err) {
            alert("Error: " + err);
        } finally {
            setResetting(false);
        }
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

    const completedCount = state?.completed_symbols?.length || 0;
    const failedCount = state?.failed_symbols?.length || 0;
    const totalCount = state?.total_symbols || 0;
    const remainingCount = Math.max(0, totalCount - completedCount - failedCount);
    const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const formatDate = (isoStr: string | null) => {
        if (!isoStr) return "—";
        try {
            return new Date(isoStr).toLocaleTimeString();
        } catch {
            return isoStr;
        }
    };

    return (
        <div className="space-y-6" dir={language === "ar" ? "rtl" : "ltr"}>
            {/* Header section */}
            <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-2xl">
                        <Database className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-white">
                            {language === "ar" ? "مزامنة البيانات اللحظية (15m)" : "Intraday 15m Candles Sync"}
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
                <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-900 flex flex-col justify-between h-[120px] relative overflow-hidden">
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
                        {language === "ar" ? "آخر تشغيل: " : "Last batch: "} {formatDate(state?.last_run ?? null)}
                    </span>
                </div>

                {/* Completed Card */}
                <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-900 flex flex-col justify-between h-[120px]">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                        {language === "ar" ? "الأسهم المكتملة" : "Completed Symbols"}
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

                {/* Failed Card */}
                <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-900 flex flex-col justify-between h-[120px]">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                        {language === "ar" ? "الأسهم غير المتوفرة / الفاشلة" : "Failed / Not Found"}
                    </span>
                    <div className="text-2xl font-mono font-black text-rose-400 mt-1">
                        {failedCount}
                    </div>
                    <span className="text-[9px] text-zinc-500">
                        {language === "ar" ? "رموز غير موجودة على TradingView" : "Delisted or missing symbols"}
                    </span>
                </div>

                {/* Remaining Card */}
                <div className="p-5 rounded-2xl bg-zinc-950 border border-zinc-900 flex flex-col justify-between h-[120px]">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                        {language === "ar" ? "الأسهم المتبقية للمزامنة" : "Remaining Symbols"}
                    </span>
                    <div className="text-2xl font-mono font-black text-indigo-400 mt-1">
                        {remainingCount}
                    </div>
                    <span className="text-[9px] text-zinc-500">
                        {language === "ar" ? "يتم سحب 5 أسهم كل 5 دقائق" : "Syncing 5 symbols every 5 min"}
                    </span>
                </div>
            </div>

            {/* Sync Settings Grid */}
            <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800">
                <h3 className="text-sm font-black text-white uppercase tracking-wider mb-4">
                    {language === "ar" ? "إعدادات الدفعة والمخطط الزمني" : "Batch Settings & Configuration"}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                            {language === "ar" ? "حجم الدفعة (عدد الأسهم في الدورة)" : "Batch Size (Symbols per 5-min cycle)"}
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={50}
                            disabled={state?.status === "syncing"}
                            value={batchSizeInput}
                            onChange={(e) => setBatchSizeInput(Number(e.target.value))}
                            className="w-full h-11 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                        />
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                            {language === "ar" ? "الإطار الزمني للشموع" : "Timeframe / Interval"}
                        </label>
                        <select
                            disabled={state?.status === "syncing"}
                            value={timeframeInput}
                            onChange={(e) => setTimeframeInput(e.target.value)}
                            className="w-full h-11 px-4 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-50"
                        >
                            <option value="15m">{language === "ar" ? "15 دقيقة (الموصى بها)" : "15 Minutes (Recommended)"}</option>
                            <option value="30m">{language === "ar" ? "30 دقيقة" : "30 Minutes"}</option>
                            <option value="5m">{language === "ar" ? "5 دقائق" : "5 Minutes"}</option>
                            <option value="1h">{language === "ar" ? "ساعة واحدة" : "1 Hour"}</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Symbols lists split layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Synced Lists */}
                <div className="p-6 rounded-3xl bg-zinc-950 border border-zinc-900 flex flex-col h-[400px]">
                    <div className="flex items-center justify-between pb-4 border-b border-zinc-900">
                        <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                            {language === "ar" ? "الرموز التي تمت مزامنتها بنجاح" : "Successfully Synced"}
                            <span className="text-[10px] font-bold bg-zinc-900 px-2 py-0.5 rounded text-zinc-400">
                                {completedCount}
                            </span>
                        </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto pt-4 space-y-2 pr-1 custom-scrollbar">
                        {state?.completed_symbols && state.completed_symbols.length > 0 ? (
                            <div className="grid grid-cols-4 gap-2">
                                {state.completed_symbols.map((sym) => (
                                    <div 
                                        key={sym}
                                        className="p-2 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 text-xs font-mono text-center font-bold"
                                    >
                                        {sym}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-zinc-600 text-xs font-bold uppercase tracking-wider">
                                {language === "ar" ? "لا توجد رموز مكتملة حالياً" : "No synced symbols yet."}
                            </div>
                        )}
                    </div>
                </div>

                {/* Remaining / Queue Lists */}
                <div className="p-6 rounded-3xl bg-zinc-950 border border-zinc-900 flex flex-col h-[400px]">
                    <div className="flex items-center justify-between pb-4 border-b border-zinc-900">
                        <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                            <Clock className="w-4 h-4 text-indigo-400" />
                            {language === "ar" ? "قائمة الانتظار المتبقية" : "Sync Queue / Remaining"}
                            <span className="text-[10px] font-bold bg-zinc-900 px-2 py-0.5 rounded text-zinc-400">
                                {remainingCount}
                            </span>
                        </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto pt-4 space-y-2 pr-1 custom-scrollbar">
                        {state?.symbols_list && state.symbols_list.length > 0 ? (
                            <div className="grid grid-cols-4 gap-2">
                                {state.symbols_list
                                    .filter(sym => !state.completed_symbols.includes(sym) && !state.failed_symbols.includes(sym))
                                    .map((sym) => (
                                        <div 
                                            key={sym}
                                            className="p-2 rounded-xl bg-zinc-900/60 border border-white/5 text-zinc-400 text-xs font-mono text-center font-bold"
                                        >
                                            {sym}
                                        </div>
                                    ))
                                }
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-zinc-600 text-xs font-bold uppercase tracking-wider">
                                {language === "ar" ? "قائمة الانتظار فارغة" : "Queue is empty."}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
