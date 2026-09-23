"use client";

import React from "react";
import { Cpu, ArrowUpRight, ArrowDownRight, Sparkles, Target, ShieldAlert, Activity } from "lucide-react";

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
            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-8 text-center shadow-sm dark:border-white/10 dark:bg-zinc-950/60">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500 dark:text-indigo-300"><Cpu className="h-6 w-6" /></span>
                <p className="mt-3 text-sm font-semibold text-zinc-500">
                    {isAr ? "لا توجد توصيات نشطة مفتوحة حالياً" : "No active AI recommendations at this time."}
                </p>
            </div>
        );
    }

    return (
        <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white/80 shadow-sm dark:border-white/10 dark:bg-zinc-950/55">
            <div className={`flex flex-col gap-3 border-b border-zinc-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 sm:px-6 ${isAr ? "sm:flex-row-reverse" : ""}`}>
                <div className={`flex items-center gap-3 ${isAr ? "flex-row-reverse text-right" : ""}`}>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500 dark:text-indigo-300"><Cpu className="h-5 w-5" /></span>
                    <div>
                        <h3 className="text-base font-bold tracking-tight text-zinc-950 dark:text-white">{isAr ? "توصيات الذكاء الاصطناعي النشطة" : "Active AI recommendations"}</h3>
                        <p className="mt-0.5 text-xs text-zinc-500">{isAr ? "متابعة موجزة لمستويات الدخول والأهداف والمخاطر" : "A concise view of entries, targets and risk levels"}</p>
                    </div>
                </div>
                <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{signals.length} {isAr ? "توصية مفتوحة" : "open"}</span>
            </div>

            <div className="grid grid-cols-1 gap-4 p-4 sm:p-5 xl:grid-cols-2">
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
                            className="group flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-950/5 dark:border-white/10 dark:bg-zinc-900/60 dark:hover:border-indigo-400/30 sm:p-5"
                        >
                            {/* Card Header */}
                            <div>
                                <div className={`mb-4 flex items-start justify-between gap-3 ${isAr ? "flex-row-reverse text-right" : "text-left"}`}>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <a href={`/stocks/${sig.symbol}`} className="text-lg font-extrabold tracking-tight text-zinc-950 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-300">{sig.symbol}</a>
                                            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                                                isBuy 
                                                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400" 
                                                    : "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400"
                                            }`}>
                                                {isBuy ? (isAr ? "شراء" : "BUY") : (isAr ? "بيع" : "SELL")}
                                            </span>
                                        </div>
                                        <span className="mt-1 block max-w-[240px] truncate text-xs font-medium text-zinc-500">{sig.name}</span>
                                    </div>

                                    {/* Unrealized PnL */}
                                    <div className="text-right">
                                        <div className={`flex items-center justify-end gap-0.5 font-mono text-base font-extrabold ${pnlColor}`}>
                                            {isPnlPositive ? <ArrowUpRight className="w-4.5 h-4.5" /> : <ArrowDownRight className="w-4.5 h-4.5" />}
                                            {sig.pnl_pct >= 0 ? "+" : ""}{sig.pnl_pct.toFixed(2)}%
                                        </div>
                                        <div className="mt-1 text-[10px] text-zinc-500">{isAr ? "العائد غير المحقق" : "unrealized return"}</div>
                                    </div>
                                </div>

                                {/* Target/Stop levels */}
                                <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl bg-zinc-50 p-3 text-center dark:bg-black/20">
                                    <div>
                                        <div className="mb-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-zinc-500"><ShieldAlert className="h-3 w-3 text-rose-500" />{isAr ? "وقف الخسارة" : "Stop"}</div>
                                        <div className="text-sm font-mono font-bold text-rose-600 dark:text-rose-400">{sig.stop_loss.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <div className="mb-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-zinc-500"><Activity className="h-3 w-3 text-indigo-500" />{isAr ? "الدخول" : "Entry"}</div>
                                        <div className="text-sm font-mono font-bold text-zinc-950 dark:text-zinc-200">{sig.entry_price.toFixed(2)}</div>
                                    </div>
                                    <div>
                                        <div className="mb-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-zinc-500"><Target className="h-3 w-3 text-emerald-500" />{isAr ? "الهدف" : "Target"}</div>
                                        <div className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400">{sig.target_price.toFixed(2)}</div>
                                    </div>
                                </div>

                                {/* Slider Progress Bar */}
                                <div className="relative mb-4 pt-1">
                                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                                        <div 
                                            className={`h-full rounded-full ${isPnlPositive ? "bg-emerald-500" : "bg-rose-500"}`} 
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>
                                    <div className="mt-1.5 flex justify-between gap-2 text-[9px] font-mono text-zinc-500">
                                        <span>{isAr ? "وقف" : "Stop"}: {sig.stop_loss.toFixed(1)}</span>
                                        <span>{isAr ? "الحالي" : "Now"}: {sig.current_price.toFixed(1)}</span>
                                        <span>{isAr ? "هدف" : "Target"}: {sig.target_price.toFixed(1)}</span>
                                    </div>
                                </div>

                                {/* Arabic Rationale / Reasons */}
                                {sig.top_reasons && sig.top_reasons.length > 0 && (
                                    <div className="mt-3 space-y-1.5">
                                        <span className="mb-1 block text-[10px] font-bold text-zinc-500">
                                            {isAr ? "أسباب التوصية:" : "Key Reasons:"}
                                        </span>
                                        <div className="space-y-1">
                                            {sig.top_reasons.slice(0, 2).map((reason, idx) => (
                                                <div key={idx} className={`flex items-start gap-1.5 text-xs font-medium leading-relaxed text-zinc-600 dark:text-zinc-400 ${isAr ? "flex-row-reverse text-right" : ""}`}>
                                                    <Sparkles className="w-3 h-3 text-[#FFDC58] shrink-0 mt-0.5" />
                                                    <span>{reason}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Card Footer Info */}
                            <div className={`mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-[10px] text-zinc-500 dark:border-white/10 ${isAr ? "flex-row-reverse" : ""}`}>
                                <div className="flex items-center gap-1">
                                    <span>{isAr ? "النموذج:" : "Model:"}</span>
                                    <span className="text-zinc-950 dark:text-zinc-300 font-bold">{sig.model_name}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span>{isAr ? "الثقة المسجلة:" : "Recorded confidence:"}</span>
                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{(sig.precision * 100).toFixed(0)}%</span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
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
        <div className="rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm dark:border-white/10 dark:bg-zinc-950/50 sm:p-6">
            <div className={`flex items-start gap-4 ${isAr ? "flex-row-reverse text-right" : "text-left"}`}>
                <div className="rounded-2xl border border-indigo-500/15 bg-indigo-500/10 p-3 text-indigo-500 dark:text-indigo-300">
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
