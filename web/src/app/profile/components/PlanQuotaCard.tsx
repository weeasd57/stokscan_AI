"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Zap,
  MessageSquare,
  BarChart3,
  Crown,
  RefreshCw,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";

interface QuotaData {
  ok: boolean;
  plan: {
    id: string;
    label: string;
    is_pro: boolean;
    status: string;
    current_period_end: string | null;
    created_at: string | null;
  };
  quota: {
    chat_messages: {
      used: number;
      limit: number;
      remaining: number;
      percent: number;
    };
    portfolio_stocks: {
      used: number;
      limit: number;
      remaining: number;
      percent: number;
    };
    signals: {
      delay_days: number;
      is_instant: boolean;
    };
  };
}

interface Props {
  refreshTrigger?: number;
}

export default function PlanQuotaCard({ refreshTrigger = 0 }: Props) {
  const { language } = useLanguage();
  const isAr = language === "ar";

  const [data, setData] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchQuota = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const res = await fetch("/api/user/quota", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.ok) {
          setData(json);
        }
      }
    } catch (e) {
      console.error("[PlanQuotaCard] fetch error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota, refreshTrigger]);

  if (loading) {
    return (
      <div className="neobrutal-card p-6 bg-white dark:bg-zinc-900 border-4 border-black dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] flex items-center justify-center min-h-[220px]">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-500" />
      </div>
    );
  }

  const isPro = data?.plan?.is_pro ?? false;
  const chat = data?.quota?.chat_messages;
  const portfolio = data?.quota?.portfolio_stocks;
  const signals = data?.quota?.signals;

  const getProgressColor = (percent: number) => {
    if (percent >= 90) return "bg-red-500";
    if (percent >= 70) return "bg-amber-500";
    return "bg-emerald-500";
  };

  const formatDate = (isoStr: string | null) => {
    if (!isoStr) return "—";
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(isAr ? "ar-EG" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return isoStr.slice(0, 10);
    }
  };

  return (
    <div
      className={`neobrutal-card p-6 sm:p-7 border-4 border-black dark:border-white shadow-[6px_6px_0px_rgba(0,0,0,1)] dark:shadow-[6px_6px_0px_rgba(255,255,255,1)] relative transition-all ${
        isPro
          ? "bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/40 dark:from-emerald-950/20 dark:via-zinc-900 dark:to-emerald-950/10"
          : "bg-white dark:bg-zinc-900"
      }`}
    >
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b-4 border-black dark:border-zinc-800 pb-5 mb-6">
        <div className="flex items-center gap-3">
          <div
            className={`h-11 w-11 border-4 border-black dark:border-white flex items-center justify-center shadow-[3px_3px_0px_rgba(0,0,0,1)] dark:shadow-[3px_3px_0px_rgba(255,255,255,1)] ${
              isPro ? "bg-emerald-500 text-white" : "bg-zinc-800 text-white"
            }`}
          >
            {isPro ? <Crown className="h-6 w-6" /> : <Zap className="h-6 w-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-black text-black dark:text-white uppercase tracking-tight">
                {isAr ? "الخطة والكوتا الحالية" : "Current Plan & Quota"}
              </h2>
              <span
                className={`text-xs font-black uppercase px-2.5 py-0.5 border-2 border-black dark:border-white shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] ${
                  isPro
                    ? "bg-emerald-500 text-white"
                    : "bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-100"
                }`}
              >
                {isPro ? "PRO" : isAr ? "مجاني" : "FREE"}
              </span>
            </div>
            <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 mt-0.5">
              {isPro
                ? isAr
                  ? "اشتراك Pro نشط مع كامل الصلاحيات"
                  : "Active Pro subscription with full access"
                : isAr
                ? "خطة مجانية بميزات واستخدام محدد"
                : "Free plan with limited usage"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => fetchQuota(false)}
            disabled={refreshing}
            title={isAr ? "تحديث الاستخدام" : "Refresh usage"}
            className="h-9 px-3 border-2 border-black dark:border-white bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-black dark:text-white font-black text-xs flex items-center gap-1.5 shadow-[2px_2px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_rgba(255,255,255,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {isAr ? "تحديث" : "Refresh"}
          </button>

          {!isPro && (
            <Link
              href="/pricing"
              className="h-9 px-3.5 border-2 border-black dark:border-white bg-emerald-500 hover:bg-emerald-600 text-white font-black text-xs flex items-center gap-1.5 uppercase tracking-wider shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
            >
              <Crown className="w-3.5 h-3.5" />
              {isAr ? "ترقية إلى Pro" : "Upgrade to Pro"}
              <ArrowRight className="w-3 h-3 rtl:rotate-180" />
            </Link>
          )}
        </div>
      </div>

      {/* ── Quota Metrics Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Metric 1: Chatbot Messages */}
        <div className="p-4 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-800/60 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 border border-black dark:border-white">
                <MessageSquare className="w-4 h-4" />
              </div>
              <span className="text-xs font-black uppercase text-zinc-700 dark:text-zinc-200">
                {isAr ? "رسائل الشات بوت" : "AI Chatbot"}
              </span>
            </div>
            <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
              {isAr ? "شهريًا" : "Monthly"}
            </span>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-2xl font-black text-black dark:text-white">
                {chat?.used ?? 0}
                <span className="text-sm font-bold text-zinc-500 dark:text-zinc-400">
                  {" "}/ {chat?.limit ?? 50}
                </span>
              </span>
              <span className="text-xs font-black text-zinc-600 dark:text-zinc-300">
                {chat?.percent ?? 0}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-3 border-2 border-black dark:border-white bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${getProgressColor(
                  chat?.percent ?? 0
                )}`}
                style={{ width: `${Math.min(100, chat?.percent ?? 0)}%` }}
              />
            </div>
          </div>

          <div className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
            <span>{isAr ? "المتبقي:" : "Remaining:"}</span>
            <span className="font-black text-black dark:text-white">
              {chat?.remaining ?? 0} {isAr ? "رسالة" : "msgs"}
            </span>
          </div>
        </div>

        {/* Metric 2: Portfolio Stocks */}
        <div className="p-4 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-800/60 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 border border-black dark:border-white">
                <BarChart3 className="w-4 h-4" />
              </div>
              <span className="text-xs font-black uppercase text-zinc-700 dark:text-zinc-200">
                {isAr ? "أسهم المحفظة" : "Portfolio Stocks"}
              </span>
            </div>
            <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
              {isAr ? "نشطة" : "Active"}
            </span>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-2xl font-black text-black dark:text-white">
                {portfolio?.used ?? 0}
                <span className="text-sm font-bold text-zinc-500 dark:text-zinc-400">
                  {" "}/ {portfolio?.limit ?? 5}
                </span>
              </span>
              <span className="text-xs font-black text-zinc-600 dark:text-zinc-300">
                {portfolio?.percent ?? 0}%
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-3 border-2 border-black dark:border-white bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${getProgressColor(
                  portfolio?.percent ?? 0
                )}`}
                style={{ width: `${Math.min(100, portfolio?.percent ?? 0)}%` }}
              />
            </div>
          </div>

          <div className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
            <span>{isAr ? "السعة الشاغرة:" : "Available slots:"}</span>
            <span className="font-black text-black dark:text-white">
              {portfolio?.remaining ?? 0} {isAr ? "سهم" : "stocks"}
            </span>
          </div>
        </div>

        {/* Metric 3: Signals Speed & Delay */}
        <div className="p-4 border-2 border-black dark:border-white bg-zinc-50 dark:bg-zinc-800/60 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={`p-1.5 border border-black dark:border-white ${
                  isPro
                    ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400"
                    : "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
                }`}
              >
                <Zap className="w-4 h-4" />
              </div>
              <span className="text-xs font-black uppercase text-zinc-700 dark:text-zinc-200">
                {isAr ? "سرعة الإشارات" : "Signals Speed"}
              </span>
            </div>
            <span
              className={`text-[10px] font-black uppercase px-2 py-0.5 border ${
                isPro
                  ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400"
                  : "border-zinc-400 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {isPro ? (isAr ? "فورية" : "Instant") : isAr ? "متأخرة" : "Delayed"}
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              {isPro ? (
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-lg font-black text-black dark:text-white">
                    {isAr ? "إشارات يومية فورية" : "Daily instant signals"}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <Clock className="w-5 h-5 shrink-0" />
                  <span className="text-lg font-black text-black dark:text-white">
                    {isAr
                      ? `تأخير ${signals?.delay_days ?? 15} أيام`
                      : `${signals?.delay_days ?? 15} days delay`}
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 mt-1">
              {isPro
                ? isAr
                  ? "تحصل على التوصيات فور خروجها من النماذج"
                  : "Get recommendations the moment models generate them"
                : isAr
                ? "الترقية لـ Pro تزيل التأخير تماماً"
                : "Upgrade to Pro to remove all delay"}
            </p>
          </div>

          <div className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
            <span>{isAr ? "الوصول للتحليلات:" : "Analytics access:"}</span>
            <span className="font-black text-black dark:text-white">
              {isPro ? (isAr ? "كامل ومتقدم" : "Full & Advanced") : isAr ? "أساسي" : "Basic"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Pro Plan Subscription Details Footer ── */}
      {isPro && data?.plan?.current_period_end && (
        <div className="mt-5 pt-4 border-t-2 border-emerald-500/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-bold text-zinc-600 dark:text-zinc-300">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>
              {isAr ? "تاريخ تجديد / انتهاء الاشتراك:" : "Renewal / Expiry date:"}{" "}
              <strong className="text-black dark:text-white">
                {formatDate(data.plan.current_period_end)}
              </strong>
            </span>
          </div>
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {isAr ? "الاشتراك نشط ومفعل" : "Subscription is active"}
          </span>
        </div>
      )}
    </div>
  );
}
