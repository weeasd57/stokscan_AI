"use client";

import React from "react";
import { TrendingUp, TrendingDown, DollarSign, BarChart3, AlertTriangle, CheckCircle2 } from "lucide-react";

interface EnhancedMetrics {
    total_return_accurate?: number;
    max_drawdown?: number;
    sharpe_ratio?: number;
    total_commission?: number;
    portfolio_value?: number;
    cash_remaining?: number;
    current_exposure?: number;
    avg_trade_pnl?: number;
}

interface EnhancedBacktestMetricsProps {
    enhancedMetrics?: EnhancedMetrics;
    initialCapital?: number;
    language?: string;
}

const EnhancedBacktestMetrics: React.FC<EnhancedBacktestMetricsProps> = ({
    enhancedMetrics,
    initialCapital = 100000,
    language = "en"
}) => {
    if (!enhancedMetrics) {
        return (
            <div className="mt-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="text-sm text-amber-400 font-medium">
                        {language === "ar" 
                            ? "استخدم النظام القديم - قد تكون النتائج غير دقيقة"
                            : "Using legacy system - results may be inaccurate"
                        }
                    </span>
                </div>
            </div>
        );
    }

    const isArabic = language === "ar";
    
    const metrics = [
        {
            key: "total_return",
            label: isArabic ? "العائد الإجمالي الدقيق" : "Accurate Total Return",
            value: enhancedMetrics.total_return_accurate || 0,
            format: "percentage",
            icon: enhancedMetrics.total_return_accurate && enhancedMetrics.total_return_accurate > 0 ? TrendingUp : TrendingDown,
            color: enhancedMetrics.total_return_accurate && enhancedMetrics.total_return_accurate > 0 ? "emerald" : "red"
        },
        {
            key: "max_drawdown",
            label: isArabic ? "أقصى تراجع" : "Max Drawdown",
            value: enhancedMetrics.max_drawdown || 0,
            format: "percentage",
            icon: AlertTriangle,
            color: "amber",
            invert: true // Lower is better
        },
        {
            key: "sharpe_ratio",
            label: isArabic ? "نسبة شارب" : "Sharpe Ratio",
            value: enhancedMetrics.sharpe_ratio || 0,
            format: "decimal",
            icon: BarChart3,
            color: enhancedMetrics.sharpe_ratio && enhancedMetrics.sharpe_ratio > 1 ? "emerald" : 
                   enhancedMetrics.sharpe_ratio && enhancedMetrics.sharpe_ratio > 0.5 ? "amber" : "red"
        },
        {
            key: "portfolio_value",
            label: isArabic ? "قيمة المحفظة النهائية" : "Final Portfolio Value",
            value: enhancedMetrics.portfolio_value || initialCapital,
            format: "currency",
            icon: DollarSign,
            color: enhancedMetrics.portfolio_value && enhancedMetrics.portfolio_value > initialCapital ? "emerald" : "red"
        },
        {
            key: "total_commission",
            label: isArabic ? "إجمالي العمولات" : "Total Commission",
            value: enhancedMetrics.total_commission || 0,
            format: "currency",
            icon: AlertTriangle,
            color: "zinc"
        },
        {
            key: "current_exposure",
            label: isArabic ? "التعرض الحالي" : "Current Exposure",
            value: enhancedMetrics.current_exposure || 0,
            format: "percentage",
            icon: BarChart3,
            color: "indigo"
        }
    ];

    const formatValue = (value: number, format: string) => {
        switch (format) {
            case "percentage":
                return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
            case "currency":
                return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            case "decimal":
                return value.toFixed(2);
            default:
                return value.toString();
        }
    };

    const getColorClasses = (color: string, isPositive: boolean = true) => {
        const colors = {
            emerald: isPositive ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
            red: "text-red-400 bg-red-500/10 border-red-500/20",
            amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
            indigo: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
            zinc: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20"
        };
        return colors[color as keyof typeof colors] || colors.zinc;
    };

    const cashRemaining = enhancedMetrics.cash_remaining || 0;
    const cashPercentage = (cashRemaining / (enhancedMetrics.portfolio_value || initialCapital)) * 100;

    return (
        <div className="mt-6 space-y-4">
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <h4 className="text-sm font-black text-white uppercase tracking-wider">
                    {isArabic ? "الإحصائيات المحسنة" : "Enhanced Metrics"}
                </h4>
                <div className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase">
                    {isArabic ? "دقيق" : "Accurate"}
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {metrics.map((metric) => {
                    const Icon = metric.icon;
                    const isPositive = metric.invert ? metric.value < 5 : metric.value > 0;
                    const colorClasses = getColorClasses(metric.color, isPositive);
                    
                    return (
                        <div
                            key={metric.key}
                            className={`p-4 rounded-xl border ${colorClasses} transition-all hover:scale-[1.02]`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <Icon className="h-4 w-4" />
                                <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                                    {metric.label}
                                </span>
                            </div>
                            <div className="text-lg font-black">
                                {formatValue(metric.value, metric.format)}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Cash Breakdown */}
            {cashRemaining > 0 && (
                <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-700/40">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase">
                            {isArabic ? "توزيع المحفظة" : "Portfolio Allocation"}
                        </span>
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-zinc-400">
                                {isArabic ? "النقد المتبقي" : "Cash Remaining"}
                            </span>
                            <span className="text-white font-medium">
                                ${cashRemaining.toLocaleString()} ({cashPercentage.toFixed(1)}%)
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-zinc-400">
                                {isArabic ? "المراكز المفتوحة" : "Open Positions"}
                            </span>
                            <span className="text-white font-medium">
                                {((enhancedMetrics.current_exposure || 0)).toFixed(1)}%
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Risk Assessment */}
            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-700/40">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">
                        {isArabic ? "تقييم المخاطر" : "Risk Assessment"}
                    </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                        <div className="text-xs text-slate-400 mb-1">
                            {isArabic ? "مستوى المخاطر" : "Risk Level"}
                        </div>
                        <div className={`text-sm font-bold ${
                            (enhancedMetrics.max_drawdown || 0) < 5 ? "text-emerald-400" :
                            (enhancedMetrics.max_drawdown || 0) < 15 ? "text-amber-400" : "text-red-400"
                        }`}>
                            {(enhancedMetrics.max_drawdown || 0) < 5 ? 
                                (isArabic ? "منخفض" : "Low") :
                                (enhancedMetrics.max_drawdown || 0) < 15 ? 
                                    (isArabic ? "متوسط" : "Medium") : 
                                    (isArabic ? "عالي" : "High")
                            }
                        </div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs text-slate-400 mb-1">
                            {isArabic ? "جودة العوائد" : "Return Quality"}
                        </div>
                        <div className={`text-sm font-bold ${
                            (enhancedMetrics.sharpe_ratio || 0) > 1 ? "text-emerald-400" :
                            (enhancedMetrics.sharpe_ratio || 0) > 0.5 ? "text-amber-400" : "text-red-400"
                        }`}>
                            {(enhancedMetrics.sharpe_ratio || 0) > 1 ? 
                                (isArabic ? "ممتاز" : "Excellent") :
                                (enhancedMetrics.sharpe_ratio || 0) > 0.5 ? 
                                    (isArabic ? "جيد" : "Good") : 
                                    (isArabic ? "ضعيف" : "Poor")
                            }
                        </div>
                    </div>
                </div>
            </div>

            {/* Disclaimer */}
            <div className="text-[10px] text-zinc-500 text-center">
                {isArabic 
                    ? "تم حساب هذه الإحصائيات باستخدام النظام المحسن الذي يراعي إدارة المخاطر والعمولات"
                    : "Calculated using enhanced system with proper risk management and commission accounting"
                }
            </div>
        </div>
    );
};

export default EnhancedBacktestMetrics;