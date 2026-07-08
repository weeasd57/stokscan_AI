"use client";

import { useState, useEffect } from "react";
import {
    History as HistoryIcon,
    RefreshCw,
    Play,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Calendar,
    FileText,
    ExternalLink,
    BarChart3,
    Send,
} from "lucide-react";
import { toast } from "sonner";

interface StepLog {
    step: string;
    status: "success" | "failed";
    details: string;
    count: number;
    timestamp: string;
}

interface SimilarityReport {
    id?: string;
    name?: string;
    scans?: Array<{
        symbol?: string;
        stats?: {
            win_rate?: number;
            average_return?: number;
            total_matches?: number;
        };
    }>;
    updated_at?: string | null;
}

interface JobRun {
    id: string;
    job_type: string;
    status: "running" | "completed" | "failed";
    started_at: string;
    completed_at: string | null;
    steps: StepLog[];
    total_symbols: number;
    error: string | null;
    trigger: "manual" | "scheduled" | "cron";
}

interface DailyScheduleState {
    enabled: boolean;
    run_time: string;
    active_days: number[];
    status: string;
    next_run_at: string | null;
    last_run_at: string | null;
    last_run_status: string | null;
    total_runs: number;
    total_failed: number;
    run_history: { run_at: string; status: string; job_id: string }[];
}

interface Recommendation {
    symbol: string;
    name: string;
    last_close: number;
    target_price: number;
    stop_loss: number;
    precision: number;
    exchange: string;
    created_at: string;
}

interface TelegramRecommendationsStatus {
    is_sent: boolean;
    date: string;
    sent_dates: string[];
    recommendations: Recommendation[];
    subscriber_count?: number;
}

const normalizeSteps = (steps: unknown): StepLog[] => {
    if (Array.isArray(steps)) return steps as StepLog[];
    if (typeof steps !== "string") return [];
    try {
        const parsed = JSON.parse(steps);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const DAY_LABELS = [
    { ar: "الأحد", en: "Sun" },
    { ar: "الإثنين", en: "Mon" },
    { ar: "الثلاثاء", en: "Tue" },
    { ar: "الأربعاء", en: "Wed" },
    { ar: "الخميس", en: "Thu" },
    { ar: "الجمعة", en: "Fri" },
    { ar: "السبت", en: "Sat" },
];

const STEP_LABELS: Record<string, { ar: string; en: string; icon: string }> = {
    sync_prices: { ar: "مزامنة الأسعار", en: "Price Sync", icon: "📊" },
    calculate_indicators: { ar: "حساب المؤشرات", en: "Indicators", icon: "📈" },
    update_positions: { ar: "تحديث المراكز", en: "Positions", icon: "💼" },
    evaluate_recommendations: { ar: "تقييم التوصيات", en: "Evaluate", icon: "🎯" },
    generate_recommendations: { ar: "توصيات جديدة", en: "New Recs", icon: "🟢" },
    historical_similarity: { ar: "نماذج متكررة", en: "Similarity", icon: "🔍" },
};

export default function DailyJobsTab() {
    const [jobRuns, setJobRuns] = useState<JobRun[]>([]);
    const [schedule, setSchedule] = useState<DailyScheduleState | null>(null);
    const [latestSimilarityReport, setLatestSimilarityReport] = useState<SimilarityReport | null>(null);
    const [loadingJobs, setLoadingJobs] = useState(false);
    const [loadingReports, setLoadingReports] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const [expandedRun, setExpandedRun] = useState<string | null>(null);
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [recsStatus, setRecsStatus] = useState<TelegramRecommendationsStatus | null>(null);
    const [loadingRecs, setLoadingRecs] = useState(false);
    const [sendingRecs, setSendingRecs] = useState(false);

    useEffect(() => {
        fetchJobHistory();
        fetchSchedule();
        fetchLatestSimilarityReport();
        fetchRecsStatus();
        const interval = setInterval(fetchJobHistory, 15000);
        const schedInterval = setInterval(fetchSchedule, 30000);
        const reportInterval = setInterval(fetchLatestSimilarityReport, 30000);
        const recsInterval = setInterval(() => fetchRecsStatus(true), 30000);
        return () => {
            clearInterval(interval);
            clearInterval(schedInterval);
            clearInterval(reportInterval);
            clearInterval(recsInterval);
        };
    }, []);

    const fetchJobHistory = async (silent = false) => {
        if (!silent) setLoadingJobs(true);
        try {
            const res = await fetch("/api/admin/daily-jobs/history?limit=15");
            if (res.ok) {
                const data = await res.json();
                const runs = Array.isArray(data.runs) ? data.runs : [];
                setJobRuns(runs.map((run: JobRun) => ({
                    ...run,
                    steps: normalizeSteps(run.steps),
                })));
            }
        } catch (e) {
            if (!silent) toast.error("Failed to load job history");
        } finally {
            if (!silent) setLoadingJobs(false);
        }
    };

    const fetchSchedule = async () => {
        try {
            const res = await fetch("/api/admin/daily-jobs/schedule");
            if (res.ok) {
                const data = await res.json();
                setSchedule(data);
            }
        } catch (e) {
            console.error("Failed to fetch schedule:", e);
        }
    };

    const fetchLatestSimilarityReport = async (silent = false) => {
        if (!silent) setLoadingReports(true);
        try {
            const res = await fetch("/api/admin/similarity/published");
            if (res.ok) {
                const data = await res.json();
                setLatestSimilarityReport(data || null);
            }
        } catch (e) {
            if (!silent) toast.error("Failed to load similarity report");
        } finally {
            if (!silent) setLoadingReports(false);
        }
    };

    const fetchRecsStatus = async (silent = false) => {
        if (!silent) setLoadingRecs(true);
        try {
            const res = await fetch("/api/admin/daily-jobs/recommendations-status");
            if (res.ok) {
                const data = await res.json();
                setRecsStatus(data);
            }
        } catch (e) {
            console.error("Failed to fetch recommendations status:", e);
        } finally {
            if (!silent) setLoadingRecs(false);
        }
    };

    const sendRecsTelegram = async () => {
        setSendingRecs(true);
        try {
            const res = await fetch("/api/admin/daily-jobs/send-telegram-recommendations", { method: "POST" });
            if (res.ok) {
                toast.success("✅ Recommendations sent to Telegram successfully!");
                fetchRecsStatus(true);
            } else {
                toast.error("Failed to send recommendations to Telegram");
            }
        } catch (e) {
            toast.error("Send failed");
        } finally {
            setSendingRecs(false);
        }
    };

    const triggerJob = async () => {
        setTriggering(true);
        try {
            const res = await fetch("/api/admin/daily-jobs/trigger", { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                toast.success("✅ Job triggered! Check history for progress.");
                setTimeout(() => fetchJobHistory(), 3000);
            } else {
                const err = await res.json().catch(() => ({}));
                toast.error(err.detail || "Failed to trigger job");
            }
        } catch (e) {
            toast.error("Trigger failed");
        } finally {
            setTriggering(false);
        }
    };

    const toggleScheduleDay = (dayIdx: number) => {
        if (!schedule) return;
        const active = schedule.active_days || [0, 1, 2, 3, 4];
        const updated = active.includes(dayIdx)
            ? active.filter((d: number) => d !== dayIdx)
            : [...active, dayIdx].sort();
        handleScheduleUpdate({ active_days: updated });
    };

    const handleScheduleUpdate = async (patch: Partial<DailyScheduleState>) => {
        setSavingSchedule(true);
        try {
            const res = await fetch("/api/admin/daily-jobs/schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (res.ok) {
                const data = await res.json();
                setSchedule(data);
                toast.success("Schedule updated");
            } else {
                toast.error("Failed to update schedule");
            }
        } catch (e) {
            toast.error("Update failed");
        } finally {
            setSavingSchedule(false);
        }
    };

    const formatTime = (iso: string | null | undefined) => {
        if (!iso) return "—";
        const d = new Date(iso);
        return d.toLocaleString("en-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    };

    const getStatusColor = (status: string) => {
        if (status === "completed") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
        if (status === "failed") return "text-rose-400 bg-rose-500/10 border-rose-500/20";
        return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    };

    const getStepByName = (run: JobRun, stepName: string) => normalizeSteps(run.steps).find((step) => step.step === stepName);
    const latestScans = latestSimilarityReport?.scans || [];
    const topSimilarityScans = [...latestScans]
        .sort((a, b) => (b.stats?.win_rate || 0) - (a.stats?.win_rate || 0))
        .slice(0, 5);

    return (
        <div className="p-4 md:p-8 max-w-[1920px] mx-auto space-y-8 text-zinc-100 font-sans">

            {/* ── Schedule Config Card ── */}
            <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                <div className="flex items-center justify-between border-b-4 border-black dark:border-white pb-4 mb-6">
                    <h2 className="text-sm font-black tracking-widest text-zinc-200 uppercase flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-amber-400" />
                        Daily Job Schedule (Stock Score + Similarity)
                    </h2>
                    <div className="flex items-center gap-3">
                        <span className={`px-3 py-1 text-[10px] font-black uppercase border-2 border-black dark:border-white font-mono ${
                            schedule?.enabled ? "neobrutal-bg-green text-black" : "bg-zinc-800 text-zinc-400"
                        } shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]`}>
                            {schedule?.status || "idle"}
                        </span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-black uppercase tracking-wider text-zinc-400">Master Enable</span>
                            <button
                                onClick={() => handleScheduleUpdate({ enabled: !schedule?.enabled })}
                                disabled={savingSchedule}
                                className={`relative h-8 w-14 rounded-full border-2 transition-all ${
                                    schedule?.enabled ? "bg-emerald-500/20 border-emerald-500" : "bg-zinc-800 border-zinc-600"
                                }`}
                            >
                                <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${
                                    schedule?.enabled ? "right-1" : "left-1"
                                }`} />
                            </button>
                        </div>

                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block mb-2">Run Time (Cairo)</label>
                            <input
                                type="time"
                                value={schedule?.run_time || "16:00"}
                                onChange={(e) => handleScheduleUpdate({ run_time: e.target.value })}
                                className="w-full h-10 border-2 border-zinc-800 bg-zinc-900/60 px-3 text-xs font-bold text-white outline-none focus:border-amber-400 font-mono"
                            />
                        </div>

                        <div>
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block mb-2">Active Days</label>
                            <div className="flex flex-wrap gap-2">
                                {DAY_LABELS.map((day, idx) => {
                                    const isActive = (schedule?.active_days || []).includes(idx);
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => toggleScheduleDay(idx)}
                                            className={`px-3 py-1.5 border-2 border-black dark:border-white text-[10px] font-black uppercase transition-all ${
                                                isActive ? "neobrutal-bg-cyan text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]" : "bg-zinc-900 text-zinc-500"
                                            }`}
                                        >
                                            {day.en}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3 border-l-2 border-zinc-800 pl-6">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-zinc-900 border border-white/5 rounded p-3">
                                <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Total Runs</p>
                                <p className="text-2xl font-black font-mono text-white">{schedule?.total_runs || 0}</p>
                            </div>
                            <div className="bg-zinc-900 border border-white/5 rounded p-3">
                                <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Failed</p>
                                <p className="text-2xl font-black font-mono text-rose-400">{schedule?.total_failed || 0}</p>
                            </div>
                            <div className="bg-zinc-900 border border-white/5 rounded p-3">
                                <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Last Run</p>
                                <p className="text-xs font-black font-mono text-zinc-300">{formatTime(schedule?.last_run_at)}</p>
                            </div>
                            <div className="bg-zinc-900 border border-white/5 rounded p-3">
                                <p className="text-[9px] text-zinc-500 uppercase tracking-wider">Next Run</p>
                                <p className="text-xs font-black font-mono text-amber-400">{formatTime(schedule?.next_run_at)}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-6 pt-4 border-t-2 border-zinc-800 flex gap-3">
                    <button
                        onClick={triggerJob}
                        disabled={triggering}
                        className="h-12 px-6 border-4 border-black dark:border-white neobrutal-bg-yellow text-black font-black uppercase text-xs tracking-wider flex items-center gap-2 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0px_rgba(0,0,0,1)] dark:hover:shadow-[5px_5px_0px_rgba(255,255,255,1)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none transition-all duration-100 disabled:opacity-50"
                    >
                        {triggering ? (
                            <><RefreshCw className="w-4 h-4 animate-spin" /> Running...</>
                        ) : (
                            <><Play className="w-4 h-4 fill-current" /> Run Now</>
                        )}
                    </button>
                    <button
                        onClick={() => {
                            fetchJobHistory();
                            fetchLatestSimilarityReport();
                        }}
                        disabled={loadingJobs || loadingReports}
                        className="h-12 px-6 border-4 border-black dark:border-white bg-zinc-900 text-zinc-300 font-black uppercase text-xs tracking-wider flex items-center gap-2 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0px_rgba(0,0,0,1)] dark:hover:shadow-[5px_5px_0px_rgba(255,255,255,1)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none transition-all duration-100"
                    >
                        <RefreshCw className={`w-4 h-4 ${loadingJobs || loadingReports ? "animate-spin" : ""}`} /> Refresh
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2 border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                    <div className="flex items-center justify-between gap-3 mb-6">
                        <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2">
                            <FileText className="w-4 h-4 text-cyan-400" />
                            Latest Similarity Report
                        </h3>
                        <span className="text-[10px] text-zinc-500 font-mono">
                            {latestSimilarityReport?.updated_at ? formatTime(latestSimilarityReport.updated_at) : "No report"}
                        </span>
                    </div>

                    {loadingReports && !latestSimilarityReport ? (
                        <div className="flex items-center justify-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin text-zinc-600" />
                        </div>
                    ) : latestSimilarityReport && latestScans.length > 0 ? (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono text-zinc-400">
                                <span className="px-2 py-1 bg-zinc-900 border border-zinc-800">{latestSimilarityReport.name || "Similarity Report"}</span>
                                <span className="px-2 py-1 bg-zinc-900 border border-zinc-800">Scans: {latestScans.length}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {topSimilarityScans.map((scan, idx) => (
                                    <div key={`${scan.symbol || "scan"}-${idx}`} className="border-2 border-zinc-800 p-4 bg-zinc-900/40">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-lg font-black text-white">{scan.symbol || "—"}</p>
                                                <p className="text-[10px] text-zinc-500 font-mono">Top similarity candidate</p>
                                            </div>
                                            <BarChart3 className="w-5 h-5 text-cyan-400" />
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                                            <div className="bg-black/30 border border-zinc-800 p-2">
                                                <p className="text-[9px] text-zinc-500 uppercase">Win Rate</p>
                                                <p className="text-sm font-black text-emerald-400">{((scan.stats?.win_rate || 0) * 100).toFixed(1)}%</p>
                                            </div>
                                            <div className="bg-black/30 border border-zinc-800 p-2">
                                                <p className="text-[9px] text-zinc-500 uppercase">Avg Return</p>
                                                <p className="text-sm font-black text-cyan-400">{((scan.stats?.average_return || 0) * 100).toFixed(1)}%</p>
                                            </div>
                                            <div className="bg-black/30 border border-zinc-800 p-2">
                                                <p className="text-[9px] text-zinc-500 uppercase">Matches</p>
                                                <p className="text-sm font-black text-white">{scan.stats?.total_matches || 0}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-zinc-500 font-mono text-sm">
                            No similarity report published yet.
                        </div>
                    )}
                </div>

                <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                    <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-6">
                        <Calendar className="w-4 h-4 text-amber-400" />
                        Scheduler Run Log
                    </h3>
                    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                        {(schedule?.run_history || []).length > 0 ? (
                            (schedule?.run_history || []).map((run, idx) => (
                                <div key={`${run.run_at}-${idx}`} className="border-2 border-zinc-800 p-3 bg-zinc-900/30">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className={`px-2 py-0.5 text-[9px] font-black uppercase border rounded ${getStatusColor(run.status)}`}>
                                            {run.status}
                                        </span>
                                        <span className="text-[9px] font-mono text-zinc-500">{run.job_id}</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-400 font-mono mt-2">{formatTime(run.run_at)}</p>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-10 text-zinc-500 font-mono text-sm">
                                No scheduler records yet.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Today's Telegram Recommendations Dispatch Card ── */}
            <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                <div className="flex items-center justify-between border-b-4 border-black dark:border-white pb-4 mb-6">
                    <h2 className="text-sm font-black tracking-widest text-zinc-200 uppercase flex items-center gap-2">
                        <Send className="w-5 h-5 text-sky-400" />
                        Today's Telegram Recommendations Dispatch
                    </h2>
                    <div className="flex items-center gap-3">
                        {recsStatus?.subscriber_count !== undefined && (
                            <span className="px-3 py-1 text-[10px] font-black uppercase border-2 border-black dark:border-white font-mono bg-zinc-800 text-zinc-300 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]">
                                Users: {recsStatus.subscriber_count} 👥
                            </span>
                        )}
                        {recsStatus?.is_sent ? (
                            <span className="px-3 py-1 text-[10px] font-black uppercase border-2 border-black dark:border-white font-mono bg-emerald-500 text-black shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]">
                                Sent to Telegram ✅
                            </span>
                        ) : (
                            <span className="px-3 py-1 text-[10px] font-black uppercase border-2 border-black dark:border-white font-mono bg-rose-500 text-white shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)]">
                                Not Sent ❌
                            </span>
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    {loadingRecs ? (
                        <div className="text-center py-6 text-zinc-500 font-mono text-xs flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
                            Loading recommendations status...
                        </div>
                    ) : !recsStatus?.recommendations || recsStatus.recommendations.length === 0 ? (
                        <div className="text-center py-6 text-zinc-500 font-mono text-xs">
                            No recommendations generated today yet (run the daily job to generate them).
                        </div>
                    ) : (
                        <>
                            <div className="border-2 border-zinc-800 p-4 bg-black/10">
                                <h3 className="text-xs font-bold text-zinc-400 mb-3 uppercase tracking-wider">
                                    Recommendations Generated Today ({recsStatus.recommendations.length})
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {recsStatus.recommendations.map((r, i) => (
                                        <div key={i} className="border border-zinc-800 p-3 bg-zinc-900/30 flex flex-col justify-between">
                                            <div>
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="font-mono font-bold text-zinc-200 text-sm">
                                                        {r.symbol}.{r.exchange}
                                                    </span>
                                                    <span className="text-[9px] bg-zinc-800 px-1.5 py-0.5 text-zinc-400 font-mono">
                                                        Score: {Math.round(r.precision * 10)}/10
                                                    </span>
                                                </div>
                                                <p className="text-xs text-zinc-500 truncate mb-2">{r.name}</p>
                                            </div>
                                            <div className="grid grid-cols-3 gap-1 text-[10px] font-mono border-t border-zinc-800/60 pt-2 text-zinc-400">
                                                <div>
                                                    <span className="block text-[8px] text-zinc-600 uppercase">Entry</span>
                                                    {r.last_close.toFixed(2)}
                                                </div>
                                                <div>
                                                    <span className="block text-[8px] text-zinc-600 uppercase">Target</span>
                                                    {r.target_price.toFixed(2)}
                                                </div>
                                                <div>
                                                    <span className="block text-[8px] text-zinc-600 uppercase">Stop Loss</span>
                                                    {r.stop_loss.toFixed(2)}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-zinc-800/80 pt-4 mt-2">
                                <p className="text-xs text-zinc-400">
                                    {recsStatus.is_sent 
                                        ? "This batch was already broadcasted to Telegram subscribers." 
                                        : "This batch has NOT been sent to Telegram subscribers yet. You can trigger it manually."
                                    }
                                </p>
                                <button
                                    onClick={sendRecsTelegram}
                                    disabled={sendingRecs || recsStatus.recommendations.length === 0}
                                    className={`w-full sm:w-auto px-6 py-2.5 font-black uppercase text-xs border-2 border-black dark:border-white shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:hover:shadow-[2px_2px_0px_rgba(255,255,255,1)] transition-all flex items-center justify-center gap-2 ${
                                        recsStatus.is_sent
                                            ? "bg-zinc-800 text-zinc-400 cursor-not-allowed"
                                            : "neobrutal-bg-yellow text-black"
                                    }`}
                                >
                                    <Send className="w-4 h-4" />
                                    {sendingRecs ? "Broadcasting..." : recsStatus.is_sent ? "Send Again Manually" : "Send to Telegram Now"}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── Job Run History ── */}
            <div className="border-4 border-black dark:border-white bg-zinc-950 p-6 shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)]">
                <h3 className="text-xs font-black tracking-widest text-zinc-300 uppercase flex items-center gap-2 mb-6">
                    <HistoryIcon className="w-4 h-4 text-amber-400" />
                    Job Run History ({jobRuns.length})
                </h3>

                {loadingJobs && jobRuns.length === 0 ? (
                    <div className="flex items-center justify-center py-12">
                        <RefreshCw className="w-8 h-8 animate-spin text-zinc-600" />
                    </div>
                ) : jobRuns.length === 0 ? (
                    <div className="text-center py-12 text-zinc-500 font-mono text-sm">
                        No job runs yet. Trigger a manual run above.
                    </div>
                ) : (
                    <div className="space-y-3 max-h-[700px] overflow-y-auto pr-1">
                        {jobRuns.map((run) => {
                            const isExpanded = expandedRun === run.id;
                            const steps = normalizeSteps(run.steps);
                            const successSteps = steps.filter((s) => s.status === "success");
                            const failedSteps = steps.filter((s) => s.status === "failed");
                            const hasPartialFailure = run.status === "completed" && failedSteps.length > 0;

                            return (
                                <div key={run.id} className="border-2 border-zinc-800 rounded-none overflow-hidden">
                                    <div
                                        onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-900/40 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            {hasPartialFailure ? (
                                                <AlertTriangle className="w-5 h-5 text-amber-400" />
                                            ) : run.status === "completed" ? (
                                                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                            ) : run.status === "failed" ? (
                                                <XCircle className="w-5 h-5 text-rose-400" />
                                            ) : (
                                                <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
                                            )}
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-2 py-0.5 text-[9px] font-black uppercase border rounded ${getStatusColor(run.status)}`}>
                                                        {hasPartialFailure ? "partial" : run.status}
                                                    </span>
                                                    <span className="text-[9px] font-mono text-zinc-500 bg-zinc-800 px-1.5 py-0.5">
                                                        {run.trigger}
                                                    </span>
                                                </div>
                                                <p className="text-[10px] text-zinc-500 font-mono mt-1">
                                                    Started: {formatTime(run.started_at)}
                                                    {run.completed_at && ` • Completed: ${formatTime(run.completed_at)}`}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 text-right">
                                            <div className="text-[10px] font-mono">
                                                <span className="text-emerald-400 font-black">{successSteps.length}</span>
                                                <span className="text-zinc-600">/</span>
                                                <span className="text-rose-400 font-black">{failedSteps.length}</span>
                                                <span className="text-zinc-600"> steps</span>
                                            </div>
                                            <div className="text-[10px] font-mono text-zinc-400">
                                                Stocks: {getStepByName(run, "generate_recommendations")?.count || 0}
                                            </div>
                                            <span className="text-zinc-600 text-xs">{isExpanded ? "▲" : "▼"}</span>
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="border-t-2 border-zinc-800 p-4 space-y-2">
                                            <div className="grid grid-cols-1 gap-1.5">
                                                {steps.map((step, idx) => {
                                                    const label = STEP_LABELS[step.step] || { en: step.step, ar: step.step, icon: "📌" };
                                                    return (
                                                        <div
                                                            key={idx}
                                                            className={`flex items-center justify-between p-2.5 border text-xs ${
                                                                step.status === "success"
                                                                    ? "border-emerald-500/20 bg-emerald-500/5"
                                                                    : "border-rose-500/20 bg-rose-500/5"
                                                            }`}
                                                        >
                                                             <div className="flex items-center gap-2">
                                                                <span className="text-sm">{label.icon}</span>
                                                                <div>
                                                                    <span className="font-black text-zinc-200">{label.en}</span>
                                                                    {step.details && (
                                                                        <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{step.details}</p>
                                                                    )}
                                                                </div>
                                                                {step.count > 0 && (
                                                                    <span className="text-[9px] bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-400">
                                                                        {step.count}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[9px] text-zinc-500 font-mono">
                                                                    {new Date(step.timestamp).toLocaleTimeString("en-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                                                </span>
                                                                {step.status === "success" ? (
                                                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                                                ) : (
                                                                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                                                <div className="border border-zinc-800 bg-black/20 p-3">
                                                    <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-wider text-zinc-400">
                                                        <BarChart3 className="w-3.5 h-3.5 text-emerald-400" />
                                                        Stock Score Summary
                                                    </div>
                                                    <div className="space-y-1 text-[11px] font-mono text-zinc-300">
                                                        <div>Total symbols: {run.total_symbols || 0}</div>
                                                        <div>Recommendations: {getStepByName(run, "generate_recommendations")?.count || 0}</div>
                                                        <div>Indicators processed: {getStepByName(run, "calculate_indicators")?.count || 0}</div>
                                                    </div>
                                                </div>

                                                <div className="border border-zinc-800 bg-black/20 p-3">
                                                    <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-wider text-zinc-400">
                                                        <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                                                        Similarity Report
                                                    </div>
                                                    <div className="space-y-1 text-[11px] font-mono text-zinc-300">
                                                        <div>Step status: {getStepByName(run, "historical_similarity")?.status || "—"}</div>
                                                        <div>Scanned symbols: {getStepByName(run, "historical_similarity")?.count || 0}</div>
                                                        <div>Latest published: {latestSimilarityReport?.updated_at ? formatTime(latestSimilarityReport.updated_at) : "—"}</div>
                                                    </div>
                                                </div>
                                            </div>

                                            {run.error && (
                                                <div className="mt-3 p-3 border border-rose-500/20 bg-rose-500/5 text-xs text-rose-400 font-mono">
                                                    <strong>Error:</strong> {run.error}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
