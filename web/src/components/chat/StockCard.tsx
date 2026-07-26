"use client";

import React, { useState } from "react";
import { 
    TrendingUp, 
    TrendingDown, 
    Minus, 
    Activity, 
    Zap, 
    AlertTriangle, 
    BarChart2, 
    Copy, 
    Check, 
    ArrowUpRight, 
    Layers, 
    Clock 
} from "lucide-react";

export interface StockData {
    symbol: string;
    nameAr?: string;
    nameEn?: string;
    companyName?: string;
    name?: string;
    price: number | string;
    currency?: string;
    changePercent?: number | string;
    change_percent?: number | string;
    change?: number | string;
    rsi?: number | string;
    macdSignal?: string;
    macd_signal?: string;
    macd?: number | string | { signal?: string; value?: number | string; histogram?: number | string };
    volume?: number | string;
    high?: number | string;
    low?: number | string;
    trend?: "up" | "down" | "neutral" | string;
    signalStrength?: string;
    recommendation?: string;
    updatedAt?: string;
    [key: string]: any;
}

export interface StockCardProps {
    stock?: StockData;
    data?: StockData;
    className?: string;
    onSymbolClick?: (symbol: string) => void;
}

export function StockCard({ stock, data, className = "", onSymbolClick }: StockCardProps) {
    const [copied, setCopied] = useState(false);

    // Support flexible payload formats
    const stockData = stock || data;

    if (!stockData || !stockData.symbol) {
        return null;
    }

    const symbol = String(stockData.symbol).toUpperCase();
    const nameAr = stockData.nameAr || stockData.companyName || stockData.name || symbol;
    const nameEn = stockData.nameEn || (stockData.nameAr ? symbol : undefined);
    
    // Parse price
    const rawPrice = typeof stockData.price === "number" ? stockData.price : parseFloat(String(stockData.price || "0"));
    const formattedPrice = isNaN(rawPrice) 
        ? "0.00" 
        : rawPrice.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    const currency = stockData.currency || "ج.م";

    // Parse change percentage
    const rawChangePct = stockData.changePercent ?? stockData.change_percent ?? stockData.change ?? 0;
    const changePctVal = typeof rawChangePct === "number" ? rawChangePct : parseFloat(String(rawChangePct || "0"));
    const isPositive = changePctVal > 0;
    const isNegative = changePctVal < 0;
    const formattedChangePct = `${isPositive ? "+" : ""}${changePctVal.toFixed(2)}%`;

    // Parse RSI
    const rawRsi = stockData.rsi;
    const rsiVal = typeof rawRsi === "number" 
        ? rawRsi 
        : rawRsi !== undefined 
            ? parseFloat(String(rawRsi)) 
            : undefined;

    let rsiLabel = "متوازن";
    let rsiColor = "text-amber-400 bg-amber-500/10 border-amber-500/30";
    let rsiProgressColor = "bg-amber-500";
    
    if (rsiVal !== undefined && !isNaN(rsiVal)) {
        if (rsiVal >= 70) {
            rsiLabel = "تشبع شرائي";
            rsiColor = "text-rose-400 bg-rose-500/10 border-rose-500/30";
            rsiProgressColor = "bg-rose-500";
        } else if (rsiVal <= 30) {
            rsiLabel = "تشبع بيعي";
            rsiColor = "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
            rsiProgressColor = "bg-emerald-500";
        }
    }

    // Parse MACD Signal
    const rawMacdSignal = stockData.macdSignal || stockData.macd_signal || 
        (typeof stockData.macd === "object" ? stockData.macd?.signal : String(stockData.macd || ""));
    
    const macdSignalStr = String(rawMacdSignal || "").trim();

    const isMacdBuy = /buy|شراء|إيجابي|صاعد|bullish/i.test(macdSignalStr);
    const isMacdSell = /sell|بيع|سلبي|هابط|bearish/i.test(macdSignalStr);

    let macdText = macdSignalStr || "محايد";
    if (isMacdBuy && !/شراء/.test(macdText)) macdText = `شراء (${macdText})`;
    if (isMacdSell && !/بيع/.test(macdText)) macdText = `بيع (${macdText})`;

    const handleCopySymbol = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(symbol);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div 
            dir="rtl"
            className={`my-4 relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-zinc-900/80 backdrop-blur-xl p-4 md:p-5 text-right shadow-2xl transition-all duration-300 hover:border-amber-500/40 hover:shadow-amber-500/5 group ${className}`}
        >
            {/* Top ambient color glow */}
            <div 
                className={`absolute -top-16 -right-16 h-36 w-36 rounded-full blur-3xl pointer-events-none transition-all duration-500 ${
                    isPositive ? "bg-emerald-500/15" : isNegative ? "bg-rose-500/15" : "bg-amber-500/15"
                }`} 
            />

            {/* Header: Symbol & Names */}
            <div className="flex items-start justify-between gap-3 relative z-10">
                <div className="flex items-center gap-3">
                    {/* Symbol Avatar Badge */}
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/20 via-zinc-800 to-zinc-900 border border-amber-500/30 text-amber-400 font-mono font-black text-sm shadow-md group-hover:scale-105 transition-transform">
                        {symbol.substring(0, 4)}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-lg md:text-xl text-zinc-100 tracking-wide">
                                {nameAr}
                            </h3>
                            {nameEn && nameEn !== nameAr && (
                                <span className="text-xs text-zinc-400 font-mono font-medium hidden sm:inline-block">
                                    ({nameEn})
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                            <span 
                                onClick={() => onSymbolClick && onSymbolClick(symbol)}
                                className="font-mono text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 cursor-pointer hover:bg-amber-500/20 transition-colors"
                            >
                                {symbol}
                            </span>
                            <button
                                type="button"
                                onClick={handleCopySymbol}
                                className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5 rounded"
                                title="نسخ رمز السهم"
                            >
                                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Live Badge */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-800/80 border border-zinc-700/80 text-[11px] font-bold text-zinc-300 shadow-sm">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span>مباشر</span>
                </div>
            </div>

            {/* Price & Change Row */}
            <div className="mt-4 pt-3 border-t border-zinc-800/80 flex flex-wrap items-baseline justify-between gap-2 relative z-10">
                <div className="flex items-baseline gap-2">
                    <span className="font-mono font-extrabold text-3xl md:text-4xl text-white tracking-tight">
                        {formattedPrice}
                    </span>
                    <span className="text-xs font-bold text-amber-400/90 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                        {currency}
                    </span>
                </div>

                {/* Change Percent Badge */}
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-sm md:text-base font-extrabold shadow-sm border ${
                    isPositive 
                        ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" 
                        : isNegative 
                            ? "bg-rose-500/15 border-rose-500/30 text-rose-400" 
                            : "bg-zinc-800 border-zinc-700 text-zinc-300"
                }`}>
                    {isPositive && <TrendingUp className="w-4 h-4 text-emerald-400 stroke-[2.5]" />}
                    {isNegative && <TrendingDown className="w-4 h-4 text-rose-400 stroke-[2.5]" />}
                    {!isPositive && !isNegative && <Minus className="w-4 h-4 text-zinc-400 stroke-[2.5]" />}
                    <span dir="ltr">{formattedChangePct}</span>
                </div>
            </div>

            {/* Indicators Grid (RSI & MACD) */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
                {/* RSI Card */}
                <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between gap-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400">
                            <Activity className="w-3.5 h-3.5 text-amber-400" />
                            <span>مؤشر القوة النسبية (RSI)</span>
                        </div>
                        {rsiVal !== undefined && !isNaN(rsiVal) && (
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${rsiColor}`}>
                                {rsiLabel}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center justify-between mt-1">
                        <span className="font-mono text-lg font-bold text-zinc-100">
                            {rsiVal !== undefined && !isNaN(rsiVal) ? rsiVal.toFixed(1) : "غير متوفر"}
                        </span>
                        {rsiVal !== undefined && !isNaN(rsiVal) && (
                            <div className="w-24 bg-zinc-800 h-2 rounded-full overflow-hidden border border-zinc-700/50">
                                <div 
                                    className={`h-full rounded-full transition-all duration-500 ${rsiProgressColor}`}
                                    style={{ width: `${Math.min(Math.max(rsiVal, 0), 100)}%` }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* MACD Card */}
                <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between gap-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400">
                            <BarChart2 className="w-3.5 h-3.5 text-cyan-400" />
                            <span>إشارة الماكدي (MACD)</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between mt-1">
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs md:text-sm font-bold border ${
                            isMacdBuy 
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" 
                                : isMacdSell 
                                    ? "bg-rose-500/20 text-rose-300 border-rose-500/40" 
                                    : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                        }`}>
                            {isMacdBuy && <Zap className="w-3.5 h-3.5 text-emerald-400" />}
                            {isMacdSell && <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />}
                            {!isMacdBuy && !isMacdSell && <BarChart2 className="w-3.5 h-3.5 text-amber-400" />}
                            <span>{macdText}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Optional Extra Stats Row (Volume, High, Low) */}
            {(stockData.volume || stockData.high || stockData.low) && (
                <div className="mt-3 pt-3 border-t border-zinc-800/60 grid grid-cols-3 gap-2 text-center text-xs relative z-10">
                    {stockData.volume && (
                        <div className="bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/50">
                            <div className="text-zinc-500 text-[11px] font-medium">الحجم</div>
                            <div className="font-mono font-bold text-zinc-200 mt-0.5">{String(stockData.volume)}</div>
                        </div>
                    )}
                    {stockData.high && (
                        <div className="bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/50">
                            <div className="text-zinc-500 text-[11px] font-medium">الأعلى</div>
                            <div className="font-mono font-bold text-emerald-400 mt-0.5">{String(stockData.high)}</div>
                        </div>
                    )}
                    {stockData.low && (
                        <div className="bg-zinc-950/40 p-2 rounded-lg border border-zinc-800/50">
                            <div className="text-zinc-500 text-[11px] font-medium">الأدنى</div>
                            <div className="font-mono font-bold text-rose-400 mt-0.5">{String(stockData.low)}</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default StockCard;
