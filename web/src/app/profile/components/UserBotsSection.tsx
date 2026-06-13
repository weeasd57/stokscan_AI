"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Play, Square, Settings, RefreshCw, Cpu, Activity, ShieldAlert, Trash2, Bell, BellOff, Send, LogOut, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";

interface Bot {
    bot_id: string;
    name: string;
    status: string;
    poll_seconds: number;
    max_open_positions: number;
    active_positions_count: number;
    total_pnl: number;
    win_rate: number;
    trades_count: number;
    is_subscribed?: boolean;
    subscription_telegram_chat_id?: string | null;
    subscription_notifications_enabled?: boolean;
    subscription_target_pct?: number | null;
    subscription_stop_loss_pct?: number | null;
    subscription_max_open_positions?: number | null;
    subscription_pct_cash_per_trade?: number | null;
}

export default function UserBotsSection() {
    const { user } = useAuth();
    const [bots, setBots] = useState<Bot[]>([]);
    const [loading, setLoading] = useState(true);
    const [submittingBotId, setSubmittingBotId] = useState<string | null>(null);
    
    // Settings Modal
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
    const [customChatId, setCustomChatId] = useState<string>("");
    const [customTarget, setCustomTarget] = useState<string>("");
    const [customStop, setCustomStop] = useState<string>("");
    const [customMaxPositions, setCustomMaxPositions] = useState<string>("");
    const [customCash, setCustomCash] = useState<string>("");
    const [savingSettings, setSavingSettings] = useState(false);

    useEffect(() => {
        if (user) {
            fetchBots();
        }
    }, [user]);

    const fetchBots = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/ai_bot/list?user_id=${user?.id}`);
            if (res.ok) {
                const data = await res.json();
                setBots(data.bots || []);
            }
        } catch (error) {
            console.error("Failed to fetch bots:", error);
        } finally {
            setLoading(false);
        }
    };

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
            if (res.ok) {
                toast.success("Successfully unsubscribed");
                fetchBots();
            } else {
                toast.error("Failed to unsubscribe");
            }
        } catch (e) {
            toast.error("Connection error");
        } finally {
            setSubmittingBotId(null);
        }
    };

    const toggleNotifications = async (bot: Bot) => {
        if (!user) return;
        const currentEnabled = bot.subscription_notifications_enabled !== false;
        try {
            const res = await fetch("/api/ai_bot/subscription/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bot_id: bot.bot_id,
                    user_id: user.id,
                    notifications_enabled: !currentEnabled,
                })
            });
            if (res.ok) {
                toast.success(!currentEnabled ? "Notifications enabled" : "Notifications muted");
                fetchBots();
            } else {
                toast.error("Failed to update notification settings");
            }
        } catch (e) {
            toast.error("Connection error");
        }
    };

    const openSettings = (bot: Bot) => {
        setSelectedBot(bot);
        setCustomChatId(bot.subscription_telegram_chat_id || "");
        setCustomTarget(bot.subscription_target_pct !== null && bot.subscription_target_pct !== undefined ? String(bot.subscription_target_pct) : "");
        setCustomStop(bot.subscription_stop_loss_pct !== null && bot.subscription_stop_loss_pct !== undefined ? String(bot.subscription_stop_loss_pct) : "");
        setCustomMaxPositions(bot.subscription_max_open_positions !== null && bot.subscription_max_open_positions !== undefined ? String(bot.subscription_max_open_positions) : "");
        setCustomCash(bot.subscription_pct_cash_per_trade !== null && bot.subscription_pct_cash_per_trade !== undefined ? String(bot.subscription_pct_cash_per_trade * 100) : "");
        setSettingsOpen(true);
    };

    const saveSettings = async () => {
        if (!user || !selectedBot) return;
        
        const targetVal = customTarget.trim() !== "" ? Number(customTarget) : null;
        const stopVal = customStop.trim() !== "" ? Number(customStop) : null;
        const maxPosVal = customMaxPositions.trim() !== "" ? Number(customMaxPositions) : null;
        const cashVal = customCash.trim() !== "" ? Number(customCash) / 100.0 : null;

        if (targetVal !== null && (isNaN(targetVal) || targetVal <= 0 || targetVal > 100)) {
            toast.error("Target must be a number between 0 and 100");
            return;
        }
        if (stopVal !== null && (isNaN(stopVal) || stopVal <= 0 || stopVal > 100)) {
            toast.error("Stop loss must be a number between 0 and 100");
            return;
        }
        if (maxPosVal !== null && (isNaN(maxPosVal) || maxPosVal <= 0)) {
            toast.error("Max open positions must be a positive integer");
            return;
        }
        if (cashVal !== null && (isNaN(cashVal) || cashVal <= 0 || cashVal > 1)) {
            toast.error("Cash percentage must be between 0 and 100");
            return;
        }

        setSavingSettings(true);
        try {
            const res = await fetch("/api/ai_bot/subscription/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bot_id: selectedBot.bot_id,
                    user_id: user.id,
                    telegram_chat_id: customChatId.trim() || null,
                    target_pct: targetVal,
                    stop_loss_pct: stopVal,
                    max_open_positions: maxPosVal,
                    pct_cash_per_trade: cashVal,
                })
            });
            if (res.ok) {
                toast.success("Settings saved successfully");
                setSettingsOpen(false);
                fetchBots();
            } else {
                toast.error("Failed to save settings");
            }
        } catch (e) {
            toast.error("Connection error");
        } finally {
            setSavingSettings(false);
        }
    };

    const subscribedBots = bots.filter(b => b.is_subscribed);

    const formatNum = (val: number | undefined | null, decimals = 2) => {
        if (val === undefined || val === null || isNaN(val)) return "0.00";
        return val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };

    return (
        <section className="neobrutal-card p-6 sm:p-8 space-y-8 relative overflow-hidden bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_var(--brutal-shadow)]">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10">
                <div className="space-y-2">
                    <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight flex items-center gap-3">
                        <Cpu className="text-indigo-650 dark:text-indigo-400" />
                        Subscribed AI Trading Bots
                    </h2>
                    <p className="text-sm text-zinc-700 dark:text-zinc-400 font-bold max-w-xl">
                        Active subscriptions to automated quant bots. Max 2 bot subscriptions allowed.
                    </p>
                </div>
                
                <Link
                    href="/scanner/ai"
                    className="inline-flex h-12 px-6 border-4 border-black dark:border-white bg-yellow-450 hover:bg-yellow-400 neobrutal-bg-yellow text-black text-[11px] font-black uppercase tracking-widest transition-all shadow-[2.5px_2.5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2.5px_2.5px_0px_0px_rgba(255,255,255,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none items-center gap-2"
                >
                    Browse AI Scanner
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </div>

            <div className="overflow-x-auto border-4 border-black dark:border-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] relative z-10">
                <table className="w-full text-start text-sm whitespace-nowrap bg-white dark:bg-zinc-900">
                    <thead className="bg-zinc-100 dark:bg-zinc-950 text-[10px] font-black uppercase tracking-[0.2em] text-black dark:text-white border-b-4 border-black dark:border-white">
                        <tr>
                            <th className="px-6 py-4 border-r-4 border-black dark:border-white text-start">Bot Name / ID</th>
                            <th className="px-6 py-4 border-r-4 border-black dark:border-white text-center">Stats (Win / Profit)</th>
                            <th className="px-6 py-4 border-r-4 border-black dark:border-white text-center">Positions</th>
                            <th className="px-6 py-4 border-r-4 border-black dark:border-white text-center">Notifications</th>
                            <th className="px-6 py-4 text-end">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y-4 divide-black dark:divide-white font-bold text-black dark:text-white">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="py-10 text-center">
                                    <RefreshCw className="h-6 w-6 animate-spin text-indigo-505 mx-auto" />
                                </td>
                            </tr>
                        ) : subscribedBots.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="py-12 text-center text-zinc-650 dark:text-zinc-400 text-xs uppercase tracking-widest font-black">
                                    You are not currently subscribed to any bots. Go to the AI Scanner page to subscribe.
                                </td>
                            </tr>
                        ) : subscribedBots.map(bot => {
                            const isMuted = bot.subscription_notifications_enabled === false;
                            const isSubmitting = submittingBotId === bot.bot_id;

                            return (
                                <tr key={bot.bot_id} className="hover:bg-yellow-50/40 dark:hover:bg-zinc-800/40 transition-colors">
                                    <td className="px-6 py-4 border-r-4 border-black dark:border-white">
                                        <div className="flex flex-col gap-0.5">
                                            <span className="font-mono font-black text-indigo-650 dark:text-indigo-400 text-sm">{bot.name}</span>
                                            <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-tighter">ID: {bot.bot_id}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 border-r-4 border-black dark:border-white text-center">
                                        <div className="flex items-center justify-center gap-3">
                                            <div className="text-center font-mono">
                                                <span className="text-[8px] text-zinc-550 dark:text-zinc-500 uppercase font-black tracking-wider block">Win Rate</span>
                                                <span className="text-emerald-600 dark:text-emerald-400 font-bold text-xs">{formatNum(bot.win_rate, 1)}%</span>
                                            </div>
                                            <div className="w-1 h-6 bg-black dark:bg-white opacity-20" />
                                            <div className="text-center font-mono">
                                                <span className="text-[8px] text-zinc-550 dark:text-zinc-500 uppercase font-black tracking-wider block">Net P/L</span>
                                                <span className={`font-bold text-xs ${bot.total_pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-650 dark:text-red-405"}`}>
                                                    {bot.total_pnl >= 0 ? "+" : ""}{formatNum(bot.total_pnl, 2)}%
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 border-r-4 border-black dark:border-white text-center font-mono text-zinc-800 dark:text-zinc-200 font-black">
                                        {bot.active_positions_count} / {bot.max_open_positions}
                                    </td>
                                    <td className="px-6 py-4 border-r-4 border-black dark:border-white text-center">
                                        <button
                                            onClick={() => toggleNotifications(bot)}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1 text-[9px] font-black uppercase tracking-widest border-2 border-black dark:border-white transition-all shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[1.5px_1.5px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[0.5px] hover:translate-y-[0.5px] active:translate-x-[1.5px] active:translate-y-[1.5px] active:shadow-none ${
                                                isMuted 
                                                    ? "bg-red-400 text-black hover:bg-red-300" 
                                                    : "bg-emerald-400 text-black hover:bg-emerald-300"
                                            }`}
                                            title={isMuted ? "Enable Notifications" : "Mute Notifications"}
                                        >
                                            {isMuted ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                                            {isMuted ? "Muted" : "Active"}
                                        </button>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button 
                                                onClick={() => openSettings(bot)}
                                                className="p-2 border-2 border-black dark:border-white bg-white dark:bg-zinc-800 text-black dark:text-white shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[1.5px_1.5px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[0.5px] hover:translate-y-[0.5px] active:translate-x-[1.5px] active:translate-y-[1.5px] active:shadow-none"
                                                title="Notification Settings"
                                            >
                                                <Settings className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={() => handleUnsubscribe(bot.bot_id)}
                                                disabled={isSubmitting}
                                                className="p-2 border-2 border-black dark:border-white bg-red-400 hover:bg-red-300 text-black shadow-[1.5px_1.5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[1.5px_1.5px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[0.5px] hover:translate-y-[0.5px] active:translate-x-[1.5px] active:translate-y-[1.5px] active:shadow-none disabled:opacity-50"
                                                title="Unsubscribe"
                                            >
                                                {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Custom Telegram Chat ID Settings Modal */}
            <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[999]" />
                    <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-white dark:bg-zinc-900 border-4 border-black dark:border-white p-8 z-[1000] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] overflow-y-auto max-h-[90vh]">
                        <Dialog.Title className="text-xl font-black text-black dark:text-white uppercase tracking-tight mb-6 flex items-center gap-2 border-b-4 border-black dark:border-zinc-800 pb-3">
                            <Settings className="w-5 h-5 text-indigo-650 dark:text-indigo-400" />
                            Bot custom settings
                        </Dialog.Title>

                        <div className="space-y-6 text-black dark:text-white font-bold">
                            {/* Telegram Chat ID */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-700 dark:text-zinc-400 uppercase tracking-widest block">
                                    Telegram Chat ID Override
                                </label>
                                <input 
                                    type="text" 
                                    value={customChatId} 
                                    onChange={(e) => setCustomChatId(e.target.value)}
                                    placeholder="Leave empty to use default profile Telegram Chat ID"
                                    className="w-full bg-white dark:bg-zinc-950 border-4 border-black dark:border-white px-4 py-3 text-sm text-black dark:text-white focus:outline-none focus:bg-yellow-50 dark:focus:bg-zinc-800 font-mono placeholder:text-zinc-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {/* Custom Target % */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-zinc-700 dark:text-zinc-400 uppercase tracking-widest block">
                                        Target Profit (%)
                                    </label>
                                    <div className="relative">
                                        <input 
                                            type="number" 
                                            value={customTarget} 
                                            onChange={(e) => setCustomTarget(e.target.value)}
                                            placeholder="Default (10%)"
                                            className="w-full bg-white dark:bg-zinc-955 border-4 border-black dark:border-white pl-4 pr-8 py-3 text-sm text-indigo-650 dark:text-indigo-400 font-bold focus:outline-none focus:bg-yellow-50 dark:focus:bg-zinc-800 font-mono placeholder:text-zinc-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-xs text-zinc-650">%</span>
                                    </div>
                                </div>

                                {/* Custom Stop Loss % */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-zinc-700 dark:text-zinc-400 uppercase tracking-widest block">
                                        Stop Loss (%)
                                    </label>
                                    <div className="relative">
                                        <input 
                                            type="number" 
                                            value={customStop} 
                                            onChange={(e) => setCustomStop(e.target.value)}
                                            placeholder="Default (3.5%)"
                                            className="w-full bg-white dark:bg-zinc-955 border-4 border-black dark:border-white pl-4 pr-8 py-3 text-sm text-red-650 dark:text-red-400 font-bold focus:outline-none focus:bg-yellow-50 dark:focus:bg-zinc-800 font-mono placeholder:text-zinc-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-xs text-zinc-650">%</span>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                {/* Max Open Positions */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-zinc-700 dark:text-zinc-400 uppercase tracking-widest block">
                                        Max Open Positions
                                    </label>
                                    <input 
                                        type="number" 
                                        value={customMaxPositions} 
                                        onChange={(e) => setCustomMaxPositions(e.target.value)}
                                        placeholder={`Default (${selectedBot?.max_open_positions || 8})`}
                                        className="w-full bg-white dark:bg-zinc-955 border-4 border-black dark:border-white px-4 py-3 text-sm text-black dark:text-white focus:outline-none focus:bg-yellow-50 dark:focus:bg-zinc-800 font-mono placeholder:text-zinc-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                                    />
                                </div>

                                {/* Percent Cash per Trade */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-zinc-700 dark:text-zinc-400 uppercase tracking-widest block">
                                        Cash Per Trade (%)
                                    </label>
                                    <div className="relative">
                                        <input 
                                            type="number" 
                                            value={customCash} 
                                            onChange={(e) => setCustomCash(e.target.value)}
                                            placeholder="Default (15%)"
                                            className="w-full bg-white dark:bg-zinc-950 border-4 border-black dark:border-white pl-4 pr-8 py-3 text-sm text-black dark:text-white focus:outline-none focus:bg-yellow-50 dark:focus:bg-zinc-800 font-mono placeholder:text-zinc-500 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)]"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-xs text-zinc-650">%</span>
                                    </div>
                                </div>
                            </div>

                            <p className="text-[10px] text-zinc-600 dark:text-zinc-400 font-bold uppercase tracking-wider leading-relaxed border-t-4 border-black dark:border-zinc-800 pt-4">
                                * Overrides will apply only to {selectedBot?.name}. Any values left blank will fall back to your default settings or the bot's default configuration.
                            </p>
                            
                            <div className="flex justify-end gap-3 pt-4 border-t-4 border-black dark:border-zinc-800">
                                <Dialog.Close asChild>
                                    <button className="px-5 py-2.5 bg-white dark:bg-zinc-800 text-black dark:text-white text-xs font-black uppercase tracking-widest border-4 border-black dark:border-white shadow-[2.5px_2.5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2.5px_2.5px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[1px] hover:translate-y-[1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                                        Cancel
                                    </button>
                                </Dialog.Close>
                                <button 
                                    onClick={saveSettings}
                                    disabled={savingSettings}
                                    className="px-5 py-2.5 bg-yellow-450 hover:bg-yellow-400 neobrutal-bg-yellow text-black text-xs font-black uppercase tracking-widest border-4 border-black dark:border-white shadow-[2.5px_2.5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2.5px_2.5px_0px_0px_rgba(255,255,255,1)] hover:translate-x-[1px] hover:translate-y-[1px] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50 flex items-center gap-2"
                                >
                                    {savingSettings && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                                    Save Settings
                                </button>
                            </div>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </section>
    );
}
