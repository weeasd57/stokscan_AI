"use client";

import { useState } from "react";
import { Send, Eye, RefreshCw, AlertTriangle, CheckCircle2, MessageSquare } from "lucide-react";
import { toast } from "sonner";

export default function TelegramDispatchTab() {
    const [recMessage, setRecMessage] = useState("");
    const [reportMessage, setReportMessage] = useState("");

    const [loadingRec, setLoadingRec] = useState(false);
    const [loadingReport, setLoadingReport] = useState(false);

    const [sendingRec, setSendingRec] = useState(false);
    const [sendingReport, setSendingReport] = useState(false);

    const [recCount, setRecCount] = useState<number | null>(null);
    const [reportCount, setReportCount] = useState<number | null>(null);

    // Fetch Preview
    const handleFetchPreview = async (type: "recommendations" | "report") => {
        if (type === "recommendations") {
            setLoadingRec(true);
            try {
                const res = await fetch("/api/admin/telegram-dispatch/preview?type=recommendations");
                if (res.ok) {
                    const data = await res.json();
                    setRecMessage(data.preview || "");
                    setRecCount(data.count ?? 0);
                    toast.success("AI recommendations preview generated!");
                } else {
                    toast.error("Failed to generate recommendations preview");
                }
            } catch (err) {
                console.error(err);
                toast.error("Network error generating preview");
            } finally {
                setLoadingRec(false);
            }
        } else {
            setLoadingReport(true);
            try {
                const res = await fetch("/api/admin/telegram-dispatch/preview?type=weekly_report");
                if (res.ok) {
                    const data = await res.json();
                    setReportMessage(data.preview || "");
                    setReportCount(data.count ?? 0);
                    toast.success("Weekly performance report preview generated!");
                } else {
                    toast.error("Failed to generate weekly report preview");
                }
            } catch (err) {
                console.error(err);
                toast.error("Network error generating preview");
            } finally {
                setLoadingReport(false);
            }
        }
    };

    // Send Message
    const handleSendMessage = async (type: "recommendations" | "report") => {
        const message = type === "recommendations" ? recMessage : reportMessage;
        if (!message || !message.trim()) {
            toast.error("Message content cannot be empty!");
            return;
        }

        const isRec = type === "recommendations";
        if (isRec) setSendingRec(true);
        else setSendingReport(true);

        try {
            const res = await fetch("/api/admin/telegram-dispatch/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message }),
            });

            if (res.ok) {
                const data = await res.json();
                toast.success(`Message successfully sent to Telegram channel (${data.chat_id || "central"})!`);
            } else {
                const errData = await res.json().catch(() => ({}));
                toast.error(`Failed to send message: ${errData.detail || "Server Error"}`);
            }
        } catch (err) {
            console.error(err);
            toast.error("Network error sending message");
        } finally {
            if (isRec) setSendingRec(false);
            else setSendingReport(false);
        }
    };

    return (
        <div className="space-y-8 max-w-[1600px] mx-auto p-4 md:p-8 animate-in fade-in zoom-in-95 duration-500 pb-20">
            {/* Warning Header */}
            <div className="border-4 border-black dark:border-white bg-amber-400 text-black p-5 shadow-[4px_4px_0px_rgba(0,0,0,1)] flex items-start gap-4">
                <AlertTriangle className="w-8 h-8 shrink-0 mt-0.5" />
                <div>
                    <h2 className="text-base font-black uppercase tracking-wider">Telegram Manual Dispatch Control</h2>
                    <p className="text-xs font-bold mt-1 leading-relaxed">
                        Use this tab to manually send recommendations or daily digest run reports to the public Telegram channel. 
                        This is a fallback mechanism in case the automatic daily job failed to send them. You can edit the text in real-time before broadcasting.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 1. AI Recommendations Card */}
                <div className="border-4 border-black dark:border-white bg-zinc-900/40 p-6 backdrop-blur-xl shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between border-b-4 border-black dark:border-zinc-800 pb-4 mb-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                                    <Send className="w-5 h-5" />
                                </div>
                                <h3 className="text-lg font-black text-white uppercase tracking-tight">AI Recommendations</h3>
                            </div>
                            <span className="text-[10px] font-black bg-purple-600 text-white px-2.5 py-1 rounded-full border-2 border-black">
                                {recCount !== null ? `${recCount} Symbols` : "Unloaded"}
                            </span>
                        </div>

                        <p className="text-xs text-zinc-400 font-bold mb-4 uppercase tracking-wider">
                            Loads today's open recommendations from the database and formats them as a clean detailed card.
                        </p>

                        <div className="space-y-4">
                            <button
                                onClick={() => handleFetchPreview("recommendations")}
                                disabled={loadingRec}
                                className="w-full h-11 border-4 border-black dark:border-white bg-purple-600 hover:bg-purple-500 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                            >
                                {loadingRec ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Eye className="w-4 h-4" />
                                )}
                                Generate Recommendations Preview
                            </button>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Message Preview (Markdown)</label>
                                <textarea
                                    value={recMessage}
                                    onChange={(e) => setRecMessage(e.target.value)}
                                    placeholder="Message preview will load here..."
                                    className="w-full h-96 bg-black/60 border-4 border-black dark:border-zinc-700 p-4 text-xs font-mono font-bold text-zinc-300 outline-none focus:border-purple-500 transition-colors resize-none"
                                />
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => handleSendMessage("recommendations")}
                        disabled={sendingRec || !recMessage.trim()}
                        className="w-full h-12 mt-6 border-4 border-black dark:border-white bg-amber-400 text-black font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {sendingRec ? (
                            <RefreshCw className="w-4 h-4 animate-spin text-black" />
                        ) : (
                            <Send className="w-4 h-4 text-black" />
                        )}
                        Broadcast Recommendations to Channel
                    </button>
                </div>

                {/* 2. Weekly Performance Report Card */}
                <div className="border-4 border-black dark:border-white bg-zinc-900/40 p-6 backdrop-blur-xl shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] relative overflow-hidden flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between border-b-4 border-black dark:border-zinc-800 pb-4 mb-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                                    <CheckCircle2 className="w-5 h-5" />
                                </div>
                                <h3 className="text-lg font-black text-white uppercase tracking-tight">Weekly Performance Report</h3>
                            </div>
                            <span className="text-[10px] font-black bg-purple-600 text-white px-2.5 py-1 rounded-full border-2 border-black">
                                {reportCount !== null ? `${reportCount} Trades` : "Unloaded"}
                            </span>
                        </div>

                        <p className="text-xs text-zinc-400 font-bold mb-4 uppercase tracking-wider">
                            Loads closed trades performance metrics and active positions for the last 7 days.
                        </p>

                        <div className="space-y-4">
                            <button
                                onClick={() => handleFetchPreview("report")}
                                disabled={loadingReport}
                                className="w-full h-11 border-4 border-black dark:border-white bg-purple-600 hover:bg-purple-500 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none"
                            >
                                {loadingReport ? (
                                    <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Eye className="w-4 h-4" />
                                )}
                                Generate Weekly Report Preview
                            </button>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Message Preview (Markdown)</label>
                                <textarea
                                    value={reportMessage}
                                    onChange={(e) => setReportMessage(e.target.value)}
                                    placeholder="Message preview will load here..."
                                    className="w-full h-96 bg-black/60 border-4 border-black dark:border-zinc-700 p-4 text-xs font-mono font-bold text-zinc-300 outline-none focus:border-purple-500 transition-colors resize-none"
                                />
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => handleSendMessage("report")}
                        disabled={sendingReport || !reportMessage.trim()}
                        className="w-full h-12 mt-6 border-4 border-black dark:border-white bg-amber-400 text-black font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[4px_4px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {sendingReport ? (
                            <RefreshCw className="w-4 h-4 animate-spin text-black" />
                        ) : (
                            <Send className="w-4 h-4 text-black" />
                        )}
                        Broadcast Weekly Report to Channel
                    </button>
                </div>
            </div>
        </div>
    );
}
