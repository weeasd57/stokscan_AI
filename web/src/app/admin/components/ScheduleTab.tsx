"use client";

import { useState, useEffect } from "react";
import { Activity, Clock, Zap, ShieldAlert, Settings, Save, Terminal, History as HistoryIcon, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import * as Switch from "@radix-ui/react-switch";

interface RunHistoryEntry {
    run_at: string;
    status: "ok" | "skipped" | "error";
    reason?: string;
    cycle: number;
    matches: string[];
    refreshed: number;
    errors: number;
    duration_s: number;
}

interface SchedulerState {
    enabled: boolean;
    respect_schedule: boolean;
    interval_minutes: number;
    open_time: string;
    close_time: string;
    active_days: number[];
    status: "idle" | "running" | "sleeping" | "disabled" | "error";
    next_run_at: string | null;
    last_run_at: string | null;
    last_run_status: "ok" | "skipped" | "error" | null;
    total_runs: number;
    total_skipped: number;
    run_history: RunHistoryEntry[];
    live_logs: string[];
}

export default function ScheduleTab() {
    const [schedulerState, setSchedulerState] = useState<SchedulerState | null>(null);
    const [schedulerLoading, setSchedulerLoading] = useState(false);
    const [savingSchedulerConfig, setSavingSchedulerConfig] = useState(false);

    const fetchSchedulerState = async (silent = false) => {
        if (!silent) setSchedulerLoading(true);
        try {
            const res = await fetch("/api/admin/alert-scheduler/state");
            if (res.ok) {
                const data = await res.json();
                setSchedulerState(data);
            }
        } catch (error) {
            console.error("Failed to fetch scheduler state:", error);
            if (!silent) toast.error("Failed to fetch alert scheduler state");
        } finally {
            if (!silent) setSchedulerLoading(false);
        }
    };

    const handleUpdateSchedulerConfig = async (configPayload: Partial<SchedulerState>) => {
        setSavingSchedulerConfig(true);
        try {
            const res = await fetch("/api/admin/alert-scheduler/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(configPayload),
            });
            if (res.ok) {
                toast.success("Operating schedule updated successfully");
                await fetchSchedulerState(true);
            } else {
                toast.error("Failed to update operating schedule");
            }
        } catch (error) {
            console.error("Error updating scheduler config:", error);
            toast.error("Failed to save schedule changes");
        } finally {
            setSavingSchedulerConfig(false);
        }
    };

    useEffect(() => {
        fetchSchedulerState(false);
        const interval = setInterval(() => {
            fetchSchedulerState(true);
        }, 8000);
        return () => clearInterval(interval);
    }, []);

    if (schedulerLoading && !schedulerState) {
        return (
            <div className="flex flex-col items-center justify-center h-96 space-y-4">
                <RefreshCw className="w-10 h-10 text-purple-500 animate-spin" />
                <p className="text-zinc-500 font-mono text-sm tracking-widest">LOADING SCHEDULER STATE...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-[1600px] mx-auto p-4 md:p-8 animate-in fade-in zoom-in-95 duration-500 pb-20">
            {/* Status Overview Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl group hover:border-purple-500/30 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                            <Activity className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Scheduler Status</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className={`w-3.5 h-3.5 rounded-full ${
                            schedulerState?.status === "running" ? "bg-emerald-500 animate-pulse shadow-[0_0_12px_rgba(16,185,129,0.5)]" :
                            schedulerState?.status === "sleeping" ? "bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.5)]" :
                            schedulerState?.status === "disabled" ? "bg-zinc-600" :
                            schedulerState?.status === "error" ? "bg-red-500 animate-bounce shadow-[0_0_12px_rgba(239,68,68,0.5)]" :
                            "bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.5)]"
                        }`} />
                        <span className="text-2xl font-black text-white uppercase tracking-tight">
                            {schedulerState?.status || "UNKNOWN"}
                        </span>
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">Alert scanner daemon state</div>
                </div>

                <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl group hover:border-purple-500/30 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                            <Clock className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Next Run At</span>
                    </div>
                    <div className="text-lg font-bold text-white tracking-tight truncate">
                        {schedulerState?.next_run_at ? new Date(schedulerState.next_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "N/A"}
                    </div>
                    <div className="mt-2 text-xs text-zinc-500">
                        {schedulerState?.next_run_at ? new Date(schedulerState.next_run_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : "No cycle scheduled"}
                    </div>
                </div>

                <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl group hover:border-purple-500/30 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                            <Zap className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Total Cycles Run</span>
                    </div>
                    <div className="text-3xl font-black text-white">{schedulerState?.total_runs || 0}</div>
                    <div className="mt-2 text-xs text-zinc-500">Successful market scans</div>
                </div>

                <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl group hover:border-purple-500/30 transition-all">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                            <ShieldAlert className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Cycles Skipped</span>
                    </div>
                    <div className="text-3xl font-black text-amber-500">{schedulerState?.total_skipped || 0}</div>
                    <div className="mt-2 text-xs text-zinc-500">Skipped (Market closed)</div>
                </div>
            </div>

            {/* Main Scheduler Control & Logs Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left: Configuration Controls */}
                <div className="lg:col-span-1 bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl flex flex-col justify-between shadow-2xl relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-indigo-500/5 pointer-events-none" />
                    
                    <div>
                        <div className="flex items-center gap-3 mb-8">
                            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20">
                                <Settings className="w-5 h-5 text-purple-400" />
                            </div>
                            <h2 className="text-xl font-bold tracking-tight text-white">SCHEDULE SETTINGS</h2>
                        </div>

                        {schedulerState && (
                            <div className="space-y-6">
                                {/* Enabled Master Switch */}
                                <div className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl">
                                    <div>
                                        <div className="text-sm font-bold text-white">Scheduler Active</div>
                                        <div className="text-[10px] text-zinc-400">Master scanning process toggle</div>
                                    </div>
                                    <Switch.Root
                                        checked={schedulerState.enabled}
                                        onCheckedChange={(checked: boolean) => setSchedulerState(prev => prev ? { ...prev, enabled: checked } : null)}
                                        className={`w-11 h-6 rounded-full relative outline-none cursor-pointer transition-colors ${schedulerState.enabled ? 'bg-purple-600' : 'bg-zinc-800'}`}
                                    >
                                        <Switch.Thumb className={`block w-5 h-5 bg-white rounded-full transition-transform duration-100 translate-x-0.5 ${schedulerState.enabled ? 'translate-x-[22px]' : ''}`} />
                                    </Switch.Root>
                                </div>

                                {/* Respect Schedule Switch */}
                                <div className="flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl">
                                    <div>
                                        <div className="text-sm font-bold text-white">Respect Market Hours</div>
                                        <div className="text-[10px] text-zinc-400">Only scan during trading session</div>
                                    </div>
                                    <Switch.Root
                                        checked={schedulerState.respect_schedule}
                                        onCheckedChange={(checked: boolean) => setSchedulerState(prev => prev ? { ...prev, respect_schedule: checked } : null)}
                                        className={`w-11 h-6 rounded-full relative outline-none cursor-pointer transition-colors ${schedulerState.respect_schedule ? 'bg-purple-600' : 'bg-zinc-800'}`}
                                    >
                                        <Switch.Thumb className={`block w-5 h-5 bg-white rounded-full transition-transform duration-100 translate-x-0.5 ${schedulerState.respect_schedule ? 'translate-x-[22px]' : ''}`} />
                                    </Switch.Root>
                                </div>

                                {/* Interval Minutes */}
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Scan Interval (Minutes)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={1440}
                                        value={schedulerState.interval_minutes}
                                        onChange={(e) => setSchedulerState(prev => prev ? { ...prev, interval_minutes: parseInt(e.target.value) || 30 } : null)}
                                        className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 transition-colors text-white font-mono"
                                    />
                                </div>

                                {/* Sessions hours Cairo */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Open Session (Cairo)</label>
                                        <input
                                            type="text"
                                            placeholder="10:00"
                                            value={schedulerState.open_time}
                                            onChange={(e) => setSchedulerState(prev => prev ? { ...prev, open_time: e.target.value } : null)}
                                            className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 transition-colors text-white font-mono"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Close Session (Cairo)</label>
                                        <input
                                            type="text"
                                            placeholder="14:30"
                                            value={schedulerState.close_time}
                                            onChange={(e) => setSchedulerState(prev => prev ? { ...prev, close_time: e.target.value } : null)}
                                            className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500 transition-colors text-white font-mono"
                                        />
                                    </div>
                                </div>

                                {/* Active Days Checkboxes */}
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Active Trading Days</label>
                                    <div className="grid grid-cols-7 gap-1">
                                        {[
                                            { label: "S", val: 6 },
                                            { label: "M", val: 0 },
                                            { label: "T", val: 1 },
                                            { label: "W", val: 2 },
                                            { label: "T", val: 3 },
                                            { label: "F", val: 4 },
                                            { label: "S", val: 5 }
                                        ].map(day => {
                                            const isChecked = schedulerState.active_days.includes(day.val);
                                            return (
                                                <button
                                                    key={day.val}
                                                    type="button"
                                                    onClick={() => {
                                                        const current = schedulerState.active_days;
                                                        const updated = current.includes(day.val)
                                                            ? current.filter(d => d !== day.val)
                                                            : [...current, day.val];
                                                        setSchedulerState(prev => prev ? { ...prev, active_days: updated } : null);
                                                    }}
                                                    className={`py-2 text-xs font-black rounded-lg border transition-all ${
                                                        isChecked
                                                            ? "bg-purple-600 border-purple-500 text-white shadow-md shadow-purple-500/20"
                                                            : "bg-zinc-800/40 border-zinc-700/30 text-zinc-500 hover:text-zinc-300"
                                                    }`}
                                                >
                                                    {day.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        disabled={savingSchedulerConfig}
                        onClick={() => schedulerState && handleUpdateSchedulerConfig(schedulerState)}
                        className="w-full mt-6 py-3.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm tracking-widest uppercase transition-all flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-purple-500/20 disabled:opacity-50"
                    >
                        {savingSchedulerConfig ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                SAVING CHANGES...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                SAVE SCHEDULE
                            </>
                        )}
                    </button>
                </div>

                {/* Right: Live Logs terminal */}
                <div className="lg:col-span-2 bg-black border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between shadow-2xl relative overflow-hidden h-[545px]">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-4">
                        <div className="flex items-center gap-2">
                            <Terminal className="w-5 h-5 text-purple-400" />
                            <h2 className="text-sm font-bold tracking-widest text-zinc-300">SCHEDULER DAEMON LOGS</h2>
                        </div>
                        <button
                            onClick={() => fetchSchedulerState(false)}
                            className="p-2 rounded-xl bg-zinc-800/40 border border-zinc-700/30 text-zinc-400 hover:text-white transition-all flex items-center gap-1.5 text-xs font-bold"
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Refresh Logs
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 bg-zinc-950/50 border border-zinc-900 rounded-2xl p-4 overflow-y-auto font-mono text-[11px] text-zinc-400 custom-scrollbar space-y-1">
                        {schedulerState?.live_logs && schedulerState.live_logs.length > 0 ? (
                            schedulerState.live_logs.map((log, index) => {
                                let colorClass = "text-zinc-400";
                                if (log.includes("ERROR")) colorClass = "text-red-400 font-bold";
                                else if (log.includes("WARNING")) colorClass = "text-amber-400 font-bold";
                                else if (log.includes("[CONFIG]")) colorClass = "text-cyan-400 font-bold";
                                else if (log.includes("Cycle #")) colorClass = "text-purple-400 font-bold";
                                else if (log.includes("refreshed=")) colorClass = "text-emerald-400";
                                
                                return (
                                    <div key={index} className={`${colorClass} whitespace-pre-wrap leading-relaxed border-l-2 border-zinc-800/50 pl-2`}>
                                        {log}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-zinc-600 italic text-center py-20 uppercase tracking-widest font-mono text-[10px]">
                                Terminal idle... Awaiting scanner cycles
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Run History Table */}
            <div className="bg-zinc-900/40 border border-white/5 rounded-3xl p-6 backdrop-blur-xl">
                <div className="flex items-center gap-3 mb-6">
                    <HistoryIcon className="w-5 h-5 text-purple-400" />
                    <h2 className="text-lg font-bold text-white tracking-tight">SCANNER CYCLE HISTORY</h2>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-white/5">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-black/40 text-[10px] font-black text-zinc-500 uppercase tracking-widest border-b border-zinc-800">
                            <tr>
                                <th className="px-6 py-4">Time</th>
                                <th className="px-6 py-4">Cycle</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-center">Refreshed</th>
                                <th className="px-6 py-4 text-center">New Matches</th>
                                <th className="px-6 py-4 text-center">Errors</th>
                                <th className="px-6 py-4 text-right">Duration</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5 font-mono text-xs">
                            {schedulerState?.run_history && schedulerState.run_history.length > 0 ? (
                                schedulerState.run_history.map((run, i) => (
                                    <tr key={i} className="hover:bg-white/5 transition-colors group">
                                        <td className="px-6 py-4 text-zinc-300 font-bold">
                                            {new Date(run.run_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}
                                        </td>
                                        <td className="px-6 py-4 text-zinc-500 font-bold">#{run.cycle}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider ${
                                                run.status === "ok" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/10" :
                                                run.status === "skipped" ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/10" :
                                                "bg-red-500/10 text-red-400 border border-red-500/10"
                                            }`}>
                                                {run.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center font-bold text-zinc-400">{run.refreshed}</td>
                                        <td className="px-6 py-4 text-center">
                                            {run.matches && run.matches.length > 0 ? (
                                                <div className="flex flex-wrap justify-center gap-1.5 max-w-[200px]">
                                                    {run.matches.map(symbol => (
                                                        <span key={symbol} className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-[10px]">
                                                            {symbol}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span className="text-zinc-600 italic">None</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className={run.errors > 0 ? "text-red-400 font-bold" : "text-zinc-600"}>
                                                {run.errors}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right text-zinc-300">
                                            {run.duration_s ? `${run.duration_s}s` : '--'}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center text-zinc-600 italic font-mono uppercase tracking-[0.2em] text-[10px]">
                                        No scheduler run records found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
