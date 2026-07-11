"use client";

import React from "react";
import { Cpu, Target, ShieldAlert, ArrowUpRight, ArrowDownRight, Sparkles } from "lucide-react";

interface AISignal {
    symbol: string;
    name: string;
    signal: "BUY" | "SELL";
    entry_price: number;
    current_price: number;
    target_price: number;
    stop_loss: number;
    precision: number;
    pnl_pct: number;
    top_reasons: string[];
    model_name: string;
    created_at: string;
    council_score: number;
}

export function ActiveAISignals({ signals, isAr }: { signals: AISignal[]; isAr: boolean }) {
    if (!signals || signals.length === 0) {
        return (
            <div className="border-2 border-black dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 text-center space-y-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,0.1)]">
                <Cpu className="w-8 h-8 text-zinc-500 mx-auto animate-pulse" />
                <p className="text-xs font-mono text-zinc-500">
                    {isAr ? "لا توجد توصيات نشطة مفتوحة حالياً" : "No active AI recommendations at this time."}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                <Cpu className="w-5 h-5 text-[#FFDC58]" />
                <h3 className="text-sm font-black uppercase tracking-wider text-zinc-950 dark:text-white">
                    {isAr ? "توصيات الذكاء الاصطناعي النشطة" : "Active AI Recommendations"}
                </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {signals.map((sig) => {
                    const isBuy = sig.signal === "BUY";
                    const isPnlPositive = sig.pnl_pct >= 0;
                    const pnlColor = isPnlPositive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
                    
                    // Calc slider percentage progress between entry, current, target
                    const range = Math.abs(sig.target_price - sig.entry_price) || 1;
                    const currentOffset = Math.abs(sig.current_price - sig.entry_price);
                    let progressPct = (currentOffset / range) * 100;
                    progressPct = Math.max(2, Math.min(98, progressPct)); // cap visual representation

                    return (
                        <div
                            key={sig.symbol}
                            className="border-2 border-black dark:border-zinc-800 bg-white dark:bg-zinc-950/80 p-5 shadow-[4px_4px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_rgba(255,255,255,0.15)] flex flex-col justify-between"
                        >
                            {/* Card Header */}
                            <div>
                                <div className={`flex items-start justify-between gap-2 mb-3 ${isAr ? "flex-row-reverse text-right" : "text-left"}`}>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <a href={`/stocks/${sig.symbol}`} className="text-base font-black text-indigo-500 hover:underline">{sig.symbol}</a>
                                            <span className={`px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded border ${
                                                isBuy 
                                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400" 
                                                    : "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400"
                                            }`}>
                                                {isBuy ? (isAr ? "شراء" : "BUY") : (isAr ? "بيع" : "SELL")}
                                            </span>
                                        </div>
                                        <span className="text-[10px] text-zinc-500 font-semibold truncate max-w-[200px] block mt-0.5">{sig.name}</span>
                                    </div>

                                    {/* Unrealized PnL */}
                                    <div className="text-right">
                                        <div className={`text-sm font-mono font-black ${pnlColor} flex items-center gap-0.5 justify-end`}>
                                            {isPnlPositive ? <ArrowUpRight className="w-4.5 h-4.5" /> : <ArrowDownRight className="w-4.5 h-4.5" />}
                                            {sig.pnl_pct >= 0 ? "+" : ""}{sig.pnl_pct.toFixed(2)}%
                                        </div>
                                        <div className="text-[9px] font-mono text-zinc-500 mt-0.5">{isAr ? "ربح/خسارة غير محققة" : "unrealized P&L"}</div>
                                    </div>
                                </div>

                                {/* Target/Stop levels */}
                                <div className="grid grid-cols-3 gap-2 py-2 border-y border-zinc-100 dark:border-zinc-900 mb-4 text-center">
                                    <div>
                                        <div className="text-[9px] font-black uppercase text-zinc-500 mb-0.5">{isAr ? "وقف الخسارة" : "Stop Loss"}</div>
                                        <div className="text-xs font-mono font-bold text-rose-600 dark:text-rose-400">{sig.stop_loss.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[9px] font-black uppercase text-zinc-500 mb-0.5">{isAr ? "الدخول" : "Entry"}</div>
                                        <div className="text-xs font-mono font-bold text-zinc-950 dark:text-zinc-300">{sig.entry_price.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <div className="text-[9px] font-black uppercase text-zinc-500 mb-0.5">{isAr ? "الهدف" : "Target"}</div>
                                        <div className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">{sig.target_price.toFixed(2)}</div>
                                    </div>
                                </div>

                                {/* Slider Progress Bar */}
                                <div className="relative pt-1 mb-4">
                                    <div className="h-1.5 w-full bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                                        <div 
                                            className={`h-full rounded-full ${isPnlPositive ? "bg-emerald-500" : "bg-rose-500"}`} 
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between text-[8px] font-mono text-zinc-500 mt-1">
                                        <span>SL: {sig.stop_loss.toFixed(1)}</span>
                                        <span>Price: {sig.current_price.toFixed(1)}</span>
                                        <span>Target: {sig.target_price.toFixed(1)}</span>
                                    </div>
                                </div>

                                {/* Arabic Rationale / Reasons */}
                                {sig.top_reasons && sig.top_reasons.length > 0 && (
                                    <div className="space-y-1 mt-3">
                                        <span className="text-[9px] font-black uppercase tracking-wider text-zinc-500 block mb-1">
                                            {isAr ? "أسباب التوصية:" : "Key Reasons:"}
                                        </span>
                                        <div className="space-y-1">
                                            {sig.top_reasons.slice(0, 2).map((reason, idx) => (
                                                <div key={idx} className={`flex items-start gap-1.5 text-[10px] text-zinc-700 dark:text-zinc-400 font-semibold leading-relaxed ${isAr ? "flex-row-reverse text-right" : ""}`}>
                                                    <Sparkles className="w-3 h-3 text-[#FFDC58] shrink-0 mt-0.5" />
                                                    <span>{reason}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Card Footer Info */}
                            <div className={`flex items-center justify-between border-t border-zinc-100 dark:border-zinc-900 pt-3 mt-4 text-[9px] font-mono text-zinc-500 ${isAr ? "flex-row-reverse" : ""}`}>
                                <div className="flex items-center gap-1">
                                    <span>Model:</span>
                                    <span className="text-zinc-950 dark:text-zinc-300 font-bold">{sig.model_name}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span>{isAr ? "نسبة الثقة:" : "Confidence:"}</span>
                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{(sig.precision * 100).toFixed(0)}%</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* ── Daily Analysis Summary ───────────────────────────────── */
export function DailyAnalysisSummary({ 
    healthScore, 
    advancing, 
    declining, 
    isAr 
}: { 
    healthScore: number; 
    advancing: number; 
    declining: number; 
    isAr: boolean;
}) {
    const verdict = healthScore >= 70 
        ? (isAr ? "إيجابي وقوي" : "Strong Bullish") 
        : healthScore < 45 
            ? (isAr ? "سلبي ومخاطرة" : "Bearish / Risk Off") 
            : (isAr ? "متذبذب وعرضي" : "Mixed / Sideways");

    return (
        <div className="border-2 border-black dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-5">
            <div className={`flex items-start gap-4 ${isAr ? "flex-row-reverse text-right" : "text-left"}`}>
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-xl">
                    <Cpu className="w-6 h-6" />
                </div>
                <div className="space-y-1.5 flex-1">
                    <h4 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-wider">
                        {isAr ? "ملخص التحليل الفني والآلي اليومي" : "Daily Technical & AI Summary"}
                    </h4>
                    <div className={`flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400 ${isAr ? "flex-row-reverse" : ""}`}>
                        <div>
                            {isAr ? "نبض السوق:" : "Market Score:"}{" "}
                            <span className="text-zinc-950 dark:text-white font-bold">{healthScore}/100 ({verdict})</span>
                        </div>
                        <div>
                            {isAr ? "الأسهم الصاعدة:" : "Advancing:"}{" "}
                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">{advancing}</span>
                        </div>
                        <div>
                            {isAr ? "الأسهم الهابطة:" : "Declining:"}{" "}
                            <span className="text-rose-600 dark:text-rose-400 font-bold">{declining}</span>
                        </div>
                    </div>
                    <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400 pt-1">
                        {isAr 
                            ? `الذكاء الاصطناعي يظهر إشارة صحة سوق بـ ${healthScore} نقاط. مع تفوق الأسهم ${advancing > declining ? "الصاعدة" : "الهابطة"}، ننصح ${healthScore >= 70 ? "بالتركيز على فرص الشراء الفعالة وتفعيل الأهداف القريبة" : healthScore < 45 ? "بتجنب الدخول العشوائي والاحتفاظ بالسيولة لحين استقرار الاتجاه" : "بالانتقائية العالية في المضاربة مع تقليص أحجام الصفقات"}.`
                            : `The AI is reporting a market health score of ${healthScore}/100. With ${advancing} advancing vs ${declining} declining stocks, the recommendation is to ${healthScore >= 70 ? "focus on high-confidence long setups" : healthScore < 45 ? "stay in cash and avoid risky entries" : "be selective and manage risk tightly"}.`
                        }
                    </p>
                </div>
            </div>
        </div>
    );
}
