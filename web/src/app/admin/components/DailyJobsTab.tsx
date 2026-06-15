"use client";

import { useState, useEffect } from "react";
import {
    Activity, Clock, Zap, ShieldAlert, Settings, Save, Terminal,
    History as HistoryIcon, RefreshCw, Play, CheckCircle2, XCircle,
    AlertTriangle, BarChart3, Calendar
} from "lucide-react";
import { toast } from "sonner";
import * as Switch from "@radix-ui/react-switch";

interface StepLog {
    step: string;
    status: "success" | "failed";
    details: string;
    count: number;
    timestamp: string;
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
    const [loadingJobs, setLoadingJobs] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const [expandedRun, setExpandedRun] = useState<string | null>(null);
    const [savingSchedule, setSavingSchedule] = useState(false);

    useEffect(() => {
        fetchJobHistory();
        fetchSchedule();
        const interval = setInterval(fetchJobHistory, 15000);
        const schedInterval = setInterval(fetchSchedule, 30000);
        return () => { clearInterval(interval); clearInterval(schedInterval); };
    }, []);

    const fetchJobHistory = async (silent = false) => {
        if (!silent) setLoadingJobs(true);
        try {
            const res = await fetch("/api/admin/daily-jobs/history?limit=15");
            if (res.ok) {
                const data = await res.json();
                setJobRuns(data.runs || []);
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

    const formatTime = (iso: string | null) => {
        if (!iso) return "—";
        const d = new Date(iso);
        return d.toLocaleString("en-EG", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    };

    const getStatusColor = (status: string) => {
        if (status === "completed") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
        if (status === "failed") return "text-rose-400 bg-rose-500/10 border-rose-500/20";
        return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    };

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
                        onClick={() => fetchJobHistory()}
                        disabled={loadingJobs}
                        className="h-12 px-6 border-4 border-black dark:border-white bg-zinc-900 text-zinc-300 font-black uppercase text-xs tracking-wider flex items-center gap-2 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[5px_5px_0px_rgba(0,0,0,1)] dark:hover:shadow-[5px_5px_0px_rgba(255,255,255,1)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none transition-all duration-100"
                    >
                        <RefreshCw className={`w-4 h-4 ${loadingJobs ? "animate-spin" : ""}`} /> Refresh
                    </button>
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
                            const allSuccess = run.steps.every((s) => s.status === "success");
                            const failedSteps = run.steps.filter((s) => s.status === "failed");

                            return (
                                <div key={run.id} className="border-2 border-zinc-800 rounded-none overflow-hidden">
                                    <div
                                        onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-zinc-900/40 transition-colors"
                                    >
                                        <div className="flex items-center gap-3">
                                            {run.status === "completed" ? (
                                                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                            ) : run.status === "failed" ? (
                                                <XCircle className="w-5 h-5 text-rose-400" />
                                            ) : (
                                                <RefreshCw className="w-5 h-5 animate-spin text-amber-400" />
                                            )}
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`px-2 py-0.5 text-[9px] font-black uppercase border rounded ${getStatusColor(run.status)}`}>
                                                        {run.status}
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
                                                <span className="text-emerald-400 font-black">{run.steps.filter(s => s.status === "success").length}</span>
                                                <span className="text-zinc-600">/</span>
                                                <span className="text-rose-400 font-black">{run.steps.filter(s => s.status === "failed").length}</span>
                                                <span className="text-zinc-600"> steps</span>
                                            </div>
                                            <span className="text-zinc-600 text-xs">{isExpanded ? "▲" : "▼"}</span>
                                        </div>
                                    </div>

                                    {isExpanded && (
                                        <div className="border-t-2 border-zinc-800 p-4 space-y-2">
                                            <div className="grid grid-cols-1 gap-1.5">
                                                {run.steps.map((step, idx) => {
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
                                                                <span className="font-black text-zinc-200">{label.en}</span>
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
