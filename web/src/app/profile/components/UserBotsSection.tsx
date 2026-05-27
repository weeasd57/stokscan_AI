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
        setSettingsOpen(true);
    };

    const saveSettings = async () => {
        if (!user || !selectedBot) return;
        setSavingSettings(true);
        try {
            const res = await fetch("/api/ai_bot/subscription/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bot_id: selectedBot.bot_id,
                    user_id: user.id,
                    telegram_chat_id: customChatId.trim() || null,
                })
            });
            if (res.ok) {
                toast.success("Telegram chat settings saved");
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
        <section className="rounded-[2.5rem] border border-white/5 bg-zinc-950/40 p-8 shadow-2xl backdrop-blur-xl space-y-8 min-h-[400px]">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-2">
                    <h2 className="text-2xl font-black text-white uppercase tracking-tight flex items-center gap-3">
                        <Cpu className="text-indigo-400" />
                        Subscribed AI Trading Bots
                    </h2>
                    <p className="text-sm text-zinc-500 font-medium max-w-xl">
                        Active subscriptions to automated quant bots. Max 2 bot subscriptions allowed.
                    </p>
                </div>
                
                <Link
                    href="/scanner/ai"
                    className="h-12 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-black uppercase tracking-widest transition-all shadow-xl shadow-indigo-500/20 flex items-center gap-2"
                >
                    Browse AI Scanner
                    <ArrowRight className="h-4 w-4" />
                </Link>
            </div>

            <div className="overflow-hidden rounded-[2rem] border border-white/5 bg-zinc-950/80">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-zinc-950/80 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 border-b border-white/5">
                        <tr>
                            <th className="px-8 py-5">Bot Name / ID</th>
                            <th className="px-6 py-5 text-center">Stats (Win / Profit)</th>
                            <th className="px-6 py-5 text-center">Positions</th>
                            <th className="px-6 py-5 text-center">Notifications</th>
                            <th className="px-8 py-5 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="py-10 text-center">
                                    <RefreshCw className="h-6 w-6 animate-spin text-indigo-500 mx-auto" />
                                </td>
                            </tr>
                        ) : subscribedBots.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="py-12 text-center text-zinc-500 text-xs uppercase tracking-widest font-bold">
                                    You are not currently subscribed to any bots. Go to the AI Scanner page to subscribe.
                                </td>
                            </tr>
                        ) : subscribedBots.map(bot => {
                            const isMuted = bot.subscription_notifications_enabled === false;
                            const isSubmitting = submittingBotId === bot.bot_id;

                            return (
                                <tr key={bot.bot_id} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="px-8 py-5">
                                        <div className="flex flex-col gap-1">
                                            <span className="font-mono font-black text-indigo-300">{bot.name}</span>
                                            <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-tighter">ID: {bot.bot_id}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-center">
                                        <div className="flex items-center justify-center gap-3">
                                            <div className="text-center font-mono">
                                                <span className="text-[8px] text-zinc-500 uppercase font-black tracking-wider block">Win Rate</span>
                                                <span className="text-emerald-400 font-bold text-xs">{formatNum(bot.win_rate, 1)}%</span>
                                            </div>
                                            <div className="w-px h-6 bg-white/10" />
                                            <div className="text-center font-mono">
                                                <span className="text-[8px] text-zinc-500 uppercase font-black tracking-wider block">Net P/L</span>
                                                <span className={`font-bold text-xs ${bot.total_pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                                    {bot.total_pnl >= 0 ? "+" : ""}{formatNum(bot.total_pnl, 2)}%
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-center font-mono text-zinc-300 font-black">
                                        {bot.active_positions_count} / {bot.max_open_positions}
                                    </td>
                                    <td className="px-6 py-5 text-center">
                                        <button
                                            onClick={() => toggleNotifications(bot)}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all ${
                                                isMuted 
                                                    ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20" 
                                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                                            }`}
                                            title={isMuted ? "Enable Notifications" : "Mute Notifications"}
                                        >
                                            {isMuted ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                                            {isMuted ? "Muted" : "Active"}
                                        </button>
                                    </td>
                                    <td className="px-8 py-5 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button 
                                                onClick={() => openSettings(bot)}
                                                className="p-2 rounded-xl bg-zinc-800/50 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all border border-white/5"
                                                title="Notification Settings"
                                            >
                                                <Settings className="w-4 h-4" />
                                            </button>
                                            <button 
                                                onClick={() => handleUnsubscribe(bot.bot_id)}
                                                disabled={isSubmitting}
                                                className="p-2 rounded-xl bg-red-500/5 text-red-400 hover:bg-red-500/20 transition-all border border-red-500/10 disabled:opacity-50"
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
                    <Dialog.Overlay className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[999]" />
                    <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-zinc-950 border border-white/10 rounded-[2rem] p-8 z-[1000] shadow-2xl">
                        <Dialog.Title className="text-xl font-black text-white uppercase tracking-tight mb-4 flex items-center gap-2">
                            <Send className="w-5 h-5 text-indigo-400" />
                            Telegram settings
                        </Dialog.Title>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">
                                    Telegram Chat ID for {selectedBot?.name}
                                </label>
                                <input 
                                    type="text" 
                                    value={customChatId} 
                                    onChange={(e) => setCustomChatId(e.target.value)}
                                    placeholder="Leave empty to use default profile Telegram Chat ID"
                                    className="w-full bg-zinc-900 border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono placeholder:text-zinc-700"
                                />
                                <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-wider leading-relaxed">
                                    * If left blank, notifications will fall back to your global Default Telegram Chat ID specified on your profile.
                                </p>
                            </div>
                            
                            <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                                <Dialog.Close asChild>
                                    <button className="px-5 py-2.5 rounded-xl bg-zinc-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-zinc-800 transition-all border border-white/5">
                                        Cancel
                                    </button>
                                </Dialog.Close>
                                <button 
                                    onClick={saveSettings}
                                    disabled={savingSettings}
                                    className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-indigo-500 transition-all disabled:opacity-50 flex items-center gap-2"
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
